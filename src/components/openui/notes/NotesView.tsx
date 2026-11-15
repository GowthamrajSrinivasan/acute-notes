"use client";

/**
 * The Notes view (`.ai/docs/openui-integration-plan.md` Phase 2, with Phase 3's interactions): the canvas's cards as a
 * reading document over the canvas, rendered through the OpenUI card library. For understanding imported conversations
 * without arranging the canvas first.
 *
 * - **Notes/Canvas switching:** a toolbar toggle (and Escape) — a view mode, not a canvas primitive.
 * - **Read:** sections from frames, notes in reading order (`notesModel.ts`), long cards behind "More", citations that
 *   expand to the cited passage, "Open in source" and "Show on canvas".
 * - **Study:** the same notes as flashcards and quiz cards (`study.ts`). Quiz first picks and flashcard self-grades go to
 *   the device-local study history (`ai/study/store.ts`, study-mode plan Phase 3); cards show "Weak", "Source changed
 *   since you studied this" and "Needs review" badges, and the **Weak** list (`WeakConcepts.tsx`) ranks what keeps being missed.
 * - **Generate from source** (only on the user's click, AI mode on): a stored source distilled into cards that stream
 *   in (`notesTask.ts`); "Pin to canvas" promotes one into an ordinary card (`promote.ts`, one `create_block`).
 *
 * Reads the canvas; the only canvas write is a pin (one undoable step). Nothing here edits or patches an existing card.
 * Study answers go to the device's meta store only, never to a card.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TransactionHistory } from "@/ai/changes/accept";
import { loadLatest } from "@/ai/content/sources";
import { checkGeneratedCards } from "@/ai/openui/notesCheck";
import { annotateUnits, generateOpenUiNotes, notesInputOf, type GeneratedCard } from "@/ai/openui/notesTask";
import { NotesHostProvider, type NotesHost } from "@/ai/openui/hostContext";
import { flashcardLang, quizLang, studyNoteOf, type StudyNote } from "@/ai/openui/study";
import { conceptOfNote } from "@/ai/study/concept";
import { isWeak } from "@/ai/study/mastery";
import { clearStudy, loadStudy, localShardId, recordAttempt, shardIdOf, snapshotCardStatus, type LoadedConcept } from "@/ai/study/store";
import { AIRuntime } from "@/ai/runtime";
import { useAIMode } from "@/components/ai/askAI";
import { useToolbarSlot } from "@/components/canvas/toolbarSlot";
import { OpenUiCardRenderer } from "@/components/openui/OpenUiCardRenderer";
import { openSourceForUnits, openSourceOn, outlineCiting, showObjects } from "@/components/review/knowledgeActions";
import { useKnowledgeUI } from "@/components/review/knowledgeStore";
import { useKnowledgeObjects } from "@/components/review/useKnowledgeObjects";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { buildNotes, noteLang, type Note, type NoteSection } from "./notesModel";
import { notesView, useNotesView } from "./notesViewStore";
import { generations, useGeneration, type GenSource, type Generation } from "./generationStore";
import { promoteNote } from "./promote";
import { WeakConcepts, type StudyCardRef } from "./WeakConcepts";
import "../interactions.css";
import "./notes.css";

interface Env {
  api: ExcalidrawImperativeAPI;
  home: DocumentHome;
  history: TransactionHistory;
}

const getDocument = (id: string) => getDocumentStore().get(id);
const ANCHOR_SELECTOR = ".App-toolbar .App-toolbar__extra-tools-trigger";
const sourceKey = (s: { sourceId: string; version: number }) => `${s.sourceId}@${s.version}`;

/** The toolbar toggle; the view itself only mounts while open. */
export function NotesViewHost(env: Env) {
  const slot = useToolbarSlot(ANCHOR_SELECTOR);
  const { open } = useNotesView(env.home.canvasId);
  return (
    <>
      {createPortal(
        <>
          <div className="App-toolbar__divider" aria-hidden="true" />
          <div className="acute-visualize-tool">
            <button
              type="button"
              className="acute-visualize-tool__button"
              title={open ? "Back to the canvas (Esc)" : "Notes — read this canvas's cards as a document"}
              aria-pressed={open}
              data-testid="toolbar-acute-notes"
              onClick={() => notesView.toggle(env.home.canvasId)}
            >
              {open ? "Canvas" : "Notes"}
            </button>
          </div>
        </>,
        slot,
      )}
      {open && <NotesView {...env} />}
    </>
  );
}

