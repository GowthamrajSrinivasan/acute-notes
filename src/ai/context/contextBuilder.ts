/**
 * The Ask AI context builder (F22 on top of F18's `AIContextProvider`,
 * PRD §5.5, §13.15.7): fills a bounded context in preference order, each
 * object labelled with why it is there —
 *
 * 1. `selected` — the selection;
 * 2. `nearby` / `in_view` — spatially next to the selection, or (with no
 *    selection) in the viewport, nearest the centre first;
 * 3. `connected` / `same_source` / `shared_terms` — related to the
 *    selection: arrows (typed relations first), objects derived from the
 *    same content source, and objects sharing its distinctive terms;
 * 4. `search` — workspace-index hits for the question's terms;
 * 5. `scope` — for canvas and workspace scope, the rest of the scope in
 *    scene / workspace order, until the budget is spent.
 *
 * Budgeted: per-item caps (the selection gets more room than supporting
 * objects), a total character budget, and an object-count cap; once the
 * budget is spent later tiers are dropped and the context says it was
 * truncated. Every title, text and relation label passes `redactSecrets`.
 *
 * The result's `coverage` says what that cost: characters used, objects
 * trimmed, and the candidates left out once the budget was spent (the first
 * `MAX_OMITTED_NOTES` by name, the rest counted), for the Ask AI panel.
 *
 * Search scope follows the user's scope: selection and canvas search the
 * current canvas; only workspace scope searches other canvases and pages.
 *
 * Pure: the scene, documents and index are passed in, so it runs in tests
 * without a browser; the index is only queried, never written (an ad-hoc
 * one is built when none is given).
 */
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { contentToMarkdown } from "@/domain/content/markdown";
import { isEmptyContent } from "@/domain/content/richContent";
import type { DocumentRecord } from "@/domain/types";
import { questionTerms } from "@/search/ranking";
import { WorkspaceIndex, type IndexHit, type IndexKind, type SearchIndex } from "@/search/workspaceIndex";
import { redactSecrets } from "./redact";
import {
  itemFromElement,
  labelsOf,
  relationsBetween,
  type AIScope,
  type ContextBudget,
  type CoverageNote,
  type ContextItem,
  type ContextItemKind,
  type ContextReason,
  type ContextSource,
  type SelectionContext,
} from "./selectionContext";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AskContextSource extends ContextSource {
  /** The typed question, when there is one: its terms drive the search tier. */
  question?: string;
  /** The visible part of the canvas, in scene coordinates. */
  viewport?: Box;
  /** The workspace index (live in the app); an ad-hoc one is built from the source when absent. */
  index?: SearchIndex | null;
  /** Canvas objects derived from the same content source as these (F37), when known. */
  sameSourceAs?: (selectedIds: readonly string[]) => readonly string[];
}

export interface AskBudget extends ContextBudget {
  /** Characters kept per supporting (non-selected) object. */
  perSupporting: number;
  /** Related objects (arrows, same source, shared terms) at most. */
  maxRelated: number;
  /** Search hits per scope. */
  maxSearch: Readonly<Record<AIScope, number>>;
  /** Objects in the whole context at most. */
  maxItems: number;
  /** How far (scene units) from the selection's bounds an object counts as nearby. */
  nearbyRadius: number;
}

export const ASK_BUDGET: AskBudget = {
  perItem: 4_000,
  perSupporting: 1_500,
  total: 16_000,
  maxNearby: 6,
  maxRelated: 8,
  maxSearch: { selection: 4, canvas: 8, workspace: 12 },
  maxItems: 60,
  nearbyRadius: 400,
};

const TRUNCATION_MARK = "\n…";
const SHAPES = new Set(["rectangle", "diamond", "ellipse"]);
const CONTEXT_KINDS = new Set<string>(["text", "todo", "table", "code", "page", "note"]);
const MAX_SHARED_TERMS = 6;
/** Left-out objects named in the coverage report; the rest are counted. */
export const MAX_OMITTED_NOTES = 20;
const LABEL_LENGTH = 60;

