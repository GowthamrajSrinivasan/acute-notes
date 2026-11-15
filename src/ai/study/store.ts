/**
 * Study Mode Phase 2 (`.ai/docs/study-mode-implementation-plan.md` §2, §4): device-local study history over the meta store
 * (`MetaRepository`) — the same posture as `sourceReview:` and `consistency.`: never synced, never exported, not in Yjs.
 *
 * Keys (sharded, decision 2):
 * - `study.<workspaceId>`: the index, `{ version: 1, shards: { [sourceId | "local:<canvasId>"]: { concepts, updatedAt } } }`.
 *   `MetaRepository` has no key listing, so the index is how a workspace's shards are found (and deleted).
 * - `study.<workspaceId>.<sourceId>`: one source's concepts.
 * - `study.<workspaceId>.local.<canvasId>`: the local concepts (no source, or no citations) of one canvas.
 *
 * - **Bounds:** 20 attempts per concept (oldest dropped), 500 concepts per shard, 2,000 per workspace. When a bound is
 *   hit, retired concepts go first, then the least recently attempted; the concept just studied is never evicted.
 * - **Reading:** lenient, like `readSourceReview`: malformed entries are dropped, nothing throws.
 * - **Writing:** one `set` on the studied shard per attempt (plus the index when a shard's concept count changes). Writes
 *   are serialised per workspace through an in-module promise chain, so each key's writes are serialised and an index
 *   update or a cross-shard eviction never interleaves with another write of the same workspace.
 * - **Remap (§1, §4):** applied lazily when a source shard is loaded, through `remapConcept`. A narrowed concept moves to
 *   its new key; if that key already exists (a collision), neither history is merged: the old record keeps its key as
 *   `source_changed` and the target gets `related: merged_from` the old key.
 * - **Privacy:** no answer text, no choice text, no timing — concept keys, titles (≤ 120 chars) and booleans only.
 *
 * Review state comes in only as a boolean the Notes view derives from `Note.needsReview` (§7.4): this module names no
 * guarded provenance field.
 */
import type { Lineage } from "@/ai/fidelity/contracts";
import type { MetaRepository } from "@/persistence/repositories/types";
import { remapConcept, sortUnits, type Concept } from "./concept";
import { FLAG_UNVERIFIED, type Attempt, type AttemptKind } from "./mastery";

export const MAX_ATTEMPTS = 20;
export const MAX_SHARD_CONCEPTS = 500;
export const MAX_WORKSPACE_CONCEPTS = 2000;
export const MAX_TITLE = 120;
/** Attempt flag bit1: made before the source changed (also implied by `freshSince`). */
export const FLAG_STALE = 2;

export type StudyState = "source_changed" | "needs_review" | "retired";
export type StudyReason = "narrowed" | "lineage_gap" | "source_missing";
export type Relation = "split_from" | "merged_from" | "overlaps";

export interface StudyConceptRecord {
  /** The units at `sourceVersion`; absent for a local concept. */
  units?: string[];
  sourceVersion?: number;
  /** Display only: the last card title studied (≤ 120 chars). */
  title: string;
  attempts: Attempt[];
  /** Attempts before this are stale (the source changed since). */
  freshSince?: number;
  state?: StudyState;
  reason?: StudyReason;
  carriedFrom?: string;
  related?: { key: string; rel: Relation }[];
  /** Whether the card teaching it had an open review, as last seen by the Notes view (snapshot for the MCP phase). */
  cardStatus?: { status: "open" | "none"; at: number; version?: number };
  /**
   * The cards last seen teaching it (≤ `MAX_CARD_REFS`, most recent first), written by the Notes view. Display and MCP
   * (`get_weak_concepts`) only: a reader must check that each card still exists. Not provenance — just canvas object ids.
   */
  cards?: StudyCardRef[];
}

export interface StudyCardRef {
  objectId: string;
  canvasId: string;
}

export const MAX_CARD_REFS = 3;

