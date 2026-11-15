"use client";

/**
 * Cross-card consistency on the canvas (intelligent-update-engine-plan Stage 4e, §12.4 with refinement C):
 * - registers the post-commit check (`checkRevision`), resumes checks that waited or failed when the index is fresh
 *   again (and when the canvas opens), and re-checks open records after manual edits, undo and redo;
 * - a chip with what is open ("⚠ 2 possible conflicts", "1 confirmed"), and checks waiting or failed (with Retry);
 * - the Consistency panel: both statements side by side, both cards (focusable), the reason, how sure the rules are, and
 *   the user's decision — It's a conflict / Not a conflict / Later. A confirmed value conflict can propose a fix, through
 *   the normal review. Nothing here edits a card;
 * - a ⚠ marker on each card in a possible or confirmed conflict.
 * A *possible* conflict and a *confirmed* one look different everywhere.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCommitJournal } from "@/ai/changes/commit";
import type { ConsistencyConflict } from "@/ai/consistency/store";
import { onCommitted, resumeCheckJobs } from "@/components/ai/commitOnCanvas";
import type { DocumentHome } from "@/domain/types";
import { showObjects } from "@/components/review/knowledgeActions";
import { useIndexState } from "@/search/liveIndex";
import { getDocumentStore } from "@/state/documents";
import { checkRevision, decideConflict, getConsistencyStore, proposeFix, recheckOpen } from "./consistencyRunner";

const RECHECK_MS = 800;

function useConflicts(canvasId: string): ConsistencyConflict[] {
  const s = getConsistencyStore();
  const [, bump] = useState(0);
  useEffect(() => {
    void s.load(canvasId).then(() => bump((v) => v + 1));
    return s.subscribe(() => bump((v) => v + 1));
  }, [s, canvasId]);
  return s.list(canvasId, ["possible", "confirmed", "deferred"]);
}

/** Jobs of this canvas still to run, and failed ones (from the commit journal), re-read on every render tick. */
function useJobs(canvasId: string, tick: number) {
  void tick;
  const all = getCommitJournal().list(canvasId);
  return {
    running: all.filter((r) => r.check.status === "pending" || r.check.status === "waiting_for_index").length,
    failed: all.filter((r) => r.check.status === "failed").length,
  };
}

export function ConsistencyPanel({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const conflicts = useConflicts(home.canvasId);
  const jobs = useJobs(home.canvasId, tick);
  const index = useIndexState(home.workspaceId, home.canvasId);
  // The jobs' state (checking…, failed) follows the commit journal.
  useEffect(() => getCommitJournal().subscribe(() => setTick((t) => t + 1)), []);

  // The post-commit check for this canvas.
  useEffect(
    () =>
      onCommitted(async (revision, at) => {
        if (at.canvasId !== home.canvasId) return;
        try {
          await checkRevision(api, home, revision);
        } finally {
          setTick((t) => t + 1);
        }
      }),
    [api, home],
  );
  // Waiting or failed checks: resumed when the canvas opens and whenever its index is fresh again.
  useEffect(() => {
    if (index.state !== "fresh") return;
    void resumeCheckJobs(home).then(() => setTick((t) => t + 1));
  }, [home, index.state]);
  // Manual edits, undo, redo: the open records are re-checked (no new ones in v1).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last: readonly unknown[] | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void recheckOpen(api, home), RECHECK_MS);
    };
    const off = api.onChange((elements) => {
      if (elements === last) return;
      last = elements;
      schedule();
    });
    // A block's or page's text lives in its document: an edit there changes no element.
    const offBlocks = getDocumentStore().subscribeKind("block", schedule);
    const offPages = getDocumentStore().subscribeKind("page", schedule);
    return () => {
      off();
      offBlocks();
      offPages();
      if (timer) clearTimeout(timer);
    };
  }, [api, home]);

  const possible = conflicts.filter((c) => c.status === "possible");
  const confirmed = conflicts.filter((c) => c.status === "confirmed");
  const deferred = conflicts.filter((c) => c.status === "deferred");
  const visible = possible.length + confirmed.length;
  if (!visible && !jobs.failed && !jobs.running && !open) return <ConsistencyMarkers api={api} conflicts={[]} />;

  const focus = (elementId: string) => showObjects(api, [elementId]);
  const chip = [
    possible.length ? `⚠ ${possible.length} possible ${possible.length === 1 ? "conflict" : "conflicts"}` : "",
    confirmed.length ? `${confirmed.length} confirmed` : "",
    jobs.running ? "checking…" : "",
    jobs.failed ? `${jobs.failed} ${jobs.failed === 1 ? "check" : "checks"} couldn't run` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <ConsistencyMarkers api={api} conflicts={[...possible, ...confirmed]} />
      <button type="button" className="acute-consistency-chip" aria-expanded={open} aria-controls="acute-consistency-panel" onClick={() => setOpen((o) => !o)}>
        {chip || "Consistency"}
      </button>
      {open && (
        <section id="acute-consistency-panel" className="acute-consistency" aria-label="Consistency">
          <header className="acute-consistency__head">
            <strong>Consistency</strong>
            <span className="acute-review__note">Cards that may disagree. Nothing is changed unless you choose to.</span>
            <button type="button" className="acute-ask-ai__secondary" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>
          {jobs.failed > 0 && (
            <p className="acute-consistency__jobs" role="status">
              {jobs.failed} {jobs.failed === 1 ? "check" : "checks"} couldn&apos;t run.{" "}
              <button type="button" className="acute-ask-ai__link" onClick={() => void resumeCheckJobs(home, { force: true }).then(() => setTick((t) => t + 1))}>
                Retry
              </button>
            </p>
          )}
          {message && (
            <p className="acute-consistency__jobs" role="status">
              {message}
            </p>
          )}
          {!visible && !deferred.length && <p className="acute-review__note">No possible conflicts on this canvas.</p>}
          <ConflictList title="To review" items={possible} api={api} home={home} focus={focus} onMessage={setMessage} />
          <ConflictList title="Confirmed" items={confirmed} api={api} home={home} focus={focus} onMessage={setMessage} />
          {deferred.length > 0 && <p className="acute-review__note">{deferred.length} deferred: back when either card changes.</p>}
        </section>
      )}
    </>
  );
}

