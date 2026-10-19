"use client";

/**
 * Review of a pending AI change set (F19): the proposed objects are drawn as
 * ghosts over the canvas — an overlay, never part of the scene — with a bar
 * to review the list, Accept all or Reject.
 *
 * - Nothing is committed while the set is pending, and the canvas stays fully
 *   editable. Changes that refer to an object deleted meanwhile are shown as
 *   skipped, and dropped on Accept (the rest still applies).
 * - Accept writes the set as one transaction and one undo step; the bar then
 *   offers Undo for as long as that step is the latest.
 * - The overlay follows pan/zoom by updating one SVG transform from the
 *   renderer's change event — no React render per frame. Ghost geometry is
 *   recomputed at most once per frame, only while a set is pending.
 * - An update from new content (F39) may carry conflicts — updates to objects
 *   the user edited. Each is shown as a card (yours vs proposed, a diff) and
 *   needs its own decision; "Accept all clean changes" writes the clean
 *   changes plus the decided conflicts, and leaves undecided ones untouched.
 * - A mapping session's merged set (F43) is grouped by section: "Accept all"
 *   writes every section as one undo step, "Accept section" just that one
 *   (the rest stays under review). The user alone can switch the session to
 *   auto-accept (`sessionAutoAccept`); conflicts and removals still wait here.
 */
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AUTO_ACCEPT_TOOLS, sessionAutoAccept } from "@/ai/changes/autoAccept";
import { partSlices } from "@/ai/changes/parts";
import { describeNodePatch } from "@/domain/canvas/nodePatch";
import { getFrameLens } from "@/domain/canvas/diagram";
import { compositeOutline, isCompositeShape } from "@/domain/canvas/compositeShapes";
import type { ConflictItem } from "@/ai/changes/changeSet";
import {
  describeChanges,
  describeDropped,
  proposedBounds,
  resolveChangeSet,
  type Box,
  type ChangeSet,
  type ChangeTarget,
  type ProposedChange,
} from "@/ai/changes/changeSet";
import { describeLayout } from "@/ai/changes/layoutCheck";
import { checkProposal } from "@/ai/changes/proposalGeometry";
import { routeConnectors } from "@/ai/changes/routing";
import { APP_SESSION, getPendingChanges } from "@/ai/changes/pendingChanges";
import { conflictName, currentText, proposedText, type ConflictDecision } from "@/ai/reconcile/conflicts";
import { lineDiff } from "@/ai/reconcile/diff";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getDocumentStore } from "@/state/documents";
import { acceptPendingParts, acceptPendingSet } from "@/components/ai/acceptPending";
import { recordSettled } from "@/state/agentLog";
import { denseBlocks, useDenseBlocks } from "@/components/ai/denseBlocksStore";
import { labelFontsReady, loadLabelFonts, preloadLabelFont } from "@/components/canvas/changeSetWriter";
import { ChevronDownIcon, SparkleIcon } from "@/components/common/icons";
import { AnalysisRow } from "@/components/ai/AnalysisRow";
import { CoverageRow } from "@/components/ai/CoverageRow";
import { SectionChips } from "@/components/ai/SectionChips";
import { needsAnalysisNotice } from "@/ai/fidelity/analysis";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { deriveTitle, toPlainText } from "@/domain/content/richContent";
import type { DocumentHome } from "@/domain/types";
import type { CanvasHistory } from "@/history/canvasHistory";

const ACCEPTED_NOTICE_MS = 10_000;
const FOCUS_MARGIN = 80;
/** The longest Accept waits for the label font (see `loadLabelFonts`) before writing anyway. */
const FONT_WAIT_MS = 1500;

type History = Pick<CanvasHistory<ExcalidrawElement>, "record" | "undo" | "subscribe" | "lastStepId">;

interface Accepted {
  /** Null when only metadata changed (e.g. every conflict kept) — nothing to undo. */
  stepId: number | null;
  message: string;
  dropped: string | null;
  /** How many of the added blocks are dense (`flagDenseBlocks`), offered for review one by one. */
  dense: number;
}

/** Every set waiting on the canvas (D40), for the chooser. */
function useWaitingSets(canvasId: string): ChangeSet[] {
  const pending = getPendingChanges();
  const list = useSyncExternalStore(
    (l) => pending.subscribe(l),
    () => pending.list(canvasId).map((s) => s.operationId).join(" "),
    () => "",
  );
  return useMemo(() => (list ? pending.list(canvasId) : []), [pending, canvasId, list]);
}

function usePendingSet(canvasId: string): ChangeSet | null {
  const pending = getPendingChanges();
  return useSyncExternalStore(
    (l) => pending.subscribe(l),
    () => pending.get(canvasId),
    () => null,
  );
}

const BLOCK_NAMES = { text: "Note", todo: "Todo list", table: "Table", code: "Code" } as const;

