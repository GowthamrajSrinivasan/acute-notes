/**
 * Stage 5c (intelligent-update-engine-plan §13.4; design §13.13) — **PROTOTYPE, not wired into the app.** Measured on
 * the dev split of the locate evaluation set only (`locateEvaluation.test.ts`); the held-out split is kept for one
 * final evaluation.
 *
 * Router descent, in the order the 2026-11-14 review set:
 * 1. **Selection / open frame** — `context` gives its card or section a prior.
 * 2. **Exact duplicate and entity evidence** — an item with the same normalised content is a duplicate, no model
 *    needed; named things (product names, codes, numbers) shared with a card add a small, capped bonus.
 * 3. **Section retrieval → card retrieval** — a card's destination score combines its own similarity, its best item's
 *    similarity and its section's similarity.
 * 4. **Item-level evidence and action selection** — for each of the best cards, the best item decides the action:
 *    the same claim changed (`replace_item`, or `cell` in a table), already said (`duplicate`), or new information
 *    (`after_item` next to a close item, else `append`; `table_row` for a table). A card that can't take the content
 *    (new information for a prose card) is passed over for the next one — **destination and action are chosen
 *    together**, so a confident card match never short-circuits an append, insertion or table edit.
 * 5. **Placement proposal or clarification** — below the card floor: a new card in the best section, or a new section;
 *    two different sections within the margin: ask.
 *
 * Two confidences, never blended (Stage 2 rule): `routing` (is this the right place?) and `update` (is the edit right?).
 * Intent comes from the Stage 1 classifier (`classifyClaimChange`), unchanged. Thresholds are per embedder (§13.2).
 */
import { classifyClaimChange } from "@/ai/reconcile/intent";
import { quantitiesOf, sameQuantity } from "@/ai/fidelity/quantities";
import { contentHash, type CardItems, type IndexedItem, type ItemIndex } from "./itemIndex";
import { similarity, type EmbeddingVector } from "./embeddingProvider";

export type PlacementAction = "replace_item" | "after_item" | "append" | "table_row" | "cell" | "duplicate" | "new_block" | "new_section" | "clarify";
export type PlacementRelation = "NEW" | "SUPERSEDES" | "EXTENDS" | "CONTRADICTS" | "DUPLICATE" | "UNCLEAR";

export interface DescentOptions {
  /** Below this card score, no existing card takes the content. */
  cardFloor: number;
  /** Below this section score, no section fits: a new section. */
  sectionFloor: number;
  /** An item this similar is a candidate for being the same claim (update or duplicate). */
  itemMatch: number;
  /** An item this similar, that the intent rules can't read, is taken as already said. */
  duplicate: number;
  /** New information this similar to an item goes directly after it; otherwise at the end. */
  adjacency: number;
  /** Two cards in different sections closer than this: ask instead of guessing. 0 = never ask. */
  margin: number;
  /** Weight of the best item against the whole card (0–1). */
  itemWeight: number;
  /** Weight of the section's score added to a card's. */
  sectionWeight: number;
  /** Bonus per named thing shared with a card, capped at two. */
  entityBonus: number;
  /** Prior for the open card / section. */
  contextBonus: number;
  /** How many of the best cards are tried for a feasible action. */
  depth: number;
  /**
   * "Belongs nowhere" (§13.14): the note fits no section better than another (the top two sections are within
   * `nowhereSectionGap`) **and** no card or item is close (best card below `nowhereCard`, best item below
   * `nowhereItem`) → a new section. A near-tie between sections alone is common; it is the two margins together that
   * mark a note no part of the canvas is about. 0 = off. Never applied when the user's open frame or selection is given.
   */
  nowhereSectionGap: number;
  nowhereCard: number;
  nowhereItem: number;
}

/**
 * Provisional defaults: the best of 654 settings searched on the locate **dev** split for MiniLM-L6 (§13.13; the optimum
 * is flat — 140 settings within two placements). Per embedder: recalibrate when the embedder changes. `margin` and
 * `sectionFloor` were not searched.
 */
