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
