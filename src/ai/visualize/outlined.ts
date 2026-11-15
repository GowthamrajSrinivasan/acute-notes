/**
 * The outlined Visualize path (F42 Phase 2), for every document AI analyses
 * without a user-forced template — even one with a single section, whose
 * outline then just classifies it: outline the whole document once (`outline_document`), generate
 * each semantic section with its kind's rules (`generate_visual_plan`, in
 * parallel), then assemble one raw `sectioned` plan — each section framed,
 * primary sections first, section links drawn between frames, and the
 * outline's one-line summary under the document's title.
 *
 * The result is a raw plan for `validateVisualPlan`, like every other
 * producer's. Keys are namespaced by section (`<section key> § …`, where a
 * section key joins its unit keys), so "Update from new content" can reuse an
 * unchanged section as is and regenerate only a changed one.
 */
import { planLocally } from "@/ai/content/localPlanner";
import { parseContent } from "@/ai/content/parser";
import { AIError, isAvailabilityError } from "@/ai/errors";
import { failureCause, type SectionFallback } from "@/ai/fidelity/analysis";
import { itemIds, missingAnalysis, SHORT_SOURCE_CHARS, takeawayOf } from "@/ai/fidelity/analysisCheck";
import { expandSourceRefs, labelSource, numberSource, type LabelledSource, type SourceBlock } from "@/ai/fidelity/sourceBlocks";
import type { DistilReply, NoteModel, SourceUnit, UnitId, UnitSet } from "@/ai/fidelity/contracts";
import {
  aiRetryReasons,
  annotateDistil,
  cardReviews,
  checkItemKey,
  checkItems,
  exactMissingKeys,
  inspectSection,
  knowledgeIsWorse,
  prefixKnowledge,
  restoreLimits,
  restoreProtected,
  retryIsBetter,
  retryReasons,
  verdictFlags,
  verdictsOf,
  type CardVerdict,
  type SectionInspection,
  type SectionKnowledge,
} from "@/ai/fidelity/knowledgeCheck";
import { parseSemanticCheckReply, type SemanticCheckAnswer } from "@/ai/fidelity/semanticCheck";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { readDistilReply } from "@/ai/visual-plan/validate";
import { FIDELITY_CONFIG, organisationFor } from "@/config/fidelity";
import { cutUnstatedBenefits } from "@/ai/fidelity/unstated";
import { buildReport, compareCoverage, sectionOf, type FidelityReport } from "@/ai/fidelity/report";
import { attachUncovered, type SectionCoverage } from "@/ai/fidelity/safetyNet";
import { NO_PROVIDER_CONFIGURED_MESSAGE, type AIRuntime, type AIRuntimeResult, type ProviderRole } from "@/ai/runtime";
import { mergeUnitPlans, unitOfKey } from "@/ai/reconcile/keys";
import { headingOnlyReply, type AnalysisUnit } from "@/ai/reconcile/units";
import { ungroup, UNIT_SECTION_SUFFIX, wrapSections, type SectionSpec } from "@/ai/visual-plan/groups";
import { SECTION_KINDS, SECTION_PROMINENCE, sectionKind, type SectionKind, type SectionProminence } from "@/ai/visual-plan/sectionKinds";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { unitsOfSectionKey, validateOutline, type Outline, type OutlineInput, type OutlineSection } from "./outline";
import type { CheckCardMeaningInput, GenerateVisualPlanInput } from "./tasks";
import { applyAnalysisPatch, needsFullRegeneration, nodeSummaries, type AnalysisPatchInput } from "./analysisPatch";
import { mergePieceReplies, splitIntoPieces } from "./pieces";
import { elapsedMs, logOutlinedTiming, startTimer, type SectionTiming } from "./timing";

export const isHeadingOnly = (u: AnalysisUnit) => headingOnlyReply(u, "sectioned") !== null;

/** A section's text: its units' own text, in document order. */
export function sectionText(section: { units: readonly string[] }, units: readonly AnalysisUnit[]): string {
  const byKey = new Map(units.map((u) => [u.key, u.text] as const));
  return section.units.map((k) => byKey.get(k) ?? "").filter(Boolean).join("\n\n");
}

/**
 * A section's (or piece's) source numbered block by block (Wave B1), or null when it can't be parsed. In distil mode
 * (`distil`: the run's note model, `FIDELITY_CONFIG.noteModel` unless the run chose one; knowledge-notes-plan WP1.4–1.5,
 * WP1.10, WP2.8) the same blocks with their units labelled for citing — with the WHOLE document's unit ids (`units`), so
 * citations of every section and piece name one set of units — and the generation input's `noteModel`. In `preserve` it
 * is exactly `numberSource`.
 */
async function sourceView(
  text: string,
  distil: boolean,
  units?: readonly SourceUnit[],
): Promise<{ blocks: SourceBlock[]; numbered: string; mode: Pick<GenerateVisualPlanInput, "noteModel">; labelled?: LabelledSource } | null> {
  if (!distil) {
    const source = await numberSource(text).catch(() => null);
    return source && { ...source, mode: {} };
  }
  // Unparseable: still a distil section (with nothing to cite, it goes to Needs review rather than back to preserve).
  const labelled = await labelSource(text, units).catch(() => null);
  return { blocks: labelled?.blocks ?? [], numbered: labelled?.labelled ?? "", mode: { noteModel: "distil" }, ...(labelled ? { labelled } : {}) };
}

