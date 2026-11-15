/**
 * Knowledge Notes contracts (`.ai/docs/knowledge-notes-plan.md`, lane plan `.ai/docs/knowledge-notes-lanes.md`): the
 * shared types and function signatures the parallel lanes build against. Each lane implements its functions in its
 * own files and imports these types from here; nobody imports another lane's module until the integrator wires them.
 *
 * Owned by the integrator. A lane that needs a change here asks in the lanes log instead of editing this file.
 *
 * Types only, plus a few constant lists that are part of the contract (outcomes, omission reasons). Nothing here
 * changes behaviour: `preserve` stays exactly today's pipeline until R1 (§0.3, §6.3).
 */
import type { PathIds } from "@/ai/reconcile/topicIds";

// ---------------------------------------------------------------- note model (§6.2, §6.3)

/** Which rules a card was made under. `preserve` is today's behaviour; `distil` is a developer setting until R1. */
export type NoteModel = "preserve" | "distil";

// ---------------------------------------------------------------- source units (§3.1, Lane B)

/** Opaque, per source: `u` + a counter (`u17`). Never contains a heading. */
export type UnitId = string;

/** Paragraph sentence, list item, table row, whole code block, block quote sentence. */
export type SourceUnitKind = "sentence" | "list_item" | "table_row" | "code" | "quote";

/** Character range in one version's text, end exclusive (the parser's `SourceSpan`). */
export interface TextSpan {
  start: number;
  end: number;
}

export interface SourceUnit {
  id: UnitId;
  kind: SourceUnitKind;
  /** The unit's text as the source has it (a table row's cells joined with " | "). */
  text: string;
  /** cyrb53 (`ai/content/fingerprint.ts`) of the normalised text. */
  hash: string;
  /** The section's topic id: its heading path mapped through the version's `pathIds` (`topicIds.ts`). "" before the first heading. */
  topic: string;
  span: TextSpan;
  /** Neighbours in document order, for matching (§3.1 step 2–3). */
  prev?: UnitId;
  next?: UnitId;
}

/** The units of one version, and the next free counter so a later version never reuses an id. */
export interface UnitSet {
  units: SourceUnit[];
  /** The counter the next new unit takes (`u${nextId}`). */
  nextId: number;
}

/** Per old or new unit: what happened to it between two versions (§3.1 matching table). */
export type LineageState = "unchanged" | "changed" | "ambiguous" | "removed" | "added";

export interface LineageEntry {
  state: LineageState;
  /** The unit in the previous version; absent for `added`. */
  from?: UnitId;
  /** The unit in the new version; absent for `removed`. For `ambiguous`, the new id the unit got. */
  to?: UnitId;
  /** For `ambiguous`: the old units it could have been. Cards citing any of them go to Needs review. */
  candidates?: UnitId[];
  /** For `unchanged` / `changed`: it now sits under another topic (a move). */
  moved?: boolean;
}

export interface Lineage {
  fromVersion: number;
  toVersion: number;
  entries: LineageEntry[];
}

/** Lane B (`sourceUnits.ts`): a first version's units. Async because it parses (`parseContent`). */
export type SplitUnits = (text: string, options?: { pathIds?: PathIds; firstId?: number }) => Promise<UnitSet>;

/** Lane B: the next version's units, ids carried over by the §3.1 rules, and the lineage between the two. */
export type MatchVersions = (
  previous: UnitSet & { version: number },
  next: { text: string; version: number; pathIds?: PathIds },
) => Promise<{ units: UnitSet; lineage: Lineage }>;

/** Prompt label (`P2.3`, `L1.4`, `T1.r4`, `C1`) → unit id, per section. The model never sees ids (§3.1, WP1.4: integrator). */
export type UnitLabels = Readonly<Record<string, UnitId>>;

// ---------------------------------------------------------------- a card's review state (§4.1, §5.3, WP1.3)

/** How the user resolved a card's Needs review flag. Only the user's own action resolves one (OD5). */
export const REVIEW_RESOLUTIONS = ["kept", "edited", "included", "dismissed"] as const;
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];

/** The runtime model check's answer about one card (§3.4, `semanticCheck.ts`). Never "verified" (OD5). */
export type SemanticVerdict = "supported" | "partly" | "not_supported";

