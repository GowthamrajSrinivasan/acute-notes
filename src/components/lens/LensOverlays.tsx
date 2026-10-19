"use client";

/**
 * Lens's Phase 3 overlays (plan §5.2, D16, D54): the **Trace** card (a path from the selected node to a second one
 * picked on any level, every hop named) and the **Impact** card (what changing a node affects, from the pure
 * `impactOf` the MCP tools use, with the warnings that protect it), plus the marks they put on the current level.
 * Read-only: they compute over the workspace graph and navigate Lens; nothing is written.
 */
import { useMemo, useState } from "react";
import { impactOf, type Impact, type ImpactEntry } from "@/domain/project/impact";
import { warningsFor, type Warning } from "@/domain/project/knowledge";
import { graphNodeAt } from "@/domain/lens/locate";
import type { LensLevelView } from "@/domain/lens/lensView";
import type { GraphNode } from "@/domain/project/workspaceGraph";
import { reachableFrom, reachKey, tracePath, TRACE_KINDS, TRACE_LIMITS, type LensPath, type Reach, type TraceKind } from "@/domain/lens/trace";
import { lensPanel, type LensNodeRef, type LensTraceState } from "@/state/lensPanel";
import type { LensMark, LensMarks } from "./LensDiagram";
import type { LensWorkspace } from "./lensWorkspace";
import { NodeFinder } from "./NodeFinder";

const KIND_LABELS: Record<TraceKind, string> = { any: "Any relation", dependency: "Dependencies", data: "Data", execution: "Execution" };

/**
 * `start`: nothing chosen yet. `picking`: the start is chosen and `reach` is what a trace from it can end at (the nodes
 * that light up). `found` / `none`: both ends chosen.
 */
export type TraceResult =
  | { status: "start" }
  | { status: "picking"; reach: ReadonlyMap<string, Reach> }
  | { status: "loading" }
  | { status: "missing"; which: "from" | "to" }
  | { status: "none" }
  | { status: "found"; path: LensPath };

export function useTrace(trace: LensTraceState | null, workspace: LensWorkspace | undefined): TraceResult | undefined {
  return useMemo(() => {
    if (!trace) return undefined;
    if (!trace.from) return { status: "start" };
    if (!workspace) return { status: "loading" };
    const from = graphNodeAt(workspace.g, trace.from.canvasId, trace.from.key);
    if (!from) return { status: "missing", which: "from" };
    if (!trace.to) return { status: "picking", reach: reachableFrom(workspace.g, from, trace.kind) };
    const to = graphNodeAt(workspace.g, trace.to.canvasId, trace.to.key);
    if (!to) return { status: "missing", which: "to" };
    const path = tracePath(workspace.g, from, to, trace.kind);
    return path ? { status: "found", path } : { status: "none" };
  }, [trace, workspace]);
}

export type ImpactResult = { status: "loading" } | { status: "missing" } | { status: "found"; impact: Impact; warnings: Warning[] };

export function useImpact(node: LensNodeRef | null, workspace: LensWorkspace | undefined): ImpactResult | undefined {
  return useMemo(() => {
    if (!node) return undefined;
    if (!workspace) return { status: "loading" };
    const n = graphNodeAt(workspace.g, node.canvasId, node.key);
    if (!n) return { status: "missing" };
    const impact = impactOf(workspace.g, [n.ref]);
    return { status: "found", impact, warnings: warningsFor(workspace.g, [...impact.modified, ...impact.affected].map((e) => e.ref)) };
  }, [node, workspace]);
}

/** What the overlays mark on `view`: its nodes by Lens key, and the arrows a trace follows. */
export function overlayMarks(view: LensLevelView | undefined, trace: TraceResult | undefined, impact: ImpactResult | undefined, highlight: readonly string[]): LensMarks | undefined {
  if (!view || view.source) return undefined;
  const nodes = new Map<string, LensMark>();
  const edges = new Set<string>();
  const here = (canvasId: string, key: string) => canvasId === view.frame.canvasId && view.nodes.find((n) => n.key === key || n.id === key);
  // While a path is being picked or shown, everything not on it dims (archify's route probe).
  let dim = false;
  if (trace?.status === "picking") {
    dim = true;
    for (const n of view.nodes) {
      const reach = trace.reach.get(reachKey({ canvasId: view.frame.canvasId, id: n.id }));
      if (reach) nodes.set(n.key, reach.directed ? "candidate" : "candidate-against");
    }
  }
  if (trace?.status === "found") {
    dim = true;
    const last = trace.path.stops.length - 1;
    trace.path.stops.forEach((s, i) => {
      const n = here(s.canvasId, s.ref);
      if (n) nodes.set(n.key, i === 0 ? "start" : i === last ? "end" : "trace");
    });
    for (const h of trace.path.hops) if (h.arrowId && view.edges.some((e) => e.id === h.arrowId)) edges.add(h.arrowId);
  }
  if (impact?.status === "found") {
    const mark = (list: readonly ImpactEntry[], m: LensMark) => {
      for (const e of list) {
        const n = here(e.canvasId, e.ref);
        if (n && !nodes.has(n.key)) nodes.set(n.key, m);
      }
    };
    mark(impact.impact.modified, "modified");
    mark(impact.impact.affected, "affected");
    mark(impact.impact.related, "related");
  }
  for (const key of highlight) {
    const n = view.nodes.find((x) => x.key === key || x.id === key);
    if (n && !nodes.has(n.key)) nodes.set(n.key, "focus");
  }
  return nodes.size || edges.size ? { nodes, edges, dim } : undefined;
}

