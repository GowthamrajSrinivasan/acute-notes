"use client";

/**
 * The route probe (frames plan Phase 5, Lens plan 0.5): pick where a path starts and where it ends on the canvas's
 * interactive diagram frames, and the route lights up, as in archify's "Path" tool. One BFS, not two: it reads the
 * open canvas as a workspace graph and uses Lens's `reachableFrom` (what the start can reach) and `tracePath` (the
 * route), so the canvas and Lens always agree. Nothing on the canvas changes: the picking follows the selection, and
 * the highlight is an overlay, like the neighbourhood highlight.
 *
 * - Click **⇢ Path** on a frame (a selected node becomes the start), then click the start node: every node that can be
 *   reached from it stays lit and the rest of its frame dims. Click the end: the route is outlined, its arrows flow,
 *   and the panel lists the stops. Esc or Clear leaves.
 * - Across levels: a drill link (a node → the frame it zooms into) is a hop too, so the route may run through frames.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DiagramEdge } from "@/domain/canvas/diagram";
import { NodeFinder } from "@/components/lens/NodeFinder";
import { prefersReducedMotion } from "@/components/canvas/motion";
import { reachableFrom, reachKey, tracePath, TRACE_KINDS, type LensPath, type Reach, type TraceKind } from "@/domain/lens/trace";
import { buildWorkspaceGraph, type GraphNode, type WorkspaceGraph } from "@/domain/project/workspaceGraph";
import { dimPath, edgePath } from "./diagramPaths";

type Box = { x: number; y: number; width: number; height: number };
export interface ProbeFrame {
  box: Box & { id: string };
  graph: { edges: readonly DiagramEdge[] };
}

type Mode = "idle" | "start" | "end" | "result";
interface Probe {
  mode: Mode;
  start: string | null;
  end: string | null;
  kind: TraceKind;
  notice: string | null;
}
const IDLE: Probe = { mode: "idle", start: null, end: null, kind: "any", notice: null };

const KIND_LABELS: Record<TraceKind, string> = { any: "Any relation", dependency: "Dependencies", data: "Data", execution: "Execution" };
const boxOf = (el: SceneElement): Box => ({ x: el.x, y: el.y, width: el.width, height: el.height });

export interface RouteProbe {
  mode: Mode;
  kind: TraceKind;
  notice: string | null;
  graph: WorkspaceGraph | undefined;
  start: GraphNode | undefined;
  end: GraphNode | undefined;
  /** What the start can reach (the end step). */
  reach: ReadonlyMap<string, Reach> | undefined;
  path: LensPath | undefined;
  /** Scene elements by id, for the boxes to outline. */
  elements: ReadonlyMap<string, SceneElement>;
  begin(): void;
  clear(): void;
  choose(nodeId: string): void;
  setKind(kind: TraceKind): void;
  changeEnd(): void;
  changeStart(): void;
}

/**
 * The probe's state. `selectedId` is the selected diagram node's element id: while the probe is picking, selecting a
 * node chooses it (the start first, then the end), so the canvas's own click handling does the work.
 */
