"use client";

/**
 * Acute Lens's side panel (plan §5.1–5.2): the level rail, breadcrumb and semantic zoom (drill/up) from Phase
 * 1A-ii, docked or expanded, reusing the page panel's shared shell (`.acute-side-panel`); Phase 1B's Evidence
 * action, L5 source card and drills into other canvases (read-only, through `LensSceneCache`); Phase 3's Trace and
 * Impact actions and an agent's `focus_lens` highlight (`LensOverlays.tsx`); Phase 4's Agent Sync (`LensAgentSync.tsx`):
 * pending ghosts over the level, stale and "may be affected" marks, the Agent Sync chip with Pause, and the Changes /
 * Impact drawer. Read-mostly
 * (D4/D5): it never edits the scene, only calls `CanvasCommands.revealNode` to go back (navigating first when the
 * element is on another canvas), or the small `lensNodes.ts` commands from the frame/node panel section.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { useAffectedMarkers, useStaleMarkers } from "@/components/ai/staleMarkersStore";
import { lensPending } from "@/domain/lens/pending";
import { agentSync, useAgentSync } from "@/state/agentSync";
import { AgentSyncChip, ChangesDrawer, type DrawerTab } from "./LensAgentSync";
import { AIGeneratedNote, LensAsk, LensExplain, LensGenerate, LensReview, useLensAI } from "./LensAI";
import { ArrowLeftIcon, CloseIcon, CollapseIcon, ExpandIcon, SparkleIcon } from "@/components/common/icons";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { prefersReducedMotion } from "@/components/canvas/motion";
import { Passport } from "@/components/diagram/Passport";
import { nodeNeighborhood } from "@/domain/canvas/diagram";
import type { SceneElement } from "@/domain/canvas/adapter";
import { drillTarget, lensTree, lensView, reachableLevels, type LensCrumb } from "@/domain/lens/lensView";
import { mapCodeFor } from "@/domain/lens/evidence";
import type { LensProfile } from "@/domain/lens/lensProfile";
import type { DocumentHome } from "@/domain/types";
import { lensPanel, useLensPanel } from "@/state/lensPanel";
import { setUiPref, useUiPref } from "@/state/uiPrefs";
import { canvasPath } from "@/workspaces/paths";
import { writeLensHash } from "./lensHash";
import { requestReveal } from "./lensReveal";
import { LensSceneCache } from "./lensScenes";
import { EvidenceList, SourceCard } from "./LensEvidence";
import { LensDiagram } from "./LensDiagram";
import { ProjectInspector } from "./LensProject";
import { ImpactCard, overlayMarks, TraceCard, useImpact, useTrace } from "./LensOverlays";
import { reachKey } from "@/domain/lens/trace";
import { useLensWorkspace } from "./lensWorkspace";
import { graphNodeAt, locateInLens } from "@/domain/lens/locate";

const iconButton =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent " +
  "text-[var(--acute-text-muted)] hover:bg-[var(--acute-surface-muted)] hover:text-[var(--acute-text)]";

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const MIN_WIDTH = 560;
/** Canvas width always left visible next to the docked panel. */
const MIN_CANVAS_WIDTH = 240;
const TRANSITION_MS = 200;
/** Lens recomputes on scene change, debounced (plan §8.2). */
const RECOMPUTE_MS = 150;
const NO_SETS: ChangeSet[] = [];

/**
 * The change sets waiting on `canvasId`, held still while Agent Sync is paused there (the ghosts freeze with the view)
 * and caught up on resume.
 */
/** `list` builds a new array each call: a canvas's snapshot is kept while its sets are the same objects. */
const lastSets = new Map<string, ChangeSet[]>();
function setsSnapshot(canvasId: string): ChangeSet[] {
  const next = getPendingChanges().list(canvasId);
  const last = lastSets.get(canvasId) ?? NO_SETS;
  if (next.length === last.length && next.every((s, i) => s === last[i])) return last;
  const kept = next.length ? next : NO_SETS;
  lastSets.set(canvasId, kept);
  return kept;
}

function useLensSets(canvasId: string, paused: boolean): ChangeSet[] {
  const live = useSyncExternalStore(
    (l) => getPendingChanges().subscribe(l),
    () => setsSnapshot(canvasId),
    () => NO_SETS,
  );
  // Held as they were when paused (adjusted during render, as React recommends for derived state).
  const [held, setHeld] = useState({ paused, sets: live });
  if (held.paused !== paused) setHeld({ paused, sets: live });
  return paused ? held.sets : live;
}

