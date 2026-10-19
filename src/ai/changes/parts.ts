/**
 * Merged change sets (F43): a mapping session sends many sections, and F19
 * allows one pending set per canvas, so each section becomes one *part* of
 * that set instead of a set of its own (`ChangeSet.parts`). The review shows
 * everything staged so far, grouped by section; Accept writes it all as one
 * undo step, or one section at a time.
 *
 * - `mergeSets`: a new version of a section replaces its staged part (a
 *   re-send supersedes what was staged); a new section is appended.
 * - `acceptParts`: writes the chosen parts in one history step, each with its
 *   own content version (F37), and returns the rest — still pending.
 *   Connections between sections follow their ends: one to an object staged
 *   in a part that isn't accepted yet waits, and moves to that part.
 *
 * Pure: the canvas writer and history are injected, as for `acceptChangeSet`.
 */
import type { ChangeSetCanvas, TransactionHistory } from "./accept";
import { resolveChangeSet, type ChangeSet, type ChangeSetPart, type ChangeTarget, type ConflictItem, type DroppedChange, type ProposedChange } from "./changeSet";

export interface PartSlice {
  part: ChangeSetPart;
  changes: ProposedChange[];
  conflicts: ConflictItem[];
}

/** The set's parts with their own changes and conflicts, in order (none for a set without parts). */
export function partSlices(set: ChangeSet): PartSlice[] {
  let c = 0;
  let k = 0;
  return (set.parts ?? []).map((part) => {
    const slice = { part, changes: set.changes.slice(c, c + part.changes), conflicts: (set.conflicts ?? []).slice(k, k + part.conflicts) };
    c += part.changes;
    k += part.conflicts;
    return slice;
  });
}

type Envelope = Pick<ChangeSet, "operationId" | "title" | "metadata" | "mergeKey" | "session">;

/** A merged set from its parts (empty parts are left out); null when nothing is left. Not validated: callers pass it through `parseChangeSet`. */
export function composeParts(envelope: Envelope, slices: readonly PartSlice[]): ChangeSet | null {
  const kept = prune(slices.filter((s) => s.changes.length || s.conflicts.length));
  const live = kept.filter((s) => s.changes.length || s.conflicts.length);
  if (!live.length) return null;
  const conflicts = live.flatMap((s) => s.conflicts);
  return {
    operationId: envelope.operationId,
    title: envelope.title,
    metadata: envelope.metadata,
    ...(envelope.mergeKey ? { mergeKey: envelope.mergeKey } : {}),
    ...(envelope.session ? { session: envelope.session } : {}),
    changes: live.flatMap((s) => s.changes),
    ...(conflicts.length ? { conflicts } : {}),
    parts: live.map((s) => ({ ...s.part, changes: s.changes.length, conflicts: s.conflicts.length })),
  };
}

/**
 * `incoming`'s parts merged into `current` (same merge key): a part with the same key is replaced in place, a new
 * one appended. Links to objects no part creates any more are dropped (the producer re-sends them when it can).
 */
export function mergeSets(current: ChangeSet, incoming: ChangeSet): ChangeSet | null {
  const next = new Map(partSlices(incoming).map((s) => [s.part.key, s] as const));
  const merged = partSlices(current).map((s) => next.get(s.part.key) ?? s);
  const known = new Set(merged.map((s) => s.part.key));
  for (const s of partSlices(incoming)) if (!known.has(s.part.key)) merged.push(s);
  return composeParts({ ...current, ...(incoming.session ? { session: incoming.session } : {}) }, merged);
}

/** `set` without the parts named (e.g. a section re-sent with nothing left to change); null when nothing is left. */
export function withoutParts(set: ChangeSet, keys: ReadonlySet<string>): ChangeSet | null {
  return composeParts(set, partSlices(set).filter((s) => !keys.has(s.part.key)));
}

/** Keys of the objects a change creates (connections excluded). */
const createdKeys = (changes: readonly ProposedChange[]) => changes.flatMap((c) => ("key" in c && c.kind !== "connect" ? [c.key] : []));

/**
 * Consistency across parts: connections to an object no part creates are dropped, and an existing object is
 * moved, updated or removed by the first part that does so only (parts are staged against the same canvas).
 */
function prune(slices: readonly PartSlice[]): PartSlice[] {
  const created = new Set(slices.flatMap((s) => createdKeys(s.changes)));
  const touched = new Set<string>();
  const moved = new Set<string>();
  const ok = (t: ChangeTarget) => !("created" in t) || created.has(t.created);
  return slices.map((s) => ({
    ...s,
    changes: s.changes.filter((c) => {
      if (c.kind === "connect") return ok(c.from) && ok(c.to);
      if (c.kind === "move") {
        if (moved.has(c.target)) return false;
        moved.add(c.target);
        return true;
      }
      if ("key" in c) return true;
      if (touched.has(c.target)) return false;
      touched.add(c.target);
      return true;
    }),
  }));
}

