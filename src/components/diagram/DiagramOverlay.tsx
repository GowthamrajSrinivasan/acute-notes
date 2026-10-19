"use client";

/**
 * The interactive layer of architecture diagram frames (plan: .ai/docs/interactive-architecture-frames-plan.md).
 *
 * - Under each interactive frame: a legend of the node kinds present, and the frame's info cards (read-only).
 * - On each node, once zoomed in enough to read them: its sublabel, then its tag (`nodeDetails.ts`).
 * - When one node of an interactive frame is selected: everything in the frame but the node, its neighbours and the
 *   arrows between them is dimmed, and a passport card floats next to the node — kind, sublabel, tag, details, and
 *   its incoming and outgoing relationships (hover one to highlight its arrow, click it to go to the neighbour).
 *
 * Nothing on the canvas changes: this is an overlay (the dimming never touches element opacity, which would persist
 * and sync), and only the card takes pointer events. Like `SectionOverview`, it follows pan/zoom with one transform
 * from the renderer's change event and recomputes at most once per frame when the scene changes.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { pendingFrames } from "@/domain/lens/pending";
import { agentSync, useAgentSync } from "@/state/agentSync";
import type { SceneElement } from "@/domain/canvas/adapter";
import { frameGraph, getDiagramMeta, kindCounts, NODE_KIND_LABELS, nodeNeighborhood, type DiagramGraph, type DiagramNode, type NodeNeighborhood } from "@/domain/canvas/diagram";
import { NODE_KIND_STYLES } from "@/domain/canvas/nodeKindStyle";
import { OVERVIEW_ZOOM } from "@/components/ai/SectionOverview";
import { revealElement } from "@/components/canvas/pagePreviews";
import { useSelectedObject } from "@/components/properties/selectedBlockStore";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { setFrameInteractive } from "@/components/canvas/diagramNodes";
import { frameLevels, singleScene } from "@/domain/lens/lensView";
import { lensPanel } from "@/state/lensPanel";
import { dimPath, edgePath } from "./diagramPaths";
import { detailDepth, nodeDetails, type DetailDepth } from "./nodeDetails";
import { Passport } from "./Passport";
import { RouteProbeLayer, RouteProbePanel, useRouteProbe } from "./RouteProbe";

const CARD_WIDTH = 320;
const CARD_GAP = 14;

type FrameBox = { id: string; x: number; y: number; width: number; height: number };

interface DiagramFrame {
  box: FrameBox;
  graph: DiagramGraph;
  elements: readonly SceneElement[];
  cards: NonNullable<ReturnType<typeof getDiagramMeta>>["cards"];
}

/** A frame's Lens chip (plan §5.3): `✨ L2` on an interactive frame, or a dim `✨` on a viz-ready one. */
interface FrameChip {
  box: FrameBox;
  title: string;
  /** Undefined for a viz-ready frame (not interactive yet). */
  level?: number;
}

const VIZ_READY = { nodes: 3, edges: 2 };
/** The open canvas's id isn't known (yet): a placeholder still reads its own links, just not ones that name its id. */
const OPEN = "open";

/** `canvasId` is the open canvas's real id, so a link that names it (`expandsTo.canvasId`) still counts as local. */
function frameChips(elements: readonly SceneElement[], frames: readonly DiagramFrame[], canvasId: string): FrameChip[] {
  const levels = frameLevels(singleScene(canvasId, elements), canvasId);
  const chips: FrameChip[] = frames.map((f) => ({ box: f.box, title: f.graph.title, level: levels.get(f.box.id) ?? 1 }));
  // Viz-ready (PRD §7.1): a plain frame that already reads as a diagram. No AI call, no change until clicked.
  for (const el of elements) {
    if (el.isDeleted || el.type !== "frame" || getDiagramMeta(el)?.interactive) continue;
    const graph = frameGraph(elements, el.id);
    if (graph && graph.nodes.length >= VIZ_READY.nodes && graph.edges.length >= VIZ_READY.edges) {
      chips.push({ box: { id: el.id, x: el.x, y: el.y, width: el.width, height: el.height }, title: graph.title });
    }
  }
  return chips;
}

