/**
 * What a Visualize run hands the evaluation besides its plan (`KnowledgeRunOutput`, `src/ai/fidelity/contracts.ts`):
 * source units, per-node citations, omissions, the unit accounting and review flags. Today's `preserve` runs produce
 * none of it, so every assertion that needs it is `not_evaluable` (README "Implemented vs future expectations").
 *
 * Two things live here:
 *
 * 1. **What a run provides** (`runCapabilities`): the capability ids of `capabilities.json` that a run's output makes
 *    checkable. A `future` assertion with no check of its own becomes checkable on that run when every capability it
 *    `requires` is provided and a check can be derived for it (`derivedCheck`). The capability's status in
 *    `capabilities.json` is about the product; this is about one recording, which may predate the field.
 * 2. **The three run checks** (`cites`, `units_accounted`, `review_flagged`), read against the case's own source units
 *    and knowledge. A run's unit ids are its own (Lane B's splitter), never the dataset's hand-assigned `u1…`, so
 *    units are matched by **text** (`mapUnits`), the same way plan nodes are matched by content.
 */
import { z } from "zod";
import type { KnowledgeRunOutput } from "@/ai/fidelity/contracts";
import type { VisualNode } from "@/ai/visual-plan/types";
import { normalize } from "./evaluate";
import type { Assertion, Check, ExpectedCanvas, ExpectedKnowledge, SourceCase } from "./schemas";

// ---------------------------------------------------------------- the sidecar file (recordings/<run>/<case>/run.json)

const unitIdText = z.string().min(1);
const sourceUnit = z.object({
  id: unitIdText,
  kind: z.string(),
  text: z.string(),
  hash: z.string(),
  topic: z.string(),
  span: z.object({ start: z.number(), end: z.number() }),
  prev: z.string().optional(),
  next: z.string().optional(),
});
const reviewFlag = z.object({ code: z.string(), unit: z.string().optional(), card: z.string().optional(), detail: z.string(), evidence: z.object({ source: z.string().optional(), card: z.string().optional() }).optional() });
const outcome = z.enum(["represented", "omitted", "needs_review"]);

/**
 * `KnowledgeRunOutput` without `plan`, as a recording stores it. Lenient where the contract is a closed union the
 * evaluation doesn't branch on (unit kinds, review codes), strict where it does (outcomes, omission reasons).
 */
export const runEvidenceSchema = z.object({
  noteModel: z.enum(["preserve", "distil"]),
  units: z.object({ units: z.array(sourceUnit), nextId: z.number().int() }).optional(),
  cites: z.record(z.string(), z.array(unitIdText)).optional(),
  omitted: z.array(z.object({ unit: unitIdText, reason: z.enum(["filler", "duplicate", "superseded", "meta"]), of: z.string().optional() })).optional(),
  accounting: z
    .object({
      state: z.record(z.string(), z.string()),
      outcome: z.record(z.string(), outcome),
      critical: z.record(z.string(), z.array(z.string())),
      flags: z.array(reviewFlag),
      sections: z.array(z.object({ topic: z.string(), represented: z.number(), omitted: z.number(), needsReview: z.number(), highOmittedShare: z.boolean() })),
    })
    .optional(),
  flags: z.array(reviewFlag).optional(),
  /**
   * The plan's cards that span several nodes (a shape with its explanation, a label folded into its card), each as its
   * node ids, the first one standing for the card (`KnowledgeRunOutput.cardGroups`, plan §9 G1 counts per card). Kept so a
   * replayed recording can count cards the way the run did; runs recorded before 2026-10-20 have none (every node a card).
   */
  cardGroups: z.array(z.array(z.string()).min(1)).optional(),
});

/** Everything of a run but its plan (the plan is evaluated on its own), as the evaluation reads it. */
export type RunEvidence = z.infer<typeof runEvidenceSchema>;

/** Compile-time guard: whatever the contract's `KnowledgeRunOutput` carries, the evaluation can read. */
export const fromRunOutput = ({ plan: _plan, ...rest }: KnowledgeRunOutput): RunEvidence => rest;

// ---------------------------------------------------------------- what a run provides

