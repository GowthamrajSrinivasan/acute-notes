import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import type { InlineContent, RichContent } from "@/domain/types";
import { CARD_MAX_CHARS, leadOf, splitLocally, statusOf } from "./splitLocally";
import { proposeSplit } from "./visualizeBetter";

type Plan = { nodes: { id: string; type: string; title?: string; stableKey?: string; content: Record<string, unknown> }[]; relationships: { from: string; to: string; type: string }[] };

const text = (t: string): InlineContent => ({ type: "text", text: t, styles: {} });
const bold = (t: string): InlineContent => ({ type: "text", text: t, styles: { bold: true } });
const table = (rows: (string | InlineContent[])[][]): RichContent => [{ type: "table", content: { type: "tableContent", headerRows: 1, rows: rows.map((cells) => ({ cells })) } }];
const sentences = (n: number, word = "detail") => Array.from({ length: n }, (_, i) => `Sentence ${i + 1} gives more ${word} about this item.`).join(" ");

const WAVE: RichContent = table([
  ["Order", "Item", "Size"],
  ["1", [bold("Levels for Repo Map, with the budget per iteration (user's refinement)."), text(` ${sentences(20)}`)], "M"],
  ["✅ 2", [bold("Right-angle arrows — done."), text(" Orthogonal routing with side contracts.")], "S–M"],
  ["3", "Zoom-dependent detail. Below a zoom threshold, previews show the title only, and the full text at normal zoom.", "—"],
]);

describe("leadOf", () => {
  it("takes a cell's leading bold text as its title, and the rest as its body", () => {
    expect(leadOf("**Tidy map** — a pass over one section. It moves cards.")).toEqual({ title: "Tidy map", rest: "a pass over one section. It moves cards." });
  });

  it("else its first sentence", () => {
    expect(leadOf("Source markers. A small SRC marker on cards.")).toEqual({ title: "Source markers", rest: "A small SRC marker on cards." });
  });

  it("shortens a long lead at a clause boundary, keeping the whole text in the body", () => {
    const md = "**Levels for Repo Map, with the budget per iteration (user's refinement, 2026-09-27).** No cap on the map.";
    expect(leadOf(md)).toEqual({ title: "Levels for Repo Map", rest: md });
  });
});

describe("splitLocally — a dense table", () => {
  const plan = splitLocally(WAVE, "Wave 1b") as Plan;
  const cards = plan.nodes.filter((n) => n.type === "text");

  it("makes one card per row, titled by its wordy cell's lead, with its short values on a meta line", () => {
    expect(cards.map((c) => c.title)).toEqual(["Levels for Repo Map", "Right-angle arrows — done", "Zoom-dependent detail"]);
    expect(cards[1]!.content.markdown).toBe("**Order:** ✅ 2 · **Size:** S–M\n\nOrthogonal routing with side contracts.");
    // A blank value ("—") isn't shown.
    expect(cards[2]!.content.markdown).toBe("**Order:** 3\n\nBelow a zoom threshold, previews show the title only, and the full text at normal zoom.");
    expect(cards.map((c) => c.stableKey)).toEqual(["table0.row#0", "table0.row#1", "table0.row#2"]);
  });

  it("a card that would be long keeps its gist, and its full text goes on a linked page", () => {
    const long = cards[0]!;
    expect((long.content.markdown as string).length).toBeLessThanOrEqual(CARD_MAX_CHARS);
    expect(long.content.markdown).toMatch(/^\*\*Order:\*\* 1 · \*\*Size:\*\* M\n\n/);
    expect(long.content.markdown).toMatch(/…$/);
    const page = plan.nodes.find((n) => n.type === "page")!;
    expect(page.content.title).toBe("Levels for Repo Map");
    expect(page.content.markdown).toContain("Sentence 20 gives more detail"); // nothing is lost
    expect(plan.relationships).toEqual([{ from: long.id, to: page.id, type: "explained_by" }]);
  });

  it("keeps the block's other content as text, and drops a heading repeating its title", () => {
    const content: RichContent = [{ type: "heading", props: { level: 3 }, content: "Wave 1b" }, { type: "paragraph", content: "Learned from Archify." }, ...WAVE];
    const nodes = (splitLocally(content, "Wave 1b") as Plan).nodes;
    expect(nodes[0]).toMatchObject({ type: "text", content: { markdown: "Learned from Archify." } });
    expect(JSON.stringify(nodes)).not.toContain('"text":"Wave 1b"');
  });
});

