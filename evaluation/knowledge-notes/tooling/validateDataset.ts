/**
 * Integrity checks of the dataset itself (README "Validating the dataset"). Every rule returns a readable problem; an
 * empty list means the dataset is internally consistent. It does NOT mean the expectations are right: that is what
 * human review (`review.status`) is for.
 */
import { RELATION_TYPES } from "@/domain/types";
import { normalize } from "./evaluate";
import type { CaseBundle, Dataset } from "./load";
import { ARCHITECTURE_RELATIONS } from "./evaluate";
import { GATE_OF_DIMENSION, RUBRIC_DIMENSIONS, type Check } from "./schemas";

const PRODUCT_RELATIONS: readonly string[] = RELATION_TYPES;

function dupes(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) n++;
  return n;
}

export function wordCount(textValue: string): number {
  return (textValue.match(/\S+/g) ?? []).length;
}

/** Numbers in a claim (3, 0.5, 1000, 60%) that must be backed by the units it cites. */
function numbersIn(value: string): string[] {
  return (normalize(value).match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => n.length > 0);
}

export function validateCase(c: CaseBundle, capabilityIds: ReadonlySet<string>): string[] {
  const p: string[] = [];
  const at = (file: string) => (msg: string) => p.push(`${c.id}/${file}: ${msg}`);
  const src = at("case.json");
  const kn = at("knowledge.json");
  const cv = at("canvas.json");
  const ev = at("evaluation.json");
  const ln = at("lens.json");
  const rc = at("reconcile.json");

  // ---- ids agree
  for (const [file, id] of [["knowledge.json", c.knowledge.caseId], ["canvas.json", c.canvas.caseId], ["evaluation.json", c.evaluation.caseId], ["lens.json", c.lens?.caseId], ["reconcile.json", c.reconcile?.caseId]] as const) {
    if (id !== undefined && id !== c.id) at(file)(`caseId ${id} ≠ ${c.id}`);
  }
  if (c.source.id !== c.id) src(`id ${c.source.id} ≠ manifest ${c.id}`);

  // ---- A. source units
  for (const file of c.source.sourceFiles) {
    const t = c.texts.get(file.version);
    if (t === undefined) continue;
    const words = wordCount(t);
    if (Math.abs(words - file.words) > Math.max(5, file.words * 0.05)) src(`${file.path}: words ${file.words} recorded, ${words} counted`);
  }
  const sections = new Set(c.source.sections.map((s) => s.id));
  for (const d of dupes(c.source.sections.map((s) => s.id))) src(`duplicate section ${d}`);
  for (const d of dupes(c.source.units.map((u) => u.id))) src(`duplicate unit ${d}`);
  const units = new Map(c.source.units.map((u) => [u.id, u]));
  for (const u of c.source.units) {
    const where = `unit ${u.id}`;
    if (!sections.has(u.section)) src(`${where}: unknown section ${u.section}`);
    const t = c.texts.get(u.version ?? 1);
    if (t === undefined) src(`${where}: no source version ${u.version ?? 1}`);
    else {
      const n = countOccurrences(t, u.quote);
      if (n === 0) src(`${where}: quote not found in source v${u.version ?? 1}: "${u.quote.slice(0, 60)}…"`);
      else if (n > 1 && !u.occurrence) src(`${where}: quote occurs ${n} times; set "occurrence"`);
      else if (u.occurrence && u.occurrence > n) src(`${where}: occurrence ${u.occurrence} > ${n}`);
    }
    for (const pr of u.protected ?? []) if (!normalize(u.quote).includes(normalize(pr.value))) src(`${where}: protected "${pr.value}" isn't in its quote`);
    if (u.omittable?.of && !units.has(u.omittable.of)) src(`${where}: duplicate of unknown unit ${u.omittable.of}`);
    if (u.omittable?.reason === "duplicate" && !u.omittable.of) src(`${where}: a duplicate must name the unit it repeats`);
    if (u.critical && u.omittable && u.omittable.reason !== "duplicate" && u.omittable.reason !== "superseded") src(`${where}: a critical unit can only be omitted as duplicate or superseded (plan §3.2)`);
    for (const x of u.ambiguity?.conflictsWith ?? []) if (!units.has(x)) src(`${where}: conflicts with unknown unit ${x}`);
  }
  for (const s of c.source.safeToOmit) for (const u of s.units) if (!units.has(u)) src(`safeToOmit: unknown unit ${u}`);
  for (const cap of c.source.capabilities) if (!capabilityIds.has(cap)) src(`unknown capability ${cap}`);

  // ---- B. knowledge
  for (const d of dupes(c.knowledge.units.map((k) => k.id))) kn(`duplicate knowledge unit ${d}`);
  const knowledge = new Map(c.knowledge.units.map((k) => [k.id, k]));
  const cited = new Set<string>();
  for (const k of c.knowledge.units) {
    for (const u of k.sourceUnits) {
      if (!units.has(u)) kn(`${k.id}: unknown source unit ${u}`);
      cited.add(u);
    }
    for (const r of k.related ?? []) if (!knowledge.has(r.to)) kn(`${k.id}: related to unknown ${r.to}`);
    if (k.limits && !knowledge.has(k.limits)) kn(`${k.id}: limits unknown ${k.limits}`);
    // No unsupported facts: every exact detail and every number in the claim is in a cited unit.
    const quotes = normalize(k.sourceUnits.map((u) => units.get(u)?.quote ?? "").join(" \n "));
    for (const d of k.exactDetails ?? []) if (!quotes.includes(normalize(d))) kn(`${k.id}: exact detail "${d}" is not in its cited units`);
    for (const n of numbersIn(k.claim)) if (!new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(quotes)) kn(`${k.id}: number ${n} in the claim is not in its cited units`);
    if (k.provenance !== "explicit" && !k.review?.required) kn(`${k.id}: ${k.provenance} knowledge must require review`);
  }
  // Every unit is accounted for: represented by knowledge, or omittable with a reason (plan §3.2).
  for (const u of c.source.units) {
    if (!cited.has(u.id) && !u.omittable) kn(`unit ${u.id} is neither cited by a knowledge unit nor omittable`);
    if (u.critical && !cited.has(u.id) && u.omittable?.reason !== "duplicate" && u.omittable?.reason !== "superseded") kn(`critical unit ${u.id} has no expected outcome`);
  }
  for (const m of c.knowledge.mustNotClaim) for (const u of m.units ?? []) if (!units.has(u)) kn(`mustNotClaim: unknown unit ${u}`);

  // ---- C–E. canvas
  for (const d of dupes(c.canvas.elements.map((e) => e.id))) cv(`duplicate element ${d}`);
  for (const d of dupes(c.canvas.frames.map((f) => f.id))) cv(`duplicate frame ${d}`);
  for (const d of dupes(c.canvas.relationships.map((r) => r.id))) cv(`duplicate relationship ${d}`);
  const elements = new Map(c.canvas.elements.map((e) => [e.id, e]));
  const frames = new Map(c.canvas.frames.map((f) => [f.id, f]));
  const carried = new Map<string, Set<string>>(); // knowledge id → elements carrying it
  for (const e of c.canvas.elements) {
    for (const k of e.knowledge) {
      if (!knowledge.has(k)) cv(`${e.id}: unknown knowledge ${k}`);
      if (!carried.has(k)) carried.set(k, new Set());
      carried.get(k)!.add(e.id);
    }
    if (e.frame !== null && !frames.has(e.frame)) cv(`${e.id}: unknown frame ${e.frame}`);
    if (e.frame === null && !e.outsideFrameReason) cv(`${e.id}: outside every frame without an outsideFrameReason`);
    if (e.frame && !frames.get(e.frame)?.children.includes(e.id)) cv(`${e.id}: says frame ${e.frame}, which doesn't list it`);
    if (e.support !== "implemented" && !e.supportNote) cv(`${e.id}: ${e.support} support needs a supportNote`);
    if (e.requirement === "conditional" && !e.condition) cv(`${e.id}: conditional without a condition`);
    if (e.element === "image" && e.support === "implemented") cv(`${e.id}: image nodes are not renderable today (ai/renderer/mapNode.ts)`);
  }
  for (const f of c.canvas.frames) {
    for (const ch of f.children) {
      const e = elements.get(ch);
      if (!e) cv(`${f.id}: unknown child ${ch}`);
      else if (e.frame !== f.id) cv(`${f.id}: child ${ch} says frame ${e.frame}`);
    }
    for (const s of f.separateFrom ?? []) if (!frames.has(s.frame)) cv(`${f.id}: separate from unknown ${s.frame}`);
  }
  for (const r of c.canvas.relationships) {
    if (!elements.has(r.from)) cv(`${r.id}: unknown from ${r.from}`);
    if (!elements.has(r.to)) cv(`${r.id}: unknown to ${r.to}`);
    for (const u of r.evidence) if (!units.has(u)) cv(`${r.id}: unknown evidence unit ${u}`);
    if (!PRODUCT_RELATIONS.includes(r.type) && !r.acceptableTypes?.length) cv(`${r.id}: extension type ${r.type} needs acceptableTypes from the product's RELATION_TYPES`);
    // An architecture arrow says what it does: code-level relations always, and any structural one inside a diagram frame.
    const inDiagram = [r.from, r.to].some((id) => frames.get(elements.get(id)?.frame ?? "")?.diagram === "architecture");
    const codeLevel = ["calls", "reads", "writes", "publishes", "subscribes"].includes(r.type);
    if ((codeLevel || (inDiagram && ARCHITECTURE_RELATIONS.includes(r.type as never))) && !r.label.required) cv(`${r.id}: architecture relation ${r.type} must require a label`);
    if (r.provenance === "inferred" && !r.inferenceAllowed && r.requirement === "mandatory") cv(`${r.id}: a mandatory inferred relationship must allow inference`);
    if (r.provenance === "inferred" && !r.reviewRequired) cv(`${r.id}: inferred relationships require review`);
  }
  for (const g of [...(c.canvas.together ?? []), ...(c.canvas.keepSeparate ?? [])]) for (const e of g.elements) if (!elements.has(e)) cv(`together/keepSeparate: unknown ${e}`);
  for (const h of c.canvas.hierarchy ?? []) for (const e of [h.main, ...h.supporting]) if (!elements.has(e)) cv(`hierarchy: unknown ${e}`);
  // Every critical or non-omittable knowledge unit is on the canvas.
  for (const k of c.knowledge.units) {
    if ((k.importance === "critical" || !k.omission.allowed) && !carried.has(k.id)) cv(`knowledge ${k.id} (${k.importance}, omission not allowed) has no element`);
  }
  // Limits stay with their claim: wherever the claim is, the caveat is too, and the caveat never stands alone.
  for (const k of c.knowledge.units) {
    if (!k.limits) continue;
    const claimEls = carried.get(k.limits) ?? new Set();
    const caveatEls = carried.get(k.id) ?? new Set();
    for (const e of claimEls) if (!caveatEls.has(e)) cv(`${e} carries ${k.limits} without its limit ${k.id}`);
    for (const e of caveatEls) if (!claimEls.has(e)) cv(`${e} carries the limit ${k.id} apart from its claim ${k.limits}`);
  }

  // ---- Lens
  const lensKeys = new Set<string>();
  const lensEdges = new Set<string>();
  const lensPaths = new Set<string>();
  const lensFrames = new Set<string>();
  if (c.lens) {
    const L = c.lens;
    for (const d of dupes(L.nodes.map((n) => n.key))) ln(`duplicate node ${d}`);
    for (const d of dupes(L.edges.map((e) => e.id))) ln(`duplicate edge ${d}`);
    for (const d of dupes(L.levels.map((l) => l.frameKey))) ln(`duplicate frame ${d}`);
    L.nodes.forEach((n) => lensKeys.add(n.key));
    L.edges.forEach((e) => lensEdges.add(e.id));
    L.navigationPaths.forEach((x) => lensPaths.add(x.id));
    L.levels.forEach((l) => lensFrames.add(l.frameKey));
    const node = new Map(L.nodes.map((n) => [n.key, n]));
    const frameLevel = new Map(L.levels.map((l) => [l.frameKey, l.level]));
    const edge = new Map(L.edges.map((e) => [e.id, e]));
    const NAMES = ["System", "Architecture", "Component", "Flow", "Operation", "Source"];
    for (const l of L.levels) {
      if (NAMES[l.level] !== l.name) ln(`frame ${l.frameKey}: L${l.level} is "${NAMES[l.level]}", not "${l.name}" (lensProfile.ts)`);
      if (l.availability === "unavailable" && !l.unavailableReason) ln(`frame ${l.frameKey}: unavailable without a reason`);
      if (l.availability === "unavailable" && l.nodes.length) ln(`frame ${l.frameKey}: an unavailable level lists nodes`);
      for (const k of l.nodes) {
        if (!node.has(k)) ln(`frame ${l.frameKey}: unknown node ${k}`);
        else if (node.get(k)!.level !== l.level) ln(`frame ${l.frameKey}: node ${k} is L${node.get(k)!.level}`);
      }
      for (const e of l.edges) if (!edge.has(e)) ln(`frame ${l.frameKey}: unknown edge ${e}`);
    }
    for (const n of L.nodes) {
      if (!L.levels.some((l) => l.nodes.includes(n.key))) ln(`${n.key}: in no level frame`);
      if (n.parent) {
        const parent = node.get(n.parent);
        if (!parent) ln(`${n.key}: unknown parent ${n.parent}`);
        else if (parent.level !== n.level - 1) ln(`${n.key}: parent ${n.parent} is L${parent.level}, expected L${n.level - 1}`);
        else if (!parent.expandsTo || !L.levels.find((l) => l.frameKey === parent.expandsTo)?.nodes.includes(n.key)) ln(`${n.key}: parent ${n.parent} doesn't expand to a frame containing it`);
      }
      if (n.expandsTo && frameLevel.get(n.expandsTo) !== n.level + 1) ln(`${n.key}: expands to ${n.expandsTo}, which isn't an L${n.level + 1} frame`);
      if (n.canvasElement && !elements.has(n.canvasElement)) ln(`${n.key}: unknown canvas element ${n.canvasElement}`);
      for (const k of n.knowledge) if (!knowledge.has(k)) ln(`${n.key}: unknown knowledge ${k}`);
      for (const e of n.evidence) {
        if (e.type === "source_unit" && (!e.unit || !units.has(e.unit))) ln(`${n.key}: evidence unit ${e.unit ?? "(none)"} unknown`);
        if (e.type === "code" && !e.path) ln(`${n.key}: code evidence without a path`);
        if (e.type === "code" && e.availability === "available" && e.unit && !normalize(units.get(e.unit)?.quote ?? "").includes(normalize(e.path ?? "\u0000"))) ln(`${n.key}: code path ${e.path} isn't in unit ${e.unit}`);
        if (e.type === "code" && e.availability === "available" && !e.unit) ln(`${n.key}: available code evidence must cite the unit that states the path`);
      }
    }
    for (const e of L.edges) {
      const a = node.get(e.from);
      const b = node.get(e.to);
      if (!a) ln(`${e.id}: unknown from ${e.from}`);
      if (!b) ln(`${e.id}: unknown to ${e.to}`);
      if (a && a.level !== e.level) ln(`${e.id}: from ${e.from} is L${a.level}, edge is L${e.level}`);
      if (b && b.level !== e.level) ln(`${e.id}: to ${e.to} is L${b.level}, edge is L${e.level}`);
      for (const u of e.evidence) if (!units.has(u)) ln(`${e.id}: unknown evidence unit ${u}`);
      if (e.rollsUpTo) {
        const up = edge.get(e.rollsUpTo);
        if (!up) ln(`${e.id}: rolls up to unknown ${e.rollsUpTo}`);
        else if (up.level !== e.level - 1) ln(`${e.id}: rolls up to L${up.level}, expected L${e.level - 1}`);
      }
      if (!L.levels.some((l) => l.edges.includes(e.id))) ln(`${e.id}: in no level frame`);
    }
    for (const x of L.navigationPaths) for (const k of x.path) if (!node.has(k)) ln(`${x.id}: unknown node ${k}`);
  }

  // ---- reconcile
  const reconcileItems = new Set<string>();
  if (c.reconcile) {
    for (const d of dupes(c.reconcile.items.map((i) => i.id))) rc(`duplicate item ${d}`);
    for (const i of c.reconcile.items) {
      reconcileItems.add(i.id);
      if (!elements.has(i.element) && i.change !== "added") rc(`${i.id}: unknown element ${i.element}`);
      for (const u of [...i.unitsBefore, ...i.unitsAfter]) if (!units.has(u)) rc(`${i.id}: unknown unit ${u}`);
      for (const u of i.unitsBefore) if ((units.get(u)?.version ?? 1) !== c.reconcile.fromVersion) rc(`${i.id}: unit ${u} isn't from v${c.reconcile.fromVersion}`);
      for (const u of i.unitsAfter) if ((units.get(u)?.version ?? 1) !== c.reconcile.toVersion) rc(`${i.id}: unit ${u} isn't from v${c.reconcile.toVersion}`);
    }
    for (const e of c.reconcile.userEdits) if (!elements.has(e.element)) rc(`user edit: unknown element ${e.element}`);
  }

  // ---- evaluation
  for (const d of dupes(c.evaluation.assertions.map((a) => a.id))) ev(`duplicate assertion ${d}`);
  const referenced = { elements: new Set<string>(), relationships: new Set<string>(), frames: new Set<string>() };
  for (const a of c.evaluation.assertions) {
    const where = (msg: string) => ev(`${a.id}: ${msg}`);
    if (a.method === "deterministic" && !a.check && a.support !== "future") where("deterministic assertions that run today need a check");
    if (a.method !== "deterministic" && !a.judge) where("judged assertions need judge {question, pass, fail}");
    if (a.support !== "implemented" && !a.requires?.length) where(`${a.support} support must name the capabilities it requires`);
    for (const cap of a.requires ?? []) if (!capabilityIds.has(cap)) where(`unknown capability ${cap}`);
    if (a.target === "lens" && !c.lens) where("targets Lens but the case has no lens.json");
    if (a.target === "reconcile" && !c.reconcile) where("targets reconcile but the case has no reconcile.json");
    if (a.check) for (const problem of checkRefs(a.check, { elements, frames, relationships: new Set(c.canvas.relationships.map((r) => r.id)), lensKeys, lensEdges, lensPaths, lensFrames, reconcileItems }, referenced)) where(problem);
    if (a.check && targetOf(a.check) !== a.target) where(`check ${a.check.check} reads ${targetOf(a.check)}, not ${a.target}`);
  }
  // Enough criteria to decide pass/fail.
  const asserts = c.evaluation.assertions;
  if (!asserts.some((a) => a.method !== "deterministic")) ev("no judged (model or human) assertion");
  const dims = new Set(asserts.map((a) => a.dimension));
  for (const d of ["source_fidelity", "coverage", "grouping", "relationships", "visual"] as const) if (!dims.has(d)) ev(`no assertion for ${d}`);
  for (const g of [1, 2, 3] as const) if (!asserts.some((a) => a.method === "deterministic" && a.support === "implemented" && a.severity === "critical" && GATE_OF_DIMENSION[a.dimension] === g)) ev(`gate ${g} has no critical deterministic assertion that runs today`);
  for (const e of c.canvas.elements) if (e.requirement === "mandatory" && e.support === "implemented" && !referenced.elements.has(e.id)) ev(`mandatory element ${e.id} is checked by no assertion`);
  for (const r of c.canvas.relationships) if (r.requirement === "mandatory" && r.support === "implemented" && !referenced.relationships.has(r.id)) ev(`mandatory relationship ${r.id} is checked by no assertion`);
  for (const f of c.canvas.frames) if (f.requirement === "mandatory" && f.support === "implemented" && !referenced.frames.has(f.id)) ev(`mandatory frame ${f.id} is checked by no assertion`);
  return p;
}