/** Puts `ref` first in `rec.cards` (deduplicated, bounded). Returns whether anything changed. */
function noteCard(rec: StudyConceptRecord, ref: StudyCardRef | undefined): boolean {
  if (!ref) return false;
  const cards = rec.cards ?? [];
  if (cards[0]?.objectId === ref.objectId && cards[0].canvasId === ref.canvasId) return false;
  rec.cards = [ref, ...cards.filter((c) => c.objectId !== ref.objectId || c.canvasId !== ref.canvasId)].slice(0, MAX_CARD_REFS);
  return true;
}

export interface StudyShard {
  version: 1;
  sourceId?: string;
  concepts: Record<string, StudyConceptRecord>;
}

export interface StudyIndex {
  version: 1;
  shards: Record<string, { concepts: number; updatedAt: number }>;
}

// ── Keys ────────────────────────────────────────────────────────────────────

export const studyIndexKey = (workspaceId: string) => `study.${workspaceId}`;
/** A shard's id in the index: the source id, or `local:<canvasId>`. */
export const localShardId = (canvasId: string) => `local:${canvasId}`;
export function studyShardKey(workspaceId: string, shardId: string): string {
  return shardId.startsWith("local:") ? `study.${workspaceId}.local.${shardId.slice("local:".length)}` : `study.${workspaceId}.${shardId}`;
}
/** The shard a concept is stored in. */
export const shardIdOf = (concept: Concept, canvasId: string) => (concept.local ? localShardId(canvasId) : concept.sourceId);

// ── Lenient readers ─────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const STATES: readonly StudyState[] = ["source_changed", "needs_review", "retired"];
const REASONS: readonly StudyReason[] = ["narrowed", "lineage_gap", "source_missing"];
const RELATIONS: readonly Relation[] = ["split_from", "merged_from", "overlaps"];

function readAttempt(v: unknown): Attempt | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [at, kind, correct, flags] = v as unknown[];
  if (!isNum(at) || (kind !== "q" && kind !== "f") || (correct !== 0 && correct !== 1) || !isNum(flags)) return null;
  return [at, kind, correct, flags | 0];
}

function readConcept(v: unknown): StudyConceptRecord | null {
  if (!isObj(v) || !Array.isArray(v.attempts)) return null;
  const attempts = v.attempts.map(readAttempt).filter((a): a is Attempt => a !== null).slice(-MAX_ATTEMPTS);
  const out: StudyConceptRecord = { title: typeof v.title === "string" ? v.title.slice(0, MAX_TITLE) : "", attempts };
  if (Array.isArray(v.units)) {
    const units = v.units.filter((u): u is string => typeof u === "string");
    if (units.length) out.units = units;
  }
  if (isNum(v.sourceVersion)) out.sourceVersion = v.sourceVersion;
  if (isNum(v.freshSince)) out.freshSince = v.freshSince;
  if (STATES.includes(v.state as StudyState)) out.state = v.state as StudyState;
  if (REASONS.includes(v.reason as StudyReason)) out.reason = v.reason as StudyReason;
  if (typeof v.carriedFrom === "string") out.carriedFrom = v.carriedFrom;
  if (Array.isArray(v.related)) {
    const related = v.related.filter((r): r is { key: string; rel: Relation } => isObj(r) && typeof r.key === "string" && RELATIONS.includes(r.rel as Relation)).map((r) => ({ key: r.key, rel: r.rel }));
    if (related.length) out.related = related;
  }
  const cs = v.cardStatus;
  if (isObj(cs) && (cs.status === "open" || cs.status === "none") && isNum(cs.at)) out.cardStatus = { status: cs.status, at: cs.at, ...(isNum(cs.version) ? { version: cs.version } : {}) };
  if (Array.isArray(v.cards)) {
    const cards = v.cards
      .filter((c): c is StudyCardRef => isObj(c) && typeof c.objectId === "string" && !!c.objectId && typeof c.canvasId === "string" && !!c.canvasId)
      .slice(0, MAX_CARD_REFS)
      .map((c) => ({ objectId: c.objectId, canvasId: c.canvasId }));
    if (cards.length) out.cards = cards;
  }
  return out;
}

