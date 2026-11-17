import { createParser, type ElementNode } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { buildNotes, noteLang as notesViewLang } from "@/components/openui/notes/notesModel";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { cardLangOf, cardShapeOf, noteLang } from "./cardLang";
import { acuteCardLibrary } from "./library";

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const doc = (id: string, title: string, snapshot: RichContent): DocumentRecord => ({ id, workspaceId: "w", kind: "block", title, snapshot, createdAt: 0, updatedAt: 0 });
const block = (id: string, y: number): SceneElement =>
  ({
    id,
    type: "embeddable",
    x: 0,
    y,
    width: 200,
    height: 100,
    angle: 0,
    isDeleted: false,
    groupIds: [],
    customData: { acute: { kind: "rich-block", blockType: "text", documentId: `d-${id}` } },
  }) as unknown as SceneElement;
const parse = (lang: string) => createParser(acuteCardLibrary.toJSONSchema()).parse(lang);

const LONG = Array.from({ length: 10 }, (_, i) => `Sentence ${i} explains one more condition of the purge.`).join(" ");
const DOCS = new Map<string, DocumentRecord>([
  ["d-a", doc("d-a", "Purge on deploy", [p("Purge on deploy"), p("Deploys purge the CDN by surrogate key.")])],
  ["d-b", doc("d-b", "Untitled", [p("Stale window"), p(LONG)])],
  [
    "d-c",
    doc("d-c", "Queues", [
      p("Queues"),
      { type: "table" as const, content: { type: "tableContent", rows: [{ cells: [["Queue"], ["Ordering"]] }, { cells: [["SQS FIFO"], ["Strict"]] }] } } as unknown as RichContent[number],
    ]),
  ],
]);

describe("cardLangOf (the canvas's Cards view)", () => {
  it("gives exactly the Lang the Notes view gives the same card, citations and open review included", () => {
    const knowledge = [
      { objectId: "a", sourceId: "s1", version: 2, cites: ["u1", "u2"], review: { reasons: ["qualifier dropped: usually"] } },
      { objectId: "b", sourceId: "s1", version: 2, cites: ["u3"] },
      { objectId: "c", sourceId: "s1", version: 2, cites: ["u4"] },
    ];
    const notes = buildNotes([block("a", 0), block("b", 200), block("c", 400)], (id) => DOCS.get(id), knowledge).flatMap((s) => s.notes);
    expect(notes).toHaveLength(3);
    for (const n of notes) {
      const lang = cardLangOf(DOCS.get(`d-${n.id}`)!, { cites: n.cites, ...(n.needsReview ? { needsReview: n.needsReview } : {}) });
      expect(lang, n.id).toBe(notesViewLang(n));
      expect(parse(lang!).meta.errors, n.id).toEqual([]);
    }
  });

  it("draws the citations, the Needs review callout, a table and a long card's detail", () => {
    const withReview = parse(cardLangOf(DOCS.get("d-a")!, { cites: ["u1"], needsReview: "condition dropped" })!).root!;
    expect(withReview.props.title).toBe("Purge on deploy");
    expect((withReview.props.citations as ElementNode[]).map((c) => c.props.unit)).toEqual(["u1"]);
    expect((withReview.props.extras as ElementNode[]).map((x) => [x.typeName, x.props.text])).toEqual([["Callout", "Needs review: condition dropped"]]);

    const long = parse(cardLangOf(DOCS.get("d-b")!, { cites: [] })!).root!;
    expect(long.props.title).toBe("Stale window");
    expect(typeof long.props.detail).toBe("string");
    expect(`${long.props.body as string} ${long.props.detail as string}`).toBe(LONG);

    const table = parse(cardLangOf(DOCS.get("d-c")!)!).root!;
    expect((table.props.extras as ElementNode[]).map((x) => x.typeName)).toEqual(["ComparisonTable"]);
  });

  it("is deterministic, and null for a card with nothing to show", () => {
    const rec = DOCS.get("d-a")!;
    expect(cardLangOf(rec, { cites: ["u1"] })).toBe(cardLangOf(rec, { cites: ["u1"] }));
    expect(cardLangOf(doc("e", "Untitled", []))).toBeNull();
    expect(cardShapeOf(doc("e", "Untitled", [p("   ")]))).toBeNull();
  });

  it("is the same builder the Notes view re-exports", () => {
    expect(notesViewLang).toBe(noteLang);
  });
});
