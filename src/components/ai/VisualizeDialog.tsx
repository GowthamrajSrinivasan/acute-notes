"use client";

/**
 * The `✨ Visualize` dialog (F31, PRD §6.4/§6.7): paste or review content,
 * optionally force a template, see where it's sent, and run the whole
 * Content-to-Canvas pipeline (F28–F30). Two visual modes:
 *
 * - **Form** (nothing running yet): an ordinary small modal — a paste box,
 *   template picker, and the data-destination line.
 * - **Running / error**: the modal closes and a small non-modal bar takes
 *   its place (the same look as F19's review bar), so the canvas stays fully
 *   interactive while analysis runs, exactly like every other AI request in
 *   the app. Accept/Reject of the resulting change set is F19's own
 *   `ChangeSetReview`; this component's job ends at proposing it.
 *
 * Opened with `updateSourceId` it is "Update from new content" (F39): the
 * same form, pre-filled with the source's latest text, reconciling against
 * the objects that source already has on the canvas instead of adding a
 * fresh copy.
 *
 * When the canvas already has notes (topic merge plan G2.2, behind
 * `isTopicMergeEnabled`), plain Visualize offers "Merge into existing notes"
 * — suggested by default, except for a selection's own content — which files
 * the new content under those notes' topics (`mergeIntoSource`) instead of
 * adding a separate copy. "Add as new notes" is the Visualize it always was.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { ChangeSetTooLargeError } from "@/ai/changes/sectionParts";
import { SparkleIcon } from "@/components/common/icons";
import { getDescriptor, getPrimaryId } from "@/ai/connections";
import type { AIConnectionAccessType } from "@/ai/providers/registry";
import { AIError } from "@/ai/errors";
import { AIRuntime } from "@/ai/runtime";
import { InvalidVisualPlanError } from "@/ai/visual-plan/validate";
import { ContentTooLargeError } from "@/ai/content/parser";
import { NoProviderConfiguredError, NothingToVisualizeLocallyError, ReadsFineAsTextError, type VisualizeProgress } from "@/ai/visualize/types";
import { ingestContent, prepareProposal, SourceUnavailableError, sceneSourceObjects, type IngestPorts } from "@/ai/ingest/ingest";
import { ECONOMY_LABEL, ECONOMY_NOTICE } from "./economyOption";
import { isTopicMergeEnabled } from "@/config/features";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { getUiPref } from "@/state/uiPrefs";
import { cleanupAIText } from "@/ai/content/cleanup";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import type { DocumentHome } from "@/domain/types";
import { openAISettings } from "./askAI";
import { SharedChatsPanel } from "./SharedChatsPanel";
import { TemplatePicker,type TemplateChoice } from "./TemplatePicker";
import { visualizeDialog, useVisualizeDialog } from "./visualizeStore";
import { chooseMergeTarget, findMergeTargets, type MergeTarget } from "./mergeTargets";

const ACCESS_LABEL: Record<AIConnectionAccessType, string> = { subscription: "your subscription", api_key: "your API key", local: "local" };

export interface ErrorInfo {
  message: string;
  /** Shown as a distinct action, not folded into `message`. */
  offerLocal: boolean;
  offerSettings: boolean;
  /** "Keep as text": the proposal AI made anyway, for "Visualize anyway" (no new AI call). */
  anyway?: ChangeSet;
}

