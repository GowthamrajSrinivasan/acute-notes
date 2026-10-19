"use client";

// Must run before Excalidraw (and browser-fs-access) evaluate.
import "./fileAccessPolicy";
import { CaptureUpdateAction, Excalidraw, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawEmbeddableElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostPropsFor } from "@/components/blocks/hostProps";
import { RichBlockHost } from "@/components/blocks/RichBlockHost";
import { WebEmbedHost } from "@/components/blocks/WebEmbedHost";
import { PagePreviewHost } from "@/components/pages/PagePreviewHost";
import { ObjectSection } from "@/components/properties/ObjectSection";
import { ShapeSection } from "@/components/properties/ShapeSection";
import {
  selectedBlockStore,
  selectedNativeTextStore,
  selectedObjectStore,
  selectionStore,
} from "@/components/properties/selectedBlockStore";
import { TextSection } from "@/components/properties/TextSection";
import { AskAISection } from "@/components/ai/AskAISection";
import { getPendingChanges, sessionSlot, slotOf } from "@/ai/changes/pendingChanges";
import { isAIFeatureEnabled } from "@/config/features";
import { getCurrentContext, registerCurrentContextSource } from "@/mcp/context/currentContextSource";
import { registerLiveCanvasActions } from "@/mcp/tools/liveCanvas";
import { gatherRenderContext } from "./renderPlanContext";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import { AIPanel } from "@/components/ai/AIPanel";
import { SectionOverview } from "@/components/ai/SectionOverview";
import { AIChangeMarkers } from "@/components/ai/AIChangeMarkers";
import { DenseBlocks } from "@/components/ai/DenseBlocks";
import { ChangeSetReview } from "@/components/ai/ChangeSetReview";
import { acceptPendingParts, acceptPendingSet } from "@/components/ai/acceptPending";
import { StaleMarkers } from "@/components/ai/StaleMarkers";
import { registerReviewActions } from "@/components/ai/reviewActions";
import { recordSettled } from "@/state/agentLog";
import { agentSync } from "@/state/agentSync";
import { staleMarkers } from "@/components/ai/staleMarkersStore";
import { VisualizeDialog } from "@/components/ai/VisualizeDialog";
import { VisualizeHint } from "@/components/ai/VisualizeHint";
import { ProvenanceSection } from "@/components/properties/ProvenanceSection";
import { DeletedConversationsPrompt } from "@/components/ai/DeletedConversationsPrompt";
import { getArrowRelation, getEmbedRef, isAcuteLink, type SceneElement } from "@/domain/canvas/adapter";
import { isCompositeShape } from "@/domain/canvas/compositeShapes";
import { diagramArrowInfo, diagramSelectionTarget, selectedDiagramObject } from "@/components/diagram/diagramSelection";
import { DiagramOverlay } from "@/components/diagram/DiagramOverlay";
import { LensPanelHost } from "@/components/lens/LensPanelHost";
import { FlashOverlay } from "./FlashOverlay";
import { getImportedHtml, isWebLink, withImportedHtml } from "@/domain/canvas/webEmbed";
import type { CanvasDocument, DocumentHome } from "@/domain/types";
import { createPage } from "@/domain/pages/pageCommands";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { pagePanel } from "@/state/pagePanel";
import { documentRegistry } from "@/sync/documentRegistry";
import { trackPendingWork } from "@/sync/pendingWork";
import type { CanvasHistory, HistoryElement } from "@/history/canvasHistory";
import { createExcalidrawHistory } from "@/history/excalidrawHistory";
import { createArrowModeSync, routeNewArrows } from "./architectureArrows";
import { ArrowToolMenu } from "./ArrowToolMenu";
import { BlockToolButton } from "./BlockToolButton";
import { createBrokenImageGuard } from "./brokenImages";
import type { BlockMenuChoice } from "./BlockMenu";
import { CanvasBridgeContext, type CanvasBridge } from "./CanvasBridge";
import { registerCanvasCommands } from "./canvasCommands";
import { CanvasSession } from "./CanvasSession";
import { rerouteAround } from "./connectorRoutes";
import { installClickToEdit } from "./clickToEdit";
import { createCompositeShapes, insertCompositeShape } from "./compositeShapes";
import { guardPageDeletion, installPageDeletionGuard } from "./pageDeletion";
import { watchReferencedRemovals } from "@/components/lens/refNotice";
import { flashStore } from "./flashStore";
import { findPagePreviews, insertPagePreview, revealElement, togglePagePreview } from "./pagePreviews";
import { HistoryButtons } from "./HistoryButtons";
import { installShortcuts, isMac, modKey, plainKey } from "./shortcuts";
import {
  activateEmbeddable,
  deactivateEmbeddable,
  finishTextItem,
  getSelectedAcuteEmbeddable,
  growFrameToFit,
  makeRoomForFrame,
  handleDuplicate,
  insertRichBlock,
  replaceElement,
  resizeElement,
  StrokeToSelection,
  updateBlockStyle,
} from "./richBlocks";
import { handleCanvasPaste, installTextShortcuts } from "./textParity";
import { convertNativeTexts, isFreeNativeText, NativeTextIntake } from "./convertNativeText";
import { NativeTextTakeover } from "./textTool";
import { VisualizeToolButton } from "./VisualizeToolButton";
import { FindOverlay } from "@/search/FindOverlay";
import { scaleInlineFontSizeStored, scaleSize } from "@/state/inlineStyles";
import { canvasPath } from "@/workspaces/paths";

