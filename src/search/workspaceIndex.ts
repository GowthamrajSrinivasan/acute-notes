/**
 * Workspace search index (F22, PRD "F22 — Semantic Search and AI Context
 * Retrieval"): lightweight, deterministic, local. Indexes pages, rich blocks
 * (text, todo, table, code), shape labels, free canvas text, canvases and
 * typed/labelled relationships, and answers keyword (`all`) or retrieval
 * (`any`) queries with stable object references and relevance metadata —
 * never copied renderer state.
 *
 * Incremental: `planScene` / `planDocuments` compare each object's change
 * stamp (element version, bound label, document identity) with what is
 * indexed and return one small unit of work per changed object, so a caller
 * can run them in idle time (`IndexScheduler`) and a one-element edit costs
 * one re-index, not a rebuild. `syncScene` / `syncDocuments` run a plan
 * immediately (tests, catch-up before a query).
 *
 * Bounded: text per object (`INDEX_LIMITS.textChars`), objects per index
 * (`INDEX_LIMITS.entries`), results per query. Everything indexed passes
 * through `redactSecrets`, so a pasted credential can neither be found nor
 * returned in a snippet.
 *
 * Adapter boundary: `SearchIndex` is the query surface consumers use; a
 * later embedding/vector tier can implement it (or wrap this one) without
 * touching the context builder.
 */
