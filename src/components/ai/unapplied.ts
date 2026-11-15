/**
 * What an accept left unapplied (Stage 1 gate 4 follow-up): which source cards keep the previous version's node, and
 * what the user is told when nothing was written. Pure — no canvas or editor imports — so it is tested on its own.
 */
import { describeDropped, type ConflictItem, type DroppedChange } from "@/ai/changes/changeSet";

/**
 * The source's cards an accept left as they were though the update changed them (by stable node key): a claim-level
 * patch skipped because its card changed since the update was planned, an update withheld because its block was edited
 * since it was proposed (`target_changed`, or a stale-target decision passed in `undecided`), and a source conflict left undecided. Their
 * nodes are recorded as the previous version had them (`recordPartlyAppliedSource`), so "Update again" offers them again.
 */
export function unappliedKeys(dropped: readonly DroppedChange[], undecided: readonly ConflictItem[] = []): string[] {
  const keys = [
    ...dropped.flatMap((d) => ((d.reason === "patch_rejected" || d.reason === "target_changed") && "stableNodeKey" in d.change && d.change.stableNodeKey ? [d.change.stableNodeKey] : [])),
    ...undecided.flatMap((c) => (!c.impact && c.stableNodeKey ? [c.stableNodeKey] : [])),
  ];
  return [...new Set(keys)];
}

/** What the user is told when an accept wrote nothing: a stale card is not a deleted object. */
export function nothingAppliedMessage(dropped: readonly DroppedChange[]): string {
  const stale = dropped.filter((d) => d.reason === "patch_rejected" || d.reason === "target_changed").length;
  const deleted = dropped.length - stale;
  if (stale && !deleted)
    return `Nothing was applied: ${stale === 1 ? "the card" : "the cards"} changed since this update was planned. Update again to redo ${stale === 1 ? "it" : "them"}.`;
  if (deleted && !stale) return "Nothing was added: every change referred to a deleted object.";
  return dropped.length ? `Nothing was applied. ${describeDropped(dropped)}` : "Nothing was applied.";
}
