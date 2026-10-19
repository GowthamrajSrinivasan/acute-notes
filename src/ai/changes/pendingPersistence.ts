/**
 * Keeps the proposals MCP clients leave under review across a tab reload or reconnect.
 *
 * `PendingChanges` is memory-only by design (a pending set is a preview, never document state). For proposals from
 * external agents that is not enough: a reload would silently throw away what ChatGPT asked the user to review. So
 * the sets an external agent session produced (those with a session of their own, not the in-app `"app"` one) are
 * mirrored into the device's local `meta` store — the
 * same browser database that holds the workspace, never a server and never workspace documents or exports — and put
 * back under review when the app starts again.
 *
 * Restored sets go through the normal path (`propose`), so they are re-validated, and Accept still drops any change
 * whose target is gone. They always need explicit acceptance: nothing here applies anything. Sets older than
 * `MAX_AGE_MS` are discarded rather than resurrected.
 */
import type { MetaRepository } from "@/persistence/repositories/types";
import type { ChangeSet } from "./changeSet";
import { APP_SESSION, getPendingChanges, type PendingChanges } from "./pendingChanges";

export const PENDING_KEY = "mcp.pending";
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Coalesces the emits of one proposal into one write, without leaving a window a quick reload could fall into. */
const SAVE_DELAY_MS = 0;

interface StoredProposal {
  canvasId: string;
  set: ChangeSet;
  savedAt: number;
}

const attached = new WeakSet<PendingChanges>();

/**
 * Puts the persisted MCP proposals back under review (once per `pending` instance) and starts mirroring further
 * changes. Returns how many were restored.
 */
export async function restorePendingProposals(meta: MetaRepository, pending: PendingChanges = getPendingChanges(), now: () => number = Date.now): Promise<number> {
  if (attached.has(pending)) return 0;
  attached.add(pending);

  const firstSeen = new Map<string, number>();
  let restoring = true;
  let restored = 0;
  const stored = (await meta.get<StoredProposal[]>(PENDING_KEY)) ?? [];
  for (const item of stored) {
    if (!item || typeof item.canvasId !== "string" || now() - item.savedAt > MAX_AGE_MS) continue;
    try {
      pending.propose(item.canvasId, item.set);
      firstSeen.set(item.set.operationId, item.savedAt);
      restored++;
    } catch {
      // invalid now, or in conflict with another set under review: it is dropped, not forced in
    }
  }
  restoring = false;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const items: StoredProposal[] = pending
      .all()
      .filter(({ set }) => !!set.session && set.session !== APP_SESSION)
      .map(({ canvasId, set }) => {
        if (!firstSeen.has(set.operationId)) firstSeen.set(set.operationId, now());
        return { canvasId, set, savedAt: firstSeen.get(set.operationId)! };
      });
    void (items.length ? meta.set(PENDING_KEY, items) : meta.delete(PENDING_KEY));
  };
  pending.subscribe(() => {
    if (restoring) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  });
  save(); // drop whatever was discarded above
  return restored;
}