/**
 * `AIMetadata.review`: why a card needs review, and how the user resolved it (so a resolved flag doesn't return on every
 * update). A card is in Needs review while it has `reasons` and no `resolved` (`cardNeedsReview`).
 *
 * WP1.10: `hints` are the deterministic meaning rules' findings (`meaning.ts`, and the warn tier's named terms). They are
 * hints only (meaning-rules-evaluation-2026-10-19: false alarms 33–83% on fresh text): shown as the reason's detail, never a
 * reason of their own. `checked` is the model check's verdict when it ran (`FIDELITY_CONFIG.semanticCheck`): "checked by AI",
 * never "verified"; only `supported` keeps a card out of Needs review, and only the user's action resolves one.
 */
export interface CardReview {
  reasons: string[];
  hints?: string[];
  checked?: { by: "ai"; verdict: SemanticVerdict; reason?: string };
  resolved?: ReviewResolution;
}

/** Whether a card is in Needs review: it has a reason and the user hasn't resolved it. */
export const cardNeedsReview = (review: CardReview | undefined): boolean => !!review && review.reasons.length > 0 && !review.resolved;

// ---------------------------------------------------------------- a distil section reply (§4.4, WP1.5: integrator)

/**
 * What one section's distil reply cites and omits, read leniently from the raw reply (`readDistilReply` in
 * `visual-plan/validate.ts`). A missing or malformed part never fails generation: it is listed in `problems` and the
 * section goes to Needs review.
 */
export interface DistilReply {
  /** Per plan node id: the units it cites, labels already mapped to ids. Nodes that cite nothing are absent. */
  cites: Record<string, UnitId[]>;
  omitted: Omission[];
  /** What was missing or malformed, in plain words, for the log and the queue. */
  problems: string[];
  /** True when anything in `problems` means the section can't be confirmed: it degrades to Needs review. */
  needsReview: boolean;
}

// ---------------------------------------------------------------- cards as the checkers see them (§4)

/** One card of a reply, reduced to what the checkers need. Built by the integrator from a `VisualNode`. */
export interface Idea {
  /** The plan node id (per run). */
  id: string;
  title: string;
  /** Everything else the card says, as plain text (bullets joined with newlines). */
  body: string;
  /** Units the card cites, already mapped from labels to ids. */
  cites: UnitId[];
  /** Analysis cards may infer; the "unsupported" rules don't apply to them (§3.4). */
  origin?: "analysis";
  /** Placed by reference (`{"type":"source"}`): verbatim by construction. */
  byReference?: boolean;
}

// ---------------------------------------------------------------- coverage (§3.2, Lane C)

export const OMISSION_REASONS = ["filler", "duplicate", "superseded", "meta"] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];

export interface Omission {
  unit: UnitId;
  reason: OmissionReason;
  /** For `duplicate`: the unit it repeats (must itself be cited). */
  of?: UnitId;
}

/**
 * Why a unit is critical (§3.2). `open_question`: in a transcript, a question turn nobody answered (the next speaker
 * says "I don't know", or no one speaks after it); `decision` includes, in a transcript, a short assent turn right after
 * a proposal ("Kenji: I'd like that, yes.", "Marcus: Same.") and the proposal it accepts (`accounting.ts`,
 * `dialogueReasonsOf`).
 */
export type CriticalReason = "limitation" | "requirement" | "condition" | "decision" | "open_question" | "takeaway" | "protected";

/** Internal state per unit at the end of a run. */
export type UnitState = "cited" | "omitted" | "restored" | "review" | "pending";

/** The three words the user sees, everywhere (chips, panel, review bar). */
export type UnitOutcome = "represented" | "omitted" | "needs_review";

/** State → outcome. `cited` with a fidelity flag is Needs review too: that is decided by the flags, not the state. */
export const OUTCOME_OF_STATE: Readonly<Record<UnitState, UnitOutcome>> = {
  cited: "represented",
  restored: "represented",
  omitted: "omitted",
  review: "needs_review",
  pending: "needs_review",
};

export interface AccountingInput {
  units: readonly SourceUnit[];
  ideas: readonly Idea[];
  omitted: readonly Omission[];
  /** Units of sections that failed or were cut off. Never shown as complete. */
  pending?: readonly UnitId[];
  /** Units the takeaway cites: critical by rule. */
  takeawayCites?: readonly UnitId[];
  /** Units with protected content (from `protectedItems`): omitting one makes it `restored`. */
  protectedUnits?: ReadonlySet<UnitId>;
  /** Flags from exactness and meaning: a cited unit whose citing cards are all flagged is Needs review. */
  flags?: readonly ReviewFlag[];
  /**
   * Units whose dropped condition, caveat or requirement the app put back on a citing card as a "Limit:" line from the
   * source (§3.3/§3.4, `restoreLimits`): `restored` (Represented) when they would otherwise be `cited`.
   */
  restored?: readonly UnitId[];
}