import { redactSecrets } from "@/ai/context/redact";
import { itemFromElement, labelsOf } from "@/ai/context/selectionContext";
import { getArrowRelation, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { isEmptyContent, isTableContent, toPlainText } from "@/domain/content/richContent";
import type { DocumentRecord, RelationType, RichContent } from "@/domain/types";
import { idf, matchWords, phraseOf, queryWords, questionTerms, rankInput, scoreAll, scoreAny, snippetOf, type RankInput, type Scored } from "./ranking";

export const INDEX_LIMITS = {
  /** Objects held at most (beyond it the index is `partial`). */
  entries: 25_000,
  textChars: 50_000,
  title: 200,
  defaultResults: 20,
  maxResults: 50,
} as const;

/** What an object is. Shapes keep their element type, like MCP `search_workspace`. */
export type IndexKind = "page" | "canvas" | "text" | "todo" | "table" | "code" | "note" | "rectangle" | "diamond" | "ellipse" | "relation";

/** "shape" covers the shape kinds; "relation" is only searched when asked for. */
export type IndexKindFilter = IndexKind | "shape";

const SHAPES = new Set<string>(["rectangle", "diamond", "ellipse"]);

/** A stable reference to an object: resolve it through the repositories or the scene, never from the index. */
export interface ObjectRef {
  workspaceId: string;
  canvasId?: string;
  /** The canvas element (objects on a canvas, previews of a page, arrows). */
  elementId?: string;
  documentId?: string;
  pageId?: string;
  blockId?: string;
}

export interface IndexedObject {
  /** Element id for canvas objects, document id for pages and off-canvas blocks, canvas id for canvases. */
  id: string;
  kind: IndexKind;
  ref: ObjectRef;
  title?: string;
  /** Indexed text: bounded and redacted. */
  text: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface RelationEdge {
  arrowId: string;
  canvasId: string;
  from: string;
  to: string;
  type?: RelationType;
  label?: string;
}

export interface IndexQuery {
  text: string;
  /** `all` (default): every word must match. `any`: natural-language retrieval, terms weighted by rarity. */
  mode?: "all" | "any";
  limit?: number;
  kinds?: readonly IndexKindFilter[];
  /** Only objects on this canvas (its elements, its blocks and pages, pages previewed on it). */
  canvasId?: string;
  /** Ids to leave out: entry ids, element ids or document ids. */
  exclude?: ReadonlySet<string>;
  /** `any` mode: at least this many distinct terms must match (default 1). */
  minMatched?: number;
}

export interface IndexHit {
  id: string;
  kind: IndexKind;
  ref: ObjectRef;
  title?: string;
  /** Text around the best match, when the text matched. */
  snippet?: string;
  score: number;
  matches: number;
  /** The query terms this object matched, in query order. */
  matchedTerms: string[];
}

export interface IndexResult {
  query: string;
  words: string[];
  hits: IndexHit[];
  total: number;
  /** Results were cut to the limit, or the index is partial. */
  truncated: boolean;
}

/** The query surface consumers depend on (the adapter boundary for a later vector tier). */
export interface SearchIndex {
  readonly workspaceId: string;
  query(q: IndexQuery): IndexResult;
  get(id: string): IndexedObject | undefined;
  relations(canvasId?: string): readonly RelationEdge[];
  /** Workspace-wide document frequency of a term (for picking distinctive terms). */
  frequency(term: string): number;
  readonly size: number;
}

/** A small, self-contained piece of indexing work. */
export type WorkUnit = () => void;

interface Entry extends IndexedObject {
  rank: RankInput;
  tokens: string[];
  /** Sort group: 0 pages, 1 canvases, 2 canvas objects, 3 off-canvas blocks, 4 relations. */
  group: number;
  /** Position within the group: -updatedAt for pages, canvas position, z-order for objects. */
  position: number;
}

type GetDocument = (id: string) => DocumentRecord | null | undefined;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TOKEN = /[\p{L}\p{N}]+/gu;

function tokensOf(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.match(TOKEN) ?? []) out.add(m);
  return [...out];
}

/** Block type of a document with no canvas element to say it (off-canvas blocks), from its content. */
export function inferBlockKind(snapshot: RichContent): "text" | "todo" | "table" | "code" {
  const top = snapshot.filter((b) => !(b.type === "paragraph" && !toPlainText([b]).trim()));
  if (top.length && top.every((b) => b.type === "checkListItem")) return "todo";
  if (top.length === 1 && isTableContent(top[0]!.content)) return "table";
  if (top.length === 1 && top[0]!.type === "codeBlock") return "code";
  return "text";
}

function titleOfDocument(rec: DocumentRecord): string | undefined {
  const title = rec.title.trim();
  return title && title !== "Untitled" ? title : undefined;
}

const bound = (text: string) => redactSecrets(text.slice(0, INDEX_LIMITS.textChars));
const boundTitle = (title: string | undefined) => (title ? redactSecrets(title).slice(0, INDEX_LIMITS.title) : undefined);

export class WorkspaceIndex implements SearchIndex {
  private readonly entries = new Map<string, Entry>();
  /** Change stamp last indexed, per id — kept also for objects that produced no entry (empty blocks). */
  private readonly stamps = new Map<string, string>();
  private readonly vocab = new Map<string, Set<string>>();
  /** Per canvas: element ids indexed from its scene. */
  private readonly sceneIds = new Map<string, Set<string>>();
  /** Per canvas: document/page id → element that shows it. */
  private readonly embeds = new Map<string, Map<string, string>>();
  private readonly edges = new Map<string, RelationEdge[]>();
  private readonly canvasOrder = new Map<string, number>();
  private readonly documentIds = new Set<string>();
  private readonly recordStamps = new WeakMap<object, number>();
  private nextStamp = 1;
  /** Some objects were not indexed because `INDEX_LIMITS.entries` was reached. */
  partial = false;
  /** Bumped on every change to the indexed content. */
  version = 0;

  constructor(readonly workspaceId: string) {}

  get size(): number {
    return this.entries.size;
  }

  get(id: string): IndexedObject | undefined {
    const e = this.entries.get(id);
    return e && publicView(e);
  }

  /** Arrows bound at both ends, per canvas (all indexed canvases when omitted), in z-order. */
  relations(canvasId?: string): readonly RelationEdge[] {
    if (canvasId) return this.edges.get(canvasId) ?? [];
    return [...this.edges.values()].flat();
  }

  frequency(term: string): number {
    return this.vocab.get(term.toLowerCase())?.size ?? 0;
  }

  /** The element showing document or page `id` (on `canvasId`, or any indexed canvas). */
  elementFor(id: string, canvasId?: string): { canvasId: string; elementId: string } | undefined {
    if (canvasId) {
      const elementId = this.embeds.get(canvasId)?.get(id);
      return elementId ? { canvasId, elementId } : undefined;
    }
    for (const [c, map] of this.embeds) {
      const elementId = map.get(id);
      if (elementId) return { canvasId: c, elementId };
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  /** The workspace's canvases, in workspace order: their titles are searchable and their order breaks ties. */
  setCanvases(canvases: readonly { id: string; title: string }[]): void {
    const keep = new Set(canvases.map((c) => c.id));
    for (const [id, e] of this.entries) if (e.kind === "canvas" && !keep.has(id)) this.remove(id);
    this.canvasOrder.clear();
    canvases.forEach((c, i) => {
      this.canvasOrder.set(c.id, i);
      const stamp = `canvas:${c.title}`;
      if (this.stamps.get(c.id) === stamp) {
        const e = this.entries.get(c.id);
        if (e) e.position = i;
        return;
      }
      this.stamps.set(c.id, stamp);
      this.put({ id: c.id, kind: "canvas", ref: { workspaceId: this.workspaceId, canvasId: c.id }, title: boundTitle(c.title.trim() || "Untitled"), text: "" }, 1, i);
    });
  }

  /**
   * Work to bring one canvas's scene up to date. Cheap and synchronous
   * itself (one pass comparing change stamps; structural maps — embeds,
   * relationships, z-order — are refreshed here); the returned units do the
   * text work, one changed object each.
   */
  planScene(canvasId: string, elements: readonly SceneElement[], getDocument: GetDocument): WorkUnit[] {
    const labels = labelsOf(elements);
    const units: WorkUnit[] = [];
    const seen = new Set<string>();
    const embeds = new Map<string, string>();
    const edges: RelationEdge[] = [];
    let z = 0;
    for (const el of elements) {
      z++;
      if (el.isDeleted) continue;
      if (el.type === "arrow") {
        const from = el.startBinding?.elementId;
        const to = el.endBinding?.elementId;
        if (!from || !to) continue;
        const type = getArrowRelation(el);
        const label = labels.get(el.id)?.trim() || undefined;
        edges.push({ arrowId: el.id, canvasId, from, to, ...(type ? { type } : {}), ...(label ? { label: redactSecrets(label) } : {}) });
        if (!type && !label) continue;
        seen.add(el.id);
        this.track(el.id, `rel:${type ?? ""}|${label ?? ""}|${from}|${to}`, z, units, () =>
          this.put(
            {
              id: el.id,
              kind: "relation",
              ref: { workspaceId: this.workspaceId, canvasId, elementId: el.id },
              text: bound([type?.replace(/_/g, " "), label].filter(Boolean).join(" ")),
            },
            4,
            z,
          ),
        );
        continue;
      }
      if (el.type === "line" || (el.type === "text" && el.containerId)) continue;
      const ref = getEmbedRef(el);
      if (ref?.kind === "page-preview") {
        // Found as its page, never twice.
        if (!embeds.has(ref.pageId)) embeds.set(ref.pageId, el.id);
        continue;
      }
      let docStamp = "";
      if (ref?.kind === "rich-block") {
        if (!embeds.has(ref.documentId)) embeds.set(ref.documentId, el.id);
        docStamp = this.stampOf(getDocument(ref.documentId));
      } else if (el.type !== "text" && !SHAPES.has(el.type)) {
        continue;
      }
      seen.add(el.id);
      const version = (el as { version?: number }).version;
      const stamp = `el:${version ?? `${el.type}:${el.originalText ?? el.text ?? ""}`}|${labels.get(el.id) ?? ""}|${docStamp}`;
      const at = z;
      this.track(el.id, stamp, z, units, () => this.indexElement(canvasId, el, labels, getDocument, at));
    }
    this.embeds.set(canvasId, embeds);
    this.edges.set(canvasId, edges);
    const previous = this.sceneIds.get(canvasId);
    // Removals are cheap and done now, so a superseded plan can never leave a deleted object behind.
    if (previous) for (const id of previous) if (!seen.has(id)) this.remove(id);
    this.sceneIds.set(canvasId, seen);
    this.version++;
    return units;
  }

  /** Work to bring pages and blocks up to date with `records` (records absent from it are dropped). */
  planDocuments(records: readonly DocumentRecord[]): WorkUnit[] {
    const units: WorkUnit[] = [];
    const seen = new Set<string>();
    for (const rec of records) {
      if (rec.workspaceId !== this.workspaceId) continue;
      seen.add(rec.id);
      const stamp = `doc:${this.stampOf(rec)}`;
      const position = rec.kind === "page" ? -rec.updatedAt : 0;
      this.track(rec.id, stamp, position, units, () => this.indexDocument(rec));
    }
    for (const id of [...this.documentIds]) if (!seen.has(id)) this.remove(id);
    for (const id of seen) this.documentIds.add(id);
    return units;
  }

  /** Indexes one scene now. */
  syncScene(canvasId: string, elements: readonly SceneElement[], getDocument: GetDocument): number {
    const units = this.planScene(canvasId, elements, getDocument);
    for (const u of units) u();
    return units.length;
  }

  /** Indexes documents now. */
  syncDocuments(records: readonly DocumentRecord[]): number {
    const units = this.planDocuments(records);
    for (const u of units) u();
    return units.length;
  }

  /** Forgets a canvas's scene (e.g. when it is closed); its documents stay indexed as documents. */
  removeScene(canvasId: string): void {
    for (const id of this.sceneIds.get(canvasId) ?? []) this.remove(id);
    this.sceneIds.delete(canvasId);
    this.embeds.delete(canvasId);
    this.edges.delete(canvasId);
    this.version++;
  }

  private stampOf(rec: DocumentRecord | null | undefined): string {
    if (rec === undefined) return "?";
    if (rec === null) return "-";
    let n = this.recordStamps.get(rec);
    if (!n) this.recordStamps.set(rec, (n = this.nextStamp++));
    return String(n);
  }

  /** Queues `work` when `id`'s stamp changed; otherwise only refreshes its position. */
  private track(id: string, stamp: string, position: number, units: WorkUnit[], work: () => void): void {
    if (this.stamps.get(id) === stamp) {
      const e = this.entries.get(id);
      if (e) e.position = position;
      return;
    }
    units.push(() => {
      this.stamps.set(id, stamp);
      work();
    });
  }

  private indexElement(canvasId: string, el: SceneElement, labels: ReadonlyMap<string, string>, getDocument: GetDocument, z: number): void {
    const item = itemFromElement(el, labels, getDocument);
    if (!item) return this.remove(el.id, true);
    const ref = getEmbedRef(el);
    const rec = ref?.kind === "rich-block" ? getDocument(ref.documentId) : undefined;
    this.put(
      {
        id: el.id,
        kind: (item.kind === "shape" ? el.type : item.kind) as IndexKind,
        ref: {
          workspaceId: this.workspaceId,
          canvasId,
          elementId: el.id,
          ...(ref?.kind === "rich-block" ? { documentId: ref.documentId, blockId: ref.documentId } : {}),
        },
        title: boundTitle(item.title),
        text: bound(rec ? toPlainText(rec.snapshot) : item.text),
        ...(rec?.metadata?.tags?.length ? { tags: rec.metadata.tags.slice(0, 20) } : {}),
        ...(rec ? { createdAt: rec.createdAt, updatedAt: rec.updatedAt } : {}),
      },
      2,
      z,
    );
  }

  private indexDocument(rec: DocumentRecord): void {
    if (rec.kind === "block" && isEmptyContent(rec.snapshot)) return this.remove(rec.id, true);
    const isPage = rec.kind === "page";
    this.put(
      {
        id: rec.id,
        kind: isPage ? "page" : inferBlockKind(rec.snapshot),
        ref: {
          workspaceId: this.workspaceId,
          documentId: rec.id,
          ...(isPage ? { pageId: rec.id } : { blockId: rec.id }),
          ...(rec.canvasId ? { canvasId: rec.canvasId } : {}),
        },
        title: boundTitle(isPage ? rec.title.trim() || "Untitled" : titleOfDocument(rec)),
        text: bound(toPlainText(rec.snapshot)),
        ...(rec.metadata?.tags?.length ? { tags: rec.metadata.tags.slice(0, 20) } : {}),
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      },
      isPage ? 0 : 3,
      isPage ? -rec.updatedAt : 0,
    );
  }

  private put(obj: IndexedObject, group: number, position: number): void {
    const existing = this.entries.get(obj.id);
    if (existing) this.unlink(existing);
    else if (this.entries.size >= INDEX_LIMITS.entries) {
      this.partial = true;
      return;
    }
    const rank = rankInput([obj.title, ...(obj.tags ?? [])].filter(Boolean).join(" ") || undefined, obj.text);
    const entry: Entry = { ...obj, rank, tokens: tokensOf(rank.lowerTitle, rank.lowerText), group, position };
    this.entries.set(obj.id, entry);
    for (const t of entry.tokens) {
      let ids = this.vocab.get(t);
      if (!ids) this.vocab.set(t, (ids = new Set()));
      ids.add(obj.id);
    }
    this.version++;
  }

  private remove(id: string, keepStamp = false): void {
    const e = this.entries.get(id);
    if (e) {
      this.unlink(e);
      this.entries.delete(id);
      this.version++;
    }
    if (!keepStamp) {
      this.stamps.delete(id);
      this.documentIds.delete(id);
    }
  }

  private unlink(e: Entry): void {
    for (const t of e.tokens) {
      const ids = this.vocab.get(t);
      if (!ids) continue;
      ids.delete(e.id);
      if (!ids.size) this.vocab.delete(t);
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  query(q: IndexQuery): IndexResult {
    const mode = q.mode ?? "all";
    const limit = Math.max(0, Math.min(q.limit ?? INDEX_LIMITS.defaultResults, INDEX_LIMITS.maxResults));
    const words = mode === "all" ? queryWords(q.text) : questionTerms(q.text);
    const phrase = phraseOf(q.text, words);
    const empty: IndexResult = { query: q.text, words, hits: [], total: 0, truncated: this.partial };
    if (!words.length) return empty;

    const pools = words.map((w) => this.candidatesFor(w));
    let pool: Iterable<string>;
    if (pools.some((p) => p === null)) pool = this.entries.keys();
    else if (mode === "all") pool = intersect(pools as Set<string>[]);
    else pool = union(pools as Set<string>[]);

    const kinds = q.kinds?.length ? new Set<string>(q.kinds) : null;
    const minMatched = Math.max(1, q.minMatched ?? 1);
    const found: { e: Entry; matched: ReturnType<typeof matchWords> }[] = [];
    for (const id of pool) {
      const e = this.entries.get(id);
      if (!e || !this.visible(e, kinds, q.canvasId, q.exclude)) continue;
      const matched = matchWords(e.rank, words);
      if (mode === "all" ? matched.length === words.length : matched.length >= minMatched) found.push({ e, matched });
    }

    let scored: { e: Entry; s: Scored }[];
    if (mode === "all") {
      scored = found.map(({ e }) => ({ e, s: scoreAll(e.rank, words, phrase)! }));
    } else {
      const df = new Map<string, number>();
      for (const { matched } of found) for (const m of matched) df.set(m.word, (df.get(m.word) ?? 0) + 1);
      const n = this.entries.size;
      const weight = (w: string) => idf(n, df.get(w) ?? 1);
      scored = found.map(({ e, matched }) => ({ e, s: scoreAny(e.rank, words, phrase, weight, matched)! }));
    }
    scored.sort((a, b) => (mode === "any" ? b.s.matchedWords.length - a.s.matchedWords.length : 0) || b.s.score - a.s.score || this.compare(a.e, b.e));

    const hits = scored.slice(0, limit).map(({ e, s }): IndexHit => {
      const preview = e.kind === "page" ? this.elementFor(e.id, q.canvasId) : undefined;
      const snippet = snippetOf(e.rank, words, phrase, s.phraseInText);
      return {
        id: e.id,
        kind: e.kind,
        ref: preview ? { ...e.ref, canvasId: preview.canvasId, elementId: preview.elementId } : e.ref,
        ...(e.title ? { title: e.title } : {}),
        ...(snippet ? { snippet } : {}),
        score: s.score,
        matches: s.matches,
        matchedTerms: s.matchedWords,
      };
    });
    return { query: q.text, words, hits, total: scored.length, truncated: scored.length > limit || this.partial };
  }

  /**
   * Entries that can contain `word`: those holding a token containing its
   * longest letter/digit run. Sound because tokens are maximal letter/digit
   * runs, so any occurrence of that run lies inside one token. Null when the
   * word has no letters or digits (every entry is a candidate).
   */
  private candidatesFor(word: string): Set<string> | null {
    const parts = word.match(TOKEN);
    if (!parts) return null;
    const part = parts.reduce((a, b) => (b.length > a.length ? b : a));
    const out = new Set<string>();
    const exact = this.vocab.get(part);
    if (exact) for (const id of exact) out.add(id);
    for (const [token, ids] of this.vocab) {
      if (token.length <= part.length || !token.includes(part)) continue;
      for (const id of ids) out.add(id);
    }
    return out;
  }

  private visible(e: Entry, kinds: ReadonlySet<string> | null, canvasId: string | undefined, exclude: ReadonlySet<string> | undefined): boolean {
    if (kinds ? !kinds.has(SHAPES.has(e.kind) ? "shape" : e.kind) && !kinds.has(e.kind) : e.kind === "relation") return false;
    // A block shown on an indexed canvas is found as that element, never twice.
    if (e.group === 3 && this.elementFor(e.id)) return false;
    if (exclude && (exclude.has(e.id) || (e.ref.documentId && exclude.has(e.ref.documentId)) || (e.ref.elementId && exclude.has(e.ref.elementId)))) return false;
    if (exclude && e.kind === "page") {
      const preview = this.elementFor(e.id, canvasId);
      if (preview && exclude.has(preview.elementId)) return false;
    }
    if (canvasId && e.ref.canvasId !== canvasId && !(e.kind === "page" && this.elementFor(e.id, canvasId))) return false;
    return true;
  }

  private compare(a: Entry, b: Entry): number {
    if (a.group !== b.group) return a.group - b.group;
    if (a.group >= 2) {
      const pa = this.canvasOrder.get(a.ref.canvasId ?? "") ?? Number.MAX_SAFE_INTEGER;
      const pb = this.canvasOrder.get(b.ref.canvasId ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const c = cmp(a.ref.canvasId ?? "", b.ref.canvasId ?? "");
      if (c) return c;
    }
    return a.position - b.position || cmp(a.id, b.id);
  }
}

function publicView(e: Entry): IndexedObject {
  return {
    id: e.id,
    kind: e.kind,
    ref: e.ref,
    ...(e.title ? { title: e.title } : {}),
    text: e.text,
    ...(e.tags ? { tags: e.tags } : {}),
    ...(e.createdAt !== undefined ? { createdAt: e.createdAt } : {}),
    ...(e.updatedAt !== undefined ? { updatedAt: e.updatedAt } : {}),
  };
}

function intersect(sets: Set<string>[]): Set<string> {
  const [smallest, ...rest] = [...sets].sort((a, b) => a.size - b.size);
  const out = new Set<string>();
  for (const id of smallest ?? []) if (rest.every((s) => s.has(id))) out.add(id);
  return out;
}

function union(sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const id of s) out.add(id);
  return out;
}
