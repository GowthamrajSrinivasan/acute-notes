"use client";

/**
 * Acute Lens's own SVG renderer for one level (plan §5.2): the frame's own canvas geometry, normalised, laid out
 * with the same orthogonal routing as the canvas (`ai/changes/routing.ts`), styled with the same kind and relation
 * styles, and the same highlight (`diagramPaths.ts`) as the canvas overlay. No Excalidraw here.
 *
 * A Project-profile level (plan §3.6) is drawn in its lanes instead (`projectLanes.ts`): a column per lane under the
 * project's banner, which carries the L0 overview counts, and each card's state badge ("✓ Redis", "In progress").
 *
 * Agent Sync (Phase 4, plan §8.2): the proposed state (`pending`) is drawn over the current graph, never merged into
 * it — `+ NEW` ghosts (green, dashed) with their links, `~ changed` (amber) and `− removed` (struck) on existing
 * nodes and edges. Stale nodes (citing a changed path) carry the amber dot; their ancestors a lighter "may be
 * affected" ring.
 */
import { useMemo } from "react";
import { NODE_KIND_LABELS, type DiagramNode, type NodeNeighborhood } from "@/domain/canvas/diagram";
import { NODE_KIND_STYLES } from "@/domain/canvas/nodeKindStyle";
import { relationStyle } from "@/ai/changes/relationStyle";
import { labelCenter, routeConnectors, type RoutedBox } from "@/ai/changes/routing";
import { dimPath, edgePath } from "@/components/diagram/diagramPaths";
import { drillTarget, type LensLevelView } from "@/domain/lens/lensView";
import type { LensPendingView } from "@/domain/lens/pending";
import type { ProjectSummary } from "@/domain/lens/projectLanes";

type Box = DiagramNode["box"];

const PAD = 40;

