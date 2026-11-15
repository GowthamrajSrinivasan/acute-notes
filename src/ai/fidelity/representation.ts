/**
 * Whether a card that cites a unit actually represents it (knowledge-notes-plan §3.2, §3.4; the live runs of
 * 2026-10-19, `.ai/docs/knowledge-notes-live-2026-10-19.md`). Two deterministic checks, run on every distil section;
 * both put the card in Needs review and stop it counting the unit as Represented (`accounting.ts`, `NOT_REPRESENTING`):
 *
 * 1. **Citation sanity** (`citation_unrelated`): the card shares no significant word, key term or quantity with a unit
 *    it cites. A unit too short to judge (fewer than `MIN_JUDGED_WORDS` significant words once a "Name:" speaker label
 *    is set aside: "Kenji: I'd like that, yes.") is never called unrelated.
 * 2. **Critical content kept** (`critical_dropped`): a critical unit's condition, caveat or requirement clause
 *    (`criticalClausesOf`, from the same cue lists that make it critical, with greetings and sign-offs set aside) must
 *    be on a card citing it: at least `FIDELITY_CUES.conditionOverlap` (50%) of the clause's significant words, as the
 *    condition rule compares them, after quantities are normalised ("0.25 s" = "250 ms"). When **no** citing card keeps
 *    every clause, each citing card gets the flag, naming what it drops ("the card drops the condition "when …"").
 *    A card the model check answered "supported" (`aiSupported`, OD5b) keeps the unit: the paraphrase was judged
 *    faithful, and the rule's words stay as a hint ("checked by AI" never reads "verified").
 *
 * **A card is read with its explanations** (`cardViews`, the live run of 2026-10-20): a diagram shape whose label
 * ("Retrieve Candidates") is all it shows, and whose content sits in a text node linked from it with `explained_by`, is
 * one card. Both checks read the shape's label, sublabel and details plus every linked explanation's text, against
 * every unit any of them cites; a node that only explains another card is not checked on its own. A flag found on the
 * card goes on each of its nodes that cites the unit, so accounting (which counts per node) agrees.
 *
 * **A diagram label with no explanation** (a shape of at most `LABEL_MAX_WORDS` words that no text explains) is checked
 * together with the full card that already cites every unit it cites (offline fixes of 2026-10-20 (2)): it joins that
 * card's view. `cardViews` says why this rule and not "skip label shapes". A label citing a unit no full card covers is
 * checked alone, as before. Links between shapes (`flows_to`, `relates_to`) never group cards, and nothing here adds a
 * link to the plan.
 *
 * **Card length** (`lengthHints`): a card longer than the source passages it cites (protected details and restored
 * source lines aside) gets a `longer_than_source` hint. A hint only, never Needs review: §4.2 lets a card hold what its
 * idea needs, and the observed canvas-words share is not a gate (§9).
 *
 * Protected items (§3.3) are checked by `exactness.ts` and put back by `restoreProtected`; they are not repeated here.
 * Analysis cards may infer and blocks placed by reference are verbatim, so neither is checked. Pure.
 */
import { FIDELITY_CUES, findCues, withoutFiller } from "@/config/fidelityCues";
import type { Idea, ProtectedItem, ReviewFlag, SourceUnit, UnitId } from "./contracts";
import { normalizeForCompare, plainText } from "./exactness";
import { keyTerms, significant } from "./information";
import { stem } from "./meaning";
import { normalizeQuantities, quantitiesOf, sameQuantity } from "./quantities";

/** A unit with fewer significant words than this (speaker label aside) is too short to call a citation unrelated. */
export const MIN_JUDGED_WORDS = 3;

/** A critical clause with fewer significant words than this is too short to call dropped (`cardKeepsClause`). */
export const MIN_CLAUSE_WORDS = 2;

export type CriticalClauseKind = "condition" | "caveat" | "requirement";

export interface CriticalClause {
  kind: CriticalClauseKind;
  /** The cue as it is written in the unit ("when", "but", "must"). */
  marker: string;
  /** What the cue governs: the condition, the caveat, what is required. */
  clause: string;
}

/** `stem`, with a doubled final consonant undone, so "logged" and "logs", "skipped" and "skips" compare equal. */
const stemOf = (w: string) => stem(w).replace(/([b-df-hj-np-tv-z])\1$/, "$1");

