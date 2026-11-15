/**
 * Deterministic evaluator for the Knowledge Notes golden dataset.
 *
 * It reads generated output in the formats the product already produces or can be adapted to:
 * - a `VisualPlan` (the AI pipeline's output, `ai/visual-plan/types.ts`), ideally after `validateVisualPlan`;
 * - a normalised Lens projection (`LensProjection`, schemas.ts);
 * - a normalised reconcile outcome (`ReconcileOutcome`, schemas.ts).
 *
 * Matching is by content, never by the generated ids: an expected element matches a node of an allowed type whose
 * normalised text contains one term of every `match.all` group. That is deliberately simple and is a known limit
 * (README "Limitations"): once cards carry `cites` (knowledge-notes-plan §4.1), matching should move to cited units.
 *
 * Only `method: "deterministic"` assertions are decided here. Judged ones come back as `needs_judgement`, and
 * assertions whose `support` is `future` come back as `not_evaluable`. Neither is ever reported as a pass.
 *
 * The one exception: a `future` assertion that needs a run's own output (citations, unit accounting, the review
 * queue) is decided when the run carries that output (`actual.run`, a `KnowledgeRunOutput`): see `runOutput.ts`.
 * Without it, it stays `not_evaluable`.
 */
import { subGroupLayout } from "@/ai/renderer/layout";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import type { RelationType } from "@/domain/types";
import type { RenderFacts } from "./render";
import { derivedCheck, RUN_CHECKS, runCapabilities, runCheck, type RunEvidence } from "./runOutput";
import { GATE_OF_DIMENSION, type Assertion, type Check, type ExpectedCanvas, type ExpectedKnowledge, type ExpectedLens, type ExpectedReconcile, type LensProjection, type ReconcileOutcome, type SourceCase } from "./schemas";

export type AssertionStatus = "pass" | "fail" | "needs_judgement" | "not_evaluable" | "no_input";

export interface AssertionResult {
  id: string;
  /** 1 knowledge, 2 organisation, 3 layout (`GATE_OF_DIMENSION`). */
  gate: 1 | 2 | 3;
  status: AssertionStatus;
  severity: Assertion["severity"];
  dimension: Assertion["dimension"];
  detail: string;
}

export interface Expectations {
  canvas: ExpectedCanvas;
  lens?: ExpectedLens;
  reconcile?: ExpectedReconcile;
  /** The case's source units and knowledge: what the run checks (cites, accounting, review) read against. */
  source?: SourceCase;
  knowledge?: ExpectedKnowledge;
}

export interface ActualOutput {
  plan?: VisualPlan;
  lens?: LensProjection;
  reconcile?: ReconcileOutcome;
  /** The plan rendered and measured (`renderFacts`), for gate 3. */
  render?: RenderFacts;
  /** The run's own output besides the plan (units, cites, omissions, accounting, flags), when it has any. */
  run?: RunEvidence;
}

// ---------------------------------------------------------------- text

