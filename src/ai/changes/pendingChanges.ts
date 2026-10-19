/**
 * Change sets waiting for review (F19). Proposing only records the set; nothing reaches the canvas until it is
 * accepted.
 *
 * Several sets can wait on one canvas, one per producer (D40): a set's **slot** is its merge key when it has one (a
 * repo map, F43, which merges across that map's sessions), else its session, else the in-app session `"app"`. A new
 * proposal in a slot replaces the one waiting there (that one was never applied, so nothing is lost; it is reported
 * as expired, D46). A proposal that would touch an element a set in *another* slot already touches is refused with
 * `PendingReviewError`, naming that set, so two reviews can never fight over one object.
 *
 * The review bar shows one set at a time, the **selected** one (`get`); the others wait beside it (`list`).
 *
 * Held in memory only: a pending set is a preview, not document state, and never enters workspace documents, Yjs or
 * exports.
 *
 * A mapping session (F43) *merges* instead (`merge`): its sets carry a merge key and parts (`parts.ts`), and each new
 * one joins the set waiting in its slot. Accepting some parts leaves the rest pending (`replace`).
 */
import { parseChangeSet, type ChangeSet } from "./changeSet";
import { mergeSets, withoutParts } from "./parts";
import { currentResponseStyle, withResponseStyle, type ResponseStyle } from "./responseStyle";

/** In-app AI's session (D40). */
export const APP_SESSION = "app";

/** A proposal was refused: a set in another slot is under review and touches the same objects (or, for a merge, the slot is taken). */
export class PendingReviewError extends Error {
  constructor(readonly blocking?: Pick<ChangeSet, "operationId" | "title">) {
    super(blocking ? `“${blocking.title}” is under review on this canvas and changes the same objects; accept or reject it first.` : "Another change set is under review on this canvas.");
    this.name = "PendingReviewError";
  }
}

export interface PendingChangesOptions {
  /** The styling for AI-generated objects (AI settings), applied to each proposal; none leaves sets as proposed. */
  style?: () => ResponseStyle;
  /** A set left without a decision: replaced in its slot by a newer proposal (D46's "expired"). */
  onExpired?: (canvasId: string, set: ChangeSet) => void;
}

/** Which slot a set waits in (D40). */
export function slotOf(set: Pick<ChangeSet, "mergeKey" | "session">): string {
  return set.mergeKey ? `merge:${set.mergeKey}` : `session:${set.session ?? APP_SESSION}`;
}

/** The slot of a producer session that doesn't merge. */
export const sessionSlot = (session: string = APP_SESSION) => `session:${session}`;

/** Existing elements a set changes (created objects are new, so they can't collide). */
function touches(set: ChangeSet): Set<string> {
  const ids = new Set<string>();
  for (const c of set.changes) if ("target" in c) ids.add(c.target);
  for (const c of set.conflicts ?? []) for (const t of [c.target, ...(c.alsoApply ?? []).map((a) => a.target)]) ids.add(t);
  return ids;
}