const RENDER_CHECKS: readonly string[] = ["layout_no_fatal", "layout_crossings_max", "cards_no_overlap", "children_inside_frames", "frames_no_overlap"];

function targetOf(check: Check): "plan" | "lens" | "reconcile" | "render" {
  if (check.check.startsWith("lens_")) return "lens";
  if (check.check === "reconcile_state") return "reconcile";
  if (RENDER_CHECKS.includes(check.check)) return "render";
  return "plan";
}

interface Known {
  elements: ReadonlyMap<string, unknown>;
  frames: ReadonlyMap<string, unknown>;
  relationships: ReadonlySet<string>;
  lensKeys: ReadonlySet<string>;
  lensEdges: ReadonlySet<string>;
  lensPaths: ReadonlySet<string>;
  lensFrames: ReadonlySet<string>;
  reconcileItems: ReadonlySet<string>;
}

function checkRefs(check: Check, k: Known, referenced: { elements: Set<string>; relationships: Set<string>; frames: Set<string> }): string[] {
  const out: string[] = [];
  const el = (id: string | undefined) => {
    if (id === undefined) return;
    if (!k.elements.has(id)) out.push(`unknown element ${id}`);
    referenced.elements.add(id);
  };
  const fr = (id: string) => {
    if (!k.frames.has(id)) out.push(`unknown frame ${id}`);
    referenced.frames.add(id);
  };
  switch (check.check) {
    case "element_present":
    case "element_kind":
      el(check.element);
      break;
    case "element_in_frame":
      el(check.element);
      fr(check.frame);
      break;
    case "frame_present":
    case "frame_level":
      fr(check.frame);
      break;
    case "together":
    case "apart":
      check.elements.forEach(el);
      break;
    case "hierarchy":
      el(check.main);
      check.supporting.forEach(el);
      break;
    case "relationship_present":
      if (!k.relationships.has(check.relationship)) out.push(`unknown relationship ${check.relationship}`);
      referenced.relationships.add(check.relationship);
      break;
    case "relationship_absent":
      el(check.from);
      el(check.to);
      break;
    case "text_present":
      el(check.element);
      break;
    case "text_absent":
      try {
        new RegExp(check.pattern, "i");
      } catch {
        out.push(`bad regex ${check.pattern}`);
      }
      break;
    case "lens_node":
    case "lens_identity":
    case "lens_no_children":
      if (!k.lensKeys.has(check.key)) out.push(`unknown lens node ${check.key}`);
      break;
    case "lens_edge":
      if (!k.lensEdges.has(check.edge)) out.push(`unknown lens edge ${check.edge}`);
      break;
    case "lens_drill":
      if (!k.lensKeys.has(check.from)) out.push(`unknown lens node ${check.from}`);
      if (!k.lensFrames.has(check.to)) out.push(`unknown lens frame ${check.to}`);
      break;
    case "lens_path":
      if (!k.lensPaths.has(check.path)) out.push(`unknown path ${check.path}`);
      break;
    case "reconcile_state":
      if (!k.reconcileItems.has(check.item)) out.push(`unknown reconcile item ${check.item}`);
      break;
    case "frame_count":
    case "architecture_edges_labeled":
    case "layout_no_fatal":
    case "layout_crossings_max":
    case "cards_no_overlap":
    case "children_inside_frames":
    case "frames_no_overlap":
      break;
  }
  return out;
}

