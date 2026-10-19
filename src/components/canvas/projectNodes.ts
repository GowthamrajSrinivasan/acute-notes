/**
 * Canvas commands for the Project profile (plan §3.6, D33–D35, D39, D53): creating decisions, findings, progress
 * items and the rest as ordinary shapes, choosing an option, promoting a node, and editing its `refs`. Each is one
 * ordinary undo step following `lensNodes.ts`'s pattern; a user's own edit is a canvas command (D5), never a change
 * set. The rules they apply (what Promote does, what Choose sets) live in `domain/canvas/projectOps.ts`.
 */
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  getFrameLens,
  getNodeLens,
  getNodeProject,
  getNodeSemantics,
  NODE_ELEMENT_TYPES,
  withFrameLens,
  withNodeLens,
  withNodeProject,
  withNodeSemantics,
  type LensProfileId,
  type NodeKind,
} from "@/domain/canvas/diagram";
import { NODE_KIND_STYLES } from "@/domain/canvas/nodeKindStyle";
import { PROJECT_KIND_LABELS, projectKindOf, type NodeProject, type ProjectKind } from "@/domain/canvas/nodeProject";
import { chooseOptionPatch, nextPromotion, uniqueKey, withoutRef, withRef } from "@/domain/canvas/projectOps";
import { randomId } from "@/domain/ids";
import { nodeKeyFor } from "@/domain/lens/identity";
import { laneSlot, PROJECT_NODE_SIZE } from "@/domain/project/projectChanges";
import { replaceElement } from "./richBlocks";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const NODE_W = PROJECT_NODE_SIZE.width;
const NODE_H = PROJECT_NODE_SIZE.height;
const PAD = 24;

const isShape = (el: ExcalidrawElement) => !el.isDeleted && NODE_ELEMENT_TYPES.includes(el.type);

function labelOf(scene: readonly ExcalidrawElement[], elementId: string): string {
  const text = scene.find((e) => e.type === "text" && e.containerId === elementId) as (ExcalidrawElement & { originalText?: string; text?: string }) | undefined;
  return (text?.originalText ?? text?.text ?? "").trim();
}

