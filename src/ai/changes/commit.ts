/**
 * The shared commit mechanism (intelligent-update-engine-plan Stage 4a, §12.1, refinement B): the **only** place an
 * accepted change set is written. Every accept path — the review bar, auto-accept, MCP accept, merged sets part by part,
 * OpenUI promotion, the Source tab's passage cards — goes through `commitChangeSet` or `commitParts` (a guard test keeps
 * it so).
 *
 * Idempotent: one accepted change is one committed revision with a stable id, and one logical consistency-check job
 * (`check:<revision>`). The journal remembers what was committed — in memory at once, and in the device's meta store, so a
 * reload can't bring back an already-written set (an MCP proposal restored from storage, `pendingPersistence.ts`). A
 * repeated accept of the same operation (a double event, a retry, a restored proposal) writes nothing and returns null; a
 * merged set commits each part once.
 *
 * What runs after the commit (the index sync, the consistency check) is the caller's, through `afterCommit`; it never
 * rolls a commit back — a failure there is recorded, not thrown (§12.1).
 */
import type { ChangeSetCanvas, TransactionHistory } from "./accept";
import { acceptChangeSet } from "./accept";
import type { ChangeSet, ProposedChange } from "./changeSet";
import { acceptParts, type AcceptPartsResult, type PartDecision } from "./parts";
import type { MetaRepository } from "@/persistence/repositories/types";

/** Where a consistency-check job stands (Stage 4d–4f build the checker; until then every job waits for it). */
export type CheckJobStatus = "awaiting_checker" | "waiting_for_index" | "pending" | "done" | "failed";

export interface CommittedRevision {
  /** Stable: `rev:<operationId>` for a whole set, `rev:<operationId>#<part keys, sorted, joined by +>` for parts of a merged set. */
  id: string;
  operationId: string;
  canvasId: string;
  /** The history step that holds the write. */
  stepId: number;
  /** A merged set's parts this revision wrote (absent: the whole set). */
  parts?: string[];
  /** Objects the commit created, changed or removed (element ids): what the index re-syncs and the check reads. */
  touched: string[];
  committedAt: number;
  /**
   * The one logical consistency-check job of this revision (stable id, `check:<revision id>`). `claims`: the sentences the
   * commit added or changed (kept so a resumed check needs nothing else); `leftAsIs`: Stage 3 offers the user answered
   * "Leave as is" in this commit's review — the exact pairs they already decided (§12.9 decision 5).
   */
  check: {
    id: string;
    status: CheckJobStatus;
    attempts: number;
    lastError?: string | undefined;
    claims?: { elementId: string; sentence: string }[];
    leftAsIs?: { target: string; from: string }[];
  };
}

export const JOURNAL_KEY = "commits.journal";
/** Revisions remembered, at most (oldest first out); far more than the pending sets a reload could bring back. */
export const MAX_JOURNAL = 1_000;
/** Touched ids kept per revision (a Visualize of hundreds of cards would otherwise make the stored journal large). */
export const MAX_TOUCHED = 500;

export const revisionId = (operationId: string, partKey?: string) => `rev:${operationId}${partKey ? `#${partKey}` : ""}`;
export const checkJobId = (revision: string) => `check:${revision}`;

/** What was committed (see module doc). One per app (`getCommitJournal`); tests make their own. */
export class CommitJournal {
  private readonly revisions = new Map<string, CommittedRevision>();
  private loaded: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  /** Told whenever a revision is recorded or its job changes (the UI's "checking…"). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  constructor(private readonly store?: Pick<MetaRepository, "get" | "set">) {}

  /** Reads the persisted journal once (later calls return the same promise); entries committed meanwhile are kept. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const stored = await this.store?.get<CommittedRevision[]>(JOURNAL_KEY);
        for (const r of Array.isArray(stored) ? stored : []) if (r && typeof r.id === "string" && !this.revisions.has(r.id)) this.revisions.set(r.id, r);
      } catch (err) {
        console.error("[acute-notes] Failed to read the commit journal", err);
      }
    })();
    return this.loaded;
  }

  has(id: string): boolean {
    return this.revisions.has(id);
  }

  get(id: string): CommittedRevision | undefined {
    return this.revisions.get(id);
  }

  /** Whether `operationId` was committed, whole or any part of it. */
  committed(operationId: string): boolean {
    for (const r of this.revisions.values()) if (r.operationId === operationId) return true;
    return false;
  }

  /** Whether `partKey` of a merged set `operationId` was written (by a commit of the whole set or of that part). */
  partCommitted(operationId: string, partKey: string): boolean {
    for (const r of this.revisions.values()) if (r.operationId === operationId && (!r.parts || r.parts.includes(partKey))) return true;
    return false;
  }

  list(canvasId?: string): CommittedRevision[] {
    return [...this.revisions.values()].filter((r) => !canvasId || r.canvasId === canvasId);
  }

