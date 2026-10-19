/**
 * "Update from new content" (F38, PRD §13.15.19): reconcile a content source's
 * new text with what its last accepted version already put on the canvas.
 *
 *   new text ─ parse (F28, worker)
 *     │
 *     ├─ local tier: re-plan the whole text deterministically (no model, so
 *     │   no wording drift) — keys are structural, unchanged parts match as is;
 *     │   a new paragraph in an existing section is split out as a linked
 *     │   explanation of it (F38b, `paragraphs.ts`)
 *     └─ AI tier: diff analysis units against the previous version's text;
 *         unchanged units reuse the previous plan's nodes with NO model call;
 *         only changed/new units go to `generate_visual_plan` (same template),
 *         each WITH its current representation (F38b, `preserve.ts`): the
 *         model reports conceptual changes, and nodes it marks unchanged are
 *         restored verbatim, so a rewording changes nothing on the canvas
 *     │
 *   validate (F29) → reconcile (classify.ts) against the source's objects
 *     │
 *   a change set for F19 review: adds (rendered by F30; a new explanation of
 *   an existing object is placed below it and linked `explained_by`), clean
 *   updates, proposed removals, rewired connectors (this source's own arrows
 *   only), and conflicts (never in "Accept all"); plus the next
 *   ContentSourceVersion, recorded only if accepted. Nothing to change gives
 *   no change set at all.
 *
 * Renderer-agnostic: the caller gathers the source's existing objects and
 * the canvas context; nothing here touches React, Excalidraw or BlockNote.
 * Cancellable end to end.
 */
import type { ChangeSet, ConflictItem, ProposedChange } from "@/ai/changes/changeSet";
import { analyzeContent } from "@/ai/content/analyze";
import { AIError } from "@/ai/errors";
import { loadDefaultParser, renderVisualPlan, type Box, type RenderContext } from "@/ai/renderer/render";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import { NO_PROVIDER_CONFIGURED_MESSAGE, type AIRuntime, type ProviderRole } from "@/ai/runtime";
import { templateFor, type LayoutStrategyId } from "@/ai/visual-plan/templates";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { OverflowDetail } from "@/ai/visual-plan/repair";
import { arrangementFor, groupByUnit, OUTLINE_UNIT, ungroup, UNIT_SECTION_SUFFIX, withoutUnitSections, wrapSections } from "@/ai/visual-plan/groups";
import { frameName, sectionKind } from "@/ai/visual-plan/sectionKinds";
import { generateSection, isHeadingOnly, regroupSections, sectionsOfPlan, sectionText, visualizeOutlined } from "@/ai/visualize/outlined";
import { SECTION_KEY_JOINER, unitsOfSectionKey, type OutlineSection } from "@/ai/visualize/outline";
import type { VisualNode, VisualPlan, VisualTemplate } from "@/ai/visual-plan/types";
import type { GenerateVisualPlanInput } from "@/ai/visualize/tasks";
import { NoProviderConfiguredError, NothingToVisualizeLocallyError, type VisualizeProgress } from "@/ai/visualize/types";
import { provenanceMetadata } from "@/ai/visualize/visualize";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";
import { reconcile, reviewItems, type ExistingObject, type ReconciliationPlan } from "./classify";
import type { ExistingConnection } from "./existing";
import { ensureStableKeys, mergeUnitPlans, unitOfKey } from "./keys";
import { numberAppended, resolveAppendedRefs } from "./appendedRefs";
import { everyAddedNodeFolds, planIsFull, type CapacityCheck } from "./capacity";
import { appendedParagraphs, paragraphChanges, splitExpansions } from "./paragraphs";
import { expandUnchanged, representationOf, typeExplanations, withCurrentKept, type UnitRepresentation } from "./preserve";
import { nodeFingerprint, nodeKind, updateChange } from "./nodes";
import { sectionOfNode } from "./sections";
import { analysisUnits, headingOnlyReply, normalizeUnitText, type AnalysisUnit } from "./units";
import { nextPathIds, rekey, rekeyPlan, type PathIds } from "./topicIds";
import { appendOnly } from "./appendOnly";
import { economyCards, plainCards, plainReply, plainRuns, plainRunsBySpans } from "./plainCards";
import { withoutChoices } from "@/ai/history/choices";
import { detectRevisions, withoutRevised, type Revision } from "@/ai/history/revisions";
import { verbatim } from "@/ai/merge/assign";
import { choicesInText, withChoiceNodes } from "@/ai/history/choiceNodes";
import type { ParsedContent } from "@/ai/content/types";

export interface UpdateInput {
  source: ContentSource;
  previous: ContentSourceVersion;
  text: string;
  existing: readonly ExistingObject[];
  /** Connectors this source drew (`existingConnections`); without them, links are only ever added, never rewired. */
  connections?: readonly ExistingConnection[];
  operationId: string;
  title: string;
  /**
   * Where new objects are placed: next to the existing object they belong to (or beside the source's objects, `anchor`),
   * clear of everything else. With `objects`, room may be made next to that object by moving what is in the way (F41).
   */
  context: RenderContext;
}

export interface UpdateOptions {
  signal?: AbortSignal;
  onProgress?: (progress: VisualizeProgress) => void;
  parseMarkdown?: ParseMarkdown;
  /** A merge (G2): the new plan may add and extend, never remove or restate (`appendOnly.ts`). */
  appendOnly?: boolean;
  /**
   * Plain cards (`plainCards.ts`): new sections whose text (as `normalizeUnitText` has it) is in this set are shown verbatim as one card
   * each, with no outline, plan or analysis call. A merge's unplaced parts (`merge/unsure.ts`).
   */
  plainUnits?: ReadonlySet<string>;
  /**
   * Where those sections sit in `text` (offsets): the units inside a span are that section, found by position, so a card never depends on
   * the unit's text matching the merge's. Used only when the update reads `text` as it is (no choice callouts or revisions taken out).
   */
  plainSpans?: readonly { start: number; end: number }[];
  /**
   * Economy mode (a merge opted into it): text appended to an existing section is added as plain verbatim cards, with no model call
   * (`economyCards`). Off by default; the section keeps every node it has.
   */
  economy?: boolean;
  /**
   * "Re-visualize with AI" on a selection: the keys of the sections (units, for a template source) to analyse again from their own text, exactly as
   * a first run does — with no earlier representation to keep. Every other section is reused as it is, so the update can only touch these.
   */
  regenerate?: readonly string[];
}

