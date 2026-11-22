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
 *
 * The AI check (Stage 4f, Phase 1 pilot) appears only when the build offers it (`NEXT_PUBLIC_CONSISTENCY_AI_CHECK`): an
 * opt-in switch for this device, checks that run automatically after accepted changes (`autoCheckAI`; "Check now" for a pair left waiting), and every
 * queued pair's state (not checked yet, with why it waits; checked and shown; checked compatible; failed) and today's
 * budget. The AI's reading is shown on the record as evidence; only the user's decision changes a record.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCommitJournal } from "@/ai/changes/commit";
import { MAX_QUEUED, type AICheckRun, type AICheckStatus } from "@/ai/consistency/aiCheck";
import type { ConsistencyConflict } from "@/ai/consistency/store";
import { onCommitted, resumeCheckJobs } from "@/components/ai/commitOnCanvas";
import type { DocumentHome } from "@/domain/types";
import { showObjects } from "@/components/review/knowledgeActions";
import { isConsistencyAICheckUiEnabled } from "@/config/features";
import { useIndexState } from "@/search/liveIndex";
import { getDocumentStore } from "@/state/documents";
import { autoCheckAI, checkRevision, decideConflict, getAICheckModel, getAICheckOptIn, getAICheckStatus, getConsistencyStore, onAutoAICheck, proposeFix, recheckOpen, runAICheckNow, setAICheckOptIn } from "./consistencyRunner";

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
          // The AI check (opted in) runs on its own once the change has queued its pairs: no press needed.
          void autoCheckAI(api, home).finally(() => setTick((t) => t + 1));
        } finally {
          setTick((t) => t + 1);
        }
      }),
    [api, home],
  );
  // An automatic AI check's result is said in the panel (an answer or a failure; "nothing waiting" isn't news).
  useEffect(
    () =>
      onAutoAICheck((canvasId, run) => {
        if (canvasId !== home.canvasId) return;
        if (run.status === "answered" || run.status === "call_error") setMessage(runMessage(run));
        setTick((t) => t + 1);
      }),
    [home.canvasId],
  );
  // Pairs queued while the check couldn't run (no connection yet, budget spent): picked up when the panel opens.
  useEffect(() => {
    if (open && isConsistencyAICheckUiEnabled()) void autoCheckAI(api, home).finally(() => setTick((t) => t + 1));
  }, [open, api, home]);
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

  // The AI check (pilot): only read when the build offers it.
  const aiOffered = isConsistencyAICheckUiEnabled();
  const [ai, setAI] = useState<AIState>({ optedIn: false, connection: false, model: null, status: null });
  useEffect(() => {
    if (!aiOffered) return;
    let live = true;
    void (async () => {
      const optedIn = await getAICheckOptIn();
      const [model, status] = optedIn ? await Promise.all([getAICheckModel(), getAICheckStatus(home)]) : [null, null];
      if (live) setAI({ optedIn, connection: !!model, model, status });
    })();
    return () => {
      live = false;
    };
  }, [aiOffered, home, tick, open, conflicts.length]);

  const possible = conflicts.filter((c) => c.status === "possible");
  const confirmed = conflicts.filter((c) => c.status === "confirmed");
  const deferred = conflicts.filter((c) => c.status === "deferred");
  const visible = possible.length + confirmed.length;
  const aiWaiting = ai.status ? ai.status.notChecked + ai.status.failed : 0;
  if (!visible && !jobs.failed && !jobs.running && !open && !aiOffered) return <ConsistencyMarkers api={api} conflicts={[]} />;

  const focus = (elementId: string) => showObjects(api, [elementId]);
  const chip = [
    possible.length ? `⚠ ${possible.length} possible ${possible.length === 1 ? "conflict" : "conflicts"}` : "",
    confirmed.length ? `${confirmed.length} confirmed` : "",
    jobs.running ? "checking…" : "",
    jobs.failed ? `${jobs.failed} ${jobs.failed === 1 ? "check" : "checks"} couldn't run` : "",
    ai.optedIn && aiWaiting ? `${aiWaiting} to check with AI` : "",
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
          {aiOffered && (
            <AICheckSection
              home={home}
              api={api}
              state={ai}
              onOptIn={(on) => setAI((x) => ({ ...x, optedIn: on }))}
              onChanged={(m) => {
                if (m !== undefined) setMessage(m);
                setTick((t) => t + 1);
              }}
            />
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
              {labelOf(c)}
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
            {c.ai && (
              <p className="acute-review__note" data-ai-answer={c.ai.answer}>
                {c.ai.note}
              </p>
            )}
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

/** How sure the record is, in words: the rules', the AI check's (evidence only), or the user's. */
export function labelOf(c: Pick<ConsistencyConflict, "status" | "strength" | "ai">): string {
  if (c.status === "confirmed") return "Confirmed conflict";
  if (c.strength === "conflict") return "Rule: can't both be true";
  if (c.ai?.shown === "likely") return "AI: likely conflict (your call)";
  if (c.ai?.shown === "hidden") return "Possible: AI reads them as compatible (your call)";
  // The AI read a contradiction the guards hold back (different times or scopes, too little said, nothing saying only
  // one can hold): still a real lead, never "couldn't settle" (pilot review D2).
  if (c.ai?.answer === "contradicts") return "Possible: AI reads a conflict, held back for you to judge (your call)";
  if (c.ai) return "Possible: the AI check couldn't tell (your call)";
  return "Possible — needs a look (not checked by AI)";
}

type AIState = { optedIn: boolean; connection: boolean; model: string | null; status: AICheckStatus | null };

/** The one model the pilot measured (unseen5, 2026-11-15). Others work, but are outside the pilot's evidence. */
export const isMeasuredModel = (model: string) => /(^|\/)gpt-oss-120b$/i.test(model.trim());

/** The pilot's precision signal, in words (pilot review condition 5). Empty when the AI check has shown nothing yet. */
export function pilotText(p: AICheckStatus["pilot"]): string {
  const part = (b: AICheckStatus["pilot"]["likely"]) => `${b.confirmed} confirmed · ${b.dismissed} dismissed · ${b.open} open`;
  const any = (b: AICheckStatus["pilot"]["likely"]) => b.confirmed + b.dismissed + b.open > 0;
  if (!any(p.likely) && !any(p.possible)) return "";
  return `Pilot feedback — AI “likely”: ${part(p.likely)}; AI “possible”: ${part(p.possible)}.`;
}

const RUN_TEXT: Partial<Record<AICheckRun["status"], string>> = {
  no_connection: "The AI check needs your primary AI connection to be a chat-completions connection with its own API key and a model.",
  nothing_queued: "Nothing waiting for the AI check.",
  nothing_to_send: "Nothing could be sent now (see why each pair waits).",
  no_output_cap: "Not sent: this connection can't limit the answer's length.",
  no_single_attempt: "Not sent: this connection may retry a request on its own.",
  ai_off: "The AI check is off.",
  server_off: "Not sent: the AI check is switched off on this server. Nothing was used from today's budget.",
};

/** The backlog, each figure on its own: pairs, checks, days (typical / worst case), and how long the oldest has waited. */
export function backlogText(b: AICheckStatus["backlog"], now = Date.now()): string {
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  const span = b.budgetDays.typical === b.budgetDays.worstCase ? days(b.budgetDays.typical) : `${days(b.budgetDays.typical)} (at most ${days(b.budgetDays.worstCase)})`;
  const age = b.oldestPendingAt === null ? "" : ` Oldest waiting ${ageText(now - b.oldestPendingAt)}.`;
  return `Waiting: ${b.pendingPairs} ${b.pendingPairs === 1 ? "pair" : "pairs"} · ${b.requiredCalls} ${b.requiredCalls === 1 ? "check" : "checks"} of up to 10 · within today's and later days' limits: ${span}.${age}`;
}

function ageText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** The text shown after a manual check. */
export function runMessage(r: AICheckRun): string {
  if (r.status === "answered") return `AI check: ${r.classified} of ${r.sent} pairs answered${r.failed ? `, ${r.failed} failed` : ""}. Its readings are shown on the records; nothing was changed.`;
  if (r.status === "call_error") return `AI check failed (${r.error ?? "no reply"}). The pairs wait for another try.`;
  return RUN_TEXT[r.status] ?? `AI check: ${r.status}`;
}

/** The AI check's controls and state (see module doc). */
function AICheckSection(props: { api: ExcalidrawImperativeAPI; home: DocumentHome; state: AIState; onOptIn: (on: boolean) => void; onChanged: (message?: string | null) => void }) {
  const { state } = props;
  const [busy, setBusy] = useState(false);
  const s = state.status;
  const toggle = async (on: boolean) => {
    // Shown at once; the stored switch follows (the status reloads after it).
    props.onOptIn(on);
    await setAICheckOptIn(on);
    props.onChanged(on ? "AI check on for this device. New changes are checked automatically after you accept them." : "AI check off. Nothing is queued or sent.");
    if (on) void autoCheckAI(props.api, props.home).finally(() => props.onChanged());
  };
  const run = async () => {
    setBusy(true);
    try {
      props.onChanged(runMessage(await runAICheckNow(props.api, props.home)));
    } catch (err) {
      props.onChanged(`AI check failed (${err instanceof Error ? err.message : "error"}).`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="acute-consistency__ai" aria-label="AI check">
      <h3 className="acute-consistency__title">AI check (pilot)</h3>
      <label className="acute-review__note">
        <input type="checkbox" checked={state.optedIn} onChange={(e) => void toggle(e.target.checked)} /> Use AI to check possible conflicts on this device. After you accept AI changes, statements from your cards are sent to your primary AI connection automatically (at most 10 pairs per request, within today&apos;s limit). It can miss conflicts; its answers are evidence for you, never a decision.
      </label>
      {state.optedIn && s && (
        <>
          <p className="acute-review__note" role="status">
            {s.notChecked} not checked yet · {s.checkedShown} checked, shown · {s.checkedCompatible} checked, read as compatible · {s.failed} failed
            {s.gaveUp ? ` · ${s.gaveUp} gave up` : ""}
            {s.inFlight ? ` · ${s.inFlight} in progress` : ""}
          </p>
          {s.waiting.map((w) => (
            <p key={w.reason} className="acute-review__note">
              {w.count} waiting: {w.text}
            </p>
          ))}
          <p className="acute-review__note">
            Today: {s.budget.callsLeft} of {s.budget.dailyCalls} checks, {s.budget.tokensLeft.toLocaleString()} of {s.budget.dailyTokens.toLocaleString()} tokens left.
          </p>
          {s.backlog.pendingPairs > 0 && <p className="acute-review__note">{backlogText(s.backlog)}</p>}
          {s.droppedPairs > 0 && (
            <p className="acute-review__note">
              {s.droppedPairs} older {s.droppedPairs === 1 ? "pair was" : "pairs were"} dropped unchecked: the queue holds at most {MAX_QUEUED}.
            </p>
          )}
          {pilotText(s.pilot) && <p className="acute-review__note">{pilotText(s.pilot)}</p>}
          {state.model && !isMeasuredModel(state.model) && (
            <p className="acute-review__note">This pilot was measured with gpt-oss-120b only; answers from {state.model} are unmeasured.</p>
          )}
          {!state.connection && <p className="acute-review__note">{RUN_TEXT.no_connection}</p>}
          <button type="button" className="acute-ask-ai__secondary" disabled={busy || !state.connection || !(s.notChecked + s.failed)} onClick={() => void run()}>
            {busy ? "Checking…" : "Check now (up to 10 pairs)"}
          </button>
        </>
      )}
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