/** Lower-case, ASCII quotes and dashes, no markdown emphasis, no thousands separators, single spaces (knowledge-notes-plan §3.3). */
export function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[*`]/g, "")
    // Emphasis underscores go; the ones inside identifiers (rerank_skipped, $GREEN_TG_ARN) stay.
    .replace(/(^|[^\p{L}\p{N}_])_+(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])_+(?=[^\p{L}\p{N}_]|$)/gu, "$1")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function nodeText(node: VisualNode): string {
  const parts: string[] = [node.title ?? ""];
  switch (node.type) {
    case "heading":
      parts.push(node.content.text);
      break;
    case "text":
      parts.push(node.content.markdown);
      break;
    case "todo":
      parts.push(...node.content.items.map((i) => i.text));
      break;
    case "table":
      parts.push(...node.content.columns, ...node.content.rows.flat());
      break;
    case "code":
      parts.push(node.content.source);
      break;
    case "page":
      parts.push(node.content.title, node.content.markdown);
      break;
    case "shape":
      parts.push(node.content.label, node.content.sublabel ?? "", node.content.tag ?? "", ...(node.content.details ?? []));
      break;
    case "image":
      parts.push(node.content.alt ?? "");
      break;
    case "group":
      parts.push(node.content.label, node.content.takeaway ?? "");
      break;
  }
  return normalize(parts.join(" \n "));
}

export function matchesAll(textValue: string, groups: readonly (readonly string[])[]): boolean {
  const t = normalize(textValue);
  return groups.every((group) => group.some((term) => t.includes(normalize(term))));
}

// ---------------------------------------------------------------- plan lookups

/** Element kinds that are things that happen or code, not parts of the system: a numbered flow step may stand for them. */
const STEP_LIKE_KINDS: ReadonlySet<string> = new Set(["step", "event", "function"]);

/** A shape labelled as a numbered flow step ("1 · POST /v1/answers", "2. Check session", "3) Fetch"), as the cases' references draw steps. */
export function isNumberedStep(n: VisualNode): boolean {
  return n.type === "shape" && /^\s*\d+(?:\.\d+)*\s*[·.)]\s+\S/.test(n.content.label);
}

class PlanView {
  readonly nodes: VisualNode[];
  readonly groups: VisualNode[];
  readonly text = new Map<string, string>();
  private readonly byId: Map<string, VisualNode>;

  constructor(readonly plan: VisualPlan, readonly canvas: ExpectedCanvas) {
    this.nodes = plan.nodes.filter((n) => n.type !== "group");
    this.groups = plan.nodes.filter((n) => n.type === "group");
    this.byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
    for (const n of plan.nodes) this.text.set(n.id, nodeText(n));
  }

  /**
   * The frame a node sits in: its parent, walked up through sub-groups to the top-level group (organisation-layout
   * plan F13), so two cards in one frame read as together even when one is in a sub-group of it.
   */
  frameOf(n: VisualNode): string | undefined {
    let at = n.parent;
    for (let hops = 0; at && hops < this.plan.nodes.length; hops++) {
      const p = this.byId.get(at);
      const up = p?.type === "group" && p.parent ? this.byId.get(p.parent) : undefined;
      if (up?.type !== "group") break;
      at = up.id;
    }
    return at;
  }

  element(id: string) {
    const e = this.canvas.elements.find((x) => x.id === id);
    if (!e) throw new Error(`unknown element ${id}`);
    return e;
  }

  frame(id: string) {
    const f = this.canvas.frames.find((x) => x.id === id);
    if (!f) throw new Error(`unknown frame ${id}`);
    return f;
  }

  /**
   * Plan nodes standing for an expected element. A component (an element whose `kind` is a part of the system, not a
   * step, event or function) is never stood for by a numbered flow step ("3 · Call Supplier API"): a step that names a
   * component is about what happens there, and taking it for the component would score the step's citations against
   * the component's passages (live 2026-10-20, kn-08 and kn-10). With no component shape, the element is not found.
   */
  candidates(elementId: string): VisualNode[] {
    const e = this.element(elementId);
    const component = e.kind !== undefined && !STEP_LIKE_KINDS.has(e.kind);
    return this.plan.nodes.filter(
      (n) => (e.planNodeTypes as readonly string[]).includes(n.type) && matchesAll(this.text.get(n.id) ?? "", e.match.all) && !(component && isNumberedStep(n)),
    );
  }

  /** Group nodes (frames) standing for an expected frame. */
  frameCandidates(frameId: string): VisualNode[] {
    const f = this.frame(frameId);
    return this.groups.filter((g) => matchesAll(this.text.get(g.id) ?? "", f.titleMatch.all));
  }
}

/** Plan nodes standing for an expected element, matched by content (what every plan check uses). */
export function planCandidates(plan: VisualPlan, canvas: ExpectedCanvas, elementId: string): VisualNode[] {
  return new PlanView(plan, canvas).candidates(elementId);
}

function relationLabel(r: VisualRelationship): string {
  return normalize(r.label ?? "");
}

// ---------------------------------------------------------------- plan checks

type Outcome = { ok: boolean; detail: string };

function planCheck(view: PlanView, check: Check): Outcome {
  switch (check.check) {
    case "element_present": {
      const c = view.candidates(check.element);
      return c.length ? { ok: true, detail: `matched ${c.map((n) => n.id).join(", ")}` } : { ok: false, detail: `no ${view.element(check.element).planNodeTypes.join("/")} node matches ${check.element}` };
    }
    case "element_in_frame": {
      const frames = new Set(view.frameCandidates(check.frame).map((g) => g.id));
      if (!frames.size) return { ok: false, detail: `frame ${check.frame} not found` };
      const c = view.candidates(check.element);
      if (!c.length) return { ok: false, detail: `element ${check.element} not found` };
      const inside = c.filter((n) => frames.has(view.frameOf(n) ?? ""));
      return inside.length ? { ok: true, detail: `${inside[0]!.id} in ${view.frameOf(inside[0]!)}` } : { ok: false, detail: `${check.element} is outside ${check.frame} (parents: ${c.map((n) => view.frameOf(n) ?? "none").join(", ")})` };
    }
    case "element_kind": {
      const c = view.candidates(check.element);
      const kinded = c.filter((n) => {
        const kind = n.type === "shape" ? (n.content.kind ?? n.kind) : n.kind;
        return kind !== undefined && (check.kinds as readonly string[]).includes(kind);
      });
      return kinded.length ? { ok: true, detail: `kind ok on ${kinded[0]!.id}` } : { ok: false, detail: `no ${check.element} node has kind ${check.kinds.join("/")}` };
    }
    case "frame_present": {
      const g = view.frameCandidates(check.frame);
      return g.length ? { ok: true, detail: `matched ${g.map((n) => n.id).join(", ")}` } : { ok: false, detail: `no frame titled like ${check.frame}` };
    }
    case "frame_level": {
      const g = view.frameCandidates(check.frame).filter((n) => n.type === "group" && n.content.level === check.level);
      return g.length ? { ok: true, detail: `level ${check.level} on ${g[0]!.id}` } : { ok: false, detail: `${check.frame} has no group with level ${check.level}` };
    }
    case "frame_count": {
      const n = view.groups.length;
      return n >= check.min && n <= check.max ? { ok: true, detail: `${n} frames` } : { ok: false, detail: `${n} frames, expected ${check.min}–${check.max}` };
    }
    case "together": {
      const parents = check.elements.map((e) => new Set(view.candidates(e).map((n) => view.frameOf(n) ?? "")));
      const missing = check.elements.filter((_, i) => !parents[i]!.size);
      if (missing.length) return { ok: false, detail: `not found: ${missing.join(", ")}` };
      const shared = [...parents[0]!].filter((p) => p && parents.every((s) => s.has(p)));
      return shared.length ? { ok: true, detail: `together in ${shared[0]}` } : { ok: false, detail: `${check.elements.join(", ")} are in different frames: ${check.why}` };
    }
    case "apart": {
      const [a, b] = check.elements.map((e) => new Set(view.candidates(e).map((n) => view.frameOf(n)).filter((p): p is string => !!p)));
      const shared = [...a!].filter((p) => b!.has(p));
      return shared.length ? { ok: false, detail: `${check.elements.join(" and ")} share frame ${shared[0]}: ${check.why}` } : { ok: true, detail: "apart" };
    }
    case "hierarchy": {
      const main = view.candidates(check.main);
      if (!main.length) return { ok: false, detail: `main idea ${check.main} not found: ${check.why}` };
      const mainIds = new Set(main.map((n) => n.id));
      const mainParents = new Set(main.map((n) => view.frameOf(n) ?? ""));
      const rank = { high: 3, medium: 2, low: 1 } as const;
      const mainRank = Math.max(...main.map((n) => (n.importance ? rank[n.importance] : 2)));
      for (const s of check.supporting) {
        const sup = view.candidates(s);
        if (!sup.length) return { ok: false, detail: `supporting ${s} not found` };
        const linked = sup.some((n) => view.plan.relationships.some((r) => (r.from === n.id && mainIds.has(r.to)) || (r.to === n.id && mainIds.has(r.from))));
        const nearby = sup.some((n) => mainParents.has(view.frameOf(n) ?? ""));
        if (!linked && !nearby) return { ok: false, detail: `${s} is neither linked to nor beside ${check.main}: ${check.why}` };
        const outranks = sup.some((n) => n.importance && rank[n.importance] > mainRank);
        if (outranks) return { ok: false, detail: `${s} is weighted above ${check.main}: ${check.why}` };
      }
      return { ok: true, detail: "supporting ideas hang off the main one" };
    }
    case "relationship_present":
      return relationshipPresent(view, check.relationship);
    case "relationship_absent": {
      const from = new Set(view.candidates(check.from).map((n) => n.id));
      const to = new Set(view.candidates(check.to).map((n) => n.id));
      const bad = view.plan.relationships.filter((r) => from.has(r.from) && to.has(r.to) && (!check.types || (check.types as readonly string[]).includes(r.type)));
      return bad.length ? { ok: false, detail: `forbidden ${bad[0]!.type} ${bad[0]!.from} → ${bad[0]!.to}: ${check.why}` } : { ok: true, detail: "absent" };
    }
    case "architecture_edges_labeled": {
      const types = check.types as readonly string[];
      const bad = view.plan.relationships.filter((r) => types.includes(r.type) && !relationLabel(r));
      return bad.length ? { ok: false, detail: `${bad.length} unlabeled: ${bad.map((r) => `${r.from}-${r.type}->${r.to}`).join(", ")}` } : { ok: true, detail: "all labeled" };
    }
    case "text_present": {
      const pool = check.element ? view.candidates(check.element).map((n) => view.text.get(n.id) ?? "") : [[...view.text.values()].join(" \n "), view.plan.relationships.map(relationLabel).join(" \n ")];
      if (check.element && !pool.length) return { ok: false, detail: `element ${check.element} not found` };
      const hit = pool.some((t) => matchesAll(t, check.all));
      return hit ? { ok: true, detail: "present" } : { ok: false, detail: `missing ${check.all.map((g) => g.join("|")).join(" + ")}${check.element ? ` in ${check.element}` : ""}: ${check.why}` };
    }
    case "text_absent": {
      const re = new RegExp(check.pattern, "i");
      const texts = [...[...view.text.entries()].map(([id, t]) => [id, t] as const), ...view.plan.relationships.map((r, i) => [`relationship ${i}`, relationLabel(r)] as const)];
      const hit = texts.find(([, t]) => re.test(t));
      return hit ? { ok: false, detail: `"${check.pattern}" found in ${hit[0]}: ${check.why}` } : { ok: true, detail: "absent" };
    }
    default:
      return { ok: false, detail: `${check.check} does not read a plan` };
  }
}

function relationshipPresent(view: PlanView, id: string): Outcome {
  const rel = view.canvas.relationships.find((r) => r.id === id);
  if (!rel) throw new Error(`unknown relationship ${id}`);
  const from = new Set(view.candidates(rel.from).map((n) => n.id));
  const to = new Set(view.candidates(rel.to).map((n) => n.id));
  if (!from.size) return { ok: false, detail: `endpoint ${rel.from} not found` };
  if (!to.size) return { ok: false, detail: `endpoint ${rel.to} not found` };
  const types = (rel.acceptableTypes ?? [rel.type]) as readonly string[];
  const forward = view.plan.relationships.filter((r) => from.has(r.from) && to.has(r.to));
  const backward = view.plan.relationships.filter((r) => from.has(r.to) && to.has(r.from));
  const linking = rel.direction === "bidirectional" ? [...forward, ...backward] : forward;
  if (!linking.length) return { ok: false, detail: backward.length ? `${id} is reversed (${rel.to} → ${rel.from})` : `${id}: no link ${rel.from} → ${rel.to}` };
  const typed = linking.filter((r) => types.includes(r.type));
  if (!typed.length) return { ok: false, detail: `${id}: link has type ${linking.map((r) => r.type).join("/")}, expected ${types.join("/")}` };
  if (!rel.label.required) return { ok: true, detail: `${typed[0]!.type}` };
  const labeled = typed.filter((r) => relationLabel(r) && (!rel.label.match || matchesAll(r.label ?? "", rel.label.match.all)));
  if (labeled.length) return { ok: true, detail: `${labeled[0]!.type} "${labeled[0]!.label}"` };
  return { ok: false, detail: typed.some((r) => relationLabel(r)) ? `${id}: label "${typed[0]!.label}" doesn't say ${rel.label.match?.all.map((g) => g.join("|")).join(" + ")}` : `${id}: unlabeled` };
}