export type PartDecision = "apply" | "keep";

export interface AcceptPartsResult {
  /** The history step holding everything written (null when nothing was). */
  stepId: number | null;
  /** Created object ids by change key, across the accepted parts. */
  created: Map<string, string>;
  applied: ProposedChange[];
  dropped: DroppedChange[];
  /** The accepted parts (with their content versions, to record). */
  accepted: ChangeSetPart[];
  /** What stays pending: the other parts, with links that wait for them. Null when nothing is left. */
  rest: ChangeSet | null;
}

/**
 * Writes the parts named in `keys` (all of them when null) as one history step. Each part is written with its
 * own content version; conflicts are applied only as decided (`decisions`, by target), undecided ones are left
 * alone, as for a plain set. Connections between accepted parts are written after both ends exist; one to an
 * object staged in a part that stays pending waits in that part, pointed at the object now on the canvas.
 */
export function acceptParts(
  set: ChangeSet,
  keys: ReadonlySet<string> | null,
  decisions: ReadonlyMap<string, PartDecision>,
  canvas: () => ChangeSetCanvas,
  history: TransactionHistory,
): AcceptPartsResult {
  const slices = partSlices(set);
  const selected = slices.filter((s) => !keys || keys.has(s.part.key));
  const pending = slices.filter((s) => keys && !keys.has(s.part.key));
  const selectedKeys = new Set(selected.flatMap((s) => createdKeys(s.changes)));
  const ownerOfKey = new Map(pending.flatMap((s) => createdKeys(s.changes).map((k) => [k, s.part.key] as const)));
  const created = new Map<string, string>();
  const applied: ProposedChange[] = [];
  const dropped: DroppedChange[] = [];
  /** Links held back for a pending part, by that part's key (their accepted ends rewritten once written). */
  const held = new Map<string, Extract<ProposedChange, { kind: "connect" }>[]>();
  const hold = (c: Extract<ProposedChange, { kind: "connect" }>, owner: string) => held.set(owner, [...(held.get(owner) ?? []), c]);

  const decided = (s: PartSlice) =>
    s.conflicts.flatMap((c): ProposedChange[] => {
      const d = decisions.get(c.target);
      return d === "apply" ? [c.apply, ...(c.alsoApply ?? [])] : d === "keep" && c.keep ? [c.keep] : [];
    });
  const write = (s: PartSlice, changes: ProposedChange[]) => {
    if (!changes.length) return;
    const { parts: _parts, mergeKey: _mergeKey, session: _session, conflicts: _conflicts, ...envelope } = set;
    const sub: ChangeSet = { ...envelope, changes, ...(s.part.contentSource ? { contentSource: s.part.contentSource } : {}) };
    const cv = canvas();
    const resolved = resolveChangeSet(sub, (id) => cv.boxOf(id) !== undefined);
    dropped.push(...resolved.dropped);
    if (!resolved.changes.length) return;
    for (const [k, id] of cv.write(sub, resolved.changes)) created.set(k, id);
    applied.push(...resolved.changes);
  };
  const toExisting = (t: ChangeTarget): ChangeTarget => ("created" in t && created.has(t.created) ? { existing: created.get(t.created)! } : t);

  const stepId = history.record(() => {
    const later: { slice: PartSlice; change: Extract<ProposedChange, { kind: "connect" }> }[] = [];
    for (const s of selected) {
      const own = new Set(createdKeys(s.changes));
      const now: ProposedChange[] = [];
      for (const c of [...s.changes, ...decided(s)]) {
        if (c.kind !== "connect") {
          now.push(c);
          continue;
        }
        const ends = [c.from, c.to].flatMap((t) => ("created" in t && !own.has(t.created) && !created.has(t.created) ? [t.created] : []));
        const waitsFor = ends.find((k) => ownerOfKey.has(k));
        if (waitsFor) hold(c, ownerOfKey.get(waitsFor)!);
        else if (ends.some((k) => selectedKeys.has(k))) later.push({ slice: s, change: c });
        else if (!ends.length) now.push({ ...c, from: toExisting(c.from), to: toExisting(c.to) });
        // else: an end no part creates — dropped (never written half-connected)
      }
      write(s, now);
    }
    // Links between accepted parts, once both ends exist; each with its own part's content version.
    for (const s of selected) {
      write(
        s,
        later.filter((l) => l.slice === s).map(({ change: c }) => ({ ...c, from: toExisting(c.from), to: toExisting(c.to) })),
      );
    }
  });

  const rest = pending.length
    ? composeParts(
        set,
        pending.map((s) => ({
          ...s,
          // Its links to objects just written now point at them on the canvas.
          changes: [...s.changes, ...(held.get(s.part.key) ?? [])].map((c) => (c.kind === "connect" ? { ...c, from: toExisting(c.from), to: toExisting(c.to) } : c)),
        })),
      )
    : null;
  return { stepId: applied.length ? stepId : null, created, applied, dropped, accepted: selected.map((s) => s.part), rest };
}