function titleOf(change: ProposedChange | undefined): string {
  if (!change) return "object";
  if (change.kind === "create_block") return deriveTitle(change.content, BLOCK_NAMES[change.blockType]);
  if (change.kind === "create_shape") return change.label || change.shape;
  if (change.kind === "create_page") return change.title;
  if (change.kind === "create_frame") return change.title || "section";
  return "object";
}

function itemLabel(change: ProposedChange, byKey: Map<string, ProposedChange>, isConnector: (id: string) => boolean, task?: string, nameOf?: (id: string) => string | undefined): string {
  const end = (t: ChangeTarget) => ("existing" in t ? "existing object" : `“${titleOf(byKey.get(t.created))}”`);
  switch (change.kind) {
    case "create_block":
      return `${BLOCK_NAMES[change.blockType]}: ${titleOf(change)}`;
    case "create_shape":
      return `Shape: ${titleOf(change)}`;
    case "create_page":
      return `Page: ${titleOf(change)}`;
    case "create_frame":
      return `Section: ${titleOf(change)}`;
    case "update_frame":
      if (!change.add.length) return `Rename the section to “${change.name}”`;
      return `Put ${change.add.length === 1 ? "the new object" : `${change.add.length} new objects`} in the section${change.section ? ` “${change.section}”` : ""}${change.name ? ` (renamed)` : ""}`;
    case "connect":
      return `Connect ${end(change.from)} → ${end(change.to)}${change.label ? ` (${change.label})` : ""}`;
    case "move":
      return "Move an existing object";
    case "update_block":
      return `Update: ${deriveTitle(change.content, change.title ?? "Block")}`;
    case "update_shape":
      return `Update shape: ${change.label}`;
    case "remove":
      // An agent's explicit delete (MCP delete_object) vs. reconciliation removing what the content no longer has.
      if (task === "delete_object") return isConnector(change.target) ? "Delete a link (asked by the agent)" : "Delete an object (asked by the agent)";
      return isConnector(change.target) ? "Remove a link no longer in the content" : "Remove an object no longer in the content";
    case "update_node":
      return `Update ${nameOf?.(change.target) || "node"}: ${describeNodePatch(change.semantics)}`;
    case "set_lens": {
      const parts = [
        change.level === null ? "level back to inferred" : change.level !== undefined ? `level L${change.level}` : "",
        change.expandsTo === null
          ? "no zoom-in link"
          : change.expandsTo
            ? `zoom in to “${nameOf?.(change.expandsTo.frameKey) || change.expandsTo.frameKey}”${change.expandsTo.canvasId ? " on another canvas" : ""}`
            : "",
      ].filter(Boolean);
      return `Lens: ${nameOf?.(change.target) || "object"} — ${parts.join(", ")}`;
    }
    case "rebaseline":
      return "Keep your edit";
    case "restore":
      return `Restore ${nameOf?.(change.target) || "an object"} as it was`;
    case "update_connection":
      return `Update a connection${change.relation ? ` (${change.relation.replace(/_/g, " ")})` : ""}${change.label ? `: “${change.label}”` : ""}`;
    case "group_objects":
      return `Group ${change.targets.length} objects in a section “${change.title}”`;
  }
}

/** D44: the MCP sessions auto-accept is on for on this canvas, with how many sets each accepted. */
function useSessionAutoAccept(canvasId: string): { session: string; accepted: number }[] {
  const key = useSyncExternalStore(
    (l) => sessionAutoAccept.subscribe(l),
    () => sessionAutoAccept.sessionsOnCanvas(canvasId).map((o) => `${o.session}:${o.accepted}`).join(" "),
    () => "",
  );
  return useMemo(() => (key ? sessionAutoAccept.sessionsOnCanvas(canvasId) : []), [canvasId, key]);
}

/** The merge key auto-accept is on for on this canvas, if any. */
function useAutoAcceptOn(canvasId: string): string | null {
  return useSyncExternalStore(
    (l) => sessionAutoAccept.subscribe(l),
    () => sessionAutoAccept.onCanvas(canvasId),
    () => null,
  );
}

/** An SVG `points` list for an outline in box-local coordinates, placed at (x, y). */
const ghostPoints = (outline: readonly (readonly [number, number])[], x: number, y: number) => outline.map(([px, py]) => `${x + px},${y + py}`).join(" ");

const keyOf = (c: ProposedChange, i: number) => ("key" in c ? c.key : `${c.kind}:${c.target}`) + `#${i}`;

