/**
 * "Merge into existing notes" (topic merge plan G2, `.ai/docs/chat-share-import-plan.md` §5): new content becomes
 * part of an existing content source instead of a new one, filed under the topics it is about.
 *
 *   new content ─ parts ─ assign to the notes' topics (`assign.ts`: a model when the source is AI-tier, else local)
 *        │
 *        ▼
 *   merged text (`compose.ts`: filed under each topic, new topics appended, repeats skipped)
 *        │
 *        ▼
 *   "Update from new content" (`reconcile/update.ts`) on the merged text — unchanged topics reused with no model
 *   call, grown topics re-analysed with their current representation, new topics added as sections; objects the
 *   user edited are conflicts, as in any update.
 *
 * Everything stays one source, so no object ever belongs to two (and an update of one can't look like a user edit
 * of the other). The merged text is the source's next version.
 */
import { analyzeContent } from "@/ai/content/analyze";
import { AIError } from "@/ai/errors";
import { updateFromNewContent, type UpdateInput, type UpdateOptions, type UpdateResult } from "@/ai/reconcile/update";
import { analysisUnits, headingOnlyReply, type AnalysisUnit } from "@/ai/reconcile/units";
import type { AIRuntime } from "@/ai/runtime";
// Importing `assign.ts` also registers the `assign_to_topics` task with the task registry.
import { assignLocally, assignToTopicsDecision, topicLabel, UNSURE, validateAssignment, type AssignInput, type Assignment, type Conflict, type Topic } from "./assign";
import { parentOf, settleUnsure, type SettledHow } from "./unsure";
import { composeMerged, partBlocks, type MergeReport } from "./compose";
import { subsectionParts } from "./refine";
import { SECTION_KEY_JOINER } from "@/ai/visualize/outline";

/** `text` is the new content; everything else is the target source, as for an update. */
/** Parts per assignment call: within what the typed decision model answers (`ASSIGN_MAX_PARTS`, 30), with room to spare. */
export const ASSIGN_BATCH_PARTS = 20;

const chunk = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export type MergeInput = UpdateInput & {
  /** Where the merged content came from, as a choice's option names it; by default its first heading and today. */
  from?: { label: string; date: string };
  /**
   * Ask again, at subsection level, about a part no rule placed. Off by default: replayed on Jev (2026-10-10) it placed 36 % of tiny pieces at
   * median confidence 0.38, scattered coherent lists across topics and filed new subject matter under unrelated ones. A part that stays
   * unplaced is shown whole, as a plain card.
   */
  refineSubsections?: boolean;
  /**
   * Economy import (this import only; off by default): text appended to an existing topic is added as plain verbatim cards, with no model
   * call, instead of being analysed and linked into the topic's section. The review says which passages it applied to. Unplaced parts,
   * new topics, deduplication, provenance and conflict handling are the same either way.
   */
  economy?: boolean;
  /**
   * Topic shortlist for the typed assignment (off by default): each part's request shows a shortlist of topics (`topicIndex.ts`) instead of all
   * of them, and a part whose answer isn't a confident existing topic is asked again with the full list. Not recommended yet: see
   * `.ai/docs/topic-shortlist-plan.md` and the 2026-10-11 replay in the evidence document.
   */
  shortlist?: boolean;
};

export interface MergeResult extends UpdateResult {
  report: MergeReport;
  /** Where the topics came from: the model, or the local answer (no AI, or AI failed — then `notices` says so). */
  assignedBy: "ai" | "local";
  diagnostics: MergeDiagnostics;
}

/**
 * Who answered a merge, and what reached the review — development diagnostics (read by tests through `__acuteDev`), never
 * analytics. `answeredBy.role` is "decision" when the typed decision model (Jev) answered the merge's questions, conflicts
 * included; anything else is the chat task (no typed model, or it was unsure and the chat task took over).
 */