// ---------------------------------------------------------------- lens checks

type ProjNode = LensProjection["levels"][number]["nodes"][number] & { level: number; frameKey: string };

function lensCheck(expected: ExpectedLens, proj: LensProjection, check: Check): Outcome {
  const all: ProjNode[] = proj.levels.flatMap((l) => l.nodes.map((n) => ({ ...n, level: l.level, frameKey: l.frameKey })));
  const node = (key: string) => {
    const n = expected.nodes.find((x) => x.key === key);
    if (!n) throw new Error(`unknown lens node ${key}`);
    return n;
  };
  const found = (key: string, atLevel = true) => {
    const e = node(key);
    return all.filter((n) => (!atLevel || n.level === e.level) && matchesAll(n.label, e.match.all));
  };
  switch (check.check) {
    case "lens_node": {
      const f = found(check.key);
      return f.length ? { ok: true, detail: `${f[0]!.key} at L${f[0]!.level}` } : { ok: false, detail: `${check.key} not at L${node(check.key).level}` };
    }
    case "lens_edge": {
      const e = expected.edges.find((x) => x.id === check.edge);
      if (!e) throw new Error(`unknown lens edge ${check.edge}`);
      const from = new Set(found(e.from).map((n) => n.key));
      const to = new Set(found(e.to).map((n) => n.key));
      const levels = proj.levels.filter((l) => l.level === e.level);
      const edges = levels.flatMap((l) => l.edges).filter((x) => from.has(x.from) && to.has(x.to));
      if (!edges.length) {
        const reversed = levels.flatMap((l) => l.edges).some((x) => from.has(x.to) && to.has(x.from));
        return { ok: false, detail: reversed ? `${e.id} reversed at L${e.level}` : `${e.id} missing at L${e.level}` };
      }
      const good = edges.filter((x) => x.relation === e.relation && normalize(x.label ?? ""));
      return good.length ? { ok: true, detail: `${good[0]!.relation} "${good[0]!.label}"` } : { ok: false, detail: `${e.id}: ${edges[0]!.relation} "${edges[0]!.label ?? ""}", expected labeled ${e.relation}` };
    }
    case "lens_drill": {
      const from = new Set(found(check.from).map((n) => n.key));
      const target = expected.levels.find((l) => l.frameKey === check.to);
      if (!target) throw new Error(`unknown lens frame ${check.to}`);
      const targetFrames = new Set(proj.levels.filter((l) => l.level === target.level && target.nodes.some((k) => l.nodes.some((n) => matchesAll(n.label, node(k).match.all)))).map((l) => l.frameKey));
      const ok = proj.drills.some((d) => from.has(d.from) && targetFrames.has(d.toFrameKey));
      return ok ? { ok: true, detail: `drills to L${target.level}` } : { ok: false, detail: `${check.from} does not drill to ${check.to} (L${target.level})` };
    }
    case "lens_identity": {
      // The same component wherever it appears: nodes of its kind whose label matches it all share one key.
      const kind = node(check.key).kind;
      const f = found(check.key, false).filter((n) => n.kind === undefined || n.kind === kind);
      if (!f.length) return { ok: false, detail: `${check.key} not found at any level` };
      const keys = new Set(f.map((n) => n.key));
      const kinds = new Set(f.map((n) => n.kind ?? ""));
      return keys.size === 1 && kinds.size === 1 ? { ok: true, detail: `one identity ${[...keys][0]} at L${[...new Set(f.map((n) => n.level))].join(",L")}` } : { ok: false, detail: `${check.key} appears as ${[...keys].join(", ")} (kinds ${[...kinds].join(", ")})` };
    }
    case "lens_no_children": {
      const keys = new Set(found(check.key).map((n) => n.key));
      const drill = proj.drills.find((d) => keys.has(d.from));
      const withLines = all.find((n) => keys.has(n.key) && n.evidence?.some((ev) => ev.lines));
      if (drill) return { ok: false, detail: `${check.key} drills to ${drill.toFrameKey}: ${check.why}` };
      if (withLines) return { ok: false, detail: `${check.key} carries code line evidence: ${check.why}` };
      // Internals drawn below it without a drill link: deeper nodes named after it.
      const level = node(check.key).level;
      const internals = all.filter((n) => n.level > level && !keys.has(n.key) && matchesAll(n.label, node(check.key).match.all));
      if (internals.length) return { ok: false, detail: `${check.key} has invented internals at L${internals[0]!.level} ("${internals[0]!.label}"): ${check.why}` };
      return { ok: true, detail: "no invented detail" };
    }
    case "lens_path": {
      const p = expected.navigationPaths.find((x) => x.id === check.path);
      if (!p) throw new Error(`unknown path ${check.path}`);
      const levelOf = (frameKey: string) => proj.levels.filter((l) => l.frameKey === frameKey);
      for (let i = 0; i + 1 < p.path.length; i++) {
        const a = new Set(found(p.path[i]!).map((n) => n.key));
        const b = new Set(found(p.path[i + 1]!).map((n) => n.key));
        const edge = proj.levels.some((l) => l.edges.some((x) => a.has(x.from) && b.has(x.to)));
        const down = proj.drills.some((d) => a.has(d.from) && levelOf(d.toFrameKey).some((l) => l.nodes.some((n) => b.has(n.key))));
        const up = proj.drills.some((d) => b.has(d.from) && levelOf(d.toFrameKey).some((l) => l.nodes.some((n) => a.has(n.key))));
        if (!edge && !down && !up) return { ok: false, detail: `${check.path}: no step ${p.path[i]} → ${p.path[i + 1]}` };
      }
      return { ok: true, detail: `${p.path.length} steps` };
    }
    default:
      return { ok: false, detail: `${check.check} does not read a Lens projection` };
  }
}

