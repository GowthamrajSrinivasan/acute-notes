/**
 * Moving a selection from one canvas to another (plan D59): the pure planning half. A genuine move keeps every
 * node's `acuteNode.key` and every frame's key, so `refs` and `expandsTo` aimed at them still resolve (D53); a copy
 * never does. Cut-and-paste is a copy by design and never goes through here.
 *
 * `planMove` takes the source scene, the selection and the target scene and returns the elements to add to the
 * target (translated clear of what is there) and the source scene as it will be (moved elements deleted, anything
 * that pointed at them patched). It performs no I/O; `components/canvas/moveToCanvas.ts` writes the result.
 *
 * What moves together: a frame with its members, a shape with its bound text, grouped elements, and arrows with both
 * ends in the set. An arrow with an end left behind is unbound in whichever copy it ends up in. Rich blocks, page
 * previews and images are refused rather than half-moved: their documents and files are tied to the canvas they were
 * made on.
 */
import { nodeKeyFor } from "@/domain/lens/identity";
import type { SceneElement } from "./adapter";
import { getFrameLens, getNodeLens, NODE_ELEMENT_TYPES, withFrameLens, withNodeLens } from "./diagram";
import { uniqueKey } from "./projectOps";

export type MoveElement = SceneElement & { version?: number; versionNonce?: number; updated?: number; index?: string | null };

export interface MoveInput {
  /** The source canvas's scene, deleted elements included, in z-order. */
  elements: readonly MoveElement[];
  selectedIds: readonly string[];
  sourceCanvasId: string;
  targetCanvasId: string;
  /** The target canvas's scene, deleted elements included. */
  targetElements: readonly MoveElement[];
}

export type MovePlan =
  | {
      ok: true;
      /** Elements to add to the target, translated, with their keys pinned. */
      additions: MoveElement[];
      /** The whole source scene after the move (same order; moved elements deleted; links to them re-pointed). */
      sourceElements: MoveElement[];
      /** Moved shapes + frames, for the confirmation message. */
      count: number;
      /** The keys that travelled with the selection. */
      keys: string[];
    }
  | { ok: false; reason: string };

const UNMOVABLE = new Set(["embeddable", "iframe", "image", "magicframe"]);

const live = (e: MoveElement) => !e.isDeleted;

