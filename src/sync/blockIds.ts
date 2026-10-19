/**
 * Block identity inside rich documents.
 *
 * Every BlockNote block has an id (the `id` attribute of its `blockContainer`
 * node in the Y.Doc, mirrored as `ContentBlock.id` in the snapshot). Copying a
 * document byte-for-byte would copy those ids too, so two documents would
 * contain "the same" blocks. A copy therefore gets fresh block ids, applied
 * identically to its Yjs content and its snapshot.
 */
import * as Y from "yjs";
import type { ContentBlock, RichContent } from "@/domain/types";

const BLOCK_NODE = "blockContainer";
/** The Y.XmlFragment holding a rich document's BlockNote content. */
export const RICH_FRAGMENT = "blocknote";

/** BlockNote's own id format (UUID v4). */
export const newBlockId = (): string => crypto.randomUUID();

/** Old block id → new block id for one copy. Unknown ids get a fresh id on first use. */
export class BlockIdMap {
  private readonly ids = new Map<string, string>();

  get(oldId: string): string {
    let id = this.ids.get(oldId);
    if (!id) this.ids.set(oldId, (id = newBlockId()));
    return id;
  }

  get size(): number {
    return this.ids.size;
  }
}

/**
 * Gives every block in the fragment a new id (call inside a transaction).
 * Blocks that shared an id (a damaged document) end up with distinct ids.
 */
export function reassignFragmentBlockIds(fragment: Y.XmlFragment, map: BlockIdMap): void {
  const seen = new Set<string>();
  for (const node of fragment.createTreeWalker((n) => n instanceof Y.XmlElement && n.nodeName === BLOCK_NODE)) {
    const el = node as Y.XmlElement;
    const old = el.getAttribute("id");
    const id = typeof old === "string" && old && !seen.has(old) ? map.get(old) : newBlockId();
    if (typeof old === "string") seen.add(old);
    el.setAttribute("id", id);
  }
}

/** The snapshot counterpart of `reassignFragmentBlockIds` (same map → same new ids). */
export function reassignContentBlockIds(content: RichContent, map: BlockIdMap): RichContent {
  const visit = (block: ContentBlock): ContentBlock => ({
    ...block,
    ...(block.id ? { id: map.get(block.id) } : {}),
    ...(block.children ? { children: block.children.map(visit) } : {}),
  });
  return content.map(visit);
}

/**
 * Copies a document's content with fresh block ids: the Yjs updates are merged
 * into one standalone update for the copy's own Y.Doc and the snapshot is
 * remapped to match.
 */
export function copyWithNewBlockIds(
  updates: readonly Uint8Array[],
  snapshot: RichContent,
): { update: Uint8Array | null; snapshot: RichContent } {
  const map = new BlockIdMap();
  let update: Uint8Array | null = null;
  if (updates.length) {
    const doc = new Y.Doc();
    try {
      for (const u of updates) Y.applyUpdate(doc, u);
      doc.transact(() => reassignFragmentBlockIds(doc.getXmlFragment(RICH_FRAGMENT), map));
      update = Y.encodeStateAsUpdate(doc);
    } finally {
      doc.destroy();
    }
  }
  return { update, snapshot: reassignContentBlockIds(snapshot, map) };
}

/**
 * BlockNote gives the single block of an empty document the fixed id
 * "initialBlockId" (so collaborators converge on one empty doc). That id is
 * shared by every document that was ever empty, so it is replaced with a
 * fresh id when a document opens. Returns the updated snapshot, or null when
 * nothing needed replacing. Call before any editor binds to the fragment.
 */
export const BLOCKNOTE_DEFAULT_ID = "initialBlockId";

export function replaceDefaultBlockId(fragment: Y.XmlFragment, snapshot: RichContent): RichContent | null {
  let replacement: string | null = null;
  for (const node of fragment.createTreeWalker((n) => n instanceof Y.XmlElement && n.nodeName === BLOCK_NODE)) {
    const el = node as Y.XmlElement;
    if (el.getAttribute("id") !== BLOCKNOTE_DEFAULT_ID) continue;
    replacement ??= newBlockId();
    el.setAttribute("id", replacement);
  }
  if (!replacement) return null;
  const id = replacement;
  const visit = (block: ContentBlock): ContentBlock => ({
    ...block,
    ...(block.id === BLOCKNOTE_DEFAULT_ID ? { id } : {}),
    ...(block.children ? { children: block.children.map(visit) } : {}),
  });
  return snapshot.map(visit);
}
