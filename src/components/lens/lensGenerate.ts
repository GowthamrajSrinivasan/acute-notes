/**
 * "✨ Generate L3 for …" (Lens plan §6.3, D7, Phase 5): the in-app model proposes a node's next level, rendered as one
 * interactive frame on the companion **Detail Canvas** "<canvas> · detail" (created on first use; the user's canvas
 * stays as they drew it) and staged there for review like any change set. Nothing is written before Accept.
 *
 * The parent's drill link can't travel in that set: it belongs to another canvas, and the frame's id exists only once
 * the frame does. So the set carries an intent (in memory, like the pending set itself), and accepting it writes the
 * link on the parent's canvas — appended to its Yjs document when it isn't open, as "Move to canvas…" writes its
 * target — then reopens Lens one level down from where the user asked.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { asGeneratedLevel, asLevelPlan, expandInput } from "@/ai/lens/lensAI";
import type { LensExpandInput } from "@/ai/lens/lensTasks";
import { AI_PROVIDER_DESCRIPTORS } from "@/ai/providers/registry";
import { renderVisualPlan } from "@/ai/renderer/render";
import type { RenderContext } from "@/ai/renderer/types";
import type { AIRuntime } from "@/ai/runtime";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getNodeLens, withNodeLens } from "@/domain/canvas/diagram";
import { newId } from "@/domain/ids";
import type { FrameRef, LensLevelView, LensNode } from "@/domain/lens/lensView";
import type { VersionedSceneElement } from "@/mcp/resources/workspaceScan";
import { getPersistence } from "@/persistence";
import { hierarchy } from "@/state/hierarchy";
import { lensPanel } from "@/state/lensPanel";
import { canvasDocId } from "@/sync/docIds";
import { SceneBinding } from "@/sync/sceneBinding";
import { createCanvas } from "@/workspaces/hierarchy";
import { invalidateKeyIndex } from "./keyIndex";
import { invalidateWorkspaceScenes } from "./workspaceScenes";

/** Device-local links between a canvas and its Detail Canvas (meta store; never in documents or exports). */
const detailKey = (canvasId: string) => `lens.detailCanvas/${canvasId}`;
const detailOfKey = (canvasId: string) => `lens.detailOf/${canvasId}`;

/**
 * The Detail Canvas for `originCanvasId` (D7): the one made for it earlier, else a new "<title> · detail". A level
 * generated from a node already on a Detail Canvas goes on that same canvas (no "· detail · detail").
 */
export async function detailCanvasFor(workspaceId: string, originCanvasId: string): Promise<{ canvasId: string; created: boolean }> {
  const { meta, canvases } = getPersistence();
  if (await meta.get<string>(detailOfKey(originCanvasId))) return { canvasId: originCanvasId, created: false };
  const known = await meta.get<string>(detailKey(originCanvasId));
  const existing = known ? await canvases.get(known) : null;
  if (existing && existing.workspaceId === workspaceId) return { canvasId: existing.id, created: false };
  const origin = await canvases.get(originCanvasId);
  const canvas = await createCanvas(getPersistence(), workspaceId, `${origin?.title ?? "Canvas"} · detail`);
  await meta.set(detailKey(originCanvasId), canvas.id);
  await meta.set(detailOfKey(canvas.id), originCanvasId);
  void hierarchy.refresh();
  return { canvasId: canvas.id, created: true };
}

/** A canvas's elements: live when it is the open one, else read from its stored Yjs document. */
async function sceneOf(canvasId: string, open: { canvasId: string; api: ExcalidrawImperativeAPI }): Promise<readonly SceneElement[]> {
  if (canvasId === open.canvasId) return open.api.getSceneElements() as unknown as readonly SceneElement[];
  const doc = new Y.Doc();
  try {
    for (const u of (await getPersistence().yupdates.load(canvasDocId(canvasId))).updates) Y.applyUpdate(doc, u);
    return new SceneBinding(doc.getMap<VersionedSceneElement>("elements")).readScene().filter((e) => !e.isDeleted) as unknown as readonly SceneElement[];
  } finally {
    doc.destroy();
  }
}

/** Where a new level goes on the Detail Canvas: clear of what is there, to the right of it (or at the origin). */
export function placementOn(elements: readonly Pick<SceneElement, "x" | "y" | "width" | "height" | "isDeleted">[]): RenderContext {
  const live = elements.filter((e) => !e.isDeleted);
  const existing = live.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
  const right = live.length ? Math.max(...live.map((e) => e.x + e.width)) + 200 : 0;
  const top = live.length ? Math.min(...live.map((e) => e.y)) : 0;
  return { existing, viewport: { x: right, y: top, width: 1400, height: 900 } };
}

/** What accepting a generated level must still do: link the parent to it, then show it in Lens. */
interface LinkIntent {
  workspaceId: string;
  originCanvasId: string;
  nodeId: string;
  nodeKey: string;
  frameKey: string;
  lens: { root: FrameRef; path: string[] };
}
const intents = new Map<string, LinkIntent>();

export type GenerateOutcome = { ok: true; detailCanvasId: string; created: boolean; count: number } | { ok: false; reason: string };

