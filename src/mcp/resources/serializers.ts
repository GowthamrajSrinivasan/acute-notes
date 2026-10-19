/**
 * MCP resource payloads (F20): pure functions from domain records and scene
 * elements to bounded, JSON-ready objects. No persistence, renderer or React.
 *
 * Every payload:
 * - carries its own `uri`, a typed `kind` and a `version`, and links to other
 *   resources by stable id and URI;
 * - is bounded: lists are capped, text is cut, and `truncated` says when
 *   anything was left out (`counts` give the full sizes);
 * - is built from allow-listed fields only. Element `customData`, AI
 *   connection settings, credentials and conversations are never read, and
 *   provenance only through the sanitizing gate in `../context/currentContext`.
 *
 * Scoping (which workspace a record may come from) is the reader's job
 * (`reader.ts`); these functions also drop records of another workspace
 * defensively.
 */
import { labelsOf } from "@/ai/context/selectionContext";
import { getArrowRelation, type SceneElement } from "@/domain/canvas/adapter";
import { contentToMarkdown } from "@/domain/content/markdown";
import { inlineText, isTableContent } from "@/domain/content/richContent";
import type { AIMetadata, CanvasDocument, ContentBlock, DocumentRecord, RichContent, Workspace } from "@/domain/types";
import { sanitizeContent } from "@/portability/sanitize";
import { cut, describeObject, documentProvenance, isStandalone, type ContextObject, type ContextRelation } from "../context/currentContext";
import { resourceUri } from "./uris";

export const RESOURCE_VERSION = 1;

export const RESOURCE_LIMITS = {
  /** Canvases and pages listed by a workspace (and by `resources/list` per template). */
  canvases: 100,
  pages: 200,
  /** Objects and relations listed by a canvas. */
  objects: 200,
  relations: 300,
  /** Per-object excerpt in a canvas listing (read the object's own resource for more). */
  objectExcerpt: 280,
  title: 200,
  /** A page's Markdown body. */
  pageChars: 20_000,
  todoItems: 200,
  itemChars: 500,
  tableRows: 100,
  tableColumns: 20,
  cellChars: 200,
  /** Total characters of todo items or table cells in one payload. */
  contentChars: 20_000,
  /** Plain text of a table block's non-table content. */
  notesChars: 2_000,
} as const;

type Getter = (id: string) => DocumentRecord | null | undefined;

const title = (t: string, fallback = "Untitled") => cut(t.trim() || fallback, RESOURCE_LIMITS.title).text;
const withProvenance = (p: AIMetadata | undefined) => (p ? { provenance: p } : {});

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface ResourceLink {
  id: string;
  title: string;
  uri: string;
  updatedAt: number;
}

export interface WorkspaceResource {
  uri: string;
  kind: "workspace";
  version: typeof RESOURCE_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** In the workspace's canvas order. */
  canvases: ResourceLink[];
  /** Most recently updated first. */
  pages: (ResourceLink & { canvasId?: string })[];
  counts: { canvases: number; pages: number };
  truncated: boolean;
}

/** `canvases` in any order (the workspace's own order is applied); `pages` are page records. */
export function serializeWorkspace(ws: Workspace, canvases: readonly CanvasDocument[], pages: readonly DocumentRecord[]): WorkspaceResource {
  const byId = new Map(canvases.filter((c) => c.workspaceId === ws.id).map((c) => [c.id, c] as const));
  const ordered = ws.canvasIds.map((id) => byId.get(id)).filter((c): c is CanvasDocument => !!c);
  const ownPages = sortPages(pages.filter((p) => p.kind === "page" && p.workspaceId === ws.id));
  return {
    uri: resourceUri("workspace", ws.id),
    kind: "workspace",
    version: RESOURCE_VERSION,
    id: ws.id,
    name: title(ws.name, ""),
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    canvases: ordered.slice(0, RESOURCE_LIMITS.canvases).map(canvasLink),
    pages: ownPages.slice(0, RESOURCE_LIMITS.pages).map((p) => ({ ...pageLink(p), ...(p.canvasId ? { canvasId: p.canvasId } : {}) })),
    counts: { canvases: ordered.length, pages: ownPages.length },
    truncated: ordered.length > RESOURCE_LIMITS.canvases || ownPages.length > RESOURCE_LIMITS.pages,
  };
}

export const canvasLink = (c: CanvasDocument): ResourceLink => ({ id: c.id, title: title(c.title), uri: resourceUri("canvas", c.id), updatedAt: c.updatedAt });
export const pageLink = (p: DocumentRecord): ResourceLink => ({ id: p.id, title: title(p.title), uri: resourceUri("page", p.id), updatedAt: p.updatedAt });