export interface MergeDiagnostics {
  /** Who answered the assignment; role "mixed" when its batches were answered by different models (Jev for some, the chat task for others). */
  answeredBy: { providerId: string; role: string; model: string } | null;
  /** Who answered each batch of parts, in order. */
  batches: { providerId: string; role: string; model: string }[];
  /**
   * What the merge cost and saved (for measuring it): model calls by task, the sections regenerated and reused by the update,
   * analysis-card calls, parts left out before any model call, and choices opened.
   */
  calls: { byTask: Record<string, number>; sectionsRegenerated: string[]; sectionsReused: number; analysisCalls: number; plans: { appended: number; regenerated: number; piece: number; new: number }; partsSkippedBeforeAI: number; plainCards: number; choicesOpened: number };
  /**
   * Per part sent for assignment: what the model answered (a topic's label, "new", "unsure", or "local" when no model answered it),
   * and where it was filed ("new", a topic's label, or "with <part>" when kept in another part's new topic) — for judging filing quality.
   */
  decisions: { part: string; answer: string; filed: string; settled?: SettledHow }[];
  /** Conflicts the answer named (after the word-for-word check), and the choices the merge wrote for the review. */
  /**
   * Objects the review proposes to remove (a merge should have none), each with its key and whether the same key comes back as another
   * kind of object (a replacement, not a loss) — so a removal in a real run can be traced.
   */
  removals: { key: string; replacedBy: boolean }[];
  /** Unplaced sections that did not become a plain card, with why (should be none). */
  plainMissed: { text: string; why: string }[];
  /** Economy mode: the sections whose appended text became plain cards. */
  economy: { section: string; cards: number }[];
  /** Economy mode: plan calls skipped because the plan had no room for any node they would add (`reconcile/capacity.ts`), by section and path. */
  planSkips: { section: string; path: "orphan" | "added"; units: number; cards: number }[];
  /** Economy mode: what the capacity check saw and what the plan's real overflow fold counted (`UpdateResult.capacity`). */
  capacity?: UpdateResult["capacity"];
  /** What the plan's limits folded into "More from this section" pages: per section, how many nodes and pages, and which limit. */
  overflow: { section: string; folded: number; pages: number; why: "plan limit" | "section limit" }[];
  /** Every plan call in order: its kind, the section it covered, the source characters it was given and the tokens it used (when reported). */
  planCalls: { kind: keyof MergeDiagnostics["calls"]["plans"]; section: string; sourceChars: number; inputTokens?: number; outputTokens?: number }[];
  conflictsPicked: number;
  choicesShown: number;
  ms: number;
}

/**
 * What a section plan call was for: only the paragraphs appended to a grown topic, a changed topic regenerated whole, one piece
 * of a large new section, or a new section whole.
 */
function planKind(req: unknown): keyof MergeDiagnostics["calls"]["plans"] {
  const r = (req ?? {}) as { appended?: boolean; current?: unknown; part?: unknown };
  return r.appended ? "appended" : r.current ? "regenerated" : r.part ? "piece" : "new";
}

let lastDiagnostics: MergeDiagnostics | null = null;
/** The last merge's diagnostics in this page (development and tests). */
export const lastMergeDiagnostics = (): MergeDiagnostics | null => lastDiagnostics;