function NotesView({ api, home, history }: Env) {
  const canvasId = home.canvasId;
  const env = useMemo(() => ({ api, home, history }), [api, home, history]);
  const ui = useKnowledgeUI(canvasId);
  const { objects, sceneVersion } = useKnowledgeObjects(api, ui.revision);
  const { focus } = useNotesView(canvasId);
  const [mode, setMode] = useState<"read" | "study">("read");
  const [quizOnly, setQuizOnly] = useState<ReadonlySet<string> | null>(null);
  const [query, setQuery] = useState("");
  const aiMode = useAIMode();

  const sections = useMemo<NoteSection[]>(() => {
    void sceneVersion;
    return buildNotes(api.getSceneElements() as unknown as readonly SceneElement[], getDocument, objects);
  }, [api, objects, sceneVersion]);
  const allNotes = useMemo(() => sections.flatMap((s) => s.notes), [sections]);

  // Study history (study-mode plan Phase 3): loaded while Study is open, for this canvas's sources and local concepts.
  const workspaceId = home.workspaceId;
  const [study, setStudy] = useState<Map<string, LoadedConcept>>(new Map());
  const [studyNow, setStudyNow] = useState(() => Date.now());
  const conceptOf = useCallback((n: Note) => conceptOfNote(n, canvasId), [canvasId]);
  const studySig = useMemo(() => allNotes.map((n) => `${conceptOf(n).key}|${n.needsReview ? 1 : 0}`).join(","), [allNotes, conceptOf]);
  const notesRef = useRef(allNotes);
  useEffect(() => {
    notesRef.current = allNotes;
  }, [allNotes]);
  useEffect(() => {
    if (mode !== "study") return;
    let cancelled = false;
    void (async () => {
      const p = getPersistence();
      const notes = notesRef.current;
      const onCanvas = (await p.contentSources.listByCanvas(canvasId)).map((s) => s.id);
      const shards = [...onCanvas, ...notes.flatMap((n) => (n.source ? [n.source.sourceId] : [])), localShardId(canvasId)];
      const now = Date.now();
      const loaded = await loadStudy(p.meta, workspaceId, { shards, sources: p.contentSources, now });
      if (cancelled) return;
      setStudy(loaded);
      setStudyNow(now);
      // The card-status snapshot (§7.4): whether each studied concept's card has an open review now.
      await snapshotCardStatus(p.meta, workspaceId, notes.map((n) => ({ concept: conceptOf(n), canvasId, open: !!n.needsReview, objectId: n.id })), now);
    })().catch((err: unknown) => console.error("[acute-notes] Couldn't load study history", err));
    return () => {
      cancelled = true;
    };
  }, [mode, canvasId, workspaceId, studySig, conceptOf]);
  // "Clear study history" (study-mode plan §2): every quiz answer and flashcard grade of this workspace on this device,
  // retired history included. Explicit and confirmed; the cards themselves are untouched.
  const clearStudyHistory = useCallback(() => {
    if (!window.confirm("Clear all study history for this workspace on this device? Quiz answers and flashcard grades are deleted; your cards are not. This can't be undone.")) return;
    void clearStudy(getPersistence().meta, workspaceId)
      .then(() => setStudy(new Map()))
      .catch((err: unknown) => console.error("[acute-notes] Couldn't clear study history", err));
  }, [workspaceId]);
  const recordStudy = useCallback(
    (note: Note, r: { kind: "quiz" | "flashcard"; correct: boolean }) => {
      const concept = conceptOf(note);
      const at = Date.now();
      void recordAttempt(getPersistence().meta, workspaceId, { concept, canvasId, title: note.title, kind: r.kind, correct: r.correct, unverified: !!note.needsReview, objectId: note.id, at })
        .then((record) => {
          setStudy((prev) => new Map(prev).set(concept.key, { key: concept.key, shardId: shardIdOf(concept, canvasId), record }));
          setStudyNow(at);
        })
        .catch((err: unknown) => console.error("[acute-notes] Couldn't record a study answer", err));
    },
    [canvasId, conceptOf, workspaceId],
  );

  // Each cited source version's unit texts, for expandable citations (and the Weak list's passages).
  const [units, setUnits] = useState<Map<string, Map<string, string>>>(new Map());
  const wanted = useMemo(
    () =>
      [
        ...new Set([
          ...allNotes.flatMap((n) => (n.source ? [sourceKey(n.source)] : [])),
          ...[...study.values()].flatMap((c) =>
            c.shardId.startsWith("local:") || c.record.sourceVersion === undefined ? [] : [sourceKey({ sourceId: c.shardId, version: c.record.sourceVersion })],
          ),
        ]),
      ]
        .sort()
        .join(","),
    [allNotes, study],
  );
  useEffect(() => {
    let cancelled = false;
    const keys = wanted ? wanted.split(",") : [];
    void Promise.all(
      keys.map(async (k) => {
        const at = k.lastIndexOf("@");
        const version = await getPersistence().contentSources.getVersion(k.slice(0, at), Number(k.slice(at + 1)));
        return [k, new Map((version?.units?.units ?? []).map((u) => [u.id, u.text] as const))] as const;
      }),
    ).then((entries) => !cancelled && setUnits(new Map(entries)));
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  // Generation: the canvas's newest stored source that has units.
  const [genSource, setGenSource] = useState<GenSource | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repo = getPersistence().contentSources;
      const sources = (await repo.listByCanvas(canvasId)).sort((a, b) => b.updatedAt - a.updatedAt);
      for (const s of sources) {
        const latest = await loadLatest(repo, s.id);
        const list = latest?.version.units?.units;
        if (latest && list?.length) {
          if (!cancelled) setGenSource({ sourceId: s.id, version: latest.version.version, units: new Map(list.map((u) => [u.id, u.text] as const)), list: [...list] });
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasId]);
  const { gen, pinned: pinnedAll } = useGeneration(canvasId);
  // A pin whose card is gone (removed by Undo, or deleted) offers Pin to canvas again, not a dead Show on canvas.
  const pinned = useMemo(() => new Map([...pinnedAll].filter(([, id]) => allNotes.some((n) => n.id === id))), [pinnedAll, allNotes]);
  const generate = useCallback(async () => {
    if (!genSource) return;
    const { signal, current } = generations.start(canvasId);
    const base = { cards: new Map<string, GeneratedCard>(), source: genSource };
    let blocks: string[] = [];
    generations.setGen(canvasId, { status: "running", blocks, ...base });
    try {
      const input = notesInputOf(annotateUnits(genSource.list));
      const result = await generateOpenUiNotes(AIRuntime, input, {
        signal,
        onUpdate: (u) => {
          blocks = u.blocks;
          if (current()) generations.setGen(canvasId, { status: "running", blocks, ...base });
        },
      });
      // The free fidelity check (no model): the same deterministic checks distil Visualize runs, on the units sent.
      const check = checkGeneratedCards(result.cards, genSource.list, new Set(input.units.map((u) => u.id)));
      if (current()) generations.setGen(canvasId, { status: "done", blocks, cards: new Map(result.cards.map((c) => [c.key, c])), source: genSource, dropped: result.dropped, check });
    } catch (err) {
      if (current()) generations.setGen(canvasId, { status: "error", message: err instanceof Error ? err.message : "Couldn't generate notes." });
    }
  }, [canvasId, genSource]);

  const close = useCallback(() => notesView.close(canvasId), [canvasId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape in a field with text clears or leaves that field first (an input, a textarea, rich text).
      const t = e.target;
      if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && t.value) return;
      if (t instanceof HTMLElement && t.isContentEditable && t.textContent) return;
      // A dialog or menu over the Notes view (opened from the header) handles its own Escape.
      if (e.target instanceof Element && e.target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
      close();
    };
    // Capture phase: while Notes covers the canvas, Escape is Notes' own. A canvas card left in edit mode
    // must not take it first (found by openuiNotesFlow.local.spec.ts, 2026-11-15).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  // Cross-note navigation: scroll to the note and flash it.
  const scroller = useRef<HTMLDivElement>(null);
  const goTo = useCallback((noteId: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-note-anchor="${CSS.escape(noteId)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.remove("acute-notes__note--flash");
    void el.offsetWidth;
    el.classList.add("acute-notes__note--flash");
  }, []);
  useEffect(() => {
    if (focus) requestAnimationFrame(() => goTo(focus.noteId));
  }, [focus, goTo]);

  const titles = useMemo(() => new Map(allNotes.map((n) => [n.id, n.title] as const)), [allNotes]);
  const hostFor = useCallback(
    (note: Note): NotesHost => ({
      noteId: note.id,
      ...(note.source ? { unitText: (u: string) => units.get(sourceKey(note.source!))?.get(u) } : {}),
      ...(note.cites.length && note.source
        ? {
            openSource: (us: readonly string[]) => {
              close();
              openSourceOn(env, note.id, us);
            },
          }
        : {}),
      pin: {
        label: "Show on canvas",
        run: () => {
          close();
          showObjects(api, [note.id], true);
        },
      },
      navigate: goTo,
      noteTitle: (id: string) => titles.get(id),
    }),
    [api, close, env, goTo, titles, units],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? sections.map((s) => ({ ...s, notes: s.notes.filter((n) => `${s.title}\n${n.title}\n${n.body}\n${n.detail ?? ""}`.toLowerCase().includes(q)) })).filter((s) => s.notes.length)
        : sections,
    [q, sections],
  );
  const studyNotes = useMemo<StudyNote[]>(() => allNotes.map(studyNoteOf), [allNotes]);
  const shown = visible.reduce((n, s) => n + s.notes.length, 0);

  return (
    <div className="acute-notes" role="region" aria-label="Notes view" data-testid="acute-notes-view">
      <header className="acute-notes__header">
        <div className="acute-notes__heading">
          <h2>Notes</h2>
          <span className="acute-notes__count">
            {q ? `${shown} of ${allNotes.length}` : allNotes.length} {allNotes.length === 1 ? "note" : "notes"} · {sections.length} {sections.length === 1 ? "section" : "sections"}
          </span>
        </div>
        <div className="acute-notes__controls">
          <input className="acute-notes__search" type="search" placeholder="Filter notes" aria-label="Filter notes" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="acute-notes__modes" role="group" aria-label="Mode">
            <button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")}>
              Read
            </button>
            <button type="button" aria-pressed={mode === "study"} onClick={() => setMode("study")}>
              Study
            </button>
          </div>
          {aiMode === "on" && (
            <button
              type="button"
              className="acute-notes__generate"
              disabled={!genSource || gen.status === "running"}
              title={genSource ? "Distil this canvas's latest source into idea cards (one AI call)" : "No stored source with passages on this canvas"}
              onClick={() => void generate()}
            >
              {gen.status === "running" ? "Generating…" : "Generate from source"}
            </button>
          )}
          <button type="button" className="acute-notes__close" onClick={close} title="Back to the canvas (Esc)">
            Canvas
          </button>
        </div>
      </header>

      <div className="acute-notes__body">
        {mode === "read" && visible.length > 1 && (
          <nav className="acute-notes__toc" aria-label="Sections">
            {visible.map((s) => (
              <button key={s.id || "loose"} type="button" onClick={() => s.notes[0] && goTo(s.notes[0].id)}>
                <span>{s.title}</span>
                <span className="acute-notes__toc-count">{s.notes.length}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="acute-notes__scroll" ref={scroller}>
          {gen.status !== "idle" && <GeneratedNotes gen={gen} env={env} pinned={pinned} onPinned={(k, id) => generations.pin(canvasId, k, id)} goTo={goTo} titles={titles} sourceOnCanvas={"source" in gen && objects.some((o) => o.sourceId === gen.source.sourceId)} />}

          {allNotes.length === 0 ? (
            <p className="acute-notes__empty">This canvas has no text cards yet. Notes shows the cards Visualize or you add, as a document.</p>
          ) : mode === "read" ? (
            visible.map((s) => (
              <section key={s.id || "loose"} className="acute-notes__section">
                <h3 className="acute-notes__section-title">{s.title}</h3>
                {s.notes.map((n) => (
                  <div key={n.id} className="acute-notes__note" data-note-anchor={n.id}>
                    <NoteCard lang={noteLang(n)} host={hostFor(n)} />
                  </div>
                ))}
              </section>
            ))
          ) : (
            <StudyCards
              notes={studyNotes}
              hostFor={(id) => {
                const n = allNotes.find((x) => x.id === id)!;
                return { ...hostFor(n), pin: undefined, recordStudy: (r) => recordStudy(n, r) };
              }}
              filter={q}
              badgesOf={(id) => {
                const n = allNotes.find((x) => x.id === id)!;
                const rec = study.get(conceptOf(n).key)?.record;
                if (!rec) return [];
                return [
                  ...(isWeak(rec) ? ["Weak"] : []),
                  ...(rec.state === "source_changed" ? ["Source changed since you studied this"] : []),
                  // The card's own open review is the mark below the card; this is the concept's (lineage) state.
                  ...(rec.state === "needs_review" && !n.needsReview ? ["Needs review"] : []),
                ];
              }}
              weak={
                <WeakConcepts
                  study={study}
                  cards={allNotes.map((n): StudyCardRef => ({ id: n.id, title: n.title, conceptKey: conceptOf(n).key, cites: n.source ? n.cites : [], ...(n.needsReview ? { needsReview: n.needsReview } : {}) }))}
                  now={studyNow}
                  unitText={(sourceId, version, u) => units.get(sourceKey({ sourceId, version }))?.get(u)}
                  openSource={(id, us) => {
                    close();
                    openSourceOn(env, id, us);
                  }}
                  showCiting={(sourceId, us) => {
                    close();
                    outlineCiting(env, sourceId, us);
                  }}
                  quizOn={(ids) => setQuizOnly(new Set(ids))}
                  clearHistory={clearStudyHistory}
                />
              }
              quizOnly={quizOnly}
              clearQuizOnly={() => setQuizOnly(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** One card: the library rendering `lang`, with what the host offers it. */
function NoteCard({ lang, host, streaming }: { lang: string; host: NotesHost; streaming?: boolean }) {
  return (
    <NotesHostProvider value={host}>
      <OpenUiCardRenderer response={lang} isStreaming={streaming} />
    </NotesHostProvider>
  );
}

function GeneratedNotes({
  gen,
  env,
  pinned,
  onPinned,
  goTo,
  titles,
  sourceOnCanvas,
}: {
  gen: Exclude<Generation, { status: "idle" }>;
  env: Env;
  pinned: ReadonlyMap<string, string>;
  onPinned(key: string, objectId: string): void;
  goTo(id: string): void;
  titles: Map<string, string>;
  /** A canvas card of the run's source exists, so Open in source has somewhere to open (else it isn't offered). */
  sourceOnCanvas: boolean;
}) {
  const [pinning, setPinning] = useState<string | null>(null);
  if (gen.status === "error") {
    return (
      <section className="acute-notes__section acute-notes__generated" data-status="error">
        <p role="alert" className="acute-notes__error">
          {gen.message}
        </p>
      </section>
    );
  }
  const running = gen.status === "running";
  return (
    <section className="acute-notes__section acute-notes__generated" aria-busy={running ? "true" : "false"} data-status={gen.status}>
      <h3 className="acute-notes__section-title">
        Generated from source <span className="acute-notes__badge">{running ? "streaming" : "preview — not on the canvas until pinned"}</span>
      </h3>
      {gen.status === "done" && gen.check && (
        <p className="acute-notes__check" data-tone={gen.check.cardsNeedingReview || gen.check.unitsNotCovered ? "warning" : "ok"} data-testid="acute-notes-check">
          {gen.check.cardsNeedingReview
            ? `${gen.check.cardsNeedingReview} of ${gen.cards.size} cards need review`
            : "No card flagged by the source checks"}
          {` · ${gen.check.units - gen.check.unitsNotCovered} of ${gen.check.units} passages covered`}
          {gen.check.detailsMissing ? ` · ${gen.check.detailsMissing} exact details missing` : ""}
          <span className="acute-notes__check-note">{" Checked against the source by rules, not by AI: a card that passes isn't proven correct."}</span>
        </p>
      )}
      {gen.blocks.map((lang, i) => {
        const key = `g${i + 1}`;
        const card = gen.cards.get(key);
        const objectId = pinned.get(key);
        const review = gen.status === "done" ? gen.check?.reviews[key] : undefined;
        const flagged = !!review?.reasons.length;
        const host: NotesHost = {
          noteId: key,
          unitText: (u) => gen.source.units.get(u),
          navigate: goTo,
          noteTitle: (id) => titles.get(id),
          // Open in source, as canvas notes have it: through the canvas card of the same source (2026-11-15).
          ...(sourceOnCanvas
            ? {
                openSource: (us: readonly string[]) => {
                  if (openSourceForUnits(env, gen.source.sourceId, us)) notesView.close(env.home.canvasId);
                },
              }
            : {}),
          ...(card
            ? {
                pin: objectId
                  ? { label: "Show on canvas", run: () => (notesView.close(env.home.canvasId), showObjects(env.api, [objectId], true)) }
                  : {
                      label: pinning === key ? "Pinning…" : flagged ? "Pin (needs review)" : "Pin to canvas",
                      done: pinning !== null,
                      run: () => {
                        setPinning(key);
                        void promoteNote(env, { key, generationId: generations.get(env.home.canvasId).generationId, title: card.title, body: card.body, ...(card.detail ? { detail: card.detail } : {}), cites: card.cites, source: { sourceId: gen.source.sourceId, version: gen.source.version }, ...(review ? { review } : {}) })
                          .then((id) => id && onPinned(key, id))
                          .finally(() => setPinning(null));
                      },
                    },
              }
            : {}),
        };
        return (
          <div key={key} className="acute-notes__note" data-note-anchor={key}>
            <NoteCard lang={lang} host={host} streaming={running && i === gen.blocks.length - 1} />
            {flagged && (
              <div className="acute-notes__review" role="note" data-testid="acute-notes-card-review">
                <strong>Needs review</strong>
                <ul>
                  {review!.reasons.slice(0, 3).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                  {review!.reasons.length > 3 && <li>{`and ${review!.reasons.length - 3} more`}</li>}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      {gen.status === "done" && gen.dropped ? <p className="acute-notes__hint">{`${gen.dropped} block(s) weren't idea cards and can't be pinned.`}</p> : null}
    </section>
  );
}

function StudyCards({
  notes,
  hostFor,
  filter,
  badgesOf,
  weak,
  quizOnly,
  clearQuizOnly,
}: {
  notes: StudyNote[];
  hostFor(id: string): NotesHost;
  filter: string;
  /** The study badges of a card ("Weak", "Source changed since you studied this", "Needs review"). */
  badgesOf(id: string): string[];
  /** The Weak list, shown by the third toggle. */
  weak: ReactNode;
  /** "Quiz me on these": the quiz limited to these cards until another toggle or "Show all". */
  quizOnly: ReadonlySet<string> | null;
  clearQuizOnly(): void;
}) {
  const [kind, setKind] = useState<"flashcards" | "quiz" | "weak">("flashcards");
  const [shownFor, setShownFor] = useState(quizOnly);
  if (quizOnly !== shownFor) {
    // A new "Quiz me on these" switches to the quiz (state adjusted during render, not in an effect).
    setShownFor(quizOnly);
    if (quizOnly) setKind("quiz");
  }
  const choose = (k: "flashcards" | "quiz" | "weak") => {
    setKind(k);
    clearQuizOnly();
  };
  const filtered = filter ? notes.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(filter)) : notes;
  const list = kind === "quiz" && quizOnly ? filtered.filter((n) => quizOnly.has(n.id)) : filtered;
  return (
    <section className="acute-notes__section">
      <div className="acute-notes__modes acute-notes__modes--small" role="group" aria-label="Study mode">
        <button type="button" aria-pressed={kind === "flashcards"} onClick={() => choose("flashcards")}>
          Flashcards
        </button>
        <button type="button" aria-pressed={kind === "quiz"} onClick={() => choose("quiz")}>
          Quiz
        </button>
        <button type="button" aria-pressed={kind === "weak"} onClick={() => choose("weak")}>
          Weak
        </button>
      </div>
      {kind === "weak" ? (
        weak
      ) : (
        <>
          {kind === "quiz" && quizOnly && (
            <p className="acute-notes__hint">
              {`Quizzing ${list.length} weak ${list.length === 1 ? "card" : "cards"} · `}
              <button type="button" className="openui-quiz__retry" onClick={clearQuizOnly}>
                Show all
              </button>
            </p>
          )}
          <div className="acute-notes__study-grid">
            {list.map((n) => {
              const lang = kind === "flashcards" ? flashcardLang(n) : quizLang(notes, notes.indexOf(n));
              const badges = badgesOf(n.id);
              return lang ? (
                <div key={`${kind}-${n.id}`} className="acute-notes__note" data-note-anchor={n.id}>
                  {badges.length > 0 && (
                    <div className="acute-notes__study-badges" data-testid="acute-notes-study-badges">
                      {badges.map((b) => (
                        <span key={b} className="acute-notes__badge">
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                  <NoteCard lang={lang} host={hostFor(n.id)} />
                  {n.needsReview && (
                    // Study-mode plan §7 / issue A: a study card inherits its source card's open review, visibly.
                    <div className="acute-notes__review" role="note" data-testid="acute-notes-study-review">
                      <strong>Needs review</strong> {n.needsReview}
                    </div>
                  )}
                </div>
              ) : null;
            })}
          </div>
          {kind === "quiz" && notes.length < 2 && <p className="acute-notes__hint">A quiz needs at least two notes.</p>}
        </>
      )}
    </section>
  );
}
