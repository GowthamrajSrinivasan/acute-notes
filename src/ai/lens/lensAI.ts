/**
 * Pure helpers for Lens's AI actions (plan §6, Phase 5): the bounded, redacted inputs the three tasks get, built only
 * from what Lens already shows; the local first pass of Ask (name matching, §6.2) and the check of the model's
 * keys; the level a "Generate" produces and the frame it lands in. No runtime, no DOM.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import type { ArchitectureKind } from "@/domain/canvas/diagram";
import { redactSecrets } from "@/ai/context/redact";
import { RELATION_LABELS } from "@/domain/canvas/diagram";
import { codeEvidence } from "@/domain/lens/evidence";
import type { LensLevelView, LensNode, LensTreeNode } from "@/domain/lens/lensView";
import {
  LENS_AI_LIMITS,
  type LensAssessInput,
  type LensAssessOutput,
  type LensExpandInput,
  type LensExplainInput,
  type LensNavigateInput,
  type LensNavigateOutput,
  type LensNodeFacts,
  type LensReviewInput,
  type LensReviewTopic,
  type LensStructureFacts,
} from "./lensTasks";

const clip = (s: string, max: number) => {
  const t = redactSecrets(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function nodeFacts(n: LensNode): LensNodeFacts {
  return {
    label: clip(n.label || "Untitled", 200),
    ...(n.semantics.kind ? { kind: n.semantics.kind } : {}),
    ...(n.semantics.sublabel ? { sublabel: clip(n.semantics.sublabel, 120) } : {}),
    ...(n.semantics.details?.length ? { details: n.semantics.details.slice(0, 8).map((d) => clip(d, 200)) } : {}),
  };
}

/** The node's links on its level, from its side: direction, the other end, the relation, its label and why. */
function relationsOf(view: Pick<LensLevelView, "nodes" | "edges">, node: LensNode): LensExplainInput["relations"] {
  const byId = new Map(view.nodes.map((n) => [n.id, n] as const));
  return view.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .flatMap((e) => {
      const out = e.from === node.id;
      const other = byId.get(out ? e.to : e.from);
      if (!other) return [];
      return [
        {
          direction: out ? ("out" as const) : ("in" as const),
          other: clip(other.label || "Untitled", 200),
          ...(e.relation ? { relation: RELATION_LABELS[e.relation] ?? e.relation } : {}),
          ...(e.label ? { label: clip(e.label, 120) } : {}),
          ...(e.explanation ? { explanation: clip(e.explanation, 300) } : {}),
        },
      ];
    })
    .slice(0, LENS_AI_LIMITS.relations);
}

const levelName = (view: Pick<LensLevelView, "profile" | "level">) => {
  const l = view.profile.levels[view.level];
  return l ? `${l.short} ${l.name}` : `L${view.level}`;
};

/** The levels above this one, root first (crumb titles), without this level's own. */
const pathOf = (view: Pick<LensLevelView, "crumbs">) => view.crumbs.slice(0, -1).map((c) => clip(c.title || "Untitled", 200)).slice(-LENS_AI_LIMITS.path);

/** `lens_explain`'s input: the node, its links, the levels above, its detail level's nodes and its evidence (paths only). */
export function explainInput(view: LensLevelView, node: LensNode, children: readonly string[] = []): LensExplainInput {
  return {
    node: nodeFacts(node),
    level: levelName(view),
    frame: clip(view.title || "Untitled", 200),
    path: pathOf(view),
    relations: relationsOf(view, node),
    children: children.slice(0, LENS_AI_LIMITS.children).map((c) => clip(c, 200)),
    evidence: [...codeEvidence(node.evidence).map((e) => e.label), ...node.evidence.filter((e) => e.source === "document").map((e) => e.label)]
      .slice(0, LENS_AI_LIMITS.evidence)
      .map((e) => clip(e, 300)),
  };
}

// ---------------------------------------------------------------------------
// Design review (requirements, capacity, scale, failure, tradeoffs)

const STORE_KINDS = new Set(["database", "store"]);
const EXTERNAL_KINDS = new Set(["external", "cloud"]);

/**
 * Structure computed from the level's graph, so the model reasons over facts instead of guessing them: degree per node,
 * stores several nodes reach, external dependencies, the longest chain of links (cycles cut) and unconnected nodes.
 */