export async function mergeIntoSource(input: MergeInput, given: AIRuntime, options: UpdateOptions = {}): Promise<MergeResult> {
  // Every model call this merge makes, by task (decision tasks as "decide:<task>"; a chat fallback inside one isn't seen here).
  const byTask: Record<string, number> = {};
  const planKinds: MergeDiagnostics["calls"]["plans"] = { appended: 0, regenerated: 0, piece: 0, new: 0 };
  const planCalls: MergeDiagnostics["planCalls"] = [];
  const runtime: AIRuntime = {
    run: (task, req, opts) => {
      byTask[task] = (byTask[task] ?? 0) + 1;
      if (task !== "generate_visual_plan") return given.run(task, req, opts);
      const kind = planKind(req);
      planKinds[kind]++;
      const r = (req ?? {}) as { section?: { label?: string }; text?: string };
      const call: MergeDiagnostics["planCalls"][number] = { kind, section: r.section?.label ?? "", sourceChars: r.text?.length ?? 0 };
      planCalls.push(call);
      const done = given.run<typeof req, never>(task, req, opts);
      done.then((res) => {
        call.inputTokens = res.usage.promptTokens;
        call.outputTokens = res.usage.completionTokens;
      }, () => undefined);
      return done;
    },
    decide: (def, req, opts) => {
      byTask[`decide:${def.fallbackTask}`] = (byTask[`decide:${def.fallbackTask}`] ?? 0) + 1;
      return given.decide(def, req, opts);
    },
  };
  const started = Date.now();
  let answeredBy: MergeDiagnostics["answeredBy"] = null;
  const { signal } = options;
  options.onProgress?.({ stage: "parsing", label: "Parsing…" });
  const [{ parsed }, { parsed: incomingParsed }] = await Promise.all([analyzeContent(input.previous.text, { signal }), analyzeContent(input.text, { signal })]);
  const units = analysisUnits(parsed, input.previous.text);
  const topics: Topic[] = units.filter((u) => !headingOnlyReply(u, "sectioned")).map((u) => ({ key: u.key, label: topicLabel(u.key), text: u.text }));
  const allParts = analysisUnits(incomingParsed, input.text).filter((u) => !headingOnlyReply(u, "sectioned"));
  // A part whose every block the notes already say anywhere is left out before any model call (filed nowhere, each
  // part is checked against the whole text); the rest are assigned and composed as usual.
  const unfiledRun = composeMerged({ text: input.previous.text, parsed, units, incoming: input.text, incomingParsed, parts: allParts, assignment: new Map() });
  const unfiled = unfiledRun.report;
  const repeated = new Set(unfiled.skippedParts);
  let parts = allParts.filter((p) => !repeated.has(p.key));

  const notices: string[] = [];
  const local = assignLocally(topics, parts);
  let assignment = local;
  /** Parts the model couldn't place: kept with the section around them (`settleUnsure`), never made new topics for that reason alone. */
  const unsure = new Set<string>();
  let attach = new Map<string, string>();
  let settledHow = new Map<string, SettledHow>();
  /** Parts no rule could place: kept whole as sections of their own, named in the review (`unsure.ts` rule 6). */
  let unplaced = new Set<string>();
  /** Unplaced parts asked about again at subsection level (`refine.ts`): the parts, and the pieces that replaced them. */
  const refinedFrom: string[] = [];
  const pieces: AnalysisUnit[] = [];
  /** What the model itself answered, per part it answered (a topic key, or null for new). */
  const modelAnswered = new Map<string, string | null>();
  let assignedBy: MergeResult["assignedBy"] = "local";
  let nothingNew = new Set<string>();
  const conflicts = new Map<string, Conflict[]>();
  /** Who answered each batch of the assignment (diagnostics). */
  const answered: NonNullable<MergeDiagnostics["answeredBy"]>[] = [];
  if (input.source.tier === "ai" && topics.length && parts.length) {
    options.onProgress?.({ stage: "analyzing", label: "Finding where the new content belongs…" });
    const topicList = topics.map((t) => ({ key: t.key, label: t.label, text: t.text }));
    /**
     * Asks the model where `asked` belongs, in batches of parts answered in parallel: a long import (a real chat gave ~50 parts, an
     * 85,000-character prompt) stays within what the typed decision model answers (`ASSIGN_MAX_PARTS`), and each part gets more of the
     * prompt (`partExcerptLength`). A batch AI couldn't answer keeps `fallback` for its parts.
     */
    const ask = async (asked: AssignInput["parts"], fallback: Assignment) => {
      const batches = chunk(asked, ASSIGN_BATCH_PARTS).map((ps): AssignInput => ({ topics: topicList, parts: ps, ...(input.shortlist ? { shortlist: true } : {}) }));
      const results = await Promise.allSettled(batches.map((b) => runtime.decide<AssignInput, unknown>(assignToTopicsDecision, b, { signal })));
      if (signal?.aborted) throw new DOMException("Merge was cancelled.", "AbortError");
      const got = { assignment: fallback, answered: new Map<string, string | null>(), unsure: new Set<string>(), nothingNew: new Set<string>(), conflicts: new Map<string, Conflict[]>(), failed: false, succeeded: 0 };
      results.forEach((s, i) => {
        if (s.status === "rejected") {
          if (s.reason instanceof AIError && s.reason.kind === "cancelled") throw s.reason;
          got.failed = true;
          return;
        }
        got.succeeded++;
        const checked = validateAssignment(s.value.data, batches[i]!, got.assignment);
        for (const k of checked.answered) got.answered.set(k, checked.assignment.get(k) ?? null);
        got.assignment = checked.assignment;
        for (const k of checked.nothingNew) got.nothingNew.add(k);
        for (const [k, c] of checked.conflicts) got.conflicts.set(k, c);
        for (const k of checked.unsure) got.unsure.add(k);
        answered.push({ providerId: s.value.providerId, role: s.value.role, model: s.value.usage.model });
      });
      return got;
    };
    // The model sees only what is new in each part (its heading, then the blocks the notes don't already say), so a
    // passage another topic already holds can't pull the part there. Each with the headings it sits under in its own
    // document: a leaf fragment ("Free") is decided in context ("Pricing › Free").
    const first = await ask(
      parts.map((p) => {
        const under = parentOf(p.key);
        return { key: p.key, text: [...headingOf(p), ...(unfiledRun.kept[p.key] ?? [])].join("\n\n") || p.text, ...(under ? { context: under } : {}) };
      }),
      assignment,
    );
    assignment = first.assignment;
    for (const [k, t] of first.answered) modelAnswered.set(k, t);
    nothingNew = first.nothingNew;
    for (const [k, c] of first.conflicts) conflicts.set(k, c);
    for (const k of first.unsure) unsure.add(k);
    // A batch AI couldn't answer keeps the local answer (headings and wording) for its parts — said once, never silently.
    if (first.failed) notices.push(first.succeeded ? "AI couldn't sort some of the new content into your topics, so those parts were matched by headings and wording instead." : "AI couldn't sort the new content into your topics, so it was matched by headings and wording instead.");
    // A part the model judged to add nothing to its topic is left out — and named in the review, never dropped silently.
    parts = parts.filter((p) => !nothingNew.has(p.key));
    if (unsure.size) {
      ({ assignment, attach, how: settledHow, unplaced } = settleUnsure(parts, assignment, unsure, local));
      // (a) A part no rule placed, with subsections: ask about each subsection. Not a part others joined (they follow its section).
      const anchors = new Set(attach.values());
      const splits = parts.flatMap((p) => {
        const subs = input.refineSubsections && settledHow.get(p.key) === "unplaced" && !anchors.has(p.key) ? subsectionParts(incomingParsed, input.text, p) : null;
        return subs ? [{ part: p, subs }] : [];
      });
      if (splits.length) {
        const subParts = splits.flatMap((s) => s.subs);
        const second = await ask(subParts.map((p) => ({ key: p.key, text: p.text, context: parentOf(p.key) ?? undefined })), assignLocally(topics, subParts));
        for (const { part, subs } of splits) {
          const sure = subs.filter((s) => second.answered.has(s.key));
          if (!sure.length) continue; // nothing came of it: the part stays unplaced, whole
          refinedFrom.push(part.key);
          pieces.push(...subs);
          parts = parts.flatMap((p) => (p.key === part.key ? subs : [p]));
          unsure.delete(part.key);
          settledHow.delete(part.key);
          unplaced.delete(part.key);
          for (const s of sure) {
            assignment.set(s.key, second.answered.get(s.key) ?? null);
            modelAnswered.set(s.key, second.answered.get(s.key) ?? null);
            settledHow.set(s.key, "refined");
            if (second.nothingNew.has(s.key)) nothingNew.add(s.key);
            if (second.conflicts.has(s.key)) conflicts.set(s.key, second.conflicts.get(s.key)!);
          }
          // The subsections AI still can't place stay together, as one unplaced section named after the first.
          const rest = subs.filter((s) => !second.answered.has(s.key));
          rest.forEach((s, i) => {
            unsure.add(s.key);
            assignment.set(s.key, null);
            unplaced.add(s.key);
            if (i === 0) settledHow.set(s.key, "unplaced");
            else {
              attach.set(s.key, rest[0]!.key);
              settledHow.set(s.key, "grouped");
            }
          });
        }
        parts = parts.filter((p) => !nothingNew.has(p.key));
      }
    }
    if (answered.length) assignedBy = "ai";
    answeredBy = answered.length ? (answered.every((a) => a.role === answered[0]!.role) ? answered[0]! : { ...answered[0]!, role: "mixed" }) : null;
  }

  const from = input.from ?? { label: contentLabel(input.text), date: new Date().toISOString().slice(0, 10) };
  const composed = composeMerged({ text: input.previous.text, parsed, units, incoming: input.text, incomingParsed, parts, assignment, conflicts, from, attach, unplaced });
  // The parts left out up front count as skipped, with all their blocks.
  const repeatedBlocks = allParts.filter((p) => repeated.has(p.key)).reduce((n, p) => n + partBlocks(input.text, incomingParsed, p).length, 0);
  const report: MergeReport = {
    ...composed.report,
    skippedBlocks: composed.report.skippedBlocks + repeatedBlocks,
    skippedParts: [...repeated, ...composed.report.skippedParts],
    nothingNew: [...new Set([...allParts, ...pieces].filter((p) => nothingNew.has(p.key)).map((p) => p.key))],
    // Kept by a rule (with the section around them); the ones no rule could place are `unplaced`, the ones placed by their subsections `refined`.
    unsure: parts.filter((p) => unsure.has(p.key) && !unplaced.has(p.key)).map((p) => p.key),
    refined: refinedFrom,
  };
  // A merge only adds text: what is on the canvas stays, and nothing already there is drawn again (`appendOnly.ts`).
  const result = await updateFromNewContent({ ...input, text: composed.text }, runtime, { ...options, appendOnly: true, plainUnits: new Set(composed.unplacedTexts), plainSpans: composed.unplacedSpans, economy: input.economy === true });
  // Economy mode: the parts filed into a topic whose section got plain cards, not a plan.
  const economized = new Set(result.economy.flatMap((e) => e.section.split(SECTION_KEY_JOINER)));
  report.economy = Object.entries(report.mergedInto).filter(([topic]) => economized.has(topic)).flatMap(([, ps]) => ps);
  report.planSkipped = result.planSkips.flatMap((s) => s.section.split(SECTION_KEY_JOINER));
  const calls: MergeDiagnostics["calls"] = {
    byTask,
    sectionsRegenerated: result.reanalyzedUnits,
    sectionsReused: result.reusedUnits.length,
    analysisCalls: byTask.generate_section_analysis ?? 0,
    plans: planKinds,
    partsSkippedBeforeAI: repeated.size,
    plainCards: result.plainCards.length,
    choicesOpened: report.choices.length,
  };
  const label = (topic: string | null | undefined) => (topic ? topicLabel(topic) : "new");
  const decisions = parts.map((p) => ({
    part: p.key,
    answer: unsure.has(p.key) ? UNSURE : modelAnswered.has(p.key) ? label(modelAnswered.get(p.key)) : "local",
    filed: attach.has(p.key) ? `with ${attach.get(p.key)}` : unplaced.has(p.key) ? "unplaced" : label(assignment.get(p.key)),
    ...(settledHow.has(p.key) ? { settled: settledHow.get(p.key)! } : {}),
  }));
  const diagnostics: MergeDiagnostics = { answeredBy, batches: answered, calls, decisions, removals: result.removals, plainMissed: result.plainMissed, economy: result.economy, planSkips: result.planSkips, ...(result.capacity ? { capacity: result.capacity } : {}), overflow: result.overflow, planCalls, conflictsPicked: [...conflicts.values()].reduce((n, c) => n + c.length, 0), choicesShown: report.choices.length, ms: Date.now() - started };
  lastDiagnostics = diagnostics;
  return { ...result, notices: [...notices, ...mergeNotices(report, result.changeSet !== null), ...result.notices], report, assignedBy, diagnostics };
}

