/**
 * "Auto-accept this mapping session" (F43): while it is on, each section a
 * mapping session sends is written on arrival, as its own undo step, instead
 * of being staged for review. Conflicts and removals are never auto-accepted:
 * a section with any waits in the review like any other (the producer checks
 * `isOn` and decides; see `src/mcp/tools/repoMap`).
 *
 * Only the user turns it on: `enable` is called from the review bar and
 * nowhere else (a guard test checks that no MCP code calls it), and no tool
 * input reaches it. It is scoped to one session of one map (`mergeKey`,
 * `sessionId`): a new session — `begin_repo_map`, or 30 idle minutes — ends
 * it (`end`). Held in memory only, so a reload ends it too.
 *
 * D44 extends it to MCP sessions for the Project-profile writes (`AUTO_ACCEPT_TOOLS`), per canvas and session, with
 * the same rule: only the user turns it on, and `autoAcceptable` (`agentState.ts`) keeps removals, reverts, new
 * constraints and enforced decisions waiting for review. Every auto-accepted set is still logged with its inverse.
 */

interface On {
  sessionId: string;
  canvasId: string;
}

const byKey = new Map<string, On>();
/**
 * MCP sessions that reached this tab from outside the machine's trusted loopback (a secret URL, OAuth, a tunnel or the
 * hosted app). They can NEVER auto-accept: `enable*` ignores them and `isOn`/`isSessionOn` answer false, whatever the
 * user chose for other sessions. A remote client's changes always wait for explicit review.
 */
const remoteSessions = new Set<string>();
/** D44: MCP sessions (not repo maps) the user switched to auto-accept, by canvas, with how many sets it accepted. */
const bySession = new Map<string, { canvasId: string; session: string; accepted: number }>();
const sessionKey = (canvasId: string, session: string) => `${canvasId} ${session}`;

/**
 * The tools whose proposals a session's auto-accept may write (D44: the Project-profile writes — record_decision,
 * log_finding, update_progress, update_knowledge, annotate, sync_session — registered by Phase 7B). Everything else
 * always waits for review, whatever the session's setting.
 */
export const AUTO_ACCEPT_TOOLS: ReadonlySet<string> = new Set(["record_decision", "log_finding", "update_progress", "update_knowledge", "annotate", "sync_session"]);
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const sessionAutoAccept = {
  /** Marks an MCP session as remote (see `remoteSessions`); done when the session is created, before it can propose anything. */
  markRemote(sessionId: string): void {
    remoteSessions.add(sessionId);
  },
  isRemote(sessionId: string | undefined): boolean {
    return !!sessionId && remoteSessions.has(sessionId);
  },
  /** The user turned it on for the session that produced the set under review. */
  enable(mergeKey: string, sessionId: string, canvasId: string): void {
    if (remoteSessions.has(sessionId)) return;
    byKey.set(mergeKey, { sessionId, canvasId });
    emit();
  },
  /** The user turned it off. */
  disable(mergeKey: string): void {
    if (byKey.delete(mergeKey)) emit();
  },
  /** The session ended (a new one started, or it went idle): whatever the user chose ends with it. */
  end(mergeKey: string): void {
    if (byKey.delete(mergeKey)) emit();
  },
  /** Whether it is on for exactly this session. */
  isOn(mergeKey: string, sessionId: string): boolean {
    return !remoteSessions.has(sessionId) && byKey.get(mergeKey)?.sessionId === sessionId;
  },
  /** The merge key it is on for on a canvas, if any (for the review bar). */
  onCanvas(canvasId: string): string | null {
    for (const [key, on] of byKey) if (on.canvasId === canvasId) return key;
    return null;
  },
  /** D44: the user turned auto-accept on for an MCP session on a canvas (from the review bar only). */
  enableSession(canvasId: string, session: string): void {
    if (remoteSessions.has(session)) return;
    bySession.set(sessionKey(canvasId, session), { canvasId, session, accepted: 0 });
    emit();
  },
  disableSession(canvasId: string, session: string): void {
    if (bySession.delete(sessionKey(canvasId, session))) emit();
  },
  isSessionOn(canvasId: string, session: string): boolean {
    return !remoteSessions.has(session) && bySession.has(sessionKey(canvasId, session));
  },
  /** One set was auto-accepted for the session (the review bar's "auto-accepted N this session"). */
  countAccepted(canvasId: string, session: string): void {
    const on = bySession.get(sessionKey(canvasId, session));
    if (!on) return;
    on.accepted++;
    emit();
  },
  /** The sessions auto-accept is on for on a canvas, with their counts. */
  sessionsOnCanvas(canvasId: string): { session: string; accepted: number }[] {
    return [...bySession.values()].filter((o) => o.canvasId === canvasId).map(({ session, accepted }) => ({ session, accepted }));
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
