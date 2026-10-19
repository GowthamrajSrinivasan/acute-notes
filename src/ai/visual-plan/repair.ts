/**
 * Information-preserving repairs for `validateVisualPlan` (content fidelity plan, Step 2): the validator repairs,
 * converts or relocates — it never deletes content. Everything here is pure and deterministic.
 *
 * - `repairEntry` (before parsing): content over a `TEXT_LIMITS` limit is split across linked detail nodes instead
 *   of the whole node being dropped — long text into several texts/pages, long tables into several tables, long
 *   labels shortened with the full wording kept in a linked "text" detail.
 * - `salvage` (a node that still fails its schema): its text becomes a "text" node.
 * - `convertNode` (a node type the template doesn't use): becomes a "text" node with the same content as Markdown.
 * - `foldOverflow` (more nodes than a plan may hold): the extra nodes become "More from this section" pages.
 *
 * Detail nodes are linked from the node they came from with `explained_by` (every template allows it) and keep
 * its `parent`, so they stay in the same section.
 */
import { fenceMask } from "@/ai/content/fences";
import { nodeStrings } from "@/ai/fidelity/information";
import { TEXT_LIMITS } from "./schema";
import type { VisualTemplateDefinition } from "./templates";
import type { VisualNode, VisualNodeType } from "./types";

type Raw = Record<string, unknown>;

export interface RepairLink {
  from: string;
  to: string;
  type: "explained_by";
}

export interface Repaired {
  entries: unknown[];
  relationships: RepairLink[];
  notes: string[];
}

const ELLIPSIS = "…";

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `text` shortened to at most `max` characters, ending in an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}${ELLIPSIS}`;
}

/**
 * `text` split into pieces of at most `max` characters, at a paragraph, line or word boundary where one is near.
 *
 * `fenceSafe` (Markdown only; not for source code, which may hold fence-like lines itself): a cut that would fall inside a fenced code block
 * moves to the last paragraph break outside one in the window, so a code block is not split across pieces. A single code block longer than
 * `max` has no such break and is still cut (each piece is then an unbalanced fence).
 */
export function chunkText(text: string, max: number, options: { fenceSafe?: boolean } = {}): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max / 2) cut = window.lastIndexOf("\n");
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut < max / 2) cut = max;
    if (options.fenceSafe) cut = outsideFence(window, cut);
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** `cut` (an offset in `window`), or the last paragraph break of `window` outside any fenced code block when `cut` lies inside one; `cut` when there is none. */
function outsideFence(window: string, cut: number): number {
  const lines = window.split("\n");
  const inFence = fenceMask(lines);
  const line = (window.slice(0, cut).match(/\n/g) ?? []).length;
  // A cut at a line break lies inside a fence when both lines it separates do; a cut within a line, when that line does.
  const inside = window[cut] === "\n" ? inFence[line] === true && inFence[line + 1] === true : inFence[line] === true;
  if (!inside) return cut;
  let safe = -1;
  let offset = 0;
  lines.forEach((l, i) => {
    if (i > 0 && l === "" && !inFence[i]) safe = offset - 1;
    offset += l.length + 1;
  });
  return safe > 0 ? safe : cut;
}

const cellText = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** A GFM table. */
export function markdownTable(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const width = Math.max(columns.length, ...rows.map((r) => r.length), 1);
  const pad = (r: readonly string[]) => Array.from({ length: width }, (_, i) => cellText(r[i] ?? ""));
  const header = pad(columns.length ? columns : Array.from({ length: width }, () => ""));
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${pad(r).join(" | ")} |`)].join("\n");
}

