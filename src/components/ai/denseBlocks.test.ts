import { beforeEach, describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichBlockType, RichContent } from "@/domain/types";
import { denseBlocks } from "./denseBlocksStore";
import { denseEntries } from "./flagDense";

const long = (n: number) => `${"x".repeat(n - 1)}.`;

function block(id: string, blockType: RichBlockType, at: { x: number; y: number }, extra: Partial<SceneElement> = {}): SceneElement {
  return { id, type: "embeddable", x: at.x, y: at.y, width: 300, height: 200, isDeleted: false, customData: { acute: { kind: "rich-block", blockType, documentId: `doc_${id}` } }, ...extra } as unknown as SceneElement;
}

describe("denseEntries", () => {
  const docs = new Map<string, RichContent>([
    ["doc_table", [{ type: "table", content: { type: "tableContent", rows: [{ cells: ["1", long(900)] }] } }]],
    ["doc_short", [{ type: "paragraph", content: "Short." }]],
    ["doc_text", [{ type: "paragraph", content: long(1_500) }]],
    ["doc_old", [{ type: "paragraph", content: long(1_500) }]],
  ]);
  const getDocument = (id: string) => (docs.has(id) ? ({ id, snapshot: docs.get(id)! } as DocumentRecord) : undefined);

  it("only the added rich blocks that are dense, in reading order (top to bottom, then left to right)", () => {
    const elements = [
      block("text", "text", { x: 0, y: 500 }),
      block("table", "table", { x: 400, y: 0 }),
      block("short", "text", { x: 0, y: 0 }),
      block("old", "text", { x: 0, y: 0 }), // dense, but not part of this change set
      { ...block("gone", "text", { x: 0, y: 0 }), isDeleted: true } as SceneElement,
      { id: "shape", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false } as unknown as SceneElement,
    ];
    const entries = denseEntries(elements, ["text", "table", "short", "gone", "shape"], getDocument);
    expect(entries).toEqual([
      { id: "table", reason: "A table cell holds 900 characters", cause: "long_cell" },
      { id: "text", reason: "The text holds 1,500 characters", cause: "long_text" },
    ]);
  });
});

describe("denseBlocks store", () => {
  beforeEach(() => denseBlocks.reset());
  const entries = ["a", "b", "c"].map((id) => ({ id, reason: `why ${id}`, cause: "long_cell" as const }));

  it("adds a change set's entries after earlier ones, once each", () => {
    denseBlocks.add("cv", entries.slice(0, 2));
    denseBlocks.add("cv", [entries[0]!, entries[2]!]);
    expect(denseBlocks.get("cv").entries.map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(denseBlocks.get("other").entries).toEqual([]);
  });

  it("walks through entries; dismissing the current one moves on to the next, and the last one ends the walk", () => {
    denseBlocks.add("cv", entries);
    denseBlocks.show("cv", "b");
    expect(denseBlocks.get("cv").current).toBe("b");
    denseBlocks.show("cv", "unknown"); // not flagged: ignored
    expect(denseBlocks.get("cv").current).toBe("b");
    denseBlocks.dismiss("cv", "b");
    expect(denseBlocks.get("cv")).toMatchObject({ current: "c", entries: [{ id: "a" }, { id: "c" }] });
    denseBlocks.dismiss("cv", "c");
    expect(denseBlocks.get("cv").current).toBe("a");
    denseBlocks.dismiss("cv", "a");
    expect(denseBlocks.get("cv")).toEqual({ entries: [], current: null });
  });

  it("stopping the walk keeps the badges", () => {
    denseBlocks.add("cv", entries);
    denseBlocks.show("cv", "a");
    denseBlocks.show("cv", null);
    expect(denseBlocks.get("cv")).toMatchObject({ current: null });
    expect(denseBlocks.get("cv").entries).toHaveLength(3);
  });
});

describe("denseBlocks.dismissAll (Wave D: one summary, Dismiss all)", () => {
  beforeEach(() => denseBlocks.reset());

  it("stops pointing out every dense block of the canvas, and ends the walk-through; other canvases keep theirs", () => {
    const entry = (id: string) => ({ id, reason: "a long cell", cause: "long_cell" as const });
    denseBlocks.add("c1", [entry("a"), entry("b")]);
    denseBlocks.add("c2", [entry("z")]);
    denseBlocks.show("c1", "b");
    denseBlocks.dismissAll("c1");
    expect(denseBlocks.get("c1")).toEqual({ entries: [], current: null });
    expect(denseBlocks.get("c2").entries.map((e) => e.id)).toEqual(["z"]);
  });
});