// Image export (html-to-image + the offscreen renderer) loads when the dialog first opens.
const ExportDialog = lazy(() => import("@/export/ExportDialog").then((m) => ({ default: m.ExportDialog })));

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Fonts are self-hosted from /public/fonts so the canvas works offline.
if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;
}

const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
    toggleTheme: true,
    changeViewBackgroundColor: true,
    clearCanvas: true,
    saveAsImage: false,
  },
  tools: { image: true },
};

/**
 * Acute-owned embeds (rich blocks, page previews) and web pages. Web pages are
 * hosted by `WebEmbedHost`, which handles sites that refuse to be framed.
 */
const validateEmbeddable = (link: string) => isAcuteLink(link) || isWebLink(link);

function applyDocumentTheme(theme: string) {
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
}

/** Hosted content for Acute embeddables. Must return a node, or Excalidraw renders an iframe. */
function renderEmbeddable(element: NonDeleted<ExcalidrawEmbeddableElement>, appState: AppState) {
  const ref = getEmbedRef(element);
  const active = appState.activeEmbeddable?.state === "active" && appState.activeEmbeddable.element.id === element.id;
  if (ref?.kind === "rich-block") return <RichBlockHost {...hostPropsFor(element, ref, appState.theme, active)} />;
  if (ref?.kind === "page-preview") {
    return (
      <PagePreviewHost
        elementId={element.id}
        pageId={ref.pageId}
        preview={ref.preview}
        theme={appState.theme}
        background={element.fillStyle === "solid" ? element.backgroundColor : "transparent"}
        selected={!!appState.selectedElementIds[element.id]}
      />
    );
  }
  if (!ref && isWebLink(element.link)) {
    const imported = getImportedHtml(element);
    return (
      <WebEmbedHost
        elementId={element.id}
        url={element.link}
        html={imported?.html}
        htmlName={imported?.name}
        active={active}
        selected={!!appState.selectedElementIds[element.id]}
        theme={appState.theme}
      />
    );
  }
  return <div className="acute-block acute-block--unknown">Unsupported embed</div>;
}

/** `?acuteDev` enables the dev hooks for the rest of the tab (the canvas redirect drops the query). */
function devHooksRequested(): boolean {
  try {
    if (new URLSearchParams(location.search).has("acuteDev")) sessionStorage.setItem("acuteDev", "1");
    return sessionStorage.getItem("acuteDev") === "1";
  } catch {
    return new URLSearchParams(location.search).has("acuteDev");
  }
}