// ---------------------------------------------------------------- reconcile checks

function reconcileCheck(expected: ExpectedReconcile, outcome: ReconcileOutcome, check: Check): Outcome {
  if (check.check !== "reconcile_state") return { ok: false, detail: `${check.check} does not read a reconcile outcome` };
  const item = expected.items.find((x) => x.id === check.item);
  if (!item) throw new Error(`unknown reconcile item ${check.item}`);
  const hits = outcome.items.filter((x) => matchesAll(x.text, item.match.all) || matchesAll(x.key, item.match.all));
  if (!hits.length) return item.states.includes("remove") ? { ok: true, detail: "gone" } : { ok: false, detail: `${item.id} not in the outcome` };
  const right = hits.filter((x) => (item.states as readonly string[]).includes(x.state));
  if (!right.length) return { ok: false, detail: `${item.id} is ${hits.map((x) => x.state).join("/")}, expected ${item.states.join("/")}` };
  const kept = right.filter((x) => (item.mustKeep ?? []).every((t) => normalize(x.text).includes(normalize(t))));
  return kept.length ? { ok: true, detail: right[0]!.state } : { ok: false, detail: `${item.id} lost ${item.mustKeep!.join(", ")}` };
}

// ---------------------------------------------------------------- render checks (gate 3)

