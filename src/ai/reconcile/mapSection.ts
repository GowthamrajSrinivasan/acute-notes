/**
 * One section of a repo map (F43) reconciled with the canvas: the same F38
 * matching by stable key and F38b link reconciliation as "Update from new
 * content", for content an IDE agent sends as a whole section each time (so
 * there are no analysis units or model calls here — nothing to re-derive).
 *
 *   section plan (grouped: one `group` + its members, keys → `stableKey`)
 *     │ ungroup → reconcile (classify.ts) against the section's own objects
 *     ▼
 *   a new section → rendered whole (F30) as a new frame, clear of everything
 *   an existing one → adds placed in its frame below its lowest member (F41
 *   local reflow may make room), clean updates, conflicts (never applied
 *   without a decision), removals, and its own arrows rewired
 *
 * A node whose object the user deleted is not added back: the user's
 * correction wins, and is reported to the agent instead (`get_map_status`).
 *
 * Renderer-agnostic and model-free: no React, Excalidraw, AI runtime or I/O.
 */
import type { ChangeSet, ChangeTarget, ConflictItem, ProposedChange } from "@/ai/changes/changeSet";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import { renderVisualPlan, type Box, type RenderContext } from "@/ai/renderer/render";
import { ungroup } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import type { SceneElement } from "@/domain/canvas/adapter";
import { connectorSourceOf, reconciliationOf } from "@/domain/provenance";
import type { DocumentRecord, RelationType, SourceRef } from "@/domain/types";
import { reconcile, type ExistingObject } from "./classify";
import { currentText } from "./conflicts";
import { existingConnections, existingObjects } from "./existing";
import { cachedNodeFingerprint, nodeKind, updateChange } from "./nodes";
import { fingerprintOf, labelsByContainer, objectContent } from "./objects";

type GetDocument = (id: string) => DocumentRecord | null | undefined;

/** A live object of a map section, as the map's bookkeeping sees it. */
export interface MapObject {
  objectId: string;
  /** The user changed it since AI last wrote it (or its content isn't loaded). */
  edited: boolean;
  /** The user opted it out of updates (F39). */
  excluded: boolean;
}

/** One pass over the scene: each given source's live objects, by key. */
export function mapObjectIndex(elements: readonly SceneElement[], getDocument: GetDocument, sourceIds: ReadonlySet<string>): Map<string, Map<string, MapObject>> {
  const labels = labelsByContainer(elements);
  const out = new Map<string, Map<string, MapObject>>();
  for (const el of elements) {
    if (el.isDeleted || (el.type === "text" && el.containerId) || el.type === "arrow") continue;
    const link = reconciliationOf(el, getDocument);
    if (!link || !sourceIds.has(link.contentSourceId)) continue;
    const content = objectContent(el, labels, getDocument);
    const current = content ? fingerprintOf(content) : null;
    const byKey = out.get(link.contentSourceId) ?? new Map<string, MapObject>();
    if (!byKey.has(link.stableNodeKey)) byKey.set(link.stableNodeKey, { objectId: el.id, edited: current === null || current !== link.contentFingerprint, excluded: link.excludeFromReconciliation });
    out.set(link.contentSourceId, byKey);
  }
  return out;
}

/** An object's current text (canonical Markdown, a shape's label), for reporting the user's edit. */
export function mapObjectText(elements: readonly SceneElement[], getDocument: GetDocument, objectId: string): string | null {
  return currentText(elements, getDocument, objectId);
}

/** Arrows bound at both ends, with the map section (content source) that drew each, if any. */
export function mapConnectors(elements: readonly SceneElement[]): { arrowId: string; from: string; to: string; source?: string }[] {
  return elements.flatMap((el) => {
    if (el.isDeleted || el.type !== "arrow" || !el.startBinding?.elementId || !el.endBinding?.elementId) return [];
    const source = connectorSourceOf(el);
    return [{ arrowId: el.id, from: el.startBinding.elementId, to: el.endBinding.elementId, ...(source ? { source } : {}) }];
  });
}

/** A link between this section and another one (or a key not sent yet), with the other end already resolved by the caller. */
export interface CrossLink {
  /** This section's end (a node or the section's own key). */
  key: string;
  /** Whether `key` is the link's start. */
  outgoing: boolean;
  /** The other end: an object on the canvas, or one staged in another part of the pending set. */
  other: ChangeTarget;
  type: RelationType;
  label?: string;
}

export type NodeOutcome = "added" | "updated" | "unchanged" | "conflict";

