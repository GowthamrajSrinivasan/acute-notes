/**
 * `AIContextProvider` (PRD §5.5, §13.15.7): turns the canvas and its
 * documents into bounded, structured context for an AI task — content as
 * Markdown plus the relationships between objects, never a screenshot.
 *
 * Smallest useful scope first: `selection` sends the selected objects and
 * the objects directly connected to them; `canvas` the current canvas;
 * `workspace` the canvas plus the workspace's other pages and blocks. Every
 * scope is capped by a character budget and says when it was truncated.
 *
 * Pure: written against the adapter's structural `SceneElement` and a
 * document lookup, so it is testable without a browser or renderer.
 */
import { getArrowRelation, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { COMPOSITE_SHAPE_MEANINGS, compositeKindOf, type CompositeShapeKind } from "@/domain/canvas/compositeShapes";
import { getNodeSemantics, nodeFieldLines } from "@/domain/canvas/diagram";
import { contentToMarkdown } from "@/domain/content/markdown";
import { isEmptyContent } from "@/domain/content/richContent";
import type { DocumentRecord, RelationType } from "@/domain/types";

export type AIScope = "selection" | "canvas" | "workspace";

export type ContextItemKind = "text" | "todo" | "table" | "code" | "page" | "shape" | "note";

/**
 * Why an object is in the context (F22 context builder, in preference order):
 * the selection, what is next to it or in view, what is related to it
 * (arrows, same content source, shared distinctive terms), what a search for
 * the question found, and the rest of the scope.
 */
export type ContextReason = "selected" | "nearby" | "in_view" | "connected" | "same_source" | "shared_terms" | "search" | "scope";

export interface ContextItem {
  /** Element id for objects on the canvas; document id for workspace documents elsewhere. */
  id: string;
  kind: ContextItemKind;
  title?: string;
  /** Markdown (rich content) or plain text (labels, native text). */
  text: string;
  /** False for workspace documents that live on another canvas. */
  onCanvas: boolean;
  /** Why it was included (set by the F22 context builder). */
  reason?: ContextReason;
  /** A short human-readable reason, e.g. "linked to the selection: depends on". */
  why?: string;
  /** A shape that means something by its outline (a cylinder is a data store), named for the model. */
  shape?: CompositeShapeKind;
}

export interface ContextRelation {
  from: string;
  to: string;
  type?: RelationType;
  label?: string;
}

/** An object named in a coverage report: how the panel lists it. */
export interface CoverageNote {
  id: string;
  label: string;
  /** False for a workspace document on another canvas (it can't be shown here). */
  onCanvas: boolean;
  /** Why it was a candidate (for left-out objects, why it would have been included). */
  reason: ContextReason;
}

/**
 * What a context covered (F18 → CAP-01): how much of the budget it used,
 * which objects were cut short, and which were left out once the budget was
 * spent — so the user can see what the AI did and didn't see.
 */
export interface ContextCoverage {
  /** Characters of content sent, and the total budget. */
  chars: number;
  budget: number;
  /** Objects included whose text was shortened to fit. */
  trimmed: CoverageNote[];
  /** Candidates left out because the budget (characters or object count) was spent; the first few, by preference. */
  omitted: CoverageNote[];
  /** Further left-out candidates beyond `omitted`, counted only. */
  omittedMore: number;
}

export interface SelectionContext {
  scope: AIScope;
  workspaceId: string;
  canvasId: string;
  selectedObjectIds: string[];
  /** The scope's objects: the selection, the canvas, or canvas + workspace documents. */
  items: ContextItem[];
  /** Objects connected to the selection by an arrow (selection scope only). */
  nearby: ContextItem[];
  relations: ContextRelation[];
  truncated: boolean;
  /** Set by the F22 context builder (Ask AI). */
  coverage?: ContextCoverage;
}

export interface ContextSource {
  workspaceId: string;
  canvasId: string;
  elements: readonly SceneElement[];
  selectedIds: readonly string[];
  getDocument(id: string): DocumentRecord | null | undefined;
  /** Blocks and pages of the whole workspace (workspace scope only). */
  listWorkspaceDocuments(): readonly DocumentRecord[];
}

export interface ContextBudget {
  /** Characters of content kept per object. */
  perItem: number;
  /** Characters of content kept in total. */
  total: number;
  /** Connected-but-unselected objects included with a selection. */
  maxNearby: number;
}

export const DEFAULT_BUDGET: ContextBudget = { perItem: 4_000, total: 16_000, maxNearby: 8 };

const TRUNCATION_MARK = "\n…";

export function labelsOf(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "text" && el.containerId) labels.set(el.containerId, el.originalText ?? el.text ?? "");
  }
  return labels;
}

function documentTitle(rec: DocumentRecord): string | undefined {
  const title = rec.title.trim();
  return title && title !== "Untitled" ? title : undefined;
}