function renderCheck(facts: RenderFacts, check: Check, view: PlanView | undefined): Outcome {
  const list = (xs: string[], what: string) => (xs.length ? { ok: false, detail: `${xs.length} ${what}: ${xs.slice(0, 5).join("; ")}` } : { ok: true, detail: `no ${what}` });
  switch (check.check) {
    case "layout_no_fatal":
      return list(facts.layout.issues.filter((i) => i.severity === "fatal").map((i) => `${i.code} ${i.evidence}`), "fatal layout issues");
    case "layout_crossings_max":
      return facts.layout.counts.crossings <= check.max ? { ok: true, detail: `${facts.layout.counts.crossings} crossings` } : { ok: false, detail: `${facts.layout.counts.crossings} link crossings, at most ${check.max}` };
    case "cards_no_overlap":
      return list(facts.cardOverlaps, "overlapping cards");
    case "children_inside_frames":
      return list(facts.outsideFrames, "cards outside their frame");
    case "frames_no_overlap":
      return list(facts.frameOverlaps, "overlapping frames");
    case "reading_order_max": {
      const { inversions, detail } = facts.geometry.readingOrder;
      return inversions <= check.max ? { ok: true, detail: `${inversions} frames out of reading order` } : { ok: false, detail: `${inversions} frames out of reading order, at most ${check.max}: ${detail.slice(0, 5).join("; ")}` };
    }
    case "frames_fit_screen":
      return list(facts.geometry.oversizedFrames, "frames too large to read whole");
    case "links_over_frames_max": {
      const over = facts.geometry.linksOverFrames;
      return over.length <= check.max ? { ok: true, detail: `${over.length} links over a third frame` } : { ok: false, detail: `${over.length} links over a third frame, at most ${check.max}: ${over.slice(0, 5).join("; ")}` };
    }
    case "rendered_frame_count":
      return facts.frames >= check.min && facts.frames <= check.max ? { ok: true, detail: `${facts.frames} frames drawn` } : { ok: false, detail: `${facts.frames} frames drawn, expected ${check.min}–${check.max}` };
    case "subgroup_contains":
      return view ? subgroupContains(facts, check, view) : { ok: false, detail: "subgroup_contains needs the plan to find its elements" };
    case "frame_part_contains":
      return view ? framePartContains(facts, check, view) : { ok: false, detail: "frame_part_contains needs the plan to find its elements" };
    default:
      return { ok: false, detail: `${check.check} does not read a rendered plan` };
  }
}

