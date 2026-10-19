import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { CanvasDocument, ContentBlock, DocumentRecord, RichContent, Workspace } from "@/domain/types";
import { RESOURCE_LIMITS, RESOURCE_VERSION, serializeCanvas, serializePage, serializeTable, serializeTodo, serializeWorkspace } from "./serializers";
import { parseResourceUri, resourceUri } from "./uris";

const el = (id: string, type: string, x = 0, y = 0, extra: Partial<SceneElement> = {}): SceneElement => ({
  id,
  type,
  x,
  y,
  width: 100,
  height: 60,
  angle: 0,
  locked: false,
  opacity: 100,
  isDeleted: false,
  groupIds: [],
  strokeColor: "#000",
  backgroundColor: "transparent",
  strokeWidth: 1,
  strokeStyle: "solid",
  ...extra,
});
const block = (id: string, documentId: string, blockType = "text") =>
  el(id, "embeddable", 0, 0, { customData: { acute: { kind: "rich-block", blockType, documentId, style: {} } } });
const doc = (id: string, snapshot: RichContent, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  workspaceId: "ws",
  kind: "block",
  title: "Untitled",
  snapshot,
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});
const ws: Workspace = { id: "ws", name: "Team", canvasIds: ["cv_b", "cv_a", "cv_missing"], createdAt: 1, updatedAt: 2 };
const canvas = (id: string, extra: Partial<CanvasDocument> = {}): CanvasDocument => ({ id, workspaceId: "ws", title: id, createdAt: 1, updatedAt: 2, ...extra });
const check = (text: string, checked = false, children?: ContentBlock[]): ContentBlock => ({
  id: `b_${text}`,
  type: "checkListItem",
  props: { checked },
  content: text,
  ...(children ? { children } : {}),
});

describe("resource URIs", () => {
  it("round-trip, escape ids, and reject anything else", () => {
    expect(resourceUri("page", "page_1")).toBe("acute://page/page_1");
    expect(parseResourceUri(resourceUri("todo", "a b/c"))).toEqual({ kind: "todo", id: "a b/c" });
    expect(parseResourceUri("acute://secret/x")).toBeNull();
    expect(parseResourceUri("https://page/x")).toBeNull();
  });
});

describe("serializeWorkspace", () => {
  it("lists canvases in workspace order and pages newest first, only this workspace's", () => {
    const out = serializeWorkspace(
      ws,
      [canvas("cv_a"), canvas("cv_b"), canvas("cv_foreign", { workspaceId: "other" })],
      [
        doc("p_old", [], { kind: "page", title: "Old", updatedAt: 1 }),
        doc("p_new", [], { kind: "page", title: "New", updatedAt: 9, canvasId: "cv_a" }),
        doc("p_foreign", [], { kind: "page", title: "Private", workspaceId: "other" }),
        doc("blk", [], { kind: "block" }),
      ],
    );
    expect(out).toMatchObject({ uri: "acute://workspace/ws", kind: "workspace", version: RESOURCE_VERSION, id: "ws", name: "Team", truncated: false });
    expect(out.canvases.map((c) => [c.id, c.uri])).toEqual([
      ["cv_b", "acute://canvas/cv_b"],
      ["cv_a", "acute://canvas/cv_a"],
    ]);
    expect(out.pages).toEqual([
      { id: "p_new", title: "New", uri: "acute://page/p_new", updatedAt: 9, canvasId: "cv_a" },
      { id: "p_old", title: "Old", uri: "acute://page/p_old", updatedAt: 1 },
    ]);
    expect(out.counts).toEqual({ canvases: 2, pages: 2 });
  });

  it("caps pages and says so", () => {
    const pages = Array.from({ length: RESOURCE_LIMITS.pages + 5 }, (_, i) => doc(`p${i}`, [], { kind: "page", updatedAt: i }));
    const out = serializeWorkspace(ws, [], pages);
    expect(out.pages).toHaveLength(RESOURCE_LIMITS.pages);
    expect(out.counts.pages).toBe(RESOURCE_LIMITS.pages + 5);
    expect(out.truncated).toBe(true);
  });
});

