/**
 * Stage 5b (intelligent-update-engine-plan §13.3; design §13.13). Fed from the live canvas by `semanticIndex.ts` (§18,
 * behind the semantic-placement switch).
 *
 * The item-level index: one entry per sentence of a text card, list item, todo item and table data row, so a new
 * piece of information can be matched to the exact item it updates or follows — not only to a whole card.
 *
 * Constraints from the 2026-11-14 review, and how they are met:
 * - **Stable unit identity, reused.** An item's key is the identity the patch contract already uses to edit it
 *   (`patch_block`: the card's element id, then the block by id or index, then a sentence or a table row):
 *   `<card>#<block>` for a list/todo item, `<card>#<block>.<sentence>` for a sentence, `<card>#<block>.r<row>` for a row.
 * - **Normalised content hash + embedding with the embedder's id.** `hash` is over `normalizeForCompare(text)`; vectors
 *   are cached under `<embedder id>:<hash>`, so a vector is never used with another embedder.
 * - **Incremental, with deletion, undo and redo.** A card's items are replaced as a whole whenever its content changes
 *   (`setCard`) or it is removed (`removeCard`); undo and redo are just the earlier content arriving again. Vectors are
 *   kept by content, so undoing a change finds its old vectors and embeds nothing.
 * - **Reuse when content and model match:** same `<embedder>:<hash>` → no embedding call.
 * - **Rebuilding is recoverable and separate from commits.** `setCard` is synchronous and cheap (hashing only);
 *   embedding happens in `refresh()`, which a background job runs after the commit. A failed or interrupted refresh
 *   leaves items without vectors (`pending`), retried by the next refresh; the content is never touched.
 * - **No parallel source of truth.** The index is derived from card content and can be deleted and rebuilt at any time.
 */
import { cyrb53 } from "@/ai/content/fingerprint";
import { normalizeForCompare } from "@/ai/fidelity/exactness";
import type { EmbeddingProvider, EmbeddingVector } from "./embeddingProvider";

export type CardKind = "text" | "list" | "todo" | "table";
export type ItemKind = "sentence" | "list_item" | "todo_item" | "table_row";

/** One card's content as items, in order. `block` is the block's id when it has one, else its index in the card. */
export interface CardItems {
  card: string;
  section: string | null;
  kind: CardKind;
  /** The card as a whole, as the workspace index holds it (for card-level similarity). */
  text: string;
  /** Table cards: the header row. */
  header?: readonly string[];
  items: readonly { block: string | number; part?: number; text: string; cells?: readonly string[] }[];
}

export interface IndexedItem {
  key: string;
  card: string;
  section: string | null;
  cardKind: CardKind;
  kind: ItemKind;
  /** Position in the card, 0-based (the patch contract's sentence, list item or table data row). */
  index: number;
  text: string;
  cells?: readonly string[];
  hash: string;
}

export const contentHash = (text: string) => cyrb53(normalizeForCompare(text));

export function itemKey(card: string, block: string | number, kind: ItemKind, part?: number): string {
  if (kind === "sentence") return `${card}#${block}.${part ?? 0}`;
  if (kind === "table_row") return `${card}#${block}.r${part ?? 0}`;
  return `${card}#${block}`;
}

const ITEM_KIND: Record<CardKind, ItemKind> = { text: "sentence", list: "list_item", todo: "todo_item", table: "table_row" };

/** See module doc. */
export class ItemIndex {
  private readonly items = new Map<string, IndexedItem>();
  private readonly cards = new Map<string, { content: CardItems; keys: string[]; hash: string }>();
  private readonly hashes = new Map<string, Set<string>>();
  /** `<embedder>:<content hash>` → vector. Kept across removals so undo and redo reuse them. */
  private readonly vectors = new Map<string, EmbeddingVector>();
  /** Embedding calls made and vectors reused, across refreshes. */
  readonly stats = { embedded: 0, reused: 0 };

  constructor(readonly provider: EmbeddingProvider) {}

  /** A card's new content (an accepted change, an undo or a redo). Synchronous: hashing only, no model call. */
  setCard(content: CardItems): void {
    this.removeCard(content.card);
    const kind = ITEM_KIND[content.kind];
    const keys: string[] = [];
    content.items.forEach((it, index) => {
      const key = itemKey(content.card, it.block, kind, it.part ?? (kind === "table_row" || kind === "sentence" ? index : undefined));
      const item: IndexedItem = { key, card: content.card, section: content.section, cardKind: content.kind, kind, index, text: it.text, hash: contentHash(it.text), ...(it.cells ? { cells: it.cells } : {}) };
      this.items.set(key, item);
      keys.push(key);
      const set = this.hashes.get(item.hash) ?? new Set<string>();
      set.add(key);
      this.hashes.set(item.hash, set);
    });
    this.cards.set(content.card, { content, keys, hash: contentHash(content.text) });
  }

  removeCard(card: string): void {
    const prev = this.cards.get(card);
    if (!prev) return;
    for (const key of prev.keys) {
      const item = this.items.get(key);
      if (item) this.hashes.get(item.hash)?.delete(key);
      this.items.delete(key);
    }
    this.cards.delete(card);
  }

  /** Embeds every item and card whose (embedder, hash) has no vector yet. Returns what it did; never throws for a card. */
  async refresh(): Promise<{ embedded: number; reused: number; pending: number }> {
    const want = new Map<string, string>();
    const reuse = new Set<string>();
    const id = this.provider.id;
    const need = (hash: string, text: string) => {
      const k = `${id}:${hash}`;
      if (this.vectors.has(k)) reuse.add(k);
      else want.set(k, text);
    };
    for (const it of this.items.values()) need(it.hash, it.text);
    for (const c of this.cards.values()) need(c.hash, c.content.text);
    const keys = [...want.keys()];
    let embedded = 0;
    try {
      const vs = await this.provider.embed(keys.map((k) => want.get(k)!));
      vs.forEach((v, i) => this.vectors.set(keys[i]!, v));
      embedded = vs.length;
    } catch {
      // Left pending: the next refresh retries. Content is untouched.
    }
    this.stats.embedded += embedded;
    this.stats.reused += reuse.size;
    return { embedded, reused: reuse.size, pending: keys.length - embedded };
  }

  /** The vector for an item or card's content, if embedded by the current embedder. */
  vectorOf(hash: string): EmbeddingVector | undefined {
    return this.vectors.get(`${this.provider.id}:${hash}`);
  }

  cardVector(card: string): EmbeddingVector | undefined {
    const c = this.cards.get(card);
    return c ? this.vectorOf(c.hash) : undefined;
  }

  card(card: string): CardItems | undefined {
    return this.cards.get(card)?.content;
  }

  allCards(): CardItems[] {
    return [...this.cards.values()].map((c) => c.content);
  }

  itemsOf(card: string): IndexedItem[] {
    return (this.cards.get(card)?.keys ?? []).map((k) => this.items.get(k)!).filter(Boolean);
  }

  /** Items whose normalised content equals this text (an exact duplicate, found without any model). */
  withSameContent(text: string): IndexedItem[] {
    return [...(this.hashes.get(contentHash(text)) ?? [])].map((k) => this.items.get(k)!).filter(Boolean);
  }

  get size(): number {
    return this.items.size;
  }
}
