/**
 * `search_workspace` (F21): deterministic, bounded text search over one
 * workspace — page titles and bodies, canvas titles, block text (text, todo
 * items, table cells, code), shape labels and free canvas text. No model.
 *
 * Backed by F22's `WorkspaceIndex` (`src/search/workspaceIndex.ts`), kept per
 * MCP session: every call brings it up to date with the persisted workspace
 * (capped), and only objects whose change stamp moved are re-indexed. Text is
 * redacted like the in-app index, so a pasted credential is neither found nor
 * returned in a snippet.
 *
 * Matching is the index's `all` mode: the query is split into up to 8 words
 * (case-insensitive), and an item matches when every word appears in its
 * title or text. Score: word occurrences in the text (each capped), +5 per
 * word in the title, +10 when the whole query appears as a phrase. Ties keep
 * scan order (pages, then canvases in workspace order, then objects in
 * z-order), so equal input always gives the same result.
 */
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { queryWords as rankedQueryWords } from "@/search/ranking";
import { WorkspaceIndex, type IndexHit } from "@/search/workspaceIndex";
import { isStandalone } from "../context/currentContext";
import { sortPages } from "../resources/serializers";
import { resourceUri } from "../resources/uris";
import type { WorkspaceScan } from "../resources/workspaceScan";

export const SEARCH_LIMITS = {
  queryChars: 200,
  words: 8,
  defaultResults: 20,
  maxResults: 50,
  /** What one search reads at most. */
  canvases: 100,
  objectsPerCanvas: 2_000,
  pages: 1_000,
  /** Text of one item that is searched (the rest is ignored). */
  textChars: 50_000,
  title: 200,
  /** Occurrences of one word counted per item. */
  occurrences: 20,
} as const;

/** Kinds a search can be narrowed to; "shape" covers rectangles, diamonds and ellipses. */
export const SEARCH_KINDS = ["page", "canvas", "text", "todo", "table", "code", "note", "shape"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchHit {
  id: string;
  kind: string;
  title?: string;
  canvasId?: string;
  canvasUri?: string;
  uri?: string;
  /** Text around the best match in the content ("…before match after…"), when the content matched. */
  snippet?: string;
  score: number;
  /** Occurrences of the query's words in the title and text (each word capped). */
  matches: number;
}

export interface SearchResult {
  query: string;
  words: string[];
  hits: SearchHit[];
  /** Everything that matched (hits are the best `limit` of them). */
  total: number;
  /** Results were cut to `limit`, or part of the workspace wasn't read (caps). */
  truncated: boolean;
}

/** The query's distinct lower-case words, at most `SEARCH_LIMITS.words` (the shared ranking's split, F22). */
export const queryWords = rankedQueryWords;

/** A search index over one workspace's persisted state, kept across calls of one MCP session. */
export class McpSearchIndex {
  private readonly index: WorkspaceIndex;
  /** The record object last indexed per document id: reused while `updatedAt` is unchanged, so the index sees it as unchanged. */
  private readonly records = new Map<string, DocumentRecord>();
  private readonly pageCanvas = new Map<string, string>();
  private indexedCanvases = new Set<string>();
  /** Refreshes run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly scan: WorkspaceScan) {
    this.index = new WorkspaceIndex(scan.workspaceId);
  }

  /** Brings the index up to date with the persisted workspace, within the caps. */
  refresh(): Promise<{ partial: boolean; reindexed: number }> {
    const run = this.queue.then(() => this.sync());
    this.queue = run.catch(() => undefined);
    return run;
  }

  async search(query: string, options: { limit?: number; kinds?: readonly SearchKind[] } = {}): Promise<SearchResult> {
    const { partial } = await this.refresh();
    const limit = Math.min(options.limit ?? SEARCH_LIMITS.defaultResults, SEARCH_LIMITS.maxResults);
    const result = this.index.query({ text: query, limit, ...(options.kinds?.length ? { kinds: options.kinds } : {}) });
    return { query, words: result.words, hits: result.hits.map((h) => this.hitOf(h)), total: result.total, truncated: result.truncated || partial };
  }

  private async sync(): Promise<{ partial: boolean; reindexed: number }> {
    let partial = false;
    let reindexed = 0;

    const pages = sortPages(await this.scan.pages());
    if (pages.length > SEARCH_LIMITS.pages) partial = true;
    const listed = pages.slice(0, SEARCH_LIMITS.pages).map((p) => this.stable(p));
    this.pageCanvas.clear();
    for (const p of listed) if (p.canvasId) this.pageCanvas.set(p.id, p.canvasId);

    const allCanvases = await this.scan.canvases();
    if (allCanvases.length > SEARCH_LIMITS.canvases) partial = true;
    const canvases = allCanvases.slice(0, SEARCH_LIMITS.canvases);
    this.index.setCanvases(canvases);

    const seen = new Set<string>();
    for (const canvas of canvases) {
      seen.add(canvas.id);
      const scene = await this.scan.scene(canvas.id);
      const standalone = scene.filter(isStandalone);
      let elements: readonly SceneElement[] = scene;
      if (standalone.length > SEARCH_LIMITS.objectsPerCanvas) {
        partial = true;
        const keep = new Set(standalone.slice(0, SEARCH_LIMITS.objectsPerCanvas).map((el) => el.id));
        elements = scene.filter((el) => !isStandalone(el) || keep.has(el.id));
      }
      const docIds: string[] = [];
      for (const el of elements) {
        const ref = el.isDeleted ? null : getEmbedRef(el);
        if (ref?.kind === "rich-block") docIds.push(ref.documentId);
      }
      const docs = await this.scan.documents(docIds);
      const get = (id: string) => {
        const rec = docs.get(id);
        return rec && this.stable(rec);
      };
      reindexed += this.index.syncScene(canvas.id, elements, get);
    }
    for (const id of this.indexedCanvases) if (!seen.has(id)) this.index.removeScene(id);
    this.indexedCanvases = seen;

    // Only pages are indexed as documents: a block is found as the canvas object that shows it.
    reindexed += this.index.syncDocuments(listed);
    if (this.index.partial) partial = true;
    return { partial, reindexed };
  }

  private stable(rec: DocumentRecord): DocumentRecord {
    const known = this.records.get(rec.id);
    if (known && known.updatedAt === rec.updatedAt) return known;
    this.records.set(rec.id, rec);
    return rec;
  }

  private hitOf(h: IndexHit): SearchHit {
    const canvasId = h.kind === "page" ? this.pageCanvas.get(h.id) : h.kind === "canvas" ? undefined : h.ref.canvasId;
    const uri =
      h.kind === "page" || h.kind === "canvas" ? resourceUri(h.kind, h.id) : h.kind === "todo" || h.kind === "table" ? resourceUri(h.kind, h.id) : undefined;
    return {
      id: h.id,
      kind: h.kind,
      ...(h.title ? { title: h.title } : {}),
      ...(canvasId ? { canvasId, canvasUri: resourceUri("canvas", canvasId) } : {}),
      ...(uri ? { uri } : {}),
      ...(h.snippet ? { snippet: h.snippet } : {}),
      score: h.score,
      matches: h.matches,
    };
  }
}