/** Capability ids (capabilities.json) a run's output can provide, and the fields that provide each. */
export const RUN_CAPABILITIES = {
  "ai.source-unit-ids": "units",
  "ai.cites": "units + cites",
  "ai.unit-accounting": "units + (accounting, or cites + omitted)",
  "ai.review-queue": "units + (flags or accounting)",
  "ai.meaning-rules": "flags",
} as const;
export type RunCapability = keyof typeof RUN_CAPABILITIES;

export function runCapabilities(run: RunEvidence | undefined): Set<RunCapability> {
  const out = new Set<RunCapability>();
  if (!run) return out;
  const units = !!run.units?.units.length;
  if (units) out.add("ai.source-unit-ids");
  if (units && run.cites) out.add("ai.cites");
  if (units && (run.accounting || (run.cites && run.omitted))) out.add("ai.unit-accounting");
  if (units && (run.flags || run.accounting)) out.add("ai.review-queue");
  if (run.flags) out.add("ai.meaning-rules");
  return out;
}

/** The run check each run capability makes possible, and the capabilities the check needs. */
export const RUN_CHECK_REQUIRES: Readonly<Record<"cites" | "units_accounted" | "review_flagged", readonly RunCapability[]>> = {
  cites: ["ai.source-unit-ids", "ai.cites"],
  units_accounted: ["ai.source-unit-ids", "ai.unit-accounting"],
  review_flagged: ["ai.source-unit-ids", "ai.review-queue"],
};

export const RUN_CHECKS: readonly string[] = Object.keys(RUN_CHECK_REQUIRES);

/**
 * The check a `future` assertion without one stands for, by what it needs: citations (traceability), unit accounting
 * (coverage) or the review queue (traceability). Anything else (Lens markers, card-level reconcile, a flag on one
 * edge) has no derivation and stays `not_evaluable` until the case gives it a check.
 */
export function derivedCheck(a: Pick<Assertion, "requires" | "dimension">): Check | undefined {
  const req = new Set(a.requires ?? []);
  if (req.has("ai.cites") && a.dimension === "traceability") return { check: "cites" };
  if (req.has("ai.unit-accounting") && a.dimension === "coverage") return { check: "units_accounted" };
  if (req.has("ai.review-queue") && a.dimension === "traceability") return { check: "review_flagged" };
  return undefined;
}

// ---------------------------------------------------------------- unit matching

/** Unit text without markdown structure (list markers, quote and heading marks, table pipes, emphasis), normalised. */
export function unitText(value: string): string {
  return normalize(
    value
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, ""))
      .join(" ")
      .replace(/\|/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"),
  )
    .replace(/[.;:,]+$/g, "")
    .trim();
}

const words = (value: string) => (value.match(/\S+/g) ?? []).length;

/** Same text, or one contains the other and the shorter is at least three words (a unit split or merged differently). */
export function sameUnit(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return words(short) >= 3 && long.includes(short);
}

/** Run unit id → the case units it stands for (by text). A run unit may map to none, one or several. */
export function mapUnits(runUnits: readonly { id: string; text: string }[], caseUnits: readonly { id: string; quote: string }[]): Map<string, string[]> {
  const cases = caseUnits.map((u) => ({ id: u.id, text: unitText(u.quote) }));
  const out = new Map<string, string[]>();
  for (const r of runUnits) {
    const t = unitText(r.text);
    out.set(
      r.id,
      cases.filter((c) => sameUnit(t, c.text)).map((c) => c.id),
    );
  }
  return out;
}

// ---------------------------------------------------------------- the three run checks

export interface RunContext {
  run: RunEvidence;
  source: SourceCase;
  knowledge: ExpectedKnowledge;
  canvas: ExpectedCanvas;
  /** Plan nodes standing for an expected element (the evaluator's content matching). */
  candidates(elementId: string): VisualNode[];
}

type Outcome = { ok: boolean; detail: string };

const list = (xs: readonly string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/** Case unit → the run units that stand for it. */
function reverse(map: Map<string, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [runId, caseIds] of map) for (const c of caseIds) out.set(c, [...(out.get(c) ?? []), runId]);
  return out;
}

/** Units of the version a run was made from (the update case has two). */
function unitsOfVersion(source: SourceCase, version: number) {
  return source.units.filter((u) => (u.version ?? 1) === version);
}