export const DEFAULT_DESCENT: DescentOptions = {
  cardFloor: 0.3,
  sectionFloor: 0.2,
  itemMatch: 0.45,
  duplicate: 0.6,
  adjacency: 0.4,
  margin: 0,
  itemWeight: 0.3,
  sectionWeight: 0.3,
  entityBonus: 0.05,
  contextBonus: 0.1,
  depth: 4,
  // §13.14: read off the dev split for MiniLM-L6 (6 of 6 dev "nowhere" cases, 7 other cases also caught); provisional
  // until the held-out evaluation. Per embedder, like the rest.
  nowhereSectionGap: 0.05,
  nowhereCard: 0.4,
  nowhereItem: 0.41,
};

export interface Placement {
  action: PlacementAction;
  card: string | null;
  section: string | null;
  /** For `new_block` / `clarify`: the card it is closest to. */
  near: string | null;
  item: number | null;
  column: string | null;
  relation: PlacementRelation | null;
  /** Is this the right place? (the winning destination score) */
  routing: number;
  /** Is the edit right? (from the intent and the item's similarity; separate from routing) */
  update: number;
  /** Cards, best destination first. */
  ranked: string[];
  /** Each descent step that decided something, in order. */
  steps: string[];
}

export interface DescentSection {
  id: string;
  name: string;
}

/** See module doc. Build once per canvas state; `prepare()` after the index has refreshed. */
export class Descent {
  private sectionVectors = new Map<string, EmbeddingVector>();
  /** The last notes placed (the dialog re-asks as options change). Bounded. */
  private readonly noteVectors = new Map<string, EmbeddingVector>();

  constructor(
    readonly index: ItemIndex,
    readonly sections: readonly DescentSection[],
  ) {}

  /** Embeds each section (its name and its cards' text). Items and cards come from the index's own refresh. */
  async prepare(): Promise<void> {
    await this.index.refresh();
    const texts = this.sections.map((s) => [s.name, ...this.index.allCards().filter((c) => c.section === s.id).map((c) => c.text)].join("\n"));
    const vs = await this.index.provider.embed(texts);
    this.sectionVectors = new Map(this.sections.map((s, i) => [s.id, vs[i]!] as const));
  }