describe("serializeCanvas", () => {
  const docs = new Map([
    ["d_todo", doc("d_todo", [check("Ship")], { title: "Launch" })],
    ["d_text", doc("d_text", [{ type: "paragraph", content: "Hello world" }], { metadata: { ai: { createdBy: "ai", task: "summarize", apiKey: "sk-live" } as never } })],
  ]);
  const elements = [
    block("todo", "d_todo", "todo"),
    block("text", "d_text"),
    el("shape", "rectangle", 300, 0, { customData: { token: "ghp_x" } }),
    el("shape-label", "text", 0, 0, { containerId: "shape", text: "Gateway", originalText: "Gateway" }),
    el("a1", "arrow", 0, 0, { startBinding: { elementId: "text" }, endBinding: { elementId: "todo" }, customData: { acuteRelation: "depends_on" } }),
    el("a2", "arrow", 0, 0, { startBinding: { elementId: "shape" }, endBinding: { elementId: "todo" } }),
    el("a3", "arrow", 0, 0, { startBinding: { elementId: "shape" }, endBinding: { elementId: "gone" } }),
    el("gone", "rectangle", 0, 0, { isDeleted: true }),
  ];

  it("lists standalone objects in z-order with typed kinds, links and relations between them", () => {
    const out = serializeCanvas(canvas("cv_a", { title: "Payments" }), elements, (id) => docs.get(id));
    expect(out).toMatchObject({ uri: "acute://canvas/cv_a", kind: "canvas", workspaceId: "ws", workspaceUri: "acute://workspace/ws", title: "Payments" });
    expect(out.objects.map((o) => [o.id, o.kind])).toEqual([
      ["todo", "todo"],
      ["text", "text"],
      ["shape", "rectangle"],
    ]);
    expect(out.objects[0]).toMatchObject({ title: "Launch", excerpt: "Ship", uri: "acute://todo/todo" });
    expect(out.objects[1]).toMatchObject({ excerpt: "Hello world", provenance: { createdBy: "ai", task: "summarize" } });
    expect(out.objects[2]).toMatchObject({ excerpt: "Gateway", bounds: { x: 300, y: 0, width: 100, height: 60 } });
    expect(out.relations).toEqual([
      { from: "text", to: "todo", arrowId: "a1", type: "depends_on" },
      { from: "shape", to: "todo", arrowId: "a2" },
    ]);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/sk-live|apiKey|ghp_x|token|customData/);
  });

  it("caps objects and excerpts", () => {
    const many = Array.from({ length: RESOURCE_LIMITS.objects + 10 }, (_, i) => el(`r${i}`, "rectangle", i, 0));
    const out = serializeCanvas(canvas("cv"), many, () => undefined);
    expect(out.objects).toHaveLength(RESOURCE_LIMITS.objects);
    expect(out.counts.objects).toBe(RESOURCE_LIMITS.objects + 10);
    expect(out.truncated).toBe(true);

    const long = serializeCanvas(canvas("cv"), [block("b", "d")], () => doc("d", [{ type: "paragraph", content: "x".repeat(5000) }]));
    expect(long.objects[0]!.excerpt).toHaveLength(RESOURCE_LIMITS.objectExcerpt);
    expect(long.truncated).toBe(true);
  });
});

describe("serializePage", () => {
  it("returns Markdown with unsafe links reduced to text, and sanitized provenance", () => {
    const page = doc(
      "p1",
      [
        { type: "heading", props: { level: 2 }, content: "Plan" },
        { type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "click", styles: {} }] }] },
        { type: "paragraph", content: [{ type: "link", href: "https://example.com", content: [{ type: "text", text: "site", styles: {} }] }] },
      ],
      { kind: "page", title: "Design", canvasId: "cv_a", metadata: { ai: { createdBy: "mcp", secret: "s3cret" } as never } },
    );
    const out = serializePage(page);
    expect(out).toMatchObject({ uri: "acute://page/p1", kind: "page", title: "Design", canvasId: "cv_a", canvasUri: "acute://canvas/cv_a", provenance: { createdBy: "mcp" }, truncated: false });
    expect(out.markdown).toContain("## Plan");
    expect(out.markdown).toContain("[site](https://example.com)");
    expect(out.markdown).not.toContain("javascript:");
    expect(JSON.stringify(out)).not.toContain("s3cret");
  });

  it("cuts long pages and reports the full size", () => {
    const out = serializePage(doc("p", [{ type: "paragraph", content: "y".repeat(50_000) }], { kind: "page" }));
    expect(out.markdown).toHaveLength(RESOURCE_LIMITS.pageChars);
    expect(out.counts.characters).toBeGreaterThan(50_000);
    expect(out.truncated).toBe(true);
  });
});