/** A node's content as Markdown, for a node shown as "text" (a type its template doesn't use, or folded overflow). */
export function toMarkdown(node: VisualNode): string {
  switch (node.type) {
    case "heading":
      return node.content.text;
    case "text":
      return node.content.markdown;
    case "todo":
      return node.content.items.map((i) => `- [${i.checked ? "x" : " "}] ${i.text}`).join("\n");
    case "table":
      return markdownTable(node.content.columns, node.content.rows);
    case "code":
      return `\`\`\`${node.content.language ?? ""}\n${node.content.source}\n\`\`\``;
    case "page":
      return `**${node.content.title}**\n\n${node.content.markdown}`;
    case "shape":
      return node.content.label;
    case "image":
      return `Image: ${node.content.alt ?? node.content.assetRef}`;
    case "group":
      return node.content.label;
  }
}

/** Fields a derived node keeps from its original (never `content`/`type`/`id`). */
function common(node: Raw): Raw {
  const out: Raw = {};
  for (const key of ["role", "title", "importance", "sourceSpan", "stableKey", "parent"] as const) if (node[key] !== undefined) out[key] = node[key];
  return out;
}

/**
 * Splits content over a `TEXT_LIMITS` limit across linked detail nodes (see module doc). Anything not shaped like a
 * node, and anything already within its limits, is returned unchanged.
 */
export function repairEntry(entry: unknown): Repaired {
  const result: Repaired = { entries: [entry], relationships: [], notes: [] };
  if (!isObject(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.type !== "string" || !isObject(entry.content)) return result;
  const id = entry.id;
  const L = TEXT_LIMITS;
  const node: Raw = { ...entry, content: { ...entry.content } };
  const content = node.content as Raw;
  const details: Raw[] = [];
  const notes: string[] = [];
  const parent = typeof entry.parent === "string" ? { parent: entry.parent } : {};
  const detail = (type: VisualNodeType, detailContent: Raw, title?: string) => {
    const d: Raw = { id: `${id}~${details.length + 2}`, type, content: detailContent, ...(title ? { title } : {}), ...parent };
    details.push(d);
    result.relationships.push({ from: id, to: d.id as string, type: "explained_by" });
  };
  const detailText = (text: string, title?: string) => chunkText(text, L.markdown).forEach((chunk) => detail("text", { markdown: chunk }, title));

  // A heading too long to be one becomes a text block (and is split below if it has to be).
  if (node.type === "heading" && typeof content.text === "string" && content.text.length > L.heading) {
    node.type = "text";
    node.content = { markdown: content.text };
    notes.push(`a heading over ${L.heading} characters is shown as text`);
  }
  const c = node.content as Raw;

  if (typeof node.title === "string" && node.title.length > L.title) {
    const full = node.title;
    node.title = clip(full, L.title);
    if (node.type === "text" && typeof c.markdown === "string") c.markdown = `**${full}**\n\n${c.markdown}`;
    else detailText(full);
    notes.push(`title over ${L.title} characters shortened; the full title is kept`);
  }

  switch (node.type) {
    case "text":
      if (typeof c.markdown === "string" && c.markdown.length > L.markdown) {
        const [first, ...rest] = chunkText(c.markdown, L.markdown);
        c.markdown = first;
        rest.forEach((chunk) => detail("text", { markdown: chunk }));
        notes.push(`text over ${L.markdown} characters split into ${rest.length + 1} linked blocks`);
      }
      break;
    case "page":
      if (typeof c.title === "string" && c.title.length > L.title) {
        detailText(c.title);
        c.title = clip(c.title, L.title);
        notes.push(`page title over ${L.title} characters shortened; the full title is kept`);
      }
      if (typeof c.markdown === "string" && c.markdown.length > L.markdown) {
        const [first, ...rest] = chunkText(c.markdown, L.markdown);
        c.markdown = first;
        const title = typeof c.title === "string" ? c.title : "Page";
        rest.forEach((chunk, i) => detail("page", { title: clip(`${title} (${i + 2}/${rest.length + 1})`, L.title), markdown: chunk }));
        notes.push(`page over ${L.markdown} characters split into ${rest.length + 1} linked pages`);
      }
      break;
    case "code":
      if (typeof c.source === "string" && c.source.length > L.codeSource) {
        const [first, ...rest] = chunkText(c.source, L.codeSource);
        c.source = first;
        rest.forEach((chunk) => detail("code", { ...(typeof c.language === "string" ? { language: c.language } : {}), source: chunk }));
        notes.push(`code over ${L.codeSource} characters split into ${rest.length + 1} linked blocks`);
      }
      if (typeof c.language === "string" && c.language.length > L.language) delete c.language;
      break;
    case "shape":
      if (typeof c.label === "string" && c.label.length > L.shapeLabel) {
        detailText(c.label);
        c.label = clip(c.label, L.shapeLabel);
        notes.push(`label over ${L.shapeLabel} characters shortened; the full wording is kept in a linked block`);
      }
      break;
    case "group":
      if (typeof c.label === "string" && c.label.length > L.groupLabel) {
        c.label = clip(c.label, L.groupLabel);
        notes.push(`section label over ${L.groupLabel} characters shortened`);
      }
      break;
    case "todo":
      if (Array.isArray(c.items)) {
        const long: string[] = [];
        const items = c.items.map((item) => {
          if (!isObject(item) || typeof item.text !== "string" || item.text.length <= L.todoItem) return item;
          long.push(`- ${item.text}`);
          return { ...item, text: clip(item.text, L.todoItem) };
        });
        const [first, ...rest] = Array.from({ length: Math.max(1, Math.ceil(items.length / L.todoItems)) }, (_, i) => items.slice(i * L.todoItems, (i + 1) * L.todoItems));
        c.items = first;
        rest.forEach((part) => detail("todo", { items: part }));
        if (rest.length) notes.push(`${items.length} checklist items split into ${rest.length + 1} linked checklists`);
        if (long.length) {
          detailText(long.join("\n"));
          notes.push(`${long.length} checklist item(s) over ${L.todoItem} characters shortened; the full wording is kept`);
        }
      }
      break;
    case "table":
      if (normalizeTable(c)) notes.push("table cells given in another shape (objects, numbers, empty) read as text");
      dropEmptyColumns(c, notes);
      if (Array.isArray(c.columns) && Array.isArray(c.rows) && c.columns.every((x) => typeof x === "string") && c.rows.every((r) => Array.isArray(r) && r.every((x) => typeof x === "string"))) {
        repairTable(c, detail, detailText, notes);
      }
      break;
  }

  if (notes.length) result.notes.push(...notes.map((n) => `node "${id}": ${n}`));
  result.entries = [node, ...details];
  return result;
}

/** A cell as text: a number or boolean as written, nothing as "", anything else as its strings. */
function cellOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Every string inside, however nested ({"text": …}, [{"type":"text","text": …}]) — never silently "".
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === "string") out.push(x);
    else if (typeof x === "number") out.push(String(x));
    else if (Array.isArray(x)) x.forEach(walk);
    else if (isObject(x)) for (const [k, y] of Object.entries(x)) if (!CELL_MARKUP_KEYS.has(k)) walk(y);
  };
  walk(v);
  return out.join(" ");
}