/** The content of one canvas element, or null when it carries none (drawings, images, bound labels). */
export function itemFromElement(
  el: SceneElement,
  labels: ReadonlyMap<string, string>,
  getDocument: ContextSource["getDocument"],
): ContextItem | null {
  if (el.isDeleted) return null;
  if (el.type === "embeddable") {
    const ref = getEmbedRef(el);
    if (ref?.kind === "rich-block") {
      const rec = getDocument(ref.documentId);
      if (!rec || isEmptyContent(rec.snapshot)) return null;
      return { id: el.id, kind: ref.blockType, title: documentTitle(rec), text: contentToMarkdown(rec.snapshot).trim(), onCanvas: true };
    }
    if (ref?.kind === "page-preview") {
      const rec = getDocument(ref.pageId);
      if (!rec) return null;
      return { id: el.id, kind: "page", title: rec.title.trim() || "Untitled", text: contentToMarkdown(rec.snapshot).trim(), onCanvas: true };
    }
    return null;
  }
  if (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") {
    const label = labels.get(el.id)?.trim();
    const shape = compositeKindOf(el);
    // A diagram or project node's own fields (sublabel, details, a decision's reason, …) are content too (C6).
    // A kind alone on an unlabelled shape isn't content.
    const fields = nodeFieldLines(el);
    const text = label || fields.length > (getNodeSemantics(el)?.kind ? 1 : 0) ?[label, ...fields].filter(Boolean).join("\n") : "";
    return text ?{ id: el.id, kind: "shape", text, onCanvas: true, ...(shape ? { shape } : {}) } : null;
  }
  if (el.type === "text" && !el.containerId) {
    const text = (el.originalText ?? el.text ?? "").trim();
    return text ? { id: el.id, kind: "note", text, onCanvas: true } : null;
  }
  return null;
}

/** Whether the selection holds anything an AI action could work on (drives `✨ Ask AI` visibility). */
export function hasUsefulSelection(
  elements: readonly SceneElement[],
  selectedIds: Readonly<Record<string, unknown>>,
  getDocument: ContextSource["getDocument"],
): boolean {
  let labels: Map<string, string> | null = null;
  for (const el of elements) {
    if (!selectedIds[el.id]) continue;
    if (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") labels ??= labelsOf(elements);
    if (itemFromElement(el, labels ?? new Map(), getDocument)) return true;
  }
  return false;
}

/** Applies the per-item and total budgets in order; later items are dropped once the total is spent. */
function withinBudget(items: ContextItem[], budget: ContextBudget, spent: { chars: number; truncated: boolean }): ContextItem[] {
  const out: ContextItem[] = [];
  for (const item of items) {
    const room = Math.min(budget.perItem, budget.total - spent.chars);
    if (room <= 0) {
      spent.truncated = true;
      break;
    }
    if (item.text.length > room) {
      spent.truncated = true;
      out.push({ ...item, text: item.text.slice(0, room) + TRUNCATION_MARK });
      spent.chars += room;
    } else {
      out.push(item);
      spent.chars += item.text.length;
    }
  }
  return out;
}

/** Arrows between two content items; typed arrows keep their relation, labelled ones their label. */
export function relationsBetween(elements: readonly SceneElement[], labels: ReadonlyMap<string, string>, ids: ReadonlySet<string>): ContextRelation[] {
  const out: ContextRelation[] = [];
  for (const el of elements) {
    if (el.isDeleted || el.type !== "arrow") continue;
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!from || !to || !ids.has(from) || !ids.has(to)) continue;
    const type = getArrowRelation(el);
    const label = labels.get(el.id)?.trim();
    out.push({ from, to, ...(type ? { type } : {}), ...(label ? { label } : {}) });
  }
  return out;
}

export function buildContext(source: ContextSource, scope: AIScope, budget: ContextBudget = DEFAULT_BUDGET): SelectionContext {
  const labels = labelsOf(source.elements);
  const selected = new Set(source.selectedIds);
  const canvasItems: ContextItem[] = [];
  for (const el of source.elements) {
    const item = itemFromElement(el, labels, source.getDocument);
    if (item) canvasItems.push(item);
  }
  const spent = { chars: 0, truncated: false };

  let items: ContextItem[];
  let nearby: ContextItem[] = [];
  let relations: ContextRelation[];

  if (scope === "selection") {
    items = withinBudget(
      canvasItems.filter((i) => selected.has(i.id)),
      budget,
      spent,
    );
    const itemIds = new Set(items.map((i) => i.id));
    const allIds = new Set(canvasItems.map((i) => i.id));
    const touching = relationsBetween(source.elements, labels, allIds).filter((r) => itemIds.has(r.from) || itemIds.has(r.to));
    const nearbyIds = new Set(touching.flatMap((r) => [r.from, r.to]).filter((id) => !itemIds.has(id)));
    const candidates = canvasItems.filter((i) => nearbyIds.has(i.id));
    if (candidates.length > budget.maxNearby) spent.truncated = true;
    nearby = withinBudget(candidates.slice(0, budget.maxNearby), budget, spent);
    const kept = new Set([...itemIds, ...nearby.map((i) => i.id)]);
    relations = touching.filter((r) => kept.has(r.from) && kept.has(r.to));
  } else {
    // Selected objects first, so they survive truncation.
    const ordered = [...canvasItems.filter((i) => selected.has(i.id)), ...canvasItems.filter((i) => !selected.has(i.id))];
    if (scope === "workspace") {
      const onCanvas = new Set(
        source.elements.flatMap((el) => {
          const ref = el.isDeleted ? null : getEmbedRef(el);
          return ref ? [ref.kind === "rich-block" ? ref.documentId : ref.pageId] : [];
        }),
      );
      for (const rec of source.listWorkspaceDocuments()) {
        if (onCanvas.has(rec.id) || rec.canvasId === source.canvasId || isEmptyContent(rec.snapshot)) continue;
        const title = rec.kind === "page" ? rec.title.trim() || "Untitled" : documentTitle(rec);
        ordered.push({ id: rec.id, kind: rec.kind === "page" ? "page" : "text", title, text: contentToMarkdown(rec.snapshot).trim(), onCanvas: false });
      }
    }
    items = withinBudget(ordered, budget, spent);
    relations = relationsBetween(source.elements, labels, new Set(items.map((i) => i.id)));
  }

  return {
    scope,
    workspaceId: source.workspaceId,
    canvasId: source.canvasId,
    selectedObjectIds: [...source.selectedIds].filter((id) => canvasItems.some((i) => i.id === id)),
    items,
    nearby,
    relations,
    truncated: spent.truncated,
  };
}