/** Bumps an element so a synced scene sees the change (Excalidraw reconciles on version, then nonce). */
function bump<T extends MoveElement>(el: T, patch: Partial<MoveElement>): T {
  return { ...el, ...patch, version: (el.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() };
}

/** A frame's key as Lens addresses it: its `lensKey`, else its id. */
const frameKeyOf = (frame: MoveElement) => getFrameLens(frame)?.lensKey ?? frame.id;

function labelOf(elements: readonly MoveElement[], id: string): string {
  const t = elements.find((e) => e.type === "text" && e.containerId === id && live(e));
  return (t?.originalText ?? t?.text ?? "").trim();
}

/** The ids that travel with `selectedIds`: members, bound text, groups, and arrows with both ends in the set. */
function expand(elements: readonly MoveElement[], selectedIds: readonly string[]): Set<string> {
  const liveEls = elements.filter(live);
  const byId = new Map(liveEls.map((e) => [e.id, e] as const));
  const set = new Set(selectedIds.filter((id) => byId.has(id)));
  for (let grew = true; grew; ) {
    grew = false;
    const add = (id: string) => {
      if (byId.has(id) && !set.has(id)) {
        set.add(id);
        grew = true;
      }
    };
    for (const id of [...set]) {
      const el = byId.get(id)!;
      if (el.containerId) add(el.containerId);
      for (const other of liveEls) {
        if (other.containerId === id || (el.type === "frame" && other.frameId === id)) add(other.id);
        else if (el.groupIds.length && other.groupIds.some((g) => el.groupIds.includes(g))) add(other.id);
      }
    }
    for (const a of liveEls) {
      if (a.type !== "arrow" || set.has(a.id)) continue;
      const from = a.startBinding?.elementId;
      const to = a.endBinding?.elementId;
      if (from && to && set.has(from) && set.has(to)) add(a.id);
    }
  }
  return set;
}

export function planMove(input: MoveInput): MovePlan {
  const { elements, sourceCanvasId, targetCanvasId, targetElements } = input;
  if (sourceCanvasId === targetCanvasId) return { ok: false, reason: "That is already this canvas." };

  const set = expand(elements, input.selectedIds);
  if (!set.size) return { ok: false, reason: "Select something to move first." };
  const inSet = (id: string | null | undefined): boolean => !!id && set.has(id);
  const moving = elements.filter((e) => live(e) && set.has(e.id));

  const unmovable = moving.find((e) => UNMOVABLE.has(e.type));
  if (unmovable) {
    return { ok: false, reason: `A ${unmovable.type === "embeddable" ? "rich block or page preview" : unmovable.type} can't be moved to another canvas yet. Move only shapes, text and frames.` };
  }

  const targetLive = targetElements.filter(live);
  const targetIds = new Set(targetLive.map((e) => e.id));
  const clash = moving.find((e) => targetIds.has(e.id));
  if (clash) return { ok: false, reason: "An object with the same id already exists on that canvas." };

  // Keys that must stay unique (D53): a moved key can't land on a canvas that already uses it.
  const targetKeys = new Set(
    targetLive.flatMap((e) => (e.type === "frame" ? [frameKeyOf(e), e.id] : NODE_ELEMENT_TYPES.includes(e.type) ? [getNodeLens(e)?.key ?? ""] : [])).filter(Boolean),
  );
  const sourceKeys = new Set(
    elements.filter((e) => live(e) && !set.has(e.id)).flatMap((e) => (NODE_ELEMENT_TYPES.includes(e.type) ? [getNodeLens(e)?.key ?? ""] : [])).filter(Boolean),
  );
  for (const e of moving) {
    const key = e.type === "frame" ? frameKeyOf(e) : NODE_ELEMENT_TYPES.includes(e.type) ? getNodeLens(e)?.key : undefined;
    if (key && targetKeys.has(key)) return { ok: false, reason: `The key "${key}" is already used on that canvas, so moving would make references to it ambiguous.` };
  }

  // Frames keep their key: pin `lensKey` to the id they have now (the lookup resolves `lensKey` or id).
  const movedFrames = new Map<string, MoveElement>();
  const prepared = new Map<string, MoveElement>();
  for (const e of moving) {
    if (e.type !== "frame") continue;
    const lens = getFrameLens(e);
    const pinned = lens?.lensKey ? e : { ...e, customData: withFrameLens(e.customData, { ...lens, lensKey: e.id }) };
    prepared.set(e.id, pinned);
    movedFrames.set(e.id, pinned);
  }

  // Nodes keep their key; one with none gets one now, unique among both canvases' keys (D59).
  const keys: string[] = [];
  const taken = new Set([...targetKeys, ...sourceKeys]);
  for (const e of moving) {
    if (!NODE_ELEMENT_TYPES.includes(e.type)) continue;
    let key = getNodeLens(e)?.key;
    if (!key) {
      const frame = e.frameId ? (movedFrames.get(e.frameId) ?? elements.find((f) => f.id === e.frameId)) : undefined;
      key = uniqueKey(nodeKeyFor(frame ? frameKeyOf(frame) : "node", labelOf(elements, e.id) || "node"), taken);
      prepared.set(e.id, { ...e, customData: withNodeLens(e.customData, { ...getNodeLens(e), key }) });
    }
    taken.add(key);
    keys.push(key);
  }
  for (const f of movedFrames.values()) keys.push(frameKeyOf(f));

  // Which frame does a drill link name? (`lensKey` or id, like `lensView`.)
  const movedFrameFor = (frameKey: string) => [...movedFrames.values()].find((f) => frameKeyOf(f) === frameKey || f.id === frameKey);

  // Translate clear of the target's existing content, so nothing lands on top of it.
  const base = [...set].map((id) => prepared.get(id) ?? elements.find((e) => e.id === id)!);
  const minX = Math.min(...base.map((e) => e.x));
  const minY = Math.min(...base.map((e) => e.y));
  let dx = 0;
  let dy = 0;
  if (targetLive.length) {
    dx = Math.max(...targetLive.map((e) => e.x + e.width)) + 80 - minX;
    dy = Math.min(...targetLive.map((e) => e.y)) - minY;
  }

  const additions: MoveElement[] = base.map((e) => {
    let out: MoveElement = { ...e, x: e.x + dx, y: e.y + dy, index: null };
    if (out.frameId && !inSet(out.frameId)) out = { ...out, frameId: null };
    if (out.type === "arrow") {
      out = {
        ...out,
        startBinding: inSet(out.startBinding?.elementId) ? out.startBinding : null,
        endBinding: inSet(out.endBinding?.elementId) ? out.endBinding : null,
      };
    }
    if (out.boundElements) out = { ...out, boundElements: out.boundElements.filter((b) => inSet(b.id)) };
    // A drill link keeps pointing at the same frame, now named relative to the new canvas.
    const expandsTo = NODE_ELEMENT_TYPES.includes(out.type) ? getNodeLens(out)?.expandsTo : undefined;
    if (expandsTo) {
      const canvas = expandsTo.canvasId ?? sourceCanvasId;
      const stillTogether = canvas === sourceCanvasId && !!movedFrameFor(expandsTo.frameKey);
      const next = stillTogether || canvas === targetCanvasId ? { frameKey: expandsTo.frameKey } : { frameKey: expandsTo.frameKey, canvasId: canvas };
      out = { ...out, customData: withNodeLens(out.customData, { ...getNodeLens(out), expandsTo: next }) };
    }
    return out;
  });

  // The source scene afterwards: moved elements deleted; whatever pointed at them re-pointed or unbound.
  const sourceElements = elements.map((e) => {
    if (set.has(e.id)) return live(e) ? bump(e, { isDeleted: true }) : e;
    let out: MoveElement = e;
    if (e.type === "arrow") {
      const cutStart = inSet(e.startBinding?.elementId);
      const cutEnd = inSet(e.endBinding?.elementId);
      if (cutStart || cutEnd) out = bump(out, { startBinding: cutStart ? null : e.startBinding, endBinding: cutEnd ? null : e.endBinding });
    }
    if (e.boundElements?.some((b) => inSet(b.id))) out = bump(out, { boundElements: e.boundElements.filter((b) => !inSet(b.id)) });
    const expandsTo = NODE_ELEMENT_TYPES.includes(e.type) && live(e) ? getNodeLens(e)?.expandsTo : undefined;
    if (expandsTo && (expandsTo.canvasId ?? sourceCanvasId) === sourceCanvasId && movedFrameFor(expandsTo.frameKey)) {
      out = bump(out, { customData: withNodeLens(out.customData, { ...getNodeLens(out), expandsTo: { frameKey: expandsTo.frameKey, canvasId: targetCanvasId } }) });
    }
    return out;
  });

  const count = moving.filter((e) => e.type === "frame" || NODE_ELEMENT_TYPES.includes(e.type)).length;
  return { ok: true, additions, sourceElements, count, keys };
}