export function useRouteProbe(api: ExcalidrawImperativeAPI, canvasId: string, sceneVersion: number, selectedId: string | null): RouteProbe {
  const [probe, setProbe] = useState<Probe>(IDLE);
  const active = probe.mode !== "idle";
  // The selection last seen: a pick is a *change* of selection, and "Path" takes the node already selected as the start.
  const [seen, setSeen] = useState<string | null>(selectedId);

  const elements = useMemo(() => {
    void sceneVersion;
    return active ? (api.getSceneElements() as unknown as readonly SceneElement[]) : [];
  }, [api, active, sceneVersion]);
  const graph = useMemo(() => (active ? buildWorkspaceGraph([{ canvasId, elements }]) : undefined), [active, canvasId, elements]);
  const byId = useMemo(() => new Map(elements.map((el) => [el.id, el])), [elements]);

  const start = useMemo(() => graph?.nodes.find((n) => n.id === probe.start), [graph, probe.start]);
  const end = useMemo(() => graph?.nodes.find((n) => n.id === probe.end), [graph, probe.end]);
  const reach = useMemo(() => (graph && start && probe.mode === "end" ? reachableFrom(graph, start, probe.kind) : undefined), [graph, start, probe.mode, probe.kind]);
  const path = useMemo(() => (graph && start && end && probe.mode === "result" ? tracePath(graph, start, end, probe.kind) : undefined), [graph, start, end, probe.mode, probe.kind]);

  /** The probe after `nodeId` is chosen: the start first, then the end (a refusal says why and stays put). */
  const apply = (p: Probe, nodeId: string): Probe => {
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node) return p;
    if (p.mode === "start") return { ...p, mode: "end", start: nodeId, end: null, notice: null };
    if (p.mode !== "end" || !start) return p;
    if (nodeId === p.start) return { ...p, notice: "Pick a different end: that's where the path starts." };
    if (!reach?.has(reachKey(node))) return { ...p, notice: `${node.label} can't be reached from ${start.label}.` };
    return { ...p, mode: "result", end: nodeId, notice: null };
  };

  // A selection made while picking is a pick. Derived during render (the graph is there as soon as the probe is on).
  if (selectedId !== seen) {
    setSeen(selectedId);
    if (selectedId && graph && (probe.mode === "start" || probe.mode === "end")) setProbe(apply(probe, selectedId));
  }

  // Esc leaves.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProbe(IDLE);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // The route, in view: fit its stops once it's found.
  const pathKey = path?.stops.map((s) => s.id).join(">");
  useEffect(() => {
    if (!pathKey) return;
    const els = pathKey.split(">").flatMap((id) => (byId.get(id) ? [byId.get(id) as never] : []));
    if (els.length) api.scrollToContent(els, { fitToContent: els.length > 1, animate: !prefersReducedMotion(), duration: 250 });
    // Only when the route changes, not on every scene edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, pathKey]);

  return {
    mode: probe.mode,
    kind: probe.kind,
    notice: probe.notice,
    graph,
    start,
    end,
    reach,
    path,
    elements: byId,
    begin: () => {
      setSeen(null); // a node already selected is the start
      setProbe((p) => ({ ...IDLE, kind: p.kind, mode: "start" }));
    },
    clear: () => setProbe((p) => ({ ...IDLE, kind: p.kind })),
    choose: (nodeId) => setProbe((p) => apply(p, nodeId)),
    setKind: (kind) => setProbe((p) => ({ ...p, kind, notice: null })),
    changeEnd: () => setProbe((p) => (p.start ? { ...p, mode: "end", end: null, notice: null } : p)),
    changeStart: () => {
      setProbe((p) => ({ ...p, mode: "start", start: null, end: null, notice: null }));
    },
  };
}

/** The outlines and dimming, in scene coordinates (inside the overlay's transformed layer). */
export function RouteProbeLayer({ probe, frames }: { probe: RouteProbe; frames: readonly ProbeFrame[] }) {
  const { mode, start, path, reach, elements } = probe;
  const view = useMemo(() => {
    if (!start || (mode !== "end" && mode !== "result")) return null;
    const lit = new Map<string, { box: Box; role: "start" | "end" | "via" | "candidate" | "candidate-against" }>();
    const add = (id: string, role: NonNullable<ReturnType<typeof lit.get>>["role"]) => {
      const el = elements.get(id);
      if (el) lit.set(id, { box: boxOf(el), role });
    };
    if (mode === "end" && reach) {
      for (const r of reach.values()) add(r.node.id, r.directed ? "candidate" : "candidate-against");
      add(start.id, "start");
    }
    const edgeIds = new Set<string>();
    if (mode === "result" && path) {
      path.stops.forEach((s, i) => add(s.id, i === 0 ? "start" : i === path.stops.length - 1 ? "end" : "via"));
      for (const h of path.hops) if (h.arrowId) edgeIds.add(h.arrowId);
    }
    const holes = new Map<string, Box[]>();
    for (const [id, { box }] of lit) {
      const frameId = elements.get(id)?.frameId ?? "";
      holes.set(frameId, [...(holes.get(frameId) ?? []), box]);
    }
    const edges = frames.flatMap((f) => f.graph.edges.filter((e) => edgeIds.has(e.id)));
    return { lit, holes, edges };
  }, [mode, start, path, reach, elements, frames]);
  if (!view) return null;
  return (
    <svg className="acute-diagram__highlight" aria-hidden="true" data-testid="route-probe-layer">
      {frames.map((f) => (
        <path key={f.box.id} className="acute-diagram__dim" fillRule="evenodd" d={dimPath(f.box, view.holes.get(f.box.id) ?? [])} />
      ))}
      {view.edges.map((e) => (
        <path key={e.id} className="acute-route__edge" d={edgePath(e)} />
      ))}
      {[...view.lit].map(([id, { box, role }]) => (
        <rect key={id} className="acute-route__node" data-role={role} x={box.x - 6} y={box.y - 6} width={box.width + 12} height={box.height + 12} rx={8} />
      ))}
    </svg>
  );
}

/** The panel: instructions per step, a node finder, and the route's stops. */
export function RouteProbePanel({ probe, api }: { probe: RouteProbe; api: ExcalidrawImperativeAPI }) {
  const { mode, graph, start, reach, path, notice } = probe;
  const [copied, setCopied] = useState(false);
  const endItems = useMemo(() => (reach ? [...reach.values()].map((r) => r.node) : []), [reach]);
  if (mode === "idle") return null;
  const reveal = (n: GraphNode) => {
    const el = api.getSceneElements().find((e) => e.id === n.id);
    if (el) api.scrollToContent(el, { animate: !prefersReducedMotion(), duration: 250 });
  };
  const copy = () => {
    if (!path) return;
    void navigator.clipboard?.writeText(path.stops.map((s) => s.label).join(" → ")).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };
  const title =
    mode === "start" ? "Click where the path starts" : mode === "end" ? `Now click the end of the path from ${start?.label ?? "…"}` : path ? `${path.stops[0]!.label} → ${path.stops[path.stops.length - 1]!.label}` : "No path with this filter";
  return (
    <section className="acute-route-probe" role="dialog" aria-label="Path" data-state={mode} data-testid="route-probe">
      <div className="acute-route-probe__head">
        <strong>{title}</strong>
        <button type="button" onClick={probe.clear}>
          Clear
        </button>
      </div>
      {mode === "start" && <p className="acute-route-probe__muted">Next, pick the end. Only nodes you can reach will light up.</p>}
      {mode === "end" && (
        <p className="acute-route-probe__muted" data-testid="route-probe-reach">
          {reach?.size ? `${reach.size} node${reach.size === 1 ? "" : "s"} can be reached. They stay lit; dashed ones need a hop against an arrow.` : "Nothing can be reached from here."}
        </p>
      )}
      {mode === "result" && path && (
        <>
          <ol className="acute-route-probe__stops" aria-label="Path stops">
            {path.stops.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={() => graph && reveal(graph.nodes.find((n) => n.id === s.id)!)}>
                  {s.label}
                </button>
                {i < path.stops.length - 1 && <span aria-hidden="true"> →</span>}
              </li>
            ))}
          </ol>
          <p className="acute-route-probe__muted" data-testid="route-probe-summary">
            {path.hops.length} hop{path.hops.length === 1 ? "" : "s"}
            {path.hops.length ? (path.directed ? ", along the arrows" : ", partly against the arrows") : ""}
          </p>
        </>
      )}
      {notice && (
        <p className="acute-route-probe__muted" role="status">
          {notice}
        </p>
      )}
      {mode === "start" && <NodeFinder items={graph?.nodes ?? []} itemKey={reachKey} step="start" loading={!graph} onPick={(n) => (probe.choose(n.id), reveal(n))} />}
      {mode === "end" && <NodeFinder items={endItems} itemKey={reachKey} step="end" onPick={(n) => probe.choose(n.id)} />}
      <div className="acute-route-probe__row">
        <label className="acute-route-probe__muted">
          Follow{" "}
          <select aria-label="Path kind" value={probe.kind} onChange={(e) => probe.setKind(e.target.value as TraceKind)}>
            {TRACE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {mode === "end" && (
          <button type="button" onClick={probe.changeStart}>
            Change start
          </button>
        )}
        {mode === "result" && (
          <>
            <button type="button" onClick={probe.changeEnd}>
              Change end
            </button>
            <button type="button" onClick={probe.changeStart}>
              New path
            </button>
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy path"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