/**
 * Runs `lens_expand` for `node` and stages the result on the Detail Canvas. The caller then opens that canvas, where
 * the review bar shows it. Throws the runtime's `AIError` (cancelled, no provider, …) for the caller to word.
 */
export async function generateLevel(args: {
  runtime: AIRuntime;
  api: ExcalidrawImperativeAPI;
  home: { workspaceId: string; canvasId: string };
  view: LensLevelView;
  node: LensNode;
  level: { index: number; name: string };
  lens: { root: FrameRef; path: string[] };
  signal?: AbortSignal;
}): Promise<GenerateOutcome> {
  const { runtime, api, home, view, node, level } = args;
  const r = await runtime.run<LensExpandInput, unknown>("lens_expand", expandInput(view, node, level), args.signal ? { signal: args.signal } : {});
  let plan;
  try {
    plan = asLevelPlan(validateVisualPlan(r.data).plan, level.index);
  } catch {
    return { ok: false, reason: "The AI's proposal couldn't be used. Try again." };
  }
  if (!plan.nodes.some((n) => n.type === "shape")) return { ok: false, reason: "The AI didn't propose any parts for this level." };

  const detail = await detailCanvasFor(home.workspaceId, view.frame.canvasId);
  const operationId = newId("op");
  const authType = AI_PROVIDER_DESCRIPTORS.find((d) => d.id === r.providerId)?.accessType;
  const rendered = await renderVisualPlan(plan, {
    operationId,
    title: `Lens: ${node.label} — L${level.index} ${level.name} (AI proposal)`,
    metadata: { createdBy: "ai", task: "lens_expand", operationId, provider: r.providerId, model: r.usage.model, ...(authType ? { authType } : {}) },
    context: placementOn(await sceneOf(detail.canvasId, { canvasId: home.canvasId, api })),
  });
  const generated = asGeneratedLevel(rendered, node, level.index);
  if (!generated) return { ok: false, reason: "The AI's proposal had nothing to draw as a level." };
  getPendingChanges().propose(detail.canvasId, generated.set);
  intents.set(operationId, { workspaceId: home.workspaceId, originCanvasId: view.frame.canvasId, nodeId: node.id, nodeKey: node.key, frameKey: generated.frameKey, lens: args.lens });
  return { ok: true, detailCanvasId: detail.canvasId, created: detail.created, count: plan.nodes.length };
}

/** Rejected or replaced: nothing to link (called when a set is settled without Accept). */
export function forgetGenerated(operationId: string): void {
  intents.delete(operationId);
}

/**
 * After Accept (`acceptPending.ts`): when `set` is a generated level, links its parent node to the new frame on the
 * parent's canvas, then opens Lens one level down. A no-op for any other set.
 */
export async function linkGeneratedLevel(api: ExcalidrawImperativeAPI, home: { workspaceId: string; canvasId: string }, set: ChangeSet, created: ReadonlyMap<string, string>): Promise<void> {
  const intent = intents.get(set.operationId);
  if (!intent) return;
  intents.delete(set.operationId);
  const frameId = created.get(intent.frameKey);
  if (!frameId) return;
  const expandsTo = intent.originCanvasId === home.canvasId ? { frameKey: frameId } : { frameKey: frameId, canvasId: home.canvasId };
  try {
    if (intent.originCanvasId === home.canvasId) {
      const scene = api.getSceneElementsIncludingDeleted();
      api.updateScene({
        elements: scene.map((el) => (el.id === intent.nodeId ? ({ ...el, customData: withNodeLens(el.customData, { ...getNodeLens(el), expandsTo }), version: el.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } as ExcalidrawElement) : el)),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    } else {
      await writeLinkElsewhere(intent.originCanvasId, intent.nodeId, expandsTo);
    }
  } catch (err) {
    console.error("[acute-notes] Couldn't link the generated level to its node", err);
    api.setToast({ message: "The level was added, but linking it to its node failed. Use “Link to detail frame…” on the node.", duration: 6000 });
    return;
  }
  invalidateWorkspaceScenes(intent.workspaceId);
  invalidateKeyIndex(intent.workspaceId);
  lensPanel.open(intent.lens.root, { path: [...intent.lens.path, intent.nodeKey] });
}

/** Sets `expandsTo` on a node of a canvas that isn't open: an incremental update appended to its stored document. */
async function writeLinkElsewhere(canvasId: string, nodeId: string, expandsTo: { frameKey: string; canvasId?: string }): Promise<void> {
  const { yupdates } = getPersistence();
  const key = canvasDocId(canvasId);
  const doc = new Y.Doc();
  try {
    for (const u of (await yupdates.load(key)).updates) Y.applyUpdate(doc, u);
    const map = doc.getMap<VersionedSceneElement>("elements");
    const el = map.get(nodeId) as (VersionedSceneElement & { customData?: Record<string, unknown>; version?: number }) | undefined;
    if (!el || el.isDeleted) throw new Error("The node is gone from its canvas.");
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      map.set(nodeId, {
        ...el,
        customData: withNodeLens(el.customData, { ...getNodeLens(el as never), expandsTo }),
        version: (el.version ?? 1) + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        updated: Date.now(),
      } as VersionedSceneElement);
    });
    await yupdates.append(key, Y.encodeStateAsUpdate(doc, before));
  } finally {
    doc.destroy();
  }
}