/** How the coverage report names an object: its title, else its first line. */
function noteLabel(item: ContextItem): string {
  const raw = item.title?.trim() || item.text.split("\n").find((l) => l.trim())?.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, "") || "Untitled";
  const flat = redactSecrets(raw).replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LENGTH ? `${flat.slice(0, LABEL_LENGTH - 1)}…` : flat;
}

const quoteList = (terms: readonly string[]) => terms.map((t) => `“${t}”`).join(", ");

function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

function unionBox(els: readonly SceneElement[]): Box {
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  const right = Math.max(...els.map((e) => e.x + e.width));
  const bottom = Math.max(...els.map((e) => e.y + e.height));
  return { x, y, width: right - x, height: bottom - y };
}

const holdsContent = (el: SceneElement) => el.type === "embeddable" || SHAPES.has(el.type) || (el.type === "text" && !el.containerId);

function documentItem(rec: DocumentRecord, kind: IndexKind | undefined, onCanvas: boolean): ContextItem | null {
  if (rec.kind === "block" && isEmptyContent(rec.snapshot)) return null;
  const title = rec.title.trim();
  const isPage = rec.kind === "page";
  return {
    id: rec.id,
    kind: isPage ? "page" : kind && CONTEXT_KINDS.has(kind) ? (kind as ContextItemKind) : "text",
    ...(isPage ? { title: title || "Untitled" } : title && title !== "Untitled" ? { title } : {}),
    text: contentToMarkdown(rec.snapshot).trim(),
    onCanvas,
  };
}

/** An index over just this source (scene, plus workspace documents for workspace scope). */
function adHocIndex(source: AskContextSource, scope: AIScope): WorkspaceIndex {
  const index = new WorkspaceIndex(source.workspaceId);
  index.syncScene(source.canvasId, source.elements, source.getDocument);
  if (scope === "workspace") index.syncDocuments(source.listWorkspaceDocuments());
  return index;
}