export function ChangeSetReview({ api, home, history }: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: History }) {
  const set = usePendingSet(home.canvasId);
  const waiting = useWaitingSets(home.canvasId);
  const [expanded, setExpanded] = useState(false);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  // A dense-block walk-through (`DenseBlocks`) shows its own bar where the "Added …" notice is.
  const walkingDense = useDenseBlocks(home.canvasId).current !== null;
  const [sceneVersion, setSceneVersion] = useState(0);
  const [decisions, setDecisions] = useState<ReadonlyMap<string, ConflictDecision>>(new Map());
  const [diffOf, setDiffOf] = useState<string | null>(null);
  const groupRef = useRef<SVGGElement>(null);
  const autoOn = useAutoAcceptOn(home.canvasId);
  const sessionsAuto = useSessionAutoAccept(home.canvasId);

  // Pan/zoom → one transform; scene changes → a geometry recompute, at most once per frame.
  useEffect(() => {
    if (!set) return;
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const place = (s: AppState) => {
      groupRef.current?.setAttribute("transform", `scale(${s.zoom.value}) translate(${s.scrollX} ${s.scrollY})`);
    };
    place(api.getAppState());
    const off = api.onChange((elements, appState) => {
      place(appState);
      if (elements === lastElements) return;
      lastElements = elements;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        setSceneVersion((v) => v + 1);
      });
    });
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api, set]);

  // A new proposal starts collapsed and replaces any earlier "Added …" notice. (A mapping session's set that grows,
  // or loses an accepted section, is the same proposal: it stays as the user left it.)
  const [shownSet, setShownSet] = useState(set);
  if (set !== shownSet) {
    const same = !!set && !!shownSet && !!set.parts && set.operationId === shownSet.operationId;
    setShownSet(set);
    if (set && !same) {
      setExpanded(false);
      setAccepted(null);
      setDecisions(new Map());
      setDiffOf(null);
    }
  }

  // …and is brought into view if it is off screen.
  useEffect(() => {
    if (!set) return;
    // The review bar takes the place of a dense-block walk-through (the badges stay).
    denseBlocks.show(home.canvasId, null);
    const bounds = proposedBounds(set.changes, sceneBoxes(api));
    if (bounds && !inView(api.getAppState(), bounds)) focusBox(api, bounds);
  }, [api, home.canvasId, set]);

  // The Undo offer lasts while the accepted step is the latest one (and at most ACCEPTED_NOTICE_MS).
  useEffect(() => {
    if (!accepted) return;
    if (accepted.stepId === null) {
      const timer = setTimeout(() => setAccepted(null), ACCEPTED_NOTICE_MS);
      return () => clearTimeout(timer);
    }
    const check = () => {
      if (history.lastStepId !== accepted.stepId) setAccepted(null);
    };
    const off = history.subscribe(check);
    const timer = setTimeout(() => setAccepted(null), ACCEPTED_NOTICE_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [accepted, history]);

  const boxOf = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    return set ? sceneBoxes(api) : null;
  }, [api, set, sceneVersion]);
  const resolved = useMemo(() => (set && boxOf ? resolveChangeSet(set, (id) => boxOf(id) !== undefined) : null), [set, boxOf]);
  // Layout checks (Wave 1b item 4) on the set as it will be drawn: measured once per proposal, not on every scene change.
  const layout = useMemo(() => {
    if (!set) return null;
    return describeLayout(checkProposal(set.changes, api.getSceneElements() as unknown as readonly SceneElement[]).counts);
  }, [api, set]);

  // Labels are measured once, as they are written (see `loadLabelFonts`): their font loads with the canvas,
  // and any subset this set still needs while it is reviewed.
  useEffect(preloadLabelFont, []);
  const labelFonts = useMemo(() => (set ? loadLabelFonts(set) : null), [set]);
  const waitingForFonts = useRef(false);

  const accept = useCallback(() => {
    if (!set || waitingForFonts.current) return;
    if (labelFontsReady(set)) return write(set);
    // Rare (a slow first font load): write once it is in, or after FONT_WAIT_MS regardless.
    waitingForFonts.current = true;
    void Promise.race([labelFonts, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).then(() => {
      waitingForFonts.current = false;
      // Unless it was settled or replaced meanwhile.
      if (getPendingChanges().get(home.canvasId)?.operationId === set.operationId) write(set);
    });

    function write(set: ChangeSet) {
      if (set.parts) {
        // A merged set (F43): every section, each with its own content version, as one undo step.
        const done = acceptPendingParts(api, home, history, null, decisions, set.mergeKey);
        if (done) setAccepted({ stepId: done.stepId, message: done.message, dropped: done.dropped, dense: done.dense });
        return;
      }
      // Clean changes plus each decided conflict's change; undecided conflicts are left alone. Logged (D31) there.
      const done = acceptPendingSet(api, home, history, set.operationId, decisions);
      // A set of only "Keep mine" decisions writes metadata, not the scene: applied, but no history step.
      if (done?.applied.length) setAccepted({ stepId: done.stepId, message: acceptedMessage(done.applied), dropped: done.dropped, dense: done.dense });
      else if (done) api.setToast({ message: "Nothing was added: every change referred to a deleted object.", duration: 4000 });
    }
  }, [api, home, history, set, decisions, labelFonts]);

  /** One section of a merged set; the rest stays under review. */
  const acceptPart = useCallback(
    (key: string) => {
      const done = acceptPendingParts(api, home, history, [key], decisions, set?.mergeKey);
      if (!done) return;
      if (done.more) api.setToast({ message: `${done.message}${done.dropped ? ` ${done.dropped}` : ""}`, duration: 3000 });
      else setAccepted({ stepId: done.stepId, message: done.message, dropped: done.dropped, dense: done.dense });
    },
    [api, home, history, decisions, set?.mergeKey],
  );

  const [rejectReason, setRejectReason] = useState("");
  const reject = useCallback(() => {
    if (!set) return;
    getPendingChanges().settle(home.canvasId, set.operationId);
    // D46: logged with the user's reason, so an agent stops re-proposing what was declined.
    recordSettled(home, set, "rejected", rejectReason.trim() || undefined);
    setRejectReason("");
  }, [home, set, rejectReason]);

  if (!set || !resolved || !boxOf) {
    if (!accepted && !autoOn && sessionsAuto.length) {
      const n = sessionsAuto.reduce((sum, o) => sum + o.accepted, 0);
      return (
        <div className="acute-review" role="status" aria-label="Agent session">
          <SparkleIcon />
          <span className="acute-review__summary">
            Agent session: project updates are accepted as they arrive ({n} auto-accepted this session; removals, reverts, constraints and enforced decisions still wait for you). Every one is in the agent log, where it can be reverted.
          </span>
          <span className="acute-review__actions">
            <button type="button" className="acute-ask-ai__secondary" onClick={() => sessionsAuto.forEach((o) => sessionAutoAccept.disableSession(home.canvasId, o.session))}>
              Turn off auto-accept
            </button>
          </span>
        </div>
      );
    }
    if (!accepted && autoOn) {
      return (
        <div className="acute-review" role="status" aria-label="Mapping session">
          <SparkleIcon />
          <span className="acute-review__summary">Mapping session: sections are accepted as they arrive (conflicts and removals still wait for you).</span>
          <span className="acute-review__actions">
            <button type="button" className="acute-ask-ai__secondary" onClick={() => sessionAutoAccept.disable(autoOn)}>
              Turn off auto-accept
            </button>
          </span>
        </div>
      );
    }
    if (!accepted || walkingDense) return null;
    return (
      <div className="acute-review" role="status" aria-label="AI changes">
        <SparkleIcon />
        <span className="acute-review__summary">
          {accepted.message}
          {accepted.dropped && <span className="acute-review__note"> {accepted.dropped}</span>}
          {accepted.dense > 0 && (
            <span className="acute-review__note">
              {" "}
              {accepted.dense === 1 ? "1 block has" : `${accepted.dense} blocks have`} too much content to read well.
            </span>
          )}
        </span>
        <span className="acute-review__actions">
          {accepted.dense > 0 && (
            <button
              type="button"
              className="acute-ask-ai__secondary"
              onClick={() => {
                const first = denseBlocks.get(home.canvasId).entries[0];
                setAccepted(null);
                if (first) denseBlocks.show(home.canvasId, first.id);
              }}
            >
              Review ›
            </button>
          )}
          {accepted.stepId !== null && (
            <button type="button" className="acute-ask-ai__secondary" onClick={() => history.lastStepId === accepted.stepId && history.undo()}>
              Undo
            </button>
          )}
        </span>
      </div>
    );
  }

  const byKey = new Map(set.changes.flatMap((c) => ("key" in c ? [[c.key, c] as const] : [])));
  const droppedSet = new Set(resolved.dropped.map((d) => d.change));
  const droppedNote = describeDropped(resolved.dropped);
  const conflicts = (set.conflicts ?? []).filter((c) => boxOf(c.target) !== undefined);
  const arrows = new Set(api.getSceneElements().flatMap((el) => (el.type === "arrow" ? [el.id] : [])));
  const isConnector = (id: string) => arrows.has(id);
  const nodeNames = new Map(
    api.getSceneElements().flatMap((el) => {
      if (el.type === "text" && el.containerId && el.text) return [[el.containerId, el.text.replace(/\s+/g, " ").trim()] as const];
      // Frames by id and Lens key, for `set_lens`'s "zoom in to …".
      const name = el.type === "frame" ? (el as { name?: string | null }).name?.trim() : undefined;
      if (!name) return [];
      const key = getFrameLens(el)?.lensKey;
      return key ? [[el.id, name] as const, [key, name] as const] : [[el.id, name] as const];
    }),
  );
  const nameOf = (id: string) => nodeNames.get(id);
  const decidedCount = conflicts.filter((c) => decisions.has(c.target)).length;
  // Any update of an existing content source (version 2+) reads as a reconciliation, even when it only adds.
  const reconciling =
    conflicts.length > 0 || (set.contentSource?.version ?? 1) > 1 || resolved.changes.some((c) => c.kind === "update_block" || c.kind === "update_shape" || c.kind === "remove");
  const decide = (target: string, d: ConflictDecision) =>
    setDecisions((m) => {
      const next = new Map(m);
      if (next.get(target) === d) next.delete(target);
      else next.set(target, d);
      return next;
    });

  return (
    <>
      <svg className="acute-review-ghosts" aria-hidden="true">
        <defs>
          <marker id="acute-review-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        <g ref={groupRef}>
          <Ghosts boxOf={boxOf} changes={resolved.changes} byKey={byKey} />
          {conflicts.map((c) => {
            const b = boxOf(c.target)!;
            return (
              <g key={`conflict:${c.target}`} className="acute-review-ghost acute-review-ghost--conflict">
                <rect x={b.x - 4} y={b.y - 4} width={b.width + 8} height={b.height + 8} rx={8} />
              </g>
            );
          })}
        </g>
      </svg>
      {/* Each section's review reason at the section itself (Wave C); the bar below keeps the totals. */}
      <SectionChips api={api} canvasId={home.canvasId} set={set} />
      <div className="acute-review" role="region" aria-label="AI changes to review">
        {waiting.length > 1 && (
          // Several producers have sets waiting (D40): one is reviewed at a time; the others stay as they are.
          <div className="acute-review__sets" role="tablist" aria-label="Change sets waiting for review">
            {waiting.map((w) => (
              <button
                key={w.operationId}
                type="button"
                role="tab"
                aria-selected={w.operationId === set.operationId}
                className="acute-review__set"
                onClick={() => getPendingChanges().select(home.canvasId, w.operationId)}
              >
                {w.title}
              </button>
            ))}
          </div>
        )}
        <SparkleIcon />
        <span className="acute-review__summary">
          <strong>{set.title}</strong> · {set.parts ? `${set.parts.length} ${set.parts.length === 1 ? "section" : "sections"} · ` : ""}
          {reconciling ? describeReconciliation(resolved.changes, conflicts.length, isConnector) : describeChanges(resolved.changes, { omitSections: !!set.parts })}
          {droppedNote && <span className="acute-review__note"> {droppedNote}</span>}
          {layout && (
            <span className="acute-review__note acute-review__layout" title="Layout checks on the proposal as it will be drawn">
              {" "}
              ⚠ {layout}
            </span>
          )}
        </span>
        <span className="acute-review__actions">
          {set.mergeKey && set.session && !sessionAutoAccept.isRemote(set.session) && (
            <label className="acute-review__auto" title="Write each section as it arrives, as its own undo step, for this mapping session only. Conflicts and removals still wait for you.">
              <input
                type="checkbox"
                checked={autoOn === set.mergeKey}
                onChange={(e) => (e.target.checked ? sessionAutoAccept.enable(set.mergeKey!, set.session!, home.canvasId) : sessionAutoAccept.disable(set.mergeKey!))}
              />
              Auto-accept this session
            </label>
          )}
          {!set.mergeKey && set.session && set.session !== APP_SESSION && !sessionAutoAccept.isRemote(set.session) && AUTO_ACCEPT_TOOLS.has(set.metadata.task ?? "") && (
            <label className="acute-review__auto" title="Write this agent session's project updates as they arrive (D44). Removals, reverts, new constraints and enforced decisions still wait for you; each one is logged and revertible.">
              <input
                type="checkbox"
                checked={sessionAutoAccept.isSessionOn(home.canvasId, set.session)}
                onChange={(e) => (e.target.checked ? sessionAutoAccept.enableSession(home.canvasId, set.session!) : sessionAutoAccept.disableSession(home.canvasId, set.session!))}
              />
              Auto-accept this session
            </label>
          )}
          <button type="button" className="acute-ask-ai__secondary" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
            Review <ChevronDownIcon />
          </button>
          <button type="button" className="acute-ask-ai__secondary" onClick={reject}>
            Reject
          </button>
          <button type="button" className="acute-ask-ai__primary" onClick={accept} disabled={!resolved.changes.length && !decidedCount}>
            {conflicts.length ? "Accept all clean changes" : "Accept all"}
          </button>
        </span>
        {needsAnalysisNotice(set.analysis) && <AnalysisRow api={api} canvasId={home.canvasId} set={{ ...set, analysis: set.analysis }} />}
        {set.fidelity && FIDELITY_CONFIG.showCoverage && (
          <CoverageRow api={api} canvasId={home.canvasId} set={{ ...set, fidelity: set.fidelity }} perSectionOnCanvas={set.changes.some((c) => c.kind === "create_frame" && !!c.overview)} />
        )}
        {expanded && set.parts && (
          <ul className="acute-review__list" aria-label="Proposed changes">
            {partSlices(set).map((slice) => (
              <li key={`part:${slice.part.key}`} aria-label={`Section: ${slice.part.title}`}>
                <div className="acute-review__part">
                  <span className="acute-review__part-name">Section: {slice.part.title}</span>
                  <span className="acute-review__note">
                    {describeChanges(slice.changes, { omitSections: true })}
                    {slice.conflicts.length ? ` · ⚠ ${slice.conflicts.length}` : ""}
                  </span>
                  <button type="button" className="acute-ask-ai__secondary" onClick={() => acceptPart(slice.part.key)}>
                    Accept section
                  </button>
                </div>
                <ul>
                  {slice.changes.map((c, i) => {
                    const skipped = droppedSet.has(c);
                    const box = skipped ? null : changeBox(boxOf, c, byKey);
                    return (
                      <li key={keyOf(c, i)} className={skipped ? "acute-review__item acute-review__item--skipped" : "acute-review__item"}>
                        <button type="button" disabled={!box} onClick={() => box && focusBox(api, box)}>
                          {itemLabel(c, byKey, isConnector, set.metadata.task, nameOf)}
                          {skipped && <span className="acute-review__note"> — skipped (object deleted)</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {expanded && !set.parts && (
          <ul className="acute-review__list" aria-label="Proposed changes">
            {set.changes.map((c, i) => {
              const skipped = droppedSet.has(c);
              const box = skipped ? null : changeBox(boxOf, c, byKey);
              return (
                <li key={keyOf(c, i)} className={skipped ? "acute-review__item acute-review__item--skipped" : "acute-review__item"}>
                  <button type="button" disabled={!box} onClick={() => box && focusBox(api, box)}>
                    {itemLabel(c, byKey, isConnector, set.metadata.task, nameOf)}
                    {skipped && <span className="acute-review__note"> — skipped (object deleted)</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {expanded && (
          <label className="acute-review__reject-reason">
            <span>Reason for rejecting (optional)</span>
            <input
              type="text"
              maxLength={200}
              value={rejectReason}
              placeholder="Kept in the agent change log, so the agent can see it"
              onChange={(e) => setRejectReason(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        )}
        {conflicts.length > 0 && (
          <ul className="acute-review__conflicts" aria-label="Changes that need your input">
            {conflicts.map((c) => (
              <ConflictCard
                key={c.target}
                conflict={c}
                current={currentText(api.getSceneElements() as unknown as readonly SceneElement[], (id) => getDocumentStore().get(id), c.target)}
                decision={decisions.get(c.target)}
                onDecide={(d) => decide(c.target, d)}
                showDiff={diffOf === c.target}
                onToggleDiff={() => setDiffOf((t) => (t === c.target ? null : c.target))}
                onShow={() => {
                  const b = boxOf(c.target);
                  if (b) focusBox(api, b);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** "+2 new · −1 removed · ~3 updated · 2 links changed · ⚠ 1 needs your input" */
function describeReconciliation(changes: readonly ProposedChange[], conflicts: number, isConnector: (id: string) => boolean): string {
  let added = 0;
  let removed = 0;
  let updated = 0;
  let links = 0;
  for (const c of changes) {
    if (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") added++;
    else if (c.kind === "remove" && isConnector(c.target)) links++;
    else if (c.kind === "remove") removed++;
    else if (c.kind === "update_block" || c.kind === "update_shape" || c.kind === "update_node" || c.kind === "set_lens") updated++;
    else if (c.kind === "connect") links++;
  }
  const parts = [
    added ? `+${added} new` : "",
    removed ? `−${removed} removed` : "",
    updated ? `~${updated} updated` : "",
    links ? `${links} ${links === 1 ? "link" : "links"} changed` : "",
    conflicts ? `⚠ ${conflicts} ${conflicts === 1 ? "needs" : "need"} your input` : "",
  ];
  return parts.filter(Boolean).join(" · ") || "No changes";
}

function acceptedMessage(applied: readonly ProposedChange[]): string {
  if (applied.every((c) => c.kind === "rebaseline")) return applied.length === 1 ? "Kept your edit." : "Kept your edits.";
  const added = applied.some((c) => c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page");
  return `${added ? "Added" : "Applied"} ${describeChanges(applied)}.`;
}

function ConflictCard(props: {
  conflict: ConflictItem;
  current: string | null;
  decision: ConflictDecision | undefined;
  onDecide: (d: ConflictDecision) => void;
  showDiff: boolean;
  onToggleDiff: () => void;
  onShow: () => void;
}) {
  const { conflict, current, decision } = props;
  const proposed = proposedText(conflict);
  const name = conflictName(conflict);
  // A revert's conflict (D30): the object changed after the agent's change; keeping it adds nothing.
  const revert = conflict.apply.kind === "restore" || conflict.apply.kind === "remove";
  return (
    <li className="acute-review__conflict" aria-label={`Conflict: ${name}`} data-decision={decision ?? "undecided"}>
      <div className="acute-review__conflict-head">
        <button type="button" className="acute-review__conflict-name" onClick={props.onShow}>
          ⚠ {name}
        </button>
        <span className="acute-review__note">{revert ? "This changed after the agent's change; reverting would undo that too." : "You edited this; the new content changes it too."}</span>
      </div>
      {props.showDiff ? (
        <pre className="acute-review__diff" aria-label="Differences">
          {lineDiff(current ?? "", proposed).map((l, i) => (
            <span key={i} className={`acute-review__diff-line acute-review__diff-line--${l.op}`}>
              {l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}
              {l.text}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        <div className="acute-review__compare">
          <div>
            <span className="acute-review__compare-label">Yours</span>
            <pre aria-label="Your version">{current ?? ""}</pre>
          </div>
          <div>
            <span className="acute-review__compare-label">{revert ? "After revert" : "Proposed"}</span>
            <pre aria-label="Proposed version">{proposed}</pre>
          </div>
        </div>
      )}
      <div className="acute-review__conflict-actions">
        <button type="button" className="acute-ask-ai__secondary" aria-pressed={props.showDiff} onClick={props.onToggleDiff}>
          View diff
        </button>
        <button type="button" className="acute-ask-ai__secondary" aria-pressed={decision === "keep"} onClick={() => props.onDecide("keep")}>
          {revert ? "Keep current" : "Keep mine"}
        </button>
        <button type="button" className="acute-ask-ai__secondary" aria-pressed={decision === "apply"} onClick={() => props.onDecide("apply")}>
          {revert ? "Revert anyway" : "Apply update"}
        </button>
      </div>
    </li>
  );
}

/** Ghost outlines in scene coordinates (the parent group maps them to the viewport). */
function Ghosts({ boxOf, changes, byKey }: { boxOf: BoxLookup; changes: readonly ProposedChange[]; byKey: Map<string, ProposedChange> }) {
  const moves = new Map(changes.flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
  /** An existing object's box where this change set would put it, or a created object's box. */
  const target = (t: ChangeTarget): Box | undefined => {
    if (!("existing" in t)) return createdBox(byKey.get(t.created));
    const box = boxOf(t.existing);
    const to = moves.get(t.existing);
    return box && to ? { ...box, ...to } : box;
  };
  // Connectors preview the same right-angle routes the writer will draw (Wave 1b), avoiding the proposed objects.
  const idOf = (t: ChangeTarget) => ("existing" in t ? t.existing : `created:${t.created}`);
  const routedBoxOf = (t: ChangeTarget) => {
    const b = target(t);
    return b ? { ...b, id: idOf(t) } : undefined;
  };
  const requests = changes.flatMap((c) => {
    if (c.kind !== "connect") return [];
    const from = routedBoxOf(c.from);
    const to = routedBoxOf(c.to);
    return from && to ? [{ key: c.key, from, to }] : [];
  });
  const obstacles = [
    ...changes.flatMap((c) => (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page" ? [{ ...c.box, id: `created:${c.key}` }] : [])),
    ...requests.flatMap((r) => [r.from, r.to]).filter((b) => !b.id.startsWith("created:")),
  ];
  const routes = routeConnectors(requests, obstacles);
  return (
    <>
      {changes.map((c, i) => {
        const k = keyOf(c, i);
        if (c.kind === "create_block") {
          const text = toPlainText(c.content).split("\n").slice(0, 8).join("\n");
          return (
            <g key={k} className="acute-review-ghost">
              <rect x={c.box.x} y={c.box.y} width={c.box.width} height={c.box.height} rx={8} />
              <foreignObject x={c.box.x} y={c.box.y} width={c.box.width} height={c.box.height}>
                <div className="acute-review-ghost__text">{text}</div>
              </foreignObject>
            </g>
          );
        }
        if (c.kind === "create_shape") {
          const { x, y, width: w, height: h } = c.box;
          return (
            <g key={k} className="acute-review-ghost">
              {c.shape === "ellipse" ? (
                <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
              ) : isCompositeShape(c.shape) ? (
                <>
                  {Object.entries(compositeOutline(c.shape, w, h)).map(([part, points]) =>
                    part === "body" ? (
                      <polygon key={part} points={ghostPoints(points, x, y)} />
                    ) : (
                      <polyline key={part} className="acute-review-ghost--line" points={ghostPoints(points, x, y)} />
                    ),
                  )}
                </>
              ) : c.shape === "diamond" ? (
                <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />
              ) : (
                <rect x={x} y={y} width={w} height={h} rx={4} />
              )}
              {c.label && (
                <foreignObject x={x} y={y} width={w} height={h}>
                  <div className="acute-review-ghost__label">{c.label}</div>
                </foreignObject>
              )}
            </g>
          );
        }
        if (c.kind === "create_page") {
          return (
            <g key={k} className="acute-review-ghost acute-review-ghost--page">
              <rect x={c.box.x} y={c.box.y} width={c.box.width} height={c.box.height} rx={8} />
              <foreignObject x={c.box.x} y={c.box.y} width={c.box.width} height={c.box.height}>
                <div className="acute-review-ghost__text">
                  <strong>{c.title}</strong>
                  {"\n"}
                  {toPlainText(c.content).split("\n").slice(0, 6).join("\n")}
                </div>
              </foreignObject>
            </g>
          );
        }
        if (c.kind === "create_frame") {
          return (
            <g key={k} className="acute-review-ghost acute-review-ghost--frame">
              <rect x={c.box.x} y={c.box.y} width={c.box.width} height={c.box.height} rx={12} />
            </g>
          );
        }
        if (c.kind === "connect") {
          const route = routes.get(c.key);
          if (!route) return null;
          return (
            <polyline
              key={k}
              className="acute-review-ghost acute-review-ghost--line"
              points={(c.routing === "straight" ? [route.points[0]!, route.points.at(-1)!] : route.points).map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              markerEnd="url(#acute-review-arrow)"
            />
          );
        }
        if (c.kind === "rebaseline") return null; // nothing visible changes
        if (c.kind === "group_objects") {
          // The section it will draw: its members' bounds, padded.
          const b = unionBox(c.targets.map(boxOf));
          return b ? (
            <g key={k} className="acute-review-ghost acute-review-ghost--update">
              <rect x={b.x - 40} y={b.y - 60} width={b.width + 80} height={b.height + 100} rx={8} />
            </g>
          ) : null;
        }
        const from = boxOf(c.target);
        if (!from) return null;
        if (c.kind !== "move") {
          // An update or removal of an existing object: outline it where it is.
          const cls = c.kind === "remove" ? "acute-review-ghost acute-review-ghost--remove" : "acute-review-ghost acute-review-ghost--update";
          return (
            <g key={k} className={cls}>
              <rect x={from.x - 4} y={from.y - 4} width={from.width + 8} height={from.height + 8} rx={8} />
            </g>
          );
        }
        return (
          <g key={k} className="acute-review-ghost">
            <rect x={c.to.x} y={c.to.y} width={from.width} height={from.height} rx={4} />
            <line
              className="acute-review-ghost--line"
              x1={from.x + from.width / 2}
              y1={from.y + from.height / 2}
              x2={c.to.x + from.width / 2}
              y2={c.to.y + from.height / 2}
              markerEnd="url(#acute-review-arrow)"
            />
          </g>
        );
      })}
    </>
  );
}

type BoxLookup = (id: string) => Box | undefined;

/** Geometry of the live scene objects, by id (one pass over the scene). */
function sceneBoxes(api: ExcalidrawImperativeAPI): BoxLookup {
  const boxes = new Map(api.getSceneElements().map((el) => [el.id, { x: el.x, y: el.y, width: el.width, height: el.height }] as const));
  return (id) => boxes.get(id);
}

function createdBox(change: ProposedChange | undefined): Box | undefined {
  return change && (change.kind === "create_block" || change.kind === "create_shape" || change.kind === "create_page" || change.kind === "create_frame") ? change.box : undefined;
}

/** Where a review-list item is, for "show me". */
function changeBox(boxOf: BoxLookup, c: ProposedChange, byKey: Map<string, ProposedChange>): Box | undefined {
  if (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page" || c.kind === "create_frame") return c.box;
  if (c.kind === "move") return proposedBounds([c], boxOf) ?? undefined;
  if (c.kind === "group_objects") return unionBox(c.targets.map(boxOf));
  if (c.kind !== "connect") return boxOf(c.target);
  const ends = [c.from, c.to].map((t) => ("existing" in t ? boxOf(t.existing) : createdBox(byKey.get(t.created))));
  if (!ends[0] || !ends[1]) return undefined;
  const [a, b] = ends as [Box, Box];
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function unionBox(boxes: readonly (Box | undefined)[]): Box | undefined {
  const live = boxes.filter((b): b is Box => !!b);
  if (!live.length) return undefined;
  const x = Math.min(...live.map((b) => b.x));
  const y = Math.min(...live.map((b) => b.y));
  return { x, y, width: Math.max(...live.map((b) => b.x + b.width)) - x, height: Math.max(...live.map((b) => b.y + b.height)) - y };
}

function inView(s: AppState, b: Box): boolean {
  const z = s.zoom.value;
  const left = -s.scrollX;
  const top = -s.scrollY;
  return b.x >= left && b.y >= top && b.x + b.width <= left + s.width / z && b.y + b.height <= top + s.height / z;
}

/** Centres the view on a box, zooming out if it doesn't fit (never zooming in). */
function focusBox(api: ExcalidrawImperativeAPI, b: Box): void {
  const s = api.getAppState();
  const fit = Math.min(s.width / (b.width + FOCUS_MARGIN * 2), s.height / (b.height + FOCUS_MARGIN * 2));
  const zoom = Math.max(0.1, Math.min(s.zoom.value, fit));
  api.updateScene({
    appState: {
      zoom: { value: zoom as never },
      scrollX: s.width / 2 / zoom - (b.x + b.width / 2),
      scrollY: s.height / 2 / zoom - (b.y + b.height / 2),
    },
  });
}