export interface MapSectionInput {
  /** The section as a validated grouped plan (one group, keyed with the section's key, and its members); null removes the whole section. */
  plan: VisualPlan | null;
  /** The section's group node id (its key's plan id). */
  groupId: string;
  label: string;
  /** Its last accepted version, if any. */
  previous: { plan: VisualPlan; version: number } | null;
  sourceId: string;
  elements: readonly SceneElement[];
  getDocument: GetDocument;
  crossLinks: readonly CrossLink[];
  /** Every live box plus what other parts of the pending set will create, and the viewport; `objects` lets adds in an existing frame make room (F41). */
  context: RenderContext;
  /** Where a new section's frame starts looking for room. */
  newSection?: { anchor: Box; side: "right" | "below" };
  /** Repo references by key, stamped on created and updated objects. */
  refs: ReadonlyMap<string, SourceRef[]>;
  /** Every map section's content source: their arrows bound to an object this section removes go with it. */
  mapSources: ReadonlySet<string>;
  /** Prefix for this section's connection keys (unique within the pending set). */
  keyPrefix: string;
  operationId: string;
  title: string;
  metadata: ChangeSet["metadata"];
  parseMarkdown: ParseMarkdown;
}

export interface MapSectionResult {
  changes: ProposedChange[];
  conflicts: ConflictItem[];
  /** Per key sent. */
  outcomes: Map<string, NodeOutcome>;
  /** Keys left as they are because the user deleted or opted out of their object. */
  userKept: Map<string, "deleted" | "excluded">;
  /** Keys whose objects this proposes to remove (no longer in the section). */
  removed: string[];
  /** Where the section's objects are (staged or live), for placing later sections clear of them. */
  boxes: Box[];
}

const EMPTY_PLAN: VisualPlan = { version: 1, template: "sectioned", nodes: [], relationships: [] };

