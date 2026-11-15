/**
 * AI settings → Update behaviour (intelligent-update-engine-plan Stage 1e, Stage 3): how an update from new content
 * treats locked and edited cards, and cards elsewhere that repeat a changed fact. Independent switches, read by every update and merge (`ingestContent`), the app's and
 * an MCP client's alike; the engine itself takes them as `UpdateOptions`, so tests pass their own.
 */
export interface UpdatePolicy {
  /** Locked cards and sections are left alone (on); off, a lock is only a marker. */
  preserveLockedSections: boolean;
  /** Every card changed since AI wrote it gets Apply / Keep mine instead of a merged patch (off). */
  preserveEditedCards: boolean;
  /**
   * Stage 3 (impact discovery): other cards on the canvas that repeat a fact the update changes are offered the same edit,
   * each its own decision ("Update this too" / "Leave as is"), never applied by "Accept all" (on). Off: only the source's
   * own cards are proposed.
   */
  suggestElsewhere: boolean;
}

export const DEFAULT_UPDATE_POLICY: UpdatePolicy = { preserveLockedSections: true, preserveEditedCards: false, suggestElsewhere: true };

let source: () => UpdatePolicy = () => DEFAULT_UPDATE_POLICY;

/** The policy in effect (the settings register theirs, see `state/uiPrefs.ts`). */
export function currentUpdatePolicy(): UpdatePolicy {
  return source();
}

export function setUpdatePolicySource(next: () => UpdatePolicy): void {
  source = next;
}

/** "2 locked cards not updated": what an update left alone because it is locked (the review bar, or a notice when nothing else changed). */
export function lockedNotice(n: number): string {
  return `${n} locked ${n === 1 ? "card" : "cards"} not updated`;
}

/** The review bar's line for a set's skipped cards ("🔒 2 locked cards not updated"); null when it skipped none. */
export function skippedNote(set: { skipped?: { locked: number } }): string | null {
  return set.skipped?.locked ? `🔒 ${lockedNotice(set.skipped.locked)}` : null;
}