/** Most recently updated first, ties by id (deterministic). */
export function sortPages<T extends DocumentRecord>(pages: readonly T[]): T[] {
  return [...pages].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export interface CanvasResource {
  uri: string;
  kind: "canvas";
  version: typeof RESOURCE_VERSION;
  id: string;
  workspaceId: string;
  workspaceUri: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Standalone objects in z-order (arrows appear as `relations`, bound labels inside their container). */
  objects: ContextObject[];
  /**
   * Arrows bound at both ends to listed objects: on a page, those whose later end (in z-order) is on this page, so
   * reading every page lists each relation once.
   */
  relations: ContextRelation[];
  counts: { objects: number; relations: number };
  /** More objects exist than listed (read the next page with `page.nextCursor`), or an excerpt was cut. */
  truncated: boolean;
  /** Paging (Lens Phase 3, G2): which objects this is, and the scene version a next page must still match. */
  page?: CanvasPage;
}

export interface CanvasPage {
  /** Index of the first listed object among all objects in z-order. */
  offset: number;
  limit: number;
  /** The scene version these objects were read at (`domain/lens/paging.ts`). */
  version?: string;
  /** Pass to `get_canvas` for the next objects; absent on the last page. */
  nextCursor?: string;
}

/**
 * `elements` in z-order; `getDocument` resolves block and page documents of this workspace only. `page` picks a
 * window of the objects (default: the first `RESOURCE_LIMITS.objects`).
 */
export function serializeCanvas(
  canvas: CanvasDocument,
  elements: readonly SceneElement[],
  getDocument: Getter,
  page: { offset: number; limit: number } = { offset: 0, limit: RESOURCE_LIMITS.objects },
): CanvasResource {
  const labels = labelsOf(elements);
  const standalone = elements.filter(isStandalone);
  const end = page.offset + page.limit;
  const listed = standalone.slice(page.offset, end);
  const indexOf = new Map(standalone.map((el, i) => [el.id, i] as const));
  let truncated = standalone.length > end;

  const objects = listed.map((el) => {
    const d = describeObject(el, labels, getDocument, RESOURCE_LIMITS.objectExcerpt);
    truncated ||= d.truncated;
    return d.object;
  });

  const relations: ContextRelation[] = [];
  for (const a of elements) {
    if (a.isDeleted || a.type !== "arrow") continue;
    const from = a.startBinding?.elementId;
    const to = a.endBinding?.elementId;
    if (!from || !to) continue;
    const fromAt = indexOf.get(from);
    const toAt = indexOf.get(to);
    // Both ends exist, and the later one is on this page (so a relation is listed once across pages).
    if (fromAt === undefined || toAt === undefined) continue;
    const later = Math.max(fromAt, toAt);
    if (later < page.offset || later >= end) continue;
    const type = getArrowRelation(a);
    const label = labels.get(a.id)?.trim();
    relations.push({ from, to, arrowId: a.id, ...(type ? { type } : {}), ...(label ? { label: cut(label, RESOURCE_LIMITS.title).text } : {}) });
  }
  if (relations.length > RESOURCE_LIMITS.relations) truncated = true;

  return {
    uri: resourceUri("canvas", canvas.id),
    kind: "canvas",
    version: RESOURCE_VERSION,
    id: canvas.id,
    workspaceId: canvas.workspaceId,
    workspaceUri: resourceUri("workspace", canvas.workspaceId),
    title: title(canvas.title),
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    objects,
    relations: relations.slice(0, RESOURCE_LIMITS.relations),
    counts: { objects: standalone.length, relations: relations.length },
    truncated,
    page: { offset: page.offset, limit: page.limit },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface PageResource {
  uri: string;
  kind: "page";
  version: typeof RESOURCE_VERSION;
  id: string;
  workspaceId: string;
  canvasId?: string;
  canvasUri?: string;
  title: string;
  /** GFM Markdown of the body (unsafe links reduced to their text), cut to `RESOURCE_LIMITS.pageChars`. */
  markdown: string;
  counts: { characters: number };
  createdAt: number;
  updatedAt: number;
  provenance?: AIMetadata;
  truncated: boolean;
}

export function serializePage(page: DocumentRecord): PageResource {
  const full = contentToMarkdown(sanitizeContent(page.snapshot));
  const body = cut(full, RESOURCE_LIMITS.pageChars);
  return {
    uri: resourceUri("page", page.id),
    kind: "page",
    version: RESOURCE_VERSION,
    id: page.id,
    workspaceId: page.workspaceId,
    ...(page.canvasId ? { canvasId: page.canvasId, canvasUri: resourceUri("canvas", page.canvasId) } : {}),
    title: title(page.title),
    markdown: body.text,
    counts: { characters: full.length },
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    ...withProvenance(documentProvenance(page)),
    truncated: body.cut,
  };
}

// ---------------------------------------------------------------------------
// Todo and table blocks (addressed by their canvas element id)
// ---------------------------------------------------------------------------

/** A todo or table block: its element on a canvas and the document holding its content. */
export interface BlockObject {
  canvas: CanvasDocument;
  element: SceneElement;
  record: DocumentRecord;
}

interface BlockHeader {
  /** The canvas element id (stable; what `acute://todo|table/{objectId}` names). */
  id: string;
  documentId: string;
  workspaceId: string;
  canvasId: string;
  canvasUri: string;
  title: string;
  updatedAt: number;
  provenance?: AIMetadata;
}

const blockHeader = ({ canvas, element, record }: BlockObject): BlockHeader => ({
  id: element.id,
  documentId: record.id,
  workspaceId: record.workspaceId,
  canvasId: canvas.id,
  canvasUri: resourceUri("canvas", canvas.id),
  title: title(record.title),
  updatedAt: record.updatedAt,
  ...withProvenance(documentProvenance(record)),
});

export interface TodoItem {
  /** The content block's stable id, when it has one. */
  id?: string;
  text: string;
  /** Present on checklist items only. */
  checked?: boolean;
  /** Nesting level, 0 at the top. */
  depth: number;
}

export interface TodoResource extends BlockHeader {
  uri: string;
  kind: "todo";
  version: typeof RESOURCE_VERSION;
  items: TodoItem[];
  counts: { items: number; checklistItems: number; done: number };
  truncated: boolean;
}

/** Depth-first, document order. */
function flatten(blocks: RichContent, depth = 0, out: { block: ContentBlock; depth: number }[] = []) {
  for (const block of blocks) {
    out.push({ block, depth });
    if (block.children?.length) flatten(block.children, depth + 1, out);
  }
  return out;
}

export function serializeTodo(obj: BlockObject): TodoResource {
  const all = flatten(obj.record.snapshot)
    .filter(({ block }) => !isTableContent(block.content))
    .map(({ block, depth }) => ({ block, depth, text: inlineText(block.content).trim() }))
    .filter((x) => x.text || x.block.type === "checkListItem");
  const checklist = all.filter((x) => x.block.type === "checkListItem");
  let truncated = all.length > RESOURCE_LIMITS.todoItems;
  let budget = RESOURCE_LIMITS.contentChars;
  const items: TodoItem[] = [];
  for (const { block, depth, text } of all.slice(0, RESOURCE_LIMITS.todoItems)) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const c = cut(text, Math.min(RESOURCE_LIMITS.itemChars, budget));
    budget -= c.text.length;
    truncated ||= c.cut;
    items.push({
      ...(block.id ? { id: block.id } : {}),
      text: c.text,
      ...(block.type === "checkListItem" ? { checked: block.props?.checked === true } : {}),
      depth,
    });
  }
  return {
    uri: resourceUri("todo", obj.element.id),
    kind: "todo",
    version: RESOURCE_VERSION,
    ...blockHeader(obj),
    items,
    counts: { items: all.length, checklistItems: checklist.length, done: checklist.filter((x) => x.block.props?.checked === true).length },
    truncated,
  };
}

export interface TableResource extends BlockHeader {
  uri: string;
  kind: "table";
  version: typeof RESOURCE_VERSION;
  /** Leading rows that are headers (0 when none). */
  headerRows: number;
  /** Plain-text cells, row by row. */
  rows: string[][];
  /** Plain text of anything else in the block (captions, notes), cut. */
  notes?: string;
  counts: { rows: number; columns: number; tables: number };
  truncated: boolean;
}

export function serializeTable(obj: BlockObject): TableResource {
  const blocks = flatten(obj.record.snapshot).map((x) => x.block);
  const tables = blocks.filter((b) => isTableContent(b.content));
  const first = tables[0]?.content;
  const table = isTableContent(first) ? first : null;
  const sourceRows = table?.rows ?? [];
  const columns = Math.max(0, ...sourceRows.map((r) => r.cells.length));
  let truncated = sourceRows.length > RESOURCE_LIMITS.tableRows || columns > RESOURCE_LIMITS.tableColumns || tables.length > 1;

  let budget = RESOURCE_LIMITS.contentChars;
  const rows: string[][] = [];
  for (const row of sourceRows.slice(0, RESOURCE_LIMITS.tableRows)) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    rows.push(
      row.cells.slice(0, RESOURCE_LIMITS.tableColumns).map((cell) => {
        const text = inlineText(cell).trim();
        if (budget <= 0) {
          truncated ||= !!text;
          return "";
        }
        const c = cut(text, Math.min(RESOURCE_LIMITS.cellChars, budget));
        budget -= c.text.length;
        truncated ||= c.cut;
        return c.text;
      }),
    );
  }

  const notesText = blocks
    .filter((b) => !isTableContent(b.content))
    .map((b) => inlineText(b.content).trim())
    .filter(Boolean)
    .join("\n");
  const notes = cut(notesText, RESOURCE_LIMITS.notesChars);
  truncated ||= notes.cut;

  return {
    uri: resourceUri("table", obj.element.id),
    kind: "table",
    version: RESOURCE_VERSION,
    ...blockHeader(obj),
    headerRows: Math.min(table?.headerRows ?? 0, sourceRows.length),
    rows,
    ...(notes.text ? { notes: notes.text } : {}),
    counts: { rows: sourceRows.length, columns, tables: tables.length },
    truncated,
  };
}