export class PendingChanges {
  private readonly byCanvas = new Map<string, Map<string, ChangeSet>>();
  private readonly selected = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: PendingChangesOptions = {}) {}

  private styled(set: ChangeSet): ChangeSet {
    return this.options.style ? withResponseStyle(set, this.options.style()) : set;
  }

  private slots(canvasId: string): Map<string, ChangeSet> {
    let slots = this.byCanvas.get(canvasId);
    if (!slots) this.byCanvas.set(canvasId, (slots = new Map()));
    return slots;
  }

  /** Refuses `set` when a set in another slot touches any object it touches. */
  private checkOverlap(canvasId: string, slot: string, set: ChangeSet): void {
    const mine = touches(set);
    if (!mine.size) return;
    for (const [other, waiting] of this.byCanvas.get(canvasId) ?? []) {
      if (other === slot) continue;
      for (const id of touches(waiting)) if (mine.has(id)) throw new PendingReviewError(waiting);
    }
  }

  /** Puts `set` in its slot, reporting the one it replaces (a different proposal) as expired. */
  private place(canvasId: string, slot: string, set: ChangeSet, select: boolean): void {
    const slots = this.slots(canvasId);
    const previous = slots.get(slot);
    slots.set(slot, set);
    if (previous && previous.operationId !== set.operationId) {
      if (this.selected.get(canvasId) === previous.operationId) this.selected.set(canvasId, set.operationId);
      this.options.onExpired?.(canvasId, previous);
    }
    if (select || !this.selected.has(canvasId)) this.selected.set(canvasId, set.operationId);
  }

  /**
   * Validates `input` (throws `InvalidChangeSetError`) and puts it up for review in its slot, selected. Throws
   * `PendingReviewError` when a set in another slot touches the same objects.
   */
  propose(canvasId: string, input: unknown): ChangeSet {
    const set = this.styled(parseChangeSet(input));
    const slot = slotOf(set);
    this.checkOverlap(canvasId, slot, set);
    this.place(canvasId, slot, set, true);
    this.emit();
    return set;
  }

  /**
   * Validates `input` (a set with `mergeKey` and parts) and merges it into the set waiting in its slot — a part with
   * the same key replaces the staged one — or puts it up for review when nothing is waiting there. Throws
   * `PendingReviewError` when a set in another slot touches the same objects.
   */
  merge(canvasId: string, input: unknown): ChangeSet {
    const peek = input as Partial<ChangeSet> | null;
    const slot = peek && typeof peek === "object" && typeof peek.mergeKey === "string" ? slotOf({ mergeKey: peek.mergeKey }) : null;
    const current = slot ? this.byCanvas.get(canvasId)?.get(slot) : undefined;
    // Its links may point at objects the staged parts create; the merged whole is validated again below.
    const set = this.styled(parseChangeSet(input, current?.parts ? { externalKeys: createdKeysOf(current) } : {}));
    if (!set.mergeKey || !set.parts) throw new Error("merge: a set to merge needs a merge key and parts");
    const merged = current ? parseChangeSet(mergeSets(current, set) ?? set) : set;
    this.checkOverlap(canvasId, slotOf(merged), merged);
    this.place(canvasId, slotOf(merged), merged, false);
    this.emit();
    return merged;
  }

  /** Takes the named parts out of the merged set of `mergeKey` (e.g. a section re-sent with nothing left to change). */
  dropParts(canvasId: string, mergeKey: string, keys: readonly string[]): void {
    const slot = slotOf({ mergeKey });
    const current = this.byCanvas.get(canvasId)?.get(slot);
    if (!current || !current.parts?.some((p) => keys.includes(p.key))) return;
    const rest = withoutParts(current, new Set(keys));
    if (rest) this.slots(canvasId).set(slot, parseChangeSet(rest));
    else this.remove(canvasId, slot, current.operationId);
    this.emit();
  }

  /** After some parts of `operationId` were accepted: what is left of it stays under review (null ends it). */
  replace(canvasId: string, operationId: string, rest: ChangeSet | null): void {
    const found = this.find(canvasId, operationId);
    if (!found) return;
    if (rest) this.slots(canvasId).set(found.slot, parseChangeSet(rest));
    else this.remove(canvasId, found.slot, operationId);
    this.emit();
  }

  /** The selected set under review on `canvasId` (the one the review bar shows), else any, else null. */
  get(canvasId: string): ChangeSet | null {
    const slots = this.byCanvas.get(canvasId);
    if (!slots?.size) return null;
    const selected = this.selected.get(canvasId);
    return [...slots.values()].find((s) => s.operationId === selected) ?? slots.values().next().value ?? null;
  }

  /** The set waiting in `slot` (`slotOf`, `sessionSlot`), if any. */
  inSlot(canvasId: string, slot: string): ChangeSet | null {
    return this.byCanvas.get(canvasId)?.get(slot) ?? null;
  }

  /** Every set under review on `canvasId`, in arrival order. */
  list(canvasId: string): ChangeSet[] {
    return [...(this.byCanvas.get(canvasId)?.values() ?? [])];
  }

  /** Every set under review on every canvas (for persisting proposals that must outlive a reload). */
  all(): { canvasId: string; set: ChangeSet }[] {
    return [...this.byCanvas].flatMap(([canvasId, slots]) => [...slots.values()].map((set) => ({ canvasId, set })));
  }

  /** Shows `operationId` in the review bar. */
  select(canvasId: string, operationId: string): void {
    if (!this.find(canvasId, operationId) || this.selected.get(canvasId) === operationId) return;
    this.selected.set(canvasId, operationId);
    this.emit();
  }

  /** Ends the review of `operationId` (accepted or rejected); a newer proposal is left alone. */
  settle(canvasId: string, operationId: string): void {
    const found = this.find(canvasId, operationId);
    if (!found) return;
    this.remove(canvasId, found.slot, operationId);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private find(canvasId: string, operationId: string): { slot: string; set: ChangeSet } | null {
    for (const [slot, set] of this.byCanvas.get(canvasId) ?? []) if (set.operationId === operationId) return { slot, set };
    return null;
  }

  private remove(canvasId: string, slot: string, operationId: string): void {
    const slots = this.byCanvas.get(canvasId);
    slots?.delete(slot);
    if (this.selected.get(canvasId) === operationId) {
      const next = slots?.values().next().value;
      if (next) this.selected.set(canvasId, next.operationId);
      else this.selected.delete(canvasId);
    }
    if (slots && !slots.size) this.byCanvas.delete(canvasId);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** Keys of the objects a set creates (connections excluded). */
function createdKeysOf(set: ChangeSet): Set<string> {
  return new Set(set.changes.flatMap((c) => ("key" in c && c.kind !== "connect" ? [c.key] : [])));
}

let instance: PendingChanges | null = null;
let expiredSink: PendingChangesOptions["onExpired"];

export function getPendingChanges(): PendingChanges {
  instance ??= new PendingChanges({ style: currentResponseStyle, onExpired: (canvasId, set) => expiredSink?.(canvasId, set) });
  return instance;
}

/** Where the app's pending store reports expired sets (the change log, `state/agentLog.ts`). */
export function onPendingExpired(sink: PendingChangesOptions["onExpired"]): void {
  expiredSink = sink;
}
