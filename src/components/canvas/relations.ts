/**
 * Canvas command for semantic relationships (F23). The type is stored on the
 * arrow, so setting it is one ordinary undo step and it travels with the
 * arrow through export and import, and through a copy that includes both of
 * its ends (`keepsRelationOnCopy`).
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { withRelation } from "@/domain/canvas/adapter";
import type { RelationType } from "@/domain/types";
import { replaceElement } from "./richBlocks";

/** Sets (or clears, with null) an arrow's relationship type. */
export function setArrowRelation(api: ExcalidrawImperativeAPI, arrowId: string, type: RelationType | null): void {
  replaceElement(
    api,
    arrowId,
    (el) => (el.type === "arrow" ? newElementWith(el, { customData: withRelation(el.customData, type ?? undefined) }) : el),
    CaptureUpdateAction.IMMEDIATELY,
  );
}
