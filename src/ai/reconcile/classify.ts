/**
 * The reconciliation classifier (F38, PRD §13.15.19): a pure function of
 * (the previously accepted plan, the new plan, the existing objects' current
 * fingerprints and baselines) → a `ReconciliationPlan`. No renderer, no I/O.
 *
 * Matching is by `stableNodeKey` only — keys are structural by construction
 * (`keys.ts`), so "structural fallback" already happened when they were
 * assigned; nothing here matches by array position or timing.
 *
 * Per matched node, in order:
 * 1. the object is opted out (`excludeFromReconciliation`) → skipped, always;
 * 2. the node's proposed content equals what the *previous* version proposed,
 *    and the object is either edited or already at that version →
 *    `unchanged`: the source said nothing new about it, so whatever the user
 *    did to the object stands (this is what keeps a manual edit, or a "Keep
 *    mine", from being re-flagged on every run over unchanged text). An
 *    untouched object still at an older version — an accepted update that
 *    was then undone — falls through, so the update is proposed again;
 * 3. the object already shows exactly the proposed content → `unchanged`;
 * 4. the object's current content still equals its baseline (untouched since
 *    AI last wrote it) → `update_clean`;
 * 5. otherwise the user edited it → `update_conflict`, never auto-applied.
 * An existing object whose node is gone → `remove` (proposed, never silent);
 * a node with no object → `add`. A node whose kind can no longer be an
 * update of its object (a shape that became a table) → `remove` + `add`.
 *
 * A node the user split (F42 Phase 4: its dense block was replaced by pieces
 * that carry `splitOf` = its key) is never added back while a piece of it is on
 * the canvas: it is listed in `splits` instead of `items`, and its pieces stay
 * (neither updated nor removed). `changed` says the source now says something
 * different about it than when it was split — reported, never applied, since
 * the pieces are the user's own rendering of it. A split node the source no
 * longer has → its pieces are removed like any object whose node is gone.
 */
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";

export interface ExistingObject {
  objectId: string;
  stableNodeKey: string;
  /** `contentFingerprint`: the content as AI last wrote it. */
  baseline: string;
  /** Current content fingerprint; null when the content isn't loaded (treated as edited — never overwritten blind). */
  current: string | null;
  excluded: boolean;
  /** `contentSourceVersion`: the source version AI (or "Keep mine") last wrote it at. */
  version?: number;
  /** What the object is, for "can this node update it in place?". */
  shape: "block" | "page" | "shape";
  blockType?: string;
  /** Where it is — only for placing a new child explanation below it (F38b); never compared. */
  box?: { x: number; y: number; width: number; height: number };
  /** The section frame it is in (F42), for putting new objects of its section into the same frame; never compared. */
  frameId?: string;
  /** A piece of a split block (F42 Phase 4): the node it shows part of, and that node's fingerprint when split. */
  splitOf?: { stableNodeKey: string; fingerprint: string };
}

export type ReconciliationItem =
  | { state: "add"; node: VisualNode }
  | { state: "remove"; object: ExistingObject }
  | { state: "update_clean"; node: VisualNode; object: ExistingObject }
  | { state: "update_conflict"; node: VisualNode; object: ExistingObject }
  | { state: "unchanged"; node: VisualNode; object: ExistingObject };

export interface ReconciliationPlan {
  items: ReconciliationItem[];
  /** Opted-out objects, left alone whatever the new content says. */
  skipped: ExistingObject[];
  /** Nodes shown as split pieces (see module doc); their pieces are kept. */
  splits: SplitItem[];
}

export interface SplitItem {
  node: VisualNode;
  pieces: ExistingObject[];
  /** The source changed this node in this update, and it differs from what was split. */
  changed: boolean;
}

export interface ReconcileInput {
  previous: VisualPlan | null;
  /** The version `previous` belongs to. */
  previousVersion?: number;
  next: VisualPlan;
  existing: readonly ExistingObject[];
  /** Fingerprint of a node's content exactly as the writer would store it (`nodeFingerprint`). */
  fingerprint(node: VisualNode): string;
  /** The object shape and block type a node would be written as. */
  objectKind(node: VisualNode): { shape: ExistingObject["shape"]; blockType?: string };
}

/** Only the items that need review: `unchanged` is excluded entirely (PRD: "no noise"). */
export function reviewItems(plan: ReconciliationPlan): ReconciliationItem[] {
  return plan.items.filter((i) => i.state !== "unchanged");
}

export function reconcile(input: ReconcileInput): ReconciliationPlan {
  const previous = new Map((input.previous?.nodes ?? []).flatMap((n) => (n.stableKey ? [[n.stableKey, n] as const] : [])));
  const byKey = new Map<string, ExistingObject>();
  const extras: ExistingObject[] = [];
  const piecesOf = new Map<string, ExistingObject[]>();
  for (const o of input.existing) {
    if (o.splitOf) piecesOf.set(o.splitOf.stableNodeKey, [...(piecesOf.get(o.splitOf.stableNodeKey) ?? []), o]);
    else if (byKey.has(o.stableNodeKey)) extras.push(o); // a duplicate (e.g. the user copied it): only the first is matched
    else byKey.set(o.stableNodeKey, o);
  }

  const items: ReconciliationItem[] = [];
  const skipped: ExistingObject[] = [];
  const splits: SplitItem[] = [];
  const matched = new Set<string>();
  for (const node of input.next.nodes) {
    const key = node.stableKey;
    const object = key ? byKey.get(key) : undefined;
    const pieces = key ? piecesOf.get(key) : undefined;
    // A split node's pieces stay while the source still has it, even beside a copy of the original block.
    for (const p of pieces ?? []) matched.add(p.objectId);
    if (!object && pieces) {
      const proposed = input.fingerprint(node);
      const before = previous.get(key!);
      const silent = !!before && input.fingerprint(before) === proposed;
      splits.push({ node, pieces, changed: !silent && pieces.some((p) => p.splitOf!.fingerprint !== proposed) });
      continue;
    }
    if (!object) {
      items.push({ state: "add", node });
      continue;
    }
    matched.add(object.objectId);
    if (object.excluded) {
      skipped.push(object);
      continue;
    }
    const kind = input.objectKind(node);
    if (kind.shape !== object.shape || (kind.blockType && object.blockType && kind.blockType !== object.blockType)) {
      items.push({ state: "remove", object }, { state: "add", node });
      continue;
    }
    const proposed = input.fingerprint(node);
    const before = key ? previous.get(key) : undefined;
    const edited = object.current === null || object.current !== object.baseline;
    const sourceSilent = !!before && input.fingerprint(before) === proposed && (edited || (object.version ?? 0) >= (input.previousVersion ?? 0));
    if (sourceSilent || object.current === proposed) items.push({ state: "unchanged", node, object });
    else if (object.current !== null && object.current === object.baseline) items.push({ state: "update_clean", node, object });
    else items.push({ state: "update_conflict", node, object });
  }
  for (const object of [...input.existing, ...extras]) {
    if (matched.has(object.objectId)) continue;
    if (object.excluded) skipped.push(object);
    else items.push({ state: "remove", object });
  }
  return { items, skipped, splits };
}