/** How an AI failure of Visualize (and "Visualize better") is told to the user. */
export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof SourceUnavailableError) return { message: err.message, offerLocal: false, offerSettings: false };
  if (err instanceof ReadsFineAsTextError) return { message: err.message, offerLocal: false, offerSettings: false, anyway: err.changeSet };
  if (err instanceof NoProviderConfiguredError) return { message: err.message, offerLocal: err.canUseLocalTier, offerSettings: true };
  if (err instanceof NothingToVisualizeLocallyError) return { message: err.message, offerLocal: false, offerSettings: false };
  if (err instanceof ChangeSetTooLargeError) return { message: err.message, offerLocal: false, offerSettings: false };
  if (err instanceof ContentTooLargeError) return { message: err.message, offerLocal: false, offerSettings: false };
  if (err instanceof InvalidVisualPlanError) return { message: "The AI's plan couldn't be turned into anything usable. Try again, or choose a different template.", offerLocal: false, offerSettings: false };
  if (err instanceof AIError) {
    const offerSettings = ["auth", "model_unavailable", "quota_exhausted", "disabled"].includes(err.kind);
    const messages: Partial<Record<AIError["kind"], string>> = {
      auth: "Your AI connection needs to sign in again.",
      quota_exhausted: "Your AI plan's allowance is used up.",
      rate_limited: "The AI provider is rate limiting requests. Try again shortly.",
      model_unavailable: err.message,
      network: "Couldn't reach the AI provider. Check your connection.",
      timeout: "The AI provider took too long to respond.",
      invalid_output: "The AI's plan wasn't valid. Try again.",
      disabled: "AI is turned off.",
    };
    return { message: messages[err.kind] ?? err.message, offerLocal: false, offerSettings };
  }
  console.error("[acute-notes] Visualize failed", err);
  return { message: "Something went wrong. Nothing was changed.", offerLocal: false, offerSettings: false };
}

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export function VisualizeDialog({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const store = useVisualizeDialog();
  const [text, setText] = useState("");
  const [template, setTemplate] = useState<TemplateChoice>("auto");
  const [running, setRunning] = useState<VisualizeProgress | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  /** Notes on this canvas the content can be merged into (G2.2); null while looking, or when merge isn't offered. */
  const [targets, setTargets] = useState<MergeTarget[] | null>(null);
  const [mode, setMode] = useState<"merge" | "new">("new");
  const [targetId, setTargetId] = useState<string | null>(null);
  /** "Add new text as plain cards, no AI": per import, never remembered, off for every new open. */
  const [economy, setEconomy] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  /** The open request an auto-run (G3 "Use this option") last started for, so each starts once. */
  const autoRanSeq = useRef(-1);

  // A new open request: seed local state from the store and start fresh.
  const [shownSeq, setShownSeq] = useState(store.seq);
  if (store.open && store.seq !== shownSeq) {
    setShownSeq(store.seq);
    setText(store.text);
    setTemplate("auto");
    setRunning(null);
    setError(null);
    setTargets(null);
    setMode("new");
    setTargetId(null);
    setEconomy(false);
  }

  // Merge is offered when the canvas already has notes; suggested by default (D7), except for a selection's own content.
  useEffect(() => {
    if (!store.open || store.updateSourceId || !isTopicMergeEnabled()) return;
    let live = true;
    const elements = api.getSceneElements() as unknown as readonly SceneElement[];
    void findMergeTargets(getPersistence().contentSources, home.canvasId, elements, (id) => getDocumentStore().get(id)).then((found) => {
      if (!live || !found.length) return;
      setTargets(found);
      const pick = chooseMergeTarget(found, store.mergeSourceId, store.label);
      if (!pick) return;
      setTargetId(pick.targetId);
      setMode(pick.mode);
    });
    return () => {
      live = false;
    };
  }, [store.open, store.seq, store.updateSourceId, store.label, store.mergeSourceId, api, home.canvasId]);

  const close = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    visualizeDialog.close();
  };

  useEffect(() => {
    if (!store.open || running) return;
    formRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [store.open, running]);

  const updating = !!store.updateSourceId;
  const merging = !updating && mode === "merge" && !!targets?.length && !!targetId;

  /** The text as Visualize reads it: timestamps and citation numbers removed per AI settings → Clean pasted answers. */
  const cleanText = () => cleanupAIText(text, getUiPref("aiCleanup"));

  /** What the ingest service needs from this canvas (the same service the MCP import tools use). */
  const ports = (): IngestPorts => ({
    runtime: AIRuntime,
    contentSources: getPersistence().contentSources,
    renderContext: () => gatherRenderContext(api),
    sourceObjects: sceneSourceObjects(() => api.getSceneElements() as unknown as readonly SceneElement[], (id) => getDocumentStore().get(id)),
  });

  /** "Update from new content" (F39): reconcile the source's objects on this canvas with the new text. */
  const runUpdate = (sourceId: string, signal: AbortSignal) =>
    ingestContent({ mode: "update", sourceId, text: store.regenerate ? text : cleanText(), title: store.autoRun?.title ?? "Update from new content", ...(store.regenerate ? { regenerate: store.regenerate } : {}) }, ports(), { signal, onProgress: setRunning });

  /** "Merge into existing notes" (G2.2): file the new content under the target notes' topics. */
  const runMerge = (sourceId: string, signal: AbortSignal) =>
    ingestContent({ mode: "merge", sourceId, text: cleanText(), economy, title: "Merge into existing notes" }, ports(), { signal, onProgress: setRunning });

  const run = async (forceLocalOnly = false) => {
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setRunning({ stage: "parsing", label: "Parsing…" });
    /** Set once the run's own work is done: an error after that (the review refusing the change set) is this run's to show. */
    let finished = false;
    try {
      let notices: string[] = [];
      let changeSet: Awaited<ReturnType<typeof runUpdate>>["changeSet"];
      if (store.updateSourceId) ({ changeSet, notices } = await runUpdate(store.updateSourceId, controller.signal));
      else if (merging && !forceLocalOnly) ({ changeSet, notices } = await runMerge(targetId!, controller.signal));
      else {
        const result = await ingestContent(
          { mode: "new", text: cleanText(), template: template === "auto" ? undefined : template, forceLocalOnly, title: store.label ? `Visualize: ${store.label}` : "Visualize" },
          ports(),
          { signal: controller.signal, onProgress: setRunning },
        );
        changeSet = result.changeSet;
        notices = result.notices;
      }
      if (requestRef.current !== controller) return; // cancelled/superseded while awaiting
      requestRef.current = null;
      finished = true;
      if (changeSet) {
        // A long document can create more than one review holds: it is reviewed section by section (never truncated).
        const prepared = prepareProposal(changeSet, notices);
        notices = prepared.notices;
        getPendingChanges().propose(home.canvasId, prepared.proposal);
        // Where AI fell short (a section shown from its own structure), or a split was kept: said once, never silently.
        if (notices.length) api.setToast({ message: notices.join(" "), closable: true, duration: 10000 });
      } else if (notices.length) api.setToast({ message: notices.join(" "), closable: true, duration: 10000 });
      else api.setToast({ message: "Nothing changed — the canvas already matches this content.", duration: 4000 });
      visualizeDialog.close();
    } catch (err) {
      // Cancelled or superseded while awaiting: another run (or none) owns the bar. After the run finished, the error is still this run's —
      // returning here left "Comparing with the canvas…" on screen for good.
      if (!finished && requestRef.current !== controller) return;
      requestRef.current = null;
      // Cancelled mid-parse (the worker's AbortError) or mid-AI-call (the runtime's AIError "cancelled").
      if ((err instanceof DOMException && err.name === "AbortError") || (err instanceof AIError && err.kind === "cancelled")) {
        setRunning(null); // the user cancelled: back to the form, text kept
        return;
      }
      setRunning(null);
      setError(errorInfo(err));
    }
  };

  // An auto-run request starts at once, with the text it came with (no form). `run` is this render's, after seeding.
  useEffect(() => {
    if (!store.open || !store.autoRun || autoRanSeq.current === store.seq) return;
    autoRanSeq.current = store.seq;
    void run();
  });

  if (!store.open) return null;
  if (running || error) {
    return (
      <div className="acute-review" role="status" aria-label="Visualize">
        <SparkleIcon />
        {running ? (
          <>
            <span className="acute-review__summary">{running.label}</span>
            <span className="acute-review__actions">
              <button type="button" className="acute-ask-ai__secondary" onClick={() => requestRef.current?.abort()}>
                Cancel
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="acute-review__summary">{error!.message}</span>
            <span className="acute-review__actions">
              {error!.anyway && (
                <button
                  type="button"
                  className="acute-ask-ai__secondary"
                  onClick={() => {
                    getPendingChanges().propose(home.canvasId, error!.anyway!);
                    visualizeDialog.close();
                  }}
                >
                  Visualize anyway
                </button>
              )}
              {error!.offerLocal && (
                <button type="button" className="acute-ask-ai__secondary" onClick={() => void run(true)}>
                  Use local structure instead
                </button>
              )}
              {error!.offerSettings && (
                <button type="button" className="acute-ask-ai__secondary" onClick={openAISettings}>
                  AI Settings
                </button>
              )}
              <button type="button" className="acute-ask-ai__secondary" onClick={() => setError(null)}>
                Edit
              </button>
              <button type="button" className="acute-ask-ai__primary" onClick={close}>
                Dismiss
              </button>
            </span>
          </>
        )}
      </div>
    );
  }

  const primaryId = getPrimaryId();
  const descriptor = primaryId ? getDescriptor(primaryId) : undefined;

  return createPortal(
    <div className="acute-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={formRef} className="acute-dialog acute-visualize-dialog" role="dialog" aria-modal="true" aria-labelledby="acute-visualize-title">
        <h2 id="acute-visualize-title">
          <SparkleIcon /> {updating ? "Update from new content" : "Visualize"}
        </h2>
        {updating && (
          <p className="acute-visualize-dialog__destination">
            Edit or paste the new version. Only what changed is updated; anything you edited by hand is shown for your decision, never overwritten.
          </p>
        )}
        <textarea
          className="acute-visualize-dialog__text"
          placeholder="Paste Markdown, plain text, or an AI response…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
        />
        {!updating && <SharedChatsPanel onUse={setText} defaultOpen={!!store.mergeSourceId} />}
        {!updating && !!targets?.length && (
          <fieldset className="acute-visualize-dialog__mode">
            <legend className="acute-visualize-dialog__label">Where it goes</legend>
            <label className="acute-visualize-dialog__choice">
              <input type="radio" name="acute-visualize-mode" checked={mode === "merge"} onChange={() => setMode("merge")} />
              Merge into existing notes
              {targets.length === 1 && <span className="acute-visualize-dialog__target"> · {targets[0]!.label}</span>}
            </label>
            {mode === "merge" && targets.length > 1 && (
              <select className="acute-visualize-dialog__select" aria-label="Notes to merge into" value={targetId ?? ""} onChange={(e) => setTargetId(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.sourceId} value={t.sourceId}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            <label className="acute-visualize-dialog__choice">
              <input type="radio" name="acute-visualize-mode" checked={mode === "new"} onChange={() => setMode("new")} />
              Add as new notes
            </label>
            {mode === "merge" && (
              <p className="acute-visualize-dialog__destination">
                Each part goes under the topic it&apos;s about, and new topics become new sections. What your notes already say is left out; anything you edited by hand is shown for your decision.
              </p>
            )}
            {mode === "merge" && (
              <label className="acute-visualize-dialog__choice">
                <input type="checkbox" checked={economy} onChange={(e) => setEconomy(e.target.checked)} />
                {ECONOMY_LABEL}
              </label>
            )}
            {mode === "merge" && economy && (
              <p className="acute-visualize-dialog__destination">{ECONOMY_NOTICE}</p>
            )}
          </fieldset>
        )}
        {/* An update or a merge keeps the source's template: the layout it already has on the canvas. */}
        {!updating && !merging && (
          <div className="acute-visualize-dialog__templates">
            <span className="acute-visualize-dialog__label">Template</span>
            <TemplatePicker value={template} onChange={setTemplate} />
          </div>
        )}
        <p className="acute-visualize-dialog__destination">
          {descriptor
            ? `Sends ~${wordCount(text).toLocaleString("en-US")} words to: ${descriptor.name} · ${ACCESS_LABEL[descriptor.accessType]}`
            : "No AI connection — will visualize using local structure only."}
          {!descriptor && (
            <>
              {" "}
              <button type="button" className="acute-visualize-dialog__link" onClick={openAISettings}>
                Open AI Settings
              </button>
            </>
          )}
        </p>
        <div className="acute-dialog__actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" data-primary disabled={!text.trim()} onClick={() => void run()}>
            {updating ? "Update" : merging ? "Merge" : "Visualize"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
