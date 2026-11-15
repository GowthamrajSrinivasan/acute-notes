import { createParser, type ElementNode } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { acuteCardLibrary } from "@/ai/openui/library";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { buildNotes, noteLang, readingOrder, splitBody } from "./notesModel";

const el = (id: string, x: number, y: number, extra: Partial<SceneElement> & { name?: string } = {}): SceneElement =>
  ({ id, type: "embeddable", x, y, width: 200, height: 100, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid", ...extra }) as SceneElement;
const block = (id: string, x: number, y: number, frameId?: string) =>
  el(id, x, y, { customData: { acute: { kind: "rich-block", blockType: "text", documentId: `d-${id}` } }, ...(frameId ? { frameId } : {}) });
const frame = (id: string, x: number, y: number, name: string) => el(id, x, y, { type: "frame", width: 900, height: 600, name });

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const doc = (id: string, title: string, snapshot: RichContent): DocumentRecord => ({ id, workspaceId: "w", kind: "block", title, snapshot, createdAt: 0, updatedAt: 0 });

const parse = (lang: string) => createParser(acuteCardLibrary.toJSONSchema()).parse(lang);

describe("readingOrder", () => {
  it("reads a slightly ragged grid row by row, left to right", () => {
    const items = [
      { id: "b", x: 300, y: 8, height: 100 },
      { id: "a", x: 0, y: 0, height: 100 },
      { id: "d", x: 300, y: 160, height: 100 },
      { id: "c", x: 0, y: 150, height: 100 },
    ];
    expect(readingOrder(items).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("splitBody (progressive disclosure)", () => {
  it("keeps a short body whole", () => {
    expect(splitBody("Short idea.")).toEqual({ body: "Short idea." });
  });
  it("puts later paragraphs behind More", () => {
    const first = "First paragraph. ".repeat(10).trim();
    const second = "Second paragraph. ".repeat(10).trim();
    expect(splitBody(`${first}\n\n${second}`)).toEqual({ body: first, detail: second });
  });
  it("cuts an over-long first paragraph at a sentence, never mid-sentence", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} says something useful.`).join(" ");
    const { body, detail } = splitBody(text, 120);
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body.endsWith(".")).toBe(true);
    expect(`${body} ${detail}`).toBe(text);
  });
});

describe("buildNotes", () => {
  const docs = new Map<string, DocumentRecord>([
    ["d-t1", doc("d-t1", "Caching", [p("Caching")])], // the section's title card
    ["d-n1", doc("d-n1", "Untitled", [p("Edge caches serve stale content"), p("Until the TTL expires, edits are invisible.")])],
    ["d-n2", doc("d-n2", "Purge on deploy", [p("Purge on deploy"), p("Deploys purge the CDN by surrogate key.")])],
    ["d-n3", doc("d-n3", "Loose note", [p("Loose note"), p("Outside any frame.")])],
    ["d-tb", doc("d-tb", "Queues", [p("Queues"), { type: "table", content: { type: "tableContent", rows: [{ cells: ["Queue", "Ordering"] }, { cells: ["SQS FIFO", "Strict"] }] } }])],
    ["d-empty", doc("d-empty", "Untitled", [])],
  ]);
  const getDocument = (id: string) => docs.get(id);
  const scene = [
    frame("f2", 0, 1000, "Choices"),
    frame("f1", 0, 0, "Caching"),
    block("n2", 300, 120, "f1"),
    block("t1", 0, 10, "f1"),
    block("n1", 0, 120, "f1"),
    block("tb", 0, 1100, "f2"),
    block("n3", 2000, 0),
    block("empty", 0, 300, "f1"),
    { ...block("gone", 0, 400, "f1"), isDeleted: true },
    el("arrow", 0, 0, { type: "arrow" }),
    el("a1", 0, 0, { type: "arrow", startBinding: { elementId: "n3" }, endBinding: { elementId: "n1" } }),
    el("a2", 0, 0, { type: "arrow", startBinding: { elementId: "n1" }, endBinding: { elementId: "frame-or-shape" } }),
  ];

  it("makes one section per frame in reading order, then the cards outside frames", () => {
    const sections = buildNotes(scene, getDocument);
    expect(sections.map((s) => [s.title, s.notes.map((n) => n.id)])).toEqual([
      ["Caching", ["n1", "n2"]],
      ["Choices", ["tb"]],
      ["Notes outside sections", ["n3"]],
    ]);
  });

  it("titles an untitled card by its first line, keeps the rest as body", () => {
    const n1 = buildNotes(scene, getDocument)[0]!.notes[0]!;
    expect([n1.title, n1.body]).toEqual(["Edge caches serve stale content", "Until the TTL expires, edits are invisible."]);
    expect(n1.onCanvas).toBe(true);
  });

  it("carries a table, and the distil link's citations and open review", () => {
    const sections = buildNotes(scene, getDocument, [
      { objectId: "n2", sourceId: "s1", version: 3, cites: ["u4", "u7"], review: { reasons: ["qualifier dropped: drops usually"] } },
      { objectId: "n1", sourceId: "s1", version: 3, cites: ["u2"], review: { reasons: ["x"], resolved: "kept" } },
    ]);
    const [n1, n2] = sections[0]!.notes;
    expect(n2).toMatchObject({ cites: ["u4", "u7"], needsReview: "qualifier dropped: drops usually", source: { sourceId: "s1", version: 3 } });
    expect(n1!.needsReview).toBeUndefined();
    expect(sections[1]!.notes[0]!.table).toEqual({ columns: ["Queue", "Ordering"], rows: [["SQS FIFO", "Strict"]] });
  });
});

describe("cross-note links", () => {
  it("relates two notes joined by an arrow, both ways; ignores arrows to anything else", () => {
    const docs = new Map([
      ["d-n1", doc("d-n1", "One", [p("One"), p("a")])],
      ["d-n3", doc("d-n3", "Three", [p("Three"), p("c")])],
    ]);
    const sections = buildNotes(
      [block("n1", 0, 0), block("n3", 0, 300), el("a1", 0, 0, { type: "arrow", startBinding: { elementId: "n3" }, endBinding: { elementId: "n1" } }), el("a2", 0, 0, { type: "arrow", startBinding: { elementId: "n1" }, endBinding: { elementId: "s9" } })],
      (id) => docs.get(id),
    );
    expect(sections[0]!.notes.map((n) => [n.id, n.related])).toEqual([
      ["n1", ["n3"]],
      ["n3", ["n1"]],
    ]);
    const { root, meta } = parse(noteLang(sections[0]!.notes[0]!));
    expect(meta.errors).toEqual([]);
    expect((root!.props.extras as ElementNode[]).map((x) => [x.typeName, x.props.target])).toEqual([["NoteLink", "n3"]]);
  });
});

describe("noteLang", () => {
  it("emits Lang the library parses with no errors, every field in its place", () => {
    const lang = noteLang({
      title: 'Purge "on" deploy',
      body: "Deploys purge the CDN.\nBy surrogate key.",
      detail: "More words.",
      cites: ["u4", "u7"],
      needsReview: "qualifier dropped",
      table: { columns: ["A", "B"], rows: [["1", "2"]] },
    });
    const { root, meta } = parse(lang);
    expect(meta.errors).toEqual([]);
    expect(meta.unresolved).toEqual([]);
    expect(root!.typeName).toBe("IdeaCard");
    expect(root!.props.title).toBe('Purge "on" deploy');
    expect(root!.props.body).toBe("Deploys purge the CDN.\nBy surrogate key.");
    expect(root!.props.detail).toBe("More words.");
    expect((root!.props.citations as ElementNode[]).map((c) => c.props.unit)).toEqual(["u4", "u7"]);
    expect((root!.props.extras as ElementNode[]).map((c) => c.typeName)).toEqual(["Callout", "ComparisonTable"]);
  });

  it("stays as short as a hand-written card when there is nothing optional", () => {
    expect(noteLang({ title: "T", body: "B", cites: [] })).toBe('root = IdeaCard("T", "B")');
    const { meta } = parse(noteLang({ title: "T", body: "B", cites: [], detail: "D" }));
    expect(meta.errors).toEqual([]);
  });
});