function Breadcrumb({ crumbs, onJump }: { crumbs: readonly LensCrumb[]; onJump: (index: number) => void }) {
  return (
    <nav className="acute-lens-panel__crumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="acute-lens-panel__crumb">
          {i > 0 && (
            <span aria-hidden="true" className="acute-lens-panel__crumb-sep">
              ▸
            </span>
          )}
          {i === crumbs.length - 1 ? (
            <span className="acute-lens-panel__crumb-current">{c.title}</span>
          ) : (
            <button type="button" onClick={() => onJump(i)}>
              {c.title}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function LevelRail({
  profile,
  crumbs,
  currentLevel,
  reachable,
  drillNextLevel,
  onJump,
  onDrillNext,
}: {
  profile: LensProfile;
  crumbs: readonly LensCrumb[];
  currentLevel: number;
  reachable: ReadonlySet<number>;
  /** The level "zoom in" from here would actually show (a source card skips to L5), when there is one. */
  drillNextLevel: number | undefined;
  onJump: (index: number) => void;
  onDrillNext: () => void;
}) {
  return (
    <nav className="acute-lens-panel__rail" aria-label="Level">
      {profile.levels.map((l) => {
        // The last ancestor at this level (two crumbs can share one when a frame's level is set explicitly).
        const crumbIndex = crumbs.slice(0, -1).findLastIndex((c) => c.level === l.index);
        const isCurrent = l.index === currentLevel;
        const clickableUp = !isCurrent && crumbIndex >= 0;
        const clickableDown = !isCurrent && l.index === drillNextLevel;
        const filled = crumbIndex >= 0 || reachable.has(l.index);
        return (
          <button
            key={l.index}
            type="button"
            className="acute-lens-panel__rail-item"
            data-current={isCurrent || undefined}
            data-filled={filled || undefined}
            aria-current={isCurrent ? "true" : undefined}
            disabled={!clickableUp && !clickableDown}
            onClick={() => {
              if (clickableUp) onJump(crumbIndex);
              else if (clickableDown) onDrillNext();
            }}
          >
            <span className="acute-lens-panel__rail-dot" aria-hidden="true" />
            {l.short} {l.name}
          </button>
        );
      })}
    </nav>
  );
}

export function LensPanel({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const { root, path, selectedKey, expanded, highlight, trace, impact } = useLensPanel();
  const router = useRouter();
  const [sceneVersion, setSceneVersion] = useState(0);
  // Other canvases a drill link points into, loaded read-only on first use; a load re-renders with them.
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [cache] = useState(() => new LensSceneCache(home.workspaceId, () => setLoadedVersion((v) => v + 1)));
  const [showEvidence, setShowEvidence] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const storedWidth = useUiPref("lensPanelWidth");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const reduceMotion = prefersReducedMotion();
  // Agent Sync (Phase 4): Pause holds the view (scene and ghosts) still until resumed.
  const syncVersion = useAgentSync();
  const paused = agentSync.isPaused(home.canvasId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("changes");
  // Phase 5: AI in Lens shows only while AI is on (plan §6: everything optional).
  const aiOn = useLensAI();

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const right = parent.getBoundingClientRect().right;
    const max = Math.max(MIN_WIDTH, parent.clientWidth - MIN_CANVAS_WIDTH);
    let width = panel.offsetWidth;
    const onMove = (ev: PointerEvent) => {
      width = Math.round(Math.min(max, Math.max(MIN_WIDTH, right - ev.clientX)));
      setDragWidth(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setUiPref("lensPanelWidth", width);
      setDragWidth(null);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  const width = dragWidth ?? storedWidth;

  // Recomputed only while Lens is open: the scene itself never changes because Lens is open (D2, D5, AC10). Debounced
  // (plan §8.2), and held while paused; resuming catches up at once.
  useLayoutEffect(() => {
    if (!root || paused) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastElements: readonly unknown[] | null = null;
    const off = api.onChange((elements) => {
      if (elements === lastElements) return;
      lastElements = elements;
      clearTimeout(timer);
      timer = setTimeout(() => setSceneVersion((v) => v + 1), RECOMPUTE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [api, root, paused]);

  const elements = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes…
    void paused; // …and when Agent Sync is paused (held from here) or resumed (caught up)
    return api.getSceneElements() as unknown as readonly SceneElement[];
  }, [api, sceneVersion, paused]);

  const scenes = useMemo(() => {
    void loadedVersion; // a linked canvas finished loading
    return cache.source(home.canvasId, elements);
  }, [cache, home.canvasId, elements, loadedVersion]);

  const view = useMemo(() => (root ? lensView(scenes, root, path) : undefined), [scenes, root, path]);

  // Proposed state (D3) and stale marks, for a level on the open canvas: change sets and markers live there only.
  const onOpenCanvas = !!view && view.frame.canvasId === home.canvasId;
  const sets = useLensSets(home.canvasId, paused);
  const pendingView = useMemo(() => (view && onOpenCanvas ? lensPending(view, sets) : undefined), [view, onOpenCanvas, sets]);
  const staleIds = useStaleMarkers(home.canvasId);
  const affectedIds = useAffectedMarkers(home.canvasId);
  // Viewing a frame clears its canvas `Δ` (plan §8.2), unless the view is paused on an older state.
  const viewedFrame = view && !view.source ? view.frame : undefined;
  useEffect(() => {
    if (viewedFrame && !paused) agentSync.markSeen(viewedFrame.canvasId, viewedFrame.frameId);
  }, [viewedFrame, paused, syncVersion]);

  // The level rail's "below current" state: whether anything is reachable, without recursing past what's useful.
  const reachable = useMemo(() => {
    if (!view) return new Set<number>();
    if (view.source) return new Set<number>([view.level]);
    const tree = lensTree(scenes, view.frame, view.level);
    return tree ? reachableLevels(tree) : new Set<number>([view.level]);
  }, [scenes, view]);

  const selectedNode = useMemo(() => view?.nodes.find((n) => n.key === selectedKey), [view, selectedKey]);
  // Its detail level's nodes, for Explain's "how the detail fits" (§6.1).
  const childLabels = useMemo(() => {
    if (!root || !selectedNode?.childFrame || selectedNode.childFrame.pending) return [];
    return lensView(scenes, root, [...path, selectedNode.key])?.nodes.map((n) => n.label) ?? [];
  }, [scenes, root, path, selectedNode]);

  // Phase 3: Trace and Impact read the whole workspace (built only while one is in use).
  const workspace = useLensWorkspace(home, () => api.getSceneElements() as unknown as readonly SceneElement[], sceneVersion, !!(trace || impact || (drawerOpen && drawerTab === "impact")));
  const traceResult = useTrace(trace, workspace);
  const impactResult = useImpact(impact, workspace);
  const marks = useMemo(() => overlayMarks(view, traceResult, impactResult, highlight), [view, traceResult, impactResult, highlight]);
  /** Opens Lens at a node of the workspace (a trace stop, an impact entry), keeping the overlay. */
  const goTo = (canvasId: string, ref: string) => {
    const node = workspace && graphNodeAt(workspace.g, canvasId, ref);
    const at = node && locateInLens(workspace.g, workspace.scenes, node);
    if (at) lensPanel.open(at.root, { path: at.path, nodeKey: at.nodeKey });
  };
  // The path probe (archify's route probe): while a path is being picked, a click on a node chooses it — the start
  // first, then the end. An end that can't be reached from the start says so instead of giving "no path".
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const onSelectNode = (key: string) => {
    lensPanel.select(key);
    const node = view?.nodes.find((n) => n.key === key);
    if (!trace || trace.to || !node || !view) return;
    const ref = { canvasId: view.frame.canvasId, key: node.key, label: node.label };
    if (!trace.from) {
      setPathNotice(null);
      lensPanel.setTraceFrom(ref);
    } else if (trace.from.canvasId === ref.canvasId && trace.from.key === ref.key) {
      setPathNotice("Pick a different end: that's where the path starts.");
    } else if (traceResult?.status === "picking" && !traceResult.reach.has(reachKey({ canvasId: ref.canvasId, id: node.id }))) {
      setPathNotice(`${node.label} can't be reached from ${trace.from.label}.`);
    } else {
      setPathNotice(null);
      lensPanel.traceTo(ref);
    }
  };
  // L5: the code a Repo Map `code` card holds for this source, when the map has one (Phase 2).
  const sourceCode = useMemo(() => {
    if (!view?.source) return undefined;
    const elements = scenes.elements(view.frame.canvasId) ?? [];
    return mapCodeFor(view.source.evidence, elements, scenes.getDocument ?? (() => undefined));
  }, [view, scenes]);
  const hood = useMemo(() => {
    if (!view || !selectedNode) return undefined;
    return nodeNeighborhood({ frameId: view.frame.frameId, title: view.title, nodes: view.nodes, edges: view.edges }, selectedNode.id);
  }, [view, selectedNode]);
  const keyOf = (id: string) => view?.nodes.find((n) => n.id === id)?.key ?? id;

  const soleDrillable = view && !selectedNode ? view.nodes.filter((n) => drillTarget(n)) : [];
  const drillNextKey = selectedNode && drillTarget(selectedNode) ? selectedNode.key : soleDrillable.length === 1 ? soleDrillable[0]!.key : undefined;
  // The level that step lands on, as Lens would show it (not always current + 1: a source card is L5).
  const drillNextLevel = useMemo(() => {
    if (!root || !view || !drillNextKey) return undefined;
    const next = lensView(scenes, root, [...path, drillNextKey]);
    return next && next.crumbs.length > view.crumbs.length ? next.level : undefined;
  }, [scenes, root, path, view, drillNextKey]);
  const drillNext = () => {
    if (drillNextKey) lensPanel.drill(drillNextKey);
  };

  // A path step that no longer resolves (its node or link is gone, a linked canvas loaded without the frame, a stale
  // deep link) is dropped, so the next drill isn't appended after a dead key.
  const resolvedSteps = view && !view.loading ? view.crumbs.length - 1 : undefined;
  useLayoutEffect(() => {
    if (resolvedSteps !== undefined && resolvedSteps < path.length) lensPanel.trimPath(resolvedSteps);
  }, [resolvedSteps, path.length]);

  // Deep link: keeps the hash in sync with root/path/node once open (`LensPanelHost` restores it on load). The
  // hash names the root (crumb 0), which the path is drilled from.
  const rootKey = view?.crumbs[0]?.key;
  useLayoutEffect(() => {
    if (!rootKey) return;
    writeLensHash(rootKey, path, selectedKey, trace?.from ? { from: trace.from, to: trace.to, kind: trace.kind } : null);
  }, [rootKey, path, selectedKey, trace]);

  if (!root) return null;

  /** Closes Lens and reveals the element on its canvas, navigating there first when it's not the open one (AC9). */
  const reveal = (canvasId: string, elementId: string) => {
    lensPanel.close();
    if (canvasId !== home.canvasId) {
      requestReveal(canvasId, elementId);
      router.push(canvasPath(home.workspaceId, canvasId));
      return;
    }
    const commands = getCanvasCommands();
    if (commands?.revealNode(elementId)) return;
    commands?.revealNode(root.frameId);
  };
  const backToCanvas = () => {
    if (!view) return reveal(root.canvasId, root.frameId);
    reveal(view.frame.canvasId, selectedNode?.id ?? view.source?.node.id ?? view.frame.frameId);
  };
  const selectedDrill = selectedNode && drillTarget(selectedNode);
  const parentCrumb = view?.source ? view.crumbs.at(-2) : undefined;
  const parentLevel = parentCrumb && view?.profile.levels[parentCrumb.level];

  const levelInfo = view?.profile.levels[view.level];
  const levelLabel = levelInfo ? `${levelInfo.short} ${levelInfo.name}` : undefined;

  // ⌫ zooms out one level (plan AC5), unless the key is actually reaching a text field.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Backspace") return;
    const target = e.target as HTMLElement;
    if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
    if (path.length) {
      e.preventDefault();
      lensPanel.up(1);
    }
  };

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      data-expanded={expanded || undefined}
      aria-label={`Lens: ${view?.title ?? ""}`}
      className="acute-lens-panel acute-side-panel"
      style={expanded ? undefined : { width }}
      onKeyDown={onKeyDown}
    >
      {!expanded && (
        <div
          className="acute-side-panel__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Lens panel"
          onPointerDown={onResizeStart}
          onDoubleClick={() => setUiPref("lensPanelWidth", 640)}
        />
      )}
      <header className="acute-side-panel__bar">
        <button type="button" className={iconButton} title="Close" aria-label="Close Lens" onClick={() => lensPanel.close()}>
          <CloseIcon size={16} />
        </button>
        <button
          type="button"
          className={iconButton}
          title={expanded ? "Dock to the side" : "Expand to full width"}
          aria-label={expanded ? "Dock Lens panel" : "Expand Lens panel"}
          aria-pressed={expanded}
          onClick={() => lensPanel.setExpanded(!expanded)}
        >
          {expanded ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
        </button>
        <div className="acute-side-panel__crumb">
          <SparkleIcon size={14} />
          <span className="truncate">Lens</span>
          {view && <Breadcrumb crumbs={view.crumbs} onJump={(i) => lensPanel.jumpTo(i)} />}
        </div>
        <AgentSyncChip canvasId={home.canvasId} />
        <button type="button" className={iconButton} title="Back to canvas" aria-label="Back to canvas" onClick={backToCanvas}>
          <ArrowLeftIcon size={15} />
        </button>
      </header>
      <div className="acute-lens-panel__doc">
        {view?.loop && <p className="acute-lens-panel__loop">↻ loop — this frame already appears higher in the path.</p>}
        <nav className="acute-lens-panel__level-col" aria-label="Level and breadcrumb">
          {view && (
            <LevelRail
              profile={view.profile}
              crumbs={view.crumbs}
              currentLevel={view.level}
              reachable={reachable}
              drillNextLevel={drillNextLevel}
              onJump={(i) => lensPanel.jumpTo(i)}
              onDrillNext={drillNext}
            />
          )}
        </nav>
        <div className="acute-lens-panel__stage">
          {levelLabel && <div className="acute-lens-panel__level">{levelLabel}</div>}
          <LensAsk scenes={scenes} root={root} aiOn={aiOn} />
          {aiOn && view && <LensReview key={`review-${view.key}`} view={view} />}
          <div className="acute-lens-panel__canvas">
            {view?.loading && <p className="acute-lens-panel__loop">Loading the linked canvas…</p>}
            {view?.source ? (
              <div key={path.length} className="acute-lens-panel__frame" data-animate={reduceMotion ? undefined : ""} style={{ animationDuration: `${TRANSITION_MS}ms` }}>
                <SourceCard
                  nodeLabel={view.source.node.label}
                  parent={[parentLevel && `${parentLevel.short} ${parentLevel.name}`, parentCrumb?.title].filter(Boolean).join(" · ")}
                  evidence={view.source.evidence}
                  workspaceId={home.workspaceId}
                  {...(sourceCode ? { code: sourceCode } : {})}
                />
              </div>
            ) : view ? (
              <div
                key={path.length}
                className="acute-lens-panel__frame"
                data-animate={reduceMotion ? undefined : ""}
                style={{ animationDuration: `${TRANSITION_MS}ms` }}
              >
                <LensDiagram
                  view={view}
                  selectedKey={selectedKey}
                  hood={hood}
                  hoveredEdgeId={hoveredEdge}
                  onSelect={onSelectNode}
                  onDrill={(key) => lensPanel.drill(key)}
                  onHoverEdge={setHoveredEdge}
                  zoom={zoom}
                  {...(marks ? { marks } : {})}
                  {...(pendingView ? { pending: pendingView } : {})}
                  {...(onOpenCanvas ? { stale: staleIds, affected: affectedIds } : {})}
                />
              </div>
            ) : (
              <p className="acute-lens-panel__empty">{scenes.isLoading?.(root.canvasId) ? "Loading the linked canvas…" : "This frame is no longer on the canvas."}</p>
            )}
            {!view?.source && (
              <button
                type="button"
                className="acute-lens-panel__path"
                aria-pressed={!!trace}
                title={trace ? "Stop tracing a path" : "Trace a path between two nodes, on any level"}
                onClick={() => {
                  setPathNotice(null);
                  if (trace) lensPanel.clearOverlays();
                  else lensPanel.beginTrace();
                }}
              >
                ⇢ Path
              </button>
            )}
            {!view?.source && (
            <div className="acute-lens-panel__zoom" role="group" aria-label="Visual zoom">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10))}>
                −
              </button>
              <button type="button" className="acute-lens-panel__zoom-value" title="Reset zoom" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10))}>
                +
              </button>
            </div>
            )}
          </div>
          <ChangesDrawer
            home={home}
            view={view}
            pending={pendingView}
            stale={onOpenCanvas ? staleIds : new Set()}
            open={drawerOpen}
            tab={drawerTab}
            onToggle={() => setDrawerOpen((o) => !o)}
            onTab={setDrawerTab}
            workspace={workspace}
            onGo={goTo}
          />
        </div>
        <div className="acute-lens-panel__inspector">
          {trace && (
            <TraceCard
              key={`${trace.from ? `${trace.from.canvasId}/${trace.from.key}` : ""}>${trace.to ? `${trace.to.canvasId}/${trace.to.key}` : ""}`}
              trace={trace}
              result={traceResult}
              workspace={workspace}
              notice={pathNotice}
              onGo={goTo}
            />
          )}
          {impact && <ImpactCard node={impact} result={impactResult} onGo={goTo} />}
          {!trace && !impact && highlight.length > 0 && (
            <section className="acute-lens-overlay" aria-label="Highlighted by your agent">
              <div className="acute-lens-overlay__head">
                <span>
                  {highlight.length} highlighted by your IDE agent
                </span>
                <button type="button" onClick={() => lensPanel.clearOverlays()}>
                  Clear
                </button>
              </div>
            </section>
          )}
          {view?.source ? (
            <EvidenceList evidence={view.source.node.evidence} workspaceId={home.workspaceId} onShowOnCanvas={(ref) => reveal(ref.canvasId, ref.elementId)} />
          ) : hood && selectedNode ? (
            <>
              <Passport
                frameTitle={view!.title}
                hood={hood}
                onHoverEdge={setHoveredEdge}
                onGoTo={(id) => lensPanel.select(keyOf(id))}
                onClose={() => lensPanel.select(null)}
              />
              {/* Node actions (D16): only the ones whose phase has shipped. */}
              <div className="acute-lens-panel__actions" role="group" aria-label="Node actions">
                {selectedDrill && (
                  <button
                    type="button"
                    className="acute-lens-panel__zoom-in"
                    title={selectedDrill === "source" ? "Show its source (L5)" : selectedNode.childFrame?.pending ? "On another canvas" : undefined}
                    onClick={() => lensPanel.drill(selectedNode.key)}
                  >
                    ✨ Zoom in ▸
                  </button>
                )}
                <button type="button" className="acute-lens-panel__zoom-in" aria-pressed={showEvidence} onClick={() => setShowEvidence((v) => !v)}>
                  📄 Evidence
                </button>
                <button
                  type="button"
                  className="acute-lens-panel__zoom-in"
                  title="The path from this node to another, on any level"
                  onClick={() => {
                    setPathNotice(null);
                    lensPanel.startTrace({ canvasId: view!.frame.canvasId, key: selectedNode.key, label: selectedNode.label });
                  }}
                >
                  ⇢ Trace
                </button>
                <button
                  type="button"
                  className="acute-lens-panel__zoom-in"
                  aria-pressed={impact?.canvasId === view!.frame.canvasId && impact.key === selectedNode.key}
                  title="What changing this node affects"
                  onClick={() => lensPanel.showImpact({ canvasId: view!.frame.canvasId, key: selectedNode.key, label: selectedNode.label })}
                >
                  ◎ Impact
                </button>
                {aiOn && <LensExplain key={`explain-${selectedNode.id}`} home={home} view={view!} node={selectedNode} detailLabels={childLabels} />}
                {aiOn && <LensGenerate key={`generate-${selectedNode.id}`} api={api} home={home} view={view!} node={selectedNode} root={root} path={path} />}
              </div>
              <AIGeneratedNote node={selectedNode} />
              {showEvidence && <EvidenceList evidence={selectedNode.evidence} workspaceId={home.workspaceId} onShowOnCanvas={(ref) => reveal(ref.canvasId, ref.elementId)} />}
              <ProjectInspector
                key={selectedNode.id}
                api={api}
                node={selectedNode}
                home={home}
                editable={view!.frame.canvasId === home.canvasId}
                revision={sceneVersion}
                onShowOnCanvas={(ref) => reveal(ref.canvasId, ref.elementId)}
              />
            </>
          ) : (
            <p className="acute-lens-panel__inspector-empty">Select a node to see its details and relationships.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