/** Keys of inline markup inside a cell that say how it looks, not what it says. */
const CELL_MARKUP_KEYS = new Set(["type", "id", "styles", "props", "href"]);

/** A row given as an object wrapping its cells (`{"cells": [...]}`, `{"values": [...]}`): those cells. */
function wrappedCells(row: Raw, columns: readonly string[]): unknown[] | null {
  const arrays = Object.entries(row).filter(([k, v]) => Array.isArray(v) && !columns.includes(k));
  return arrays.length === 1 && Object.keys(row).length === 1 ? (arrays[0]![1] as unknown[]) : null;
}

/**
 * A table the model shaped differently, in place, as `columns: string[]` and `rows: string[][]`: rows given as
 * objects keyed by column (or, without columns, the first row's keys become the columns), a row given as one value,
 * and cells that are numbers, null or nested. Without this the whole table failed its schema and was kept only as
 * loose text, one cell per paragraph. True when anything changed.
 */
export function normalizeTable(c: Raw): boolean {
  if (!Array.isArray(c.rows)) return false;
  let changed = false;
  const firstObject = c.rows.find((r): r is Raw => isObject(r) && !wrappedCells(r, []));
  if (!Array.isArray(c.columns) || (!c.columns.length && firstObject)) {
    c.columns = firstObject ? Object.keys(firstObject) : [];
    changed = true;
  }
  const columns = (c.columns as unknown[]).map((col) => {
    const text = cellOf(col);
    if (text !== col) changed = true;
    return text;
  });
  c.columns = columns;
  c.rows = c.rows.map((row: unknown) => {
    if (Array.isArray(row)) {
      const cells = row.map(cellOf);
      if (cells.some((cell, i) => cell !== row[i])) changed = true;
      return cells;
    }
    changed = true;
    const wrapped = isObject(row) ? wrappedCells(row, columns) : null;
    if (wrapped) return wrapped.map(cellOf);
    if (isObject(row)) {
      // A column the row has no key for (a blank first column, a renamed one) takes the row's next unused key, in order:
      // `["", "Before", "Now"]` with `{"Case": …, "Before": …, "Now": …}` puts the case first, where its column is.
      const unused = Object.keys(row).filter((k) => !columns.includes(k));
      const cells = columns.map((col) => (col in row ? cellOf(row[col]) : unused.length ? cellOf(row[unused.shift()!]) : ""));
      return [...cells, ...unused.map((k) => cellOf(row[k]))];
    }
    return [cellOf(row)];
  });
  return changed;
}