/** What the frame chips' `Δ` depends on in the pending store: each waiting set and its size (a mapping set grows). */
function pendingSignature(canvasId: string | undefined): string {
  return canvasId ? getPendingChanges().list(canvasId).map((s) => `${s.operationId}:${s.changes.length}:${s.conflicts?.length ?? 0}`).join(" ") : "";
}

function interactiveFrames(elements: readonly SceneElement[]): DiagramFrame[] {
  return elements.flatMap((el) => {
    if (el.isDeleted || el.type !== "frame") return [];
    const meta = getDiagramMeta(el);
    const graph = meta?.interactive ? frameGraph(elements, el.id) : undefined;
    if (!meta || !graph) return [];
    return [{ box: { id: el.id, x: el.x, y: el.y, width: el.width, height: el.height }, graph, elements, cards: meta.cards }];
  });
}

export function DiagramOverlay({ api }: { api: ExcalidrawImperativeAPI }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<DiagramNode["box"] | null>(null);
  const placeRef = useRef<((s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => void) | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [zoomedOut, setZoomedOut] = useState(() => api.getAppState().zoom.value < OVERVIEW_ZOOM);
  // Reading depth: which node details (sublabel, tag) are legible at this zoom. Changes only at its thresholds.
  const [depth, setDepth] = useState<DetailDepth>(() => detailDepth(api.getAppState().zoom.value));
  // The relationship row being hovered, per node: moving to another node starts with none highlighted.
  const [hovered, setHovered] = useState<{ nodeId: string; edgeId: string } | null>(null);
  const selected = useSelectedObject();
  const selectedNode = selected?.kind === "diagram-node" ? selected : null;

  // Pan/zoom: one transform on the scene layer; the card is screen-space, placed beside its node.
  useLayoutEffect(() => {
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (layer) {
        layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
        layer.style.setProperty("--acute-diagram-zoom", String(s.zoom.value));
      }
      const card = cardRef.current;
      const box = anchorRef.current;
      if (card && box) {
        const z = s.zoom.value;
        const host = card.parentElement!.getBoundingClientRect();
        const right = (box.x + box.width + s.scrollX) * z + CARD_GAP;
        const left = (box.x + s.scrollX) * z - CARD_GAP - CARD_WIDTH;
        const x = right + CARD_WIDTH <= host.width - 8 || left < 8 ? right : left;
        const top = (box.y + s.scrollY) * z;
        const maxTop = Math.max(8, host.height - card.offsetHeight - 8);
        card.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.min(Math.max(8, top), maxTop))}px)`;
      }
      setZoomedOut(s.zoom.value < OVERVIEW_ZOOM);
      setDepth(detailDepth(s.zoom.value));
    };
    placeRef.current = place;
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

  const { frames, chips } = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    const elements = api.getSceneElements() as unknown as readonly SceneElement[];
    const frames = interactiveFrames(elements);
    return { frames, chips: frameChips(elements, frames, getCanvasCommands()?.home().canvasId ?? OPEN) };
  }, [api, sceneVersion]);

  // Agent Sync (Lens Phase 4, plan §5.3): `●` while an agent writes here, `Δ` for pending or not-yet-seen changes.
  const pendingKey = useSyncExternalStore(
    (l) => getPendingChanges().subscribe(l),
    () => pendingSignature(getCanvasCommands()?.home().canvasId),
    () => "",
  );
  const syncVersion = useAgentSync();
  const sync = useMemo(() => {
    void pendingKey; // the sets waiting changed
    void syncVersion; // an agent wrote, or a frame was seen
    void sceneVersion; // objects moved between frames
    const canvasId = getCanvasCommands()?.home().canvasId;
    if (!canvasId) return { on: false, pending: new Map<string, number>(), unseen: new Set<string>() as ReadonlySet<string> };
    const elements = api.getSceneElements() as unknown as readonly SceneElement[];
    return { on: agentSync.isOn(canvasId), pending: pendingFrames(getPendingChanges().list(canvasId), elements), unseen: agentSync.unseen(canvasId) };
  }, [api, pendingKey, syncVersion, sceneVersion]);
  const deltaOf = (frameId: string) => {
    const n = sync.pending.get(frameId) ?? 0;
    return n ? `${n}Δ` : sync.unseen.has(frameId) ? "Δ" : "";
  };

  const openChip = (chip: FrameChip) => {
    const canvasId = getCanvasCommands()?.home().canvasId;
    if (!canvasId) return;
    if (chip.level === undefined) setFrameInteractive(api, chip.box.id, true); // one undo step, the switch's own
    lensPanel.open({ canvasId, frameId: chip.box.id });
  };

  // The route probe picks by selection; while it does, the neighbourhood highlight and passport step aside.
  const probe = useRouteProbe(api, getCanvasCommands()?.home().canvasId ?? OPEN, sceneVersion, selectedNode?.elementId ?? null);
  const probing = probe.mode !== "idle";

  const focus = useMemo(() => {
    if (!selectedNode || probing) return null;
    const f = frames.find((fr) => fr.box.id === selectedNode.frameId);
    const hood = f && nodeNeighborhood(f.graph, selectedNode.elementId);
    return f && hood ? { frame: f, hood } : null;
  }, [frames, selectedNode, probing]);

  // Keep the card's anchor current, and place it right away (not only on the next scene change).
  useLayoutEffect(() => {
    anchorRef.current = focus?.hood.node.box ?? null;
    if (focus) placeRef.current?.(api.getAppState());
  }, [api, focus]);
  const focusedId = focus?.hood.node.id;
  const hoveredEdge = hovered && hovered.nodeId === focusedId ? hovered.edgeId : null;
  const setHoveredEdge = (edgeId: string | null) => setHovered(edgeId && focusedId ? { nodeId: focusedId, edgeId } : null);

  const goTo = (nodeId: string) => {
    const el = api.getSceneElements().find((e) => e.id === nodeId) as NonDeletedExcalidrawElement | undefined;
    if (el) revealElement(api, el);
  };

  return (
    <div className="acute-diagram" data-active={frames.length ? "" : undefined}>
      <div ref={layerRef} className="acute-diagram__layer">
        {/* Under the highlight, so a dimmed node's details dim with it. */}
        {!zoomedOut && frames.map((f) => <NodeDetails key={`d${f.box.id}`} frame={f} depth={depth} />)}
        {focus && <Highlight frame={focus.frame} hood={focus.hood} hoveredEdge={hoveredEdge} />}
        <RouteProbeLayer probe={probe} frames={frames} />
        {!zoomedOut && frames.map((f) => <FrameFooter key={f.box.id} frame={f} />)}
        {!zoomedOut &&
          chips.map((c) => (
            <div key={`chip${c.box.id}`} className="acute-diagram-chips" style={{ left: c.box.x + c.box.width, top: c.box.y }}>
              {c.level !== undefined && (
                <button
                  type="button"
                  className="acute-diagram-lens-chip"
                  data-route-chip=""
                  aria-pressed={probing}
                  title={probing ? "Stop tracing a path" : "Trace a path between two nodes: click where it starts, then where it ends"}
                  aria-label={probing ? "Stop tracing a path" : `Trace a path in ${c.title}`}
                  onClick={() => (probing ? probe.clear() : probe.begin())}
                >
                  ⇢ Path
                </button>
              )}
              <button
                type="button"
                className="acute-diagram-lens-chip"
                data-ready={c.level === undefined ? "" : undefined}
                data-delta={c.level !== undefined && deltaOf(c.box.id) ? "" : undefined}
                title={c.level === undefined ? "Make interactive and open in Lens" : `Open in Lens${sync.on ? " · your IDE agent is keeping this current" : ""}${deltaOf(c.box.id) ? " · changes you haven't seen in Lens yet" : ""}`}
                aria-label={c.level === undefined ? `Make ${c.title} interactive and open in Lens` : `Open ${c.title} in Lens`}
                onClick={() => openChip(c)}
              >
                ✨{c.level !== undefined && ` L${c.level}`}
                {c.level !== undefined && sync.on && " ●"}
                {c.level !== undefined && deltaOf(c.box.id) && ` ${deltaOf(c.box.id)}`}
              </button>
            </div>
          ))}
      </div>
      <RouteProbePanel probe={probe} api={api} />
      {focus && (
        <div ref={cardRef} className="acute-diagram-card" role="dialog" aria-label={`${focus.hood.node.label} relationships`} style={{ width: CARD_WIDTH }}>
          <Passport frameTitle={focus.frame.graph.title} hood={focus.hood} onHoverEdge={setHoveredEdge} onGoTo={goTo} onClose={() => api.updateScene({ appState: { selectedElementIds: {} } })} />
        </div>
      )}
    </div>
  );
}

function Highlight({ frame, hood, hoveredEdge }: { frame: DiagramFrame; hood: NodeNeighborhood; hoveredEdge: string | null }) {
  const { box } = frame;
  const related = [hood.node, ...hood.outgoing.map((r) => r.neighbor), ...hood.incoming.map((r) => r.neighbor)];
  const unique = [...new Map(related.map((n) => [n.id, n])).values()];
  const edges = [...hood.outgoing, ...hood.incoming].map((r) => r.edge);
  const n = hood.node.box;
  return (
    <svg className="acute-diagram__highlight" aria-hidden="true">
      <path className="acute-diagram__dim" fillRule="evenodd" d={dimPath(box, unique.map((node) => node.box))} />
      {edges.map((e) => (
        <path key={e.id} className="acute-diagram__edge" data-hovered={e.id === hoveredEdge ? "" : undefined} d={edgePath(e)} />
      ))}
      <rect className="acute-diagram__ring" x={n.x - 6} y={n.y - 6} width={n.width + 12} height={n.height + 12} rx={8} />
    </svg>
  );
}

function NodeDetails({ frame, depth }: { frame: DiagramFrame; depth: DetailDepth }) {
  const details = useMemo(() => nodeDetails(frame.elements, frame.graph, depth), [frame, depth]);
  return (
    <>
      {details.map((d) => (
        <div key={d.id} className="acute-diagram-detail" data-inside={d.inside ? "" : undefined} data-node-id={d.id} style={{ left: d.x, top: d.y, width: d.width }}>
          {d.sublabel && <span className="acute-diagram-detail__sub">{d.sublabel}</span>}
          {d.tag && <span className="acute-diagram-detail__tag">{d.tag}</span>}
        </div>
      ))}
    </>
  );
}

function FrameFooter({ frame }: { frame: DiagramFrame }) {
  const kinds = kindCounts(frame.graph);
  if (!kinds.length && !frame.cards?.length) return null;
  return (
    <div className="acute-diagram-footer" style={{ left: frame.box.x, top: frame.box.y + frame.box.height + 12, width: frame.box.width }}>
      {kinds.length > 0 && (
        <div className="acute-diagram-legend" aria-label="Legend">
          {kinds.map(({ kind, count }) => (
            <span key={kind} className="acute-diagram-legend__item">
              <i style={{ background: NODE_KIND_STYLES[kind].backgroundColor, borderColor: NODE_KIND_STYLES[kind].strokeColor }} />
              {NODE_KIND_LABELS[kind]} <em>{count}</em>
            </span>
          ))}
        </div>
      )}
      {frame.cards?.length ? (
        <div className="acute-diagram-cards">
          {frame.cards.map((c, i) => (
            <div key={i} className="acute-diagram-infocard" style={{ ["--acute-kind" as string]: c.kind ? NODE_KIND_STYLES[c.kind].accent : "var(--acute-accent)" }}>
              <strong>{c.title}</strong>
              <ul>
                {c.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