/** Turns a frame's Lens profile on (`project`) or back to the default (`null`). Needs an interactive frame to show. */
export function setFrameProfile(api: ExcalidrawImperativeAPI, frameId: string, profile: LensProfileId | null): void {
  replaceElement(
    api,
    frameId,
    (el) => (el.type === "frame" ? newElementWith(el, { customData: withFrameLens(el.customData, { ...getFrameLens(el), profile: profile ?? undefined }) }) : el),
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/** The key of the `project` node in `frameId`, when it has one (D39). */
function projectKeyIn(scene: readonly ExcalidrawElement[], frameId: string): string | undefined {
  const node = scene.find((e) => isShape(e) && e.frameId === frameId && projectKindOf(e) === "project");
  return node ? getNodeLens(node)?.key : undefined;
}

/** What a new node of `kind` starts with: the state a user creating it by hand means (a constraint they write holds). */
function defaults(kind: ProjectKind, scene: readonly ExcalidrawElement[], frameId: string): NodeProject {
  const siblings = scene.filter((e) => isShape(e) && e.frameId === frameId && projectKindOf(e) === kind);
  const nextOrder = Math.max(0, ...siblings.map((e) => getNodeProject(e)?.order ?? 0)) + 1;
  switch (kind) {
    case "decision":
      return { status: "proposed" };
    case "constraint":
      return { status: "accepted" };
    case "finding":
      return { stage: "ephemeral" };
    case "open_question":
      return { status: "open" };
    case "risk":
      return { severity: "medium" };
    case "milestone":
      return { order: nextOrder };
    case "progress_item":
      return { status: "not_started", order: nextOrder };
    case "annotation":
      return { intent: "note" };
    case "project":
      return { style: "modular" };
  }
}

/** Where a new node goes on the canvas: its lane's column, under what is already there (`laneSlot`, shared with MCP). */
function placement(scene: readonly ExcalidrawElement[], frame: ExcalidrawElement, kind: ProjectKind): { x: number; y: number } {
  const members = scene.filter((e) => isShape(e) && e.frameId === frame.id).map((e) => ({ x: e.x, y: e.y, kind: projectKindOf(e) }));
  return laneSlot({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, members, kind);
}

/**
 * Creates a project-knowledge node of `kind` inside `frameId`, in its lane, selected, in one undo step. It gets its
 * Lens key now (unique in the scene, so a ref to it resolves, D53) and the frame's project scope (D39); a `project`
 * node's scope is its own key. The frame grows to hold it. Returns the new element id, or `undefined` when the frame is gone.
 */
export function createProjectNode(api: ExcalidrawImperativeAPI, frameId: string, kind: ProjectKind, label?: string): string | undefined {
  const scene = api.getSceneElementsIncludingDeleted();
  const frame = scene.find((e) => e.id === frameId && e.type === "frame" && !e.isDeleted);
  if (!frame) return undefined;

  const text = label?.trim() || `New ${PROJECT_KIND_LABELS[kind].toLowerCase()}`;
  const id = randomId();
  const taken = new Set(scene.flatMap((e) => (isShape(e) ? [getNodeLens(e)?.key ?? ""] : [])));
  const key = uniqueKey(nodeKeyFor(getFrameLens(frame)?.lensKey ?? frame.id, text), taken);
  const scope = kind === "project" ? key : projectKeyIn(scene, frameId);
  const style = NODE_KIND_STYLES[kind];
  const { x, y } = placement(scene, frame, kind);

  let customData = withNodeSemantics(undefined, { kind });
  customData = withNodeLens(customData, { key });
  customData = withNodeProject(customData, { ...defaults(kind, scene, frameId), ...(scope ? { project: scope } : {}) });

  const skeleton = {
    type: "rectangle",
    id,
    x,
    y,
    width: NODE_W,
    height: NODE_H,
    backgroundColor: style.backgroundColor,
    strokeColor: style.strokeColor,
    fillStyle: "solid",
    roughness: 1,
    customData,
    label: { text },
  };
  const created = convertToExcalidrawElements([skeleton] as never, { regenerateIds: false }) as unknown as Mutable<ExcalidrawElement>[];
  for (const el of created) el.frameId = frameId;

  // The frame grows to hold the new node (Excalidraw clips what sits outside it).
  const right = x + NODE_W + PAD;
  const bottom = y + NODE_H + PAD;
  const grown = newElementWith(frame, { width: Math.max(frame.width, right - frame.x), height: Math.max(frame.height, bottom - frame.y) });
  const elements = [...scene.map((e) => (e.id === frame.id ? grown : e)), ...created];
  api.updateScene({ elements, appState: { selectedElementIds: { [id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return id;
}

/** Writes a shape's kind and project fields together: the kind first, so the fields are validated against it. */
function writeNode(el: ExcalidrawElement, kind: NodeKind | undefined, project: NodeProject): ExcalidrawElement {
  const semantics = { ...getNodeSemantics(el), kind };
  const was = getNodeSemantics(el)?.kind;
  const restyle =
    kind && kind !== was && (!was || (el.strokeColor === NODE_KIND_STYLES[was].strokeColor && el.backgroundColor === NODE_KIND_STYLES[was].backgroundColor))
      ? { strokeColor: NODE_KIND_STYLES[kind].strokeColor, backgroundColor: NODE_KIND_STYLES[kind].backgroundColor }
      : {};
  const retyped = withNodeSemantics(el.customData, semantics);
  return newElementWith(el, { customData: withNodeProject(retyped, { ...getNodeProject({ customData: retyped }), ...project }), ...restyle });
}

/**
 * Sets project-knowledge fields on a node (`undefined` clears a field), keeping its kind, key and everything else.
 * A hand edit in the properties panel; one undo step.
 */
export function setProjectFields(api: ExcalidrawImperativeAPI, nodeId: string, patch: NodeProject): void {
  replaceElement(api, nodeId, (el) => writeNode(el, getNodeSemantics(el)?.kind, patch), CaptureUpdateAction.IMMEDIATELY);
}

/** Chooses `label` as a decision's option (D34), or `null` to reopen it. No-op when `label` isn't one of its options. */
export function chooseOption(api: ExcalidrawImperativeAPI, nodeId: string, label: string | null): boolean {
  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === nodeId);
  const patch = el && chooseOptionPatch(getNodeProject(el), label);
  if (!patch) return false;
  setProjectFields(api, nodeId, patch);
  return true;
}

/** Applies the node's next promotion (D33) on the same node, keeping its key and refs. Returns whether it applied. */
export function promoteNode(api: ExcalidrawImperativeAPI, nodeId: string): boolean {
  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === nodeId);
  if (!el) return false;
  const step = nextPromotion(projectKindOf(el), getNodeProject(el));
  if (!step || step.blocked) return false;
  replaceElement(api, nodeId, (cur) => writeNode(cur, step.kind ?? getNodeSemantics(cur)?.kind, step.patch), CaptureUpdateAction.IMMEDIATELY);
  return true;
}

/** Adds a semantic reference to `key` on a node (D53); a no-op when it is already there. */
export function addNodeRef(api: ExcalidrawImperativeAPI, nodeId: string, key: string): void {
  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === nodeId);
  if (!el) return;
  setProjectFields(api, nodeId, { refs: withRef(getNodeProject(el)?.refs, key) });
}

/** Removes a semantic reference from a node. */
export function removeNodeRef(api: ExcalidrawImperativeAPI, nodeId: string, key: string): void {
  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === nodeId);
  if (!el) return;
  const refs = withoutRef(getNodeProject(el)?.refs, key);
  setProjectFields(api, nodeId, { refs: refs.length ? refs : undefined });
}

/** The node's label, for messages. */
export function nodeLabel(api: ExcalidrawImperativeAPI, nodeId: string): string {
  return labelOf(api.getSceneElementsIncludingDeleted(), nodeId);
}