function ConflictList(props: { title: string; items: readonly ConsistencyConflict[]; api: ExcalidrawImperativeAPI; home: DocumentHome; focus: (id: string) => void; onMessage: (m: string | null) => void }) {
  const { items, api, home, focus } = props;
  if (!items.length) return null;
  return (
    <div>
      <h3 className="acute-consistency__title">{props.title}</h3>
      <ul className="acute-consistency__list" aria-label={props.title}>
        {items.map((c) => (
          <li key={c.id} className="acute-consistency__item" data-status={c.status} data-strength={c.strength} aria-label={`${c.status === "confirmed" ? "Confirmed conflict" : "Possible conflict"}: ${c.a.cardName} / ${c.b.cardName}`}>
            <div className="acute-consistency__label">
              {c.status === "confirmed" ? "Confirmed conflict" : c.strength === "conflict" ? "Rule: can't both be true" : "Possible — needs a look (not checked by AI)"}
            </div>
            <div className="acute-review__compare">
              {(["a", "b"] as const).map((k) => (
                <div key={k}>
                  <button type="button" className="acute-ask-ai__link" onClick={() => focus(c[k].elementId)}>
                    {c[k].cardName}
                  </button>
                  <pre aria-label={`Statement ${k === "a" ? 1 : 2}`}>{c[k].sentence}</pre>
                </div>
              ))}
            </div>
            <p className="acute-review__note">{c.evidence.reason}</p>
            <div className="acute-review__conflict-actions">
              {c.status === "possible" && (
                <>
                  <button type="button" className="acute-ask-ai__secondary" onClick={() => decideConflict(api, home, c.id, "confirm")}>
                    It&apos;s a conflict
                  </button>
                  <button type="button" className="acute-ask-ai__secondary" onClick={() => decideConflict(api, home, c.id, "dismiss")}>
                    Not a conflict
                  </button>
                  <button type="button" className="acute-ask-ai__secondary" onClick={() => decideConflict(api, home, c.id, "defer")}>
                    Later
                  </button>
                </>
              )}
              {c.status === "confirmed" && c.kind === "differs" && (
                <>
                  {(["b", "a"] as const).map((k) => (
                    <button key={k} type="button" className="acute-ask-ai__secondary" onClick={() => props.onMessage(proposeFix(api, home, c, k))}>
                      Propose: make “{c[k].cardName}” agree
                    </button>
                  ))}
                </>
              )}
              {c.status === "confirmed" && (
                <button type="button" className="acute-ask-ai__secondary" onClick={() => decideConflict(api, home, c.id, "dismiss")}>
                  Not a conflict after all
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A ⚠ at the top-right of each card in a possible or confirmed conflict (the lock markers' layer and transform). */
function ConsistencyMarkers({ api, conflicts }: { api: ExcalidrawImperativeAPI; conflicts: readonly ConsistencyConflict[] }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  useLayoutEffect(() => {
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
      layer.style.setProperty("--acute-marker-zoom", String(s.zoom.value));
    };
    place(api.getAppState());
    const off = api.onChange((elements, appState) => {
      place(appState);
      if (elements === lastElements) return;
      lastElements = elements;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSceneVersion((v) => v + 1);
        });
    });
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api]);
  const marks = useMemo(() => {
    void sceneVersion;
    const status = new Map<string, "possible" | "confirmed">();
    for (const c of conflicts) for (const id of [c.a.elementId, c.b.elementId]) if (status.get(id) !== "confirmed") status.set(id, c.status === "confirmed" ? "confirmed" : "possible");
    return api.getSceneElements().flatMap((el) => (status.has(el.id) ? [{ id: el.id, x: el.x + el.width, y: el.y, status: status.get(el.id)! }] : []));
  }, [api, conflicts, sceneVersion]);
  return (
    <div className="acute-lock-markers" hidden={!marks.length}>
      <div ref={layerRef} className="acute-ai-markers__layer">
        {marks.map((m) => (
          <span
            key={m.id}
            className="acute-consistency-marker"
            data-element-id={m.id}
            data-status={m.status}
            style={{ left: m.x, top: m.y }}
            role="img"
            aria-label={m.status === "confirmed" ? "Confirmed conflict with another card" : "Possible conflict with another card"}
            title={m.status === "confirmed" ? "Confirmed conflict · see Consistency" : "May disagree with another card · see Consistency"}
          >
            ⚠
          </span>
        ))}
      </div>
    </div>
  );
}

