/**
 * Canvas commands for Acute Lens identity and hierarchy links (plan §3.1.1, §5.3, D23). Each is one ordinary undo
 * step, following `diagramNodes.ts`'s pattern.
 */
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { findPlacement } from "@/ai/renderer/place";
import type { Box } from "@/ai/renderer/types";
import { frameTitleOf, getDiagramMeta, getFrameLens, getNodeLens, withDiagramMeta, withFrameLens, withNodeLens, type NodeSource } from "@/domain/canvas/diagram";
import { uniqueKey } from "@/domain/canvas/projectOps";
import { randomId } from "@/domain/ids";
import { lensKeyOf, nodeKeyFor } from "@/domain/lens/identity";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getDocumentStore } from "@/state/documents";
import { replaceElement } from "./richBlocks";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function frameName(el: ExcalidrawElement): string {
  return frameTitleOf(el as unknown as { customData?: Record<string, unknown>; name?: string | null });
}

function labelOf(scene: readonly ExcalidrawElement[], elementId: string): string {
  const text = scene.find((e) => e.type === "text" && e.containerId === elementId) as (ExcalidrawElement & { originalText?: string; text?: string }) | undefined;
  return (text?.originalText ?? text?.text ?? "").trim();
}

/**
 * A node's stable Lens key (`acuteNode.key`), assigned on first use from its frame's key (its `lensKey`, else its
 * id — both already permanently stable, so this never needs to change the frame) and a slug of its current label.
 * Kept fixed afterward: a later rename of the label doesn't touch it (plan AC12).
 */
export function ensureNodeKey(api: ExcalidrawImperativeAPI, nodeId: string): string {
  const scene = api.getSceneElementsIncludingDeleted();
  const node = scene.find((e) => e.id === nodeId);
  if (!node) return nodeId;
  // A map node already has its identity (D21): never overwrite it with a new key, or refs to it would break.
  const existing = lensKeyOf(node as unknown as SceneElement, (id) => getDocumentStore().get(id));
  if (existing) return existing;
  const frame = node.frameId ? scene.find((e) => e.id === node.frameId && e.type === "frame") : undefined;
  const frameKey = frame ? (getFrameLens(frame)?.lensKey ?? frame.id) : "frame";
  // Unique in the scene: two same-named nodes in one frame must not share a key, or a ref to it is ambiguous (D53).
  const taken = new Set(scene.flatMap((e) => (e.id !== nodeId && getNodeLens(e)?.key) || []));
  const key = uniqueKey(nodeKeyFor(frameKey, labelOf(scene, nodeId) || "node"), taken);
  replaceElement(api, nodeId, (el) => newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), key }) }), CaptureUpdateAction.IMMEDIATELY);
  return key;
}

/** A frame's level, in its profile (plan §3.4); `null` clears it back to inferred. */
export function setFrameLevel(api: ExcalidrawImperativeAPI, frameId: string, level: number | null): void {
  replaceElement(
    api,
    frameId,
    (el) => (el.type === "frame" ? newElementWith(el, { customData: withFrameLens(el.customData, { ...getFrameLens(el), level: level ?? undefined }) }) : el),
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/**
 * Sets (or clears, with `null`) "zooming into me shows that frame" on a node (plan §3.1). The target is addressed
 * by its `lensKey` when it has one, else its id — both resolve the same way in `lensView`'s `expandsTo` lookup.
 */
export function linkDetailFrame(api: ExcalidrawImperativeAPI, nodeId: string, targetFrameId: string | null): void {
  if (targetFrameId === null) {
    replaceElement(api, nodeId, (el) => newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), expandsTo: undefined }) }), CaptureUpdateAction.IMMEDIATELY);
    return;
  }
  const target = api.getSceneElementsIncludingDeleted().find((e) => e.id === targetFrameId && e.type === "frame");
  if (!target) return;
  const frameKey = getFrameLens(target)?.lensKey ?? target.id;
  replaceElement(
    api,
    nodeId,
    (el) => newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), expandsTo: { frameKey } }) }),
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/**
 * Creates a new, empty interactive frame beside `parentFrameId` — to its right, clear of every other frame (D23) —
 * and links `nodeId` to it, in one step. Returns the new frame's id, or `undefined` when `parentFrameId` is gone.
 */
export function createDetailFrame(api: ExcalidrawImperativeAPI, parentFrameId: string, nodeId: string): string | undefined {
  const scene = api.getSceneElementsIncludingDeleted();
  const parent = scene.find((e) => e.id === parentFrameId && e.type === "frame");
  if (!parent) return undefined;

  const anchor: Box = { x: parent.x, y: parent.y, width: parent.width, height: parent.height };
  const otherFrames: Box[] = scene.filter((e) => !e.isDeleted && e.type === "frame" && e.id !== parentFrameId).map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
  const s = api.getAppState();
  const viewport: Box = { x: -s.scrollX, y: -s.scrollY, width: s.width / s.zoom.value, height: s.height / s.zoom.value };
  const { dx, dy } = findPlacement(anchor, { existing: otherFrames, viewport, anchor });
  const box: Box = { x: anchor.x + dx, y: anchor.y + dy, width: anchor.width, height: anchor.height };

  const title = `${labelOf(scene, nodeId) || frameName(parent)} detail`;
  const id = randomId();
  const skeleton = {
    type: "frame",
    id,
    ...box,
    name: title,
    children: [],
    customData: withDiagramMeta(undefined, { type: "architecture", interactive: true }),
  };
  const [frame] = convertToExcalidrawElements([skeleton] as never, { regenerateIds: false }) as unknown as Mutable<ExcalidrawElement>[];
  Object.assign(frame!, box);

  const elements = scene.map((el) =>
    el.id === nodeId ? newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), expandsTo: { frameKey: id } }) }) : el,
  );
  api.updateScene({ elements: [...elements, frame!], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return id;
}

/** Interactive frames other than `excludeId`, for the "Link to detail frame…" picker. */
export function detailFrameCandidates(api: ExcalidrawImperativeAPI, excludeId: string): { id: string; title: string }[] {
  return api
    .getSceneElements()
    .filter((el) => el.type === "frame" && el.id !== excludeId && getDiagramMeta(el)?.interactive)
    .map((el) => ({ id: el.id, title: frameName(el) }));
}

/** Links `nodeId` to a frame on another canvas (a detail canvas, plan §4): `expandsTo` with that canvas's id. */
export function linkDetailFrameElsewhere(api: ExcalidrawImperativeAPI, nodeId: string, canvasId: string, frameKey: string): void {
  replaceElement(
    api,
    nodeId,
    (el) => newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), expandsTo: { frameKey, canvasId } }) }),
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/** Replaces a node's sources (the properties panel's "Source" field, plan §3.3), validated per field, one undo step. */
export function setNodeSources(api: ExcalidrawImperativeAPI, nodeId: string, sources: readonly NodeSource[]): void {
  replaceElement(
    api,
    nodeId,
    (el) => newElementWith(el, { customData: withNodeLens(el.customData, { ...getNodeLens(el), sources: sources.length ? [...sources] : undefined }) }),
    CaptureUpdateAction.IMMEDIATELY,
  );
}