/**
 * Columns empty in every row, after the first, left out: a header with nothing under it (live run: a model copied an
 * example's "Free | Pro | Lifetime" into a table about checks). The first column, the rows' names, always stays.
 */
function dropEmptyColumns(c: Raw, notes: string[]): void {
  if (!Array.isArray(c.columns) || !Array.isArray(c.rows) || !c.rows.length || !c.rows.every(Array.isArray)) return;
  const rows = c.rows as unknown[][];
  const width = Math.max(c.columns.length, ...rows.map((r) => r.length));
  const blank = (v: unknown) => v === undefined || (typeof v === "string" && !v.trim());
  const keep = Array.from({ length: width }, (_, j) => j === 0 || !rows.every((r) => blank(r[j])));
  const dropped = (c.columns as unknown[]).filter((col, j) => !keep[j] && typeof col === "string" && col.trim());
  if (keep.every(Boolean)) return;
  c.columns = (c.columns as unknown[]).filter((_, j) => keep[j]);
  c.rows = rows.map((r) => r.filter((_, j) => keep[j]));
  notes.push(`${keep.filter((k) => !k).length} empty table column(s)${dropped.length ? ` (${dropped.join(", ")})` : ""} left out`);
}

function repairTable(
  c: Raw,
  detail: (type: VisualNodeType, content: Raw, title?: string) => void,
  detailText: (text: string, title?: string) => void,
  notes: string[],
): void {
  const L = TEXT_LIMITS;
  const columns = c.columns as string[];
  const rows = c.rows as string[][];
  const long: string[] = [];
  const fit = (cell: string, where: () => string) => {
    if (cell.length <= L.tableCell) return cell;
    long.push(`**${where()}:** ${cell}`);
    return clip(cell, L.tableCell);
  };
  const header = columns.map((col, j) => fit(col, () => `Column ${j + 1}`));
  const body = rows.map((row, r) => row.map((cell, j) => fit(cell, () => `${clip(row[0] ?? `Row ${r + 1}`, 80)} · ${clip(columns[j] ?? `Column ${j + 1}`, 80)}`)));
  const width = Math.max(header.length, ...body.map((r) => r.length), 0);
  // Column groups: the first column (the row's name) repeats in every group after the first.
  const groups: number[][] = [];
  if (width <= L.tableColumns) groups.push(Array.from({ length: width }, (_, j) => j));
  else {
    groups.push(Array.from({ length: L.tableColumns }, (_, j) => j));
    for (let start = L.tableColumns; start < width; start += L.tableColumns - 1) {
      groups.push([0, ...Array.from({ length: Math.min(L.tableColumns - 1, width - start) }, (_, k) => start + k)]);
    }
  }
  const pieces: { columns: string[]; rows: string[][] }[] = [];
  for (const group of groups) {
    const cols = group.map((j) => header[j] ?? "");
    const groupRows = body.map((r) => group.map((j) => r[j] ?? ""));
    const rowChunks = Math.max(1, Math.ceil(groupRows.length / L.tableRows));
    for (let k = 0; k < rowChunks; k++) pieces.push({ columns: cols, rows: groupRows.slice(k * L.tableRows, (k + 1) * L.tableRows) });
  }
  const [first, ...rest] = pieces;
  c.columns = first!.columns;
  c.rows = first!.rows;
  rest.forEach((p) => detail("table", { columns: p.columns, rows: p.rows }));
  if (rest.length) notes.push(`a ${rows.length}×${width} table split into ${pieces.length} linked tables`);
  if (long.length) {
    detailText(long.join("\n\n"));
    notes.push(`${long.length} table cell(s) over ${L.tableCell} characters shortened; the full text is kept in a linked block`);
  }
}