export function structureFacts(view: Pick<LensLevelView, "nodes" | "edges">): LensStructureFacts {
  const label = (n: LensNode) => clip(n.label || "Untitled", 200);
  const byId = new Map(view.nodes.map((n) => [n.id, n] as const));
  const edges = view.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  // Longest simple path by depth-first search, bounded (a diagram level is small; the cap keeps a dense one cheap).
  let best: string[] = [];
  let steps = 0;
  const walk = (id: string, seen: string[]) => {
    if (steps++ > 20_000) return;
    if (seen.length > best.length) best = seen;
    for (const n of next.get(id) ?? []) if (!seen.includes(n)) walk(n, [...seen, n]);
  };
  for (const n of view.nodes) if (!inDeg.get(n.id)) walk(n.id, [n.id]);
  if (!best.length && view.nodes[0]) walk(view.nodes[0].id, [view.nodes[0].id]); // a pure cycle has no entry

  const kindOf = (n: LensNode) => n.semantics.kind;
  return {
    degree: view.nodes.slice(0, LENS_AI_LIMITS.reviewNodes).map((n) => ({ label: label(n), ...(kindOf(n) ? { kind: kindOf(n)! } : {}), in: inDeg.get(n.id) ?? 0, out: outDeg.get(n.id) ?? 0 })),
    sharedStores: view.nodes.filter((n) => STORE_KINDS.has(kindOf(n) ?? "") && (inDeg.get(n.id) ?? 0) >= 2).map(label).slice(0, 20),
    externalDependencies: view.nodes.filter((n) => EXTERNAL_KINDS.has(kindOf(n) ?? "") && (inDeg.get(n.id) ?? 0) > 0).map(label).slice(0, 20),
    longestChain: best.length > 1 ? best.map((id) => label(byId.get(id)!)).slice(0, 20) : [],
    isolated: view.nodes.filter((n) => !inDeg.get(n.id) && !outDeg.get(n.id)).map(label).slice(0, 20),
  };
}

/**
 * `lens_review`'s input: the whole level (not one node) with its computed structure, the user's own figures and the
 * decisions on record. Bounded and redacted like the other inputs; Acute reads no code for it.
 */
export function reviewInput(
  view: LensLevelView,
  topic: LensReviewTopic,
  opts: { question?: string; assumptions?: string; factor?: number; decisions?: readonly string[] } = {},
): LensReviewInput {
  const byId = new Map(view.nodes.map((n) => [n.id, n] as const));
  const question = opts.question?.trim();
  const assumptions = opts.assumptions?.trim();
  return {
    topic,
    ...(question ? { question: clip(question, LENS_AI_LIMITS.question) } : {}),
    ...(assumptions ? { assumptions: clip(assumptions, LENS_AI_LIMITS.assumptions) } : {}),
    ...(opts.factor ? { factor: opts.factor } : {}),
    level: levelName(view),
    frame: clip(view.title || "Untitled", 200),
    path: pathOf(view),
    nodes: view.nodes.slice(0, LENS_AI_LIMITS.reviewNodes).map(nodeFacts),
    relations: view.edges
      .flatMap((e) => {
        const from = byId.get(e.from);
        const to = byId.get(e.to);
        if (!from || !to) return [];
        return [
          {
            from: clip(from.label || "Untitled", 200),
            to: clip(to.label || "Untitled", 200),
            ...(e.relation ? { relation: RELATION_LABELS[e.relation] ?? e.relation } : {}),
            ...(e.label ? { label: clip(e.label, 120) } : {}),
            ...(e.explanation ? { explanation: clip(e.explanation, 300) } : {}),
          },
        ];
      })
      .slice(0, LENS_AI_LIMITS.reviewRelations),
    structure: structureFacts(view),
    decisions: (opts.decisions ?? []).slice(0, LENS_AI_LIMITS.reviewDecisions).map((d) => clip(d, 300)),
  };
}

/**
 * `lens_assess`'s input: the same level facts as `reviewInput`, with the questions to answer. Unknown ids can't come
 * back (`resolveAssessment` drops them), and questions beyond the bound are dropped, built-ins first.
 */