/**
 * What the merge did, in words the review shows as is. With nothing to change on the canvas (`changed` false) the
 * notes already say it all — repeated word for word, or in other words the model found nothing new in — whatever the
 * text filed: nothing was added, so the summary never claims it was.
 */
export function mergeNotices(report: MergeReport, changed = true): string[] {
  const into = Object.keys(report.mergedInto).length;
  const elsewhere = report.repeatedElsewhere ? ` (${report.repeatedElsewhere} of them under another topic)` : "";
  const parts = [
    into ? `added to ${into} existing ${into === 1 ? "topic" : "topics"}` : "",
    report.newTopics.length ? `${report.newTopics.length} new ${report.newTopics.length === 1 ? "topic" : "topics"}` : "",
    report.unplaced.length ? `${report.unplaced.length} ${report.unplaced.length === 1 ? "passage" : "passages"} left unplaced` : "",
    report.skippedBlocks ? `${report.skippedBlocks} ${report.skippedBlocks === 1 ? "passage" : "passages"} already in your notes left out${elsewhere}` : "",
  ].filter(Boolean);
  const others = [...choiceNotices(report), ...extendedNotices(report), ...nothingNewNotices(report), ...economyNotices(report), ...planSkippedNotices(report), ...refinedNotices(report), ...unsureNotices(report), ...unplacedNotices(report), ...overlapNotices(report)];
  if (!parts.length) return report.nothingNew.length && !changed ? ["Everything in this content is already in your notes.", ...others] : others;
  if (!changed || (!into && !report.newTopics.length && !report.unplaced.length)) return ["Everything in this content is already in your notes.", ...others];
  return [`Merged: ${parts.join(", ")}.`, ...others];
}

