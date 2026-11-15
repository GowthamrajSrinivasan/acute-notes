/**
 * The existing objects of one content source (F38): every live object on the
 * canvas linked to it, with its baseline and current fingerprints. Scoped to
 * that one source on the open canvas (§13.15.21) — a reconciliation never
 * widens to other sources or the workspace. Manual objects, and objects from
 * any other Visualize run, have no link to this source and are never read.
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import { getArrowRelation, getEmbedRef } from "@/domain/canvas/adapter";
import { connectorSourceOf, reconciliationOf } from "@/domain/provenance";
import { isLocked } from "@/domain/canvas/lock";
import type { DocumentRecord, RelationType } from "@/domain/types";
import type { ExistingObject } from "./classify";
import { unitOfKey } from "./keys";
import { fingerprintOf, labelsByContainer, objectContent } from "./objects";

export function existingObjects(elements: readonly SceneElement[], getDocument: (id: string) => DocumentRecord | null | undefined, sourceId: string): ExistingObject[] {
  const labels = labelsByContainer(elements);
  const lockedFrames = new Set(elements.flatMap((el) => (!el.isDeleted && el.type === "frame" && isLocked(el) ? [el.id] : [])));
  const out: ExistingObject[] = [];
  for (const el of elements) {
    if (el.isDeleted || (el.type === "text" && el.containerId)) continue;
    const link = reconciliationOf(el, getDocument);
    if (!link || link.contentSourceId !== sourceId) continue;
    const content = objectContent(el, labels, getDocument);
    if (!content) continue;
    const ref = getEmbedRef(el);
    // A card's own lock (Stage 1e) also sets `excludeFromReconciliation`; it is reported as `locked`, so the update decides whether to honour it.
    const locked = isLocked(el) ? "card" : el.frameId && lockedFrames.has(el.frameId) ? "section" : undefined;
    out.push({
      objectId: el.id,
      stableNodeKey: link.stableNodeKey,
      baseline: link.contentFingerprint,
      current: fingerprintOf(content),
      excluded: link.excludeFromReconciliation && !isLocked(el),
      ...(locked ? { locked } : {}),
      ...(link.userWording ? { userWording: true } : {}),
      ...(link.splitOf ? { splitOf: link.splitOf } : {}),
      version: link.contentSourceVersion,
      shape: content.kind,
      ...(ref?.kind === "rich-block" ? { blockType: ref.blockType } : {}),
      box: { x: el.x, y: el.y, width: el.width, height: el.height },
      ...(el.frameId ? { frameId: el.frameId } : {}),
      ...(link.sourceUnits ? { sourceUnits: link.sourceUnits } : {}),
      ...(link.review ? { review: link.review } : {}),
      ...(link.noteModel ? { noteModel: link.noteModel } : {}),
      ...(content.kind === "block" ? { rich: { content: content.content } } : content.kind === "page" ? { rich: { content: content.content, title: content.title } } : {}),
    });
  }
  return out;
}

/** A connector bound at both ends (F38b). */
export interface ExistingConnection {
  arrowId: string;
  from: string;
  to: string;
  /** Drawn for this content source — the only arrows an update may remove. Any other arrow (the user's own) only counts as "already linked". */
  ownedBySource: boolean;
  /** Its relation type, when it has one (a map's own link can then be re-typed in place, Lens Phase 2). */
  relation?: RelationType;
}

/** Every live connector bound at both ends, flagged when this source drew it. */
export function existingConnections(elements: readonly SceneElement[], sourceId: string): ExistingConnection[] {
  return elements.flatMap((el) => {
    if (el.isDeleted || el.type !== "arrow") return [];
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    const relation = getArrowRelation(el);
    return from && to ? [{ arrowId: el.id, from, to, ownedBySource: connectorSourceOf(el) === sourceId, ...(relation ? { relation } : {}) }] : [];
  });
}

/** The content source(s) the given objects were derived from (for "Update from new content" on a selection). */
export function sourcesOf(elements: readonly SceneElement[], ids: ReadonlySet<string>, getDocument: (id: string) => DocumentRecord | null | undefined): string[] {
  const found = new Set<string>();
  for (const el of elements) {
    if (!ids.has(el.id) || el.isDeleted) continue;
    const link = reconciliationOf(el, getDocument);
    if (link) found.add(link.contentSourceId);
  }
  return [...found];
}

/** The sections (analysis-unit keys) of one source that the `ids` objects belong to — what "Re-visualize" on a selection regenerates. */
export function sectionsOfObjects(elements: readonly SceneElement[], ids: ReadonlySet<string>, getDocument: (id: string) => DocumentRecord | null | undefined, sourceId: string): string[] {
  const keys = existingObjects(elements, getDocument, sourceId).flatMap((o) => (ids.has(o.objectId) ? [unitOfKey(o.stableNodeKey) ?? ""] : []));
  return [...new Set(keys)].filter(Boolean);
}