  async place(text: string, options: Partial<DescentOptions> = {}, context: { card?: string; section?: string } = {}): Promise<Placement> {
    const o = { ...DEFAULT_DESCENT, ...options };
    const steps: string[] = [];
    const cards = this.index.allCards();

    // 2a. Exact duplicate: no model needed.
    const same = this.index.withSameContent(text);
    if (same.length) {
      const it = same[0]!;
      steps.push(`exact duplicate of ${it.key}`);
      return { action: "duplicate", card: it.card, section: it.section, near: null, item: it.index, column: null, relation: "DUPLICATE", routing: 1, update: 1, ranked: [it.card], steps };
    }

    const key = `${this.index.provider.id}:${text}`;
    let q = this.noteVectors.get(key);
    if (!q) {
      [q] = await this.index.provider.embed([text]);
      this.noteVectors.set(key, q!);
      if (this.noteVectors.size > 256) this.noteVectors.delete(this.noteVectors.keys().next().value!);
    }
    const sectionScore = new Map(this.sections.map((s) => [s.id, this.sectionVectors.get(s.id) ? similarity(q!, this.sectionVectors.get(s.id)!) : 0] as const));
    const noteEntities = entitiesOf(text);

    // 3. Section → card retrieval, with item evidence and entities.
    const scored = cards.map((c) => {
      const items = this.index.itemsOf(c.card);
      const sims = items.map((it) => {
        const v = this.index.vectorOf(it.hash);
        return v ? similarity(q!, v) : 0;
      });
      let best = -1;
      sims.forEach((s, i) => (best < 0 || s > sims[best]! ? (best = i) : 0));
      const cv = this.index.cardVector(c.card);
      const cardSim = cv ? similarity(q!, cv) : 0;
      const bestSim = best >= 0 ? sims[best]! : cardSim;
      const own = (1 - o.itemWeight) * cardSim + o.itemWeight * bestSim;
      const shared = [...entitiesOf(c.text)].filter((e) => noteEntities.has(e)).length;
      const prior = (context.card === c.card || (context.section && context.section === c.section) ? o.contextBonus : 0);
      const dest = own + o.sectionWeight * (c.section ? (sectionScore.get(c.section) ?? 0) : 0) + o.entityBonus * Math.min(2, shared) + prior;
      return { c, items, sims, best, bestSim, own, dest };
    });
    scored.sort((a, b) => b.dest - a.dest || (a.c.card < b.c.card ? -1 : 1));
    const ranked = scored.map((s) => s.c.card);
    const topSection = [...sectionScore].sort((a, b) => b[1] - a[1])[0];

    // 4. Destination and action together: the first of the best cards that can take the content.
    const feasible: (Omit<Placement, "ranked" | "steps"> & { own: number })[] = [];
    for (const s of scored.slice(0, o.depth)) {
      const opt = actionFor(s.c, s.items, s.best, s.bestSim, text, o);
      if (opt) feasible.push({ ...opt, card: s.c.card, section: s.c.section, near: null, routing: s.dest, own: s.own });
      else steps.push(`${s.c.card} (${s.c.kind}) can't take new information — next card`);
    }
    const best = feasible[0];

    // 5a. Belongs nowhere: no section stands out and nothing on the canvas is close (§13.14).
    const sectionScores = [...sectionScore.values()].sort((x, y) => y - x);
    const sectionGap = sectionScores.length > 1 ? sectionScores[0]! - sectionScores[1]! : Infinity;
    const topCard = scored[0];
    const topItem = Math.max(0, ...scored.map((s) => s.bestSim));
    if (o.nowhereSectionGap > 0 && !context.card && !context.section && topCard && sectionGap <= o.nowhereSectionGap && topCard.own < o.nowhereCard && topItem < o.nowhereItem) {
      steps.push(`belongs nowhere: sections within ${sectionGap.toFixed(2)}, best card ${topCard.own.toFixed(2)}, best item ${topItem.toFixed(2)}`);
      return { action: "new_section", card: null, section: null, near: ranked[0] ?? null, item: null, column: null, relation: "NEW", routing: sectionScores[0] ?? 0, update: 0.9, ranked, steps };
    }

    // 5b. Proposal, new card, new section, or a question.
    if (!best || best.own < o.cardFloor) {
      const near = ranked[0] ?? null;
      if (topSection && topSection[1] >= o.sectionFloor) {
        steps.push(`no card close enough (${best ? best.own.toFixed(2) : "none"} < ${o.cardFloor}); section ${topSection[0]} fits (${topSection[1].toFixed(2)})`);
        return { action: "new_block", card: null, section: topSection[0], near, item: null, column: null, relation: "NEW", routing: topSection[1], update: 0.9, ranked, steps };
      }
      steps.push("no section fits");
      return { action: "new_section", card: null, section: null, near, item: null, column: null, relation: "NEW", routing: topSection?.[1] ?? 0, update: 0.9, ranked, steps };
    }
    const rival = feasible.find((x) => x.card !== best.card && x.section !== best.section);
    if (o.margin > 0 && rival && best.routing - rival.routing < o.margin) {
      steps.push(`${best.card} and ${rival.card} (another section) are within ${o.margin}`);
      return { action: "clarify", card: null, section: best.section, near: best.card, item: null, column: null, relation: null, routing: best.routing, update: 0, ranked, steps };
    }
    steps.push(`${best.action} on ${best.card}${best.item !== null ? ` item ${best.item}` : ""}${best.column ? ` column ${best.column}` : ""}`);
    const { own: _own, ...placement } = best;
    return { ...placement, ranked, steps };
  }
}

