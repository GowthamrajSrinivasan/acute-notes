/**
 * Stable Lens keys (plan §3.1.1, D13, D21). A node's Lens key is, in order:
 *
 * 1. `acuteNode.key` — a hand-drawn node's key, derived once from its frame's key and a slug of its label
 *    ("payments.webhook-handler"), then kept fixed: a rename edits the separate bound-text element, not this.
 * 2. From Phase 2 (D21, signed off 2026-10-03): the **reconciliation key** a Repo Map or Visualize object carries in
 *    its provenance — for a map node, the agent's own key — read only here, through `lensIdentityOf`. A copy doesn't
 *    take it (`acuteNode.ownIdentity`, set by the copy rule): the identity stays with the original (D59).
 * 3. The element id, as a last resort.
 *
 * This module is the one Lens reader of the reconciliation key (listed in `provenanceGuard.test.ts`).
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import { dropsLensKeyOnCopy, getNodeLens, withNodeLens } from "@/domain/canvas/diagram";
import type { DocumentRecord } from "@/domain/types";
import { lensIdentityOf } from "@/domain/provenance";

type GetDocument = (id: string) => DocumentRecord | null | undefined;
const none: GetDocument = () => undefined;

/** The identity a Repo Map / Visualize object carries into Lens (D21), unless it's a copy; undefined otherwise. */
export function mapIdentityOf(el: Pick<SceneElement, "customData">, getDocument: GetDocument = none): string | undefined {
  if (getNodeLens(el)?.ownIdentity) return undefined;
  return lensIdentityOf(el, getDocument);
}

/** A node's explicit Lens key: `acuteNode.key`, else its map identity (D21); undefined when it has neither. */
export function lensKeyOf(el: Pick<SceneElement, "customData">, getDocument: GetDocument = none): string | undefined {
  return getNodeLens(el)?.key ?? mapIdentityOf(el, getDocument);
}

function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60) || "node";
}

export function nodeKeyFor(frameKey: string, label: string): string {
  return `${frameKey}.${slugify(label)}`;
}

/**
 * The copy rule (plan §3.1.1, D21, D59): what a copied element's `customData` becomes so the copy gets an identity of
 * its own — its `acuteNode.key` / frame `lensKey` dropped, and, when it carries a map identity, `ownIdentity` set so
 * Lens doesn't read the original's key on it. Null when nothing changes.
 */
export function lensCopyData(el: Pick<SceneElement, "type" | "customData">, getDocument: GetDocument = none): Record<string, unknown> | null {
  const dropped = dropsLensKeyOnCopy(el);
  if (!mapIdentityOf(el, getDocument)) return dropped;
  const customData = dropped ?? el.customData;
  return withNodeLens(customData, { ...getNodeLens({ customData }), ownIdentity: true });
}
