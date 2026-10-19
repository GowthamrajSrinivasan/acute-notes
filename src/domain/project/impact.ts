/**
 * The pure impact computation (plan §4, D54): built in Phase 7B for MCP and session reasoning; Phase 3 adds the
 * Trace action and the impact view over this same function. No UI, no I/O.
 *
 * Given the nodes that changed:
 * - **modified**: those nodes;
 * - **affected**: what depends on them — nodes with a relation *into* a modified or affected node (the arrow's source
 *   relies on its target: `A depends_on B`, `A calls B`), followed up to `depth` hops, plus every modified node's
 *   ancestors in the Lens hierarchy (a summary level is affected by what it summarises);
 * - **related**: what they depend on (one hop along outgoing relations), and the project knowledge whose `refs` point
 *   at a modified or affected node (decisions, constraints, questions, risks, annotations, progress).
 * Every list is bounded; `truncated` says when one was cut.
 */
import { addressesOf, ancestorsOf, resolve, type GraphFrame, type GraphNode, type WorkspaceGraph } from "./workspaceGraph";

export interface ImpactEntry {
  ref: string;
  id: string;
  label: string;
  kind?: string;
  canvasId: string;
  /** Why it's here: "depends on X", "contains X", "refers to X". */
  why?: string;
}

export interface Impact {
  modified: ImpactEntry[];
  affected: ImpactEntry[];
  related: ImpactEntry[];
  /** Addresses that name nothing in the workspace (kept and reported, D53 (4)). */
  unresolved: string[];
  truncated: boolean;
}

export const IMPACT_LIMITS = { depth: 2, perList: 100 } as const;

const entry = (t: GraphNode | GraphFrame, why?: string): ImpactEntry => ({
  ref: t.ref,
  id: t.id,
  label: t.what === "node" ? t.label : t.title,
  ...(t.what === "node" && t.kind ? { kind: t.kind } : t.what === "frame" ? { kind: "frame" } : {}),
  canvasId: t.canvasId,
  ...(why ? { why } : {}),
});

export function impactOf(g: WorkspaceGraph, changed: readonly string[], options: { depth?: number; perList?: number } = {}): Impact {
  const depth = options.depth ?? IMPACT_LIMITS.depth;
  const perList = options.perList ?? IMPACT_LIMITS.perList;
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const key = (t: GraphNode | GraphFrame) => `${t.canvasId}/${t.id}`;
  const modified: (GraphNode | GraphFrame)[] = [];
  for (const c of changed) {
    const t = resolve(g, c);
    if (!t) unresolved.push(c);
    else if (!seen.has(key(t))) {
      seen.add(key(t));
      modified.push(t);
    }
  }

  const affected: ImpactEntry[] = [];
  const affectedTargets: (GraphNode | GraphFrame)[] = [];
  const add = (t: GraphNode | GraphFrame, why: string) => {
    if (seen.has(key(t))) return false;
    seen.add(key(t));
    affected.push(entry(t, why));
    affectedTargets.push(t);
    return true;
  };
  // Reverse relations, breadth first.
  let frontier = modified.filter((t): t is GraphNode => t.what === "node");
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: GraphNode[] = [];
    for (const n of frontier) {
      const addrs = new Set(addressesOf(n));
      for (const e of g.edges) {
        if (e.canvasId !== n.canvasId || !addrs.has(e.to)) continue;
        const src = resolve(g, e.from);
        if (src?.what === "node" && add(src, `${e.relation?.replace(/_/g, " ") ?? "connects to"} ${n.label}`)) next.push(src);
      }
    }
    frontier = next;
  }
  // The hierarchy above each modified node.
  for (const t of modified) for (const anc of ancestorsOf(g, t)) add(anc, `contains ${t.what === "node" ? t.label : t.title}`);

  // Related: one hop of what modified nodes depend on, and the knowledge pointing at modified or affected nodes.
  const related: ImpactEntry[] = [];
  const addRelated = (t: GraphNode | GraphFrame, why: string) => {
    if (seen.has(key(t))) return;
    seen.add(key(t));
    related.push(entry(t, why));
  };
  for (const t of modified) {
    if (t.what !== "node") continue;
    const addrs = new Set(addressesOf(t));
    for (const e of g.edges) {
      if (e.canvasId !== t.canvasId || !addrs.has(e.from)) continue;
      const dst = resolve(g, e.to);
      if (dst?.what === "node") addRelated(dst, `${t.label} ${e.relation?.replace(/_/g, " ") ?? "connects to"} it`);
    }
  }
  const touched = [...modified, ...affectedTargets];
  const touchedAddrs = new Map<string, GraphNode | GraphFrame>();
  for (const t of touched) for (const a of addressesOf(t)) touchedAddrs.set(a, t);
  for (const n of g.nodes) {
    const hit = n.project?.refs?.map((r) => touchedAddrs.get(r)).find(Boolean);
    if (hit) addRelated(n, `refers to ${hit.what === "node" ? hit.label : hit.title}`);
  }

  const truncated = affected.length > perList || related.length > perList || modified.length > perList;
  return { modified: modified.slice(0, perList).map((t) => entry(t)), affected: affected.slice(0, perList), related: related.slice(0, perList), unresolved, truncated };
}

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

