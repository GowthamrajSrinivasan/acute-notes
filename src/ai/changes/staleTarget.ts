/**
 * Stale-target protection (P0, 2026-11-15; chatgpt-mcp-architecture-and-test-plan.md "Stale-target fix"): a proposal
 * that replaces an existing block's content (`update_block`) or a shape's label (`update_shape`) never overwrites an
 * edit the user made after it was proposed. Both are "baselined" changes (`Baselined`); everything below holds for each.
 *
 * 1. **Baseline at proposal time.** Every baselined change carries `expectedFingerprint`: the target's `fingerprintOf`
 *    when it was proposed (a shape's: its kind and label, `fingerprintShape`). A producer that read the target sets it
 *    itself (the MCP `update_block` tool, from the content it validated the call against; reconciliation's
 *    `update_shape`s — Update from new content, repo maps — from the shape it planned against, `shapeBaseline`);
 *    `PendingChanges.propose`/`merge` stamp whatever is still missing from the live canvas (`withBaselines`), so every
 *    producer gets it.
 * 2. **Comparison at Accept.** `resolveChangeSet` compares each baseline with the target's live fingerprint, in the same
 *    synchronous task as the write (nothing can edit in between). A mismatch is not written: it becomes a
 *    `ConflictItem` with `changedSinceProposal` (`staleConflict`), whose `apply` is re-baselined to what the user now
 *    sees, so "Use proposed" is itself checked again at its own Accept.
 * 3. **Explicit decision.** The review shows it as a conflict: Keep mine (nothing is written) or Use proposed.
 * 4. **Atomicity.** One Accept = one transaction = one undo step, over the latest state: every target that still matches
 *    its baseline is written together; every target that changed is withheld from that step and waits under review
 *    (`followUpSet`) — never dropped, never written without a decision. Resolving them is a second Accept, itself one
 *    undo step and checked against the latest state again.
 * 5. **Legacy proposals** (persisted before this fix, so without a baseline): the content at proposal time can't be
 *    recovered — the stored set holds only the proposed content and a document keeps no history, and a document's
 *    `updatedAt` also moves on metadata-only writes, so a timestamp can't prove "unchanged". They are restored with
 *    `UNKNOWN_BASELINE` (`markLegacyBaselines`), which never matches: Accept asks Keep mine / Use proposed for each, unless
 *    the block (or shape) already says exactly what was proposed.
 *
 * Pure: no renderer imports.
 */
import type { ChangeSet, ConflictItem, ProposedChange } from "./changeSet";

/** A change that overwrites what the user can edit on an existing object, so it carries a baseline. */
export type Baselined = Extract<ProposedChange, { kind: "update_block" | "update_shape" }>;

/** Whether `c` is a baselined change still without its baseline (`withBaselines` would stamp it). */
export function needsBaseline(c: ProposedChange): boolean {
  return (c.kind === "update_block" || c.kind === "update_shape") && !c.expectedFingerprint;
}

/** A baseline that was never captured (a legacy proposal, or a target whose content wasn't loaded): never matches, so it always asks. */
export const UNKNOWN_BASELINE = "baseline:unknown";

/**
 * `set` with every baselined change (its changes and its conflicts' `apply`) that has no baseline given one by `read`
 * (the target's fingerprint now; null: unknown). A baseline the producer set is kept. The same set when nothing changes.
 */
export function withBaselines(set: ChangeSet, read: (target: string) => string | null): ChangeSet {
  let changed = false;
  const stamp = <C extends ProposedChange>(c: C): C => {
    if (!needsBaseline(c)) return c;
    changed = true;
    return { ...c, expectedFingerprint: read((c as Baselined).target) ?? UNKNOWN_BASELINE };
  };
  const changes = set.changes.map(stamp);
  const conflicts = set.conflicts?.map((c) => {
    const apply = stamp(c.apply);
    return apply === c.apply ? c : { ...c, apply };
  });
  if (!changed) return set;
  return { ...set, changes, ...(conflicts ? { conflicts } : {}) };
}

/**
 * A producer's own baseline for a reconciliation update (`ai/reconcile`): an `update_shape` planned against the shape
 * as it was then (`current`, its `fingerprintOf`) carries that as its baseline, so an edit made between planning and
 * proposing is caught too. Anything else (and an unknown `current`) is returned as is, for `withBaselines` to stamp.
 */
export function shapeBaseline<C extends ProposedChange>(c: C, current: string | null): C {
  return c.kind === "update_shape" && !c.expectedFingerprint && current ? { ...c, expectedFingerprint: current } : c;
}

