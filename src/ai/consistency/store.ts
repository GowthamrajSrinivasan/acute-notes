/**
 * Conflict records (intelligent-update-engine-plan Stage 4e, §12.4 with refinement C): what the consistency check found,
 * and what the user decided — detection kept apart from resolution.
 *
 * Lifecycle: `possible` (found, unresolved) → `confirmed` (the user says it is real) / `dismissed` (not a conflict) /
 * `deferred` (later) → `closed` (a statement changed or was removed, or they no longer disagree). "pending" is the
 * revision's check job (`commit.ts`), not a record. A *possible* conflict and a *confirmed* one are distinct in storage and
 * in the UI; nothing here, and no AI output, ever confirms or resolves one — only the user's decision does, and closing
 * happens only because a statement itself changed.
 *
 * Exact-pair semantics: a record's id is the two cards and the hashes of the two sentences, so a dismissal holds for that
 * exact pair and a material change to either sentence makes a new pair, eligible again (§12.9 decision 5).
 *
 * Per canvas, in the device's meta store (`consistency.<canvasId>`), bounded. Pure apart from the injected store and clock.
 */
import type { MetaRepository } from "@/persistence/repositories/types";
import type { JudgeAnswer, Shown } from "./judge";
import type { DisagreementKind } from "./rules";

export type ConflictStatus = "possible" | "confirmed" | "dismissed" | "deferred" | "closed";

export interface ConflictSide {
  elementId: string;
  sentence: string;
  sentenceHash: string;
  cardName: string;
}

export interface ConsistencyConflict {
  id: string;
  canvasId: string;
  a: ConflictSide;
  b: ConflictSide;
  kind: DisagreementKind;
  /** The rules' verdict: `conflict` (they can't both be true) or `possible` (needs judgment). Never a resolution. */
  strength: "conflict" | "possible";
  /** Who found it: the rules (tier 1), or the AI check (Stage 4f) for a near-miss the rules alone don't show. */
  evidence: { by: "rule" | "ai"; reason: string; at: number };
  /**
   * The AI check's reading of this exact pair (Stage 4f, opt-in): evidence for the user, **never a decision** — it
   * changes no status. `shown` is what rules + AI would show (`combine`); a record the rules found stays listed even
   * when the AI reads it as compatible (the user decides).
   */
  ai?: { answer: JudgeAnswer; why?: string; shown: Shown; note: string; at: number };
  status: ConflictStatus;
  /** The revision whose check found it. */
  raisedBy: string;
  createdAt: number;
  updatedAt: number;
  deferredUntil?: "next_change" | number;
  /** Each card's text fingerprint when deferred (a change to either reopens it). */
  deferredAt?: { a: string; b: string };
  /** Why it was closed, or the note on a dismissal ("Left as is in the update review"). */
  note?: string;
  history: { at: number; status: ConflictStatus; note?: string }[];
}

export interface Detection {
  a: Omit<ConflictSide, "sentenceHash">;
  b: Omit<ConflictSide, "sentenceHash">;
  kind: DisagreementKind;
  strength: "conflict" | "possible";
  reason: string;
}

export const MAX_CONFLICTS = 200;
const MAX_HISTORY = 10;
export const storeKey = (canvasId: string) => `consistency.${canvasId}`;