const KIND_LABELS: Record<ContextItemKind, string> = {
  text: "Text block",
  todo: "Todo list",
  table: "Table",
  code: "Code block",
  page: "Page",
  shape: "Shape",
  note: "Canvas text",
};

/** What a composite shape's outline means, added to its heading. */
const shapeMeaning = (shape: CompositeShapeKind) => `${shape}: ${COMPOSITE_SHAPE_MEANINGS[shape]}`;
const SCOPE_LABELS: Record<AIScope, string> = {
  selection: "the user's selection on the current canvas",
  canvas: "the whole current canvas",
  workspace: "the current canvas and the rest of the workspace",
};

const REASON_SECTIONS: Record<ContextReason, string> = {
  selected: "Selected objects",
  nearby: "Nearby on the canvas",
  in_view: "In view on the canvas",
  connected: "Related to the selection",
  same_source: "Related to the selection",
  shared_terms: "Related to the selection",
  search: "Found by searching for the question",
  scope: "Rest of the canvas",
};

function sectionOf(item: ContextItem): string | null {
  if (!item.reason) return null;
  if (item.reason === "scope" && !item.onCanvas) return "Elsewhere in the workspace";
  return REASON_SECTIONS[item.reason];
}

/** Prompt text for a context: numbered objects, their content, and how they connect. */
export function serializeContext(ctx: SelectionContext): string {
  const refs = new Map<string, number>();
  const selected = new Set(ctx.selectedObjectIds);
  const lines: string[] = [`Scope: ${SCOPE_LABELS[ctx.scope]}.`];
  if ([...ctx.items, ...ctx.nearby].some((i) => i.reason && i.reason !== "selected")) {
    lines.push("Objects are grouped by why they were included, most relevant first: the selection, then nearby, related and search results.");
  }

  const section = (fallback: string, items: ContextItem[]) => {
    if (!items.length) return;
    let heading: string | null = null;
    for (const item of items) {
      const next = sectionOf(item) ?? fallback;
      if (next !== heading) lines.push("", `## ${(heading = next)}`);
      const n = refs.size + 1;
      refs.set(item.id, n);
      const tags = [
        !item.reason && ctx.scope !== "selection" && selected.has(item.id) ? "selected" : null,
        item.why ?? null,
        item.onCanvas ? null : "on another canvas",
      ].filter(Boolean);
      const title = item.title ? ` "${item.title}"` : "";
      if (item.shape) tags.unshift(shapeMeaning(item.shape));
      lines.push("", `### [${n}] ${KIND_LABELS[item.kind]}${title}${tags.length ? ` (${tags.join(", ")})` : ""}`, item.text);
    }
  };
  section(ctx.scope === "selection" ? "Selected objects" : "Objects", ctx.items);
  section("Connected objects (not selected)", ctx.nearby);

  if (ctx.relations.length) {
    lines.push("", "## Relationships");
    for (const r of ctx.relations) {
      const how = [r.type?.replace(/_/g, " "), r.label ? `"${r.label}"` : null].filter(Boolean).join(" ") || "connects to";
      lines.push(`[${refs.get(r.from)}] → ${how} → [${refs.get(r.to)}]`);
    }
  }
  if (ctx.truncated) lines.push("", "(Some content was left out to keep the request small.)");
  return lines.join("\n");
}

/** Content items for the selected elements (in scene order). */
export function selectedItems(
  elements: readonly SceneElement[],
  selectedIds: Readonly<Record<string, unknown>>,
  getDocument: ContextSource["getDocument"],
): ContextItem[] {
  const labels = labelsOf(elements);
  const out: ContextItem[] = [];
  for (const el of elements) {
    if (!selectedIds[el.id]) continue;
    const item = itemFromElement(el, labels, getDocument);
    if (item) out.push(item);
  }
  return out;
}