export interface UpdateResult {
  /** Null when nothing changed: no review at all. */
  changeSet: ChangeSet | null;
  reconciliation: ReconciliationPlan;
  /** Units sent to the model (AI tier only) and units reused unchanged — for the test that only changed spans are re-analysed. */
  reanalyzedUnits: string[];
  /** Sections shown as plain cards (`plainCards.ts`): neither analysed nor reused, no model call. */
  plainCards: string[];
  /** Unplaced sections that did not become a card, with why (should be none): the first 60 characters of each. */
  plainMissed: { text: string; why: string }[];
  /** Sections whose appended text was added as plain cards by economy mode: the section key and how many cards. */
  economy: { section: string; cards: number }[];
  /**
   * Economy mode only: plan calls skipped because the plan had no room left (every node added would fold into a "More from this section" page,
   * `capacity.ts`). `orphan`: a grown section of the notes that no stored section holds, its appended paragraphs added as cards; `added`: a new
   * section, its text added verbatim.
   */
  planSkips: { section: string; path: "orphan" | "added"; units: number; cards: number }[];
  /**
   * Economy merges: what the capacity check saw (`capacity.ts`), for judging it against what happened. `retained` and the sections list are the nodes it
   * was given; `actualCounted` is what the plan's real overflow fold then counted as existing, so `actualCounted` minus `counted` is what the check could
   * not know (the changed sections' own nodes that were regenerated, their re-made titles, and anything else the fold counted). Absent when the check was
   * not asked (not an economy merge, or an update that is not append-only).
   */
  capacity?: CapacityCheck & {
    reusedNodes: number;
    /** Each changed section: its stored nodes, whether the check counted them, and why. (At most 40.) */
    sections: { section: string; nodes: number; counted: boolean; why: string }[];
    /**
     * Every orphan (a changed section with no stored nodes of its own, whose earlier text a page holds): was it a pure append (the only kind that can be
     * skipped), was it held back until the other replies were in, and what became of it: `skipped` (no plan call, decided before any reply),
     * `skipped_after_hold` (held, then the plan was full), `planned` (asked at once), `planned_after_hold` (held, then the plan had room or was not
     * known to be full). Present only with this record; empty when there is no orphan.
     */
    orphans: { section: string; pureAppend: boolean; held: boolean; outcome: "skipped" | "skipped_after_hold" | "planned" | "planned_after_hold" }[];
    /** What the plan was expected to hold once the regenerated sections reply: the first count plus their previous nodes. Absent when the first check was not judged. */
    orphanExpectation?: number;
    /**
     * Present only when orphans were held back (it needs a pure-append orphan, a regenerated section outstanding and `orphanExpectation` at the cap):
     * how many, how long they waited (until the other replies were in and the plan checked), and the check made then (`answer` `folds`: the held
     * orphans were skipped; anything else: they were planned).
     */
    hold?: { held: number; expectation: number; heldMs: number; answer: "folds" | "room" | "unsupported"; check?: CapacityCheck & { planned: number } };
    /**
     * Whether the second check ran, as a stable value: `asked` (see `afterReplies`), `not_needed_first_answer_full` (the first check already said full),
     * `not_needed_no_new_sections` (nothing new was to be planned), `not_applicable` (new sections, but no changed section or title whose reply could
     * change the count). A merge that is not economy and append-only has no `capacity` record at all, so no status either.
     */
    recheck: "asked" | "not_needed_first_answer_full" | "not_needed_no_new_sections" | "not_applicable";
    /**
     * Present only when the recheck was executed (`recheck` is `asked`), never otherwise: absent means it did not run, not that it passed.
     * The same question asked again once the changed sections' replies were in (only when new sections were to be planned and the first answer
     * was not already "folds"): the plan so far, validated as the merge validates it, with one probe. `planned` is how many nodes it held.
     */
    afterReplies?: CapacityCheck & { planned: number };
    /** The previous titles of the sections whose nodes the check counted (they are in `retained`). */
    titlesCounted: number;
    changedTitles: number;
    actualCounted?: number;
  };
  /** What the plan's node limits folded into "More from this section" pages: one entry per section that overflowed. */
  overflow: OverflowDetail[];
  /** Objects the review proposes to remove (none in a merge), each with whether the same key comes back as another kind of object. */
  removals: { key: string; replacedBy: boolean }[];
  reusedUnits: string[];
  warnings: string[];
  /** Shown to the user as is: blocks they split (F42 Phase 4) that the source has changed since; the split was kept. */
  notices: string[];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Update was cancelled.", "AbortError");
}

export async function updateFromNewContent(original: UpdateInput, runtime: AIRuntime, options: UpdateOptions = {}): Promise<UpdateResult> {
  const { signal, onProgress } = options;
  onProgress?.({ stage: "parsing", label: "Parsing…" });
  // Choices (G3) are drawn by code: an AI-tier source is analysed — by the model, the change check and the safety net —
  // without its `[!choice]` callouts, which are redrawn from the full text once the plan is built. The version keeps
  // the full text.
  const ai = original.source.tier === "ai";
  const unchosen: UpdateInput = ai ? { ...original, text: withoutChoices(original.text), previous: { ...original.previous, text: withoutChoices(original.previous.text) } } : original;
  // Where the text changes its mind (G3.3): the later statement wins — the earlier one is left out of what is analysed, and kept on
  // its section's "Changed over time" page. Unchanged sections keep their earlier answer; a merge (append-only) asks nothing new.
  const previousRevisions = original.previous.revisions ?? [];
  const revisions = ai ? await revisionsOf(unchosen, previousRevisions, runtime, options) : [];
  const input: UpdateInput = ai
    ? { ...unchosen, text: withoutRevised(unchosen.text, revisions), previous: { ...unchosen.previous, text: withoutRevised(unchosen.previous.text, previousRevisions) } }
    : unchosen;
  const { parsed, local } = await analyzeContent(input.text, { signal });
  const { parsed: previousParsed } = await analyzeContent(input.previous.text, { signal });
  throwIfAborted(signal);
  // Topic identity (G1): a renamed section keeps its id, so its keys — and its objects — stay the same.
  const ids: TopicIds = {
    previous: input.previous.pathIds,
    next: nextPathIds(input.previous.pathIds, previousParsed, input.previous.text, parsed, input.text),
  };
  // Sections (F42) are reconciled by their title objects: plans are compared flat, each group as its title heading.
  const previousGrouped = validateVisualPlan(input.previous.plan, { stored: true }).plan;
  const previousPlan = ungroup(previousGrouped);

  let raw: unknown;
  let reanalyzedUnits: string[] = [];
  let plainCardKeys: string[] = [];
  let plainMissed: UpdateResult["plainMissed"] = [];
  let economy: UpdateResult["economy"] = [];
  let planSkips: UpdateResult["planSkips"] = [];
  let capacity: UpdateResult["capacity"];
  let reusedUnits: string[] = [];
  let provenance: { providerId: string; role: ProviderRole; model: string } | undefined;
  /** The new plan before flattening, when it has real groups (the local tier's sections), for putting new objects in frames. */
  let grouped: VisualPlan | null = null;
  /** An outlined document's sections after the update: its plan is stored grouped by them, as a first run's is. */
  let outlinedSections: OutlineSection[] | null = null;
  if (input.source.tier === "local") {
    if (!local.plan) throw new NothingToVisualizeLocallyError();
    grouped = rekeyPlan(local.plan, ids.next);
    // A new paragraph in an existing section is an explanation of it, not a longer block (F38b, `paragraphs.ts`).
    raw = splitExpansions(ungroup(grouped), previousPlan);
  } else if (input.source.template === "sectioned") {
    // An outlined document (F42 Phase 2): sections, not units, are what gets reused or regenerated.
    ({ raw, reanalyzedUnits, plainCards: plainCardKeys, plainMissed, economy, planSkips, capacity, reusedUnits, provenance, sections: outlinedSections } = await updateOutlined(input, runtime, parsed, previousParsed, ids, previousGrouped, previousPlan, { ...options, plainSpans: input.text === original.text ? options.plainSpans : undefined }));
  } else {
    const template = input.source.template as VisualTemplate;
    const { before, units } = keyedUnits(previousParsed, parsed, input, ids);
    const forced = new Set(options.regenerate ?? []);
    // A selection's re-run analyses only its own units, whatever else differs in the text.
    const changed = units.filter((u) => (forced.size ? forced.has(u.key) : before.get(u.key) !== normalizeUnitText(u.text)));
    const unchangedKeys = new Set(units.filter((u) => !changed.includes(u)).map((u) => u.key));
    reanalyzedUnits = changed.map((u) => u.key);
    reusedUnits = [...unchangedKeys];

    // Unchanged units: the previous plan's own nodes (and relationships among them), no model call.
    const reused = previousPlan.nodes.filter((n) => n.stableKey && unchangedKeys.has(unitOfKey(n.stableKey) ?? ""));
    const reusedIds = new Set(reused.map((n) => n.id));
    const reusedRelationships = previousPlan.relationships.filter((r) => reusedIds.has(r.from) && reusedIds.has(r.to));

    let fresh: { nodes?: unknown[]; relationships?: unknown[] } = {};
    if (changed.length) {
      onProgress?.({ stage: "analyzing", label: "Analyzing changes…" });
      try {
        // A section that was already there is re-analysed against what it shows now (F38b); a new one from scratch.
        const shown = withoutUnitSections(previousPlan);
        const reps = changed.map((u) => (before.has(u.key) && !forced.has(u.key) ? representationOf(shown, u.key) : null));
        // A heading-only unit (e.g. a retitled document) is answered locally, never by a model (`headingOnlyReply`).
        // A plain card (a merge's unplaced part) is shown as it is, also without a model call.
        const plainTexts = options.plainUnits?.size ? [...options.plainUnits] : [];
        const spans = input.text === original.text ? (options.plainSpans ?? []) : [];
        const isPlain = (u: AnalysisUnit) => spans.some((sp) => u.span.start >= sp.start && u.span.start < sp.end) || plainTexts.some((t) => t.includes(normalizeUnitText(u.text)));
        const replies = await Promise.all(
          changed.map((u, i) =>
            headingOnlyReply(u, template) || isPlain(u)
              ? null
              : runtime.run<GenerateVisualPlanInput, unknown>(
                  "generate_visual_plan",
                  // With the section's current representation, the facts of how its text changed (edited vs added paragraphs).
                  { template, ...changedInput(before.get(u.key) ?? "", u.text, reps[i]!) },
                  { signal },
                ),
          ),
        );
        throwIfAborted(signal);
        const prefix = `v${input.previous.version + 1}_`;
        const merged = mergeUnitPlans(
          template,
          replies.map((r, i) => ({ unitKey: changed[i]!.key, raw: r ? keptReply(r.data, reps[i]!, before.get(changed[i]!.key) ?? "", changed[i]!.text) : isPlain(changed[i]!) ? plainReply(changed[i]!, template) : headingOnlyReply(changed[i]!, template) })),
          prefix,
        );
        // The section titles a first run framed (F42), as the flat headings the previous plan is compared as.
        const unitInfo = units.map((u) => ({ key: u.key, headingOnly: !!headingOnlyReply(u, template) }));
        fresh = groupByUnit(merged, template, unitInfo, { idPrefix: prefix, flat: true }) as typeof fresh;
        const last = replies.filter((r) => r !== null).at(-1);
        if (last) provenance = { providerId: last.providerId, role: last.role, model: last.usage.model };
      } catch (err) {
        if (err instanceof AIError && err.kind === "model_unavailable" && err.message === NO_PROVIDER_CONFIGURED_MESSAGE) throw new NoProviderConfiguredError(false);
        throw err;
      }
    }
    raw = { version: 1, template, nodes: [...reused, ...(fresh.nodes ?? [])], relationships: [...reusedRelationships, ...(fresh.relationships ?? [])] };
  }

  onProgress?.({ stage: "planning_layout", label: "Comparing with the canvas…" });
  const validated = validateVisualPlan(raw, options.appendOnly ? { existing: new Set(previousPlan.nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : []))) } : {});
  // AI tier: new detail linked generically to an existing concept is its explanation (F38b, `typeExplanations`).
  // (The local tier types its own splits already, and its relates_to links are structural.)
  const keyed = ensureStableKeys(validated.plan);
  const typed = input.source.tier === "ai" ? typeExplanations(keyed, new Set(previousPlan.nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])))) : keyed;
  const guarded = options.appendOnly ? appendOnly(typed, previousPlan) : typed;
  // The choices, as the full text has them now (any earlier ones the plan reused are replaced).
  const plan = ai ? withChoiceNodes(guarded, choicesInText(original.text, ids.next), revisions.map((r) => ({ ...r, unit: rekey(r.unit, ids.next) }))) : guarded;
  throwIfAborted(signal);

  const parseMarkdown = options.parseMarkdown ?? (await loadDefaultParser());
  // "Re-visualize" on a selection: reconciled over its sections alone — the plans and the objects — so nothing outside them can be proposed.
  const scope = options.regenerate?.length ? new Set(options.regenerate) : null;
  const inScope = (key: string | undefined) => !scope || scope.has(unitOfKey(key ?? "") ?? "");
  const scoped = (p: VisualPlan): VisualPlan => {
    if (!scope) return p;
    const nodes = p.nodes.filter((n) => inScope(n.stableKey));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...p, nodes, relationships: p.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)) };
  };
  const reconciliation = reconcile({
    previous: scoped(previousPlan),
    previousVersion: input.previous.version,
    next: scoped(plan),
    existing: input.existing.filter((o) => inScope(o.stableNodeKey)),
    fingerprint: (n) => nodeFingerprint(n, parseMarkdown),
    objectKind: nodeKind,
  });
  // Connectors may be rewired only where the plan was actually re-derived: the whole plan on the local tier, re-analysed sections on the AI tier.
  const rewirable = input.source.tier === "local" ? null : new Set(reanalyzedUnits);
  const stored = outlinedSections ? regroupSections(plan, outlinedSections, previousGrouped) : plan;
  const changeSet = await buildChangeSet(original, plan, grouped, reconciliation, parseMarkdown, provenance, rewirable, ids.next, stored, revisions);
  // Objects the review proposes to remove, each with whether its key comes back as another kind of object (a replacement, not a loss).
  const addedKeys = new Set(reconciliation.items.flatMap((i) => (i.state === "add" && i.node.stableKey ? [i.node.stableKey] : [])));
  const removals = reconciliation.items.flatMap((i) => (i.state === "remove" ? [{ key: i.object.stableNodeKey, replacedBy: addedKeys.has(i.object.stableNodeKey) }] : []));
  return { changeSet, reconciliation, reanalyzedUnits, plainCards: plainCardKeys, plainMissed, economy, planSkips, ...(capacity ? { capacity: { ...capacity, actualCounted: validated.existingCounted } } : {}), overflow: validated.overflow, removals, reusedUnits, warnings: validated.warnings, notices: splitNotices(reconciliation) };
}