export interface AccountingResult {
  state: Record<UnitId, UnitState>;
  outcome: Record<UnitId, UnitOutcome>;
  /** Why each unit is critical; units that aren't are absent. */
  critical: Record<UnitId, CriticalReason[]>;
  /** Every Needs review reason, with the unit it is about. */
  flags: ReviewFlag[];
  /** Per topic: counts per outcome and whether the omitted share passed the secondary-signal threshold (OD4). */
  sections: { topic: string; represented: number; omitted: number; needsReview: number; highOmittedShare: boolean }[];
}

/** Lane C (`accounting.ts`). Pure. */
export type AccountUnits = (input: AccountingInput) => AccountingResult;

/** Lane C: why a unit is critical (cue words from `config/fidelityCues.ts`, protected content, takeaway). Pure. */
export type CriticalReasonsOf = (
  unit: SourceUnit,
  context: { protectedUnits?: ReadonlySet<UnitId>; takeawayCites?: readonly UnitId[]; /** Turn-level reasons of a transcript (`dialogueReasonsOf`). */ dialogue?: ReadonlyMap<UnitId, readonly CriticalReason[]> },
) => CriticalReason[];

// ---------------------------------------------------------------- exactness (§3.3, Lane C)

export type ProtectedKind = "number" | "version" | "path" | "identifier" | "quote" | "item_id" | "action_item" | "named_term" | "table" | "code";

export interface ProtectedItem {
  tier: "exact" | "warn";
  kind: ProtectedKind;
  /** As the source has it. Compared after `normalizeForCompare`. */
  value: string;
  unit: UnitId;
}

/** Lane C (`exactness.ts`): the protected items of each unit. Pure. */
export type ProtectedItemsOf = (units: readonly SourceUnit[]) => ProtectedItem[];

/** Lane C: exact items missing from every card citing their unit, and warn-tier changes as flags. Pure. */
export type CheckExactness = (items: readonly ProtectedItem[], ideas: readonly Idea[]) => { missing: ProtectedItem[]; flags: ReviewFlag[] };

/** Lane C: thousands separators, Unicode quotes and dashes, markdown markers, trailing punctuation, whitespace, unit spellings. */
export type NormalizeForCompare = (text: string, options?: { keepCase?: boolean }) => string;

// ---------------------------------------------------------------- meaning (§3.4, Lane C)

/** A reason for Needs review. One code per rule; the integrator turns them into chip and queue wording. */
export type ReviewCode =
  // coverage
  | "critical_omitted"
  | "duplicate_of_uncited"
  | "unaccounted"
  | "pending"
  // a card citing no source unit (a distil reply's `cites` missing or unreadable, WP1.10)
  | "uncited_card"
  // exactness
  | "exact_missing"
  | "named_term_changed"
  // meaning
  | "qualifier_dropped"
  // a cost or caveat joined to the claim ("faster but uses more memory") dropped, or turned into its better side
  | "caveat_dropped"
  | "condition_changed"
  | "cause_changed"
  | "absolute_added"
  | "negation_flip"
  | "unsupported_number"
  | "citation_unrelated"
  // a critical unit cited only by cards that drop its condition, caveat or requirement (`representation.ts`)
  | "critical_dropped"
  // the runtime model check (§3.4, `FIDELITY_CONFIG.semanticCheck`): "partly" or "not supported", or no answer
  | "ai_check"
  // a card longer than the source passages it cites (protected details aside): a hint only, never Needs review
  | "longer_than_source"
  // updates (Phase 3)
  | "source_changed"
  | "source_ambiguous";

export interface ReviewFlag {
  code: ReviewCode;
  /** The unit it is about, when there is one. */
  unit?: UnitId;
  /** The card (Idea.id) it is about, when there is one. */
  card?: string;
  /** Plain words for the queue: `source says "when the cache contains a valid result"`. */
  detail: string;
  /** The source and card fragments the rule compared, for the side-by-side view. */
  evidence?: { source?: string; card?: string };
}

/** Lane C (`meaning.ts`): the §3.4 rules for one card against the units it cites. Pure. */
export type CheckMeaning = (idea: Idea, cited: readonly SourceUnit[]) => ReviewFlag[];

/** §7.2 kinds; every kind is reported on its own, never averaged. */
export const MEANING_KINDS = ["qualifier", "condition", "negation", "cause", "quantity", "trade_off", "scope", "compound"] as const;
export type MeaningKind = (typeof MEANING_KINDS)[number];