/** The elements share one sub-group of `frame` (label matched when given), and rendered, each sits inside its backdrop. */
function subgroupContains(facts: RenderFacts, check: Extract<Check, { check: "subgroup_contains" }>, view: PlanView): Outcome {
  const frames = new Set(view.frameCandidates(check.frame).map((g) => g.id));
  if (!frames.size) return { ok: false, detail: `frame ${check.frame} not found` };
  const parentOf = new Map(view.plan.nodes.map((n) => [n.id, n.parent] as const));
  const { subOf } = subGroupLayout(view.plan);
  const fits = (sub: string | undefined): sub is string => !!sub && frames.has(parentOf.get(sub) ?? "") && (!check.label || matchesAll(view.text.get(sub) ?? "", check.label));
  const subsPer = check.elements.map((e) => new Set(view.candidates(e).map((n) => subOf.get(n.id)).filter(fits)));
  const loose = check.elements.filter((_, i) => !subsPer[i]!.size);
  if (loose.length) return { ok: false, detail: `${loose.join(", ")} not in a sub-group of ${check.frame}${check.label ? " with that label" : ""}: ${check.why}` };
  const shared = [...subsPer[0]!].filter((s) => subsPer.every((set) => set.has(s)));
  if (!shared.length) return { ok: false, detail: `${check.elements.join(", ")} are in different sub-groups: ${check.why}` };
  const drawn = facts.subGroups.find((s) => shared.includes(s.id));
  if (!drawn) return { ok: false, detail: `sub-group ${shared[0]} isn't drawn (sub-groups are drawn with organisation v2)` };
  const members = new Set(check.elements.flatMap((e) => view.candidates(e).filter((n) => subOf.get(n.id) === drawn.id).map((n) => n.id)));
  const outside = facts.geometry.outsideSubGroups.filter((o) => members.has(o.slice(0, o.indexOf(" outside "))));
  return outside.length ? { ok: false, detail: `${outside.length} outside their sub-group's backdrop: ${outside.slice(0, 5).join("; ")}` } : { ok: true, detail: `together in sub-group ${drawn.id}` };
}

