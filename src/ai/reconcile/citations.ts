/**
 * Citation-driven updates (Knowledge Notes plan §6.1, Phase 3, WP3.1–3.3; lanes log Lane G): with unit lineage
 * (§3.1, `sourceUnits.ts`), "Update from new content" narrows from the changed **section** to the **cards** that cite
 * a changed unit.
 *
 * | Lineage of a card's cited units | Decision |
 * |---|---|
 * | all `unchanged` (also when moved) | `keep`: no model call (the `preserve.ts` path). Moved together to one other topic → `moveTo`, a move, never remove + add |
 * | some `changed` | `resend`: the card with its current text and each unit's old → new text; the section's other cards are kept |
 * | any `ambiguous` (a candidate of an ambiguous unit) | `review`: never rewritten, marked "source changed", Needs review |
 * | all `removed` | `remove`: proposed, never silent |
 * | some `removed` | `recheck`: the card stays, re-checked against what's left, marked "source changed" |
 * | edited by the user, and anything but `unchanged` | `conflict` instead of `resend` (user edits always win, as `classify.ts`) |
 *
 * New units (and changed units no card cites) are listed per topic as new content for their section. A card that
 * cites nothing (made under `preserve`, or before unit ids) keeps the section path (`section`), as does a whole update
 * whose previous version has no units (an old canvas, §6.3) or while the flag is off.
 *
 * A resolved review flag stays resolved while the card's cited units are `unchanged` (WP3.3, `reviewAfterUpdate`).
 *
 * **Behind `CITATION_UPDATE_CONFIG.enabled`, off until R2.** Nothing here is wired into `update.ts`: the integrator
 * does that. Pure: no I/O, no model call; the resend prompt is built and its reply read here, sent elsewhere.
 */
import type { CardReview, Lineage, LineageEntry, ReviewFlag, SourceUnit, UnitId, UnitSet } from "@/ai/fidelity/contracts";

/** The switch for citation-driven updates (§6.3): off until release gate R2. A developer setting until then. */
export const CITATION_UPDATE_CONFIG: { readonly enabled: boolean } = { enabled: false };

/** One card of the source on the canvas, as the citation update needs it. Built by the caller from `ExistingObject` + `AIMetadata`. */
export interface CitedCard {
  objectId: string;
  stableNodeKey: string;
  /** `AIMetadata.sourceUnits`: ids of the previous version's units. Empty or absent: the card keeps the section path. */
  cites?: readonly UnitId[];
  /** Its content differs from what AI last wrote (`current !== baseline`, or not loaded). */
  edited: boolean;
  /** Opted out of AI updates (F39): left alone, whatever the source says. */
  excluded?: boolean;
  /** `AIMetadata.review`. */
  review?: CardReview;
}

export type CardAction = "keep" | "resend" | "conflict" | "review" | "recheck" | "remove" | "section" | "skip";

export interface UnitChange {
  unit: UnitId;
  before: string;
  after: string;
}

export interface CardDecision {
  objectId: string;
  stableNodeKey: string;
  action: CardAction;
  /** The topic its cited units all moved to (a move of the card, proposed as a move). */
  moveTo?: string;
  /** Its citations after the update: removed units dropped; ambiguous ones kept as they were until the user decides. */
  cites: UnitId[];
  /** Cited units whose text changed: old → new (the resend prompt's facts). */
  changes: UnitChange[];
  removed: UnitId[];
  /** Cited units that became ambiguous: the new unit and every old candidate. */
  ambiguous: { unit: UnitId; now: UnitId; candidates: UnitId[] }[];
  /** "source changed" / "source ambiguous" flags, for the review queue. */
  flags: ReviewFlag[];
}

export type SectionReason = "disabled" | "no_units" | "no_lineage" | "lineage_mismatch";

export type CitationUpdatePlan =
  | { mode: "sections"; reason: SectionReason }
  | {
      mode: "cards";
      cards: CardDecision[];
      /** Per topic, the cards to resend together (one call per section), in document order of their first cited unit. */
      resend: { topic: string; cards: string[] }[];
      /** Per topic, units to send as new content: added units, and changed units no card cites. */
      newContent: { topic: string; units: UnitId[] }[];
      /** New ids given to ambiguous units: not sent as new content (a card may already show them); their cards are in review. */
      ambiguousUnits: UnitId[];
      counts: Record<CardAction, number> & { moves: number };
    };