/** A node's fields that say what it is or where it goes, never what it says. */
const STRUCTURAL_KEYS = new Set(["id", "type", "role", "importance", "sourceSpan", "stableKey", "parent", "origin", "kind", "ref", "shape", "arrangement", "language"]);

/** A node that fails its schema even after `repairEntry`: its text, as a "text" node — or null when it has none. */
export function salvage(entry: unknown, index: number): Raw | null {
  if (!isObject(entry)) return null;
  // Text the model put beside "content" instead of in it (`{"type":"text","markdown":"…"}`) is still its text.
  const loose = Object.entries(entry).flatMap(([k, v]) => (STRUCTURAL_KEYS.has(k) || k === "title" || k === "content" ? [] : nodeStrings({ content: v })));
  const strings = [...nodeStrings(entry), ...loose].filter((s) => s.trim());
  if (!strings.length) return null;
  const id = typeof entry.id === "string" && entry.id.trim() ? entry.id : `salvaged~${index}`;
  const kept = common(entry);
  if (typeof kept.title !== "string") delete kept.title;
  // A table keeps its rows and columns (as a Markdown table), never one cell per paragraph.
  const table = entry.type === "table" && isObject(entry.content) ? { ...entry.content } : null;
  const asTable = table && (normalizeTable(table), Array.isArray(table.columns) && Array.isArray(table.rows) && table.rows.length);
  const markdown = asTable ? markdownTable(table.columns as string[], table.rows as string[][]) : strings.join("\n\n");
  return { ...kept, id: id.slice(0, 200), type: "text", content: { markdown } };
}

/**
 * A node of a type `template` doesn't use, as nodes it does: a section (group) becomes a heading, anything else a
 * "text" block with the same content as Markdown (split when long). Returns the nodes and their links.
 */
export function convertNode(node: VisualNode, template: VisualTemplateDefinition): { nodes: VisualNode[]; relationships: RepairLink[] } {
  const base = common(node as unknown as Raw);
  if (node.type === "group") {
    const type = template.allowedNodeTypes.includes("heading") ? "heading" : "text";
    const converted = (type === "heading"
      ? { ...base, id: node.id, type, role: "section", content: { text: clip(node.content.label, TEXT_LIMITS.heading) } }
      : { ...base, id: node.id, type, content: { markdown: node.content.label } }) as VisualNode;
    return { nodes: [converted], relationships: [] };
  }
  const [first, ...rest] = chunkText(toMarkdown(node), TEXT_LIMITS.markdown);
  const nodes = [{ ...base, id: node.id, type: "text", content: { markdown: first } } as VisualNode];
  const relationships: RepairLink[] = [];
  rest.forEach((chunk, i) => {
    const id = `${node.id}~${i + 2}`;
    nodes.push({ id, type: "text", content: { markdown: chunk }, ...(node.parent ? { parent: node.parent } : {}) } as VisualNode);
    relationships.push({ from: node.id, to: id, type: "explained_by" });
  });
  return { nodes, relationships };
}

