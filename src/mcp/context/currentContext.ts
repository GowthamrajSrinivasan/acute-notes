/**
 * `acute://context/current` (F25, PRD §13.4, §5.5): what the user is looking
 * at right now. It covers the workspace and canvas, the selection, the objects
 * near it (or in view when nothing is selected), the open page, the relations
 * between those objects, and the AI operations accepted recently. The F20 MCP
 * server serves it as a resource.
 *
 * Bounded and minimal by construction:
 * - Only the current canvas and the open page. No other canvases, pages or
 *   workspace documents, however relevant they might be.
 * - Every list is capped and every excerpt is cut; `truncated` says when.
 * - Built only from domain data read through allow-listed fields: object
 *   geometry and content, and provenance through `normalizeAIMetadata`.
 *   Element `customData`, AI settings, connections and credentials are never
 *   read, so they can't leak.
 *
 * Pure: structural scene elements and a document lookup in, a JSON-ready
 * object out. No renderer, React or persistence imports.
 */
import { labelsOf, itemFromElement } from "@/ai/context/selectionContext";
import { getArrowRelation, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { toPlainText } from "@/domain/content/richContent";
import { normalizeAIMetadata, provenanceOf } from "@/domain/provenance";
import type { AIMetadata, DocumentRecord, RelationType } from "@/domain/types";
import { CURRENT_CONTEXT_URI as CONTEXT_URI, resourceUri } from "../resources/uris";

export const CURRENT_CONTEXT_URI = CONTEXT_URI;
export const CURRENT_CONTEXT_VERSION = 1;

export const CONTEXT_LIMITS = {
  selected: 20,
  nearby: 12,
  relations: 50,
  recentChanges: 5,
  excerpt: 600,
  /** Scene distance within which unconnected objects count as near the selection. */
  nearbyRadius: 800,
} as const;

export interface ContextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextObject {
  id: string;
  /** "text" | "todo" | "table" | "code" | "page" | "rectangle" | "diamond" | "ellipse" | "note" | "image" | … */
  kind: string;
  title?: string;
  /** Plain-text content, cut to `CONTEXT_LIMITS.excerpt`. */
  excerpt?: string;
  bounds: ContextBounds;
  /** Where to read the full object: `acute://page/…`, `acute://todo/…`, `acute://table/…`. */
  uri?: string;
  provenance?: AIMetadata;
}

export interface ContextRelation {
  from: string;
  to: string;
  arrowId: string;
  type?: RelationType;
  label?: string;
}

export interface CurrentContext {
  uri: typeof CURRENT_CONTEXT_URI;
  version: typeof CURRENT_CONTEXT_VERSION;
  generatedAt: number;
  workspace: { id: string; name: string };
  canvas: { id: string; title: string };
  selection: ContextObject[];
  /** Connected to the selection first, then closest; with nothing selected, what is in view. */
  nearby: ContextObject[];
  openPage: { id: string; title: string; excerpt: string; uri: string } | null;
  relations: ContextRelation[];
  /** AI operations accepted on this canvas this session, newest first. */
  recentChanges: string[];
  /** MCP tools the client may call (F21; none yet). */
  availableTools: string[];
  truncated: boolean;
}

export interface CurrentContextInput {
  workspace: { id: string; name: string };
  canvas: { id: string; title: string };
  elements: readonly SceneElement[];
  selectedIds: readonly string[];
  /** The visible scene rectangle, when known. */
  viewport: ContextBounds | null;
  openPageId: string | null;
  getDocument(id: string): DocumentRecord | null | undefined;
  recentChanges: readonly string[];
  now?: number;
}

const boundsOf = (el: SceneElement): ContextBounds => ({ x: el.x, y: el.y, width: el.width, height: el.height });
const centre = (b: ContextBounds) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** `text` cut to `max` characters (the last one an ellipsis); `cut` says whether it was. */
export function cut(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: `${text.slice(0, max - 1)}…`, cut: true } : { text, cut: false };
}

/** Objects that stand on their own (not arrows/lines, bound labels or deleted ones). */
export function isStandalone(el: SceneElement): boolean {
  return !el.isDeleted && el.type !== "arrow" && el.type !== "line" && !(el.type === "text" && el.containerId);
}

/** Where to read an object in full, for the objects that have their own resource. */
export function objectUriOf(el: SceneElement): string | undefined {
  const ref = getEmbedRef(el);
  if (ref?.kind === "page-preview") return resourceUri("page", ref.pageId);
  if (ref?.kind === "rich-block" && (ref.blockType === "todo" || ref.blockType === "table")) return resourceUri(ref.blockType, el.id);
  return undefined;
}

/**
 * One canvas object as MCP resources describe it: stable id, typed kind,
 * geometry, bounded plain-text excerpt, where to read it in full, and
 * sanitized provenance. Shared by `acute://context/current` and
 * `acute://canvas/{id}` so an object reads the same in both.
 */
export function describeObject(
  el: SceneElement,
  labels: ReadonlyMap<string, string>,
  getDocument: CurrentContextInput["getDocument"],
  excerptMax: number = CONTEXT_LIMITS.excerpt,
): { object: ContextObject; truncated: boolean } {
  const item = itemFromElement(el, labels, getDocument);
  const ref = getEmbedRef(el);
  // An embed whose document is empty or unavailable still has its own kind, never the renderer's "embeddable".
  const embedKind = ref ? (ref.kind === "rich-block" ? ref.blockType : "page") : undefined;
  const out: ContextObject = { id: el.id, kind: item?.kind === "shape" ? el.type : (item?.kind ?? embedKind ?? el.type), bounds: boundsOf(el) };
  let truncated = false;
  if (item?.title) out.title = cut(item.title, 200).text;
  const plain = item ? plainTextOf(el, item.text, getDocument) : "";
  if (plain) {
    const c = cut(plain, excerptMax);
    out.excerpt = c.text;
    truncated = c.cut;
  }
  const uri = objectUriOf(el);
  if (uri) out.uri = uri;
  const provenance = provenanceOf(el, getDocument);
  if (provenance) out.provenance = provenance;
  return { object: out, truncated };
}

