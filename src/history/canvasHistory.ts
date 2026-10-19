/**
 * Unified undo/redo for the canvas (F12): canvas elements and the content of
 * rich blocks share one stack, so Ctrl+Z after editing a block reverts that
 * edit — something Excalidraw's element-only history cannot do. It replaces
 * Excalidraw's history entirely (keys and buttons are routed here).
 *
 * How steps are formed
 * - The scene is diffed against a baseline at *commit points*: when a gesture
 *   ends (pointer up) and when editing a block/text item ends. A whole drag,
 *   resize or edit session is therefore one step.
 * - A step holds shallow snapshots of the changed elements only
 *   (`before`/`after`), never a scene copy. Snapshots are required: Excalidraw
 *   mutates element objects in place during gestures (`mutateElement`), so a
 *   stored reference would silently change. The diff is O(n) version
 *   comparisons per commit and O(1) on every other change event (scene array
 *   identity check).
 * - Content edits arrive as `DocStep`s from a `DocStepSource` (one Yjs undo
 *   item per document per step), attached to the same entry.
 * - Selection-only changes never create steps.
 * - Programmatic operations that must be one step however many scene updates
 *   they make (an accepted AI change set, F19) run inside `record`.
 * - Changes nobody asked for (font re-measuring on load, image status updates)
 *   are absorbed: a step is recorded only if there was user input since the
 *   last commit, and changes to bookkeeping fields only are ignored.
 *
 * Applying a step writes the target element states back with a *higher*
 * version than the current one, so persistence and (future) sync always see
 * undo as a forward change.
 */

export interface HistoryElement {
  readonly id: string;
  readonly version: number;
  readonly index?: string | null;
  readonly isDeleted: boolean;
}

/** One document's share of a step (e.g. the text typed in a block). */
export interface DocStep {
  undo(): void;
  redo(): void;
  /** Releases resources when the step leaves the history. */
  dispose(): void;
}

export interface DocStepSource {
  /** Content changes since the last `take`, one step per changed document. */
  take(): DocStep[];
  hasPending(): boolean;
  /** Called when a document gets changes that aren't taken yet. */
  onPending(listener: () => void): () => void;
}

interface Change<E> {
  id: string;
  before: E | undefined;
  after: E | undefined;
}

interface Entry<E> {
  id: number;
  changes: Change<E>[];
  docs: DocStep[];
}

export interface CanvasHistoryOptions<E extends HistoryElement> {
  /** Current scene, including deleted elements. */
  getElements(): readonly E[];
  /** Writes a scene (outside the renderer's own history) and selects `select`. */
  apply(elements: E[], select: string[]): void;
  /** Copy of `target` with a version above `aboveVersion`. */
  bump(target: E, aboveVersion: number): E;
  /** Copy of `el` marked deleted (not yet bumped). */
  markDeleted(el: E): E;
  docs?: DocStepSource;
  /** Maximum number of undo steps kept. */
  limit?: number;
  /** Injectable timer (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Quiet time after a change before committing (merges follow-up adjustments). */
const SETTLE_MS = 40;
/** After an edit session ends: the editor flushes and empty text items are removed first. */
const SETTLE_AFTER_EDIT_MS = 150;

/** Bookkeeping fields: a change to only these is not a user-visible change. */
const BOOKKEEPING = new Set(["version", "versionNonce", "updated", "status", "seed"]);

/** Detached copy: later in-place mutation of the live element can't reach it. */
function snapshot<E>(el: E): E {
  return { ...el };
}

function isLive(el: HistoryElement | undefined): boolean {
  return !!el && !el.isDeleted;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when two versions of an element differ only in bookkeeping fields. */
export function onlyBookkeepingChanged(before: object, after: object): boolean {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!BOOKKEEPING.has(key) && !sameValue(a[key], b[key])) return false;
  }
  return true;
}

