/**
 * A distil Visualize run as a whole (knowledge-notes-plan §3.2, §4.1, WP1.10–1.12): the sections' knowledge
 * (`knowledgeCheck.ts`) accounted over the whole document's units, mapped onto the validated plan's nodes, and turned
 * into what the run hands on — each card's `sourceUnits` and `review` (stamped on its object by stable key), the
 * report v2 (`report.ts`), and the run's `KnowledgeRunOutput` for the golden evaluation (kept per source for the dev
 * hook `__acuteDev.knowledgeRun`). Pure, except the small in-memory registry at the end.
 */
import type { VisualPlan } from "@/ai/visual-plan/types";
import { accountUnits } from "./accounting";
import type { AccountingResult, CardReview, Idea, KnowledgeRunOutput, Lineage, Omission, ReviewFlag, UnitId, UnitSet } from "./contracts";
import { normalizeForCompare, protectedItemsOf } from "./exactness";
import { explainedByOf, nodeBody, shapesOf, type SectionKnowledge } from "./knowledgeCheck";
import { cardViews } from "./representation";
import { buildKnowledgeReport, type KnowledgeReport } from "./report";

/** One card's knowledge fields as its object stores them (`AIMetadata.sourceUnits`, `.review`). */
export interface CardKnowledge {
  sourceUnits: UnitId[];
  review?: CardReview;
}

export interface FinishedKnowledgeRun {
  run: KnowledgeRunOutput;
  report: KnowledgeReport;
  /** By the plan node's `stableKey` (the change's `stableNodeKey`). */
  cards: Record<string, CardKnowledge>;
}

const squash = (s: string) => normalizeForCompare(s).replace(/\s+/g, " ").trim();

/**
 * Citations and reviews by the validated plan's node ids. A node the plan kept has its own; a node the plan folded into
 * another (`mergeDetailCards` joins detail cards, `foldOverflow` moves extra nodes into "More from this section" pages)
 * hands its citations and review to the node whose text now holds its text, so no citation is dropped silently.
 */
export function onPlan(plan: VisualPlan, sections: readonly SectionKnowledge[]): { cites: Record<string, UnitId[]>; reviews: Record<string, CardReview>; lost: string[] } {
  const ideas = sections.flatMap((s) => s.ideas);
  const reviewsOf = new Map(sections.flatMap((s) => Object.entries(s.reviews)));
  const ids = new Set(plan.nodes.map((n) => n.id));
  const texts = plan.nodes.map((n) => ({ id: n.id, text: squash(`${n.title ?? ""}\n${nodeBody(n as unknown as Record<string, unknown>)}`) }));
  const cites: Record<string, UnitId[]> = {};
  const reviews: Record<string, CardReview> = {};
  const lost: string[] = [];
  const give = (id: string, units: readonly UnitId[], review: CardReview | undefined) => {
    if (units.length) cites[id] = [...new Set([...(cites[id] ?? []), ...units])];
    if (review) {
      const had = reviews[id];
      reviews[id] = had
        ? { reasons: [...new Set([...had.reasons, ...review.reasons])], ...((had.hints ?? review.hints) ? { hints: [...new Set([...(had.hints ?? []), ...(review.hints ?? [])])] } : {}), ...((had.checked ?? review.checked) ? { checked: had.checked ?? review.checked! } : {}) }
        : review;
    }
  };
  for (const idea of ideas) {
    const review = reviewsOf.get(idea.id);
    if (!idea.cites.length && !review) continue;
    if (ids.has(idea.id)) {
      give(idea.id, idea.cites, review);
      continue;
    }
    const needle = squash(idea.body || idea.title).slice(0, 60);
    const host = needle ? texts.find((t) => t.id !== idea.id && t.text.includes(needle)) : undefined;
    if (host) give(host.id, idea.cites, review);
    else lost.push(idea.id);
  }
  return { cites, reviews, lost };
}