export function assessInput(
  view: LensLevelView,
  track: "hld" | "lld",
  questions: readonly { id: string; category: string; text: string }[],
  opts: { assumptions?: string; decisions?: readonly string[] } = {},
): LensAssessInput {
  const { topic: _topic, question: _question, factor: _factor, ...base } = reviewInput(view, "requirements", opts);
  return { ...base, track, questions: questions.slice(0, LENS_AI_LIMITS.assessQuestions).map((q) => ({ id: q.id, category: clip(q.category, 60), text: clip(q.text, LENS_AI_LIMITS.question) })) };
}

/** The model's answers, keeping only ids it was asked, one per id (the first wins). */
export function resolveAssessment(reply: LensAssessOutput, asked: readonly { id: string }[]): Map<string, LensAssessOutput["answers"][number]> {
  const ids = new Set(asked.map((q) => q.id));
  const out = new Map<string, LensAssessOutput["answers"][number]>();
  for (const a of reply.answers) if (ids.has(a.id) && !out.has(a.id)) out.set(a.id, a);
  return out;
}

/**
 * The level "Generate" would produce under `view` (§6.3): the next one in the profile, while it is a diagram level
 * (not the source level, L5); undefined past that, or on a profile without drilling (Project).
 */
export function nextLevel(view: Pick<LensLevelView, "profile" | "level">): { index: number; name: string } | undefined {
  if (view.profile.id !== "architecture") return undefined;
  const next = view.profile.levels[view.level + 1];
  if (!next || next.index === view.profile.sourceLevel || next.index > 4) return undefined;
  return { index: next.index, name: next.name };
}

/** `lens_expand`'s input. */
export function expandInput(view: LensLevelView, node: LensNode, level: { index: number; name: string }): LensExpandInput {
  return {
    node: nodeFacts(node),
    level,
    frame: clip(view.title || "Untitled", 200),
    path: pathOf(view),
    relations: relationsOf(view, node),
    siblings: view.nodes
      .filter((n) => n.id !== node.id)
      .map((n) => clip(n.label || "Untitled", 200))
      .slice(0, LENS_AI_LIMITS.siblings),
  };
}

/**
 * Whether a node's next level is code-grounded (§6.3): it cites code, or a Repo Map drew it. The in-app model can't
 * see the code, so Lens offers "Ask your IDE agent" instead of generating it.
 */
export function isCodeGrounded(node: Pick<LensNode, "evidence">): boolean {
  return node.evidence.some((e) => e.source === "code" || e.origin === "mcp");
}

// ---------------------------------------------------------------------------
// Ask (§6.2)

/** A node Ask can land on: what the model sees (key, label, level), plus where it is (never sent). */
export type NavigateCandidate = LensNavigateInput["nodes"][number] & { canvasId: string; id: string; path: string[] };

/**
 * Every node of the tree, each key once, bounded, with the drill path (node keys from the root) to its level. Only
 * `{ key, label, level }` goes to the model (`navigateNodes`).
 */
export function navigateCandidates(tree: LensTreeNode): NavigateCandidate[] {
  const out = new Map<string, NavigateCandidate>();
  const visit = (t: LensTreeNode, path: string[]) => {
    for (const n of t.nodes) {
      if (out.size >= LENS_AI_LIMITS.navigateNodes) return;
      if (!out.has(n.key) && n.label.trim()) out.set(n.key, { key: n.key, label: clip(n.label, 200), level: Math.min(5, Math.max(0, t.level)), canvasId: t.frame.canvasId, id: n.id, path });
    }
    for (const child of t.children) {
      const via = t.nodes.find((n) => n.childFrame && !n.childFrame.pending && n.childFrame.canvasId === child.frame.canvasId && n.childFrame.frameId === child.frame.frameId);
      if (via) visit(child, [...path, via.key]);
    }
  };
  visit(tree, []);
  return [...out.values()];
}

/** What `lens_navigate` is sent: keys, labels and levels only. */
export const navigateNodes = (candidates: readonly NavigateCandidate[]): LensNavigateInput["nodes"] => candidates.map(({ key, label, level }) => ({ key, label, level }));

/**
 * Where Lens opens for an answer (§6.2): the lowest level both nodes share (the common part of their drill paths),
 * selecting the node on it that leads to `from` (or `from` itself when it is on that level).
 */