/** A block or page document's provenance, through the one sanitizing gate. */
export function documentProvenance(rec: DocumentRecord): AIMetadata | undefined {
  return normalizeAIMetadata(rec.metadata?.ai);
}

function distance(a: ContextBounds, b: ContextBounds): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

function union(boxes: readonly ContextBounds[]): ContextBounds | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

export function buildCurrentContext(input: CurrentContextInput): CurrentContext {
  const { elements, getDocument } = input;
  const labels = labelsOf(elements);
  const byId = new Map(elements.filter((el) => !el.isDeleted).map((el) => [el.id, el] as const));
  let truncated = false;

  const describe = (el: SceneElement): ContextObject => {
    const d = describeObject(el, labels, getDocument);
    truncated ||= d.truncated;
    return d.object;
  };

  // Selection (bound labels are part of their container).
  const selectedEls = [...new Set(input.selectedIds)]
    .map((id) => byId.get(id))
    .filter((el): el is SceneElement => !!el && !(el.type === "text" && el.containerId));
  if (selectedEls.length > CONTEXT_LIMITS.selected) truncated = true;
  const selection = selectedEls.slice(0, CONTEXT_LIMITS.selected);
  const selectedSet = new Set(selection.map((el) => el.id));

  // Nearby: connected first, then the closest standalone objects.
  const arrows = elements.filter((el) => !el.isDeleted && el.type === "arrow" && el.startBinding && el.endBinding);
  const nearbyIds: string[] = [];
  const addNearby = (id: string) => {
    if (!selectedSet.has(id) && !nearbyIds.includes(id) && byId.has(id) && isStandalone(byId.get(id)!)) nearbyIds.push(id);
  };
  const standalone = elements.filter((el) => isStandalone(el) && !selectedSet.has(el.id));
  if (selection.length) {
    for (const a of arrows) {
      const from = a.startBinding!.elementId;
      const to = a.endBinding!.elementId;
      if (selectedSet.has(from)) addNearby(to);
      if (selectedSet.has(to)) addNearby(from);
    }
    const area = union(selection.map(boundsOf))!;
    standalone
      .map((el) => ({ el, d: distance(boundsOf(el), area) }))
      .filter((x) => x.d <= CONTEXT_LIMITS.nearbyRadius)
      .sort((a, b) => a.d - b.d)
      .forEach((x) => addNearby(x.el.id));
  } else if (input.viewport) {
    const vp = input.viewport;
    const c = centre(vp);
    standalone
      .filter((el) => distance(boundsOf(el), vp) === 0)
      .map((el) => ({ el, d: Math.hypot(centre(boundsOf(el)).x - c.x, centre(boundsOf(el)).y - c.y) }))
      .sort((a, b) => a.d - b.d)
      .forEach((x) => addNearby(x.el.id));
  }
  if (nearbyIds.length > CONTEXT_LIMITS.nearby) truncated = true;
  const nearby = nearbyIds.slice(0, CONTEXT_LIMITS.nearby).map((id) => byId.get(id)!);

  // Relations among the included objects only.
  const included = new Set([...selectedSet, ...nearby.map((el) => el.id)]);
  const relations: ContextRelation[] = [];
  for (const a of arrows) {
    const from = a.startBinding!.elementId;
    const to = a.endBinding!.elementId;
    if (!included.has(from) || !included.has(to)) continue;
    const type = getArrowRelation(a);
    const label = labels.get(a.id)?.trim();
    relations.push({ from, to, arrowId: a.id, ...(type ? { type } : {}), ...(label ? { label: cut(label, 200).text } : {}) });
  }
  if (relations.length > CONTEXT_LIMITS.relations) truncated = true;

  // The open page, only when it belongs to this workspace.
  const page = input.openPageId ? getDocument(input.openPageId) : null;
  const openPage =
    page && page.kind === "page" && page.workspaceId === input.workspace.id
      ? (() => {
          const c = cut(toPlainText(page.snapshot), CONTEXT_LIMITS.excerpt);
          truncated ||= c.cut;
          return { id: page.id, title: page.title, excerpt: c.text, uri: resourceUri("page", page.id) };
        })()
      : null;

  if (input.recentChanges.length > CONTEXT_LIMITS.recentChanges) truncated = true;

  return {
    uri: CURRENT_CONTEXT_URI,
    version: CURRENT_CONTEXT_VERSION,
    generatedAt: input.now ?? Date.now(),
    workspace: { id: input.workspace.id, name: input.workspace.name },
    canvas: { id: input.canvas.id, title: input.canvas.title },
    selection: selection.map(describe),
    nearby: nearby.map(describe),
    openPage,
    relations: relations.slice(0, CONTEXT_LIMITS.relations),
    recentChanges: input.recentChanges.slice(0, CONTEXT_LIMITS.recentChanges).map((s) => cut(s, 200).text),
    availableTools: [],
    truncated,
  };
}

/** Plain text for an excerpt: documents via their snapshot, labels and native text as they are. */
function plainTextOf(el: SceneElement, fallback: string, getDocument: CurrentContextInput["getDocument"]): string {
  const ref = getEmbedRef(el);
  const docId = ref?.kind === "rich-block" ? ref.documentId : ref?.kind === "page-preview" ? ref.pageId : null;
  const rec = docId ? getDocument(docId) : null;
  return (rec ? toPlainText(rec.snapshot) : fallback).trim();
}