/**
 * The elements are drawn in one frame of the section `frame` names: its own frame, or a part of it when the renderer
 * split it (`<group>::part<i>`, frameSplit.ts), whose drawn title matches `title` when given.
 */
function framePartContains(facts: RenderFacts, check: Extract<Check, { check: "frame_part_contains" }>, view: PlanView): Outcome {
  const groups = view.frameCandidates(check.frame).map((g) => g.id);
  if (!groups.length) return { ok: false, detail: `frame ${check.frame} not found` };
  const ofSection = facts.drawnFrames.filter((f) => groups.some((g) => f.key === g || f.key.startsWith(`${g}::part`)));
  if (!ofSection.length) return { ok: false, detail: `no frame of ${check.frame} was drawn` };
  const titled = check.title ? ofSection.filter((f) => matchesAll(f.title, check.title!)) : ofSection;
  if (!titled.length) return { ok: false, detail: `no frame of ${check.frame} is titled ${check.title!.map((g) => g.join("|")).join(" + ")} (drawn: ${ofSection.map((f) => `"${f.title}"`).join(", ")}): ${check.why}` };
  const ids = check.elements.map((e) => new Set(view.candidates(e).map((n) => n.id)));
  const missing = check.elements.filter((_, i) => !ids[i]!.size);
  if (missing.length) return { ok: false, detail: `not found: ${missing.join(", ")}` };
  const holding = titled.find((f) => ids.every((set) => f.children.some((k) => set.has(k))));
  if (holding) return { ok: true, detail: `together in ${holding.key} "${holding.title}"` };
  const where = check.elements.map((e, i) => `${e} in ${ofSection.filter((f) => f.children.some((k) => ids[i]!.has(k))).map((f) => f.key).join("/") || "no frame of the section"}`);
  return { ok: false, detail: `${check.elements.join(", ")} aren't drawn in one ${check.title ? "such " : ""}frame (${where.join("; ")}): ${check.why}` };
}

// ---------------------------------------------------------------- entry point

const isRunCheck = (check: Check | undefined): check is Check => !!check && RUN_CHECKS.includes(check.check);