/** The action a card can take for this content, from its best item; null when it can't take it. */
function actionFor(card: CardItems, items: readonly IndexedItem[], best: number, sim: number, text: string, o: DescentOptions): Pick<Placement, "action" | "item" | "column" | "relation" | "update"> | null {
  const item = best >= 0 ? items[best] : undefined;
  if (item && sim >= o.itemMatch) {
    if (card.kind === "table") {
      const column = changedColumn(card.header ?? [], item.cells ?? [], text);
      if (column) return { action: "cell", item: item.index, column, relation: "SUPERSEDES", update: 0.5 + 0.5 * sim };
      if (quantityConflict(item.text, text)) return { action: "replace_item", item: item.index, column: null, relation: "SUPERSEDES", update: 0.5 + 0.5 * sim };
      if (sim >= o.duplicate) return { action: "duplicate", item: item.index, column: null, relation: "DUPLICATE", update: sim };
    } else {
      const v = classifyClaimChange(item.text, text);
      if (v.intent === "DUPLICATE") return { action: "duplicate", item: item.index, column: null, relation: "DUPLICATE", update: 1 };
      if (v.intent === "SUPERSEDES" || v.intent === "EXTENDS" || v.intent === "CONTRADICTS")
        return { action: "replace_item", item: item.index, column: null, relation: v.intent, update: v.intent === "CONTRADICTS" ? 0.15 : 0.5 + 0.5 * sim };
      if (quantityConflict(item.text, text)) return { action: "replace_item", item: item.index, column: null, relation: "SUPERSEDES", update: 0.5 * sim };
      if (sim >= o.duplicate) return { action: "duplicate", item: item.index, column: null, relation: "DUPLICATE", update: sim };
    }
  }
  // New information.
  if (card.kind === "list" || card.kind === "todo") {
    if (item && sim >= o.adjacency && item.index < items.length - 1) return { action: "after_item", item: item.index, column: null, relation: "NEW", update: 0.9 };
    return { action: "append", item: null, column: null, relation: "NEW", update: 0.9 };
  }
  if (card.kind === "table") return { action: "table_row", item: null, column: null, relation: "NEW", update: 0.9 };
  return null;
}

/** The text names a value of the same kind as one in `before`, but a different one ("4 hours" → "2 hours"). */
function quantityConflict(before: string, after: string): boolean {
  const a = quantitiesOf(before);
  const b = quantitiesOf(after);
  return b.some((n) => a.some((x) => x.dimension === n.dimension) && !a.some((x) => sameQuantity(x, n)));
}

/** The column whose value the text changes: a cell holding a value of the same kind but different, else a header the text names. */
function changedColumn(header: readonly string[], cells: readonly string[], text: string): string | null {
  const q = quantitiesOf(text);
  for (let i = 0; i < cells.length; i++) {
    const cq = quantitiesOf(cells[i]!);
    if (cq.length && q.some((n) => cq.some((c) => c.dimension === n.dimension) && !cq.some((c) => sameQuantity(c, n)))) return header[i] ?? null;
  }
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  for (let i = 1; i < cells.length; i++) {
    const h = header[i]?.toLowerCase().match(/[a-z]+/g) ?? [];
    if (h.some((w) => w.length > 3 && words.has(w)) && !text.toLowerCase().includes(cells[i]!.toLowerCase())) return header[i] ?? null;
  }
  return null;
}

/** Named things: words with a digit, all-capital words, and capitalised words not starting a sentence. Lower-cased. */
export function entitiesOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*/gu)) {
    const t = m[0];
    const before = text.slice(0, m.index).trimEnd();
    const sentenceStart = before === "" || /[.!?:]$/.test(before);
    if (/\d/.test(t) || /^[A-Z]{2,}/.test(t) || (!sentenceStart && /^[A-Z]/.test(t))) out.add(t.toLowerCase().replace(/[.]+$/, ""));
  }
  return out;
}

export { contentHash };