export function ExcalidrawCanvas({ canvas }: { canvas: CanvasDocument }) {
  const [session, setSession] = useState<CanvasSession | null>(null);

  // One session per canvas; disposal flushes pending local writes.
  useEffect(() => {
    let cancelled = false;
    let opened: CanvasSession | null = null;
    performance.mark("acute:canvas-open");
    CanvasSession.open(canvas, getPersistence()).then(
      (s) => {
        opened = s;
        performance.measure("acute:session-load", "acute:canvas-open");
        if (cancelled) void s.dispose();
        else {
          applyDocumentTheme(s.theme);
          setSession(s);
        }
      },
      (err: unknown) => console.error("[acute-notes] Failed to open canvas", err),
    );
    return () => {
      cancelled = true;
      if (opened) trackPendingWork(opened.dispose());
      setSession(null);
    };
    // Re-open only when switching canvases, not on metadata updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.id]);

  // Flush when the tab is hidden or closed so at most ~100 ms of edits are at risk.
  useEffect(() => {
    if (!session) return;
    const flush = () => {
      void session.flush();
      void getDocumentStore().flush();
      void documentRegistry.flushAll();
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);

  if (!session) return <div className="absolute inset-0 bg-[var(--acute-bg)]" aria-busy="true" />;
  return <SessionCanvas key={canvas.id} session={session} workspaceId={canvas.workspaceId} canvasId={canvas.id} />;
}

function SessionCanvas({ session, workspaceId, canvasId }: { session: CanvasSession; workspaceId: string; canvasId: string }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  // initialData must be computed once per mount.
  const [initialData] = useState(() => session.getInitialData());
  const themeRef = useRef<string | null>(null);
  const selectionRef = useRef<AppState["selectedElementIds"] | null>(null);
  const [strokeToSelection] = useState(() => new StrokeToSelection());
  const [brokenImages] = useState(createBrokenImageGuard);
  const [arrowMode] = useState(createArrowModeSync);
  const [composites] = useState(createCompositeShapes);
  // Where new and copied blocks/pages of this canvas live (SessionCanvas is keyed by canvas).
  const [home] = useState<DocumentHome>(() => ({ workspaceId, canvasId }));
  const [textTakeover] = useState(() => new NativeTextTakeover(home));
  // Free native text arriving from any source (paste from Excalidraw, library, file drop) becomes Acute text.
  const [textIntake] = useState(() => new NativeTextIntake(home, initialData.elements ?? []));
  // Unified undo/redo for elements and block content (replaces Excalidraw's history).
  const [excalidrawHistory] = useState(createExcalidrawHistory);
  const { history } = excalidrawHistory;
  const historyReadyRef = useRef(false);
  useEffect(() => history.connect(), [history]);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const activeRef = useRef<string | null>(null);
  const resizingRef = useRef<string | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Element geometry at the last pointer-down (to measure a finished resize). */
  const originalsRef = useRef<ReadonlyMap<string, { x: number; y: number; width: number; height: number; type: string }> | null>(null);

  const handleApi = useCallback(
    (a: ExcalidrawImperativeAPI) => {
      setApi(a);
      apiRef.current = a;
      session.attach(a);
      excalidrawHistory.attach(a);
    },
    [session, excalidrawHistory],
  );

  // onChange fires on every scene/appState update (incl. pointer moves):
  // keep it O(1)-ish and never set React state here.
  const handleChange = useCallback<NonNullable<React.ComponentProps<typeof Excalidraw>["onChange"]>>(
    (elements, appState: AppState, files) => {
      if (appState.theme !== themeRef.current) {
        themeRef.current = appState.theme;
        applyDocumentTheme(appState.theme);
      }
      const api = apiRef.current;
      const active = appState.activeEmbeddable?.state === "active" ? appState.activeEmbeddable.element.id : null;

      // Selected Acute item → Text panel section + CSS state (hide the internal
      // hyperlink popup; hide frame controls for frameless text).
      const ids = Object.keys(appState.selectedElementIds);
      const single = ids.length === 1 ? elements.find((el) => el.id === ids[0] && !el.isDeleted) : undefined;
      const ref = single?.type === "embeddable" ? getEmbedRef(single) : null;
      const block = ref?.kind === "rich-block" ? ref : null;
      selectedBlockStore.set(
        block && single
          ? {
              elementId: single.id,
              documentId: block.documentId,
              style: block.style,
              active: active === single.id,
              ...(block.href ? { href: block.href } : {}),
            }
          : null,
      );
      // An open page panel follows the selected preview, so after a duplicate
      // the panel edits the selected copy rather than the original.
      const panel = pagePanel.get();
      if (ref?.kind === "page-preview" && single && panel.pageId && panel.pageId !== ref.pageId) {
        const pageId = ref.pageId;
        const elementId = single.id;
        queueMicrotask(() => pagePanel.open(pageId, { elementId }));
      }
      const diagramTarget = diagramSelectionTarget(elements as unknown as readonly SceneElement[], ids, single as unknown as SceneElement | undefined);
      selectedNativeTextStore.set(single?.type === "text" && !single.containerId ? single.id : null);
      selectedObjectStore.set(
        single?.type === "arrow"
          ? {
              kind: "arrow",
              elementId: single.id,
              connected: !!(single.startBinding && single.endBinding),
              ...(getArrowRelation(single) ? { relation: getArrowRelation(single) } : {}),
              ...diagramArrowInfo(elements as unknown as readonly SceneElement[], single as unknown as SceneElement),
            }
          : ref?.kind === "page-preview" && single
            ? { kind: "page", elementId: single.id, pageId: ref.pageId, preview: ref.preview }
            : diagramTarget
              ? selectedDiagramObject(elements as unknown as readonly SceneElement[], diagramTarget)
              : null,
      );
      if (appState.selectedElementIds !== selectionRef.current || block) {
        selectionRef.current = appState.selectedElementIds;
        selectionStore.set(appState.selectedElementIds);
        const html = document.documentElement;
        html.toggleAttribute("data-acute-block-selected", !!ref);
        html.toggleAttribute("data-acute-frameless-selected", block?.style.frame === "none");
      }

      if (api) {
        // Pages are edited in the side panel, never in place: any activation
        // (click in the centre, double-click, Enter, the ↗ icon) opens the page.
        if (active && active !== activeRef.current) {
          const activated = elements.find((el) => el.id === active);
          const activatedRef = activated && getEmbedRef(activated);
          if (activatedRef?.kind === "page-preview") {
            queueMicrotask(() => {
              api.updateScene({
                appState: { activeEmbeddable: null, selectedElementIds: { [active]: true } },
                captureUpdate: CaptureUpdateAction.NEVER,
              });
              pagePanel.open(activatedRef.pageId, { elementId: active });
            });
          }
        }
        strokeToSelection.handleChange(api, elements, active);
        brokenImages.handleChange(api, elements, files);
        arrowMode.handleChange(api, appState);
        // A resized, rotated or restyled composite shape's (cylinder's) outline follows its host.
        composites.handleChange(api, elements, appState);
        // Free-standing Excalidraw text becomes Acute rich text.
        textTakeover.handleChange(api, appState);
        textIntake.handleChange(api, elements, appState);

        // A text item that stops being edited: drop it if empty, else commit it.
        if (activeRef.current && activeRef.current !== active) {
          const finished = activeRef.current;
          // After React unmounts the editor (which flushes its snapshot).
          setTimeout(() => finishTextItem(api, finished), 50);
        }

        // Resizing a text item works like native text: a corner drag (height
        // changes) scales the font; a side drag sets a fixed wrap width.
        const resizing = appState.resizingElement?.id ?? null;
        if (resizingRef.current && resizingRef.current !== resizing) {
          const resized = elements.find((el) => el.id === resizingRef.current);
          const original = originalsRef.current?.get(resizingRef.current);
          const resizedRef = resized && getEmbedRef(resized);
          if (resized && original && resizedRef?.kind === "rich-block" && resizedRef.style.frame === "none") {
            const { id } = resized;
            const { documentId, style } = resizedRef;
            const factor = resized.height / original.height;
            if (Math.abs(resized.height - original.height) > 1 && Number.isFinite(factor) && factor > 0) {
              queueMicrotask(() => {
                updateBlockStyle(api, id, { fontSize: scaleSize(style.fontSize, factor) }, CaptureUpdateAction.EVENTUALLY);
                scaleInlineFontSizeStored(documentId, factor);
              });
            } else if (style.autoWidth) {
              queueMicrotask(() => updateBlockStyle(api, id, { autoWidth: false }, CaptureUpdateAction.EVENTUALLY));
            }
          } else if (resized && original && resizedRef?.kind === "rich-block" && resizedRef.style.autoHeight && Math.abs(resized.height - original.height) > 1) {
            // A card the user resized by hand keeps that size: it stops following its content.
            const { id } = resized;
            queueMicrotask(() => updateBlockStyle(api, id, { autoHeight: false }, CaptureUpdateAction.EVENTUALLY));
          }
        }
        resizingRef.current = resizing;
      }
      activeRef.current = active;
      if (api) {
        const scene = api.getSceneElementsIncludingDeleted();
        if (!historyReadyRef.current) {
          historyReadyRef.current = true;
          history.init(scene);
          // First scene render: the canvas is visible and interactive.
          if (performance.getEntriesByName("acute:canvas-open").length) performance.measure("acute:canvas-ready", "acute:canvas-open");
        } else {
          history.observe(scene, {
            interacting: appState.cursorButton === "down" || appState.multiElement !== null,
            editing: active !== null || !!appState.editingTextElement,
          });
        }
      }
      session.handleChange(elements, appState, files);
    },
    [session, strokeToSelection, brokenImages, arrowMode, composites, textTakeover, textIntake, history],
  );

  const bridge = useMemo<CanvasBridge>(
    () => ({
      deactivate: (id) => api && deactivateEmbeddable(api, id),
      // Auto-size is a consequence, not an action: never an undo step of its own.
      resize: (id, width, height) => {
        if (!api) return;
        const before = api.getSceneElements().find((el) => el.id === id)?.version;
        resizeElement(api, id, width, height);
        if (before !== undefined) history.absorbIfClean(id, before);
        // …and so is its section frame growing with it, rather than clipping it.
        const frame = growFrameToFit(api, id);
        if (frame) history.absorbIfClean(frame.id, frame.version);
        // …and so are the sections it now reaches moving out of its way, contents and all, rather than overlapping.
        const room = frame ? makeRoomForFrame(api, frame.id, frame.before) : { changed: [], frames: [] };
        for (const el of room.changed) history.absorbIfClean(el.id, el.version);
        // …and so are the right-angle routes of Acute's connectors attached to it, and to the sections that moved (Wave 1b).
        for (const arrow of rerouteAround(api, [id, ...(frame ? [frame.id] : []), ...room.frames])) history.absorbIfClean(arrow.id, arrow.version);
      },
      togglePagePreview: (id) => api && togglePagePreview(api, id),
      setImportedHtml: (id, imported) =>
        api &&
        replaceElement(
          api,
          id,
          (e) => newElementWith(e, { customData: withImportedHtml(e.customData, imported) }),
          CaptureUpdateAction.IMMEDIATELY,
        ),
    }),
    [api, history],
  );

  // The ↗ icon Excalidraw draws for linked elements doubles as "open": for an
  // Acute block it starts editing instead of navigating to the internal link.
  const handleLinkOpen = useCallback<NonNullable<React.ComponentProps<typeof Excalidraw>["onLinkOpen"]>>(
    (element, event) => {
      if (!api || !getEmbedRef(element)) return;
      event.preventDefault();
      activateEmbeddable(api, element.id);
    },
    [api],
  );

  const handleBlockChoice = useCallback(
    (choice: BlockMenuChoice) => {
      if (!api) return;
      if (isCompositeShape(choice)) {
        insertCompositeShape(api, choice);
        return;
      }
      if (choice === "page") {
        const pageId = createPage(home.workspaceId, home.canvasId);
        const elementId = insertPagePreview(api, pageId);
        pagePanel.open(pageId, { elementId, focusTitle: true });
        return;
      }
      insertRichBlock(api, home, choice);
    },
    [api, home],
  );
  const onDuplicate = useCallback(
    (next: Parameters<typeof handleDuplicate>[0], prev: Parameters<typeof handleDuplicate>[1]) =>
      handleDuplicate(next, prev, home),
    [home],
  );

  // Performance hooks (synthetic workloads): dev builds, or production with ?acuteDev.
  useEffect(() => {
    const enabled = process.env.NODE_ENV !== "production" || devHooksRequested();
    if (!enabled || !api) return;
    void import("@/performance/synthetic").then((m) => {
      (window as unknown as Record<string, unknown>).__acuteDev = {
        seed: (spec: import("@/performance/synthetic").SeedSpec) => textIntake.keepNative(api, () => m.seed(api, home, spec)),
        addTextItems: (n: number) => m.addSyntheticTextItems(api, home, n),
        addNativeText: (n: number) => textIntake.keepNative(api, () => m.addSyntheticNativeText(api, home, n)),
        measurePan: (ms?: number) => m.measurePan(api, ms),
        measureZoom: (ms?: number) => m.measureZoom(api, ms),
        measurePersistence: () => m.measurePersistence(api, () => session.flush()),
        sweep: (ms?: number) => m.sweep(api, ms),
        recordFrames: m.recordFrames,
        watchWork: m.watchWork,
        recordKeyLatency: m.recordKeyLatency,
        store: getDocumentStore(),
        memory: m.memory,
        domCounts: m.domCounts,
        timings: m.timings,
        fit: () => api.scrollToContent(undefined, { fitToContent: true }),
        api,
        history,
        fontCss: () => import("@/export/exportImage").then((e) => e.fontCssForDebug(api)),
        raster: (id: string) => import("@/export/exportImage").then((e) => e.rasteriseElementForDebug(api, id)),
        /** AI conversation store (F40), for tests that need saved conversations without calling AI. */
        conversations: getConversationStore(),
        /** Puts an AI change set up for review on this canvas (F19), as an AI action would. */
        proposeChanges: (set: unknown) => getPendingChanges().propose(home.canvasId, set),
        /** `acute://context/current` as the MCP server (F20) will serve it (F25). */
        currentContext: () => getCurrentContext(getPersistence()),
        /** An object's reconciliation link (F37) and its current content fingerprint, for tests. */
        reconciliation: (elementId: string) =>
          Promise.all([import("@/domain/provenance"), import("@/ai/reconcile/objects")]).then(([{ reconciliationOf }, o]) => {
            const elements = api.getSceneElements() as unknown as readonly SceneElement[];
            const el = elements.find((e) => e.id === elementId);
            if (!el) return null;
            const get = (id: string) => getDocumentStore().get(id);
            const content = o.objectContent(el, o.labelsByContainer(elements), get);
            return { link: reconciliationOf(el, get) ?? null, current: content ? o.fingerprintOf(content) : null };
          }),
        /** The last topic merge's diagnostics (G2/G3): who answered (Jev or the chat task), conflicts picked, choices shown — for tests. */
        lastMerge: () => import("@/ai/merge/merge").then((m) => m.lastMergeDiagnostics()),
        /** Per-stage AI call counts, tokens and list-price cost estimates since the page loaded (or the last `callStats(true)`), for cost diagnostics. */
        callStats: (clear?: boolean) =>
          import("@/ai/usage/callLog").then((m) => {
            const log = m.getCallLog();
            const summary = { ...m.summarizeCalls(log.records()), records: [...log.records()] };
            if (clear) log.clear();
            return summary;
          }),
        /** A content source (F37) and its latest accepted version, for tests. */
        contentSource: (sourceId: string) => import("@/ai/content/sources").then((m) => m.loadLatest(getPersistence().contentSources, sourceId)),
        /** Content parser + local plan (F28), run in its Web Worker. */
        analyzeContent: (input: string, format?: "markdown" | "plain") =>
          import("@/ai/content/analyze").then((c) => c.analyzeContent(input, format ? { format } : {})),
        /**
         * Validates a raw VisualPlan (F29), renders it against this canvas's
         * real geometry (F30) and puts the result up for review (F19) — the
         * whole content-to-canvas pipeline except the AI call itself.
         */
        renderPlan: (rawPlan: unknown, provenance: { operationId: string; title: string; metadata: { createdBy: "ai" | "import" | "mcp" } & Record<string, unknown> }) =>
          Promise.all([import("@/ai/visual-plan/validate"), import("@/ai/renderer/render"), import("./renderPlanContext")]).then(
            async ([{ validateVisualPlan }, { renderVisualPlan }, { gatherRenderContext }]) => {
              const { plan, warnings } = validateVisualPlan(rawPlan);
              const set = await renderVisualPlan(plan, { ...provenance, context: gatherRenderContext(api) });
              getPendingChanges().propose(home.canvasId, set);
              return { warnings };
            },
          ),
        /** Creates and opens a new "AI test canvas" in this workspace, filled with every object type. */
        createDemoCanvas: () =>
          import("@/dev/demoCanvas").then(async (d) => {
            const canvasId = await d.requestDemoCanvas(home.workspaceId);
            window.location.assign(canvasPath(home.workspaceId, canvasId));
          }),
      };
    });
  }, [api, home, history, session, textIntake]);

  // A canvas created by "Create AI test canvas" (dev) fills itself on first open; its native text stays native.
  useEffect(() => {
    if (!api || process.env.NODE_ENV === "production" || !isAIFeatureEnabled()) return;
    void textIntake.keepNative(api, () => import("@/dev/demoCanvas").then((m) => m.seedPendingDemoCanvas(api, home)));
  }, [api, home, textIntake]);

  // Navigator / page panel / header menu → canvas.
  useEffect(() => {
    if (!api) return;
    return registerCanvasCommands({
      home: () => home,
      insertPagePreview: (pageId) => void insertPagePreview(api, pageId),
      flush: () => session.flush(),
      revealPage: (pageId) => {
        const [preview] = findPagePreviews(api, pageId);
        if (preview) revealElement(api, preview);
        return !!preview;
      },
      revealNode: (elementId) => {
        const el = api.getSceneElements().find((e) => e.id === elementId);
        if (!el) return false;
        revealElement(api, el);
        flashStore.flash(elementId);
        return true;
      },
      openExportImage: () => setExportOpen(true),
      // Like Excalidraw's "Reset the canvas": everything is deleted in one undoable step.
      resetCanvas: () =>
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted().map((el) => (el.isDeleted ? el : newElementWith(el, { isDeleted: true }))),
          appState: { selectedElementIds: {}, activeEmbeddable: null },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        }),
      // Older canvases keep their native text until asked; shape/arrow labels stay native.
      convertAllNativeText: () => {
        const ids = api.getSceneElements().filter(isFreeNativeText).map((el) => el.id);
        const count = convertNativeTexts(api, home, ids).size;
        api.setToast({
          message: count ? `Converted ${count} text ${count === 1 ? "item" : "items"} to rich text (Ctrl+Z undoes this)` : "No plain text to convert on this canvas",
          duration: 3000,
        });
        return count;
      },
      notify: (message) => api.setToast({ message, closable: true, duration: 8000 }),
      getTheme: () => api.getAppState().theme,
      setTheme: (theme) => api.updateScene({ appState: { theme } }),
      getBackground: () => api.getAppState().viewBackgroundColor,
      setBackground: (color) => api.updateScene({ appState: { viewBackgroundColor: color } }),
    });
  }, [api, home, session]);

  // What the user is looking at, for `acute://context/current` (F25); read only on request.
  useEffect(() => {
    if (!api) return;
    return registerCurrentContextSource(() => {
      const s = api.getAppState();
      const zoom = s.zoom.value;
      return {
        ...home,
        elements: api.getSceneElements() as unknown as readonly SceneElement[],
        selectedIds: Object.keys(s.selectedElementIds),
        viewport: { x: -s.scrollX, y: -s.scrollY, width: s.width / zoom, height: s.height / zoom },
        openPageId: pagePanel.get().pageId,
        getDocument: (id) => getDocumentStore().get(id),
      };
    });
  }, [api, home]);

  // Repo map stale markers (F43) outlive a reload, device-locally.
  useEffect(() => {
    if (!isAIFeatureEnabled()) return;
    void staleMarkers.restore(home.canvasId, getPersistence().meta).catch((err: unknown) => console.error("[acute-notes] Failed to load stale markers", err));
  }, [home.canvasId]);

  // What MCP tools (F21) may do here: read the live scene and put change sets up for review — never apply them.
  useEffect(() => {
    if (!api || !isAIFeatureEnabled()) return;
    return registerLiveCanvasActions({
      workspaceId: home.workspaceId,
      canvasId: home.canvasId,
      elements: () => api.getSceneElements() as unknown as readonly SceneElement[],
      renderContext: () => gatherRenderContext(api),
      // One set per producer session (D40): a session is "reviewing" while its own slot holds a set.
      isReviewing: (session) => getPendingChanges().inSlot(home.canvasId, sessionSlot(session)) !== null,
      // Every MCP write is staged first (then auto-accepted, when the user allowed it): Agent Sync's signal (Phase 4).
      propose: (set) => {
        getPendingChanges().propose(home.canvasId, set);
        agentSync.touch(home.canvasId);
      },
      acceptSet: (operationId) => acceptPendingSet(api, home, history, operationId) !== null,
      // Repo maps (F43): stage by merging into the one pending set; write only for a session the user set to auto-accept.
      getDocument: (id) => getDocumentStore().get(id),
      pending: (mergeKey) => (mergeKey ? getPendingChanges().inSlot(home.canvasId, slotOf({ mergeKey })) : getPendingChanges().get(home.canvasId)),
      merge: (set) => {
        getPendingChanges().merge(home.canvasId, set);
        agentSync.touch(home.canvasId);
      },
      dropParts: (mergeKey, keys) => getPendingChanges().dropParts(home.canvasId, mergeKey, keys),
      acceptParts: (keys, mergeKey) => {
        const done = acceptPendingParts(api, home, history, keys, new Map(), mergeKey);
        return done ? { stepId: done.stepId, applied: done.applied.length } : null;
      },
      setStale: (ids, ancestorIds) => staleMarkers.set(home.canvasId, ids, ancestorIds ?? []),
      clearStale: (ids) => staleMarkers.clear(home.canvasId, ids),
    });
  }, [api, home, history]);

  // The review bar's accept and reject, for Lens's Changes drawer (Agent Sync, Phase 4).
  useEffect(() => {
    if (!api) return;
    return registerReviewActions({
      canvasId: home.canvasId,
      accept: (operationId) => acceptPendingSet(api, home, history, operationId) !== null,
      reject: (operationId, reason) => {
        const set = getPendingChanges().list(home.canvasId).find((s) => s.operationId === operationId);
        if (!set) return;
        getPendingChanges().settle(home.canvasId, operationId);
        recordSettled(home, set, "rejected", reason?.trim() || undefined);
      },
    });
  }, [api, home, history]);

  // Native-text parity shortcuts (font size step, copy/paste styles).
  useEffect(() => (api ? installTextShortcuts(api) : undefined), [api]);

  // Excalidraw's "Copy to clipboard as PNG/SVG" (context menu, Shift+Alt+C) leave
  // Acute content out: run our export instead, with the same defaults.
  const copyAsImage = useCallback(
    (kind: "png" | "svg") => {
      if (!api) return;
      void import("@/export/exportImage")
        .then((m) => m.copySceneToClipboard(api, kind))
        .catch((err: unknown) => {
          console.error("[acute-notes] Copy as image failed", err);
          api.setToast({ message: "Couldn't copy to clipboard", duration: 3000 });
        });
    },
    [api],
  );
  useEffect(() => {
    if (!api) return;
    const onClick = (e: MouseEvent) => {
      const item = (e.target as Element | null)?.closest?.('.context-menu li[data-testid="copyAsPng"], .context-menu li[data-testid="copyAsSvg"]');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      api.updateScene({ appState: { contextMenu: null } });
      copyAsImage(item.getAttribute("data-testid") === "copyAsSvg" ? "svg" : "png");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [api, copyAsImage, history]);

  // Pasted text becomes an Acute text item at the pointer.
  const handlePaste = useCallback<NonNullable<React.ComponentProps<typeof Excalidraw>["onPaste"]>>(
    (data) => (api ? handleCanvasPaste(api, home, data, pointerRef.current) : true),
    [api, home],
  );
  const handlePointerDown = useCallback<NonNullable<React.ComponentProps<typeof Excalidraw>["onPointerDown"]>>(
    (_tool, pointerDownState) => {
      originalsRef.current = pointerDownState.originalElements;
    },
    [],
  );
  const handlePointerUpdate = useCallback<NonNullable<React.ComponentProps<typeof Excalidraw>["onPointerUpdate"]>>(
    ({ pointer }) => {
      pointerRef.current = { x: pointer.x, y: pointer.y };
    },
    [],
  );

  // Click an already-selected block to edit it, with the caret at the click point.
  useEffect(() => {
    const container = api && document.querySelector<HTMLElement>(".excalidraw");
    if (!api || !container) return;
    return installClickToEdit(api, container);
  }, [api]);

  // A composite shape (cylinder) resizes like one shape, and one double-click edits its label.
  useEffect(() => {
    const container = api && document.querySelector<HTMLElement>(".excalidraw");
    if (!api || !container) return;
    return composites.install(api, container);
  }, [api, composites]);

  // After the user moves or resizes objects, Acute's right-angle connectors attached to them are routed again,
  // so they keep clear of other objects (Excalidraw's own elbow routing avoids only the two ends). It joins the
  // user's step, so one undo reverts both. Arrows the user reshaped are left alone (Wave 1b).
  useEffect(() => {
    if (!api) return;
    const onUp = () => {
      const originals = originalsRef.current;
      if (!originals) return;
      requestAnimationFrame(() => {
        const moved: string[] = [];
        for (const el of api.getSceneElements()) {
          const o = originals.get(el.id);
          if (!o || el.type === "arrow" || el.type === "text") continue;
          if (o.x !== el.x || o.y !== el.y || o.width !== el.width || o.height !== el.height) moved.push(el.id);
        }
        if (moved.length) rerouteAround(api, moved);
        // Arrows just drawn with the architecture arrow tool are routed like AI connectors.
        routeNewArrows(api, originals);
      });
    };
    document.addEventListener("pointerup", onUp, true);
    return () => document.removeEventListener("pointerup", onUp, true);
  }, [api]);

  // Any user input may start a history step (changes without input are absorbed).
  useEffect(() => {
    const note = () => history.noteUserInput();
    const types = ["pointerdown", "keydown", "paste", "drop"] as const;
    for (const t of types) document.addEventListener(t, note, true);
    return () => {
      for (const t of types) document.removeEventListener(t, note, true);
    };
  }, [history]);

  // Its delete buttons ask before deleting pages too (keys: the "delete-pages" shortcut).
  useEffect(() => (api ? installPageDeletionGuard(api, home.canvasId) : undefined), [api, home.canvasId]);

  // Deleting or cutting a node other nodes `refs` says so, and points at "Move to canvas…" (plan D59).
  useEffect(() => (api ? watchReferencedRemovals(api, home) : undefined), [api, home]);

  // Excalidraw's own history is unused (its keys and buttons are replaced); keep it empty.
  useEffect(() => (api ? history.subscribe(() => api.history.clear()) : undefined), [api, history]);

  // Acute's canvas shortcuts (F15); Excalidraw keeps its native tool keys.
  useEffect(() => {
    if (!api) return;
    return installShortcuts([
      {
        id: "block-menu",
        keys: "B",
        scope: "canvas",
        matches: plainKey("b"),
        run: () => setBlockMenuOpen(true),
      },
      {
        id: "undo",
        keys: "Mod+Z",
        scope: "canvas",
        matches: (e) => modKey(e) && !e.shiftKey && !e.altKey && e.code === "KeyZ",
        run: () => {
          // Focus can sit on <body> while a block is open: close it (committing the edit) first.
          const active = api.getAppState().activeEmbeddable;
          if (active?.state === "active") deactivateEmbeddable(api, active.element.id);
          history.undo();
        },
      },
      {
        id: "redo",
        keys: isMac ? "Mod+Shift+Z" : "Mod+Y / Mod+Shift+Z",
        scope: "canvas",
        matches: (e) => modKey(e) && !e.altKey && ((e.shiftKey && e.code === "KeyZ") || (!isMac && !e.shiftKey && e.code === "KeyY")),
        run: () => history.redo(),
      },
      {
        // Deleting a page's last preview deletes the page, after confirming (see pageDeletion.ts).
        // Excalidraw still performs the delete: this only asks first, and stops it on Cancel.
        id: "delete-pages",
        keys: "Delete / Backspace",
        scope: "canvas",
        matches: (e) => (e.key === "Delete" || e.key === "Backspace") && !modKey(e),
        run: () => (guardPageDeletion(api, home.canvasId) ? false : undefined),
      },
      {
        // Excalidraw's image tool has no letter shortcut; the toolbar button opens the file picker.
        id: "image",
        keys: "I",
        scope: "canvas",
        matches: plainKey("i"),
        // Opens the picker directly, in every toolbar layout (the compact one has no image button).
        run: () => api.setActiveTool({ type: "image" }),
      },
      {
        // The eraser is not part of the MVP toolbar, so its shortcut must not pick it invisibly.
        id: "no-eraser",
        keys: "E",
        scope: "canvas",
        matches: plainKey("e"),
        run: () => undefined,
      },
      {
        // Edit the selected block / open the selected page.
        id: "open-selected",
        keys: "Enter",
        scope: "canvas",
        matches: (e) => e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey,
        run: () => {
          const el = getSelectedAcuteEmbeddable(api);
          if (!el || api.getAppState().activeEmbeddable?.element.id === el.id) return false;
          activateEmbeddable(api, el.id);
        },
      },
      {
        // Focus can fall back to <body> inside an active block (e.g. after
        // clicking a checkbox); Escape must still leave editing.
        id: "leave-editing",
        keys: "Escape",
        scope: "not-typing",
        matches: (e) => e.key === "Escape",
        run: () => {
          const active = api.getAppState().activeEmbeddable;
          if (active?.state !== "active") return false;
          deactivateEmbeddable(api, active.element.id);
        },
      },
      {
        // Find across native and Acute text (replaces Excalidraw's native-only search).
        id: "find",
        keys: "Mod+F",
        scope: "not-typing",
        matches: (e) => modKey(e) && !e.shiftKey && !e.altKey && e.code === "KeyF",
        run: () => setFindOpen(true),
      },
      {
        id: "export-image",
        keys: "Mod+Shift+E",
        scope: "not-typing",
        matches: (e) => modKey(e) && e.shiftKey && !e.altKey && e.code === "KeyE",
        run: () => setExportOpen(true),
      },
      {
        id: "copy-as-png",
        keys: "Shift+Alt+C",
        scope: "not-typing",
        matches: (e) => e.code === "KeyC" && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey,
        run: () => copyAsImage("png"),
      },
    ]);
  }, [api, copyAsImage, history, home]);

  return (
    <CanvasBridgeContext.Provider value={bridge}>
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={handleApi}
        onChange={handleChange}
        onDuplicate={onDuplicate}
        onLinkOpen={handleLinkOpen}
        onPaste={handlePaste}
        onPointerUpdate={handlePointerUpdate}
        onPointerDown={handlePointerDown}
        UIOptions={UI_OPTIONS}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable}
        aiEnabled={false}
        name="Acute-Notes"
      />
      {api && <ArrowToolMenu api={api} />}
      {api && <BlockToolButton open={blockMenuOpen} onOpenChange={setBlockMenuOpen} onSelect={handleBlockChoice} />}
      {api && <TextSection api={api} home={home} />}
      {api && <ObjectSection api={api} />}
      {api && <ShapeSection api={api} />}
      {api && <DiagramOverlay api={api} />}
      {api && <LensPanelHost api={api} home={home} />}
      {api && <FlashOverlay api={api} />}
      {/* Everything AI (built-in and MCP review), absent from a build with the AI feature off. */}
      {api && isAIFeatureEnabled() && (
        <>
          <VisualizeToolButton />
          <AskAISection api={api} />
          <ProvenanceSection api={api} home={home} history={history} />
          <AIPanel api={api} home={home} />
          <ChangeSetReview api={api} home={home} history={history} />
          <SectionOverview api={api} />
          <AIChangeMarkers api={api} canvasId={home.canvasId} />
          <DenseBlocks api={api} canvasId={home.canvasId} />
          <StaleMarkers api={api} canvasId={home.canvasId} />
          <VisualizeDialog api={api} home={home} />
          <VisualizeHint api={api} />
          <DeletedConversationsPrompt api={api} home={home} />
        </>
      )}
      {api && <HistoryButtons history={history as unknown as CanvasHistory<HistoryElement>} />}
      {api && exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog api={api} onClose={() => setExportOpen(false)} />
        </Suspense>
      )}
      {api && findOpen && <FindOverlay api={api} onClose={() => setFindOpen(false)} />}
    </CanvasBridgeContext.Provider>
  );
}