  /** Records a revision (first write wins: a revision is never recorded twice). */
  record(r: CommittedRevision): boolean {
    if (this.revisions.has(r.id)) return false;
    this.revisions.set(r.id, r);
    while (this.revisions.size > MAX_JOURNAL) this.revisions.delete(this.revisions.keys().next().value!);
    this.persist();
    return true;
  }

  /** Updates a revision's check job (the job is never duplicated: it lives on its revision). */
  updateCheck(id: string, patch: Partial<CommittedRevision["check"]>): void {
    const r = this.revisions.get(id);
    if (!r) return;
    r.check = { ...r.check, ...patch };
    this.persist();
  }

  /** Resolves when the last write to the store has finished (tests, and a clean shutdown). */
  flushed(): Promise<void> {
    return this.saving;
  }

  private persist(): void {
    for (const l of [...this.listeners]) l();
    if (!this.store) return;
    const snapshot = [...this.revisions.values()];
    this.saving = this.saving
      .then(() => this.store!.set(JOURNAL_KEY, snapshot))
      .catch((err: unknown) => console.error("[acute-notes] Failed to save the commit journal", err));
  }
}

let journal: CommitJournal | null = null;

/** The app's journal (`setCommitJournalStore` gives it the meta store at start-up). */
export function getCommitJournal(): CommitJournal {
  return (journal ??= new CommitJournal());
}

/** Starts the app's journal on the device's meta store and loads it; entries committed before it loads are kept. */
export function setCommitJournalStore(store: Pick<MetaRepository, "get" | "set">): Promise<void> {
  const previous = journal;
  journal = new CommitJournal(store);
  for (const r of previous?.list() ?? []) journal.record(r);
  return journal.load();
}

export interface CommitContext {
  canvasId: string;
  journal?: CommitJournal;
  now?: () => number;
}

export type Committed<T> = T & { revision: CommittedRevision | null };

/**
 * Commits a whole change set once. Null when `set.operationId` was already committed (nothing written). A commit that
 * wrote nothing (every change dropped, or only "Keep mine" metadata) has no revision.
 */
export function commitChangeSet(set: ChangeSet, canvas: ChangeSetCanvas, history: TransactionHistory, ctx: CommitContext): Committed<ReturnType<typeof acceptChangeSet>> | null {
  const j = ctx.journal ?? getCommitJournal();
  if (j.committed(set.operationId)) return null;
  const result = acceptChangeSet(set, canvas, history);
  const revision = result.stepId === null ? null : recordRevision(j, ctx, set.operationId, undefined, result.stepId, result.applied, result.created);
  return { ...result, revision };
}

/**
 * Commits parts of a merged set: only parts not committed before (a part is never written twice). Null when the set is
 * wholly committed already. One revision for what this call wrote, keyed by the parts it wrote.
 */
export function commitParts(
  set: ChangeSet,
  keys: ReadonlySet<string> | null,
  decisions: ReadonlyMap<string, PartDecision>,
  canvas: () => ChangeSetCanvas,
  history: TransactionHistory,
  ctx: CommitContext,
): Committed<AcceptPartsResult> | null {
  const j = ctx.journal ?? getCommitJournal();
  if (j.has(revisionId(set.operationId))) return null;
  const wanted = new Set((set.parts ?? []).map((p) => p.key).filter((k) => !j.partCommitted(set.operationId, k) && (!keys || keys.has(k))));
  if (!wanted.size) return null;
  const result = acceptParts(set, wanted, decisions, canvas, history);
  if (result.stepId === null) return { ...result, revision: null };
  const parts = result.accepted.map((p) => p.key).sort();
  const revision = recordRevision(j, ctx, set.operationId, parts.join("+") || "none", result.stepId, result.applied, result.created, parts);
  return { ...result, revision };
}

function recordRevision(
  j: CommitJournal,
  ctx: CommitContext,
  operationId: string,
  partKey: string | undefined,
  stepId: number,
  applied: readonly ProposedChange[],
  created: ReadonlyMap<string, string>,
  parts?: string[],
): CommittedRevision {
  const id = revisionId(operationId, partKey);
  const revision: CommittedRevision = {
    id,
    operationId,
    canvasId: ctx.canvasId,
    ...(parts ? { parts } : {}),
    stepId,
    touched: touchedBy(applied, created).slice(0, MAX_TOUCHED),
    committedAt: (ctx.now ?? Date.now)(),
    check: { id: checkJobId(id), status: "awaiting_checker", attempts: 0 },
  };
  j.record(revision);
  return j.get(id)!;
}

/** Element ids a commit created, changed or removed. */
export function touchedBy(applied: readonly ProposedChange[], created: ReadonlyMap<string, string>): string[] {
  const ids = new Set<string>(created.values());
  for (const c of applied) {
    if ("target" in c && typeof c.target === "string") ids.add(c.target);
    if (c.kind === "group_objects") for (const t of c.targets) ids.add(t);
  }
  return [...ids];
}