/** One labelled pair of `__fixtures__/meaning/pairs.json`. Labels are drafts until the user labels the set (OD7, G0). */
export interface MeaningPair {
  id: string;
  kind: MeaningKind;
  source: string;
  card: string;
  label: "faithful" | "distorted";
  /** The ReviewCode a rule should raise for a distorted pair. */
  expect?: ReviewCode;
  note?: string;
  labelledBy: "draft" | string;
}

// ---------------------------------------------------------------- source panel (§5, Lane D)

/** Everything the Source tab shows, built by the integrator from storage. Lane D builds against stub data. */
export interface SourcePanelData {
  sourceId: string;
  /** The version the selected card was made from. */
  version: number;
  latestVersion: number;
  text: string;
  /** Section outline: topic, heading and where it sits. */
  sections: { topic: string; heading: string; level: number; span: TextSpan }[];
  /** Empty for a source recorded before unit ids: the panel then highlights by span only. */
  units: SourceUnit[];
  outcome: Record<UnitId, UnitOutcome>;
  /** Reason per unit for Omitted (the omission reason) and Needs review (the flag details). */
  reasons: Record<UnitId, string[]>;
  /** Units some card on the canvas cites, for the "Not on canvas" filter. Absent: fall back to "not Represented". */
  onCanvas?: UnitId[];
  /** Present when `latestVersion > version`: what changed (§5.1 "What changed"). */
  lineage?: Lineage;
}

export type SourcePanelState = { kind: "ready"; data: SourcePanelData } | { kind: "unavailable" } | { kind: "loading" };

export type SourceFilter = "all" | "needs_review" | "omitted" | "not_on_canvas";

/** Props of `components/source/SourcePanel.tsx`. The integrator mounts it in the side panel and supplies the callbacks. */
export interface SourcePanelProps {
  state: SourcePanelState;
  /** Units the selected card cites (highlighted and stepped through, "1 of 3"). Spans when units are empty. */
  selection: { units: UnitId[]; spans?: TextSpan[] };
  /** The user selected a passage: outline the cards citing these units. */
  onSelectPassage?: (units: UnitId[]) => void;
  onAddToCanvas?: (unit: UnitId) => void;
  onPinQuote?: (unit: UnitId) => void;
  onInclude?: (unit: UnitId) => void;
  onViewLatest?: () => void;
  reducedMotion?: boolean;
}

// ---------------------------------------------------------------- export with sources (§6.4, Lane E)

/** One content source in an `.acute.json` bundle's optional `sources` section. */
export interface BundledSource {
  id: string;
  canvasId: string;
  origin: "paste" | "import" | "mcp";
  tier: "local" | "ai";
  template: string;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  versions: {
    version: number;
    text: string;
    plan: unknown;
    pathIds?: Record<string, string>;
    revisions?: { unit: string; earlier: string; later: string }[];
    /** Present once WP1.3 stores them; passed through untouched. */
    units?: UnitSet;
    lineage?: Lineage;
    createdAt: number;
  }[];
}

// ---------------------------------------------------------------- one run, as the evaluation sees it (Lane A)

/**
 * What a Visualize run hands the golden evaluation (`evaluation/knowledge-notes/`) besides the plan. Everything but
 * `plan` is absent for `preserve` runs and for recordings made before the fields existed; the evaluation then marks
 * the assertions that need them `not_evaluable`, never passed.
 */
export interface KnowledgeRunOutput {
  noteModel: NoteModel;
  /** The merged, validated VisualPlan. */
  plan: unknown;
  units?: UnitSet;
  /** Per plan node id: units it cites. */
  cites?: Record<string, UnitId[]>;
  omitted?: Omission[];
  accounting?: AccountingResult;
  /** Needs review reasons only (accounting's, exactness's, uncited cards, the model check's). Never the meaning hints. */
  flags?: ReviewFlag[];
  /** The deterministic meaning rules' findings: hints only, never a Needs review reason on their own (WP1.10). */
  hints?: ReviewFlag[];
  /** Per plan node id: the card's review state, when it needs review or the model check looked at it. */
  reviews?: Record<string, CardReview>;
  /**
   * The cards the reader sees that span several plan nodes (a shape with the text that explains it, a label shape with
   * the card covering its units: `cardViews`), each as its node ids, the card's own node first. A node in no group is a
   * card on its own. G1 counts cards, not nodes (plan §9 G1; `e2e/fidelityScore.ts`).
   */
  cardGroups?: string[][];
}