type Go = (canvasId: string, ref: string) => void;

const refOf = (n: GraphNode): LensNodeRef => ({ canvasId: n.canvasId, key: n.ref, label: n.label });

export function TraceCard({
  trace,
  result,
  workspace,
  notice,
  onGo,
}: {
  trace: LensTraceState;
  result: TraceResult | undefined;
  workspace: LensWorkspace | undefined;
  /** Why the last click on the diagram didn't pick an end (it can't be reached from the start). */
  notice?: string | null;
  onGo: Go;
}) {
  // The stop the "Follow path" buttons are on.
  const [at, setAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const path = result?.status === "found" ? result.path : undefined;
  const current = path ? Math.min(at, path.stops.length - 1) : 0;
  const stop = path?.stops[current];
  const go = (i: number) => {
    if (!path) return;
    const next = Math.max(0, Math.min(path.stops.length - 1, i));
    setAt(next);
    const s = path.stops[next]!;
    onGo(s.canvasId, s.ref);
  };
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );
  };
  // A restored deep link names its ends by key; the workspace knows their labels.
  const labelOf = (end: LensNodeRef) => (workspace && graphNodeAt(workspace.g, end.canvasId, end.key)?.label) ?? end.label;
  const endCandidates = useMemo(() => (result?.status === "picking" ? [...result.reach.values()].map((r) => r.node) : []), [result]);
  const pick = (n: GraphNode) => {
    if (!trace.from) {
      lensPanel.setTraceFrom(refOf(n));
      onGo(n.canvasId, n.ref);
    } else lensPanel.traceTo(refOf(n));
  };
  return (
    <section className="acute-lens-overlay" aria-label="Trace" data-testid="lens-trace-card">
      <div className="acute-lens-overlay__head">
        <span>⇢ Path</span>
        <button type="button" onClick={() => lensPanel.clearOverlays()}>
          Clear
        </button>
      </div>
      <label className="acute-lens-overlay__muted">
        Follow{" "}
        <select aria-label="Trace kind" value={trace.kind} onChange={(e) => lensPanel.setTraceKind(e.target.value as TraceKind)}>
          {TRACE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {result?.status === "start" && (
        <>
          <strong>Click where the path starts</strong>
          <p className="acute-lens-overlay__muted">Select a node on any level, or find one. Next, pick the end. Only nodes you can reach will light up.</p>
          <NodeFinder items={workspace?.g.nodes ?? []} itemKey={reachKey} step="start" loading={!workspace} onPick={pick} />
        </>
      )}
      {trace.from && (
        <div>
          From <strong>{labelOf(trace.from)}</strong>
          {trace.to && (
            <>
              {" "}
              to <strong>{labelOf(trace.to)}</strong>
            </>
          )}
        </div>
      )}
      {result?.status === "picking" && (
        <>
          <strong>Now click the end</strong>
          <p className="acute-lens-overlay__muted" data-testid="lens-trace-reach">
            {result.reach.size
              ? `${result.reach.size} node${result.reach.size === 1 ? "" : "s"} can be reached from here: they're outlined on each level (dashed when the path runs against an arrow).`
              : `Nothing is reachable from here${trace.kind === "any" ? "" : ` by ${KIND_LABELS[trace.kind].toLowerCase()}`}. Pick another start.`}
          </p>
          {notice && (
            <p className="acute-lens-overlay__muted" role="status">
              {notice}
            </p>
          )}
          <NodeFinder items={endCandidates} itemKey={reachKey} step="end" onPick={pick} />
          <button type="button" className="acute-lens-overlay__link" onClick={() => lensPanel.beginTrace()}>
            Change start
          </button>
        </>
      )}
      {result?.status === "loading" && <p className="acute-lens-overlay__muted">Tracing…</p>}
      {result?.status === "missing" && <p className="acute-lens-overlay__muted">The {result.which === "from" ? "first" : "second"} node is no longer in the workspace.</p>}
      {result?.status === "none" && (
        <p className="acute-lens-overlay__muted">
          No {trace.kind === "any" ? "" : `${KIND_LABELS[trace.kind].toLowerCase()} `}path within {TRACE_LIMITS.maxHops} hops.
        </p>
      )}
      {(result?.status === "found" || result?.status === "none") && (
        <div className="acute-lens-overlay__row">
          <button type="button" className="acute-lens-overlay__link" onClick={() => lensPanel.pickTraceEnd()}>
            Change end
          </button>
          <button type="button" className="acute-lens-overlay__link" onClick={() => lensPanel.beginTrace()}>
            New path
          </button>
          {path && (
            <button type="button" className="acute-lens-overlay__link" onClick={copyLink}>
              {copied ? "Copied" : "Copy link"}
            </button>
          )}
        </div>
      )}
      {path && (
        <>
          <p className="acute-lens-overlay__muted" data-testid="lens-trace-summary">
            {path.hops.length} hop{path.hops.length === 1 ? "" : "s"}
            {path.hops.length ? (path.directed ? ", along the arrows" : ", partly against the arrows") : ""}
          </p>
          {path.stops.length > 1 && (
            <div className="acute-lens-overlay__row" role="group" aria-label="Follow the path">
              <button type="button" className="acute-lens-overlay__link" aria-label="Previous stop" disabled={current <= 0} onClick={() => go(current - 1)}>
                ◀
              </button>
              <span className="acute-lens-overlay__muted" aria-live="polite">
                Stop {current + 1} of {path.stops.length}
                {stop?.level !== undefined ? ` · L${stop.level}` : ""}
              </span>
              <button type="button" className="acute-lens-overlay__link" aria-label="Next stop" disabled={current >= path.stops.length - 1} onClick={() => go(current + 1)}>
                ▶
              </button>
            </div>
          )}
          <ol aria-label="Trace path">
            {path.stops.map((s, i) => {
              const hop = path.hops[i];
              return (
                <li key={`${s.canvasId}/${s.id}`} data-current={i === current ? "" : undefined}>
                  <button
                    type="button"
                    className="acute-lens-overlay__link"
                    onClick={() => {
                      setAt(i);
                      onGo(s.canvasId, s.ref);
                    }}
                  >
                    {s.label}
                  </button>
                  {s.level !== undefined && <span className="acute-lens-overlay__muted"> · L{s.level}</span>}
                  {s.code[0] && <div className="acute-lens-overlay__muted">{s.code[0].label}</div>}
                  {hop && (
                    <div className="acute-lens-overlay__muted" data-testid="lens-trace-hop">
                      ↓ {hop.text}
                      {hop.explanation ? ` — ${hop.explanation}` : ""}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

export function EntryList({ title, entries, onGo }: { title: string; entries: readonly ImpactEntry[]; onGo: Go }) {
  if (!entries.length) return null;
  return (
    <>
      <div className="acute-lens-overlay__group">
        {title} · {entries.length}
      </div>
      <ul>
        {entries.map((e) => (
          <li key={`${e.canvasId}/${e.id}`}>
            <button type="button" className="acute-lens-overlay__link" onClick={() => onGo(e.canvasId, e.ref)}>
              {e.label}
            </button>
            {e.why && <span className="acute-lens-overlay__muted"> — {e.why}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function ImpactCard({ node, result, onGo }: { node: LensNodeRef; result: ImpactResult | undefined; onGo: Go }) {
  return (
    <section className="acute-lens-overlay" aria-label="Impact">
      <div className="acute-lens-overlay__head">
        <span>◎ Impact of {node.label}</span>
        <button type="button" onClick={() => lensPanel.clearOverlays()}>
          Clear
        </button>
      </div>
      {result?.status === "loading" && <p className="acute-lens-overlay__muted">Working it out…</p>}
      {result?.status === "missing" && <p className="acute-lens-overlay__muted">This node is no longer in the workspace.</p>}
      {result?.status === "found" && (
        <>
          {result.warnings.map((w) => (
            <p key={w.key} className="acute-lens-overlay__warning" role="note">
              ⚠ {w.statement}
              {w.reason ? ` — ${w.reason}` : ""}
              {w.deviation ? ` (allowed here by “${w.deviation.statement}”)` : ""}
            </p>
          ))}
          <EntryList title="Affected" entries={result.impact.affected} onGo={onGo} />
          <EntryList title="Related" entries={result.impact.related} onGo={onGo} />
          {!result.impact.affected.length && !result.impact.related.length && <p className="acute-lens-overlay__muted">Nothing depends on it, and it refers to nothing.</p>}
          {result.impact.truncated && <p className="acute-lens-overlay__muted">Only the first entries are listed.</p>}
        </>
      )}
    </section>
  );
}