export interface CitationUpdateInput {
  previous: UnitSet;
  next: UnitSet;
  lineage: Lineage;
  /** The versions the two sets belong to, checked against the lineage. */
  previousVersion: number;
  nextVersion: number;
  cards: readonly CitedCard[];
  /** Overrides `CITATION_UPDATE_CONFIG.enabled` (tests, the developer setting). */
  enabled?: boolean;
}

const ACTIONS: readonly CardAction[] = ["keep", "resend", "conflict", "review", "recheck", "remove", "section", "skip"];

/** §6.1: what happens to each card, and what new content each section gets. */
export function planCitationUpdate(input: CitationUpdateInput): CitationUpdatePlan {
  if (!(input.enabled ?? CITATION_UPDATE_CONFIG.enabled)) return { mode: "sections", reason: "disabled" };
  if (!input.previous.units.length) return { mode: "sections", reason: "no_units" };
  if (!input.lineage.entries.length) return { mode: "sections", reason: "no_lineage" };
  if (input.lineage.fromVersion !== input.previousVersion || input.lineage.toVersion !== input.nextVersion) return { mode: "sections", reason: "lineage_mismatch" };

  const before = new Map(input.previous.units.map((u) => [u.id, u] as const));
  const after = new Map(input.next.units.map((u) => [u.id, u] as const));
  const order = new Map(input.next.units.map((u, i) => [u.id, i] as const));
  const { byOld, ambiguousOf } = indexLineage(input.lineage);

  const cards = input.cards.map((card) => decide(card, before, after, byOld, ambiguousOf));

  // Units some card cites (before the update): a changed one of these is the card's to resend, not new content.
  const citedBefore = new Set(input.cards.flatMap((c) => c.cites ?? []));
  const fresh = new Map<string, UnitId[]>();
  for (const e of input.lineage.entries) {
    const isNew = e.state === "added" || (e.state === "changed" && !citedBefore.has(e.from!));
    if (!isNew || !e.to) continue;
    const unit = after.get(e.to);
    if (!unit) continue;
    fresh.set(unit.topic, [...(fresh.get(unit.topic) ?? []), unit.id]);
  }
  const newContent = [...fresh].map(([topic, units]) => ({ topic, units: units.sort((a, b) => order.get(a)! - order.get(b)!) }));

  const groups = new Map<string, { at: number; cards: string[] }>();
  for (const d of cards) {
    if (d.action !== "resend") continue;
    const first = d.changes.map((c) => after.get(c.unit)!).sort((a, b) => order.get(a.id)! - order.get(b.id)!)[0]!;
    const topic = d.moveTo ?? first.topic;
    const g = groups.get(topic) ?? { at: order.get(first.id)!, cards: [] };
    g.cards.push(d.objectId);
    g.at = Math.min(g.at, order.get(first.id)!);
    groups.set(topic, g);
  }
  const resend = [...groups].sort((a, b) => a[1].at - b[1].at).map(([topic, g]) => ({ topic, cards: g.cards }));

  const counts = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<CardAction, number> & { moves: number };
  counts.moves = 0;
  for (const d of cards) {
    counts[d.action]++;
    if (d.moveTo !== undefined) counts.moves++;
  }
  const ambiguousUnits = input.lineage.entries.flatMap((e) => (e.state === "ambiguous" && e.to ? [e.to] : []));
  return { mode: "cards", cards, resend, newContent, ambiguousUnits, counts };
}

/** Old unit id → its entry (unchanged, changed, removed), and old unit id → the ambiguous entries naming it a candidate. */
function indexLineage(lineage: Lineage): { byOld: Map<UnitId, LineageEntry>; ambiguousOf: Map<UnitId, LineageEntry[]> } {
  const byOld = new Map<UnitId, LineageEntry>();
  const ambiguousOf = new Map<UnitId, LineageEntry[]>();
  for (const e of lineage.entries) {
    if (e.state === "ambiguous") for (const c of e.candidates ?? []) ambiguousOf.set(c, [...(ambiguousOf.get(c) ?? []), e]);
    else if (e.from) byOld.set(e.from, e);
  }
  return { byOld, ambiguousOf };
}