/** One section's overflow: how many nodes were folded, into how many "More from this section" pages, and which limit caused it. */
export interface OverflowDetail {
  section: string;
  folded: number;
  pages: number;
  why: "plan limit" | "section limit";
}

export interface NodeCaps {
  /** Content nodes in a plan without sections. */
  plan: number;
  /** Content nodes in one section of a sectioned plan. */
  section: number;
  /** Content nodes in a sectioned plan overall. */
  sectionedPlan: number;
}

/**
 * Keeps nodes (in order) up to `caps`, and folds the rest of each section into "More from this section" nodes
 * (pages where the template has them, else text) holding their content as Markdown — nothing past a cap is lost.
 */
/** `key` as is when short, else its first 120 characters and a hash of the whole, so distinct keys stay distinct and ids stay short. */
function shortKey(key: string): string {
  if (key.length <= 150) return key;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `${key.slice(0, 120)}#${h.toString(36)}`;
}

const MORE_TITLE = "More from this section";
/** Mirrors `SECTION_KEY_JOINER` (`visualize/outline.ts`; importing it would make this module depend on the visualize layer). */
const SECTION_JOINER = " ⨁ ";
/** The page title is clipped so a long section name can't break the title limit. */
const TITLE_LABEL_MAX = 120;

/**
 * The section's name for its overflow pages: its frame's label when it has one, else the last heading of its first unit (a flat plan's sections
 * are keyed by their units, "Chat › Topic ⨁ Chat › Other"); empty for a plan without sections.
 */