/** Whether a cited code path and a wanted one name the same file (either may be relative to a deeper root). */
export function samePath(cited: string, wanted: string): boolean {
  const a = normPath(cited);
  const b = normPath(wanted);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * The nodes citing a code path, for `changedPaths` inputs (D48): in their own sources (`acuteNode.sources`) or in the
 * code locations an agent stamped on them (Repo Map `sourceRefs`, Phase 2) — the node's code evidence.
 */
export function nodesCitingPaths(g: WorkspaceGraph, paths: readonly string[]): GraphNode[] {
  return g.nodes.filter((n) => n.code?.some((c) => !!c.path && paths.some((w) => samePath(c.path!, w))));
}

/** A changed file, with the 1-based inclusive line ranges the diff touched (omit `lines` for "the whole file"). */
export interface ChangedFile {
  path: string;
  lines?: readonly [number, number][];
}

const overlaps = (a: readonly [number, number], b: readonly [number, number]) => a[0] <= b[1] && b[0] <= a[1];

/**
 * Like `nodesCitingPaths`, but narrowed by line ranges: a node cites a changed file with a line range that the diff
 * doesn't touch is `skipped`, not hit. Either side lacking lines is a file-level match (`precision: "file"`), so
 * evidence without a range behaves exactly as `nodesCitingPaths` does.
 */
export function nodesCitingChanges(g: WorkspaceGraph, changes: readonly ChangedFile[]): { hit: { node: GraphNode; precision: "lines" | "file" }[]; skipped: GraphNode[] } {
  const hit: { node: GraphNode; precision: "lines" | "file" }[] = [];
  const skipped: GraphNode[] = [];
  for (const n of g.nodes) {
    let matched = false;
    let precision: "lines" | "file" | null = null;
    for (const c of n.code ?? []) {
      if (!c.path) continue;
      for (const ch of changes) {
        if (!samePath(c.path, ch.path)) continue;
        matched = true;
        if (!c.lines || !ch.lines?.length) precision ??= "file";
        else if (ch.lines.some((r) => overlaps(c.lines!, r))) precision = "lines";
      }
    }
    if (precision) hit.push({ node: n, precision });
    else if (matched) skipped.push(n);
  }
  return { hit, skipped };
}

export interface RiskEntry {
  ref: string;
  label: string;
  score: number;
  reasons: string[];
}

export interface Risk {
  /** Modified and affected nodes, riskiest first (bounded). */
  ranked: RiskEntry[];
  /** Modified nodes that cite code but link no test (`role: "test"` evidence). */
  untested: string[];
}

export const RISK_LIMITS = { ranked: 20, fanIn: 5 } as const;

/**
 * A ranking over an `Impact`, so an agent knows where to look first: a modified node outranks an affected one; more
 * dependents (fan-in), a protecting warning, and no linked test each add to the score. `warned` maps a ref to how many
 * warnings protect it (computed by the caller: warnings live in `knowledge.ts`). Reach along drawn links, not a proof.
 */
export function riskOf(g: WorkspaceGraph, impact: Impact, warned: ReadonlyMap<string, number> = new Map()): Risk {
  const modified = new Set(impact.modified.map((m) => m.ref));
  const ranked: RiskEntry[] = [];
  const untested: string[] = [];
  for (const e of [...impact.modified, ...impact.affected]) {
    const n = g.byAddress.get(e.ref);
    if (n?.what !== "node") continue;
    const addrs = new Set(addressesOf(n));
    const fanIn = new Set(g.edges.filter((x) => x.canvasId === n.canvasId && addrs.has(x.to)).map((x) => x.from)).size;
    const warnings = warned.get(e.ref) ?? 0;
    const hasCode = !!n.code?.some((c) => c.path && c.role !== "test");
    const noTest = hasCode && !n.code?.some((c) => c.role === "test");
    const reasons: string[] = [];
    let score = 0;
    if (modified.has(e.ref)) {
      score += 3;
      reasons.push("changed");
    }
    if (fanIn) {
      score += Math.min(fanIn, RISK_LIMITS.fanIn);
      reasons.push(`${fanIn} dependent${fanIn === 1 ? "" : "s"}`);
    }
    if (warnings) {
      score += 2 * warnings;
      reasons.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
    }
    if (noTest && modified.has(e.ref)) {
      score += 2;
      reasons.push("no linked test");
      untested.push(e.ref);
    }
    ranked.push({ ref: e.ref, label: e.label, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { ranked: ranked.slice(0, RISK_LIMITS.ranked), untested };
}