function decide(card: CitedCard, before: ReadonlyMap<UnitId, SourceUnit>, after: ReadonlyMap<UnitId, SourceUnit>, byOld: ReadonlyMap<UnitId, LineageEntry>, ambiguousOf: ReadonlyMap<UnitId, LineageEntry[]>): CardDecision {
  const cites = [...new Set(card.cites ?? [])];
  const base = { objectId: card.objectId, stableNodeKey: card.stableNodeKey };
  const empty = { cites, changes: [], removed: [], ambiguous: [], flags: [] };
  if (card.excluded) return { ...base, action: "skip", ...empty };
  // Cites nothing, or cites units the previous version doesn't have (another version's ids): the section path decides.
  if (!cites.length || cites.some((id) => !before.has(id))) return { ...base, action: "section", ...empty };

  const changes: UnitChange[] = [];
  const removed: UnitId[] = [];
  const ambiguous: CardDecision["ambiguous"] = [];
  const kept: UnitId[] = [];
  for (const id of cites) {
    const amb = ambiguousOf.get(id);
    if (amb?.length) {
      for (const e of amb) ambiguous.push({ unit: id, now: e.to!, candidates: e.candidates ?? [] });
      kept.push(id);
      continue;
    }
    const e = byOld.get(id);
    // No entry at all: the lineage doesn't cover it. Treated as removed, never as unchanged.
    if (!e || e.state === "removed" || !e.to || !after.has(e.to)) {
      removed.push(id);
      continue;
    }
    kept.push(e.to);
    if (e.state === "changed") changes.push({ unit: e.to, before: before.get(id)!.text, after: after.get(e.to)!.text });
  }

  // A move: every surviving cited unit now sits under one topic, and the card's units all sat under one other topic.
  const oldTopics = new Set(cites.map((id) => before.get(id)!.topic));
  const survivors = kept.filter((id) => after.has(id) && !ambiguous.some((a) => a.unit === id));
  const newTopics = new Set(survivors.map((id) => after.get(id)!.topic));
  const moveTo = survivors.length && oldTopics.size === 1 && newTopics.size === 1 && !oldTopics.has([...newTopics][0]!) ? [...newTopics][0]! : undefined;

  const flags: ReviewFlag[] = [];
  for (const a of ambiguous) {
    flags.push({ code: "source_ambiguous", unit: a.unit, card: card.objectId, detail: `the passage this card cites now matches ${a.candidates.length} places in the source`, evidence: { source: before.get(a.unit)!.text } });
  }
  if (removed.length && removed.length < cites.length) {
    for (const id of removed) flags.push({ code: "source_changed", unit: id, card: card.objectId, detail: "a passage this card cites was removed from the source", evidence: { source: before.get(id)!.text } });
  }

  const action: CardAction = ambiguous.length
    ? "review"
    : removed.length === cites.length
      ? "remove"
      : removed.length
        ? "recheck"
        : changes.length
          ? card.edited
            ? "conflict"
            : "resend"
          : "keep";
  return { ...base, action, ...(moveTo !== undefined && action !== "remove" ? { moveTo } : {}), cites: kept, changes, removed, ambiguous, flags };
}

// ---------------------------------------------------------------- review flags across updates (WP3.3)

/**
 * The card's review state after the update. While every unit it cites is `unchanged` (`keep`, also when moved), a
 * resolved flag stays resolved and its reasons stay as they were: re-running the checkers on the same text must not
 * bring it back. Otherwise the resolution no longer applies: the new reasons (the decision's flags and the checkers'
 * `fresh` ones) stand unresolved. Undefined when there is nothing to review.
 */