/**
 * The plan's cards that span several nodes, as node ids (the card's own first): a shape with the text that explains it
 * (`explained_by`), a label-only shape with the full card citing its units (`cardViews`). What the reader sees as one
 * card; G1 (plan §9) counts these, not nodes. Read from the validated plan and its citations, so node ids are the plan's.
 */
export function cardGroupsOf(plan: unknown, cites: Readonly<Record<string, readonly UnitId[]>>): string[][] {
  const nodes = typeof plan === "object" && plan !== null && Array.isArray((plan as { nodes?: unknown }).nodes) ? ((plan as { nodes: unknown[] }).nodes as Record<string, unknown>[]) : [];
  const ideas: Idea[] = nodes.flatMap((n): Idea[] => {
    if (typeof n !== "object" || n === null || typeof n.id !== "string" || n.type === "group" || n.type === "heading") return [];
    const title = typeof n.title === "string" ? n.title : "";
    const body = nodeBody(n);
    if (!title.trim() && !body.trim()) return [];
    return [{ id: n.id, title, body, cites: [...(cites[n.id] ?? [])], ...(n.origin === "analysis" ? { origin: "analysis" as const } : {}), ...(n.type === "source" ? { byReference: true } : {}) }];
  });
  return cardViews(ideas, { explainedBy: explainedByOf(plan), shapes: shapesOf(plan) })
    .filter((v) => v.members.length > 1)
    .map((v) => [...v.members]);
}

/**
 * The run accounted over the whole document's units (§3.2). A unit no section holds (an earlier statement a later one
 * revised, G3.3, left out of what was analysed) is omitted as `superseded`; any other is left unaccounted (Needs review).
 */
export function accountRun(units: UnitSet, sections: readonly SectionKnowledge[], options: { superseded?: readonly string[] } = {}): { accounting: AccountingResult; omitted: Omission[]; flags: ReviewFlag[]; hints: ReviewFlag[] } {
  const held = new Set(sections.flatMap((s) => s.units));
  const earlier = (options.superseded ?? []).map(squash).filter(Boolean);
  const superseded: Omission[] = units.units.filter((u) => !held.has(u.id) && earlier.some((e) => e.includes(squash(u.text)))).map((u) => ({ unit: u.id, reason: "superseded" }));
  const omitted = [...sections.flatMap((s) => s.omitted), ...superseded];
  const flags = sections.flatMap((s) => s.flags);
  // A superseded unit's details were revised by a later statement: never "restored" (`accountUnits` exempts only duplicates).
  const revised = new Set(superseded.map((o) => o.unit));
  const protectedUnits = new Set(protectedItemsOf(units.units).filter((i) => i.tier === "exact" && !revised.has(i.unit)).map((i) => i.unit));
  const accounting = accountUnits({
    units: units.units,
    ideas: sections.flatMap((s) => s.ideas),
    omitted,
    pending: sections.flatMap((s) => (s.pending ? s.units : [])),
    protectedUnits,
    flags,
    // Units whose dropped clause went back on their card as a "Limit:" line (`restoreLimits`).
    restored: sections.flatMap((s) => s.restored.limits ?? []),
  });
  return { accounting, omitted, flags: accounting.flags, hints: sections.flatMap((s) => s.hints) };
}

/** Everything a distil run hands on, from its sections' knowledge and the validated plan. */
export function finishKnowledgeRun(input: {
  units: UnitSet;
  plan: VisualPlan;
  sections: readonly (SectionKnowledge & { key: string; label: string })[];
  superseded?: readonly string[];
  lineage?: Lineage;
}): FinishedKnowledgeRun {
  const { accounting, omitted, flags, hints } = accountRun(input.units, input.sections, { superseded: input.superseded ?? [] });
  const placed = onPlan(input.plan, input.sections);
  const cards: Record<string, CardKnowledge> = {};
  for (const n of input.plan.nodes) {
    if (!n.stableKey) continue;
    const sourceUnits = placed.cites[n.id] ?? [];
    const review = placed.reviews[n.id];
    if (sourceUnits.length || review) cards[n.stableKey] = { sourceUnits, ...(review ? { review } : {}) };
  }
  const report = buildKnowledgeReport({ sections: input.sections, accounting, ...(input.lineage ? { lineage: input.lineage } : {}), lostCitations: placed.lost.length });
  const run: KnowledgeRunOutput = {
    noteModel: "distil",
    plan: input.plan,
    units: input.units,
    cites: placed.cites,
    omitted,
    accounting,
    flags,
    hints,
    reviews: placed.reviews,
    cardGroups: cardGroupsOf(input.plan, placed.cites),
  };
  return { run, report, cards };
}