/** The banner's one-line overview (the project profile's L0, D25): focus, then milestone, item and decision counts. */
export function summaryLine(summary: ProjectSummary): string {
  const items = Object.values(summary.items).reduce((a, b) => a + b, 0);
  return [
    summary.project?.focus && `Focus: ${summary.project.focus}`,
    summary.milestones.total && `${summary.milestones.done}/${summary.milestones.total} milestones done`,
    items && `${summary.items.done}/${items} items done`,
    summary.items.blocked && `${summary.items.blocked} blocked`,
    summary.proposedDecisions && `${summary.proposedDecisions} proposed decision${summary.proposedDecisions === 1 ? "" : "s"}`,
    summary.openQuestions && `${summary.openQuestions} open question${summary.openQuestions === 1 ? "" : "s"}`,
    summary.warnings && `${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What an overlay marks on this level (Phase 3): a trace's stops and the arrows it follows, an impact's nodes, or the
 * keys an agent highlighted (`focus_lens`). Drawn over the diagram; nothing else changes.
 */
export type LensMark = "trace" | "start" | "end" | "candidate" | "candidate-against" | "modified" | "affected" | "related" | "focus";
export interface LensMarks {
  nodes: ReadonlyMap<string, LensMark>;
  edges: ReadonlySet<string>;
  /** Nodes without a mark fade back (a path is being picked or shown). */
  dim?: boolean;
}

function norm(box: Box, origin: { x: number; y: number }): Box {
  return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
}

export function LensDiagram({
  view,
  selectedKey,
  hood,
  hoveredEdgeId,
  onSelect,
  onDrill,
  onHoverEdge,
  zoom,
  marks,
  pending,
  stale,
  affected,
}: {
  view: LensLevelView;
  selectedKey: string | null;
  hood: NodeNeighborhood | undefined;
  hoveredEdgeId: string | null;
  onSelect: (key: string) => void;
  /** Double-click / Enter on a node with a child frame: zoom in (plan AC4). */
  onDrill: (key: string) => void;
  onHoverEdge: (id: string | null) => void;
  zoom: number;
  marks?: LensMarks;
  /** Proposed state from the change sets waiting on this canvas (D3): drawn over the level, never merged into it. */
  pending?: LensPendingView;
  /** Element ids citing a changed path (`get_map_status`), and their ancestors that may be affected. */
  stale?: ReadonlySet<string>;
  affected?: ReadonlySet<string>;
}) {
  // The level's own box, grown to hold any ghost a set places outside it.
  const bounds = useMemo(() => {
    const boxes = [view.box, ...(pending?.added.map((g) => g.box) ?? [])];
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
  }, [view.box, pending]);
  const origin = useMemo(() => ({ x: bounds.x, y: bounds.y }), [bounds.x, bounds.y]);
  const nodes = useMemo(() => view.nodes.map((n) => ({ ...n, box: norm(n.box, origin) })), [view.nodes, origin]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const routes = useMemo(() => {
    const boxes: RoutedBox[] = nodes.map((n) => ({ id: n.id, ...n.box }));
    const requests = view.edges.flatMap((e) => {
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to || e.from === e.to) return [];
      return [{ key: e.id, from: { id: from.id, ...from.box }, to: { id: to.id, ...to.box } }];
    });
    return routeConnectors(requests, boxes);
  }, [nodes, byId, view.edges]);

  const width = bounds.width + PAD * 2;
  const height = bounds.height + PAD * 2;
  const ghosts = useMemo(() => pending?.added.map((g) => ({ ...g, box: norm(g.box, origin) })) ?? [], [pending, origin]);
  const centre = (id: string) => {
    const b = byId.get(id)?.box ?? ghosts.find((g) => g.key === id)?.box;
    return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const unique = hood ? [hood.node, ...hood.outgoing.map((r) => r.neighbor), ...hood.incoming.map((r) => r.neighbor)] : [];
  const uniqueNorm = unique.map((n) => norm(n.box, origin));
  const hoodEdgeIds = hood ? new Set([...hood.outgoing, ...hood.incoming].map((r) => r.edge.id)) : null;

  return (
    <svg
      className="acute-lens-diagram"
      width={width}
      height={height}
      viewBox={`${-PAD} ${-PAD} ${width} ${height}`}
      style={{ transform: `scale(${zoom})` }}
      role="img"
      aria-label={`${view.title} diagram`}
    >
      <defs>
        <marker id="acute-lens-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" fill="var(--acute-text-muted)" />
        </marker>
      </defs>
      {view.lanes?.map((lane) => {
        const b = norm(lane.box, origin);
        return (
          <g key={lane.id} className="acute-lens-lane" data-lane={lane.id} role="group" aria-label={`${lane.name} lane`}>
            <rect className="acute-lens-lane__box" x={b.x} y={b.y} width={b.width} height={b.height} rx={10} />
            <text className="acute-lens-lane__title" x={b.x + 12} y={b.y + 21}>
              {lane.name} · {lane.count}
            </text>
          </g>
        );
      })}
      {view.edges.map((e) => {
        const route = routes.get(e.id);
        if (!route) return null;
        const style = relationStyle(e.relation);
        const label = e.label || style.defaultLabel;
        const center = labelCenter(route.points);
        return (
          <g key={e.id}>
            <path
              className="acute-lens-edge"
              data-hovered={e.id === hoveredEdgeId ? "" : undefined}
              data-pending={pending?.removedEdges.has(e.id) ? "removed" : pending?.changedEdges.has(e.id) ? "changed" : undefined}
              d={edgePath({ points: route.points.map((p) => [p.x, p.y]) })}
              strokeDasharray={style.strokeStyle === "dashed" ? "6 4" : style.strokeStyle === "dotted" ? "1.5 3" : undefined}
              markerEnd={style.endArrowhead ? "url(#acute-lens-arrow)" : undefined}
              onPointerEnter={() => onHoverEdge(e.id)}
              onPointerLeave={() => onHoverEdge(null)}
            />
            {label && (
              <text className="acute-lens-edge__label" x={center.x} y={center.y - 4} textAnchor="middle">
                {label}
              </text>
            )}
          </g>
        );
      })}
      {hood && (
        <>
          <path className="acute-lens-diagram__dim" fillRule="evenodd" d={dimPath({ x: -PAD, y: -PAD, width, height }, uniqueNorm)} />
          {[...hoodEdgeIds!].map((id) => {
            const route = routes.get(id);
            return route ? (
              <path key={id} className="acute-lens-diagram__edge" data-hovered={id === hoveredEdgeId ? "" : undefined} d={edgePath({ points: route.points.map((p) => [p.x, p.y]) })} />
            ) : null;
          })}
          {(() => {
            const n = norm(hood.node.box, origin);
            return <rect className="acute-lens-diagram__ring" x={n.x - 6} y={n.y - 6} width={n.width + 12} height={n.height + 12} rx={8} />;
          })()}
        </>
      )}
      {marks &&
        [...marks.edges].map((id) => {
          const route = routes.get(id);
          return route ? <path key={`mark-${id}`} className="acute-lens-diagram__mark-edge" d={edgePath({ points: route.points.map((p) => [p.x, p.y]) })} /> : null;
        })}
      {marks &&
        nodes.map((n) => {
          const mark = marks.nodes.get(n.key);
          return mark ? <rect key={`mark-${n.id}`} className="acute-lens-diagram__mark" data-mark={mark} x={n.box.x - 5} y={n.box.y - 5} width={n.box.width + 10} height={n.box.height + 10} rx={10} /> : null;
        })}
      {nodes.map((n) => {
        const style = n.semantics.kind ? NODE_KIND_STYLES[n.semantics.kind] : undefined;
        const drill = drillTarget(n);
        const banner = view.summary && n.semantics.kind === "project";
        const overview = banner ? summaryLine(view.summary!) : "";
        return (
          <g
            key={n.id}
            className="acute-lens-node"
            data-selected={n.key === selectedKey ? "" : undefined}
            data-has-child={n.childFrame ? "" : undefined}
            data-has-source={drill === "source" ? "" : undefined}
            data-kind={n.semantics.kind}
            data-mark={marks?.nodes.get(n.key)}
            data-dim={marks?.dim && !marks.nodes.has(n.key) ? "" : undefined}
            data-pending={pending?.removed.has(n.key) ? "removed" : pending?.changed.has(n.key) ? "changed" : undefined}
            data-stale={stale?.has(n.id) ? "" : undefined}
            data-affected={!stale?.has(n.id) && affected?.has(n.id) ? "" : undefined}
            role="button"
            tabIndex={0}
            aria-pressed={n.key === selectedKey}
            aria-label={n.label}
            onClick={() => onSelect(n.key)}
            onDoubleClick={() => drill && onDrill(n.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (e.key === "Enter" && drill) onDrill(n.key);
                else onSelect(n.key);
              }
            }}
          >
            <rect
              className="acute-lens-node__box"
              x={n.box.x}
              y={n.box.y}
              width={n.box.width}
              height={n.box.height}
              rx={8}
              fill={style?.backgroundColor ?? "var(--acute-surface)"}
              stroke={style?.strokeColor ?? "var(--acute-border)"}
            />
            {n.childFrame && (
              <>
                <title>Double-click to zoom in</title>
                <rect className="acute-lens-node__child-marker" x={n.box.x + 4} y={n.box.y + 4} width={n.box.width - 8} height={n.box.height - 8} rx={5} />
              </>
            )}
            {drill === "source" && (
              <>
                <title>Double-click to see its source</title>
                <text className="acute-lens-node__kind" x={n.box.x + n.box.width - 8} y={n.box.y + 14} textAnchor="end">
                  {"</>"}
                </text>
              </>
            )}
            {n.semantics.kind && (
              <text className="acute-lens-node__kind" x={n.box.x + 8} y={n.box.y + 14}>
                {NODE_KIND_LABELS[n.semantics.kind]}
              </text>
            )}
            <text className="acute-lens-node__label" x={n.box.x + n.box.width / 2} y={n.box.y + n.box.height / 2 - (overview ? 8 : 0)} textAnchor="middle" dominantBaseline="middle">
              {n.label}
            </text>
            {overview && (
              <text className="acute-lens-node__summary" x={n.box.x + n.box.width / 2} y={n.box.y + n.box.height / 2 + 12} textAnchor="middle" dominantBaseline="middle">
                {overview}
              </text>
            )}
            {n.badge && (
              <text className="acute-lens-node__badge" x={n.box.x + n.box.width - 8} y={n.box.y + n.box.height - 8} textAnchor="end">
                {n.badge}
              </text>
            )}
            {!stale?.has(n.id) && affected?.has(n.id) && (
              <rect className="acute-lens-node__affected" x={n.box.x - 4} y={n.box.y - 4} width={n.box.width + 8} height={n.box.height + 8} rx={10}>
                <title>May be affected: a card below it cites a changed file</title>
              </rect>
            )}
            {stale?.has(n.id) && (
              <circle className="acute-lens-node__stale" cx={n.box.x + n.box.width - 2} cy={n.box.y + 2} r={5}>
                <title>Stale: it cites a file your IDE agent reported as changed</title>
              </circle>
            )}
            {pending?.removed.has(n.key) && <line className="acute-lens-node__strike" x1={n.box.x + 6} y1={n.box.y + n.box.height / 2} x2={n.box.x + n.box.width - 6} y2={n.box.y + n.box.height / 2} />}
            {(pending?.removed.has(n.key) || pending?.changed.has(n.key)) && (
              <text className="acute-lens-node__pending" data-pending={pending.removed.has(n.key) ? "removed" : "changed"} x={n.box.x} y={n.box.y - 6}>
                {pending.removed.has(n.key) ? "− removed" : `~ changed: ${pending.changed.get(n.key)!.join(", ")}`}
              </text>
            )}
          </g>
        );
      })}
      {pending?.addedEdges.map((e) => {
        const a = centre(e.from);
        const b = centre(e.to);
        return a && b ? <line key={e.key} className="acute-lens-ghost__edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#acute-lens-arrow)" /> : null;
      })}
      {ghosts.map((g) => {
        const style = g.kind ? NODE_KIND_STYLES[g.kind] : undefined;
        return (
          <g key={g.key} className="acute-lens-ghost" role="img" aria-label={`Proposed: ${g.label} (new)`}>
            <rect className="acute-lens-ghost__box" x={g.box.x} y={g.box.y} width={g.box.width} height={g.box.height} rx={8} fill={style?.backgroundColor ?? "var(--acute-surface)"} />
            <text className="acute-lens-node__pending" data-pending="added" x={g.box.x} y={g.box.y - 6}>
              + NEW
            </text>
            {g.kind && (
              <text className="acute-lens-node__kind" x={g.box.x + 8} y={g.box.y + 14}>
                {NODE_KIND_LABELS[g.kind]}
              </text>
            )}
            <text className="acute-lens-node__label" x={g.box.x + g.box.width / 2} y={g.box.y + g.box.height / 2} textAnchor="middle" dominantBaseline="middle">
              {g.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
