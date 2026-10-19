/**
 * Semantic references across canvases (plan D53, D59): `acuteNode.refs` hold Lens keys, and this is the workspace-wide
 * read-only lookup that turns a key into the node or frame it names, on whichever canvas it lives. Pure: callers hand
 * it each canvas's elements (the open canvas live, the others as loaded) and it builds the index. It resolves a key to
 * its node or frame and nothing more — no drill UI, no evidence, no navigation (those are Phase 1B's).
 *
 * Rules (D53): a ref whose key doesn't resolve is reported `unresolved`, never dropped or rewritten, and resolves
 * again if the key reappears; a key found on two nodes is reported `ambiguous` rather than picking one.
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import { frameTitleOf, getFrameLens, getNodeProject, getNodeSemantics, NODE_ELEMENT_TYPES, type NodeKind } from "@/domain/canvas/diagram";
import type { DocumentRecord } from "@/domain/types";
import { cardLabel, isCard } from "./cards";
import { lensKeyOf } from "./identity";

/** A node or frame that a key names. */
export interface KeyedTarget {
  key: string;
  canvasId: string;
  elementId: string;
  what: "node" | "frame";
  label: string;
  /** The node's kind (architecture or project), when it has one. */
  kind?: NodeKind;
  /**
   * This entry registers the element under its id rather than its key (D53 refs may name a node by either; an id
   * survives a move too, D59). Pickers list a node once, by its key, so they skip these.
   */
  alias?: true;
}

/** A node carrying `refs` (a decision, finding, constraint, annotation, …). */
export interface RefHolder {
  canvasId: string;
  elementId: string;
  key?: string;
  label: string;
  kind?: NodeKind;
  refs: string[];
}

export interface KeyIndex {
  byKey: ReadonlyMap<string, readonly KeyedTarget[]>;
  holders: readonly RefHolder[];
}

export type RefResolution =
  | { key: string; status: "resolved"; target: KeyedTarget }
  | { key: string; status: "ambiguous"; targets: readonly KeyedTarget[] }
  | { key: string; status: "unresolved" };

function labelsOf(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "text" && el.containerId) labels.set(el.containerId, (el.originalText ?? el.text ?? "").trim());
  }
  return labels;
}

/**
 * One canvas's keyed nodes and frames, and the nodes on it that hold refs. Deleted elements are skipped (D53 (4)). Nodes
 * are shapes and (Phase 2) cards; a node's key follows the Lens identity rule (D21: `acuteNode.key`, else the map
 * identity it carries), which needs the canvas's documents for cards.
 */
export function indexScene(canvasId: string, elements: readonly SceneElement[], getDocument: (id: string) => DocumentRecord | null | undefined = () => undefined): { targets: KeyedTarget[]; holders: RefHolder[] } {
  const labels = labelsOf(elements);
  const targets: KeyedTarget[] = [];
  const holders: RefHolder[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    if (el.type === "frame") {
      // A frame's key is its `lensKey`, else its id; both resolve (a pinned `lensKey` keeps working after a move, D59).
      const lens = getFrameLens(el);
      const label = frameTitleOf(el as SceneElement & { name?: string | null });
      targets.push({ key: lens?.lensKey ?? el.id, canvasId, elementId: el.id, what: "frame", label });
      if (lens?.lensKey && lens.lensKey !== el.id) targets.push({ key: el.id, canvasId, elementId: el.id, what: "frame", label, alias: true });
      continue;
    }
    const card = isCard(el);
    if (!card && !NODE_ELEMENT_TYPES.includes(el.type)) continue;
    const key = lensKeyOf(el, getDocument);
    const label = card ? cardLabel(el, getDocument) : labels.get(el.id) || "Untitled";
    const kind = getNodeSemantics(el)?.kind;
    if (key) targets.push({ key, canvasId, elementId: el.id, what: "node", label, ...(kind ? { kind } : {}) });
    // By id as well: an agent can ref a node it read from get_canvas before it has a key.
    if (key !== el.id) targets.push({ key: el.id, canvasId, elementId: el.id, what: "node", label, ...(kind ? { kind } : {}), ...(key ? { alias: true as const } : {}) });
    const refs = getNodeProject(el)?.refs;
    if (refs?.length) holders.push({ canvasId, elementId: el.id, ...(key ? { key } : {}), label, ...(kind ? { kind } : {}), refs });
  }
  return { targets, holders };
}

/** The index over every canvas given. A canvas that failed to load is simply absent, so its keys read as unresolved. */
export function buildKeyIndex(canvases: Iterable<{ canvasId: string; elements: readonly SceneElement[]; getDocument?: (id: string) => DocumentRecord | null | undefined }>): KeyIndex {
  const byKey = new Map<string, KeyedTarget[]>();
  const holders: RefHolder[] = [];
  for (const { canvasId, elements, getDocument } of canvases) {
    const scene = indexScene(canvasId, elements, getDocument);
    for (const t of scene.targets) {
      const list = byKey.get(t.key);
      // The same element can be registered twice (frame by `lensKey` and by id); it is one target.
      if (!list) byKey.set(t.key, [t]);
      else if (!list.some((x) => x.canvasId === t.canvasId && x.elementId === t.elementId)) list.push(t);
    }
    holders.push(...scene.holders);
  }
  return { byKey, holders };
}

export function resolveRef(index: KeyIndex, key: string): RefResolution {
  const targets = index.byKey.get(key);
  if (!targets?.length) return { key, status: "unresolved" };
  return targets.length === 1 ? { key, status: "resolved", target: targets[0]! } : { key, status: "ambiguous", targets };
}

export function resolveRefs(index: KeyIndex, refs: readonly string[]): RefResolution[] {
  return refs.map((k) => resolveRef(index, k));
}

/** The nodes whose `refs` include any of `keys`: "which decisions affect this node?" (D53 (1)). */
export function inboundRefs(index: KeyIndex, keys: readonly string[]): RefHolder[] {
  const wanted = new Set(keys);
  return index.holders.filter((h) => h.refs.some((r) => wanted.has(r)));
}

/** The keyed, live nodes and frames of a scene: element id → key (what `keysRemoved` compares). */
export function liveKeys(elements: readonly SceneElement[], getDocument?: (id: string) => DocumentRecord | null | undefined): Map<string, { key: string; label: string }> {
  const out = new Map<string, { key: string; label: string }>();
  for (const t of indexScene("", elements, getDocument).targets) if (!out.has(t.elementId)) out.set(t.elementId, { key: t.key, label: t.label });
  return out;
}

/**
 * The keys that were live in `before` and are gone from `after` (deleted, cut, or removed outright), unless another
 * live element still carries the same key. What D59's "this node is referenced" notice checks after each change.
 */
export function keysRemoved(before: ReadonlyMap<string, { key: string; label: string }>, after: ReadonlyMap<string, { key: string; label: string }>): { key: string; label: string; elementId: string }[] {
  const stillLive = new Set([...after.values()].map((v) => v.key));
  const out: { key: string; label: string; elementId: string }[] = [];
  for (const [elementId, v] of before) if (!after.has(elementId) && !stillLive.has(v.key)) out.push({ ...v, elementId });
  return out;
}