/**
 * A stored proposal from before baselines existed (raw, as persisted): each baselined change (`update_block`,
 * `update_shape`) without one gets
 * `UNKNOWN_BASELINE`, so Accept asks instead of overwriting. Conflicts are left alone (they already need a decision).
 * Anything malformed is passed through for `parseChangeSet` to refuse.
 */
const LEGACY_KINDS: ReadonlySet<unknown> = new Set(["update_block", "update_shape"]);

export function markLegacyBaselines<T>(raw: T): T {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { changes?: unknown }).changes)) return raw;
  const changes = (raw as unknown as { changes: unknown[] }).changes.map((c) =>
    c && typeof c === "object" && LEGACY_KINDS.has((c as { kind?: unknown }).kind) && !(c as { expectedFingerprint?: unknown }).expectedFingerprint
      ? { ...c, expectedFingerprint: UNKNOWN_BASELINE }
      : c,
  );
  return { ...raw, changes };
}

/** What `resolveChangeSet` needs of the live target. */
export interface LiveTarget {
  fingerprint: string;
}

/** A live shape (`ChangeSetCanvas.shapeOf`): its fingerprint and its kind (to tell whether it already says what was proposed). */
export interface LiveShape extends LiveTarget {
  shape: string;
}

/**
 * Whether a baselined change may be written onto the target as it is now: its baseline matches, or the target already
 * says exactly what was proposed (`proposedFingerprint`; nothing of the user's would be lost). No baseline: as before.
 */
export function baselineHolds(c: Baselined, live: LiveTarget | null | undefined, proposedFingerprint: () => string): boolean {
  if (!c.expectedFingerprint) return true;
  if (!live) return false;
  return live.fingerprint === c.expectedFingerprint || live.fingerprint === proposedFingerprint();
}

/** The decision a changed target needs: Keep mine (nothing written) or Use proposed (`apply`, baselined to what the user sees now). */
export function staleConflict(c: Baselined, live: LiveTarget | null | undefined): ConflictItem {
  return {
    target: c.target,
    ...(c.stableNodeKey ? { stableNodeKey: c.stableNodeKey } : {}),
    apply: { ...c, expectedFingerprint: live?.fingerprint ?? UNKNOWN_BASELINE },
    changedSinceProposal: true,
  };
}

/** The follow-up's operation id: `op_x` → `op_x.r1` → `op_x.r2` (the written part keeps the original id in the journal). */
export function followUpId(operationId: string): string {
  const m = /^(.*)\.r(\d+)$/.exec(operationId);
  return m ? `${m[1]}.r${Number(m[2]) + 1}` : `${operationId}.r1`;
}

/**
 * What stays under review after an Accept withheld changed targets: only those decisions, with the set's attribution
 * (session, agent, reason). It keeps the operation id when nothing was written (the same proposal, still undecided), and
 * gets the next follow-up id when something was (that id is committed now; the commit journal would refuse it again).
 * A content-source link, knowledge and reports stay with the written part: "Use proposed" is then an ordinary edit, and
 * the next update from that source sees the card as edited — conservative, never a silent baseline move.
 */
export function followUpSet(set: ChangeSet, conflicts: readonly ConflictItem[], wrote: boolean): ChangeSet {
  return {
    operationId: wrote ? followUpId(set.operationId) : set.operationId,
    title: set.title,
    metadata: set.metadata,
    changes: [],
    conflicts: [...conflicts],
    ...(set.session ? { session: set.session } : {}),
    ...(set.agent ? { agent: set.agent } : {}),
    ...(set.reason ? { reason: set.reason } : {}),
    ...(set.args ? { args: set.args } : {}),
  };
}

/**
 * After an Accept of `set` with `decisions` (by target) wrote what it could: the stale-target decisions still to make —
 * targets the accept withheld (`stale`) and stale-target decisions left undecided — and what stays under review (`rest`,
 * null when nothing does). `kept`: stale-target decisions answered Keep mine (nothing was written for them).
 */
export function afterAccept(
  set: ChangeSet,
  decisions: ReadonlyMap<string, "apply" | "keep">,
  stale: readonly ConflictItem[],
  wrote: boolean,
): { waiting: ConflictItem[]; kept: number; rest: ChangeSet | null } {
  const conflicts = set.conflicts ?? [];
  const waiting = [...stale, ...conflicts.filter((c) => c.changedSinceProposal && !decisions.has(c.target))];
  const kept = conflicts.filter((c) => c.changedSinceProposal && decisions.get(c.target) === "keep").length;
  return { waiting, kept, rest: waiting.length ? followUpSet(set, waiting, wrote) : null };
}
