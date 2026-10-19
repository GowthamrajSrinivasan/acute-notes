/**
 * "Visualize better" (F42 Phase 4): the link a split's pieces carry to the
 * block they replace, so "Update from new content" keeps the split
 * (`reconcile`'s `splits`). Read from the block's own reconciliation link:
 * its content source and version, and the node it shows. A piece that is
 * split again stays a piece of the original node, with keys under its own.
 * Null for a block with no link (a manual or MCP block): its pieces are then
 * plain new objects.
 */
import type { SplitRecord } from "@/ai/changes/changeSet";
import { reconciliationOf, type ProvenanceElement } from "@/domain/provenance";
import type { DocumentRecord } from "@/domain/types";

/** Joins a split node's key and a piece's own key into the piece's key. */
export const SPLIT_KEY_JOINER = " ⊃ ";
const MAX_PREFIX_BASE = 200;

export interface SplitLink {
  record: SplitRecord;
  /** Prefix of every piece's key: unique to this block, so pieces of two splits never collide. */
  keyPrefix: string;
}

export function splitLinkOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): SplitLink | null {
  const link = reconciliationOf(el, getDocument);
  if (!link) return null;
  const of = link.splitOf ?? { stableNodeKey: link.stableNodeKey, fingerprint: link.contentFingerprint };
  // Keys are bounded (300 characters): a piece split again and again starts afresh under the original node.
  const base = link.stableNodeKey.length <= MAX_PREFIX_BASE ? link.stableNodeKey : `${of.stableNodeKey.slice(0, MAX_PREFIX_BASE)}${SPLIT_KEY_JOINER}s${Math.random().toString(36).slice(2, 8)}`;
  return {
    record: { sourceId: link.contentSourceId, version: link.contentSourceVersion, of: of.stableNodeKey, fingerprint: of.fingerprint },
    keyPrefix: `${base}${SPLIT_KEY_JOINER}`,
  };
}