/**
 * `cites`: every expected element found on the plan cites at least one unit its knowledge comes from (matched by text),
 * and no node cites a unit id the run doesn't have. An element the plan lacks is skipped here: `element_present` says so.
 */
export function citesCheck(ctx: RunContext, element?: string): Outcome {
  const { run } = ctx;
  if (!run.units || !run.cites) return { ok: false, detail: "the run carries no units or cites" };
  const known = new Set(run.units.units.map((u) => u.id));
  const unknown = Object.entries(run.cites).flatMap(([node, ids]) => ids.filter((id) => !known.has(id)).map((id) => `${node}→${id}`));
  if (unknown.length) return { ok: false, detail: `cites name units the run doesn't have: ${list(unknown)}` };
  const toCase = mapUnits(run.units.units, ctx.source.units);
  const knowledge = new Map(ctx.knowledge.units.map((k) => [k.id, k]));
  const elements = ctx.canvas.elements.filter((e) => (element ? e.id === element : e.requirement === "mandatory" && e.support === "implemented"));
  const missing: string[] = [];
  const skipped: string[] = [];
  let checked = 0;
  for (const e of elements) {
    const nodes = ctx.candidates(e.id);
    if (!nodes.length) {
      skipped.push(e.id);
      continue;
    }
    checked++;
    const expected = new Set(e.knowledge.flatMap((k) => knowledge.get(k)?.sourceUnits ?? []));
    const cited = nodes.flatMap((n) => (run.cites![n.id] ?? []).flatMap((id) => toCase.get(id) ?? []));
    if (!cited.some((u) => expected.has(u))) missing.push(`${e.id} (cites ${list([...new Set(cited)]) || "nothing"}; expected one of ${list([...expected])})`);
  }
  if (element && skipped.length) return { ok: false, detail: `${element} not found on the plan` };
  if (missing.length) return { ok: false, detail: `${missing.length}/${checked} elements don't cite their source: ${list(missing, 4)}` };
  return { ok: true, detail: `${checked} elements cite their source${skipped.length ? ` (${skipped.length} not on the plan: ${list(skipped, 4)})` : ""}` };
}

/** Per case unit: represented, omitted, needs review, or unaccounted (the run never placed it). */
function caseOutcomes(ctx: RunContext, version: number): Map<string, "represented" | "omitted" | "needs_review" | "unaccounted" | "not_in_run"> {
  const run = ctx.run;
  const runUnits = run.units!.units;
  const toCase = mapUnits(runUnits, ctx.source.units);
  const runOutcome = new Map<string, "represented" | "omitted" | "needs_review">();
  if (run.accounting) for (const [id, o] of Object.entries(run.accounting.outcome)) runOutcome.set(id, o);
  else {
    const cited = new Set(Object.values(run.cites ?? {}).flat());
    const omitted = new Set((run.omitted ?? []).map((o) => o.unit));
    const flagged = new Set((run.flags ?? []).flatMap((f) => (f.unit ? [f.unit] : [])));
    for (const u of runUnits) {
      if (flagged.has(u.id)) runOutcome.set(u.id, "needs_review");
      else if (cited.has(u.id)) runOutcome.set(u.id, "represented");
      else if (omitted.has(u.id)) runOutcome.set(u.id, "omitted");
    }
  }
  const byCase = reverse(toCase);
  const out = new Map<string, "represented" | "omitted" | "needs_review" | "unaccounted" | "not_in_run">();
  for (const u of unitsOfVersion(ctx.source, version)) {
    const runIds = byCase.get(u.id) ?? [];
    if (!runIds.length) {
      out.set(u.id, "not_in_run");
      continue;
    }
    const outs = runIds.map((id) => runOutcome.get(id));
    out.set(u.id, outs.includes("represented") ? "represented" : outs.includes("needs_review") ? "needs_review" : outs.includes("omitted") ? "omitted" : "unaccounted");
  }
  return out;
}

/**
 * `units_accounted`: every source unit of the version is accounted for (knowledge-notes-plan §3.2): Represented, Needs
 * review, or Intentionally omitted where the case allows it. A critical unit may be omitted only as a duplicate or
 * superseded; any other unit only where the case marks it omittable.
 */