export async function reconcileMapSection(input: MapSectionInput): Promise<MapSectionResult> {
  const next = input.plan ? ungroup(input.plan) : EMPTY_PLAN;
  const previous = input.previous ? ungroup(input.previous.plan) : null;
  const existing = existingObjects(input.elements, input.getDocument, input.sourceId);
  // Markdown is parsed at most once per text: fingerprinting leaves its parse for the one change that needs it next
  // (taken once, so no two objects share blocks), and fingerprints of texts seen before are remembered.
  const stash = new Map<string, ReturnType<ParseMarkdown>>();
  const parse: ParseMarkdown = (md) => {
    const parsed = stash.get(md);
    if (!parsed) return input.parseMarkdown(md);
    stash.delete(md);
    return parsed;
  };
  const parseToFingerprint: ParseMarkdown = (md) => {
    const parsed = input.parseMarkdown(md);
    if (!stash.has(md)) stash.set(md, parsed);
    return parsed;
  };
  const plan = reconcile({
    previous,
    ...(input.previous ? { previousVersion: input.previous.version } : {}),
    next,
    existing,
    fingerprint: (n) => cachedNodeFingerprint(n, parseToFingerprint, input.parseMarkdown),
    objectKind: nodeKind,
  });

  const outcomes = new Map<string, NodeOutcome>();
  const userKept = new Map<string, "deleted" | "excluded">();
  const keyOf = (n: VisualNode) => n.stableKey ?? n.id;
  const hadObject = new Set(existing.map((o) => o.stableNodeKey));
  const accepted = new Set((previous?.nodes ?? []).flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
  for (const o of plan.skipped) userKept.set(o.stableNodeKey, "excluded");

  const matched = new Map<string, ExistingObject>();
  const adds: VisualNode[] = [];
  const changes: ProposedChange[] = [];
  const conflicts: ConflictItem[] = [];
  const removed: string[] = [];
  const withRefs = <C extends ProposedChange>(c: C): C => {
    const key = "stableNodeKey" in c ? c.stableNodeKey : undefined;
    const refs = key ? input.refs.get(key) : undefined;
    return refs?.length ? { ...c, sourceRefs: refs } : c;
  };

  for (const item of plan.items) {
    if (item.state === "add") {
      const key = keyOf(item.node);
      // Accepted before and now gone: the user deleted it. Their correction wins; it is reported, never re-added.
      if (accepted.has(key) && !hadObject.has(key)) {
        userKept.set(key, "deleted");
        outcomes.set(key, "unchanged");
        continue;
      }
      adds.push(item.node);
      outcomes.set(key, "added");
    } else if (item.state === "remove") {
      changes.push({ kind: "remove", target: item.object.objectId });
      if (!next.nodes.some((n) => n.stableKey === item.object.stableNodeKey)) removed.push(item.object.stableNodeKey);
    } else {
      matched.set(item.node.id, item.object);
      const key = keyOf(item.node);
      if (item.state === "unchanged") outcomes.set(key, "unchanged");
      else if (item.state === "update_clean") {
        outcomes.set(key, "updated");
        changes.push(withRefs(updateChange(item.node, item.object.objectId, parse)));
      } else {
        outcomes.set(key, "conflict");
        conflicts.push({
          target: item.object.objectId,
          stableNodeKey: item.object.stableNodeKey,
          apply: withRefs(updateChange(item.node, item.object.objectId, parse)),
          keep: { kind: "rebaseline", target: item.object.objectId, stableNodeKey: item.object.stableNodeKey },
        });
      }
    }
  }
  for (const n of next.nodes) if (!outcomes.has(keyOf(n)) && userKept.get(keyOf(n)) === "excluded") outcomes.set(keyOf(n), "unchanged");

  // Placement: a section with nothing on the canvas is a new frame; otherwise adds join its frame.
  const addIds = new Set(adds.map((n) => n.id));
  const boxes: Box[] = [];
  let g = 0;
  const rekey = (c: ProposedChange): ProposedChange => (c.kind === "connect" ? { ...c, key: `${input.keyPrefix}:${g}${c.key}` } : c);
  if (adds.length) {
    const opts = { operationId: input.operationId, title: input.title, metadata: input.metadata, parseMarkdown: parse };
    if (!matched.size && input.plan) {
      const sub = sectionPlan(input.plan, addIds);
      const context: RenderContext = {
        existing: input.context.existing,
        viewport: input.context.viewport,
        ...(input.newSection ? { anchor: input.newSection.anchor, anchorSide: input.newSection.side } : {}),
      };
      const rendered = await renderVisualPlan(sub, { ...opts, context });
      for (const c of rendered.changes) {
        if (c.kind === "move") continue; // never: no scene objects given
        changes.push(withRefs(c.kind === "create_frame" ? { ...c, title: input.label.slice(0, 200) } : rekey(c)));
        if ("box" in c) boxes.push(c.box);
      }
    } else {
      const members = [...matched.values()];
      const frameId = matched.get(input.groupId)?.frameId ?? members.find((o) => o.frameId)?.frameId;
      const inFrame = members.filter((o) => o.box && (!frameId || o.frameId === frameId));
      const lowest = inFrame.reduce<ExistingObject | null>((a, o) => (!a || o.box!.y + o.box!.height > a.box!.y + a.box!.height ? o : a), null);
      const sub: VisualPlan = {
        version: 1,
        template: "sectioned",
        nodes: adds.map((n) => stripParent(n)),
        relationships: next.relationships.filter((r) => addIds.has(r.from) && addIds.has(r.to)),
      };
      const context: RenderContext = lowest
        ? { existing: input.context.existing, viewport: input.context.viewport, anchor: lowest.box!, anchorSide: "below", anchorIds: [lowest.objectId], ...(input.context.objects ? { objects: input.context.objects } : {}) }
        : { existing: input.context.existing, viewport: input.context.viewport };
      const rendered = await renderVisualPlan(sub, { ...opts, context });
      const createdKeys: string[] = [];
      for (const c of rendered.changes) {
        changes.push(withRefs(rekey(c)));
        if ("box" in c && c.kind !== "create_frame") createdKeys.push(c.key);
        if ("box" in c) boxes.push(c.box);
      }
      if (frameId && createdKeys.length) changes.push({ kind: "update_frame", target: frameId, add: createdKeys, section: input.label.slice(0, 200) });
    }
    g++;
  }
  for (const o of matched.values()) if (o.box) boxes.push(o.box);

  // A section whose label changed renames its frame too — unless the user renamed the frame themselves.
  if (matched.size) {
    const members = [...matched.values()];
    const frameId = matched.get(input.groupId)?.frameId ?? members.find((o) => o.frameId)?.frameId;
    const frame = frameId ? input.elements.find((e) => e.id === frameId && e.type === "frame" && !e.isDeleted) : undefined;
    const name = input.label.slice(0, 200);
    const shown = (frame as { name?: string | null } | undefined)?.name ?? undefined;
    const sentBefore = input.previous?.plan.nodes.find((n) => n.type === "group")?.content;
    const previousLabel = sentBefore && "label" in sentBefore ? String(sentBefore.label).slice(0, 200) : undefined;
    if (frame && shown !== name && (shown === undefined || shown === previousLabel)) {
      const joining = changes.find((c): c is Extract<ProposedChange, { kind: "update_frame" }> => c.kind === "update_frame" && c.target === frame.id);
      if (joining) joining.name = name;
      else changes.push({ kind: "update_frame", target: frame.id, add: [], section: name, name });
    }
  }

  // Links. Among new objects they came with their render; any other link this section wants is drawn unless the
  // two objects are already linked (by any arrow). This section's own arrows it no longer wants are proposed for
  // removal; nobody else's arrows are ever touched. One of this section's own arrows whose relation the agent changed
  // is re-typed in place (`update_connection`); one that now runs the other way is replaced (Lens Phase 2: a node's
  // relations update with it, by key).
  const target = (nodeId: string): ChangeTarget | null => (addIds.has(nodeId) ? { created: nodeId } : matched.has(nodeId) ? { existing: matched.get(nodeId)!.objectId } : null);
  const idOfKey = new Map(next.nodes.map((n) => [keyOf(n), n.id] as const));
  const connections = existingConnections(input.elements, input.sourceId);
  const linked = new Set(connections.flatMap((c) => [`${c.from}>${c.to}`, `${c.to}>${c.from}`]));
  const wanted = new Set<string>();
  let x = 0;
  const retyped = new Set<string>();
  const link = (from: ChangeTarget, to: ChangeTarget, type: RelationType, label: string | undefined) => {
    if ("existing" in from && "existing" in to) {
      if (from.existing === to.existing) return;
      const pair = `${from.existing}>${to.existing}`;
      const ownSame = connections.find((c) => c.ownedBySource && c.from === from.existing && c.to === to.existing);
      const ownReverse = connections.find((c) => c.ownedBySource && c.from === to.existing && c.to === from.existing);
      const someoneElse = connections.some((c) => !c.ownedBySource && ((c.from === from.existing && c.to === to.existing) || (c.from === to.existing && c.to === from.existing)));
      if (ownSame) {
        wanted.add(pair);
        if (ownSame.relation !== type && !retyped.has(ownSame.arrowId)) {
          retyped.add(ownSame.arrowId);
          changes.push({ kind: "update_connection", target: ownSame.arrowId, relation: type });
        }
        return;
      }
      // This section's own arrow runs the other way: not wanted any more (removed below); the new one is drawn.
      if (ownReverse && !someoneElse) {
        changes.push({ kind: "connect", key: `${input.keyPrefix}:x${x++}`, from, to, relation: type, ...(label ? { label } : {}) });
        return;
      }
      wanted.add(pair).add(`${to.existing}>${from.existing}`);
      if (linked.has(pair)) return;
    }
    changes.push({ kind: "connect", key: `${input.keyPrefix}:x${x++}`, from, to, relation: type, ...(label ? { label } : {}) });
  };
  for (const r of next.relationships) {
    if (addIds.has(r.from) && addIds.has(r.to)) continue;
    const from = target(r.from);
    const to = target(r.to);
    if (from && to) link(from, to, r.type, r.label);
  }
  for (const l of input.crossLinks) {
    const nodeId = idOfKey.get(l.key);
    const mine = nodeId ? target(nodeId) : null;
    if (!mine) continue;
    if ("created" in mine && "created" in l.other && mine.created === l.other.created) continue;
    if (l.outgoing) link(mine, l.other, l.type, l.label);
    else link(l.other, mine, l.type, l.label);
  }
  const removedIds = new Set(changes.flatMap((c) => (c.kind === "remove" ? [c.target] : [])));
  for (const c of connections) {
    if (!c.ownedBySource || wanted.has(`${c.from}>${c.to}`) || removedIds.has(c.from) || removedIds.has(c.to)) continue;
    changes.push({ kind: "remove", target: c.arrowId });
    removedIds.add(c.arrowId);
  }
  // Another section's arrows bound to an object removed here go with it (the writer only takes this section's own).
  if (removedIds.size) {
    for (const c of mapConnectors(input.elements)) {
      if (!c.source || c.source === input.sourceId || !input.mapSources.has(c.source) || removedIds.has(c.arrowId)) continue;
      if (!removedIds.has(c.from) && !removedIds.has(c.to)) continue;
      changes.push({ kind: "remove", target: c.arrowId });
      removedIds.add(c.arrowId);
    }
  }

  return { changes, conflicts, outcomes, userKept, removed, boxes };
}

function stripParent(n: VisualNode): VisualNode {
  const { parent: _parent, ...rest } = n;
  return rest as VisualNode;
}

/** The grouped plan with only its group and the members being added (and the links among them). */
function sectionPlan(plan: VisualPlan, addIds: ReadonlySet<string>): VisualPlan {
  const nodes = plan.nodes.filter((n) => n.type === "group" || addIds.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  return { ...plan, nodes, relationships: plan.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)) };
}