/** A run check: needs the plan (to find elements), the case's units and knowledge, and the run's output. */
function evaluateRunCheck(check: Check, expected: Expectations, actual: ActualOutput, view: PlanView | undefined): { status: AssertionStatus; detail: string } {
  if (!view) return { status: "no_input", detail: "no plan given" };
  if (!expected.source || !expected.knowledge) return { status: "not_evaluable", detail: "the case's units and knowledge weren't given" };
  if (!actual.run) return { status: "not_evaluable", detail: "the run carries no output besides its plan (no units, cites, accounting or flags)" };
  const outcome = runCheck({ run: actual.run, source: expected.source, knowledge: expected.knowledge, canvas: expected.canvas, candidates: (id) => view.candidates(id) }, check)!;
  if (!outcome.ok && /^the run carries no/.test(outcome.detail)) return { status: "not_evaluable", detail: outcome.detail };
  return { status: outcome.ok ? "pass" : "fail", detail: outcome.detail };
}

export function evaluate(assertions: readonly Assertion[], expected: Expectations, actual: ActualOutput): AssertionResult[] {
  const view = actual.plan ? new PlanView(actual.plan, expected.canvas) : undefined;
  const provided = runCapabilities(actual.run);
  return assertions.map((a) => {
    const base = { id: a.id, gate: GATE_OF_DIMENSION[a.dimension], severity: a.severity, dimension: a.dimension };
    if (a.method !== "deterministic") return { ...base, status: "needs_judgement", detail: a.judge?.question ?? a.description };
    if (a.support === "future") {
      // Checkable on this run only when the run provides every capability the assertion needs and there is a run
      // check for it (its own, or derived from what it needs). Otherwise: not_evaluable, never passed.
      const check = a.check ? (isRunCheck(a.check) ? a.check : undefined) : derivedCheck(a);
      const missing = (a.requires ?? []).filter((r) => !provided.has(r as never));
      if (!check || missing.length) return { ...base, status: "not_evaluable", detail: `future capability: ${(a.requires ?? []).join(", ")}${actual.run && check ? ` (this run lacks ${missing.join(", ")})` : ""}` };
      const r = evaluateRunCheck(check, expected, actual, view);
      return { ...base, ...r, detail: `from the run's output${a.check ? "" : ` (derived ${check.check} check)`}: ${r.detail}` };
    }
    if (!a.check) return { ...base, status: "not_evaluable", detail: "no check" };
    if (isRunCheck(a.check)) return { ...base, ...evaluateRunCheck(a.check, expected, actual, view) };
    // Scoped to one set of organisation rules (frame splitting is v2's): decided only on a render made with them.
    if (a.organisation && actual.render && actual.render.organisation !== a.organisation)
      return { ...base, status: "not_evaluable", detail: `decided on an organisation ${a.organisation} render; this one is ${actual.render.organisation}` };
    let outcome: Outcome;
    if (a.target === "plan") {
      if (!view) return { ...base, status: "no_input", detail: "no plan given" };
      outcome = planCheck(view, a.check);
    } else if (a.target === "lens") {
      if (!actual.lens || !expected.lens) return { ...base, status: "no_input", detail: "no Lens projection given" };
      outcome = lensCheck(expected.lens, actual.lens, a.check);
    } else if (a.target === "reconcile") {
      if (!actual.reconcile || !expected.reconcile) return { ...base, status: "no_input", detail: "no reconcile outcome given" };
      outcome = reconcileCheck(expected.reconcile, actual.reconcile, a.check);
    } else {
      if (!actual.render) return { ...base, status: "no_input", detail: "no rendered plan given" };
      outcome = renderCheck(actual.render, a.check, view);
    }
    return { ...base, status: outcome.ok ? "pass" : "fail", detail: outcome.detail };
  });
}

/**
 * Deterministic verdict per gate. A gate passes when none of its critical assertions failed; `undecided` counts what this
 * evaluator can't settle (judged, future or missing input), which a release decision must look at separately.
 */
export function verdict(results: readonly AssertionResult[]) {
  const gates = ([1, 2, 3] as const).map((gate) => {
    const mine = results.filter((r) => r.gate === gate);
    const failed = mine.filter((r) => r.status === "fail");
    return {
      gate,
      pass: failed.every((r) => r.severity !== "critical"),
      failedCritical: failed.filter((r) => r.severity === "critical").map((r) => r.id),
      failed: failed.map((r) => r.id),
      passed: mine.filter((r) => r.status === "pass").length,
      undecided: mine.filter((r) => r.status !== "pass" && r.status !== "fail").length,
    };
  });
  return { pass: gates.every((g) => g.pass), gates };
}

export const ARCHITECTURE_RELATIONS: readonly RelationType[] = ["calls", "reads", "writes", "publishes", "subscribes", "depends_on", "flows_to", "contains"];