/** Choices this content touched: another view added to an open one, or one the user made reopened — never decided for them. */
function extendedNotices(report: MergeReport): string[] {
  const names = (titles: string[]) => [...new Set(titles)].map((t) => `“${t}”`).join(", ");
  return [
    ...(report.extended.length ? [`This content adds another option to ${names(report.extended)}, already waiting for your call.`] : []),
    ...(report.reopened.length ? [`This content disagrees with your earlier choice in ${names(report.reopened)}, so it is open again: your choice is marked, and nothing was changed until you choose.`] : []),
  ];
}

/** What the merged content contradicts: shown as a choice to make, never decided for the user. */
function choiceNotices(report: MergeReport): string[] {
  if (!report.choices.length) return [];
  const n = report.choices.length;
  return [`${n === 1 ? "One thing" : `${n} things`} this content and your notes disagree about ${n === 1 ? "is" : "are"} shown as “Needs your call”: ${report.choices.map((c) => `“${c}”`).join(", ")}. Select an option and choose “Use this option”.`];
}

/** Parts AI judged to say nothing their topic doesn't (in other words): left out, and said so by name. */
function nothingNewNotices(report: MergeReport): string[] {
  if (!report.nothingNew.length) return [];
  const names = report.nothingNew.map((k) => `“${topicLabel(k)}”`).join(", ");
  return [`Left out ${names}: AI found nothing in ${report.nothingNew.length === 1 ? "it" : "them"} that your notes don't already say.`];
}

