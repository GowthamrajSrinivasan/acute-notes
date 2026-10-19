import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { buildContext, hasUsefulSelection, serializeContext, type ContextSource } from "./selectionContext";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#000",
    backgroundColor: "transparent",
    strokeWidth: 1,
    strokeStyle: "solid",
    ...partial,
  };
}

const block = (id: string, documentId: string) =>
  el({ id, type: "embeddable", customData: { acute: { kind: "rich-block", blockType: "text", documentId } } });
const page = (id: string, pageId: string) => el({ id, type: "embeddable", customData: { acute: { kind: "page-preview", pageId, preview: false } } });
const arrow = (id: string, from: string, to: string, relation?: string) =>
  el({ id, type: "arrow", startBinding: { elementId: from }, endBinding: { elementId: to }, customData: relation ? { acuteRelation: relation } : {} });

function doc(id: string, content: RichContent, extra: Partial<DocumentRecord> = {}): DocumentRecord {
  return { id, workspaceId: "ws", canvasId: "cv", kind: "block", title: "Untitled", snapshot: content, createdAt: 0, updatedAt: 0, ...extra };
}

const para = (text: string): RichContent => [{ type: "paragraph", content: text }];

function source(elements: SceneElement[], selectedIds: string[], docs: DocumentRecord[], workspaceDocs: DocumentRecord[] = []): ContextSource {
  const byId = new Map([...docs, ...workspaceDocs].map((d) => [d.id, d]));
  return {
    workspaceId: "ws",
    canvasId: "cv",
    elements,
    selectedIds,
    getDocument: (id) => byId.get(id),
    listWorkspaceDocuments: () => [...docs, ...workspaceDocs],
  };
}

describe("buildContext — selection scope", () => {
  const elements = [
    block("b1", "d1"),
    block("b2", "d2"),
    block("b3", "d3"),
    el({ id: "s1", type: "rectangle" }),
    el({ id: "t1", type: "text", text: "Database", containerId: "s1" }),
    arrow("a1", "b1", "s1", "depends_on"),
    arrow("a2", "b2", "b3"),
    el({ id: "f1", type: "freedraw" }),
  ];
  const docs = [doc("d1", para("Login flow")), doc("d2", para("Unrelated")), doc("d3", para("Also unrelated"))];

  it("includes the selected content, directly connected objects and their relationships only", () => {
    const ctx = buildContext(source(elements, ["b1", "f1"], docs), "selection");
    expect(ctx.items.map((i) => i.id)).toEqual(["b1"]);
    expect(ctx.nearby.map((i) => ({ id: i.id, text: i.text }))).toEqual([{ id: "s1", text: "Database" }]);
    expect(ctx.relations).toEqual([{ from: "b1", to: "s1", type: "depends_on" }]);
    // The drawing carries no content and is not reported as a context object.
    expect(ctx.selectedObjectIds).toEqual(["b1"]);
    expect(ctx.truncated).toBe(false);
  });

  it("serializes structured content and relations for the prompt, not ids", () => {
    const text = serializeContext(buildContext(source(elements, ["b1"], docs), "selection"));
    expect(text).toContain("## Selected objects");
    expect(text).toContain("### [1] Text block");
    expect(text).toContain("Login flow");
    expect(text).toContain("## Connected objects (not selected)");
    expect(text).toContain('### [2] Shape');
    expect(text).toContain("[1] → depends on → [2]");
    expect(text).not.toContain("b1");
  });
});

describe("buildContext — canvas and workspace scope", () => {
  it("canvas scope puts selected objects first and keeps relations among included objects", () => {
    const elements = [block("b1", "d1"), block("b2", "d2"), arrow("a1", "b1", "b2")];
    const ctx = buildContext(source(elements, ["b2"], [doc("d1", para("one")), doc("d2", para("two"))]), "canvas");
    expect(ctx.items.map((i) => i.id)).toEqual(["b2", "b1"]);
    expect(ctx.relations).toEqual([{ from: "b1", to: "b2" }]);
    expect(serializeContext(ctx)).toContain("(selected)");
  });

  it("workspace scope adds pages and blocks from other canvases, marked off-canvas", () => {
    const elements = [page("p1", "pg1")];
    const docs = [doc("pg1", para("Here"), { kind: "page", title: "Spec" })];
    const elsewhere = [
      doc("pg2", para("There"), { kind: "page", title: "Roadmap", canvasId: "other" }),
      doc("d9", [], { canvasId: "other" }), // empty: skipped
    ];
    const ctx = buildContext(source(elements, ["p1"], docs, elsewhere), "workspace");
    expect(ctx.items.map((i) => [i.id, i.kind, i.title, i.onCanvas])).toEqual([
      ["p1", "page", "Spec", true],
      ["pg2", "page", "Roadmap", false],
    ]);
    expect(serializeContext(ctx)).toContain('Page "Roadmap" (on another canvas)');
  });

  it("caps content per item and in total, and reports truncation", () => {
    const elements = [block("b1", "d1"), block("b2", "d2"), block("b3", "d3")];
    const docs = [doc("d1", para("a".repeat(50))), doc("d2", para("b".repeat(50))), doc("d3", para("c".repeat(50)))];
    const ctx = buildContext(source(elements, [], docs), "canvas", { perItem: 30, total: 70, maxNearby: 8 });
    expect(ctx.items).toHaveLength(3);
    expect(ctx.items[0]!.text.startsWith("a".repeat(30))).toBe(true);
    expect(ctx.items[2]!.text.startsWith("c".repeat(10))).toBe(true);
    expect(ctx.truncated).toBe(true);
    expect(serializeContext(ctx)).toContain("Some content was left out");
  });
});

