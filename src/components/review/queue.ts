/**
 * The review queue's items and actions (knowledge-notes-plan §5.3, WP2.6; Lane H). "Review N" steps through every
 * Needs review item, one per object (the indicator budget): a flagged card, or a passage no card carries (left out
 * for a reason that needs checking, unaccounted, not processed).
 *
 * Pure. Built from the run's flags when there are any, and from the cards' stored `AIMetadata.review` otherwise, so a
 * flagged card stays in the queue after Accept and after a reload until the user resolves it (U3, U8). The integrator
 * stores resolutions: on the card (`CardReview.resolved`), and for passage items wherever it keeps them (see the
 * lanes log's Requests), passed back in as `resolvedUnits`.
 */
import type { CardReview, ReviewFlag, ReviewResolution, SourceUnit, UnitId } from "@/ai/fidelity/contracts";
import { isOpenReview, reasonText } from "./wording";

export type ReviewAction = "keep" | "edit" | "use_source_wording" | "include" | "dismiss";

export const ACTION_LABEL: Readonly<Record<ReviewAction, string>> = {
  keep: "Keep",
  edit: "Edit",
  use_source_wording: "Use source wording",
  include: "Include",
  dismiss: "Dismiss",
};

export const ACTION_HINT: Readonly<Record<ReviewAction, string>> = {
  keep: "The card stays as it is; the flag is resolved",
  edit: "Opens the card; saving it resolves the flag",
  use_source_wording: "Pins the passage, word for word, on the card",
  include: "Adds a card for this passage",
  dismiss: "Confirms it was right to leave this out",
};

/** A card as the queue needs it (built by the integrator from the canvas object and its `AIMetadata`). */
export interface ReviewCard {
  id: string;
  title: string;
  body: string;
  cites: readonly UnitId[];
  review?: CardReview;
}

export interface ReviewItem {
  /** `card:<id>` or `unit:<id>`: stable across rebuilds, so the queue keeps its place. */
  key: string;
  kind: "card" | "unit";
  card?: ReviewCard;
  /** The passages shown beside it, in document order. */
  units: SourceUnit[];
  /** Reason lines, in order ("condition changed: source says …"). */
  reasons: string[];
  /** The source and card fragments a rule compared, when it gave them (for highlighting). */
  evidence: { source?: string; card?: string }[];
  actions: ReviewAction[];
}

export interface QueueInput {
  units: readonly SourceUnit[];
  cards: readonly ReviewCard[];
  /** The run's flags (`AccountingResult.flags`). Empty or absent after a reload: the cards' stored reviews are used. */
  flags?: readonly ReviewFlag[];
  /** Passage items the user already resolved (Include or Dismiss). */
  resolvedUnits?: Readonly<Record<UnitId, ReviewResolution>>;
}