/** Parts AI couldn't place, kept by a rule (with the section around them, or the part before them): said so, so the user can check them in the review. */
function unsureNotices(report: MergeReport): string[] {
  if (!report.unsure.length) return [];
  const names = report.unsure.slice(0, 4).map((k) => `“${topicLabel(k)}”`).join(", ") + (report.unsure.length > 4 ? ", …" : "");
  const n = report.unsure.length;
  return [`AI couldn't tell where ${n === 1 ? "one passage" : `${n} passages`} belong${n === 1 ? "s" : ""} (${names}): ${n === 1 ? "it was" : "they were"} kept with the section around ${n === 1 ? "it" : "them"}. Check ${n === 1 ? "it" : "them"} in the review.`];
}

/**
 * Economy mode (opt-in, per import): passages added to an existing topic as plain verbatim cards, with no model call. Said plainly, with
 * the mode named, so nobody takes them for analysed content.
 */
function economyNotices(report: MergeReport): string[] {
  if (!report.economy.length) return [];
  const n = report.economy.length;
  const names = report.economy.slice(0, 6).map((k) => `“${topicLabel(k)}”`).join(", ") + (n > 6 ? `, and ${n - 6} more` : "");
  return [
    `Economy import: ${n === 1 ? "one passage was" : `${n} passages were`} added to existing topics as plain verbatim cards and ${n === 1 ? "was" : "were"} not analysed by AI — no links or analysis were drawn for ${n === 1 ? "it" : "them"} (${names}). Run the import without economy mode to have AI analyse ${n === 1 ? "it" : "them"}.`,
  ];
}

