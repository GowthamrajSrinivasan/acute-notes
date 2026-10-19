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
import { expandSourceRefs, numberSource } from "@/ai/fidelity/sourceBlocks";
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
import type { GenerateVisualPlanInput } from "./tasks";
import { applyAnalysisPatch, needsFullRegeneration, nodeSummaries, type AnalysisPatchInput } from "./analysisPatch";
import { mergePieceReplies, splitIntoPieces } from "./pieces";
import { elapsedMs, logOutlinedTiming, startTimer, type SectionTiming } from "./timing";

export const isHeadingOnly = (u: AnalysisUnit) => headingOnlyReply(u, "sectioned") !== null;

/** A section's text: its units' own text, in document order. */
export function sectionText(section: { units: readonly string[] }, units: readonly AnalysisUnit[]): string {
  const byKey = new Map(units.map((u) => [u.key, u.text] as const));
  return section.units.map((k) => byKey.get(k) ?? "").filter(Boolean).join("\n\n");
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
}

/** A section's reply as the plan used it (after the safety net), and its coverage (null for a failed section). */
export interface SectionReply {
  raw: unknown;
  coverage: SectionCoverage | null;
  /** Why AI couldn't produce this section (it shows its own structure). */
  cause?: string;
  /** The analysis check failed twice: the plan only restates the section (Wave B). */
  shallow?: true;
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
): Promise<unknown | null> {
  try {
    const takeaway = takeawayOf(data);
    const input: AnalysisPatchInput = { label: section.label, kind: section.kind, text, missing: [...missing], nodes: nodeSummaries(data), ...(takeaway ? { takeaway } : {}) };
    const r = await runtime.run<AnalysisPatchInput, unknown>("generate_section_analysis", input, { signal });
    const merged = applyAnalysisPatch(data, r.data, missing);
    return merged ? cutUnstatedBenefits(merged, text) : null;
  } catch (err) {
    if (isFatalAIError(err)) throw err;
    console.warn(`[acute-notes] Visualize: the analysis of section "${section.label}" couldn't be completed on its own (${failureCause(err)}); regenerating the section`);
    return null;
  }
}

/** Runs the outlined path over `units` (in document order): one outline call, then one generation per section. */
export async function visualizeOutlined(units: readonly AnalysisUnit[], runtime: AIRuntime, options: OutlinedOptions = {}): Promise<OutlinedResult> {
  const { signal, idPrefix = "", flat = false, reuse } = options;
  const runStart = startTimer();
  const timings: SectionTiming[] = [];
  const report = (label: string) => options.onProgress?.(label);
  const title = units[0] && isHeadingOnly(units[0]) ? units[0] : null;
  const content = units.filter((u) => !isHeadingOnly(u));
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
      async (s): Promise<{ data: unknown; result: AIRuntimeResult<unknown> | null; cause?: string; coverage: SectionCoverage | null; keptEarlier?: true; shallow?: true }> => {
      const previous = reuse?.replies.get(s.key);
      const retry = reuse?.retry.get(s.key);
      if (previous && !retry) {
        return { data: previous.raw, result: null, coverage: previous.coverage, ...(previous.cause ? { cause: previous.cause } : {}), ...(previous.shallow ? { shallow: true as const } : {}) };
      }
      const sectionStart = startTimer();
      const text = sectionText(s, units);
      // Numbered block by block, so the model can place a block by reference instead of retyping it (Wave B1).
      const source = await numberSource(text).catch(() => null);
      const items = source ? itemIds(source.blocks) : [];
      // A whole document in one section, longer than a note: the visual is the point, so text alone isn't enough.
      const check = { needsStructure: sections.length === 1 && text.trim().length > SHORT_SOURCE_CHARS && s.kind !== "supporting" };
      const input: GenerateVisualPlanInput = {
        template: "sectioned",
        text,
        section: { label: s.label, kind: s.kind },
        ...(retry?.length ? { retry: { missing: [...retry] } } : {}),
        ...(source?.blocks.length ? { numbered: source.numbered } : {}),
      };
      /** One generation, with its references expanded and its shortened tables repaired, before anything reads it. */
      const generate = async (extra: Partial<GenerateVisualPlanInput> = {}) => {
        const r = await generateSection(runtime, { ...input, ...extra }, warnings, signal);
        if (!r.result) return r;
        // A generic benefit the section never states ("…, improving accuracy") is cut from its takeaway and analysis.
        const data = cutUnstatedBenefits(r.data, text);
        if (!source) return { ...r, data };
        const x = expandSourceRefs(data, source.blocks);
        if (x.unknown.length) warnings.push(`Section "${s.label}": AI referred to blocks that don't exist (${x.unknown.join(", ")}); the safety net restores what's missing.`);
        return { ...r, data: x.raw };
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
            const numbered = await numberSource(pieceText).catch(() => null);
            const r = await generateSection(
              runtime,
              {
                template: "sectioned",
                text: pieceText,
                section: { label: s.label, kind: s.kind },
                part: { index: i + 1, total: pieceTexts.length },
                ...(own?.length ? { retry: { missing: [...own] } } : {}),
                ...(numbered?.blocks.length ? { numbered: numbered.numbered } : {}),
              },
              warnings,
              signal,
            );
            if (!r.result) return r;
            const data = cutUnstatedBenefits(r.data, pieceText);
            if (!numbered) return { ...r, data };
            const x = expandSourceRefs(data, numbered.blocks);
            if (x.unknown.length) warnings.push(`Section "${s.label}" (part ${i + 1}): AI referred to blocks that don't exist (${x.unknown.join(", ")}); the safety net restores what's missing.`);
            return { ...r, data: x.raw };
          }),
        );
        const done = parts.filter((p) => p.result);
        // Every piece failed: the section shows its own structure, as a section that failed whole does.
        if (!done.length) return { data: await sectionFallbackReply(text, s.label), result: null, cause: parts[0]?.cause };
        if (done.length < parts.length) warnings.push(`Section "${s.label}": ${parts.length - done.length} of ${parts.length} parts couldn't be analysed, so their own structure is shown.`);
        return { data: mergePieceReplies(parts.map((p) => p.data)), result: done[done.length - 1]!.result, cause: undefined as string | undefined };
      };
      let reply = await generateWhole();
      const generateMs = elapsedMs(sectionStart);
      let retryTiming: SectionTiming["retry"];
      // The analysis check (Wave B): a plan with no takeaway, no analysis of its own, or (item by item) an analysis
      // that skips most of the items the source names, is generated once more, told what it lacked; the retry is
      // kept when it lacks less. Still lacking after that: reported, never hidden.
      let shallow = false;
      if (reply.result) {
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
      // places less of the source (then fewer key terms). A section that had fallen back has nothing to lose.
      const earlier = retry && previous?.coverage ? { data: previous.raw, result: null, coverage: previous.coverage, keptEarlier: true as const } : null;
      // The content safety net: whatever of the section the model's plan leaves out is attached to it, verbatim.
      // (A failed section already shows its own structure, so it needs none.)
      const record = (netMs: number) => timings.push({ label: s.label, chars: text.length, ...(pieceTexts.length > 1 ? { pieces: pieceTexts.length } : {}), generateMs, ...(retryTiming ? { retry: retryTiming } : {}), netMs, totalMs: elapsedMs(sectionStart) });
      if (!reply.result) {
        record(0);
        return earlier ?? { ...reply, coverage: null };
      }
      const netStart = startTimer();
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
      return [s.key, { raw: r.data, coverage: r.coverage, ...(r.cause ? { cause: r.cause } : {}), ...(r.shallow ? { shallow: true as const } : {}) }] as const;
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
