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
 */
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import type { RelationType } from "@/domain/types";
import type { RenderFacts } from "./render";
import { GATE_OF_DIMENSION, type Assertion, type Check, type ExpectedCanvas, type ExpectedLens, type ExpectedReconcile, type LensProjection, type ReconcileOutcome } from "./schemas";

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
}

export interface ActualOutput {
  plan?: VisualPlan;
  lens?: LensProjection;
  reconcile?: ReconcileOutcome;
  /** The plan rendered and measured (`renderFacts`), for gate 3. */
  render?: RenderFacts;
}

// ---------------------------------------------------------------- text

/** Lower-case, ASCII quotes and dashes, no markdown emphasis, no thousands separators, single spaces (knowledge-notes-plan §3.3). */
export function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[*_`]/g, "")
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

class PlanView {
  readonly nodes: VisualNode[];
  readonly groups: VisualNode[];
  readonly text = new Map<string, string>();

  constructor(readonly plan: VisualPlan, readonly canvas: ExpectedCanvas) {
    this.nodes = plan.nodes.filter((n) => n.type !== "group");
    this.groups = plan.nodes.filter((n) => n.type === "group");
    for (const n of plan.nodes) this.text.set(n.id, nodeText(n));
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

  /** Plan nodes standing for an expected element. */
  candidates(elementId: string): VisualNode[] {
    const e = this.element(elementId);
    return this.plan.nodes.filter((n) => (e.planNodeTypes as readonly string[]).includes(n.type) && matchesAll(this.text.get(n.id) ?? "", e.match.all));
  }

  /** Group nodes (frames) standing for an expected frame. */
  frameCandidates(frameId: string): VisualNode[] {
    const f = this.frame(frameId);
    return this.groups.filter((g) => matchesAll(this.text.get(g.id) ?? "", f.titleMatch.all));
  }
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
      const inside = c.filter((n) => n.parent && frames.has(n.parent));
      return inside.length ? { ok: true, detail: `${inside[0]!.id} in ${inside[0]!.parent}` } : { ok: false, detail: `${check.element} is outside ${check.frame} (parents: ${c.map((n) => n.parent ?? "none").join(", ")})` };
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
      const parents = check.elements.map((e) => new Set(view.candidates(e).map((n) => n.parent ?? "")));
      const missing = check.elements.filter((_, i) => !parents[i]!.size);
      if (missing.length) return { ok: false, detail: `not found: ${missing.join(", ")}` };
      const shared = [...parents[0]!].filter((p) => p && parents.every((s) => s.has(p)));
      return shared.length ? { ok: true, detail: `together in ${shared[0]}` } : { ok: false, detail: `${check.elements.join(", ")} are in different frames: ${check.why}` };
    }
    case "apart": {
      const [a, b] = check.elements.map((e) => new Set(view.candidates(e).map((n) => n.parent).filter((p): p is string => !!p)));
      const shared = [...a!].filter((p) => b!.has(p));
      return shared.length ? { ok: false, detail: `${check.elements.join(" and ")} share frame ${shared[0]}: ${check.why}` } : { ok: true, detail: "apart" };
    }
    case "hierarchy": {
      const main = view.candidates(check.main);
      if (!main.length) return { ok: false, detail: `main idea ${check.main} not found: ${check.why}` };
      const mainIds = new Set(main.map((n) => n.id));
      const mainParents = new Set(main.map((n) => n.parent ?? ""));
      const rank = { high: 3, medium: 2, low: 1 } as const;
      const mainRank = Math.max(...main.map((n) => (n.importance ? rank[n.importance] : 2)));
      for (const s of check.supporting) {
        const sup = view.candidates(s);
        if (!sup.length) return { ok: false, detail: `supporting ${s} not found` };
        const linked = sup.some((n) => view.plan.relationships.some((r) => (r.from === n.id && mainIds.has(r.to)) || (r.to === n.id && mainIds.has(r.from))));
        const nearby = sup.some((n) => mainParents.has(n.parent ?? ""));
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

function renderCheck(facts: RenderFacts, check: Check): Outcome {
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
    default:
      return { ok: false, detail: `${check.check} does not read a rendered plan` };
  }
}

// ---------------------------------------------------------------- entry point

export function evaluate(assertions: readonly Assertion[], expected: Expectations, actual: ActualOutput): AssertionResult[] {
  const view = actual.plan ? new PlanView(actual.plan, expected.canvas) : undefined;
  return assertions.map((a) => {
    const base = { id: a.id, gate: GATE_OF_DIMENSION[a.dimension], severity: a.severity, dimension: a.dimension };
    if (a.method !== "deterministic") return { ...base, status: "needs_judgement", detail: a.judge?.question ?? a.description };
    if (a.support === "future") return { ...base, status: "not_evaluable", detail: `future capability: ${(a.requires ?? []).join(", ")}` };
    if (!a.check) return { ...base, status: "not_evaluable", detail: "no check" };
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
      outcome = renderCheck(actual.render, a.check);
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