export function navigateTarget(from: NavigateCandidate, to: NavigateCandidate | undefined): { path: string[]; nodeKey: string } {
  if (!to) return { path: from.path, nodeKey: from.key };
  let common = 0;
  while (common < from.path.length && common < to.path.length && from.path[common] === to.path[common]) common++;
  const path = from.path.slice(0, common);
  return { path, nodeKey: from.path[common] ?? from.key };
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The local first pass (§6.2): nodes whose label appears in the question (as a whole phrase, or all of its words),
 * in the order the question names them; a longer label wins over one inside it ("Order API" over "Order").
 * `from` is the first named, `to` the second. AI is used only when this finds nothing.
 */
export function matchQuestion(question: string, candidates: readonly NavigateCandidate[]): LensNavigateOutput {
  const q = ` ${words(question)} `;
  const hits: { key: string; at: number; length: number }[] = [];
  for (const c of candidates) {
    const label = words(c.label);
    if (label.length < 3) continue;
    let at = q.indexOf(` ${label} `);
    if (at < 0) {
      // Plurals and possessives ("payments", "order's"): the label's words each start a word of the question.
      const parts = label.split(" ");
      const positions = parts.map((p) => q.search(new RegExp(` ${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)));
      if (parts.some((p) => p.length < 3) || positions.some((p) => p < 0)) continue;
      at = Math.min(...positions);
    }
    hits.push({ key: c.key, at, length: label.length });
  }
  // Longest first, then drop a hit that sits inside a longer one.
  hits.sort((a, b) => b.length - a.length || a.at - b.at);
  const kept: typeof hits = [];
  for (const h of hits) if (!kept.some((k) => h.at >= k.at && h.at + h.length <= k.at + k.length)) kept.push(h);
  kept.sort((a, b) => a.at - b.at);
  return { from: kept[0]?.key ?? null, to: kept.find((h) => h.key !== kept[0]?.key)?.key ?? null };
}

/** The model's reply, keeping only keys it was given (D: the model maps onto keys, it never invents one). */
export function resolveNavigate(reply: LensNavigateOutput, candidates: readonly NavigateCandidate[]): LensNavigateOutput {
  const known = new Set(candidates.map((c) => c.key));
  const from = reply.from && known.has(reply.from) ? reply.from : null;
  const to = reply.to && known.has(reply.to) && reply.to !== from ? reply.to : null;
  return from ? { from, to } : { from: to, to: null };
}

// ---------------------------------------------------------------------------
// Generate (§6.3)

/**
 * The rendered plan as the generated level (D7, §6.3): its one frame titled for the node, at `level`, interactive;
 * every created object stays the model's (its provenance is the set's). Returns the frame's change key, which the
 * parent's drill link points at once accepted.
 */
export function asGeneratedLevel(set: ChangeSet, node: { label: string }, level: number): { set: ChangeSet; frameKey: string } | undefined {
  const frame = set.changes.find((c) => c.kind === "create_frame");
  if (!frame || frame.kind !== "create_frame") return undefined;
  const title = clip(`${node.label} · L${level}`, 200);
  const changes = set.changes.map((c) => (c === frame ? { ...frame, title, level, diagram: frame.diagram ?? {}, overview: { title } } : c));
  return { set: { ...set, changes }, frameKey: frame.key };
}

const DEFAULT_KIND: Record<number, ArchitectureKind> = { 1: "backend", 2: "backend", 3: "step", 4: "function" };

/**
 * The plan as one level (§6.3): sections and headings the model added are dropped (their members stay; the frame
 * carries the title) so it renders as a single interactive frame, and a shape without a kind gets the level's default
 * (a frame needs one to be a diagram).
 */
export function asLevelPlan(plan: VisualPlan, level: number): VisualPlan {
  const nodes = plan.nodes
    .filter((n) => n.type !== "group" && n.type !== "heading")
    .map((n): VisualNode => {
      const { parent: _parent, ...rest } = n;
      if (rest.type !== "shape" || rest.content.kind) return rest as VisualNode;
      return { ...rest, content: { ...rest.content, kind: DEFAULT_KIND[level] ?? "backend" } } as VisualNode;
    });
  const ids = new Set(nodes.map((n) => n.id));
  return { ...plan, template: "architecture", nodes, relationships: plan.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)) };
}

