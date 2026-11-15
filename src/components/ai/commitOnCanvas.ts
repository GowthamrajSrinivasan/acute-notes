"use client";

/**
 * The live canvas's side of the shared commit (intelligent-update-engine-plan Stage 4a–4b, §12.1): every accepted change
 * set is written here — `commitSetOnCanvas` for a whole set, `commitPartsOnCanvas` for parts of a merged one — through
 * `ai/changes/commit.ts` (idempotent, journalled), and then `afterCommit` runs, in this order, each step isolated:
 *
 * 1. **index sync** — the live index brings the committed scene in now and verifies it (`syncCommitted`); a failure
 *    makes the canvas's index `stale` and rebuilds it, visibly (`IndexStatusBadge`), and is never thrown;
 * 2. **the revision's check job** — recorded once (stable id). Until the checker exists (Stage 4d) it waits as
 *    `awaiting_checker`, or `waiting_for_index` while the index isn't fresh: no check ever reads a known-stale index;
 * 3. **post-commit listeners** (`onCommitted`: the consistency check, later) — each in its own try/catch, its failure
 *    recorded on the job (`failed`, retryable), never thrown.
 * Nothing after the write can roll it back: the commit is one history step before any of this runs.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { TransactionHistory } from "@/ai/changes/accept";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { commitChangeSet, commitParts, getCommitJournal, setCommitJournalStore, type CommittedRevision } from "@/ai/changes/commit";
import type { PartDecision } from "@/ai/changes/parts";
import { changeSetCanvas } from "@/components/canvas/changeSetWriter";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { cardReader, newClaims } from "@/ai/consistency/check";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getDocumentStore } from "@/state/documents";
import { syncCommitted, whenIndexFresh, type CommitIndexState } from "@/search/liveIndex";

type Listener = (revision: CommittedRevision, home: DocumentHome) => void | Promise<void>;
const listeners = new Set<Listener>();

/** Runs after every commit, once its index sync is done (Stage 4d's checker registers here). */
export function onCommitted(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let journalReady: Promise<void> | null = null;
/** Starts the commit journal on the device's meta store (once); safe to call from anywhere at start-up. */
export function ensureCommitJournal(): Promise<void> {
  journalReady ??= setCommitJournalStore(getPersistence().meta).catch((err: unknown) => console.error("[acute-notes] Failed to start the commit journal", err));
  return journalReady;
}

export interface CommitOptions {
  /** Stage 3 impact offers the user answered "Leave as is" in this review (exact pairs already decided). */
  leftAsIs?: { target: string; from: string }[];
}

export function commitSetOnCanvas(api: ExcalidrawImperativeAPI, home: DocumentHome, history: TransactionHistory, set: ChangeSet, options: CommitOptions = {}) {
  void ensureCommitJournal();
  const before = sentencesBefore(api, set);
  const result = commitChangeSet(set, changeSetCanvas(api, home), history, { canvasId: home.canvasId });
  if (result?.revision) {
    recordClaims(api, result.revision, before, options);
    afterCommit(home, result.revision);
  }
  return result;
}

/** What the cards a set changes say before it is written (a created card has nothing before). */
function sentencesBefore(api: ExcalidrawImperativeAPI, set: ChangeSet): Map<string, string[]> {
  const read = cardReader(api.getSceneElements() as unknown as readonly SceneElement[], (id) => getDocumentStore().get(id));
  const out = new Map<string, string[]>();
  for (const c of set.changes) if ("target" in c && typeof c.target === "string" && !out.has(c.target)) out.set(c.target, read(c.target)?.sentences ?? []);
  return out;
}

/** The revision's claims (what it newly says) and the pairs already decided, kept on its one check job. */
function recordClaims(api: ExcalidrawImperativeAPI, revision: CommittedRevision, before: ReadonlyMap<string, readonly string[]>, options: CommitOptions): void {
  try {
    const read = cardReader(api.getSceneElements() as unknown as readonly SceneElement[], (id) => getDocumentStore().get(id));
    const after = revision.touched.flatMap((id) => read(id) ?? []);
    getCommitJournal().updateCheck(revision.id, { claims: newClaims(before, after), ...(options.leftAsIs?.length ? { leftAsIs: options.leftAsIs } : {}) });
  } catch (err) {
    console.error("[acute-notes] Couldn't read what the commit says; its check will find nothing new", err);
  }
}

export function commitPartsOnCanvas(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  history: TransactionHistory,
  set: ChangeSet,
  keys: ReadonlySet<string> | null,
  decisions: ReadonlyMap<string, PartDecision>,
) {
  void ensureCommitJournal();
  const before = sentencesBefore(api, set);
  const result = commitParts(set, keys, decisions, () => changeSetCanvas(api, home), history, { canvasId: home.canvasId });
  if (result?.revision) {
    recordClaims(api, result.revision, before, {});
    afterCommit(home, result.revision);
  }
  return result;
}

/** The steps after a commit (module doc). Never throws. Returns the index state it found, for tests and logs. */
export function afterCommit(home: DocumentHome, revision: CommittedRevision): CommitIndexState {
  const journal = getCommitJournal();
  let index: CommitIndexState;
  try {
    index = syncCommitted(home.workspaceId, home.canvasId);
  } catch (err) {
    console.error("[acute-notes] Index sync after commit failed", err);
    index = { state: "stale", reason: err instanceof Error ? err.message : String(err), since: Date.now(), attempts: 0 };
  }
  const fresh = index.state === "fresh" || index.state === "on_demand";
  if (!fresh) {
    journal.updateCheck(revision.id, { status: "waiting_for_index" });
    // The job moves on once the index is fresh again; it never runs against a stale one.
    void whenIndexFresh(home.workspaceId, home.canvasId, 60_000).then((ok) => {
      if (ok) {
        journal.updateCheck(revision.id, { status: "awaiting_checker" });
        void runListeners(home, revision);
      }
    });
    return index;
  }
  void runListeners(home, revision);
  return index;
}

/**
 * Runs the post-commit steps for a revision; the job is `done` once every step has finished, `failed` (retryable, with
 * the error) if any failed. With no step registered the job keeps waiting for one (`awaiting_checker`).
 */
function runListeners(home: DocumentHome, revision: CommittedRevision): Promise<void> {
  const journal = getCommitJournal();
  const steps = [...listeners];
  if (!steps.length) return Promise.resolve();
  journal.updateCheck(revision.id, { status: "pending" });
  const runs = steps.map((listener) => {
    try {
      return Promise.resolve(listener(revision, home));
    } catch (err) {
      return Promise.reject(err);
    }
  });
  return Promise.allSettled(runs).then((results) => {
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    const attempts = (journal.get(revision.id)?.check.attempts ?? 0) + 1;
    if (!failed) return journal.updateCheck(revision.id, { status: "done", attempts, lastError: undefined });
    console.error("[acute-notes] A post-commit step failed; the commit stands", failed.reason);
    journal.updateCheck(revision.id, { status: "failed", attempts, lastError: failed.reason instanceof Error ? failed.reason.message : String(failed.reason) });
  });
}

/** Retries at most this many times automatically; after that a job waits for the user's Retry. */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * Resumes this canvas's check jobs that are waiting (held for a stale index, or interrupted by a reload) or failed with
 * attempts left — only while the index is fresh. Called when a canvas opens, when its index turns fresh again, and by
 * Retry (`force`: failed jobs whatever their attempts). Each revision's one job is reused, never duplicated.
 */
export async function resumeCheckJobs(home: DocumentHome, options: { force?: boolean } = {}): Promise<number> {
  await ensureCommitJournal();
  if (!listeners.size) return 0;
  if (!(await whenIndexFresh(home.workspaceId, home.canvasId, 0).catch(() => false))) return 0;
  const due = getCommitJournal()
    .list(home.canvasId)
    .filter((r) => r.check.status === "waiting_for_index" || r.check.status === "awaiting_checker" || r.check.status === "pending" || (r.check.status === "failed" && (options.force || r.check.attempts < MAX_JOB_ATTEMPTS)));
  for (const r of due) await runListeners(home, r);
  return due.length;
}