export function validateDataset(d: Dataset): string[] {
  const p = [...d.issues];
  for (const x of dupes(d.manifest.cases.map((c) => c.id))) p.push(`manifest: duplicate case ${x}`);
  const capabilityIds = new Set(d.capabilities.capabilities.map((c) => c.id));
  for (const x of dupes([...capabilityIds])) p.push(`capabilities: duplicate ${x}`);
  for (const c of d.cases) p.push(...validateCase(c, capabilityIds));
  // Capability labels agree with the inventory: "implemented" assertions only need implemented capabilities.
  const status = new Map(d.capabilities.capabilities.map((c) => [c.id, c.status]));
  for (const c of d.cases)
    for (const a of c.evaluation.assertions) {
      if (a.support === "implemented") for (const r of a.requires ?? []) if (status.get(r) !== "implemented") p.push(`${c.id}/${a.id}: marked implemented but requires ${r} (${status.get(r)})`);
      if (a.support === "future" && (a.requires ?? []).every((r) => status.get(r) === "implemented")) p.push(`${c.id}/${a.id}: marked future but every capability it requires is implemented`);
    }
  const dims = new Set(d.rubrics.map((r) => r.dimension));
  for (const dim of RUBRIC_DIMENSIONS) if (!dims.has(dim)) p.push(`rubrics: no rubric for ${dim}`);
  const byCase = new Map(d.cases.map((c) => [c.id, c]));
  for (const r of d.regressions) {
    const c = byCase.get(r.caseId);
    if (!c) {
      p.push(`regression ${r.id}: unknown case ${r.caseId}`);
      continue;
    }
    for (const a of r.expectFailing) {
      const as = c.evaluation.assertions.find((x) => x.id === a);
      if (!as) p.push(`regression ${r.id}: unknown assertion ${a}`);
      else if (as.method !== "deterministic" || as.support === "future") p.push(`regression ${r.id}: ${a} can't fail deterministically today`);
    }
    if (r.target === "lens" && !c.referenceLens) p.push(`regression ${r.id}: case has no reference Lens projection`);
    if (r.target === "reconcile" && !c.referenceReconcile) p.push(`regression ${r.id}: case has no reference reconcile outcome`);
  }
  return p;
}