describe("serializeTodo", () => {
  const obj = (snapshot: RichContent) => ({ canvas: canvas("cv_a"), element: block("t1", "d_t", "todo"), record: doc("d_t", snapshot, { title: "Launch" }) });

  it("flattens items with stable ids, checked state and nesting", () => {
    const out = serializeTodo(obj([{ type: "heading", content: "Week 1" }, check("Write spec", true, [check("Review")]), check("Ship")]));
    expect(out).toMatchObject({ uri: "acute://todo/t1", kind: "todo", id: "t1", documentId: "d_t", canvasId: "cv_a", canvasUri: "acute://canvas/cv_a", title: "Launch" });
    expect(out.items).toEqual([
      { text: "Week 1", depth: 0 },
      { id: "b_Write spec", text: "Write spec", checked: true, depth: 0 },
      { id: "b_Review", text: "Review", checked: false, depth: 1 },
      { id: "b_Ship", text: "Ship", checked: false, depth: 0 },
    ]);
    expect(out.counts).toEqual({ items: 4, checklistItems: 3, done: 1 });
    expect(out.truncated).toBe(false);
  });

  it("caps item count, item length and the total", () => {
    const many = serializeTodo(obj(Array.from({ length: RESOURCE_LIMITS.todoItems + 1 }, (_, i) => check(`i${i}`))));
    expect(many.items).toHaveLength(RESOURCE_LIMITS.todoItems);
    expect(many.truncated).toBe(true);

    const long = serializeTodo(obj(Array.from({ length: 100 }, (_, i) => check(`${i}`.padEnd(2000, "z")))));
    expect(long.items[0]!.text).toHaveLength(RESOURCE_LIMITS.itemChars);
    expect(long.items.reduce((n, i) => n + i.text.length, 0)).toBeLessThanOrEqual(RESOURCE_LIMITS.contentChars);
    expect(long.truncated).toBe(true);
  });
});

describe("serializeTable", () => {
  const table = (rows: string[][], headerRows = 1): ContentBlock => ({ type: "table", content: { type: "tableContent", headerRows, rows: rows.map((cells) => ({ cells })) } });
  const obj = (snapshot: RichContent) => ({ canvas: canvas("cv_a"), element: block("tb", "d_tb", "table"), record: doc("d_tb", snapshot, { title: "Options" }) });

  it("returns header rows, plain-text cells and other content as notes", () => {
    const out = serializeTable(
      obj([
        { type: "paragraph", content: "Pricing" },
        table([
          ["Plan", "Cost"],
          ["Free", "$0"],
        ]),
      ]),
    );
    expect(out).toMatchObject({ uri: "acute://table/tb", kind: "table", id: "tb", documentId: "d_tb", title: "Options", headerRows: 1, notes: "Pricing" });
    expect(out.rows).toEqual([
      ["Plan", "Cost"],
      ["Free", "$0"],
    ]);
    expect(out.counts).toEqual({ rows: 2, columns: 2, tables: 1 });
    expect(out.truncated).toBe(false);
  });

  it("caps rows, columns, cell length and the total", () => {
    const wide = Array.from({ length: RESOURCE_LIMITS.tableRows + 5 }, (_, r) => Array.from({ length: RESOURCE_LIMITS.tableColumns + 3 }, (_, c) => `r${r}c${c}`.padEnd(1000, "q")));
    const out = serializeTable(obj([table(wide)]));
    expect(out.rows.length).toBeLessThanOrEqual(RESOURCE_LIMITS.tableRows);
    expect(out.rows.every((r) => r.length <= RESOURCE_LIMITS.tableColumns)).toBe(true);
    expect(out.rows[0]![0]).toHaveLength(RESOURCE_LIMITS.cellChars);
    expect(out.rows.flat().reduce((n, c) => n + c.length, 0)).toBeLessThanOrEqual(RESOURCE_LIMITS.contentChars);
    expect(out.counts).toMatchObject({ rows: RESOURCE_LIMITS.tableRows + 5, columns: RESOURCE_LIMITS.tableColumns + 3 });
    expect(out.truncated).toBe(true);
  });
});
