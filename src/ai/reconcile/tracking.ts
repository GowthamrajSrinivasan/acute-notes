/**
 * Cards the user owns, not their source (`.ai/docs/promotion-contract-proposal-2026-11-15.md`, step P0): a note pinned
 * from the Notes view and a passage added from the Source tab. Both are linked to a content source (their citations,
 * the Source tab) but opted out of updates: their key is never in the source's plan, so an update that reconciled them
 * would propose removing them. P0 has no schema field for this (P1 adds `trackingMode` and the promotion record); the
 * card is told by the exact key forms its producers write, never by a looser prefix (integrator answer Q14).
 *
 * - `openui § g<n>`: a pin written before P0 (not unique across generations, R3).
 * - `promoted § gen_<id> § <note key>`: a pin since P0 — `promotionKey`, unique per generation run (§1.3).
 * - `passage § u<n>`: Add to canvas / Include (`knowledgeActions.ts`; its collisions, N7, are deferred to P8).
 */
import { reconciliationOf, type ProvenanceElement } from "@/domain/provenance";
import type { DocumentRecord } from "@/domain/types";

type GetDocument = (id: string) => DocumentRecord | null | undefined;

const KEY_JOINER = " § ";

/** A pinned note's stable key: unique per generation run (`generationId`), then the note's key within the run ("g3"). */
export function promotionKey(generationId: string, insightKey: string): string {
  return `promoted${KEY_JOINER}${generationId}${KEY_JOINER}${insightKey}`;
}

const USER_OWNED_KEY = [/^openui § g\d{1,9}$/, /^promoted § gen_[0-9A-Za-z]{1,60} § [^\s§]{1,40}$/, /^passage § u\d{1,9}$/];

/** Whether `key` is a pinned note's or an added passage's, in the exact forms their producers write. */
export function isUserOwnedKey(key: string | undefined): boolean {
  return !!key && USER_OWNED_KEY.some((re) => re.test(key));
}

/** Whether `el` is a pinned note or an added passage card: linked to a source, with a user-owned key. */
export function isUserOwnedCard(el: Pick<ProvenanceElement, "customData">, getDocument: GetDocument): boolean {
  return isUserOwnedKey(reconciliationOf(el, getDocument)?.stableNodeKey);
}

/** The live object carrying `key`, if any: a second pin of the same note shows that card instead of writing a duplicate. */
export function liveObjectWithKey(
  elements: readonly (Pick<ProvenanceElement, "id" | "customData" | "isDeleted" | "type"> & { containerId?: string | null })[],
  getDocument: GetDocument,
  key: string,
): string | null {
  for (const el of elements) {
    if (el.isDeleted || (el.type === "text" && el.containerId)) continue;
    if (reconciliationOf(el, getDocument)?.stableNodeKey === key) return el.id;
  }
  return null;
}