/** A short, stable hash of a sentence (FNV-1a over its normalised text). */
export function sentenceHash(sentence: string): string {
  let h = 0x811c9dc5;
  for (const ch of sentence.replace(/\s+/g, " ").trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The exact pair's id: order-independent over (card, sentence) on each side. */
export function pairId(a: { elementId: string; sentence: string }, b: { elementId: string; sentence: string }): string {
  return [`${a.elementId}:${sentenceHash(a.sentence)}`, `${b.elementId}:${sentenceHash(b.sentence)}`].sort().join("|");
}

const side = (s: Omit<ConflictSide, "sentenceHash">): ConflictSide => ({ ...s, sentenceHash: sentenceHash(s.sentence) });
export const isOpen = (c: Pick<ConsistencyConflict, "status">) => c.status === "possible" || c.status === "confirmed" || c.status === "deferred";

export class ConsistencyStore {
  private readonly byCanvas = new Map<string, Map<string, ConsistencyConflict>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly store?: Pick<MetaRepository, "get" | "set">,
    private readonly now: () => number = Date.now,
  ) {}

  load(canvasId: string): Promise<void> {
    let p = this.loading.get(canvasId);
    if (!p) {
      p = (async () => {
        try {
          const stored = await this.store?.get<ConsistencyConflict[]>(storeKey(canvasId));
          const map = this.map(canvasId);
          for (const c of Array.isArray(stored) ? stored : []) if (c && typeof c.id === "string" && !map.has(c.id)) map.set(c.id, c);
          this.emit();
        } catch (err) {
          console.error("[acute-notes] Failed to read consistency conflicts", err);
        }
      })();
      this.loading.set(canvasId, p);
    }
    return p;
  }

  list(canvasId: string, statuses?: readonly ConflictStatus[]): ConsistencyConflict[] {
    return [...this.map(canvasId).values()].filter((c) => !statuses || statuses.includes(c.status)).sort((x, y) => y.updatedAt - x.updatedAt);
  }

  get(canvasId: string, id: string): ConsistencyConflict | undefined {
    return this.map(canvasId).get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Records what a check found. A new pair is `possible`; a pair already open keeps its status (its evidence is
   * refreshed); a dismissed pair stays dismissed (exact-pair semantics); a closed one is found again as `possible`.
   * Returns the records added or reopened.
   */
  record(canvasId: string, raisedBy: string, found: readonly Detection[]): ConsistencyConflict[] {
    const map = this.map(canvasId);
    const at = this.now();
    const changed: ConsistencyConflict[] = [];
    for (const d of found) {
      const id = pairId(d.a, d.b);
      const prev = map.get(id);
      if (prev?.status === "dismissed") continue;
      if (prev && isOpen(prev)) {
        prev.evidence = { by: "rule", reason: d.reason, at };
        prev.strength = d.strength;
        continue;
      }
      const c: ConsistencyConflict = {
        id,
        canvasId,
        a: side(d.a),
        b: side(d.b),
        kind: d.kind,
        strength: d.strength,
        evidence: { by: "rule", reason: d.reason, at },
        status: "possible",
        raisedBy,
        createdAt: prev?.createdAt ?? at,
        updatedAt: at,
        history: [...(prev?.history ?? []), { at, status: "possible" as const }].slice(-MAX_HISTORY),
      };
      map.set(id, c);
      changed.push(c);
    }
    if (changed.length) this.persist(canvasId);
    return changed;
  }

  /** The user's decision. `defer` hides it until either card changes (`next_change`) or until a time. */
  decide(canvasId: string, id: string, decision: "confirm" | "dismiss" | "defer", options: { until?: "next_change" | number; fingerprints?: { a: string; b: string }; note?: string } = {}): ConsistencyConflict | null {
    const c = this.map(canvasId).get(id);
    if (!c || c.status === "closed") return null;
    const status: ConflictStatus = decision === "confirm" ? "confirmed" : decision === "dismiss" ? "dismissed" : "deferred";
    this.transition(c, status, options.note);
    if (decision === "defer") {
      c.deferredUntil = options.until ?? "next_change";
      if (options.fingerprints) c.deferredAt = options.fingerprints;
    } else {
      delete c.deferredUntil;
      delete c.deferredAt;
    }
    this.persist(canvasId);
    return c;
  }

  /**
   * The AI check's readings (Stage 4f, opt-in, review-only). For each pair: an open record gets the reading as evidence
   * (status unchanged); a dismissed one stays dismissed; a pair with no open record is added as `possible` only when
   * rules + AI show it (`likely` or `possible`) — found `by: "ai"`. A pair read as compatible with no record adds
   * nothing (the reading stays in the AI check's ledger). Returns the records added or annotated.
   */
  recordAI(canvasId: string, raisedBy: string, readings: readonly { detection: Detection; ai: { answer: JudgeAnswer; why?: string }; shown: Shown; note: string }[]): ConsistencyConflict[] {
    const map = this.map(canvasId);
    const at = this.now();
    const changed: ConsistencyConflict[] = [];
    for (const r of readings) {
      const id = pairId(r.detection.a, r.detection.b);
      const prev = map.get(id);
      const ai = { answer: r.ai.answer, ...(r.ai.why ? { why: r.ai.why.slice(0, 400) } : {}), shown: r.shown, note: r.note.slice(0, 500), at };
      if (prev?.status === "dismissed") continue;
      if (prev && isOpen(prev)) {
        prev.ai = ai;
        prev.updatedAt = at;
        changed.push(prev);
        continue;
      }
      if (r.shown !== "likely" && r.shown !== "possible" && r.shown !== "conflict") continue;
      const c: ConsistencyConflict = {
        id,
        canvasId,
        a: side(r.detection.a),
        b: side(r.detection.b),
        kind: r.detection.kind,
        strength: "possible",
        evidence: { by: "ai", reason: r.detection.reason, at },
        ai,
        status: "possible",
        raisedBy,
        createdAt: prev?.createdAt ?? at,
        updatedAt: at,
        history: [...(prev?.history ?? []), { at, status: "possible" as const, note: "raised by the AI check" }].slice(-MAX_HISTORY),
      };
      map.set(id, c);
      changed.push(c);
    }
    if (changed.length) this.persist(canvasId);
    return changed;
  }

  /** A pair the user already decided elsewhere (Stage 3 "Leave as is"): recorded dismissed, exact pair, never shown. */
  dismissPair(canvasId: string, raisedBy: string, d: Detection, note: string): void {
    const id = pairId(d.a, d.b);
    const map = this.map(canvasId);
    const prev = map.get(id);
    if (prev?.status === "dismissed") return;
    const at = this.now();
    map.set(id, {
      id,
      canvasId,
      a: side(d.a),
      b: side(d.b),
      kind: d.kind,
      strength: d.strength,
      evidence: { by: "rule", reason: d.reason, at },
      status: "dismissed",
      raisedBy,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
      note,
      history: [...(prev?.history ?? []), { at, status: "dismissed" as const, note }].slice(-MAX_HISTORY),
    });
    this.persist(canvasId);
  }

  /**
   * Re-checks the open records against the canvas as it is now (after a later commit, a manual edit, undo or redo):
   * - a side whose card is gone, or no longer says its sentence → `closed` ("statement changed");
   * - the two sentences no longer disagree (`stillDisagree` false) → `closed` ("no longer disagree");
   * - `deferred` until the next change, and either card's text changed → `possible` again; deferred until a time that
   *   has passed → `possible` again.
   * Only `elementIds` are looked at when given (the cards a commit or an edit touched).
   */
  reevaluate(
    canvasId: string,
    look: {
      sentencesOf(elementId: string): readonly string[] | null;
      fingerprintOf(elementId: string): string | null;
      /** Do the two sentences still disagree? Given the record, so a pair the AI check raised can be judged by its own route. */
      stillDisagree(a: string, b: string, record: ConsistencyConflict): boolean;
    },
    elementIds?: ReadonlySet<string>,
  ): ConsistencyConflict[] {
    const changed: ConsistencyConflict[] = [];
    const at = this.now();
    for (const c of this.map(canvasId).values()) {
      if (!isOpen(c)) continue;
      if (elementIds && !elementIds.has(c.a.elementId) && !elementIds.has(c.b.elementId) && !(c.status === "deferred" && typeof c.deferredUntil === "number")) continue;
      const sa = look.sentencesOf(c.a.elementId);
      const sb = look.sentencesOf(c.b.elementId);
      const says = (sentences: readonly string[] | null, s: ConflictSide) => !!sentences?.some((x) => sentenceHash(x) === s.sentenceHash);
      if (!says(sa, c.a) || !says(sb, c.b)) {
        this.transition(c, "closed", "statement changed");
        changed.push(c);
        continue;
      }
      if (!look.stillDisagree(c.a.sentence, c.b.sentence, c)) {
        this.transition(c, "closed", "no longer disagree");
        changed.push(c);
        continue;
      }
      if (c.status === "deferred") {
        const due =
          typeof c.deferredUntil === "number"
            ? c.deferredUntil <= at
            : !!c.deferredAt && (look.fingerprintOf(c.a.elementId) !== c.deferredAt.a || look.fingerprintOf(c.b.elementId) !== c.deferredAt.b);
        if (due) {
          this.transition(c, "possible", "deferred: a card changed");
          delete c.deferredUntil;
          delete c.deferredAt;
          changed.push(c);
        }
      }
    }
    if (changed.length) this.persist(canvasId);
    return changed;
  }

  flushed(): Promise<void> {
    return this.saving;
  }

  private transition(c: ConsistencyConflict, status: ConflictStatus, note?: string): void {
    c.status = status;
    c.updatedAt = this.now();
    if (note) c.note = note;
    c.history = [...c.history, { at: c.updatedAt, status, ...(note ? { note } : {}) }].slice(-MAX_HISTORY);
  }

  private map(canvasId: string): Map<string, ConsistencyConflict> {
    let m = this.byCanvas.get(canvasId);
    if (!m) this.byCanvas.set(canvasId, (m = new Map()));
    return m;
  }

  private persist(canvasId: string): void {
    const map = this.map(canvasId);
    // Bounded: closed records go first, then dismissed, oldest first (an open record is never dropped while room remains).
    if (map.size > MAX_CONFLICTS) {
      const order = (c: ConsistencyConflict) => (c.status === "closed" ? 0 : c.status === "dismissed" ? 1 : 2);
      const drop = [...map.values()].sort((x, y) => order(x) - order(y) || x.updatedAt - y.updatedAt).slice(0, map.size - MAX_CONFLICTS);
      for (const c of drop) map.delete(c.id);
    }
    this.emit();
    if (!this.store) return;
    const snapshot = [...map.values()];
    this.saving = this.saving.then(() => this.store!.set(storeKey(canvasId), snapshot)).catch((err: unknown) => console.error("[acute-notes] Failed to save consistency conflicts", err));
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