function byIndex(a: HistoryElement, b: HistoryElement): number {
  const ai = a.index ?? "";
  const bi = b.index ?? "";
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

export class CanvasHistory<E extends HistoryElement> {
  private readonly baseline = new Map<string, E>();
  private undoStack: Entry<E>[] = [];
  private redoStack: Entry<E>[] = [];
  private lastElements: readonly E[] | null = null;
  private dirty = false;
  private editing = false;
  private interacting = false;
  private inputSeq = 0;
  private committedInputSeq = 0;
  private timer: unknown = null;
  private readonly listeners = new Set<() => void>();
  private readonly limit: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private offDocs: (() => void) | undefined;
  private nextEntryId = 1;

  constructor(private readonly options: CanvasHistoryOptions<E>) {
    this.limit = options.limit ?? 200;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /**
   * Starts listening for content changes; returns the disconnect function,
   * which also releases every step. (Not done in the constructor: a history
   * created but never used — e.g. React strict mode's discarded initializer —
   * must not consume content steps.)
   */
  connect(): () => void {
    this.offDocs?.();
    this.offDocs = this.options.docs?.onPending(() => this.schedule(SETTLE_MS));
    return () => this.dispose();
  }

  /** Sets the baseline to the current scene (no steps). */
  init(elements: readonly E[]): void {
    this.baseline.clear();
    for (const el of elements) this.baseline.set(el.id, snapshot(el));
    this.lastElements = elements;
    this.dirty = false;
    this.committedInputSeq = this.inputSeq;
  }

  /** A user input happened (pointer, key, paste, drop): changes after it may form a step. */
  noteUserInput(): void {
    this.inputSeq++;
  }

  /**
   * Call from the renderer's change event. O(1) unless the scene changed.
   * `interacting`: a gesture is in progress. `editing`: a block/text item is being edited.
   */
  observe(elements: readonly E[], state: { interacting: boolean; editing: boolean }): void {
    const wasEditing = this.editing;
    this.editing = state.editing;
    this.interacting = state.interacting;
    if (elements !== this.lastElements) {
      this.lastElements = elements;
      this.dirty = true;
    }
    if (this.interacting || this.editing) {
      this.cancelTimer();
      return;
    }
    if (wasEditing) this.schedule(SETTLE_AFTER_EDIT_MS, true);
    else if (this.dirty) this.schedule(SETTLE_MS);
  }

  /**
   * A programmatic resize that must not become a step on its own (auto-size).
   * If the element had no pending changes before it, the new state is taken
   * as the baseline; otherwise it simply joins the pending step.
   */
  absorbIfClean(id: string, previousVersion: number): void {
    if (this.baseline.get(id)?.version !== previousVersion) return;
    const el = this.options.getElements().find((e) => e.id === id);
    if (el) this.baseline.set(id, snapshot(el));
  }

  /** Records pending changes as a step now (if there are any). */
  commit(): void {
    this.cancelTimer();
    if (this.interacting || this.editing) return;
    this.commitPending();
  }

  /**
   * Runs `mutate` — a programmatic change such as an accepted AI change set —
   * and records everything it changes as exactly one step, however many scene
   * updates it makes. Changes pending before it (even mid-edit) are committed
   * first as their own step, so the operation never absorbs the user's work
   * and undoing it never reverts that work. Returns the step's id, or null
   * when `mutate` changed nothing.
   */
  record(mutate: () => void): number | null {
    this.cancelTimer();
    this.commitPending();
    mutate();
    const changes = this.diff();
    this.lastElements = this.options.getElements();
    this.dirty = false;
    // The input that triggered the operation (e.g. the Accept click) is consumed.
    this.committedInputSeq = this.inputSeq;
    if (!changes.length) return null;
    return this.push({ id: this.nextEntryId++, changes, docs: [] });
  }

  /** Id of the step Undo would revert next (null when there is none). */
  get lastStepId(): number | null {
    return this.undoStack.at(-1)?.id ?? null;
  }

  private commitPending(): void {
    if (this.options.getElements() !== this.lastElements) this.dirty = true;
    const changes = this.dirty ? this.diff() : [];
    this.lastElements = this.options.getElements();
    this.dirty = false;
    const userDriven = this.inputSeq !== this.committedInputSeq;
    this.committedInputSeq = this.inputSeq;
    const docs = this.options.docs?.take() ?? [];
    const canvas = userDriven ? changes : [];
    if (!canvas.length && !docs.length) return;
    this.push({ id: this.nextEntryId++, changes: canvas, docs });
  }

  undo(): boolean {
    this.commit();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.applyCanvas(entry.changes, "before");
    for (let i = entry.docs.length - 1; i >= 0; i--) entry.docs[i]!.undo();
    this.redoStack.push(entry);
    this.emit();
    return true;
  }

  redo(): boolean {
    this.commit();
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.applyCanvas(entry.changes, "after");
    for (const doc of entry.docs) doc.redo();
    this.undoStack.push(entry);
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || this.hasPending();
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Notified when undo/redo availability may have changed. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.cancelTimer();
    this.offDocs?.();
    this.offDocs = undefined;
    for (const e of [...this.undoStack, ...this.redoStack]) for (const d of e.docs) d.dispose();
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  // -------------------------------------------------------------------------

  private hasPending(): boolean {
    return (this.dirty && this.inputSeq !== this.committedInputSeq) || !!this.options.docs?.hasPending();
  }

  private diff(): Change<E>[] {
    const changes: Change<E>[] = [];
    const elements = this.options.getElements();
    const seen = new Set<string>();
    for (const el of elements) {
      seen.add(el.id);
      const before = this.baseline.get(el.id);
      if (before && before.version === el.version) continue;
      const after = snapshot(el);
      this.baseline.set(el.id, after);
      if (!isLive(before) && !isLive(after)) continue; // created and discarded within the step
      if (before && onlyBookkeepingChanged(before, after)) continue;
      changes.push({ id: el.id, before, after });
    }
    if (seen.size !== this.baseline.size) {
      for (const [id, before] of this.baseline) {
        if (seen.has(id)) continue;
        this.baseline.delete(id);
        if (isLive(before)) changes.push({ id, before, after: undefined });
      }
    }
    return changes;
  }

  private push(entry: Entry<E>): number {
    for (const e of this.redoStack) for (const d of e.docs) d.dispose();
    this.redoStack = [];
    this.undoStack.push(entry);
    while (this.undoStack.length > this.limit) for (const d of this.undoStack.shift()!.docs) d.dispose();
    this.emit();
    return entry.id;
  }

  private applyCanvas(changes: Change<E>[], side: "before" | "after"): void {
    if (!changes.length) return;
    const { getElements, apply, bump, markDeleted } = this.options;
    const current = getElements();
    const byId = new Map<string, E>();
    for (const el of current) byId.set(el.id, el);
    const touched: string[] = [];
    let reorder = false;
    for (const change of changes) {
      const target = side === "before" ? change.before : change.after;
      const cur = byId.get(change.id);
      let next: E;
      if (target) next = bump(target, Math.max(target.version, cur?.version ?? 0));
      else if (cur) next = bump(markDeleted(cur), cur.version);
      else continue;
      if (!cur || (cur.index ?? null) !== (next.index ?? null)) reorder = true;
      byId.set(change.id, next);
      touched.push(change.id);
    }
    const elements = [...byId.values()];
    // Array order is z-order: restore it from the fractional indices when they moved.
    if (reorder) elements.sort(byIndex);
    const select = touched.filter((id) => isLive(byId.get(id)));
    apply(elements, select);
    // Take what the renderer actually stored as the new baseline, and consume
    // the input that triggered undo/redo so it doesn't record the result.
    const stored = new Map(getElements().map((el) => [el.id, el] as const));
    for (const id of touched) {
      const el = stored.get(id) ?? byId.get(id);
      if (el) this.baseline.set(id, snapshot(el));
    }
    this.lastElements = null;
    this.committedInputSeq = this.inputSeq;
  }

  private schedule(ms: number, force = false): void {
    if (this.timer && !force) return;
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.commit();
    }, ms);
    this.emit();
  }

  private cancelTimer(): void {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
