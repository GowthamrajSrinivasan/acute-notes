/**
 * Canvas commands for interactive architecture frames. Each is one ordinary undo step that edits the element's
 * `customData` (and, for a node's kind, its colours so the kind reads on the canvas).
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  getDiagramMeta,
  getEdgeSemantics,
  getNodeSemantics,
  withDiagramMeta,
  withEdgeSemantics,
  withNodeSemantics,
  type NodeKind,
  type NodeSemantics,
} from "@/domain/canvas/diagram";
import type { SceneElement } from "@/domain/canvas/adapter";
import { compositeKindOf, compositePartOf } from "@/domain/canvas/compositeShapes";
import { NODE_KIND_STYLES, PLAIN_NODE_STYLE, hasKindStyle } from "@/domain/canvas/nodeKindStyle";
import { replaceElement } from "./richBlocks";

/** Turns a frame's interactive diagram mode on or off (its cards are kept either way). */
export function setFrameInteractive(api: ExcalidrawImperativeAPI, frameId: string, interactive: boolean): void {
  replaceElement(
    api,
    frameId,
    (el) => {
      if (el.type !== "frame") return el;
      const meta = getDiagramMeta(el) ?? { type: "architecture" as const, interactive: false };
      return newElementWith(el, { customData: withDiagramMeta(el.customData, { ...meta, interactive }) });
    },
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/**
 * Sets (or clears) a node's kind. Setting it applies the kind's colours; clearing it restores the plain look only
 * when the shape still has the kind's colours, so a colour the user chose afterwards is kept.
 *
 * A composite shape (a cylinder) draws with its outline parts, not its transparent host: a colour set on the host
 * moves to the parts (`normalizeComposites`), and its current colours are the recorded `acuteShapeStyle`. Clearing
 * writes the plain look to the parts directly, since a transparent fill set on the host would read as "unset".
 */
export function setNodeKind(api: ExcalidrawImperativeAPI, nodeId: string, kind: NodeKind | null): void {
  const scene = api.getSceneElementsIncludingDeleted();
  const host = scene.find((el) => el.id === nodeId);
  if (!host) return;
  const current = getNodeSemantics(host) ?? {};
  const customData = withNodeSemantics(host.customData, { ...current, kind: kind ?? undefined });
  const composite = compositeKindOf(host as unknown as SceneElement) !== null;

  if (kind) {
    const style = NODE_KIND_STYLES[kind];
    replaceElement(api, nodeId, (el) => newElementWith(el, { customData, strokeColor: style.strokeColor, backgroundColor: style.backgroundColor }), CaptureUpdateAction.IMMEDIATELY);
    return;
  }

  const recorded = host.customData?.acuteShapeStyle as { strokeColor?: string; backgroundColor?: string } | undefined;
  const colours = composite ? { strokeColor: recorded?.strokeColor, backgroundColor: recorded?.backgroundColor } : host;
  const untouched = hasKindStyle(colours, current.kind);
  if (!composite || !untouched) {
    replaceElement(api, nodeId, (el) => newElementWith(el, { customData, ...(untouched ? PLAIN_NODE_STYLE : {}) }), CaptureUpdateAction.IMMEDIATELY);
    return;
  }
  const group = host.groupIds[0];
  const elements = scene.map((el) => {
    if (el.id === nodeId) return newElementWith(el, { customData: { ...customData, acuteShapeStyle: { ...PLAIN_NODE_STYLE } } });
    if (group && el.groupIds[0] === group && compositePartOf(el as unknown as SceneElement)) return newElementWith(el, { ...PLAIN_NODE_STYLE });
    return el;
  });
  api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

/** Updates a node's text semantics (sublabel, tag, details), keeping its kind. */
export function setNodeSemantics(api: ExcalidrawImperativeAPI, nodeId: string, patch: Omit<NodeSemantics, "kind">): void {
  replaceElement(
    api,
    nodeId,
    (el) => newElementWith(el, { customData: withNodeSemantics(el.customData, { ...getNodeSemantics(el), ...patch }) }),
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/** Sets (or clears, with an empty string) why a relationship exists. */
export function setEdgeExplanation(api: ExcalidrawImperativeAPI, arrowId: string, explanation: string): void {
  replaceElement(
    api,
    arrowId,
    (el) => (el.type === "arrow" ? newElementWith(el, { customData: withEdgeSemantics(el.customData, { ...getEdgeSemantics(el), explanation }) }) : el),
    CaptureUpdateAction.IMMEDIATELY,
  );
}