/** Stems of a text's significant words, quantities normalised first ("two thousand" → "2000"). */
function stemsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of significant(normalizeQuantities(plainText(text)))) {
    out.add(stemOf(w));
    if (w.includes("-")) for (const part of significant(w.replace(/-/g, " "))) out.add(stemOf(part));
  }
  return out;
}

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].filter((x) => b.has(x)).length;

/** "Kenji: I'd like that, yes." → "I'd like that, yes." (a transcript's speaker label is not content). */
const SPEAKER = /^\s*[\p{Lu}][\p{L}'’.-]*(?:\s[\p{Lu}][\p{L}'’.-]*)?:\s+/u;

/** Whether a card's text is about a unit at all: a shared significant word, key term or quantity. */
export function relatedToUnit(card: string, unitText: string): boolean {
  const text = plainText(unitText);
  if (significant(text.replace(SPEAKER, "")).length < MIN_JUDGED_WORDS) return true;
  const cardText = plainText(card);
  if (overlap(stemsOf(text), stemsOf(cardText)) > 0) return true;
  const cardTerms = new Set(keyTerms(normalizeForCompare(cardText)));
  if (keyTerms(normalizeForCompare(text)).some((t) => cardTerms.has(t))) return true;
  const cardQ = quantitiesOf(cardText);
  return quantitiesOf(text).some((q) => cardQ.some((c) => sameQuantity(q, c)));
}

/** Whether position `i` ends a sentence: ";" or a line break, or ".", "!", "?" before a space or the end ("0.25" doesn't). */
const endsSentence = (text: string, i: number) => /[\n;]/.test(text[i]!) || (/[.!?]/.test(text[i]!) && (i + 1 >= text.length || /\s/.test(text[i + 1]!)));

/** The end of the sentence around `at`. */
function sentenceEnd(text: string, at: number): number {
  let end = at;
  while (end < text.length && !endsSentence(text, end)) end++;
  return end;
}

function sentenceStart(text: string, at: number): number {
  let start = at;
  while (start > 0 && !endsSentence(text, start - 1)) start--;
  return start;
}

/** From `end` to the next comma or "then" (or the sentence's end): a condition's or requirement's clause. */
function clauseAfter(text: string, end: number): string {
  const rest = text.slice(end, sentenceEnd(text, end));
  const stop = rest.search(/,|\bthen\b/);
  return (stop >= 0 ? rest.slice(0, stop) : rest).trim();
}

const CONTRASTS = new Set(["however", "but", "although", "though", "except"]);

/**
 * A critical unit's clauses (§3.2): the condition after "if / when / unless …", the caveat after "but / however …" (or
 * before the comma of a leading "Although …,"), the limitation after "does not / cannot …", and what is required after
 * "must / never / at most …". Greetings, sign-offs and meta phrases are set aside first (`withoutFiller`). One clause
 * per cue, overlapping cues once (the longest).
 */