/** The units a labelled section (or piece) holds, in document order. */
function unitsOfLabelled(labelled: LabelledSource | undefined, byId: ReadonlyMap<UnitId, SourceUnit>, order: ReadonlyMap<UnitId, number>): SourceUnit[] {
  if (!labelled) return [];
  const ids = new Set([...Object.values(labelled.labels), ...Object.values(labelled.blockUnits).flat()]);
  return [...ids].flatMap((id) => byId.get(id) ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Several pieces' distil readings as one (their omissions and problems together; citations travel on the nodes). */
function joinDistil(readings: readonly (DistilReply | undefined)[]): DistilReply | undefined {
  const present = readings.filter((r): r is DistilReply => !!r);
  if (!present.length) return undefined;
  return { cites: {}, omitted: present.flatMap((r) => r.omitted), problems: present.flatMap((r) => r.problems), needsReview: present.some((r) => r.needsReview) };
}

/** Failures no section fallback may hide: a cancellation, and nothing being configured. */
export function isFatalAIError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (!(err instanceof AIError)) return false;
  return err.kind === "cancelled" || (err.kind === "model_unavailable" && err.message === NO_PROVIDER_CONFIGURED_MESSAGE);
}

/**
 * A section whose generation failed: its own explicit structure from the local tier (tables, checklists, code,
 * text; its section headings as subheadings inside the frame), so it still reads as a section. Only content the
 * local tier can't plan becomes one note (a page when long), so nothing is lost either way.
 */
export async function sectionFallbackReply(text: string, label?: string): Promise<unknown> {
  try {
    const { plan } = planLocally(await parseContent(text), text);
    if (plan) {
      const flat = ungroup(plan);
      // Spans are offsets into this section's text, not the document's, so they are dropped.
      const nodes = flat.nodes.map(({ sourceSpan: _span, ...n }) => (n.type === "heading" && n.role !== "subsection" ? { ...n, role: "subsection" } : n));
      return { version: 1, template: "sectioned", nodes, relationships: flat.relationships };
    }
  } catch {
    // Unparseable or too large for one plan: shown as text below.
  }
  const node =
    text.length > 2_000 ? { id: "n1", type: "page", content: { title: label?.trim() || "Notes", markdown: text.slice(0, 20_000) } } : { id: "n1", type: "text", content: { markdown: text } };
  return { version: 1, template: "sectioned", nodes: [node], relationships: [] };
}

/**
 * One section's generation, never failing the document: a section the model couldn't produce a usable plan for
 * (after the runtime's repair retry) shows its own structure instead, with a warning and its `cause` (for the
 * review's "structure only" notice). The cause is logged too, so failing sections can be told apart. Only fatal
 * errors propagate.
 */
export async function generateSection(
  runtime: AIRuntime,
  input: GenerateVisualPlanInput,
  warnings: string[],
  signal?: AbortSignal,
): Promise<{ data: unknown; result: AIRuntimeResult<unknown> | null; cause?: string }> {
  try {
    const result = await runtime.run<GenerateVisualPlanInput, unknown>("generate_visual_plan", input, { signal });
    return { data: result.data, result };
  } catch (err) {
    if (isFatalAIError(err)) throw err;
    const label = input.section?.label ?? "?";
    const cause = failureCause(err);
    warnings.push(`Section "${label}" couldn't be analysed (${cause}), so its own structure is shown.`);
    console.warn(`[acute-notes] Visualize: section "${label}" fell back to its own structure (${cause})`);
    return { data: await sectionFallbackReply(input.text, input.section?.label), result: null, cause };
  }
}

export interface OutlinedResult {
  raw: unknown;
  sections: OutlineSection[];
  warnings: string[];
  /** The sections the model couldn't produce (shown from their own structure instead), with why. */
  failed: SectionFallback[];
  /** The outline call failed, so each part was generated as a section of its own. */
  outlineFailed?: true;
  /** Why the outline call failed. */
  outlineCause?: string;
  /** How much of the AI-generated sections' source the model's plans placed, and what the safety net added. */
  fidelity: FidelityReport;
  /** Regenerated sections whose earlier reply was kept, because the new one placed less of the source (or failed). */
  keptEarlier: string[];
  /** Labels of sections whose plan only restates the content, even after the analysis check's retry (Wave B). */
  shallow: string[];
  /** The outline used, and each section's reply (after the safety net) with its coverage — for "Regenerate". */
  outline: Outline;
  replies: ReadonlyMap<string, SectionReply>;
  provenance?: { providerId: string; role: ProviderRole; model: string };
  /**
   * Distil mode (knowledge-notes-plan WP1.10): the document's units and each section's knowledge (citations, omissions,
   * checks, reviews), with node ids as the merged plan has them. Absent in `preserve`.
   */
  knowledge?: { units: UnitSet; sections: (SectionKnowledge & { key: string; label: string })[] };
}

/** A section's reply as the plan used it (after the safety net), and its coverage (null for a failed section). */
export interface SectionReply {
  raw: unknown;
  coverage: SectionCoverage | null;
  /** Why AI couldn't produce this section (it shows its own structure). */
  cause?: string;
  /** The analysis check failed twice: the plan only restates the section (Wave B). */
  shallow?: true;
  /** Distil mode: the section's knowledge, with the reply's own node ids (a regeneration is compared with it). */
  knowledge?: SectionKnowledge;
}

/**
 * A regeneration of an earlier outlined run ("Regenerate" in the review): its outline and replies are reused as
 * they were — no outline call, no call for the other sections — and only the `retry` sections are generated again,
 * each told which of its points the earlier plan left out.
 */
export interface OutlinedReuse {
  outline: Outline;
  replies: ReadonlyMap<string, SectionReply>;
  /** Section key → the points the earlier plan left out. */
  retry: ReadonlyMap<string, readonly string[]>;
  /** Sections regenerated before (each is regenerated at most once, content fidelity Wave A2). */
  regenerated?: ReadonlySet<string>;
}

export interface OutlinedOptions {
  signal?: AbortSignal;
  /** See `mergeUnitPlans`: keeps ids distinct from nodes reused from an earlier version. */
  idPrefix?: string;
  /** Emit sections as flat headings (for reconciliation, `groupByUnit`'s `flat`). */
  flat?: boolean;
  reuse?: OutlinedReuse;
  /** What the run is doing now, in words for the progress line (outlining, which sections, how many are done…). */
  onProgress?: (label: string) => void;
  /**
   * Distil mode: the source version's units (`splitUnits` of the text the version stores, or the units matched to the
   * previous version on an update), so every section is labelled with the whole document's ids. Without them a distil
   * run splits the analysed text itself (ids consistent within the run, not with a stored version).
   */
  sourceUnits?: UnitSet;
  /** The run's note model (WP2.8: the Visualize dialog's per-run choice). Omitted: `FIDELITY_CONFIG.noteModel`, as before. */
  noteModel?: NoteModel;
}

/** Quotes a section label for a progress line, shortening a long one. */
const quoted = (label: string) => `“${label.length > 40 ? `${label.slice(0, 39).trimEnd()}…` : label}”`;

/**
 * The analysis check's light retry: the takeaway and analysis `missing` from a small call, merged into `data`. Null when the
 * call failed or its reply couldn't be merged (the caller then regenerates the whole section); fatal errors propagate.
 */
async function patchAnalysis(
  runtime: AIRuntime,
  section: { label: string; kind: SectionKind },
  text: string,
  data: unknown,
  missing: readonly string[],
  signal?: AbortSignal,
  distil = false,
): Promise<unknown | null> {
  try {
    const takeaway = takeawayOf(data);
    const input: AnalysisPatchInput = {
      label: section.label,
      kind: section.kind,
      text,
      missing: [...missing],
      nodes: nodeSummaries(data),
      ...(takeaway ? { takeaway } : {}),
      ...(distil ? { noteModel: "distil" as const } : {}),
    };
    const r = await runtime.run<AnalysisPatchInput, unknown>("generate_section_analysis", input, { signal });
    const merged = applyAnalysisPatch(data, r.data, missing);
    return merged ? cutUnstatedBenefits(merged, text) : null;
  } catch (err) {
    if (isFatalAIError(err)) throw err;
    console.warn(`[acute-notes] Visualize: the analysis of section "${section.label}" couldn't be completed on its own (${failureCause(err)}); regenerating the section`);
    return null;
  }
}

/**
 * The model check (knowledge-notes-plan §3.4, `FIDELITY_CONFIG.semanticCheck`; on every citing card since OD5b): one batched
 * `check_card_meaning` call for the section's cards (those the rules hint about, or every citing card with `cards: "all"`).
 * It runs before the section's one retry (so the retry can fix what it finds) and again on what changed after it: `known`
 * holds the verdicts given so far by card text (`checkItemKey`), so a card the retry or a "Limit:" line left as it was
 * is never asked about twice (one it didn't answer included: it stays uncertain, never "supported"). A failed call answers
 * nothing, so its cards stay uncertain; fatal errors propagate.
 */
async function checkCardsWithAI(
  runtime: AIRuntime,
  label: string,
  inspection: SectionInspection,
  units: readonly SourceUnit[],
  signal?: AbortSignal,
  known: Map<string, CardVerdict> = new Map(),
): Promise<{ verdicts: Map<string, CardVerdict>; checked?: NonNullable<SectionKnowledge["checked"]> }> {
  const { items, cardOf } = checkItems(inspection, units, FIDELITY_CONFIG.semanticCheck.cards);
  if (!items.length) return { verdicts: new Map() };
  const verdicts = new Map<string, CardVerdict>();
  const fresh = items.filter((i) => {
    const v = known.get(checkItemKey(i));
    if (v === undefined) return true;
    verdicts.set(cardOf.get(i.ref)!, v);
    return false;
  });
  const batch = fresh.slice(0, 200);
  if (batch.length) {
    let answers: SemanticCheckAnswer[] | null = null;
    try {
      const r = await runtime.run<CheckCardMeaningInput, string>("check_card_meaning", { items: batch }, { signal });
      answers = parseSemanticCheckReply(r.data, batch.map((i) => i.ref)).answers;
    } catch (err) {
      if (isFatalAIError(err)) throw err;
      console.warn(`[acute-notes] Visualize: the AI check of section "${label}" failed (${failureCause(err)}); its cards stay in Needs review`);
    }
    const got = verdictsOf(answers, new Map(batch.map((i) => [i.ref, cardOf.get(i.ref)!] as const)));
    for (const i of batch) {
      const v = got.get(cardOf.get(i.ref)!)!;
      known.set(checkItemKey(i), v);
      verdicts.set(cardOf.get(i.ref)!, v);
    }
  }
  const all = [...verdicts.values()];
  const count = (verdict: string) => all.filter((v) => v !== "unanswered" && v.verdict === verdict).length;
  return {
    verdicts,
    checked: { cards: all.length, supported: count("supported"), partly: count("partly"), notSupported: count("not_supported"), unanswered: all.filter((v) => v === "unanswered").length },
  };
}

/** A distil section that produced no AI reply: its units are `pending`, never shown as complete (§3.2). */
function pendingKnowledge(units: readonly SourceUnit[]): SectionKnowledge {
  return { units: units.map((u) => u.id), ideas: [], omitted: [], problems: [], flags: [], hints: [], reviews: {}, restored: { items: [], units: [] }, pending: true, needsReview: units.length, exactMissing: [] };
}

/** Runs the outlined path over `units` (in document order): one outline call, then one generation per section. */
export async function visualizeOutlined(units: readonly AnalysisUnit[], runtime: AIRuntime, options: OutlinedOptions = {}): Promise<OutlinedResult> {
  const { signal, idPrefix = "", flat = false, reuse } = options;
  const runStart = startTimer();
  const timings: SectionTiming[] = [];
  const report = (label: string) => options.onProgress?.(label);
  const title = units[0] && isHeadingOnly(units[0]) ? units[0] : null;
  const content = units.filter((u) => !isHeadingOnly(u));
  // Distil (knowledge-notes-plan WP1.10): the whole document's units, so every section and piece is labelled with one set of ids.
  const distil = (options.noteModel ?? FIDELITY_CONFIG.noteModel) === "distil";
  const docUnits: UnitSet | null = distil ? (options.sourceUnits ?? (await splitUnits(units.map((u) => u.text).join("\n\n")).catch(() => null))) : null;
  const unitById = new Map((docUnits?.units ?? []).map((u) => [u.id, u] as const));
  const unitOrder = new Map((docUnits?.units ?? []).map((u, i) => [u.id, i] as const));
  report(reuse ? "Preparing to regenerate…" : content.length > 1 ? `Outlining the document (${content.length} parts)…` : "Outlining the document…");
  // An outline whose reply was unusable still generates every part: each becomes a section of its own ("notes", every
  // node type allowed), so nothing is lost to a narrower template. A provider that is unavailable (auth, quota,
  // network…) fails the same way for every section, so that error is surfaced as is instead.
  let outlined: AIRuntimeResult<unknown> | null = null;
  const outlineStart = startTimer();
  let outlineError: unknown = null;
  const notes: string[] = [];
  if (content.length && !reuse) {
    try {
      outlined = await runtime.run<OutlineInput, unknown>("outline_document", { units: content.map((u) => ({ key: u.key, text: u.text })) }, { signal });
    } catch (err) {
      if (isFatalAIError(err) || isAvailabilityError(err)) throw err;
      outlineError = err;
      notes.push(`The document outline failed (${failureCause(err)}), so each section was analysed on its own.`);
      console.warn(`[acute-notes] Visualize: the outline failed (${failureCause(err)})`);
    }
  }
  const outlineMs = elapsedMs(outlineStart);
  const validated = reuse ? { outline: reuse.outline, warnings: [] } : validateOutline(outlined?.data, content);
  const outline = validated.outline;
  const warnings = [...notes, ...(outlined ? validated.warnings : [])];
  // Primary sections first, each kind in the outline's own order: this order is the frames' reading order.
  const sections = orderByProminence(outline.sections);
  // Progress: the sections that call the model, and how many of them have finished (they run in parallel).
  const toGenerate = sections.filter((s) => !(reuse?.replies.has(s.key) && !reuse.retry.has(s.key)));
  const verb = reuse ? "Regenerating" : "Analyzing";
  let done = 0;
  if (toGenerate.length === 1) report(`${verb} ${quoted(toGenerate[0]!.label)}…`);
  else if (toGenerate.length > 1) report(`${verb} ${toGenerate.length} sections…`);
  const finished = () => {
    done++;
    if (toGenerate.length > 1 && done < toGenerate.length) report(`${verb} sections: ${done} of ${toGenerate.length} done…`);
  };
  const replies = await Promise.all(
    sections.map(
      async (s): Promise<{ data: unknown; result: AIRuntimeResult<unknown> | null; cause?: string; coverage: SectionCoverage | null; keptEarlier?: true; shallow?: true; knowledge?: SectionKnowledge }> => {
      const previous = reuse?.replies.get(s.key);
      const retry = reuse?.retry.get(s.key);
      if (previous && !retry) {
        return {
          data: previous.raw,
          result: null,
          coverage: previous.coverage,
          ...(previous.cause ? { cause: previous.cause } : {}),
          ...(previous.shallow ? { shallow: true as const } : {}),
          ...(previous.knowledge ? { knowledge: previous.knowledge } : {}),
        };
      }
      const sectionStart = startTimer();
      const text = sectionText(s, units);
      // Numbered block by block, so the model can place a block by reference instead of retyping it (Wave B1). In
      // distil mode, its units labelled with the whole document's ids (WP1.10).
      const source = await sourceView(text, distil, docUnits?.units);
      const labelled = source?.labelled;
      const sectionUnits = unitsOfLabelled(labelled, unitById, unitOrder);
      const items = source ? itemIds(source.blocks) : [];
      // A whole document in one section, longer than a note: the visual is the point, so text alone isn't enough.
      const check = { needsStructure: sections.length === 1 && text.trim().length > SHORT_SOURCE_CHARS && s.kind !== "supporting" };
      const input: GenerateVisualPlanInput = {
        template: "sectioned",
        text,
        section: { label: s.label, kind: s.kind },
        ...(retry?.length ? { retry: { missing: [...retry] } } : {}),
        ...(source?.blocks.length ? { numbered: source.numbered } : {}),
        ...source?.mode,
      };
      /** One generation, with its references expanded and its shortened tables repaired, before anything reads it. */
      const generate = async (extra: Partial<GenerateVisualPlanInput> = {}) => {
        const r = await generateSection(runtime, { ...input, ...extra }, warnings, signal);
        if (!r.result) return r;
        // Distil (WP1.10): what the reply cites and omits, read before references are expanded; citations go on the nodes.
        const reading = labelled ? readDistilReply(r.data, labelled) : undefined;
        const cited = reading ? annotateDistil(r.data, reading) : r.data;
        // A generic benefit the section never states ("…, improving accuracy") is cut from its takeaway and analysis.
        const data = cutUnstatedBenefits(cited, text);
        if (!source) return { ...r, data };
        const x = expandSourceRefs(data, source.blocks);
        if (x.unknown.length) warnings.push(`Section "${s.label}": AI referred to blocks that don't exist (${x.unknown.join(", ")}); the safety net restores what's missing.`);
        return { ...r, data: x.raw, ...(reading ? { distil: reading } : {}) };
      };
      /**
       * A large section, generated in pieces in parallel and merged (`pieces.ts`): each piece is numbered and expanded on its
       * own, a piece that fails shows its own structure while the others stay AI's, and the section's takeaway and analysis are
       * left to the analysis step below. A regeneration hands each piece only the missing points its text holds.
       */
      const pieceTexts = splitIntoPieces(text);
      const generateWhole = async () => {
        if (pieceTexts.length < 2) return generate();
        const squash = (v: string) => v.replace(/\s+/g, " ").trim();
        const parts = await Promise.all(
          pieceTexts.map(async (pieceText, i) => {
            const own = retry?.filter((point) => squash(pieceText).includes(squash(point)));
            const numbered = await sourceView(pieceText, distil, docUnits?.units);
            const r = await generateSection(
              runtime,
              {
                template: "sectioned",
                text: pieceText,
                section: { label: s.label, kind: s.kind },
                part: { index: i + 1, total: pieceTexts.length },
                ...(own?.length ? { retry: { missing: [...own] } } : {}),
                ...(numbered?.blocks.length ? { numbered: numbered.numbered } : {}),
                ...numbered?.mode,
              },
              warnings,
              signal,
            );
            if (!r.result) return r;
            const reading = numbered?.labelled ? readDistilReply(r.data, numbered.labelled) : undefined;
            const data = cutUnstatedBenefits(reading ? annotateDistil(r.data, reading) : r.data, pieceText);
            if (!numbered) return { ...r, data };
            const x = expandSourceRefs(data, numbered.blocks);
            if (x.unknown.length) warnings.push(`Section "${s.label}" (part ${i + 1}): AI referred to blocks that don't exist (${x.unknown.join(", ")}); the safety net restores what's missing.`);
            return { ...r, data: x.raw, ...(reading ? { distil: reading } : {}) };
          }),
        );
        const done = parts.filter((p) => p.result);
        // Every piece failed: the section shows its own structure, as a section that failed whole does.
        if (!done.length) return { data: await sectionFallbackReply(text, s.label), result: null, cause: parts[0]?.cause };
        if (done.length < parts.length) warnings.push(`Section "${s.label}": ${parts.length - done.length} of ${parts.length} parts couldn't be analysed, so their own structure is shown.`);
        // Distil: a piece that failed shows its own structure; its units are cited by no card, so they are Needs review.
        const distilOfParts = labelled ? joinDistil(parts.map((p) => ("distil" in p ? (p.distil as DistilReply | undefined) : undefined))) : undefined;
        return {
          data: mergePieceReplies(parts.map((p) => p.data)),
          result: done[done.length - 1]!.result,
          cause: undefined as string | undefined,
          ...(distilOfParts ? { distil: distilOfParts } : {}),
        };
      };
      let reply = await generateWhole();
      const generateMs = elapsedMs(sectionStart);
      let retryTiming: SectionTiming["retry"];
      // The analysis check (Wave B): a plan with no takeaway, no analysis of its own, or (item by item) an analysis
      // that skips most of the items the source names, is generated once more, told what it lacked; the retry is
      // kept when it lacks less. Still lacking after that: reported, never hidden.
      let shallow = false;
      /** Distil: what the section's one retry did (WP1.10). */
      let knowledgeRetry: SectionKnowledge["retry"];
      const distilOf = (r: object): DistilReply | undefined => ("distil" in r ? (r as { distil?: DistilReply }).distil : undefined);
      /** The model check's verdicts so far in this section, by card text (`checkItemKey`): a card is checked once. */
      const known = new Map<string, CardVerdict>();
      const checkOn = FIDELITY_CONFIG.semanticCheck.enabled;
      /**
       * A reply's inspection, with the model check's verdicts read in when the check is on (`checkCardsWithAI`, only cards not
       * checked before): "partly", "not supported" and no answer flag their card; a card it calls supported keeps a unit
       * whose condition the word rule missed (OD5b), which also means no "Limit:" line goes on it.
       */
      const judge = async (data: unknown, omitted: Parameters<typeof inspectSection>[2], options: { restoredLimits?: UnitId[] } = {}) => {
        const plain = inspectSection(data, sectionUnits, omitted, options);
        if (!checkOn) return { inspection: plain, plain, scored: plain, verdicts: new Map<string, CardVerdict>(), checked: undefined as SectionKnowledge["checked"] };
        const r = await checkCardsWithAI(runtime, s.label, plain, sectionUnits, signal, known);
        const aiSupported = new Set([...r.verdicts].flatMap(([card, v]) => (v !== "unanswered" && v.verdict === "supported" ? [card] : [])));
        const extra = verdictFlags(r.verdicts);
        const inspection = r.verdicts.size ? inspectSection(data, sectionUnits, omitted, { ...options, extra, aiSupported }) : plain;
        // For "is the retry better": the rules' findings and the check's, with no verdict cancelling a rule's (so a retry
        // that fixes what the rules found still counts as better when the check called the first card supported).
        const scored = extra.length ? inspectSection(data, sectionUnits, omitted, { ...options, extra }) : plain;
        return { inspection, plain, scored, verdicts: r.verdicts, checked: r.checked };
      };
      if (reply.result && labelled) {
        // Distil (knowledge-notes-plan WP1.10): ONE retry per section, combining what the analysis check, exactness and
        // accounting found (and, when it retries anyway, the meaning hints), kept only when it is better: fewer problems
        // and no protected item lost. `preserve` keeps today's analysis retry below, unchanged. With the model check on, it
        // runs first: its "partly / not supported" findings are reasons of the retry too, and "better" counts them.
        const look = async (r: { data: unknown }) => {
          const j = await judge(r.data, distilOf(r)?.omitted ?? []);
          // `retryIsBetter` reads `inspection`: here the rules' findings plus the check's (`scored`).
          return { inspection: j.scored, plain: j.plain, analysisMissing: missingAnalysis(r.data, s.kind, items, check).length, verdicts: j.verdicts };
        };
        const labelOf = new Map(Object.entries(labelled.labels).map(([label, id]) => [id, label] as const));
        for (const [ref, ids] of Object.entries(labelled.blockUnits)) for (const id of ids) if (!labelOf.has(id)) labelOf.set(id, ref);
        let current = await look(reply);
        const missing = missingAnalysis(reply.data, s.kind, items, check);
        // The rules' reasons are the rules' own (a "supported" verdict doesn't cancel them); the check's findings are added.
        const hard = retryReasons(current.plain, (u) => labelOf.get(u), distilOf(reply)?.problems ?? [], { units: sectionUnits });
        const aiReasons = aiRetryReasons(current.inspection, current.verdicts);
        if (missing.length || hard.length || aiReasons.length) {
          if (toGenerate.length === 1) report(hard.length || aiReasons.length ? `Checking ${quoted(s.label)} against its source…` : `Deepening the analysis of ${quoted(s.label)}…`);
          const retryStart = startTimer();
          let kind: "patch" | "full" | undefined;
          let kept = false;
          // Only the analysis is missing (or the section came in pieces, which is never generated whole again): the small call.
          if (missing.length && !needsFullRegeneration(missing) && ((!hard.length && !aiReasons.length) || pieceTexts.length > 1)) {
            kind = "patch";
            const data = await patchAnalysis(runtime, s, text, reply.data, missing, signal, true);
            if (data) {
              const next = await look({ data, ...(distilOf(reply) ? { distil: distilOf(reply) } : {}) });
              if (next.analysisMissing < current.analysisMissing && retryIsBetter(current, next)) {
                reply = { ...reply, data };
                current = next;
                kept = true;
              }
            }
          }
          if (!kept && pieceTexts.length < 2) {
            kind = "full";
            const reasons = [...new Set([...retryReasons(current.plain, (u) => labelOf.get(u), distilOf(reply)?.problems ?? [], { withHints: true, units: sectionUnits }), ...aiReasons])].slice(0, 60);
            const again = await generate({ ...(missing.length ? { analysisRetry: { missing } } : {}), ...(reasons.length ? { knowledgeRetry: { reasons } } : {}) });
            if (again.result) {
              // Only the cards the retry changed are checked again (`known`).
              const next = await look(again);
              if (retryIsBetter(current, next)) {
                reply = again;
                current = next;
                kept = true;
              }
            }
          }
          if (kind) {
            retryTiming = { kind, ms: elapsedMs(retryStart) };
            knowledgeRetry = { kind, kept };
          }
          shallow = current.analysisMissing > 0;
          if (shallow) warnings.push(`Section "${s.label}": AI's plan lacks ${missingAnalysis(reply.data, s.kind, items, check).join(" and ")}, even after a retry.`);
        }
      } else if (reply.result) {
        const missing = missingAnalysis(reply.data, s.kind, items, check);
        if (missing.length) {
          if (toGenerate.length === 1) report(`Deepening the analysis of ${quoted(s.label)}…`);
          const retryStart = startTimer();
          // A plan lacking only a takeaway or analysis gets just those from a small call, merged into the plan it has (its
          // details are untouched); a plan lacking drawn structure, or a small call that fixed nothing, is generated whole again.
          let patched = false;
          if (!needsFullRegeneration(missing)) {
            const data = await patchAnalysis(runtime, s, text, reply.data, missing, signal);
            if (data && missingAnalysis(data, s.kind, items, check).length < missing.length) {
              reply = { ...reply, data };
              patched = true;
            }
          }
          // (A section generated in pieces is never generated whole again: that is the call it was split to avoid.)
          if (!patched && pieceTexts.length < 2) {
            const again = await generate({ analysisRetry: { missing } });
            if (again.result && missingAnalysis(again.data, s.kind, items, check).length < missing.length) reply = again;
          }
          retryTiming = { kind: patched ? "patch" : "full", ms: elapsedMs(retryStart) };
          const still = missingAnalysis(reply.data, s.kind, items, check);
          shallow = still.length > 0;
          if (shallow) warnings.push(`Section "${s.label}": AI's plan lacks ${still.join(" and ")}, even after a retry.`);
        }
      }
      finished();
      // A regeneration never makes a section worse (Wave A2): an earlier AI reply is kept when the new one fails or
      // places less of the source (then fewer key terms). A section that had fallen back has nothing to lose. In distil
      // mode "worse" is more Needs review items or a protected item lost (§0.3), not the share placed.
      const earlier =
        retry && previous?.coverage
          ? { data: previous.raw, result: null, coverage: previous.coverage, keptEarlier: true as const, ...(previous.knowledge ? { knowledge: previous.knowledge } : {}) }
          : null;
      // The content safety net: whatever of the section the model's plan leaves out is attached to it, verbatim.
      // (A failed section already shows its own structure, so it needs none.)
      const record = (netMs: number) => timings.push({ label: s.label, chars: text.length, ...(pieceTexts.length > 1 ? { pieces: pieceTexts.length } : {}), generateMs, ...(retryTiming ? { retry: retryTiming } : {}), netMs, totalMs: elapsedMs(sectionStart) });
      if (!reply.result) {
        record(0);
        return earlier ?? { ...reply, coverage: null, ...(labelled ? { knowledge: pendingKnowledge(sectionUnits) } : {}) };
      }
      const netStart = startTimer();
      if (labelled) {
        // Distil (WP1.11): no "Also in the source" card or "Source details" page (§5.3): the units the net would have
        // attached are accounted for instead. Coverage is still measured, as a diagnostic until R1 (§6.3).
        const net = await attachUncovered(reply.data, text, { attach: false });
        const omitted = distilOf(reply)?.omitted ?? [];
        let inspection = inspectSection(reply.data, sectionUnits, omitted);
        const exactMissing = exactMissingKeys(inspection.exactMissing);
        // §3.3: protected content still missing after the retry goes back on the canvas, never lost silently.
        const restored = restoreProtected(reply.data, inspection, sectionUnits);
        if (restored.items.length || restored.units.length) inspection = inspectSection(restored.raw, sectionUnits, omitted);
        // §3.4 / OD5b: the model check, on every citing card in distil mode (`FIDELITY_CONFIG.semanticCheck`); it already saw
        // the cards before the retry, so only cards changed since are asked about (`known`).
        let verdicts = new Map<string, CardVerdict>();
        let checked: SectionKnowledge["checked"];
        if (checkOn) ({ inspection, verdicts, checked } = await judge(restored.raw, omitted));
        // §3.3/§3.4: a condition, caveat or requirement every citing card still drops after the retry goes on the card it
        // belongs on as a "Limit:" line from the source; its unit is then `restored` (nothing critical lost silently). With
        // the check on, a card it called supported gets none (the word rule's miss was a paraphrase, and the line would only
        // lengthen a faithful card, live 2026-10-20); a card that gets one is checked again with it.
        const limits = restoreLimits(restored.raw, inspection, sectionUnits);
        const data = limits.raw;
        const restoredLimits = limits.units;
        if (restoredLimits.length) {
          if (checkOn) ({ inspection, verdicts, checked } = await judge(data, omitted, { restoredLimits }));
          else inspection = inspectSection(data, sectionUnits, omitted, { restoredLimits });
        }
        record(elapsedMs(netStart));
        const knowledge: SectionKnowledge = {
          units: sectionUnits.map((u) => u.id),
          ideas: inspection.ideas,
          omitted,
          problems: distilOf(reply)?.problems ?? [],
          flags: inspection.flags,
          hints: inspection.hints,
          reviews: cardReviews(inspection, verdicts),
          restored: { items: restored.items.map((i) => i.value), units: restored.units, ...(restoredLimits.length ? { limits: restoredLimits } : {}) },
          // Cards spanning several nodes (a shape with its text, a label with its card): report v2 counts cards (§9 G1).
          ...(inspection.views.some((v) => v.members.length > 1) ? { cards: inspection.views.filter((v) => v.members.length > 1).map((v) => [...v.members]) } : {}),
          ...(knowledgeRetry ? { retry: knowledgeRetry } : {}),
          ...(checked ? { checked } : {}),
          needsReview: inspection.needsReview,
          exactMissing,
        };
        if (earlier?.knowledge && knowledgeIsWorse(knowledge, earlier.knowledge)) return earlier;
        if (inspection.needsReview) warnings.push(`Section "${s.label}": ${inspection.needsReview} item${inspection.needsReview === 1 ? "" : "s"} need${inspection.needsReview === 1 ? "s" : ""} review.`);
        return { ...reply, data, coverage: net.coverage, knowledge, ...(shallow ? { shallow: true as const } : {}) };
      }
      const net = await attachUncovered(reply.data, text);
      record(elapsedMs(netStart));
      if (earlier && compareCoverage(net.coverage, earlier.coverage) < 0) return earlier;
      if (net.coverage.attached) warnings.push(`Section "${s.label}": ${net.coverage.attached} of ${net.coverage.total} source points weren't in the AI's plan, so they were added from the source.`);
      return { ...reply, data: net.raw, coverage: net.coverage, ...(shallow ? { shallow: true as const } : {}) };
      },
    ),
  );
  if (timings.length) logOutlinedTiming(outlineMs, timings, elapsedMs(runStart));
  if (sections.length > 1) report(`Assembling ${sections.length} sections…`);
  // In section order (the calls run in parallel). A reused section's reply has neither a result nor a cause.
  const failed: SectionFallback[] = sections.flatMap((s, i) => (replies[i]!.cause ? [{ key: s.key, label: s.label, cause: replies[i]!.cause! }] : []));
  const keptEarlier = sections.flatMap((s, i) => (replies[i]!.keptEarlier ? [s.label] : []));
  const shallow = sections.flatMap((s, i) => (replies[i]!.shallow ? [s.label] : []));
  const fidelity = buildReport(sections.flatMap((s, i) => (replies[i]!.coverage ? [sectionOf(s.key, s.label, replies[i]!.coverage!)] : [])));
  const replyMap = new Map(
    sections.map((s, i) => {
      const r = replies[i]!;
      return [
        s.key,
        { raw: r.data, coverage: r.coverage, ...(r.cause ? { cause: r.cause } : {}), ...(r.shallow ? { shallow: true as const } : {}), ...(r.knowledge ? { knowledge: r.knowledge } : {}) },
      ] as const;
    }),
  );
  const merged = mergeUnitPlans(
    "sectioned",
    [...(title ? [{ unitKey: title.key, raw: headingOnlyReply(title, "sectioned") }] : []), ...sections.map((s, i) => ({ unitKey: s.key, raw: replies[i]!.data }))],
    idPrefix,
  );
  // Each section's takeaway (Wave B), shown under its title.
  const withTakeaways = sections.map((s, i) => {
    const takeaway = takeawayOf(replies[i]!.data);
    return takeaway ? { ...s, takeaway } : s;
  });
  const raw = wrapSections(merged, withTakeaways, {
    idPrefix,
    flat,
    // Distil runs keep the model's sub-groups (organisation v2, organisation-layout plan §3.0, §3.2); preserve is unchanged.
    ...(distil ? { organisation: organisationFor("distil") } : {}),
    titleKey: title?.key ?? null,
    // A one-section document's summary would repeat its section's takeaway, right below it.
    ...(outline.summary && sections.length > 1 ? { subtitle: outline.summary } : {}),
    // Links between frames are drawn once, on the first run; reconciliation compares sections by their titles only.
    ...(flat ? {} : { links: outline.links }),
  });
  const last = replies.flatMap((r) => (r.result ? [r.result] : [])).at(-1) ?? outlined;
  // Content that no model could analyse at all (the outline and every section failed) falls back like any other AI
  // failure — with the outline's own error, so the cause isn't hidden behind a generic one. (A regeneration reuses
  // its other sections, so it only fails when a regenerated one does.)
  if (!last && content.length && !reuse) throw outlineError ?? new AIError("invalid_output", "AI couldn't analyse any section of the document.");
  return {
    raw,
    sections,
    warnings,
    failed,
    keptEarlier,
    shallow,
    fidelity,
    outline,
    replies: replyMap,
    ...(content.length && !outlined && !reuse ? { outlineFailed: true, ...(outlineError ? { outlineCause: failureCause(outlineError) } : {}) } : {}),
    ...(last ? { provenance: { providerId: last.providerId, role: last.role, model: last.usage.model } } : {}),
    // Distil: each section's knowledge with its node ids as `mergeUnitPlans` gives them (`<prefix>u<i>_<id>`, the title first).
    ...(docUnits
      ? {
          knowledge: {
            units: docUnits,
            sections: sections.flatMap((s, i) => {
              const k = replies[i]!.knowledge;
              return k ? [{ ...prefixKnowledge(k, `${idPrefix}u${i + (title ? 1 : 0)}_`), key: s.key, label: s.label }] : [];
            }),
          },
        }
      : {}),
  };
}

/** Primary sections before supporting ones, each in the outline's own order. */
function orderByProminence<T extends { prominence?: SectionProminence }>(sections: readonly T[]): T[] {
  return [...sections.filter((s) => s.prominence !== "supporting"), ...sections.filter((s) => s.prominence === "supporting")];
}

/**
 * The sections of an outlined plan (grouped, as validated from a stored version): each group's key, label,
 * arrangement, kind and prominence, and the units its key names — for regenerating one section on an update.
 */
/**
 * A flat plan, as "Update from new content" builds it, grouped again by its sections — the shape a first run stores —
 * so the next update still knows each section's kind, prominence and parts (`sectionsOfPlan`). Each section heading
 * becomes its group, and every node of the section's namespace its member; a section's takeaway is kept from `previous`.
 */
export function regroupSections(plan: VisualPlan, sections: readonly OutlineSection[], previous?: VisualPlan): VisualPlan {
  const byKey = new Map(sections.map((s) => [s.key, s] as const));
  const takeaways = new Map(
    (previous?.nodes ?? []).flatMap((n) => (n.type === "group" && n.stableKey && n.content.takeaway ? [[n.stableKey, n.content.takeaway] as const] : [])),
  );
  const groupOf = new Map<string, string>();
  // The frame each node of the previous plan was in, by section: a node that names no section of its own (an overflow page, `foldOverflow`) is not
  // reached through its key, so it is kept in the frame it had. Without this a frame whose only member was such a page is stored empty, the next
  // read drops it as an empty frame, and the update proposes removing a frame that is still on the canvas.
  const previousFrame = new Map<string, string>();
  if (previous) {
    const sectionOfGroup = new Map(previous.nodes.flatMap((n) => (n.type === "group" && n.stableKey?.endsWith(UNIT_SECTION_SUFFIX) ? [[n.id, n.stableKey.slice(0, -UNIT_SECTION_SUFFIX.length)] as const] : [])));
    for (const n of previous.nodes) if (n.stableKey && n.parent && sectionOfGroup.has(n.parent)) previousFrame.set(n.stableKey, sectionOfGroup.get(n.parent)!);
  }
  const nodes = plan.nodes.map((n): VisualNode => {
    if (n.type !== "heading" || n.role !== "section" || !n.stableKey?.endsWith(UNIT_SECTION_SUFFIX)) return n;
    const s = byKey.get(n.stableKey.slice(0, -UNIT_SECTION_SUFFIX.length));
    if (!s) return n;
    groupOf.set(s.key, n.id);
    const takeaway = takeaways.get(n.stableKey);
    // Every other field of the heading is kept as it is, so `ungroup` gives back exactly the heading that was compared —
    // a field added here would make the next update see an untouched title as changed.
    const { type: _type, role: _role, content, ...rest } = n;
    return { ...rest, type: "group", role: s.kind, content: { label: content.text, arrangement: s.arrangement, ...(takeaway ? { takeaway } : {}) } } as VisualNode;
  });
  return {
    ...plan,
    nodes: nodes.map((n): VisualNode => {
      if (n.type === "group" || !n.stableKey || n.parent) return n;
      const unit = unitOfKey(n.stableKey);
      const group = unit === null ? groupOf.get(previousFrame.get(n.stableKey) ?? "") : groupOf.get(unit);
      return group ? ({ ...n, parent: group } as VisualNode) : n;
    }),
  };
}

export function sectionsOfPlan(plan: VisualPlan): OutlineSection[] {
  const suffix = " § group#0";
  return plan.nodes.flatMap((n): OutlineSection[] => {
    // A plan an earlier update stored flat (before sections were regrouped on update): its section headings still name the
    // sections, though not their kind.
    if (n.type === "heading" && n.role === "section" && n.stableKey?.endsWith(suffix)) {
      const key = n.stableKey.slice(0, -suffix.length);
      return [{ key, label: n.content.text, arrangement: sectionKind("notes").arrangement, kind: "notes", prominence: SECTION_PROMINENCE[0], units: unitsOfSectionKey(key) }];
    }
    if (n.type !== "group" || !n.stableKey?.endsWith(suffix)) return [];
    const key = n.stableKey.slice(0, -suffix.length);
    const kind = (SECTION_KINDS as readonly string[]).includes(n.role ?? "") ? (n.role as SectionKind) : "notes";
    const prominence: SectionProminence = n.importance === "low" ? "supporting" : SECTION_PROMINENCE[0];
    const spec: SectionSpec = { key, label: n.content.label, arrangement: n.content.arrangement };
    return [{ ...spec, arrangement: spec.arrangement ?? sectionKind(kind).arrangement, kind, prominence, units: unitsOfSectionKey(key) }];
  });
}