export function reviewAfterUpdate(previous: CardReview | undefined, decision: Pick<CardDecision, "action" | "flags">, fresh: readonly ReviewFlag[] = []): CardReview | undefined {
  if (decision.action === "skip" || decision.action === "section") return previous;
  if (decision.action === "keep") {
    if (previous?.resolved) return previous;
    const reasons = unique([...(previous?.reasons ?? []), ...fresh.map((f) => f.detail)]);
    return reasons.length ? { reasons } : undefined;
  }
  const reasons = unique([...decision.flags, ...fresh].map((f) => f.detail));
  return reasons.length ? { reasons } : undefined;
}

const unique = (xs: readonly string[]) => [...new Set(xs)];

// ---------------------------------------------------------------- the card-level resend (WP3.1)

/**
 * The rule for a card-level resend. The model sees cards under local ids (`c1`, …) and passages as text, never unit
 * ids (§3.1); it answers per card: unchanged, or the card rewritten for what the source now says.
 */
export const CARD_RESEND_RULE = [
  "Some passages of the source changed. Each card below cites passages; for each card you get its current title and body, the passages it cites that did not change, and each changed passage as before → after.",
  "Update a card only as far as the change requires: keep its wording, structure and title where the change doesn't affect them. Keep every qualifier, condition, cause, number and caveat the new passage has.",
  "If a change doesn't affect what the card says, answer it as unchanged.",
  'Reply with JSON only: {"cards":[{"id":"c1","unchanged":true},{"id":"c2","title":"…","body":"…"}]}, one entry per card, using the ids given.',
].join("\n");

export interface ResendCard {
  /** Local id the model answers with. */
  id: string;
  title: string;
  body: string;
  /** Cited passages that did not change, for context. */
  unchanged: string[];
  changes: { before: string; after: string }[];
}

export interface CardResendInput {
  rule: string;
  topic: string;
  cards: ResendCard[];
  /** Local id → object id, for reading the reply. Not sent. */
  objectOf: Record<string, string>;
}

/** One section's resend: its `resend` cards with their text (`textOf`; a card without text is left out and stays as it is). */
export function cardResendInput(topic: string, decisions: readonly CardDecision[], next: UnitSet, textOf: (objectId: string) => { title: string; body: string } | null): CardResendInput {
  const after = new Map(next.units.map((u) => [u.id, u] as const));
  const cards: ResendCard[] = [];
  const objectOf: Record<string, string> = {};
  for (const d of decisions) {
    if (d.action !== "resend") continue;
    const text = textOf(d.objectId);
    if (!text) continue;
    const id = `c${cards.length + 1}`;
    objectOf[id] = d.objectId;
    const changed = new Set(d.changes.map((c) => c.unit));
    cards.push({
      id,
      title: text.title,
      body: text.body,
      unchanged: d.cites.filter((u) => !changed.has(u) && after.has(u)).map((u) => after.get(u)!.text),
      changes: d.changes.map((c) => ({ before: c.before, after: c.after })),
    });
  }
  return { rule: CARD_RESEND_RULE, topic, cards, objectOf };
}

export type ResendOutcome = { kind: "unchanged" } | { kind: "rewritten"; title: string; body: string } | { kind: "missing"; problem: string };

/**
 * The reply, read leniently: per object id, unchanged, rewritten, or missing (no entry, or an entry that is neither).
 * A missing card is never rewritten: the caller marks it "source changed" for review.
 */
export function readCardResendReply(raw: unknown, input: Pick<CardResendInput, "objectOf">): Record<string, ResendOutcome> {
  const out: Record<string, ResendOutcome> = {};
  const entries = isObject(raw) && Array.isArray(raw.cards) ? raw.cards : [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const e of entries) if (isObject(e) && typeof e.id === "string" && !seen.has(e.id)) seen.set(e.id, e);
  for (const [local, objectId] of Object.entries(input.objectOf)) {
    const e = seen.get(local);
    if (!e) out[objectId] = { kind: "missing", problem: `no answer for card ${local}` };
    else if (e.unchanged === true) out[objectId] = { kind: "unchanged" };
    else if (typeof e.title === "string" && e.title.trim() && typeof e.body === "string") out[objectId] = { kind: "rewritten", title: e.title.trim(), body: e.body.trim() };
    else out[objectId] = { kind: "missing", problem: `card ${local} is neither unchanged nor a title and body` };
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