export function buildAskContext(source: AskContextSource, scope: AIScope, budget: AskBudget = ASK_BUDGET): SelectionContext {
  const labels = labelsOf(source.elements);
  const live = source.elements.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el] as const));
  const z = new Map(live.map((el, i) => [el.id, i] as const));
  const cache = new Map<string, ContextItem | null>();
  const itemOf = (id: string): ContextItem | null => {
    if (!cache.has(id)) {
      const el = byId.get(id);
      cache.set(id, el ? itemFromElement(el, labels, source.getDocument) : null);
    }
    return cache.get(id)!;
  };
  /** Document or page id → the element showing it on this canvas. */
  const shownBy = new Map<string, string>();
  for (const el of live) {
    const ref = getEmbedRef(el);
    const docId = ref?.kind === "rich-block" ? ref.documentId : ref?.kind === "page-preview" ? ref.pageId : null;
    if (docId && !shownBy.has(docId)) shownBy.set(docId, el.id);
  }

  const requested = new Set(source.selectedIds);
  const selected = live.filter((el) => requested.has(el.id) && itemOf(el.id));
  const selectedIds = selected.map((el) => el.id);
  const selectedSet = new Set(selectedIds);

  const primary: ContextItem[] = [];
  const supporting: ContextItem[] = [];
  const included = new Set<string>();
  let chars = 0;
  let truncated = false;
  let full = false;
  const trimmed: CoverageNote[] = [];
  const omitted: CoverageNote[] = [];
  const omittedIds = new Set<string>();
  let omittedMore = 0;
  /** A candidate the budget had no room for; only the first few are named. */
  const omit = (item: ContextItem, reason: ContextReason) => {
    if (omittedIds.has(item.id)) return;
    omittedIds.add(item.id);
    if (omitted.length < MAX_OMITTED_NOTES) omitted.push({ id: item.id, label: noteLabel(item), onCanvas: item.onCanvas, reason });
    else omittedMore++;
  };

  const add = (item: ContextItem | null, reason: ContextReason, why?: string): boolean => {
    if (!item || included.has(item.id)) return !full;
    if (full) {
      truncated = true;
      omit(item, reason);
      return false;
    }
    const room = Math.min(reason === "selected" ? budget.perItem : budget.perSupporting, budget.total - chars);
    if (included.size >= budget.maxItems || room <= 0) {
      full = truncated = true;
      omit(item, reason);
      return false;
    }
    let text = redactSecrets(item.text);
    if (text.length > room) {
      text = text.slice(0, room) + TRUNCATION_MARK;
      truncated = true;
      chars += room;
      trimmed.push({ id: item.id, label: noteLabel(item), onCanvas: item.onCanvas, reason });
    } else {
      chars += text.length;
    }
    const title = item.title ? redactSecrets(item.title) : undefined;
    const out: ContextItem = { ...item, ...(title ? { title } : {}), text, reason, ...(why ? { why } : {}) };
    included.add(item.id);
    (reason === "selected" || scope !== "selection" ? primary : supporting).push(out);
    return true;
  };

  // 1. The selection.
  for (const el of selected) add(itemOf(el.id), "selected");

  // Arrows touching the selection, typed relations first (tier 3, but kept out of tier 2).
  const connected: { id: string; why: string; rank: number; z: number }[] = [];
  if (selected.length) {
    for (const el of live) {
      if (el.type !== "arrow") continue;
      const from = el.startBinding?.elementId;
      const to = el.endBinding?.elementId;
      if (!from || !to) continue;
      const other = selectedSet.has(from) && !selectedSet.has(to) ? to : selectedSet.has(to) && !selectedSet.has(from) ? from : null;
      if (!other || !itemOf(other)) continue;
      const rel = relationsBetween([el], labels, new Set([from, to]))[0];
      const how = [rel?.type?.replace(/_/g, " "), rel?.label ? `“${redactSecrets(rel.label)}”` : null].filter(Boolean).join(" ");
      connected.push({ id: other, why: how ? `linked to the selection: ${how}` : "linked to the selection by an arrow", rank: rel?.type ? 0 : rel?.label ? 1 : 2, z: z.get(el.id)! });
    }
    connected.sort((a, b) => a.rank - b.rank || a.z - b.z);
  }
  const connectedIds = new Set(connected.map((c) => c.id));

  // 2. Nearby: next to the selection, or in view when nothing is selected.
  {
    let near: { el: SceneElement; d: number }[] = [];
    if (selected.length) {
      const box = unionBox(selected);
      const radius = Math.max(budget.nearbyRadius, 0.5 * Math.max(box.width, box.height));
      near = live.filter((el) => holdsContent(el) && !selectedSet.has(el.id) && !connectedIds.has(el.id)).map((el) => ({ el, d: gap(box, el) })).filter((n) => n.d <= radius);
    } else if (source.viewport) {
      const v = source.viewport;
      const cx = v.x + v.width / 2;
      const cy = v.y + v.height / 2;
      near = live
        .filter((el) => holdsContent(el) && gap(v, el) === 0)
        .map((el) => ({ el, d: Math.hypot(el.x + el.width / 2 - cx, el.y + el.height / 2 - cy) }));
    }
    near.sort((a, b) => a.d - b.d || z.get(a.el.id)! - z.get(b.el.id)!);
    let taken = 0;
    for (const { el } of near) {
      if (taken >= budget.maxNearby) break;
      const item = itemOf(el.id);
      if (!item) continue;
      if (add(item, selected.length ? "nearby" : "in_view", selected.length ? "next to the selection" : "in view")) taken++;
      else if (!full) break;
    }
  }

  // 3. Related to the selection.
  let index: SearchIndex | null | undefined = source.index;
  const indexFor = () => (index ??= adHocIndex(source, scope));
  const searchCanvas = scope === "workspace" ? undefined : source.canvasId;
  const resolve = (hit: IndexHit): ContextItem | null => {
    if (hit.kind === "canvas" || hit.kind === "relation") return null;
    if (hit.ref.elementId && (hit.ref.canvasId === source.canvasId || byId.has(hit.ref.elementId))) return itemOf(hit.ref.elementId);
    const docId = hit.ref.documentId;
    if (!docId) return null;
    const onCanvas = shownBy.get(docId);
    if (onCanvas) return itemOf(onCanvas);
    const rec = source.getDocument(docId);
    return rec && rec.workspaceId === source.workspaceId ? documentItem(rec, hit.kind, false) : null;
  };

  if (selected.length) {
    let related = 0;
    const room = () => related < budget.maxRelated;
    for (const c of connected) {
      if (!room()) break;
      if (!included.has(c.id) && add(itemOf(c.id), "connected", c.why)) related++;
    }
    for (const id of source.sameSourceAs?.(selectedIds) ?? []) {
      if (!room()) break;
      if (!included.has(id) && add(itemOf(id), "same_source", "derived from the same content source as the selection")) related++;
    }
    if (room()) {
      const idx = indexFor();
      const terms = distinctiveTerms(selected.map((el) => itemOf(el.id)!), idx);
      if (terms.length) {
        const hits = idx.query({
          text: terms.join(" "),
          mode: "any",
          canvasId: searchCanvas,
          exclude: included,
          minMatched: Math.min(2, terms.length),
          limit: budget.maxRelated - related,
        }).hits;
        for (const hit of hits) {
          if (!room()) break;
          if (add(resolve(hit), "shared_terms", `shares ${quoteList(hit.matchedTerms.slice(0, 4))} with the selection`)) related++;
        }
      }
    }
  }

  // 4. Search hits for the question.
  const question = source.question?.trim();
  if (question && questionTerms(question).length) {
    const hits = indexFor().query({ text: question, mode: "any", canvasId: searchCanvas, exclude: included, limit: budget.maxSearch[scope] }).hits;
    for (const hit of hits) {
      if (!add(resolve(hit), "search", `matches the question: ${quoteList(hit.matchedTerms.slice(0, 4))}`) && !full) break;
    }
  }

  // 5. The rest of the scope. Once the budget is spent, the first few left out are named and the rest only counted.
  if (scope !== "selection") {
    const named = () => omitted.length < MAX_OMITTED_NOTES;
    for (const el of live) {
      if (!holdsContent(el) || included.has(el.id) || omittedIds.has(el.id)) continue;
      if (full && !named()) {
        if (itemOf(el.id)) omittedMore++;
        continue;
      }
      add(itemOf(el.id), "scope");
    }
    if (scope === "workspace") {
      for (const rec of source.listWorkspaceDocuments()) {
        if (rec.workspaceId !== source.workspaceId || shownBy.has(rec.id) || rec.canvasId === source.canvasId || included.has(rec.id) || omittedIds.has(rec.id)) continue;
        if (full && !named()) {
          if (!(rec.kind === "block" && isEmptyContent(rec.snapshot))) omittedMore++;
          continue;
        }
        add(documentItem(rec, undefined, false), "scope");
      }
    }
  }

  const onCanvas = new Set([...primary, ...supporting].filter((i) => i.onCanvas).map((i) => i.id));
  const relations = relationsBetween(source.elements, labels, onCanvas).map((r) => (r.label ? { ...r, label: redactSecrets(r.label) } : r));
  return {
    scope,
    workspaceId: source.workspaceId,
    canvasId: source.canvasId,
    selectedObjectIds: selectedIds,
    items: primary,
    nearby: supporting,
    relations,
    truncated,
    coverage: { chars, budget: budget.total, trimmed, omitted, omittedMore },
  };
}

/** Up to `MAX_SHARED_TERMS` terms of the selection that also occur elsewhere, rarest first. */
function distinctiveTerms(items: readonly ContextItem[], index: SearchIndex): string[] {
  const candidates = new Set<string>();
  for (const item of items) {
    const text = `${item.title ?? ""} ${item.text}`.slice(0, 8_000);
    // The first terms, plus the longest words (a long selection's key terms are rarely all up front).
    const longest = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{6,}/gu) ?? [])].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, 24);
    for (const t of [...questionTerms(text), ...questionTerms(longest.join(" "))]) if (t.length >= 4) candidates.add(t);
  }
  return [...candidates]
    .map((t) => ({ t, f: index.frequency(t) }))
    .filter(({ f }) => f > items.length)
    .sort((a, b) => a.f - b.f || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
    .slice(0, MAX_SHARED_TERMS)
    .map(({ t }) => t);
}
