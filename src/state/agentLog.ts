"use client";

/**
 * The browser's Agent State service (plan §3.7, D28, D30–D32, D46): writes the change log at the moments the review
 * path decides — Accept (with the inverse, from the scene just before and after the write), Reject (with the user's
 * optional reason) and expiry (a proposal replaced before anyone decided) — keeps the MCP session records, bounds
 * the log (D58) and stages reverts (D30) as ordinary change sets for review.
 *
 * Every accepted change set is logged, whoever produced it (MCP, in-app AI, a repo map); the user's own hand edits
 * aren't change sets and aren't logged. Device-local, like the Repo Map record (D31); never read to decide what is
 * true (D2). Writes are queued per workspace so a session record's read-modify-write never loses an update.
 */
import { useEffect, useState } from "react";
import { changeRecord, diffScenes, planRevert, retain, type AgentChangeRecord, type AgentSessionRecord, type ChangeOutcome } from "@/ai/changes/agentState";
import { InvalidChangeSetError, parseChangeSet, type ChangeSet } from "@/ai/changes/changeSet";
import { APP_SESSION, getPendingChanges, onPendingExpired, PendingReviewError } from "@/ai/changes/pendingChanges";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";

type Scene = readonly { id: string; isDeleted?: boolean; version?: number; customData?: Record<string, unknown> }[];

const queues = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

/** Runs `job` after every earlier write for the workspace; failures are logged, never thrown at the caller. */
function enqueue(workspaceId: string, job: () => Promise<void>): Promise<void> {
  const run = (queues.get(workspaceId) ?? Promise.resolve()).then(job).catch((err: unknown) => console.error("[acute-notes] Couldn't write the agent change log", err));
  queues.set(workspaceId, run);
  return run.then(emit);
}

/** A set's producer session when it isn't in-app (an MCP or repo-map session, which has a session record). */
const mcpSession = (set: ChangeSet) => (set.session && set.session !== APP_SESSION ? set.session : undefined);

async function writeRecord(record: AgentChangeRecord, set: ChangeSet): Promise<void> {
  const store = getPersistence().agentState;
  await store.putChange(record);
  // An accepted revert marks what it reverted.
  if (record.outcome === "accepted" && record.reverts?.length) {
    for (const id of record.reverts) {
      const original = await store.getChange(id);
      if (original && !original.revertedBy) await store.putChange({ ...original, revertedBy: record.id });
    }
  }
  const session = mcpSession(set);
  if (session) {
    const existing = await store.getSession(session);
    await store.putSession({
      ...(existing ?? { id: session, workspaceId: record.workspaceId, startedAt: record.at, changeIds: [] }),
      ...(set.agent ? { agent: set.agent } : {}),
      lastWriteAt: record.at,
      changeIds: [...(existing?.changeIds ?? []), record.id],
    });
  }
  const { keep, drop, stripped } = retain(await store.listChanges(record.workspaceId), Date.now());
  if (drop.length) await store.deleteChanges(drop);
  for (const r of keep) if (stripped.includes(r.id)) await store.putChange(r);
}

/** Logs an accepted set: what it touched and the inverse, from the scene right before and right after the write. */
export function recordAccepted(home: DocumentHome, set: ChangeSet, before: Scene, after: Scene, result: AgentChangeRecord["result"] = "applied"): void {
  const diff = diffScenes(before as never, after as never);
  const record = changeRecord({ id: newId("chg"), workspaceId: home.workspaceId, canvasId: home.canvasId, set, at: Date.now(), outcome: "accepted", diff, result });
  void enqueue(home.workspaceId, () => writeRecord(record, set));
}

/** Logs a set nobody accepted: the user rejected it (with their optional reason), or a newer proposal replaced it. */
export function recordSettled(home: DocumentHome, set: ChangeSet, outcome: Exclude<ChangeOutcome, "accepted">, rejectReason?: string): void {
  const record = changeRecord({ id: newId("chg"), workspaceId: home.workspaceId, canvasId: home.canvasId, set, at: Date.now(), outcome, ...(rejectReason ? { rejectReason } : {}) });
  void enqueue(home.workspaceId, () => writeRecord(record, set));
}