export function accountedCheck(ctx: RunContext, version = 1): Outcome {
  if (!ctx.run.units) return { ok: false, detail: "the run carries no units" };
  const outcomes = caseOutcomes(ctx, version);
  const units = new Map(ctx.source.units.map((u) => [u.id, u]));
  const notInRun: string[] = [];
  const unaccounted: string[] = [];
  const badOmissions: string[] = [];
  for (const [id, o] of outcomes) {
    const u = units.get(id)!;
    if (o === "not_in_run") notInRun.push(id);
    else if (o === "unaccounted") unaccounted.push(id);
    else if (o === "omitted") {
      const allowed = u.omittable && (!u.critical || u.omittable.reason === "duplicate" || u.omittable.reason === "superseded");
      if (!allowed) badOmissions.push(`${id}${u.critical ? ` (critical: ${u.critical.reason})` : ""}`);
    }
  }
  const problems = [
    ...(badOmissions.length ? [`omitted but not omittable: ${list(badOmissions)}`] : []),
    ...(unaccounted.length ? [`unaccounted: ${list(unaccounted)}`] : []),
    ...(notInRun.length ? [`no run unit has the text of ${list(notInRun)}`] : []),
  ];
  if (problems.length) return { ok: false, detail: problems.join("; ") };
  const count = (o: string) => [...outcomes.values()].filter((x) => x === o).length;
  return { ok: true, detail: `${outcomes.size} units: ${count("represented")} represented, ${count("omitted")} omitted, ${count("needs_review")} needs review` };
}

/** Case units that should land in Needs review: ambiguous or conflicting units, and those of unknown/conflicting knowledge. */
export function expectedReviewUnits(source: SourceCase, knowledge: ExpectedKnowledge): string[] {
  const ids = new Set(source.units.filter((u) => u.ambiguity).map((u) => u.id));
  for (const k of knowledge.units) if (k.provenance === "conflicting" || k.provenance === "unknown") for (const u of k.sourceUnits) ids.add(u);
  return [...ids];
}

/**
 * `review_flagged`: every unit that should be in Needs review is (a flag about it, or its accounting outcome). When the
 * case expects nothing in review, any flag is a false alarm and fails; otherwise extra flags are listed, not failed.
 */
export function reviewCheck(ctx: RunContext, units?: readonly string[]): Outcome {
  const run = ctx.run;
  if (!run.units || (!run.flags && !run.accounting)) return { ok: false, detail: "the run carries no units, flags or accounting" };
  const toCase = mapUnits(run.units.units, ctx.source.units);
  const flaggedRun = new Set([
    ...(run.flags ?? []).flatMap((f) => (f.unit ? [f.unit] : [])),
    ...(run.accounting?.flags ?? []).flatMap((f) => (f.unit ? [f.unit] : [])),
    ...Object.entries(run.accounting?.outcome ?? {}).filter(([, o]) => o === "needs_review").map(([id]) => id),
  ]);
  const flagged = new Set([...flaggedRun].flatMap((id) => toCase.get(id) ?? []));
  const expected = units ?? expectedReviewUnits(ctx.source, ctx.knowledge);
  const missing = expected.filter((u) => !flagged.has(u));
  const extra = [...flagged].filter((u) => !expected.includes(u));
  if (!expected.length) return extra.length || flaggedRun.size ? { ok: false, detail: `nothing here needs review, but ${flaggedRun.size} unit(s) were flagged${extra.length ? `: ${list(extra)}` : ""}` } : { ok: true, detail: "review queue empty, as expected" };
  if (missing.length) return { ok: false, detail: `not in Needs review: ${list(missing)}${extra.length ? `; also flagged: ${list(extra)}` : ""}` };
  return { ok: true, detail: `all ${expected.length} expected units in Needs review${extra.length ? `; also flagged: ${list(extra)}` : ""}` };
}

/** Runs one run check. `undefined` when the check isn't one. */
export function runCheck(ctx: RunContext, check: Check): Outcome | undefined {
  switch (check.check) {
    case "cites":
      return citesCheck(ctx, check.element);
    case "units_accounted":
      return accountedCheck(ctx, check.version);
    case "review_flagged":
      return reviewCheck(ctx, check.units);
    default:
      return undefined;
  }
}