/** Every open item, in document order (by its first passage); items with no passage last, in input order. */
export function buildReviewQueue({ units, cards, flags = [], resolvedUnits = {} }: QueueInput): ReviewItem[] {
  const unitById = new Map(units.map((u) => [u.id, u] as const));
  const order = new Map(units.map((u, i) => [u.id, i] as const));
  const cardById = new Map(cards.map((c) => [c.id, c] as const));
  const citedBy = new Map<UnitId, string[]>();
  for (const c of cards) for (const u of c.cites) citedBy.set(u, [...(citedBy.get(u) ?? []), c.id]);

  const byCard = new Map<string, ReviewFlag[]>();
  const byUnit = new Map<UnitId, ReviewFlag[]>();
  for (const f of flags) {
    // A unit-wide flag on a cited unit is about the cards citing it (one item per object, the first citing card).
    const cardId = f.card !== undefined && cardById.has(f.card) ? f.card : f.unit !== undefined ? citedBy.get(f.unit)?.[0] : undefined;
    if (cardId !== undefined) byCard.set(cardId, [...(byCard.get(cardId) ?? []), f]);
    else if (f.unit !== undefined && unitById.has(f.unit)) byUnit.set(f.unit, [...(byUnit.get(f.unit) ?? []), f]);
    // A flag about neither (a section-level problem) is the section chip's to show, not the queue's.
  }

  const items: ReviewItem[] = [];
  const sortUnits = (ids: Iterable<UnitId>) =>
    [...new Set(ids)].flatMap((id) => (unitById.has(id) ? [unitById.get(id)!] : [])).sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  for (const card of cards) {
    if (card.review?.resolved) continue;
    const mine = byCard.get(card.id);
    const reasons = mine?.length ? [...new Set(mine.map(reasonText))] : isOpenReview(card.review) ? card.review!.reasons : [];
    if (!reasons.length) continue;
    const flagged = (mine ?? []).flatMap((f) => (f.unit !== undefined ? [f.unit] : []));
    const shown = sortUnits(flagged.length ? flagged : card.cites);
    items.push({
      key: `card:${card.id}`,
      kind: "card",
      card,
      units: shown,
      reasons,
      evidence: (mine ?? []).flatMap((f) => (f.evidence ? [f.evidence] : [])),
      actions: shown.length ? ["keep", "edit", "use_source_wording"] : ["keep", "edit"],
    });
  }
  for (const [id, mine] of byUnit) {
    if (resolvedUnits[id]) continue;
    // Not processed: Include adds it; dismissing would show it as complete, which it never is (§3.2). Retry is the section's.
    const pending = mine.every((f) => f.code === "pending");
    items.push({
      key: `unit:${id}`,
      kind: "unit",
      units: [unitById.get(id)!],
      reasons: [...new Set(mine.map(reasonText))],
      evidence: mine.flatMap((f) => (f.evidence ? [f.evidence] : [])),
      actions: pending ? ["include"] : ["include", "dismiss"],
    });
  }

  const at = (item: ReviewItem) => (item.units.length ? order.get(item.units[0]!.id)! : Number.POSITIVE_INFINITY);
  return items.map((item, i) => ({ item, i })).sort((a, b) => at(a.item) - at(b.item) || a.i - b.i).map((x) => x.item);
}

/** What an action asks the integrator to do. `resolution` is absent for Edit: saving the card resolves it (`edited`). */
export interface ReviewDecision {
  key: string;
  action: ReviewAction;
  resolution?: ReviewResolution;
  card?: string;
  /** The passage(s) it is about: pinned by Use source wording, added by Include, confirmed omitted by Dismiss. */
  units: UnitId[];
}

const RESOLUTION: Readonly<Record<ReviewAction, ReviewResolution | undefined>> = {
  keep: "kept",
  edit: undefined,
  use_source_wording: "edited",
  include: "included",
  dismiss: "dismissed",
};

export function decisionFor(item: ReviewItem, action: ReviewAction): ReviewDecision {
  if (!item.actions.includes(action)) throw new Error(`"${action}" isn't offered for ${item.key}`);
  const resolution = RESOLUTION[action];
  return { key: item.key, action, ...(resolution ? { resolution } : {}), ...(item.card ? { card: item.card.id } : {}), units: item.units.map((u) => u.id) };
}

/** The card's review with the user's resolution recorded. Only the user's action resolves one (OD5). */
export function resolveReview(review: CardReview | undefined, resolution: ReviewResolution): CardReview {
  return { reasons: review?.reasons ?? [], resolved: resolution };
}

/**
 * Where the queue stands after its items change (an item resolved and dropped, a new run): the same item if it is
 * still there, else the one that took its place, else the last. -1 when the queue is empty.
 */
export function nextIndex(items: readonly ReviewItem[], previous: { key: string | null; index: number }): number {
  if (!items.length) return -1;
  const same = previous.key === null ? -1 : items.findIndex((i) => i.key === previous.key);
  if (same >= 0) return same;
  return Math.min(Math.max(previous.index, 0), items.length - 1);
}

/** `index` moved by `delta`, wrapping. */
export function stepIndex(index: number, length: number, delta: number): number {
  return length ? (((index + delta) % length) + length) % length : -1;
}

/** `text` split around the first occurrence of `fragment` (case-insensitive), for marking what a rule compared. */
export function markParts(text: string, fragment: string | undefined): { text: string; mark: boolean }[] {
  const f = fragment?.trim();
  if (!f) return [{ text, mark: false }];
  const at = text.toLowerCase().indexOf(f.toLowerCase());
  if (at < 0 || f.length === text.length) return [{ text, mark: false }];
  return [
    ...(at ? [{ text: text.slice(0, at), mark: false }] : []),
    { text: text.slice(at, at + f.length), mark: true },
    ...(at + f.length < text.length ? [{ text: text.slice(at + f.length), mark: false }] : []),
  ];
}