function pageLabel(section: string, groupLabels: ReadonlyMap<string, string>): string {
  const key = section.replace(/^§/, "");
  const framed = groupLabels.get(key);
  const raw = framed ?? (key.split(SECTION_JOINER)[0] ?? "").split(" › ").at(-1)!.replace(/ ·\d+$/, "").replace(/ #\d+$/, "");
  return clip(raw.replace(/\s+/g, " ").trim(), TITLE_LABEL_MAX);
}

/** "More from this section — Topic", with "(2 of 3)" when the section's overflow needed several pages; unchanged for a plan without sections. */
function pageTitle(label: string, page: number, pages: number): string {
  return `${MORE_TITLE}${label ? ` — ${label}` : ""}${pages > 1 ? ` (${page} of ${pages})` : ""}`;
}

export function foldOverflow(
  nodes: readonly VisualNode[],
  template: VisualTemplateDefinition,
  caps: NodeCaps,
  /**
   * Keys of nodes that are already there (an update's previous plan): they are kept as they are — never folded, so an update can't turn
   * what is on the canvas into a page — and count against the limits first, so only the nodes added on top of them can overflow.
   */
  existing: ReadonlySet<string> = new Set(),
): { nodes: VisualNode[]; folded: number; details: OverflowDetail[]; /** Existing nodes counted before anything was added (plain cards and frames are not). */ existingCounted: number } {
  // An outlined document's plan as an update compares it is flat (its sections are title headings, its nodes keyed
  // "<section> § <node>"): it is still sectioned, and each node counts against its own section.
  const flatSections = template.id === "sectioned" && !nodes.some((n) => n.type === "group");
  const sectioned = flatSections || nodes.some((n) => n.type === "group");
  const sectionOf = (n: VisualNode) => n.parent ?? (flatSections && n.stableKey?.includes(" § ") ? `§${n.stableKey.slice(0, n.stableKey.indexOf(" § "))}` : "");
  const perSection = new Map<string, number>();
  let total = 0;
  const kept: VisualNode[] = [];
  const overflow = new Map<string, VisualNode[]>();
  const why = new Map<string, OverflowDetail["why"]>();
  const isExisting = (n: VisualNode) => !!n.stableKey && existing.has(n.stableKey);
  for (const n of nodes) {
    if (n.type === "group" || n.origin === "plain" || !isExisting(n)) continue;
    const section = sectionOf(n);
    perSection.set(section, (perSection.get(section) ?? 0) + 1);
    total++;
  }
  const existingCounted = total;
  for (const n of nodes) {
    if (n.type === "group") {
      kept.push(n);
      continue;
    }
    // A plain card (and its section's title) keeps its place: it is one card in a section of its own, and folding it would turn it into a
    // "More from this section" page that has lost its own heading.
    if (n.origin === "plain") {
      kept.push(n);
      continue;
    }
    if (isExisting(n)) {
      kept.push(n);
      continue;
    }
    const section = sectionOf(n);
    const inSection = perSection.get(section) ?? 0;
    const fits = sectioned ? inSection < caps.section && total < caps.sectionedPlan : total < caps.plan;
    if (fits) {
      kept.push(n);
      perSection.set(section, inSection + 1);
      total++;
    } else {
      overflow.set(section, [...(overflow.get(section) ?? []), n]);
      // Why: the section's own limit, or the plan's overall one (for a sectioned plan the section limit is checked first).
      if (!why.has(section)) why.set(section, sectioned && inSection >= caps.section ? "section limit" : "plan limit");
    }
  }
  const details: OverflowDetail[] = [];
  let folded = 0;
  const usePage = template.allowedNodeTypes.includes("page");
  const groupLabels = new Map(nodes.flatMap((n) => (n.type === "group" ? [[n.id, n.content.label] as const] : [])));
  // The section a page belongs to, as its identity (a frame's key without its "§ group#0" suffix is the flat section's key, so a section is the same
  // section in a first import's plan and in a later merge's).
  const groupKeys = new Map(nodes.flatMap((n) => (n.type === "group" ? [[n.id, (n.stableKey ?? "").replace(/ § group#\d+$/, "") || n.id] as const] : [])));
  const logicalSection = (section: string) => (section ? (section.startsWith("§") ? section.slice(1) : (groupKeys.get(section) ?? section)) : "plan");
  for (const [section, list] of overflow) {
    folded += list.length;
    const markdown = list.map((n) => (n.title ? `**${n.title}**\n\n` : "") + toMarkdown(n)).join("\n\n---\n\n");
    // A fenced code block is not split across pages (`chunkText` `fenceSafe`; a block longer than a page still is).
    const chunks = chunkText(markdown, TEXT_LIMITS.markdown, { fenceSafe: true });
    const label = pageLabel(section, groupLabels);
    details.push({ section: section.replace(/^§/, "") || "plan", folded: list.length, pages: chunks.length, why: why.get(section) ?? "plan limit" });
    // A page's identity is its section's and its number, so pages of different sections can never share a key. A section that already has pages (an
    // earlier import's, in `existing`) gets its new ones numbered after them, so an update adds a page and never takes over an existing one. (Positional
    // keys, "page#0", which the pages got before, were the same in every plan: a merge's first page replaced the first import's first page in place.)
    const pagePrefix = `more~${shortKey(logicalSection(section))}~`;
    let after = 0;
    for (const key of existing) if (key.startsWith(pagePrefix)) after = Math.max(after, Number(key.slice(pagePrefix.length)) || 0);
    chunks.forEach((chunk, i) => {
      // A long section key (an outlined section's units joined) is shortened with a hash, never cut: cutting it lost the page
      // number and gave two pages one id, an invalid change set (live chat-import merge, 2026-10-10).
      const number = after + i + 1;
      const id = `more~${shortKey(section || "plan")}~${number}`;
      const stableKey = `${pagePrefix}${number}`;
      const title = pageTitle(label, i + 1, chunks.length);
      const parent = list[0]!.parent ? { parent: list[0]!.parent } : {};
      kept.push(
        (usePage
          ? { id, type: "page", stableKey, content: { title, markdown: chunk }, ...parent }
          : { id, type: "text", stableKey, title, content: { markdown: chunk }, ...parent }) as VisualNode,
      );
    });
  }
  return { nodes: kept, folded, details, existingCounted };
}