// A proposal replaced in its slot before anyone decided (D46's "expired"). The pending store knows the canvas only.
onPendingExpired((canvasId, set) => {
  void getPersistence()
    .canvases.get(canvasId)
    .then((canvas) => canvas && recordSettled({ workspaceId: canvas.workspaceId, canvasId }, set, "expired"))
    .catch((err: unknown) => console.error("[acute-notes] Couldn't log an expired proposal", err));
});

/** D46: one MCP tool call, for the session's usage (calls and characters returned). Nothing is limited or metered. */
export function recordUsage(workspaceId: string, session: string, agent: string | undefined, tool: string, chars: number): void {
  void enqueue(workspaceId, async () => {
    const store = getPersistence().agentState;
    const existing: AgentSessionRecord = (await store.getSession(session)) ?? { id: session, workspaceId, startedAt: Date.now(), changeIds: [] };
    const usage = { ...existing.usage };
    const was = usage[tool] ?? { calls: 0, chars: 0 };
    usage[tool] = { calls: was.calls + 1, chars: was.chars + Math.max(0, Math.round(chars)) };
    await store.putSession({ ...existing, ...(agent ? { agent } : {}), usage });
  });
}

export interface AgentLog {
  /** Newest first. */
  changes: AgentChangeRecord[];
  sessions: AgentSessionRecord[];
  loading: boolean;
}

/** The workspace's change log and sessions, kept current as records are written. */
export function useAgentLog(workspaceId: string): AgentLog {
  const [state, setState] = useState<AgentLog>({ changes: [], sessions: [], loading: true });
  const [seen, setSeen] = useState(version);
  useEffect(() => {
    const l = () => setSeen(version);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    let live = true;
    const store = getPersistence().agentState;
    void Promise.all([store.listChanges(workspaceId), store.listSessions(workspaceId)]).then(
      ([changes, sessions]) => live && setState({ changes: changes.sort((a, b) => b.at - a.at), sessions, loading: false }),
      (err: unknown) => {
        console.error("[acute-notes] Couldn't read the agent change log", err);
        if (live) setState((s) => ({ ...s, loading: false }));
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId, seen]);
  return state;
}

export type RevertOutcome = { ok: true; set: ChangeSet } | { ok: false; reason: string };

/**
 * Stages the revert of `recordIds` on the open canvas for review (D30): the inverse of each, newest first, as one
 * change set; elements edited since come back as conflicts. Nothing is written until the user accepts it.
 */
export async function stageRevert(home: DocumentHome, recordIds: readonly string[], scene: readonly SceneElement[]): Promise<RevertOutcome> {
  const store = getPersistence().agentState;
  const records = (await Promise.all(recordIds.map((id) => store.getChange(id)))).filter((r): r is AgentChangeRecord => !!r);
  if (!records.length) return { ok: false, reason: "That change is no longer in the log." };
  if (records.some((r) => r.canvasId !== home.canvasId)) return { ok: false, reason: "Open the canvas the change was made on to revert it." };
  const plan = planRevert(records, scene as never);
  if (!plan.changes.length && !plan.conflicts.length) {
    const why = plan.skipped[0]?.why;
    return {
      ok: false,
      reason:
        why === "already_reverted" ? "That change was already reverted." : why === "not_revertible" ? "That change can't be reverted any more (its before-state is no longer kept)." : "Nothing to revert: what it changed is already gone.",
    };
  }
  const reverted = records.filter((r) => !plan.skipped.some((s) => s.id === r.id));
  const title = reverted.length === 1 ? `Revert: ${reverted[0]!.title}` : `Revert ${reverted.length} changes`;
  let set: ChangeSet;
  try {
    set = parseChangeSet({
      operationId: newId("op"),
      title: title.slice(0, 200),
      metadata: { createdBy: "import", task: "revert" },
      session: APP_SESSION,
      reverts: reverted.map((r) => r.id),
      changes: plan.changes,
      ...(plan.conflicts.length ? { conflicts: plan.conflicts } : {}),
    });
  } catch (err) {
    if (err instanceof InvalidChangeSetError) return { ok: false, reason: `The revert couldn't be prepared: ${err.problems.slice(0, 3).join("; ")}` };
    throw err;
  }
  try {
    getPendingChanges().propose(home.canvasId, set);
  } catch (err) {
    if (err instanceof PendingReviewError) return { ok: false, reason: err.message };
    throw err;
  }
  return { ok: true, set };
}