/** A stored shard read leniently: malformed concepts and attempts dropped, never thrown. */
export function readStudyShard(raw: unknown): StudyShard | null {
  if (!isObj(raw) || !isObj(raw.concepts)) return null;
  const concepts: Record<string, StudyConceptRecord> = {};
  for (const [key, v] of Object.entries(raw.concepts)) {
    if (!key) continue;
    const c = readConcept(v);
    if (c) concepts[key] = c;
  }
  return { version: 1, ...(typeof raw.sourceId === "string" ? { sourceId: raw.sourceId } : {}), concepts };
}

/** A stored index read leniently. */
export function readStudyIndex(raw: unknown): StudyIndex | null {
  if (!isObj(raw) || !isObj(raw.shards)) return null;
  const shards: StudyIndex["shards"] = {};
  for (const [id, v] of Object.entries(raw.shards)) if (id && isObj(v) && isNum(v.concepts) && isNum(v.updatedAt)) shards[id] = { concepts: v.concepts, updatedAt: v.updatedAt };
  return { version: 1, shards };
}

const emptyShard = (shardId: string): StudyShard => ({ version: 1, ...(shardId.startsWith("local:") ? {} : { sourceId: shardId }), concepts: {} });

async function getShard(meta: MetaRepository, workspaceId: string, shardId: string): Promise<StudyShard | null> {
  return readStudyShard(await meta.get<unknown>(studyShardKey(workspaceId, shardId)));
}
async function getIndex(meta: MetaRepository, workspaceId: string): Promise<StudyIndex> {
  return readStudyIndex(await meta.get<unknown>(studyIndexKey(workspaceId))) ?? { version: 1, shards: {} };
}

// ── Serialised writes ───────────────────────────────────────────────────────

const chains = new WeakMap<MetaRepository, Map<string, Promise<unknown>>>();

/** Runs `fn` after every earlier write of this workspace (on this repository) has settled. */
function serialised<T>(meta: MetaRepository, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  let byWs = chains.get(meta);
  if (!byWs) chains.set(meta, (byWs = new Map()));
  const prev = byWs.get(workspaceId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => undefined);
  byWs.set(workspaceId, settled);
  void settled.then(() => byWs!.get(workspaceId) === settled && byWs!.delete(workspaceId));
  return next;
}

/** Resolves once every write queued so far for the workspace has settled (tests, and a flush before reading). */
export function studyWritesSettled(meta: MetaRepository, workspaceId: string): Promise<void> {
  return serialised(meta, workspaceId, async () => undefined);
}

// ── Bounds ──────────────────────────────────────────────────────────────────

const lastAt = (r: StudyConceptRecord) => r.attempts.reduce((m, a) => Math.max(m, a[0]), Number.NEGATIVE_INFINITY);