describe("splitLocally — a dense checklist", () => {
  const item = (t: string, checked = false): RichContent[number] => ({ type: "checkListItem", props: { checked }, content: t });

  it("keeps short items as a checklist, and makes each paragraph-long item a card with its status, in order", () => {
    const content = [item("Run the e2e specs"), item(`F43 real-client check, VS Code (Copilot agent mode): to do by hand. ${sentences(8)}`), item("Record results", true)];
    const plan = splitLocally(content, "L3") as Plan;
    expect(plan.nodes.map((n) => [n.type, n.title ?? ""])).toEqual([
      ["todo", ""],
      ["text", "F43 real-client check"],
      ["todo", ""],
    ]);
    expect(plan.nodes[0]!.content.items).toEqual([{ text: "Run the e2e specs", checked: false }]);
    expect(plan.nodes[1]!.content.markdown).toMatch(/^\*\*Status:\*\* ☐ To do\n\n/);
    expect(plan.nodes[2]!.content.items).toEqual([{ text: "Record results", checked: true }]);
  });
});

describe("splitLocally — nothing to split without AI", () => {
  it("prose alone, or a checklist of short items", () => {
    expect(splitLocally([{ type: "paragraph", content: sentences(60) }], "Notes")).toBeNull();
    expect(splitLocally([{ type: "checkListItem", props: { checked: false }, content: "Short" }], "Todo")).toBeNull();
  });
});

describe("splitLocally → proposeSplit", () => {
  it("is proposed like Visualize better: one frame beside the block, its removal, and the split record", async () => {
    const raw = splitLocally(WAVE, "Wave 1b");
    const { changeSet } = await proposeSplit(
      raw,
      {
        label: "Wave 1b",
        target: "el_table",
        box: { x: 0, y: 0, width: 400, height: 2_000 },
        split: { record: { sourceId: "src_1", version: 3, of: "Plan#table0", fingerprint: "t456" }, keyPrefix: "Plan#table0 ⊃ " },
        operationId: "op_local",
        context: { existing: [{ x: 0, y: 0, width: 400, height: 2_000 }], viewport: { x: 0, y: 0, width: 1600, height: 900 } },
        frameCount: 2,
      },
      { title: "Split locally: Wave 1b", metadata: { createdBy: "ai", task: "split_locally", operationId: "op_local" } },
      (md) => [{ type: "paragraph", content: md }],
    );
    const set = parseChangeSet(changeSet);
    expect(set.split?.of).toBe("Plan#table0");
    expect(set.changes.filter((c) => c.kind === "create_frame").map((c) => c.title)).toEqual(["3 · Overview"]);
    expect(set.changes.at(-1)).toEqual({ kind: "remove", target: "el_table" });
    expect(set.changes.flatMap((c) => ("stableNodeKey" in c && c.stableNodeKey ? [c.stableNodeKey] : []))).toContain("Plan#table0 ⊃ table0.row#0");
  });
});

describe("statusOf", () => {
  it("takes a leading status off a wordy cell, for the meta line", () => {
    expect(statusOf("✅ **Done 2026-09-27 (tracker F31).** Styled template picker: a radio group.")).toEqual({ status: "✅ Done 2026-09-27 (tracker F31)", rest: "Styled template picker: a radio group." });
    expect(statusOf("Not started. Needs the cloud stages.")).toEqual({ status: "Not started", rest: "Needs the cloud stages." });
  });

  it("leaves a cell with no status (or nothing after it) as it is", () => {
    expect(statusOf("Levels for Repo Map. No cap.")).toEqual({ status: null, rest: "Levels for Repo Map. No cap." });
    expect(statusOf("✅ Done")).toEqual({ status: null, rest: "✅ Done" });
  });

  it("a row whose text starts with its status is titled by what follows", () => {
    const plan = splitLocally(table([["From", "Item"], ["F31", [text("✅ "), bold("Done 2026-09-27 (tracker F31)."), text(` Styled template picker: a radio group of cards. ${sentences(3)}`)]], ["F30", `create_image change kind. ${sentences(2)}`]]), "L4") as Plan;
    expect(plan.nodes[0]).toMatchObject({ title: "Styled template picker: a radio group of cards" });
    expect(plan.nodes[0]!.content.markdown).toMatch(/^\*\*From:\*\* F31 · \*\*Status:\*\* ✅ Done 2026-09-27 \(tracker F31\)\n\n/);
  });
});

describe("leadOf — titles are plain text", () => {
  it("drops Markdown escapes and emphasis from a title", () => {
    expect(leadOf("create\\_image change kind. Needed by CAP-15.").title).toBe("create_image change kind");
  });
});
