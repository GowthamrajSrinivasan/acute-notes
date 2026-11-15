/**
 * Lock (intelligent-update-engine-plan Stage 1e): a card or a section frame the user locked against updates from new
 * content. Stored on the element (`customData.acuteLocked`), so the canvas redraws its lock icon as soon as it changes
 * and an update reads it with the rest of the scene. A locked frame locks every card in it — whatever is in the frame
 * at update time, so a card moved into it later is locked too.
 *
 * A locked card also carries `excludeFromReconciliation` (F39's opt-out), which the update engine already honours; the
 * element flag is what tells a user's lock apart from other opt-outs (a passage card added by the user), so
 * "Preserve locked sections: off" can ignore locks without ever touching those.
 */
const LOCK_KEY = "acuteLocked";

export function isLocked(el: { customData?: Record<string, unknown> | null } | null | undefined): boolean {
  return el?.customData?.[LOCK_KEY] === true;
}

/** `customData` with the lock set or cleared (cleared: the key is removed, not stored as false). */
export function withLock(customData: Record<string, unknown> | null | undefined, locked: boolean): Record<string, unknown> {
  const { [LOCK_KEY]: _old, ...rest } = customData ?? {};
  return locked ? { ...rest, [LOCK_KEY]: true } : rest;
}

/**
 * Set when a card is locked while it was already opted out of updates for another reason (a passage or pinned card,
 * "Don't update"). Such an opt-out belongs to the card, not to the lock: unlocking keeps it, and "Preserve locked
 * sections: off" still leaves the card alone (lock.ts contract above; shared-contract review 2026-11-15, risk 2).
 */
const KEEPS_OPT_OUT_KEY = "acuteLockKeepsOptOut";

/** Whether the card's lock sits on top of its own opt-out (see `KEEPS_OPT_OUT_KEY`). */
export function lockKeepsOptOut(el: { customData?: Record<string, unknown> | null } | null | undefined): boolean {
  return el?.customData?.[KEEPS_OPT_OUT_KEY] === true;
}

/**
 * Whether an object is opted out of updates for a reason other than its own lock: `optedOut` (the F39 opt-out) is set,
 * and either the card isn't locked or it was already opted out when it was locked.
 */
export function optedOutBesidesLock(el: { customData?: Record<string, unknown> | null } | null | undefined, optedOut: boolean): boolean {
  return optedOut && (!isLocked(el) || lockKeepsOptOut(el));
}

/** `customData` for a card being locked (`keepsOptOut`: it was already opted out) or unlocked (both keys removed). */
export function withCardLock(customData: Record<string, unknown> | null | undefined, locked: boolean, keepsOptOut: boolean): Record<string, unknown> {
  const { [KEEPS_OPT_OUT_KEY]: _old, ...rest } = withLock(customData, locked);
  return locked && keepsOptOut ? { ...rest, [KEEPS_OPT_OUT_KEY]: true } : rest;
}