// ---------------------------------------------------------------- what the source version keeps (the Source tab, the queue)

/** Plain words for an omission reason, as the Source tab shows it on hover. */
export const OMISSION_REASON_TEXT: Readonly<Record<Omission["reason"], string>> = {
  filler: "left out as filler",
  duplicate: "left out as a repeat",
  superseded: "revised later in the source",
  meta: "talk about the document, not its content",
};

const MAX_REASONS = 5;

/**
 * Per unit: its outcome, the reasons the Source tab shows (an omission's reason, the Needs review details), and the
 * flags about passages no card carries (the review queue's passage items after a reload). Bounded.
 */
export function unitOutcomesOf(run: Pick<KnowledgeRunOutput, "accounting" | "omitted" | "flags" | "cites">): { outcome: Record<UnitId, AccountingResult["outcome"][string]>; reasons: Record<UnitId, string[]>; flags: ReviewFlag[] } {
  const outcome = run.accounting ? { ...run.accounting.outcome } : {};
  const reasons: Record<UnitId, string[]> = {};
  const add = (unit: UnitId, text: string) => {
    const list = (reasons[unit] ??= []);
    if (!list.includes(text) && list.length < MAX_REASONS) list.push(text);
  };
  for (const o of run.omitted ?? []) if (outcome[o.unit] === "omitted") add(o.unit, OMISSION_REASON_TEXT[o.reason] ?? o.reason);
  const flags = run.flags ?? [];
  for (const f of flags) if (f.unit && outcome[f.unit] === "needs_review") add(f.unit, f.detail);
  const cited = new Set(Object.values(run.cites ?? {}).flat());
  const passageFlags = flags.filter((f) => f.unit !== undefined && f.card === undefined && !cited.has(f.unit)).slice(0, 2_000);
  return { outcome, reasons, flags: passageFlags };
}

// ---------------------------------------------------------------- the latest run per source (the dev hook)

const MAX_RUNS = 20;
const runs = new Map<string, KnowledgeRunOutput>();

/** Keeps a run's output under its content source id (the latest per source; a few sources at most). */
export function rememberKnowledgeRun(sourceId: string, run: KnowledgeRunOutput): void {
  runs.delete(sourceId);
  runs.set(sourceId, run);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
}

/**
 * The latest run of a source as the golden recorder saves it (`e2e/ai/recordGolden.spec.ts` → `run.json`): the
 * `KnowledgeRunOutput` without its plan (the recorder saves the stored plan on its own, Lane A's request). Null when
 * this page made no distil run of that source.
 */
export function knowledgeRunOf(sourceId: string): Omit<KnowledgeRunOutput, "plan"> | null {
  const run = runs.get(sourceId);
  if (!run) return null;
  const { plan: _plan, ...rest } = run;
  return rest;
}

/** The full output, plan included (tests). */
export function knowledgeRunWithPlan(sourceId: string): KnowledgeRunOutput | null {
  return runs.get(sourceId) ?? null;
}

/** The latest distil run on this page, whatever its source (the fidelity e2e report reads it right after Accept). */
export function latestKnowledgeRun(): Omit<KnowledgeRunOutput, "plan"> | null {
  const last = [...runs.keys()].at(-1);
  return last ? knowledgeRunOf(last) : null;
}