describe("hasUsefulSelection", () => {
  const docs = new Map([
    ["d1", doc("d1", para("text"))],
    ["empty", doc("empty", [{ type: "paragraph", content: "" }])],
  ]);
  const get = (id: string) => docs.get(id);
  const elements = [
    block("b1", "d1"),
    block("b2", "empty"),
    el({ id: "s1", type: "rectangle" }),
    el({ id: "s2", type: "ellipse" }),
    el({ id: "t2", type: "text", text: "Label", containerId: "s2" }),
    el({ id: "img", type: "image", fileId: "f" }),
  ];

  it.each([
    [["b1"], true],
    [["b2"], false],
    [["s1"], false],
    [["s2"], true],
    [["img"], false],
    [["img", "s2"], true],
  ])("%j → %s", (ids, expected) => {
    expect(hasUsefulSelection(elements, Object.fromEntries(ids.map((id) => [id, true])), get)).toBe(expected);
  });
});

describe("composite shapes in the context", () => {
  it("names a cylinder as a data store, and reads its outline as part of it", () => {
    const elements = [
      el({ id: "b", type: "line", groupIds: ["g"], customData: { acuteShapePart: "body" } }),
      el({ id: "h", type: "rectangle", groupIds: ["g"], strokeColor: "transparent", customData: { acuteShape: "cylinder" } }),
      el({ id: "t", type: "text", text: "Orders DB", containerId: "h", groupIds: ["g"] }),
    ];
    const ctx = buildContext(source(elements, ["b", "h", "t"], []), "selection");
    expect(ctx.items).toEqual([expect.objectContaining({ id: "h", kind: "shape", text: "Orders DB", shape: "cylinder" })]);
    expect(serializeContext(ctx)).toMatch(/### \[1\] Shape \(cylinder: a database or data store[^)]*\)\nOrders DB/);
  });
});

describe("diagram and project node fields in the context (C6)", () => {
  it("reads a decision's reason and options, a question's answer and a node's sublabel and details", () => {
    const elements = [
      el({ id: "d", type: "rectangle", customData: { acuteNode: { kind: "decision", status: "proposed", reason: "Idempotent webhooks", options: [{ label: "Redis" }, { label: "Postgres" }] } } }),
      el({ id: "dt", type: "text", text: "Dedup store", containerId: "d" }),
      el({ id: "q", type: "rectangle", customData: { acuteNode: { kind: "open_question", status: "answered", answer: "Rotate every 30 days" } } }),
      el({ id: "n", type: "rectangle", customData: { acuteNode: { kind: "backend", sublabel: "payment.service.ts", details: ["Retries with backoff"] } } }),
      el({ id: "nt", type: "text", text: "Payments", containerId: "n" }),
      el({ id: "bare", type: "rectangle", customData: { acuteNode: { kind: "backend" } } }),
    ];
    const ctx = buildContext(source(elements, [], []), "canvas");
    const text = (id: string) => ctx.items.find((i) => i.id === id)?.text ?? "";
    expect(text("d")).toContain("Reason: Idempotent webhooks");
    expect(text("d")).toContain("Options: Redis; Postgres");
    expect(text("d").split("\n")[0]).toBe("Dedup store");
    expect(text("q")).toContain("Answer: Rotate every 30 days");
    expect(text("n")).toContain("payment.service.ts");
    expect(text("n")).toContain("Retries with backoff");
    // A kind alone on an unlabelled shape is not content.
    expect(ctx.items.some((i) => i.id === "bare")).toBe(false);
  });
});