/**
 * Economy mode, no room left: sections AI planning was skipped for. Said apart from the economy cards (a choice the user made): here the full plan decided,
 * so running again without economy mode would only have the model plan nodes that fold into the same pages.
 */
function planSkippedNotices(report: MergeReport): string[] {
  const skipped = report.planSkipped ?? [];
  if (!skipped.length) return [];
  const n = skipped.length;
  const names = skipped.slice(0, 6).map((k) => `“${topicLabel(k)}”`).join(", ") + (n > 6 ? `, and ${n - 6} more` : "");
  return [
    `The plan's 300-node limit is full, so AI was not asked to plan ${n === 1 ? "one section" : `${n} sections`} (${names}): whatever it planned would have been folded into “More from this section” pages. ${n === 1 ? "Its" : "Their"} text was added as it is, in order, to ${n === 1 ? "that page" : "those pages"}, without analysis or links.`,
  ];
}

/** Parts AI couldn't place as a whole but could by their subsections. */
function refinedNotices(report: MergeReport): string[] {
  if (!report.refined.length) return [];
  const n = report.refined.length;
  const names = report.refined.slice(0, 4).map((k) => `“${topicLabel(k)}”`).join(", ") + (n > 4 ? ", …" : "");
  return [`AI couldn't place ${n === 1 ? "one section" : `${n} sections`} as a whole (${names}), so ${n === 1 ? "its" : "their"} subsections were placed one by one. Check ${n === 1 ? "it" : "them"} in the review.`];
}

/**
 * Parts AI couldn't place and no rule could: how many, which, and where they are. Their text is kept in full — only their topic is
 * undecided — as plain cards (no model call) at the end of the notes, for the user to move or merge.
 */
function unplacedNotices(report: MergeReport): string[] {
  if (!report.unplaced.length) return [];
  const n = report.unplaced.length;
  const shown = report.unplaced.slice(0, 6).map((k) => `“${topicLabel(k)}”`).join(", ");
  const more = n > 6 ? `, and ${n - 6} more` : "";
  const [it, they, its, them] = n === 1 ? ["It is", "it", "its", "it"] : ["They are", "they", "their", "them"];
  return [`AI couldn't place ${n === 1 ? "one passage" : `${n} passages`} in your topics (${shown}${more}). ${it} kept in full, each as a plain card under ${its} own heading at the end of your notes (not analysed by AI, not filed under any topic): move ${them} where ${they} belong, or leave ${them} as ${n === 1 ? "a card" : "cards"} of ${n === 1 ? "its" : "their"} own.`];
}

/** Topics of the notes that already say the same thing: pointed out, never changed (which one keeps it is the user's call). */
function overlapNotices(report: MergeReport): string[] {
  return report.overlaps.map(
    (o) => `“${topicLabel(o.topics[0])}” and “${topicLabel(o.topics[1])}” already say the same thing (${o.passages} ${o.passages === 1 ? "passage" : "passages"}); you may want to keep it in one of them.`,
  );
}

/** A part's own heading line, if it starts with one: kept above its new blocks so the model still sees what it's about. */
function headingOf(part: AnalysisUnit): string[] {
  const first = part.text.split("\n", 1)[0] ?? "";
  return /^#{1,6}\s/.test(first) ? [first] : [];
}

/** What merged content is called in a choice: its first heading, else its first line, else "the merged content". */
function contentLabel(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => /^#{1,6}\s/.test(l)) ?? lines[0] ?? "";
  const plain = first.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").trim();
  return plain ? (plain.length > 50 ? `${plain.slice(0, 49)}…` : plain) : "the merged content";
}