/** The units an earlier section's unit `key` is now: itself, its numbered parts once it grew past `MAX_UNIT_CHARS`, or the whole unit again. */
function currentUnits(key: string, contentKeys: ReadonlySet<string>): string[] {
  if (contentKeys.has(key)) return [key];
  const base = key.replace(SPLIT_PART, "");
  if (contentKeys.has(base)) return [base];
  return [...contentKeys].filter((k) => SPLIT_PART.test(k) && k.replace(SPLIT_PART, "") === base);
}
/** The numbered-part suffix `analysisUnits` gives a unit over `MAX_UNIT_CHARS`. */
const SPLIT_PART = / ·\d+$/;
/** Text that is only heading lines (a title over its subsections). */
const HEADINGS_ONLY = /^(?:#{1,6}\s[^\n]*\n*)+$/;

/**
 * Sections the stored plan holds without a frame: a first run with more than `MAX_GROUPS` sections keeps the rest as loose objects,
 * still keyed by their section. Without these, an update would take their content for new topics and generate it again.
 */
function unframedSections(previousPlan: VisualPlan, previousGrouped: VisualPlan, before: ReadonlyMap<string, string>): OutlineSection[] {
  const framed = new Set(sectionsOfPlan(previousGrouped).map((s) => s.key));
  const keys = new Set(previousPlan.nodes.flatMap((n) => (n.stableKey ? [unitOfKey(n.stableKey) ?? ""] : [])));
  return [...keys].flatMap((key): OutlineSection[] => {
    if (!key || key === OUTLINE_UNIT || framed.has(key)) return [];
    const units = unitsOfSectionKey(key);
    // Only sections of content units the previous text had (never a title, or a node keyed by something else).
    if (!units.every((k) => before.has(k) && !HEADINGS_ONLY.test(before.get(k)!))) return [];
    return [{ key, units, label: units[0]!.split(" › ").at(-1)!, kind: "notes", prominence: "primary", arrangement: sectionKind("notes").arrangement }];
  });
}

/**
 * A changed section's generation input: only its appended paragraphs when that is all that changed (every earlier one is still
 * there word for word), else its whole text with how it changed (F38b); its whole text alone when it is new (`rep` null).
 */
function changedInput(before: string, after: string, rep: UnitRepresentation | null): Pick<GenerateVisualPlanInput, "text" | "current" | "changes" | "appended"> {
  if (!rep) return { text: after };
  const appended = appendedParagraphs(before, after);
  if (appended) return { text: appended.join("\n\n"), current: rep.current, appended: true };
  return { text: after, current: rep.current, changes: paragraphChanges(before, after) };
}

/** A changed section's reply with its kept nodes given back (`expandUnchanged`; an `appended` reply first gets every node it didn't name). */
function keptReply(data: unknown, rep: UnitRepresentation | null, before: string, after: string): unknown {
  return expandUnchanged(rep && appendedParagraphs(before, after) ? withCurrentKept(data, rep) : data, rep);
}

/** The previous version's and the new text's `pathIds` (G1). */
interface TopicIds {
  previous: PathIds | undefined;
  next: PathIds | undefined;
}

/** Both texts' analysis units keyed by topic id (G1): the previous one's normalised text by key, and the new one's units. */
function keyedUnits(previousParsed: ParsedContent, parsed: ParsedContent, input: UpdateInput, ids: TopicIds): { before: Map<string, string>; units: AnalysisUnit[] } {
  const before = new Map(analysisUnits(previousParsed, input.previous.text).map((u) => [rekey(u.key, ids.previous), normalizeUnitText(u.text)] as const));
  const units = analysisUnits(parsed, input.text).map((u) => ({ ...u, key: rekey(u.key, ids.next) }));
  return { before, units };
}

/** A split block (F42 Phase 4) whose content the source changed is kept as the user split it, and said so. */
export function splitNotices(reconciliation: ReconciliationPlan): string[] {
  const changed = reconciliation.splits.filter((s) => s.changed);
  if (!changed.length) return [];
  const names = changed.map((s) => nodeName(s.node)).filter((n): n is string => !!n);
  const which = changed.length === 1 ? "a block you split" : `${changed.length} blocks you split`;
  return [
    `The source changed ${which}${names.length ? ` (${names.map((n) => `“${n}”`).join(", ")})` : ""}, and the split was kept. To show the new content instead, delete the pieces and update again.`,
  ];
}

function nodeName(node: VisualNode): string | undefined {
  const name = "title" in node && typeof node.title === "string" && node.title.trim() ? node.title.trim() : node.type === "heading" ? node.content.text : undefined;
  return name && name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

interface OutlinedUpdate {
  raw: unknown;
  reanalyzedUnits: string[];
  plainCards: string[];
  plainMissed: UpdateResult["plainMissed"];
  economy: UpdateResult["economy"];
  planSkips: UpdateResult["planSkips"];
  capacity?: Omit<NonNullable<UpdateResult["capacity"]>, "actualCounted">;
  reusedUnits: string[];
  provenance: { providerId: string; role: ProviderRole; model: string } | undefined;
  /** The document's sections after this update, for storing its plan grouped again (`regroupSections`). */
  sections: OutlineSection[];
}

/**
 * "Update from new content" for an outlined document. When its parts are the same (only their text changed),
 * each section whose parts changed is regenerated — with its current representation, as a unit is (F38b) —
 * and every other section is reused as is, with no model call. When parts were added or removed, the whole
 * document is outlined again; unchanged sections still match their objects by key. Reported "units" are
 * section keys here: the pieces actually re-analysed or reused.
 */
async function updateOutlined(
  input: UpdateInput,
  runtime: AIRuntime,
  parsed: ParsedContent,
  previousParsed: ParsedContent,
  ids: TopicIds,
  previousGrouped: VisualPlan,
  previousPlan: VisualPlan,
  options: UpdateOptions,
): Promise<OutlinedUpdate> {
  const { signal, onProgress } = options;
  const prefix = `v${input.previous.version + 1}_`;
  const { before, units } = keyedUnits(previousParsed, parsed, input, ids);
  const content = units.filter((u) => !isHeadingOnly(u));
  const contentKeys = new Set(content.map((u) => u.key));
  // Each earlier section over the units it covers now: a unit that grew past `MAX_UNIT_CHARS` is split into numbered parts
  // ("X ·1", "X ·2"), and one that shrank is whole again — the same topic, not a removed one. `was`: its units before.
  const known = [...sectionsOfPlan(previousGrouped), ...unframedSections(previousPlan, previousGrouped, before)].map((s) => ({
    ...s,
    was: s.units,
    units: [...new Set(s.units.flatMap((k) => currentUnits(k, contentKeys)))],
  }));
  /**
   * A merge only: units the previous text had that no section of its plan holds. A first import past the plan's node limit folds a late
   * section's nodes into an overflow page whose key names no section, and past the frame limit the section has no frame either, so nothing
   * in the plan says the section exists. It is existing content, not a new part: it becomes a section of its own (grown ones are planned
   * again from their whole text; the rest are left alone). Without this the merge outlined, planned and analysed it as new, with its
   * neighbours (the surviving outline call of the 2026-10-10 run 3).
   */
  const taken = new Set(known.flatMap((s) => s.units));
  const orphans = options.appendOnly
    ? content
        .filter((u) => !taken.has(u.key) && before.has(u.key) && !HEADINGS_ONLY.test(before.get(u.key)!))
        .map((u) => ({ key: u.key, units: [u.key], was: [u.key], label: u.key.split(" › ").at(-1)!, kind: "notes" as const, prominence: "primary" as const, arrangement: sectionKind("notes").arrangement }))
    : [];
  const sections = [...known, ...orphans];
  const covered = new Set(sections.flatMap((s) => s.units));
  const unchanged = (u: AnalysisUnit) => before.get(u.key) === normalizeUnitText(u.text);
  // Parts only added (G2.3: a merge's new topics, or a new section written into the text): every existing section is kept,
  // and only the new parts are outlined and generated, as new sections. A part removed or regrouped re-outlines the whole.
  const keptAll = sections.length > 0 && sections.every((s) => s.units.length > 0);
  // A selection's re-run (`regenerate`) never adds or re-outlines: its sections are regenerated in place and nothing else is looked at.
  const forced = new Set(options.regenerate ?? []);
  const added = keptAll && !forced.size ? content.filter((u) => !covered.has(u.key)) : [];
  const sameParts = (keptAll && !added.length) || forced.size > 0;
  try {
    if (!sameParts && !added.length) {
      const r = await visualizeOutlined(units, runtime, { signal, idPrefix: prefix, flat: true, onProgress: (label) => onProgress?.({ stage: "analyzing", label }) });
      failIfIncomplete(r.failed, options);
      return { raw: r.raw, reanalyzedUnits: r.sections.map((s) => s.key), plainCards: [], plainMissed: [], economy: [], planSkips: [], reusedUnits: [], provenance: r.provenance, sections: r.sections };
    }
    const byKey = new Map(units.map((u) => [u.key, u] as const));
    const changedSections = sections.filter((s) => (forced.size ? forced.has(s.key) : s.units.join(SECTION_KEY_JOINER) !== s.was.join(SECTION_KEY_JOINER) || s.units.some((k) => !unchanged(byKey.get(k)!))));
    const title = units[0] && isHeadingOnly(units[0]) ? units[0] : null;
    const titleChanged = !!title && !forced.size && !unchanged(title);
    const keep = new Set([...sections.filter((s) => !changedSections.includes(s)).map((s) => s.key), OUTLINE_UNIT, ...(title && !titleChanged ? [title.key] : [])]);
    const reused = previousPlan.nodes.filter((n) => n.stableKey && keep.has(unitOfKey(n.stableKey) ?? ""));
    const reusedIds = new Set(reused.map((n) => n.id));
    const reusedRelationships = previousPlan.relationships.filter((r) => reusedIds.has(r.from) && reusedIds.has(r.to));
    let fresh: { nodes?: unknown[]; relationships?: unknown[] } = {};
    let provenance: OutlinedUpdate["provenance"];
    const economyDone: UpdateResult["economy"] = [];
    const planSkips: UpdateResult["planSkips"] = [];
    let capacity: OutlinedUpdate["capacity"];
    const shown = withoutUnitSections(previousPlan);
    const reps = changedSections.map((s) => (forced.has(s.key) ? null : representationOf(shown, s.key)));
    const beforeText = (s: { was: readonly string[] }) => s.was.map((k) => before.get(k) ?? "").join("\n\n");
    /**
     * Economy merges only: does the plan have any room for new nodes? Asked of the real `foldOverflow` (`capacity.ts`) with the nodes the plan will
     * certainly keep: the unchanged sections', and those of a section that only had paragraphs appended (it keeps every node it has). When it has
     * none, anything planned for a new or grown-orphan section would be folded into a page anyway, so the model is not asked for it.
     */
    // What the check is given, and what it leaves out, for the diagnostics (`UpdateResult.capacity`): none of this changes the answer.
    const sectionNodes = (key: string) => shown.nodes.filter((n) => n.stableKey && unitOfKey(n.stableKey) === key);
    const changedFacts = changedSections.map((s, i) => {
      const appendable = !!reps[i] && !!appendedParagraphs(beforeText(s), sectionText(s, units));
      return { section: s.key, nodes: sectionNodes(s.key).length, counted: appendable, why: appendable ? "only paragraphs appended: it keeps every node it has" : reps[i] ? "text edited: it is regenerated, and the model may change or drop its nodes" : "no stored nodes of its own (an orphan, or a section the plan never drew)" };
    });
    // A section that only had paragraphs appended keeps every node it has, so its title, which the plan makes again under the same key (`wrapSections`)
    // and the fold counts as an existing node, is certain to be there too. The title of a regenerated, orphan or new section is not: that section's
    // reply may hold no nodes, and then no title is made.
    const countedKeys = new Set(changedFacts.flatMap((f) => (f.counted ? [f.section] : [])));
    const countedTitles = previousPlan.nodes.filter((n) => n.stableKey?.endsWith(UNIT_SECTION_SUFFIX) && countedKeys.has(unitOfKey(n.stableKey) ?? ""));
    const retained = [...reused, ...changedSections.flatMap((s, i) => (changedFacts[i]!.counted ? sectionNodes(s.key) : [])), ...countedTitles];
    const previousKeys = new Set(previousPlan.nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
    let check: CapacityCheck | undefined;
    const noRoom = !!options.economy && !!options.appendOnly && everyAddedNodeFolds(retained, previousKeys, (c) => (check = c));
    if (check) {
      const changedKeys = new Set(changedSections.map((s) => s.key));
      capacity = {
        ...check,
        reusedNodes: reused.length,
        sections: changedFacts.map((f) => ({ section: f.section, nodes: f.nodes, counted: f.counted, why: f.why })).slice(0, 40),
        // The titles of the changed sections are made again with the same keys, so the fold counts them as existing, but they are not in `retained`.
        titlesCounted: countedTitles.length,
        recheck: "not_needed_no_new_sections",
        orphans: [],
        changedTitles: previousPlan.nodes.filter((n) => n.stableKey?.endsWith(UNIT_SECTION_SUFFIX) && changedKeys.has(unitOfKey(n.stableKey) ?? "")).length,
      };
    }
    if (changedSections.length || titleChanged) {
      onProgress?.({ stage: "analyzing", label: "Analyzing changes…" });
      const failures: string[] = [];
      const orphan = changedSections.map((s, i) => !reps[i] && s.was.length > 0 && s.was.every((k) => before.has(k)));
      const pure = changedSections.map((s) => !!appendedParagraphs(beforeText(s), sectionText(s, units)));
      // A section that was edited (not only appended to) is regenerated by the model: its reply decides how many nodes the plan holds, and the first
      // check cannot count them (the model may change or drop them). An orphan that could be skipped is therefore held back, but only when what the
      // plan holds now plus what those sections held before (what it expects them to return) reaches the cap. Whether it is skipped is then decided
      // from their actual replies (`planIsFull`), as it is for the new sections: a hold is only a delay, and an orphan is never skipped while the
      // plan has room.
      const regenerated = changedSections.map((_s, i) => !!reps[i] && !pure[i]);
      const regeneratedNodes = changedSections.reduce((n, _s, i) => n + (regenerated[i] ? changedFacts[i]!.nodes : 0), 0);
      const expectation = capacity?.counted !== undefined ? capacity.counted + regeneratedNodes : undefined;
      const held = changedSections.map((_s, i) => !!capacity && !noRoom && orphan[i] && pure[i] && regenerated.some(Boolean) && expectation !== undefined && expectation >= capacity.cap);
      const facts: (NonNullable<OutlinedUpdate["capacity"]>["orphans"][number] | undefined)[] = changedSections.map(() => undefined);
      const settle = async (i: number, skipOrphan: boolean, afterHold: boolean) => {
        const s = changedSections[i]!;
        // Economy mode: text only appended to a section that is already drawn becomes verbatim cards, without a model call. So does a grown
        // section of the notes that no stored section holds (an "orphan": the first import folded it into a page) when the plan has no room
        // left for anything planned for it, and only when it is a pure append. Only the appended paragraphs are added: the page that holds its
        // earlier text stays on the canvas (a merge adds overflow pages under keys of their own, `foldOverflow`, and never replaces an existing
        // one), so adding the whole text would show it twice.
        const appended = options.economy && (reps[i] || (skipOrphan && orphan[i])) ? appendedParagraphs(beforeText(s), sectionText(s, units)) : null;
        if (orphan[i]) facts[i] = { section: s.key, pureAppend: pure[i]!, held: held[i]!, outcome: appended ? (afterHold ? "skipped_after_hold" : "skipped") : afterHold ? "planned_after_hold" : "planned" };
        if (appended) {
          const cards = economyCards(appended);
          // An orphan is reported as a skipped plan, not as economy cards: economy mode was not what decided it (the full plan was).
          if (reps[i]) economyDone.push({ section: s.key, cards: cards.nodes.length });
          else planSkips.push({ section: s.key, path: "orphan", units: s.units.length, cards: cards.nodes.length });
          return { data: cards as unknown, result: null };
        }
        const asked = changedInput(beforeText(s), sectionText(s, units), reps[i]!);
        // Only appended paragraphs are numbered, so a block that is a new concept can be placed by reference (`appendedRefs.ts`).
        const refs = asked.appended ? await numberAppended(asked.text) : null;
        const r = await generateSection(
          runtime,
          {
            template: "sectioned",
            section: { label: s.label, kind: s.kind },
            ...asked,
            ...(refs?.numbered ? { numbered: refs.numbered } : {}),
          },
          failures,
          signal,
        );
        return refs && r.result ? { ...r, data: await resolveAppendedRefs(r.data, refs.blocks, asked.text) } : r;
      };
      type Reply = Awaited<ReturnType<typeof settle>>;
      const replies: (Reply | undefined)[] = changedSections.map(() => undefined);
      const settleAll = async (idx: number[], skipOrphan: boolean, afterHold: boolean) => {
        const done = await Promise.all(idx.map((i) => settle(i, skipOrphan, afterHold)));
        idx.forEach((i, k) => (replies[i] = done[k]));
      };
      /** The nodes of the changed sections in `idx` (their replies are in) as the plan will hold them, titles made again. */
      const assemble = (idx: number[], copy: boolean) =>
        wrapSections(
          mergeUnitPlans(
            "sectioned",
            [
              ...(titleChanged ? [{ unitKey: title!.key, raw: headingOnlyReply(title!, "sectioned") }] : []),
              ...idx.map((i) => ({ unitKey: changedSections[i]!.key, raw: keptReply(copy ? structuredClone(replies[i]!.data) : replies[i]!.data, reps[i]!, beforeText(changedSections[i]!), sectionText(changedSections[i]!, units)) })),
            ],
            prefix,
          ),
          idx.map((i) => changedSections[i]!),
          { idPrefix: prefix, flat: true, titleKey: titleChanged ? title!.key : null },
        ) as typeof fresh;
      const startedAt = Date.now();
      const heldIdx = changedSections.flatMap((_s, i) => (held[i] ? [i] : []));
      const nowIdx = changedSections.flatMap((_s, i) => (held[i] ? [] : [i]));
      await settleAll(nowIdx, noRoom, false);
      if (failures.length) throw new Error(failures.join(" "));
      throwIfAborted(signal);
      let hold: NonNullable<OutlinedUpdate["capacity"]>["hold"];
      if (heldIdx.length) {
        // With every other reply in, is the plan full? Anything that goes wrong in finding out means "not known to be full": the orphans are planned.
        let full = false;
        let seen: CapacityCheck | undefined;
        let planned = 0;
        try {
          const so_far = [...reused, ...(assemble(nowIdx, true).nodes ?? [])];
          planned = so_far.length;
          full = planIsFull(so_far, previousKeys, (c) => (seen = c));
        } catch {
          full = false;
        }
        const heldMs = Date.now() - startedAt;
        await settleAll(heldIdx, full, true);
        if (failures.length) throw new Error(failures.join(" "));
        throwIfAborted(signal);
        const check2 = seen as CapacityCheck | undefined;
        hold = { held: heldIdx.length, expectation: expectation!, heldMs, answer: check2?.answer ?? "unsupported", ...(check2 ? { check: { ...check2, planned } } : {}) };
      }
      if (capacity) capacity = { ...capacity, orphans: facts.flatMap((f) => (f ? [f] : [])).slice(0, 40), ...(expectation !== undefined ? { orphanExpectation: expectation } : {}), ...(hold ? { hold } : {}) };
      fresh = assemble(
        changedSections.map((_s, i) => i),
        false,
      );
      const last = replies.flatMap((r) => (r?.result ? [r.result] : [])).at(-1);
      if (last) provenance = { providerId: last.providerId, role: last.role, model: last.usage.model };
    }
    // The new parts' own sections (G2.3), without that run's document-level nodes (the notes keep their own subtitle).
    let addedSections: OutlineSection[] = [];
    let plainSections: OutlineSection[] = [];
    let plainMissed: UpdateResult["plainMissed"] = [];
    if (added.length) {
      // Plain cards (a merge's unplaced parts) are shown as they are: no outline, plan or analysis call.
      // Found by position when the merge says where they are (`plainSpans`), else by matching their text; whatever the first leaves is
      // matched by text too. An unplaced section never costs a model call because its text read differently from the merge's.
      const bySpan = plainRunsBySpans(added, options.plainSpans ?? []);
      const rest = added.filter((u) => !bySpan.some((r) => r.includes(u)));
      const runs = [...bySpan, ...(options.plainUnits?.size ? plainRuns(rest, options.plainUnits) : [])];
      const plain = new Set(runs.flat());
      plainMissed = (options.plainSpans ?? []).flatMap((s) =>
        runs.some((r) => r[0]!.span.start >= s.start && r[0]!.span.start < s.end)
          ? []
          : [{ text: input.text.slice(s.start, s.start + 60), why: content.some((u) => u.span.start >= s.start && u.span.start < s.end) ? "its units are covered by a stored section" : "no unit lies in it" }],
      );
      const generated = added.filter((u) => !plain.has(u));
      // Before the replies the check could only count what was certain. Now every changed section's reply is in (an orphan's too, unless it was
      // skipped, which needs the full plan already), so the plan so far is asked as it will be validated: the exact answer, no estimate.
      let fullNow = noRoom;
      if (capacity && generated.length) capacity = { ...capacity, recheck: noRoom ? "not_needed_first_answer_full" : changedSections.length || titleChanged ? "asked" : "not_applicable" };
      if (generated.length && !noRoom && options.economy && options.appendOnly && (changedSections.length || titleChanged)) {
        let again: CapacityCheck | undefined;
        fullNow = planIsFull([...reused, ...(fresh.nodes ?? [])], previousKeys, (c) => (again = c));
        if (capacity && again) capacity = { ...capacity, afterReplies: { ...again, planned: reused.length + (fresh.nodes?.length ?? 0) } };
      }
      if (generated.length && fullNow) {
        // No room: whatever the model planned for these new sections would fold into pages, so each unit is added as it is (`plainCards`, one
        // section per unit, no outline, plan or analysis call). Its nodes are not marked plain: they fold into the section's page exactly as
        // the planned ones would have, so the canvas holds no more objects than before and the cap is untouched.
        const cards = plainCards(generated.map((u) => [u]), `${prefix}n_`);
        const nodes = (cards.raw.nodes as VisualNode[]).map(({ origin: _origin, ...n }) => n as VisualNode);
        fresh = { nodes: [...(fresh.nodes ?? []), ...nodes], relationships: [...(fresh.relationships ?? [])] };
        addedSections = cards.sections;
        for (const sec of cards.sections) planSkips.push({ section: sec.key, path: "added", units: sec.units.length, cards: 1 });
      } else if (generated.length) {
        const r = await visualizeOutlined(generated, runtime, { signal, idPrefix: `${prefix}n_`, flat: true, onProgress: (label) => onProgress?.({ stage: "analyzing", label }) });
        failIfIncomplete(r.failed, options);
        const own = r.raw as { nodes?: VisualNode[]; relationships?: VisualPlan["relationships"] };
        const nodes = (own.nodes ?? []).filter((n) => !n.stableKey || unitOfKey(n.stableKey) !== OUTLINE_UNIT);
        const ids = new Set(nodes.map((n) => n.id));
        fresh = { nodes: [...(fresh.nodes ?? []), ...nodes], relationships: [...(fresh.relationships ?? []), ...(own.relationships ?? []).filter((x) => ids.has(x.from) && ids.has(x.to))] };
        addedSections = r.sections;
        if (r.provenance) provenance = r.provenance;
      }
      if (runs.length) {
        const cards = plainCards(runs, `${prefix}p_`);
        fresh = { nodes: [...(fresh.nodes ?? []), ...cards.raw.nodes], relationships: [...(fresh.relationships ?? []), ...cards.raw.relationships] };
        plainSections = cards.sections;
      }
    }
    return {
      raw: { version: 1, template: "sectioned", nodes: [...reused, ...(fresh.nodes ?? [])], relationships: [...reusedRelationships, ...(fresh.relationships ?? [])] },
      reanalyzedUnits: [...changedSections.map((s) => s.key), ...(titleChanged ? [title!.key] : []), ...addedSections.map((s) => s.key)],
      plainCards: plainSections.map((s) => s.key),
      plainMissed,
      economy: economyDone,
      planSkips,
      capacity,
      reusedUnits: sections.filter((s) => !changedSections.includes(s)).map((s) => s.key),
      provenance,
      sections: [...sections, ...addedSections, ...plainSections],
    };
  } catch (err) {
    if (err instanceof AIError && err.kind === "model_unavailable" && err.message === NO_PROVIDER_CONFIGURED_MESSAGE) throw new NoProviderConfiguredError(false);
    throw err;
  }
}

async function buildChangeSet(
  input: UpdateInput,
  plan: VisualPlan,
  grouped: VisualPlan | null,
  reconciliation: ReconciliationPlan,
  parseMarkdown: ParseMarkdown,
  provenance: { providerId: string; role: ProviderRole; model: string } | undefined,
  rewirable: ReadonlySet<string> | null,
  pathIds: PathIds | undefined,
  /** The plan the next version stores (an outlined document's, grouped again by section). */
  stored: VisualPlan,
  /** Where the new text changes its mind (G3.3), kept with its version. */
  revisions: readonly Revision[] = [],
): Promise<ChangeSet | null> {
  const items = reviewItems(reconciliation);
  const metadata = provenanceMetadata(input.operationId, provenance);
  const changes: ProposedChange[] = [];
  const conflicts: ConflictItem[] = [];

  // Nodes that are (and stay) an existing object: matched, and not being replaced.
  const matched = new Map(reconciliation.items.flatMap((i) => (i.state !== "add" && i.state !== "remove" ? [[i.node.id, i.object] as const] : [])));
  const added: VisualNode[] = items.flatMap((i) => (i.state === "add" ? [i.node] : []));
  const ids = new Set(added.map((n) => n.id));

  if (added.length) changes.push(...(await placeAdds(input, plan, grouped, added, matched, metadata, parseMarkdown)));

  // Connectors. A link to or from a new node is added; between two existing objects, this source's own arrows are rewired to match
  // the plan — a missing link is added, one the plan no longer has is proposed for removal. The user's own arrows are never touched.
  const rewired = (nodeId: string) => {
    const key = matched.get(nodeId)?.stableNodeKey ?? plan.nodes.find((n) => n.id === nodeId)?.stableKey;
    return rewirable === null || (!!key && rewirable.has(unitOfKey(key) ?? ""));
  };
  const connections = input.connections ?? [];
  // Already linked, by any arrow in either direction: never draw a second one.
  const linked = new Set(connections.flatMap((c) => [`${c.from}>${c.to}`, `${c.to}>${c.from}`]));
  const drawn = new Map<string, ExistingConnection>(connections.filter((c) => c.ownedBySource).map((c) => [`${c.from}>${c.to}`, c]));
  const wanted = new Set<string>();
  plan.relationships.forEach((r, i) => {
    const from = ids.has(r.from) ? { created: r.from } : matched.has(r.from) ? { existing: matched.get(r.from)!.objectId } : null;
    const to = ids.has(r.to) ? { created: r.to } : matched.has(r.to) ? { existing: matched.get(r.to)!.objectId } : null;
    if (!from || !to || ("created" in from && "created" in to)) return; // links among new nodes come with their group
    if ("existing" in from && "existing" in to) {
      const pair = `${from.existing}>${to.existing}`;
      wanted.add(pair);
      if (linked.has(pair) || !rewired(r.from) || !rewired(r.to)) return;
    }
    changes.push({ kind: "connect", key: `__xrel${i}`, from, to, relation: r.type, ...(r.label ? { label: r.label } : {}) });
  });
  const staying = new Set([...matched.values()].map((o) => o.objectId));
  const nodeOfObject = new Map([...matched.entries()].map(([nodeId, o]) => [o.objectId, nodeId] as const));
  for (const [pair, c] of drawn) {
    if (wanted.has(pair) || wanted.has(`${c.to}>${c.from}`) || !staying.has(c.from) || !staying.has(c.to)) continue; // arrows of removed objects go with them (writer)
    if (!rewired(nodeOfObject.get(c.from)!) || !rewired(nodeOfObject.get(c.to)!)) continue;
    changes.push({ kind: "remove", target: c.arrowId });
  }

  for (const item of items) {
    if (item.state === "update_clean") changes.push(updateChange(item.node, item.object.objectId, parseMarkdown));
    else if (item.state === "remove") changes.push({ kind: "remove", target: item.object.objectId });
    else if (item.state === "update_conflict") {
      conflicts.push({
        target: item.object.objectId,
        stableNodeKey: item.object.stableNodeKey,
        apply: updateChange(item.node, item.object.objectId, parseMarkdown),
        keep: { kind: "rebaseline", target: item.object.objectId, stableNodeKey: item.object.stableNodeKey },
      });
    }
  }
  if (!changes.length && !conflicts.length) return null;

  return {
    operationId: input.operationId,
    title: input.title,
    metadata,
    changes,
    ...(conflicts.length ? { conflicts } : {}),
    contentSource: {
      sourceId: input.source.id,
      version: input.previous.version + 1,
      origin: input.source.origin,
      tier: input.source.tier,
      template: input.source.template,
      text: input.text,
      plan: stored,
      ...(revisions.length ? { revisions: [...revisions] } : {}),
      ...(pathIds ? { pathIds: { ...pathIds } } : {}),
    },
  };
}

/** The direction a template's diagram runs, for a new node linked from only one existing neighbour. */
const DOWNWARD_LAYOUTS: ReadonlySet<LayoutStrategyId> = new Set(["tree-top-down", "document-stack", "three-column", "column-compare"]);

/**
 * Places the added nodes (F38b, F41) and returns their changes, plus the
 * moves that make room for them.
 *
 * An explanation of an existing object hangs below that object. Every other
 * add joins the adds it links to; a group that follows an existing object
 * (its predecessor in the plan) goes in line right after it, in the direction
 * the diagram runs there — towards its existing successor when it has one —
 * so a new flow step lands between the steps it connects. Anything else is
 * one group beside the source's objects.
 *
 * With the scene's objects in the context, a group anchored at an object may
 * make room by moving what is in its way (F41). Each group is placed against
 * the canvas as the earlier groups left it (their new objects are walls), and
 * each existing object moves at most once, to its final position.
 *
 * Sections (F42 Phase 3): a new object of a section already on the canvas
 * joins that section's frame (`update_frame`; the frame grows to fit) — placed
 * by the rules above, or below the frame's lowest member when nothing else
 * anchors it. A new section is placed as a whole, framed with its XL title
 * like a first run's sections.
 */
async function placeAdds(
  input: UpdateInput,
  plan: VisualPlan,
  grouped: VisualPlan | null,
  added: readonly VisualNode[],
  matched: ReadonlyMap<string, ExistingObject>,
  metadata: ChangeSet["metadata"],
  parseMarkdown: ParseMarkdown,
): Promise<ProposedChange[]> {
  const ids = new Set(added.map((n) => n.id));
  const parentOf = new Map(plan.relationships.flatMap((r) => (r.type === "explained_by" && ids.has(r.to) && matched.get(r.from)?.box ? [[r.to, r.from] as const] : [])));
  // An explanation of a new explanation joins its group. A model can link new nodes as explanations of each other: the
  // walk up stops at a node it has already seen, so a cycle ends instead of looping forever.
  const topOf = (id: string) => {
    let top = id;
    const seen = new Set([id]);
    while (!parentOf.has(top)) {
      const up = plan.relationships.find((r) => r.type === "explained_by" && r.to === top && ids.has(r.from))?.from;
      if (!up || seen.has(up)) break;
      seen.add(up);
      top = up;
    }
    return top;
  };
  // Adds that hang below no existing object: grouped by the links among them.
  const root = new Map<string, string>();
  const find = (id: string): string => {
    const up = root.get(id) ?? id;
    return up === id ? id : find(up);
  };
  const free = added.filter((n) => !parentOf.has(topOf(n.id)));
  const freeIds = new Set(free.map((n) => n.id));
  for (const r of plan.relationships) {
    if (!freeIds.has(r.from) || !freeIds.has(r.to)) continue;
    const [a, b] = [find(r.from), find(r.to)].sort();
    if (a !== b) root.set(b!, a!);
  }
  const sectionOf = sectionOfNode(plan, grouped);
  const titles = new Set([...sectionOf.values(), ...plan.nodes.flatMap((n) => (n.type === "heading" && n.role === "section" ? [n.id] : []))]);
  /** The new section a node is part of (its title is new too), if any. */
  const newSection = (id: string) => {
    const s = titles.has(id) ? id : sectionOf.get(id);
    return s && ids.has(s) ? s : null;
  };
  const groups = new Map<string, VisualNode[]>();
  for (const n of added) {
    const parent = parentOf.get(topOf(n.id));
    const section = newSection(n.id);
    const key = section ? `section:${section}` : parent ? `below:${parent}` : `after:${find(n.id)}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const existingFrames = new Set(input.existing.flatMap((o) => (o.frameId ? [o.frameId] : [])));
  let newFrames = 0;

  const objects = input.context.objects ? input.context.objects.map((o) => ({ ...o })) : undefined;
  const objectById = new Map(objects?.map((o) => [o.id, o] as const));
  const existing: Box[] = [...input.context.existing];
  const moved = new Map<string, { x: number; y: number }>();
  const boxNow = (o: ExistingObject): Box => objectById.get(o.objectId)?.box ?? o.box!;
  const out: ProposedChange[] = [];

  let g = 0;
  for (const [key, nodes] of groups) {
    const groupIds = new Set(nodes.map((n) => n.id));
    const internal = plan.relationships.filter((r) => groupIds.has(r.from) && groupIds.has(r.to));
    const sectionId = key.startsWith("section:") ? key.slice("section:".length) : null;
    const sub: VisualPlan = sectionId ? sectionPlan(plan, grouped, sectionId, nodes, internal) : { ...plan, nodes, relationships: internal };
    // The existing section frame these objects join, if any.
    const joins = sectionId ? null : frameToJoin(nodes, sectionOf, matched, plan);
    let anchored = groupAnchor(key, plan, groupIds, matched, boxNow);
    if (joins && !anchored.anchor) {
      const bottom = (o: ExistingObject) => boxNow(o).y + boxNow(o).height;
      const lowest = [...matched.values()]
        .filter((o) => o.frameId === joins.frameId && o.box)
        .reduce<ExistingObject | null>((a, o) => (!a || bottom(o) > bottom(a) ? o : a), null);
      if (lowest) anchored = { anchor: boxNow(lowest), anchorSide: "below", anchorIds: [lowest.objectId] };
    }
    // Room is made only beside a specific object; a group beside the whole diagram just looks for free space.
    const context: RenderContext = anchored.anchor
      ? { ...anchored, viewport: input.context.viewport, existing, ...(objects ? { objects } : {}) }
      : { viewport: input.context.viewport, existing, ...(input.context.anchor ? { anchor: input.context.anchor } : {}) };
    const rendered = await renderVisualPlan(sub, { operationId: input.operationId, title: input.title, metadata, context, parseMarkdown });
    const createdKeys: string[] = [];
    for (const c of rendered.changes) {
      if (c.kind === "move") {
        moved.set(c.target, c.to);
        const o = objectById.get(c.target);
        if (o) o.box = { ...o.box, ...c.to };
        if (o) existing.push(o.box);
        continue;
      }
      // Connectors inside a group are keyed per group; keep them unique across groups.
      // A new section's frame is numbered after the sections already on the canvas.
      out.push(c.kind === "connect" ? { ...c, key: `__g${g}${c.key}` } : c.kind === "create_frame" ? { ...c, title: frameName(sectionRole(sub), existingFrames.size + ++newFrames) } : c);
      if ("box" in c && c.kind !== "create_frame") createdKeys.push(c.key);
      if ("box" in c) {
        existing.push(c.box);
        objects?.push({ id: `new:${c.key}`, box: c.box, unit: `new:${c.key}`, locked: true, placedByAcute: true });
      }
    }
    if (joins && createdKeys.length) out.push({ kind: "update_frame", target: joins.frameId, add: createdKeys, ...(joins.section ? { section: joins.section } : {}) });
    g++;
  }
  for (const [target, to] of moved) out.push({ kind: "move", target, to });
  return oneJoinPerFrame(out);
}

/**
 * Several groups of adds can join the same section frame (two choices in one topic, an explanation and a new step in one section):
 * one `update_frame` per frame, with all of their objects — a change set changes each object at most once.
 */
function oneJoinPerFrame(changes: ProposedChange[]): ProposedChange[] {
  const first = new Map<string, Extract<ProposedChange, { kind: "update_frame" }>>();
  const out: ProposedChange[] = [];
  for (const c of changes) {
    if (c.kind !== "update_frame") {
      out.push(c);
      continue;
    }
    const joined = first.get(c.target);
    if (!joined) {
      const copy = { ...c, add: [...c.add] };
      first.set(c.target, copy);
      out.push(copy);
    } else joined.add.push(...c.add.filter((k) => !joined.add.includes(k)));
  }
  return out;
}

/** The frame of the first node's section whose title object is on the canvas in one, with that section's title. */
function frameToJoin(
  nodes: readonly VisualNode[],
  sectionOf: ReadonlyMap<string, string>,
  matched: ReadonlyMap<string, ExistingObject>,
  plan: VisualPlan,
): { frameId: string; section: string | undefined } | null {
  for (const n of nodes) {
    const title = sectionOf.get(n.id);
    const frameId = title ? matched.get(title)?.frameId : undefined;
    if (!frameId) continue;
    const heading = plan.nodes.find((t) => t.id === title);
    return { frameId, section: heading?.type === "heading" ? heading.content.text : undefined };
  }
  return null;
}

/**
 * A new section as a grouped plan the renderer frames like a first run's (a group, its XL title keyed with the
 * group's `stableKey` — the key its flat heading is matched by next time — and its members). The group keeps the
 * grouped plan's own arrangement and kind when there is one (the local tier), else the template's arrangement.
 */
function sectionPlan(plan: VisualPlan, grouped: VisualPlan | null, titleId: string, nodes: readonly VisualNode[], relationships: VisualPlan["relationships"]): VisualPlan {
  const title = nodes.find((n) => n.id === titleId);
  const original = grouped?.nodes.find((n) => n.id === titleId && n.type === "group");
  const label = title?.type === "heading" ? title.content.text : "";
  const fallback = { id: titleId, type: "group", content: { label, arrangement: arrangementFor(plan.template) }, ...(title?.stableKey ? { stableKey: title.stableKey } : {}) } as VisualNode;
  const { parent: _parent, ...group } = original ?? fallback;
  // Explanations hang below their concepts; everything else is a member of the section.
  const explained = new Set(relationships.filter((r) => r.type === "explained_by").map((r) => r.to));
  const members = nodes.filter((n) => n.id !== titleId).map((n) => (explained.has(n.id) ? n : ({ ...n, parent: titleId } as VisualNode)));
  return { ...plan, template: "sectioned", nodes: [group as VisualNode, ...members], relationships };
}

/** The kind of a one-section plan's group, for its frame's label. */
function sectionRole(plan: VisualPlan): string | undefined {
  return plan.nodes.find((n) => n.type === "group")?.role;
}

/** Where a group of adds goes: below its concept, or in line after its existing predecessor; none for a group with neither. */
function groupAnchor(
  key: string,
  plan: VisualPlan,
  groupIds: ReadonlySet<string>,
  matched: ReadonlyMap<string, ExistingObject>,
  boxNow: (o: ExistingObject) => Box,
): Pick<RenderContext, "anchor" | "anchorSide" | "anchorIds"> {
  if (key.startsWith("below:")) {
    const parent = matched.get(key.slice("below:".length))!;
    return { anchor: boxNow(parent), anchorSide: "below", anchorIds: [parent.objectId] };
  }
  const linked = plan.relationships.filter((r) => r.type !== "explained_by");
  const before = linked.map((r) => (groupIds.has(r.to) ? matched.get(r.from) : undefined)).find((o) => o?.box);
  if (!before) return {};
  const after = linked.map((r) => (groupIds.has(r.from) ? matched.get(r.to) : undefined)).find((o) => o?.box);
  const from = boxNow(before);
  let side: "right" | "below" = DOWNWARD_LAYOUTS.has(templateFor(plan.template).layout) ? "below" : "right";
  if (after) {
    const to = boxNow(after);
    const dx = Math.abs(to.x + to.width / 2 - (from.x + from.width / 2));
    const dy = Math.abs(to.y + to.height / 2 - (from.y + from.height / 2));
    side = dx >= dy ? "right" : "below";
  }
  return { anchor: from, anchorSide: side, anchorIds: [before.objectId] };
}

/**
 * The revisions of an update's new text (G3.3): a section unchanged since the previous version keeps the revisions found then (no
 * model call); a changed or new one is asked about (`detectRevisions`, gated to sections with a revision cue). A merge
 * (`appendOnly`) asks nothing: it keeps the previous revisions still in the text — its own content is contradicted only as a choice.
 */
async function revisionsOf(input: UpdateInput, previous: readonly Revision[], runtime: AIRuntime, options: UpdateOptions): Promise<Revision[]> {
  const still = (r: Revision, text: string) => !!verbatim(text, r.earlier) && !!verbatim(text, r.later);
  if (options.appendOnly) return previous.filter((r) => still(r, input.text));
  const [{ parsed }, { parsed: previousParsed }] = await Promise.all([analyzeContent(input.text, { signal: options.signal }), analyzeContent(input.previous.text, { signal: options.signal })]);
  const before = new Map(analysisUnits(previousParsed, input.previous.text).map((u) => [u.key, normalizeUnitText(u.text)] as const));
  const units = analysisUnits(parsed, input.text);
  const unchanged = new Set(units.filter((u) => before.get(u.key) === normalizeUnitText(u.text)).map((u) => u.key));
  const kept = previous.filter((r) => unchanged.has(r.unit) && still(r, input.text));
  const asked = units.filter((u) => !unchanged.has(u.key));
  if (asked.length) options.onProgress?.({ stage: "analyzing", label: "Checking where the content changes its mind…" });
  return [...kept, ...(await detectRevisions(runtime, asked, options.signal))];
}

/**
 * A merge (`appendOnly`) is all or nothing. A section the model couldn't produce (a refused or failed call) falls back to its own
 * structure, which a first Visualize accepts with a warning; a merge into notes the user already has must not: it would be proposed as
 * done while part of it was never analysed. Same as a regenerated section failing (`updateOutlined`): nothing is proposed, nothing is
 * changed, and the user can run it again.
 */
function failIfIncomplete(failed: readonly { label: string; cause: string }[], options: UpdateOptions): void {
  if (!options.appendOnly || !failed.length) return;
  const names = failed.slice(0, 3).map((f) => `"${f.label}"`).join(", ") + (failed.length > 3 ? ", …" : "");
  throw new Error(`${failed.length} of the new sections couldn't be analysed (${names}: ${failed[0]!.cause}), so nothing was changed. Run the merge again.`);
}