export function criticalClausesOf(unitText: string): CriticalClause[] {
  const text = withoutFiller(plainText(unitText));
  const { condition, limitation, requirement } = FIDELITY_CUES.critical;
  const tagged = [
    ...findCues(text, condition).map((m) => ({ ...m, kind: "condition" as const })),
    ...findCues(text, requirement).map((m) => ({ ...m, kind: "requirement" as const })),
    ...findCues(text, limitation).map((m) => ({ ...m, kind: "caveat" as const })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof tagged = [];
  for (const m of tagged) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  const out: CriticalClause[] = [];
  for (const m of kept) {
    const marker = text.slice(m.start, m.end);
    let clause: string;
    if (m.kind === "caveat" && CONTRASTS.has(m.cue)) {
      const start = sentenceStart(text, m.start);
      const end = sentenceEnd(text, m.start);
      const leading = !text.slice(start, m.start).trim();
      const comma = text.indexOf(",", m.end);
      if (leading && comma >= 0 && comma < end) {
        // "Although X, Y": X is the caveat; "However, X": X is what follows the comma.
        const before = text.slice(m.end, comma).trim();
        clause = before ? before : text.slice(comma + 1, end).trim();
      } else clause = text.slice(m.end, end).trim();
    } else clause = clauseAfter(text, m.end);
    if (stemsOf(clause).size) out.push({ kind: m.kind, marker, clause });
  }
  // A cue inside another cue's clause ("…, which ours do not today" inside "However, the caching argument only applies if
  // …") is part of that clause, not a clause of its own: kept once, as the larger one (2026-10-20 (2), live replay f08).
  const squash = (c: CriticalClause) => `${c.marker} ${c.clause}`.toLowerCase().replace(/\s+/g, " ");
  return out.filter((c, i) => !out.some((o, j) => j !== i && o.clause.toLowerCase().replace(/\s+/g, " ").includes(squash(c))));
}

/** Whether a card carries a clause: at least `conditionOverlap` of its significant words (§3.4's condition rule). */
export function cardKeepsClause(card: string, clause: CriticalClause): boolean {
  const stems = stemsOf(clause.clause);
  // A clause of one significant word ("I don't know", "when they remember") is too short to judge by overlap: never
  // "dropped" (2026-10-20 (2): such clauses gave "Limit: Don't know" lines on kn-05's recorded plan).
  if (stems.size < MIN_CLAUSE_WORDS) return true;
  return overlap(stems, stemsOf(card)) / stems.size >= FIDELITY_CUES.conditionOverlap;
}

const NAME: Record<CriticalClauseKind, string> = { condition: "condition", caveat: "caveat", requirement: "requirement" };

const short = (text: string, max = 100) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

/** A clause as the source words it: its cue and what the cue governs ("when the cache holds a valid result"). */
export const clauseText = (clause: CriticalClause) => `${clause.marker} ${clause.clause}`.trim();

/** The words a reader sees for a dropped clause: `the card drops the condition "when the cache holds a valid result"`. */
export function droppedClauseDetail(clause: CriticalClause): string {
  return `the card drops the ${NAME[clause.kind]} "${short(clauseText(clause))}"`;
}

/** The kind of clause a `critical_dropped` flag names (read from its detail), for the retry's words. */
export function droppedKindOf(flag: Pick<ReviewFlag, "detail">): CriticalClauseKind {
  const m = /drops the (condition|caveat|requirement)\b/.exec(flag.detail);
  return (m?.[1] as CriticalClauseKind | undefined) ?? "condition";
}

/**
 * The card a dropped clause belongs on, of the cards citing its unit: the one sharing the most significant words with
 * the unit (the card that makes the claim the clause limits); the first in reply order on a tie.
 */
export function limitHost<T extends Idea>(unitText: string, cards: readonly T[]): T | undefined {
  const unit = stemsOf(unitText);
  let best: T | undefined;
  let bestScore = -1;
  for (const card of cards) {
    const score = overlap(unit, stemsOf(cardText(card)));
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

const cardText = (idea: Idea) => [idea.title, idea.body].filter((s) => s.trim()).join("\n");

/** Explanation node id → the node it explains (the `from` of an `explained_by` link to it; the first link wins). */
export type ExplainedBy = ReadonlyMap<string, string>;

/** A card as the checks read it: its own node plus the nodes that explain it. */
export interface CardView extends Idea {
  /** The card's node first, then its explanations, in the order of `ideas`. */
  members: string[];
}

/** A diagram shape with at most this many words in all (label, sublabel, details) shows a label, not a claim. */
export const LABEL_MAX_WORDS = 4;

const wordCount = (text: string) => plainText(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** What `cardViews` reads besides the ideas: the reply's `explained_by` links, and which nodes are diagram shapes. */
export interface CardLinks {
  explainedBy?: ExplainedBy;
  /** Ids of the reply's `shape` nodes: a label-only one may join the full card that covers its units. */
  shapes?: ReadonlySet<string>;
}

/**
 * The section's cards with their explanations folded in: a node linked from another card with `explained_by` (a chain
 * is followed to its first card) joins that card. The view keeps the card's id, title, origin and `byReference`; its
 * body adds each explanation's title and text; it cites every unit any of its nodes cites. Analysis nodes are never
 * folded (they may infer), and nothing is folded into an analysis card. Without links, one view per idea, unchanged.
 *
 * **A label-only shape with no explanation** (a `shapes` node of at most `LABEL_MAX_WORDS` words, alone in its view,
 * citing at least one unit) joins the first full card (a view of more than `LABEL_MAX_WORDS` words, not analysis, not
 * by reference) that already cites every unit the label cites. Why join rather than skip such labels: the label stays
 * in what the model check and the rules read, so a label that contradicts its card ("Always cache") is still seen; its
 * citation is judged against the card that says what the unit says (a shape "Cache" citing "It is only a copy kept
 * for speed…" is not an unrelated citation when the card beside it explains that); and the reader sees one idea, which
 * is how G1 counts cards. A label citing a unit no single full card covers is checked alone: nothing else says what it
 * claims. Only `explained_by` folds; `flows_to` and other links between step shapes never group cards, and no link is
 * added to the plan.
 */
export function cardViews(ideas: readonly Idea[], links: ExplainedBy | CardLinks = new Map()): CardView[] {
  const isMap = (x: ExplainedBy | CardLinks): x is ExplainedBy => typeof (x as ExplainedBy).get === "function";
  const { explainedBy = new Map<string, string>(), shapes = new Set<string>() }: CardLinks = isMap(links) ? { explainedBy: links } : links;
  const byId = new Map(ideas.map((i) => [i.id, i] as const));
  const order = new Map(ideas.map((i, n) => [i.id, n] as const));
  const headOf = (idea: Idea): string => {
    const path = [idea];
    let at = idea;
    while (at.origin !== "analysis") {
      const up = byId.get(explainedBy.get(at.id) ?? "");
      if (!up || up.origin === "analysis") break;
      const back = path.indexOf(up);
      // A cycle of links: its first node (in the reply's order) is the card, whichever node the walk started from.
      if (back >= 0) return path.slice(back).reduce((a, b) => (order.get(b.id)! < order.get(a.id)! ? b : a)).id;
      path.push(up);
      at = up;
    }
    return at.id;
  };
  const groups = new Map<string, Idea[]>();
  for (const idea of ideas) {
    const head = headOf(idea);
    groups.set(head, [...(groups.get(head) ?? []), idea]);
  }
  // A label-only shape joins the first full card covering its units (see above).
  const words = (group: readonly Idea[]) => group.reduce((n, m) => n + wordCount(cardText(m)), 0);
  const full = ideas.filter((i) => groups.has(i.id) && i.origin !== "analysis" && !i.byReference && words(groups.get(i.id)!) > LABEL_MAX_WORDS);
  for (const idea of ideas) {
    const group = groups.get(idea.id);
    if (!group || group.length !== 1 || !shapes.has(idea.id) || idea.origin === "analysis" || idea.byReference || !idea.cites.length) continue;
    if (wordCount(cardText(idea)) > LABEL_MAX_WORDS) continue;
    const host = full.find((f) => f.id !== idea.id && groups.has(f.id) && idea.cites.every((u) => groups.get(f.id)!.some((m) => m.cites.includes(u))));
    if (!host) continue;
    groups.get(host.id)!.push(idea);
    groups.delete(idea.id);
  }
  return ideas.flatMap((idea): CardView[] => {
    const group = groups.get(idea.id);
    if (!group) return [];
    const rest = group.filter((m) => m.id !== idea.id).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    if (!rest.length) return [{ ...idea, members: [idea.id] }];
    const body = [idea.body, ...rest.map(cardText)].filter((s) => s.trim()).join("\n");
    const cites = [...new Set([idea, ...rest].flatMap((m) => m.cites))];
    return [{ ...idea, body, cites, members: [idea.id, ...rest.map((m) => m.id)] }];
  });
}

/** A flag found on a view, put on each of its nodes that cites the flag's unit (on every node for a flag with no unit). */
export function onMembers(flag: ReviewFlag, view: CardView | undefined, ideas: ReadonlyMap<string, Idea>): ReviewFlag[] {
  if (!view || view.members.length === 1) return [flag];
  const unit = flag.unit;
  const owners = view.members.filter((m) => unit === undefined || (ideas.get(m)?.cites.includes(unit) ?? false));
  return owners.map((card) => ({ ...flag, card }));
}

/**
 * The representation flags of a section's (or run's) cards against the units they cite. `critical` names the units
 * that are critical for their cue words (accounting's `criticalReasonsOf` reasons "limitation", "requirement",
 * "condition"); `aiSupported` the cards the model check answered "supported".
 */
export function representationFlags(
  ideas: readonly Idea[],
  units: readonly SourceUnit[],
  options: { aiSupported?: ReadonlySet<string> } & CardLinks = {},
): { flags: ReviewFlag[]; hints: ReviewFlag[] } {
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const ideaById = new Map(ideas.map((i) => [i.id, i] as const));
  const views = cardViews(ideas, { ...(options.explainedBy ? { explainedBy: options.explainedBy } : {}), ...(options.shapes ? { shapes: options.shapes } : {}) });
  const viewOf = new Map(views.map((v) => [v.id, v] as const));
  // Found on a card read with its explanations; put on each of its nodes that cites the unit.
  const spread = (list: readonly ReviewFlag[]) => list.flatMap((f) => onMembers(f, viewOf.get(f.card ?? ""), ideaById));
  const flags: ReviewFlag[] = [];
  const hints: ReviewFlag[] = [];
  const checked = views.filter((i) => i.origin !== "analysis" && !i.byReference);
  const relatedCiters = new Map<UnitId, CardView[]>();
  for (const idea of checked) {
    const text = cardText(idea);
    for (const id of new Set(idea.cites)) {
      const unit = byId.get(id);
      if (!unit) continue;
      if (!relatedToUnit(text, unit.text)) {
        flags.push({ code: "citation_unrelated", card: idea.id, unit: id, detail: `the card shares no words with the passage it cites: "${short(plainText(unit.text), 80)}"`, evidence: { source: unit.text } });
        continue;
      }
      relatedCiters.set(id, [...(relatedCiters.get(id) ?? []), idea]);
    }
  }
  // A card placed by reference holds its unit verbatim, so a unit it cites keeps everything.
  const verbatim = new Set(ideas.filter((i) => i.byReference).flatMap((i) => i.cites));
  for (const [id, citers] of relatedCiters) {
    if (verbatim.has(id)) continue;
    const clauses = criticalClausesOf(byId.get(id)!.text);
    if (!clauses.length) continue;
    const missingOf = (idea: CardView) => clauses.filter((c) => !cardKeepsClause(cardText(idea), c));
    // One flag per clause the card drops, each naming it, so the retry and the "Limit:" fallback get every one of them.
    const flagsOf = (idea: CardView): ReviewFlag[] =>
      missingOf(idea).map((dropped) => ({ code: "critical_dropped", card: idea.id, unit: id, detail: droppedClauseDetail(dropped), evidence: { source: clauseText(dropped) } }));
    const losing = citers.filter((idea) => missingOf(idea).length > 0);
    if (losing.length < citers.length) continue;
    // Every citing card drops a clause: those the model check answered "supported" keep the unit (the rule's words a hint).
    const supported = losing.filter((idea) => idea.members.some((m) => options.aiSupported?.has(m)));
    if (supported.length) hints.push(...supported.flatMap(flagsOf));
    else flags.push(...losing.flatMap(flagsOf));
  }
  return { flags: spread(flags), hints: spread(hints) };
}

/** A line the app put back from the source ("**From the source:** …", "**Limit:** …"): not the card's own words. */
const RESTORED_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:From the source|Limit):/i;

/**
 * `longer_than_source` hints (the live run of 2026-10-20: canvas words 202–400% of the source on small fixtures): a
 * card, read with its explanations, whose own words outnumber those of the source passages it cites. Protected details
 * on it (exact values of its cited units, kept as the source has them) and lines the app put back from the source are
 * not counted. Hints only, never Needs review (`DISTIL_RULE` asks for brevity; §4.2 lets a card hold what its idea
 * needs; the canvas-words share is observed, not gated, §9). Analysis cards and blocks placed by reference are skipped.
 */
export function lengthHints(views: readonly CardView[], units: readonly SourceUnit[], items: readonly ProtectedItem[] = []): ReviewFlag[] {
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const out: ReviewFlag[] = [];
  for (const view of views) {
    if (view.origin === "analysis" || view.byReference || !view.cites.length) continue;
    const cited = view.cites.flatMap((u) => byId.get(u) ?? []);
    if (!cited.length) continue;
    const source = cited.reduce((n, u) => n + wordCount(u.text), 0);
    const own = cardText(view)
      .split("\n")
      .filter((line) => !RESTORED_LINE.test(line))
      .join("\n");
    const normalized = normalizeForCompare(own);
    const protectedWords = items
      .filter((i) => i.tier === "exact" && view.cites.includes(i.unit) && normalized.includes(normalizeForCompare(i.value)))
      .reduce((n, i) => n + wordCount(i.value), 0);
    const words = Math.max(0, wordCount(own) - protectedWords);
    if (words > source) out.push({ code: "longer_than_source", card: view.id, detail: `the card has ${words} words, more than the ${source} of the passages it cites` });
  }
  return out;
}