/** Eviction order: retired first, then least recently attempted, then the key (stable). */
function evictionOrder(a: { key: string; r: StudyConceptRecord }, b: { key: string; r: StudyConceptRecord }): number {
  const ra = a.r.state === "retired" ? 0 : 1;
  const rb = b.r.state === "retired" ? 0 : 1;
  return ra - rb || lastAt(a.r) - lastAt(b.r) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Drops concepts beyond `max` from a shard in eviction order, never `keep`. Returns the evicted keys. */
export function boundShard(shard: StudyShard, max = MAX_SHARD_CONCEPTS, keep?: string): string[] {
  const keys = Object.keys(shard.concepts);
  if (keys.length <= max) return [];
  const victims = keys
    .filter((k) => k !== keep)
    .map((key) => ({ key, r: shard.concepts[key]! }))
    .sort(evictionOrder)
    .slice(0, keys.length - max)
    .map((v) => v.key);
  for (const k of victims) delete shard.concepts[k];
  return victims;
}

// ── Relations (§4: display only, never merged) ─────────────────────────────

function relate(shard: StudyShard, key: string, rec: StudyConceptRecord): void {
  if (!rec.units?.length) return;
  const mine = new Set(rec.units);
  const related: { key: string; rel: Relation }[] = [];
  for (const [other, o] of Object.entries(shard.concepts)) {
    if (other === key || !o.units?.length || o.sourceVersion !== rec.sourceVersion) continue;
    const theirs = new Set(o.units);
    const shared = [...mine].filter((u) => theirs.has(u)).length;
    if (!shared) continue;
    if (shared === mine.size && mine.size < theirs.size) related.push({ key: other, rel: "split_from" });
    else if (shared === theirs.size && theirs.size < mine.size) related.push({ key: other, rel: "merged_from" });
    else if (shared / new Set([...mine, ...theirs]).size >= 0.5) related.push({ key: other, rel: "overlaps" });
  }
  if (related.length) rec.related = related.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function addRelated(rec: StudyConceptRecord, key: string, rel: Relation): void {
  if (rec.related?.some((r) => r.key === key && r.rel === rel)) return;
  rec.related = [...(rec.related ?? []), { key, rel }];
}

// ── Recording ───────────────────────────────────────────────────────────────

export interface AttemptInput {
  concept: Concept;
  /** The canvas the card is on (the shard of a local concept). */
  canvasId: string;
  title: string;
  kind: "quiz" | "flashcard";
  correct: boolean;
  /** The card had an open review: stored with flags bit0, and the band is capped at `learning` (§7, issue A). */
  unverified?: boolean;
  /** The card answered (its canvas object id), remembered in `cards`. */
  objectId?: string;
  at: number;
}

/**
 * Records one attempt: one `set` on that concept's shard (and the index when the shard's concept count changed).
 * Studying clears `source_changed` (stale attempts stay stale) and, on a card with no open review, `needs_review`.
 * Resolves to the concept's record as stored.
 */
export function recordAttempt(meta: MetaRepository, workspaceId: string, input: AttemptInput): Promise<StudyConceptRecord> {
  return serialised(meta, workspaceId, async () => {
    const shardId = shardIdOf(input.concept, input.canvasId);
    const key = input.concept.key;
    const had = await getShard(meta, workspaceId, shardId);
    const shard = had ?? emptyShard(shardId);
    const before = Object.keys(shard.concepts).length;
    const existing = shard.concepts[key];
    const rec: StudyConceptRecord = existing ?? { title: "", attempts: [] };
    if (rec.state === "retired") {
      // Studied again after retirement (its source came back under the same id, or its units did): the old answers
      // were about the retired concept. They stay, for the record, but stale — never counted for the new start.
      rec.attempts = markStale(rec.attempts);
      rec.freshSince = input.at;
      delete rec.state;
      delete rec.reason;
      delete rec.related;
      if (!input.concept.local) {
        rec.units = sortUnits(input.concept.units);
        rec.sourceVersion = input.concept.sourceVersion;
      }
    }
    const kind: AttemptKind = input.kind === "quiz" ? "q" : "f";
    rec.attempts = [...rec.attempts, [input.at, kind, input.correct ? 1 : 0, input.unverified ? FLAG_UNVERIFIED : 0] as Attempt].slice(-MAX_ATTEMPTS);
    rec.title = input.title.slice(0, MAX_TITLE);
    rec.cardStatus = { status: input.unverified ? "open" : "none", at: input.at, ...(input.concept.local ? {} : { version: input.concept.sourceVersion }) };
    noteCard(rec, input.objectId ? { objectId: input.objectId, canvasId: input.canvasId } : undefined);
    if (!input.concept.local) {
      if (!rec.units?.length) rec.units = sortUnits(input.concept.units);
      // Never downgrade: a card citing an older version of the same units leaves the remapped version in place.
      rec.sourceVersion = Math.max(rec.sourceVersion ?? 0, input.concept.sourceVersion);
    }
    if (rec.state === "source_changed" || (rec.state === "needs_review" && !input.unverified)) {
      delete rec.state;
      delete rec.reason;
    }
    shard.concepts[key] = rec;
    if (!existing) relate(shard, key, rec);
    boundShard(shard, MAX_SHARD_CONCEPTS, key);
    const count = Object.keys(shard.concepts).length;

    if (!had || count !== before) {
      // The index first, so a shard is never stored without being listed (and so never left behind by a delete).
      const index = await getIndex(meta, workspaceId);
      index.shards[shardId] = { concepts: count, updatedAt: input.at };
      await meta.set(studyIndexKey(workspaceId), index);
      await meta.set(studyShardKey(workspaceId, shardId), shard);
      const total = Object.values(index.shards).reduce((n, s) => n + s.concepts, 0);
      if (total > MAX_WORKSPACE_CONCEPTS) await boundWorkspace(meta, workspaceId, index, { shardId, key, shard }, input.at);
    } else {
      await meta.set(studyShardKey(workspaceId, shardId), shard);
    }
    return rec;
  });
}

/** The workspace bound: evicts across shards in eviction order (inside the workspace's write chain). */
async function boundWorkspace(meta: MetaRepository, workspaceId: string, index: StudyIndex, current: { shardId: string; key: string; shard: StudyShard }, now: number): Promise<void> {
  const shards = new Map<string, StudyShard>([[current.shardId, current.shard]]);
  for (const id of Object.keys(index.shards)) if (!shards.has(id)) shards.set(id, (await getShard(meta, workspaceId, id)) ?? emptyShard(id));
  const all = [...shards].flatMap(([shardId, s]) => Object.entries(s.concepts).map(([key, r]) => ({ shardId, key, r })));
  const excess = all.length - MAX_WORKSPACE_CONCEPTS;
  if (excess <= 0) return;
  const victims = all.filter((c) => !(c.shardId === current.shardId && c.key === current.key)).sort(evictionOrder).slice(0, excess);
  const touched = new Set<string>();
  for (const v of victims) {
    delete shards.get(v.shardId)!.concepts[v.key];
    touched.add(v.shardId);
  }
  for (const id of touched) {
    const s = shards.get(id)!;
    index.shards[id] = { concepts: Object.keys(s.concepts).length, updatedAt: now };
  }
  await meta.set(studyIndexKey(workspaceId), index);
  for (const id of touched) await meta.set(studyShardKey(workspaceId, id), shards.get(id)!);
}

// ── Card status snapshot (§6, §7) ───────────────────────────────────────────

export interface CardStatusInput {
  concept: Concept;
  canvasId: string;
  /** The card has an open review (`Note.needsReview`). */
  open: boolean;
  /** The card's canvas object id: remembered in the concept's `cards`. */
  objectId?: string;
}

/**
 * Records, for concepts already studied, whether the card teaching them has an open review now, and which cards teach
 * them. Writes only the shards whose snapshot changed (status, version or cards), so opening Study repeatedly doesn't
 * rewrite anything. Never creates a concept.
 *
 * The input is every card of the canvases it names, so a remembered card of those canvases that now teaches another
 * concept, or is gone, is dropped from the concepts of the shards it touches.
 */
export function snapshotCardStatus(meta: MetaRepository, workspaceId: string, cards: readonly CardStatusInput[], at: number): Promise<number> {
  return serialised(meta, workspaceId, async () => {
    const byShard = new Map<string, CardStatusInput[]>();
    const teaches = new Map<string, string>();
    const canvases = new Set<string>();
    for (const c of cards) {
      const id = shardIdOf(c.concept, c.canvasId);
      byShard.set(id, [...(byShard.get(id) ?? []), c]);
      canvases.add(c.canvasId);
      if (c.objectId) teaches.set(`${c.canvasId}|${c.objectId}`, c.concept.key);
    }
    let written = 0;
    for (const [shardId, list] of byShard) {
      const shard = await getShard(meta, workspaceId, shardId);
      if (!shard) continue;
      let changed = false;
      for (const [key, rec] of Object.entries(shard.concepts)) {
        if (!rec.cards) continue;
        const kept = rec.cards.filter((r) => !canvases.has(r.canvasId) || teaches.get(`${r.canvasId}|${r.objectId}`) === key);
        if (kept.length === rec.cards.length) continue;
        if (kept.length) rec.cards = kept;
        else delete rec.cards;
        changed = true;
      }
      for (const c of list) {
        const rec = shard.concepts[c.concept.key];
        if (!rec) continue;
        if (noteCard(rec, c.objectId ? { objectId: c.objectId, canvasId: c.canvasId } : undefined)) changed = true;
        const status = c.open ? "open" : "none";
        const version = c.concept.local ? undefined : c.concept.sourceVersion;
        if (rec.cardStatus?.status === status && rec.cardStatus.version === version) continue;
        rec.cardStatus = { status, at, ...(version !== undefined ? { version } : {}) };
        changed = true;
      }
      if (changed) {
        await meta.set(studyShardKey(workspaceId, shardId), shard);
        written++;
      }
    }
    return written;
  });
}

// ── Remap on load (§1, §4) ─────────────────────────────────────────────────

/** What remapping needs of the content sources (`ContentSourceRepository`). */
export interface StudySourceReader {
  get(id: string): Promise<{ latestVersion: number } | null>;
  getVersion(sourceId: string, version: number): Promise<{ lineage?: Lineage } | null>;
}

export interface RemapShardInput {
  /** The source's latest version; ignored when `sourceExists` is false. */
  latestVersion: number;
  lineageOf(toVersion: number): Lineage | undefined;
  sourceExists: boolean;
  now: number;
}

const markStale = (attempts: Attempt[]): Attempt[] => attempts.map((a) => [a[0], a[1], a[2], a[3] | FLAG_STALE] as Attempt);

/**
 * Brings every concept of a source shard to the source's latest version (pure; mutates and returns `shard`, with whether
 * anything changed). Attempts always stay under the key they were made under, except a narrowing that moves the whole
 * record to its new, unused key. Idempotent: a second pass changes nothing.
 */
export function remapShard(shard: StudyShard, input: RemapShardInput): { shard: StudyShard; changed: boolean } {
  const sourceId = shard.sourceId;
  if (!sourceId) return { shard, changed: false };
  let changed = false;
  for (const key of Object.keys(shard.concepts).sort()) {
    const rec = shard.concepts[key];
    if (!rec || !rec.units?.length || rec.sourceVersion === undefined || rec.state === "retired") continue;
    if (input.sourceExists && rec.sourceVersion >= input.latestVersion) continue;
    const r = remapConcept({ key, local: false, sourceId, units: rec.units, sourceVersion: rec.sourceVersion }, { lineageOf: input.lineageOf, targetVersion: input.latestVersion, sourceExists: input.sourceExists });
    if (r.state === "kept") {
      if (r.sourceVersion !== rec.sourceVersion || r.key !== key) {
        rec.sourceVersion = r.sourceVersion;
        rec.units = r.units;
        changed = true;
        if (r.key !== key) moveOrRelate(shard, key, r.key, rec);
      }
      continue;
    }
    if (r.state === "retired" || r.state === "needs_review") {
      if (rec.state !== r.state || rec.reason !== r.reason) {
        rec.state = r.state;
        if (r.reason) rec.reason = r.reason;
        else delete rec.reason;
        changed = true;
      }
      continue;
    }
    // source_changed (with or without narrowing): earlier attempts become stale.
    changed = true;
    rec.attempts = markStale(rec.attempts);
    rec.freshSince = input.now;
    rec.state = "source_changed";
    if (r.reason) rec.reason = r.reason;
    rec.sourceVersion = r.sourceVersion;
    rec.units = r.units;
    if (r.key !== key) moveOrRelate(shard, key, r.key, rec);
  }
  return { shard, changed };
}

/**
 * A concept whose key changed: moved to the new key when it's free; on a collision (§4) the target's own history stays,
 * the old record keeps its old key (and its state), and the target gets `merged_from` the old key. Never merged.
 */
function moveOrRelate(shard: StudyShard, from: string, to: string, rec: StudyConceptRecord): void {
  const target = shard.concepts[to];
  if (target) {
    addRelated(target, from, "merged_from");
    if (!rec.state) rec.state = "source_changed";
    return;
  }
  delete shard.concepts[from];
  shard.concepts[to] = { ...rec, carriedFrom: from };
}

// ── Loading ─────────────────────────────────────────────────────────────────

export interface LoadedConcept {
  key: string;
  shardId: string;
  record: StudyConceptRecord;
}

export interface LoadStudyOptions {
  /** The shards to load; default: every shard the workspace index lists. */
  shards?: readonly string[];
  /** When given, source shards are remapped to their sources' latest versions (and written back if that changed them). */
  sources?: StudySourceReader;
  now: number;
}

/** The study history of a workspace (or some of its shards), remapped, by concept key. */
export function loadStudy(meta: MetaRepository, workspaceId: string, options: LoadStudyOptions): Promise<Map<string, LoadedConcept>> {
  return serialised(meta, workspaceId, async () => {
    const ids = options.shards ? [...new Set(options.shards)] : Object.keys((await getIndex(meta, workspaceId)).shards);
    const out = new Map<string, LoadedConcept>();
    let index: StudyIndex | null = null;
    for (const shardId of ids.sort()) {
      const shard = await getShard(meta, workspaceId, shardId);
      if (!shard) continue;
      if (options.sources && shard.sourceId) {
        const { changed } = await remapFromSources(shard, options.sources, options.now);
        if (changed) {
          await meta.set(studyShardKey(workspaceId, shardId), shard);
          index ??= await getIndex(meta, workspaceId);
          index.shards[shardId] = { concepts: Object.keys(shard.concepts).length, updatedAt: options.now };
        }
      }
      for (const [key, record] of Object.entries(shard.concepts)) out.set(key, { key, shardId, record });
    }
    if (index) await meta.set(studyIndexKey(workspaceId), index);
    return out;
  });
}

async function remapFromSources(shard: StudyShard, sources: StudySourceReader, now: number): Promise<{ changed: boolean }> {
  const sourceId = shard.sourceId!;
  const source = await sources.get(sourceId);
  const versions = Object.values(shard.concepts)
    .map((r) => r.sourceVersion)
    .filter((v): v is number => v !== undefined);
  if (!versions.length) return { changed: false };
  const latest = source?.latestVersion ?? 0;
  const lineages = new Map<number, Lineage | undefined>();
  if (source) for (let v = Math.min(...versions) + 1; v <= latest; v++) lineages.set(v, (await sources.getVersion(sourceId, v))?.lineage);
  return remapShard(shard, { latestVersion: latest, lineageOf: (v) => lineages.get(v), sourceExists: !!source, now });
}

// ── Deletion (Settings "Clear study history", issue C) ─────────────────────

/** Deletes a workspace's study history: every shard its index lists, then the index. */
export function clearStudy(meta: MetaRepository, workspaceId: string): Promise<void> {
  return serialised(meta, workspaceId, async () => {
    const index = await getIndex(meta, workspaceId);
    for (const shardId of Object.keys(index.shards)) await meta.delete(studyShardKey(workspaceId, shardId));
    await meta.delete(studyIndexKey(workspaceId));
  });
}

/**
 * The source was deleted (decision 2026-11-15, option a: deletion must not erase audit history). Every concept of its
 * shard is retired as `source_missing`; attempts, the shard and its index entry stay. Retired concepts are hidden behind
 * "Show retired (n)" and are the first evicted by the normal bounds; "Clear study history" (`clearStudy`) still wipes
 * them. Returns how many concepts were newly retired.
 */
export function retireStudySource(meta: MetaRepository, workspaceId: string, sourceId: string, now: number): Promise<number> {
  return serialised(meta, workspaceId, async () => {
    const shard = await getShard(meta, workspaceId, sourceId);
    if (!shard) return 0;
    let retired = 0;
    for (const rec of Object.values(shard.concepts)) {
      if (rec.state === "retired") continue;
      rec.state = "retired";
      rec.reason = "source_missing";
      retired++;
    }
    if (!retired) return 0;
    await meta.set(studyShardKey(workspaceId, sourceId), shard);
    const index = await getIndex(meta, workspaceId);
    index.shards[sourceId] = { concepts: Object.keys(shard.concepts).length, updatedAt: now };
    await meta.set(studyIndexKey(workspaceId), index);
    return retired;
  });
}

/** Deletes one source's study shard and its index entry. Not called on a source delete (see `retireStudySource`). */
export function clearStudySource(meta: MetaRepository, workspaceId: string, sourceId: string): Promise<void> {
  return serialised(meta, workspaceId, async () => {
    await meta.delete(studyShardKey(workspaceId, sourceId));
    const index = await getIndex(meta, workspaceId);
    if (!(sourceId in index.shards)) return;
    delete index.shards[sourceId];
    await meta.set(studyIndexKey(workspaceId), index);
  });
}
