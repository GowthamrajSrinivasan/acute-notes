import { describe, expect, it } from "vitest";
import { itemIds, missingAnalysis } from "./analysisCheck";
import { expandSourceRefs, numberSource } from "./sourceBlocks";

const SOURCE = [
  "## Decisions",
  "",
  "Intro sentence of the reply, long enough to count.",
  "",
  "| | Decision | My proposal |",
  "|---|---|---|",
  "| D1 | Draft 03's checklist | Replace it with the gate |",
  "| D2 | The skill change | Merge v3, keep Draft 03 frozen |",
  "",
  "- [ ] Receive the two SR3 files",
  "- [x] Correct the tracker",
  "",
  "```sh",
  "pixi run verify-ci",
  "```",
].join("\n");

describe("numberSource", () => {
  it("numbers tables, lists, code and paragraphs per kind, in order; headings stay plain lines", async () => {
    const { blocks, numbered } = await numberSource(SOURCE);
    expect(blocks.map((b) => `${b.ref}:${b.kind}`)).toEqual(["P1:paragraph", "T1:table", "L1:checklist", "C1:code"]);
    expect(numbered.split("\n\n")[0]).toBe("## Decisions");
    expect(numbered).toContain("[T1] |   | Decision | My proposal |\n|---|---|---|\n| D1 | Draft 03's checklist | Replace it with the gate |");
    expect(blocks[2]!.node).toEqual({ type: "todo", content: { items: [{ text: "Receive the two SR3 files", checked: false }, { text: "Correct the tracker", checked: true }] } });
  });
});

describe("expandSourceRefs", () => {
  it("expands a reference into its verbatim block, keeping the node's id, title and links", async () => {
    const { blocks } = await numberSource(SOURCE);
    const raw = { version: 1, nodes: [{ id: "n1", type: "source", ref: "t1", title: "Decisions", importance: "high" }, { id: "n2", type: "source", ref: "[C1]" }], relationships: [{ from: "n1", to: "n2", type: "relates_to" }] };
    const { raw: out, expanded, unknown } = expandSourceRefs(raw, blocks);
    expect(expanded).toBe(2);
    expect(unknown).toEqual([]);
    const nodes = (out as { nodes: Record<string, unknown>[] }).nodes;
    expect(nodes[0]).toEqual({ id: "n1", title: "Decisions", importance: "high", type: "table", content: { columns: ["", "Decision", "My proposal"], rows: [["D1", "Draft 03's checklist", "Replace it with the gate"], ["D2", "The skill change", "Merge v3, keep Draft 03 frozen"]] } });
    expect(nodes[1]).toMatchObject({ id: "n2", type: "code", content: { language: "sh", source: "pixi run verify-ci" } });
    expect((out as { relationships: unknown[] }).relationships).toHaveLength(1);
  });

  it("expands a reference however the model spells it — a typed node with a ref and no content, sourceRef — and leaves a node with content of its own alone", async () => {
    const { blocks } = await numberSource(SOURCE);
    const raw = {
      nodes: [
        { id: "a", type: "table", ref: "T1" },
        { id: "b", type: "text", sourceRef: "P1" },
        { id: "c", type: "text", ref: "T1", content: { markdown: "My own words" } },
      ],
    };
    const { raw: out, expanded } = expandSourceRefs(raw, blocks);
    expect(expanded).toBe(2);
    const nodes = (out as { nodes: Record<string, unknown>[] }).nodes;
    expect(nodes[0]).toMatchObject({ id: "a", type: "table", content: { columns: ["", "Decision", "My proposal"] } });
    expect(nodes[1]).toMatchObject({ id: "b", type: "text", content: { markdown: "Intro sentence of the reply, long enough to count." } });
    expect(nodes[1]).not.toHaveProperty("sourceRef");
    expect(nodes[2]).toMatchObject({ id: "c", content: { markdown: "My own words" } });
  });

  it("removes block numbers the model copied into its own text, and nothing else", async () => {
    const { blocks } = await numberSource(SOURCE);
    const raw = {
      nodes: [
        { id: "a", type: "text", title: "[P2] Details", content: { markdown: "[P1] One row per check. [P2] What the outcomes mean: [P3] Pause." } },
        { id: "b", type: "shape", content: { shape: "rectangle", label: "Step [T1] one" } },
        { id: "c", type: "text", content: { markdown: "A list [x] item and an array index a[1] stay." } },
      ],
    };
    const nodes = (expandSourceRefs(raw, blocks).raw as { nodes: { title?: string; content: { markdown?: string; label?: string } }[] }).nodes;
    expect(nodes[0]!.title).toBe("Details");
    expect(nodes[0]!.content.markdown).toBe("One row per check. What the outcomes mean: Pause.");
    expect(nodes[1]!.content.label).toBe("Step one");
    expect(nodes[2]!.content.markdown).toBe("A list [x] item and an array index a[1] stay.");
  });

  it("drops a reference to a block that doesn't exist, and says so", async () => {
    const { blocks } = await numberSource(SOURCE);
    const { raw: out, unknown } = expandSourceRefs({ nodes: [{ id: "n1", type: "source", ref: "T9" }] }, blocks);
    expect(unknown).toEqual(["T9"]);
    expect((out as { nodes: unknown[] }).nodes).toEqual([]);
  });

  it("repairs a retyped table with a dropped column or shortened cells to the full source table, in place", async () => {
    const { blocks } = await numberSource(SOURCE);
    const shortened = { id: "t", type: "table", title: "Log", content: { columns: ["Decision", "My proposal"], rows: [["D1", "The gate"], ["D2", "Merge v3"]] } };
    const { raw: out, repaired } = expandSourceRefs({ nodes: [shortened] }, blocks);
    expect(repaired).toBe(1);
    expect((out as { nodes: Record<string, unknown>[] }).nodes[0]).toMatchObject({ id: "t", title: "Log", content: { columns: ["", "Decision", "My proposal"] } });
  });

  it("leaves the model's own table alone: other rows, other columns, or a merge", async () => {
    const { blocks } = await numberSource(SOURCE);
    const own = { id: "t", type: "table", content: { columns: ["Decision", "Owner"], rows: [["D1", "Chat B"], ["D2", "Engineer"]] } };
    const other = { id: "u", type: "table", content: { columns: ["Plan", "Price"], rows: [["Free", "0"], ["Pro", "10"]] } };
    expect(expandSourceRefs({ nodes: [own, other] }, blocks).repaired).toBe(0);
  });
});

describe("the analysis must cover the items a source names (decision and status sections)", () => {
  it("finds item ids in table row keys and list items; a bare number isn't one", async () => {
    const { blocks } = await numberSource(SOURCE);
    expect(itemIds(blocks)).toEqual(["D1", "D2"]);
    const { blocks: counts } = await numberSource("| # | Step |\n|---|---|\n| 1 | a |\n| 2 | b |\n");
    expect(itemIds(counts)).toEqual([]);
  });

  it("an analysis skipping most of them names the ones it skipped; other kinds aren't held to it", () => {
    const reply = (md: string) => ({ nodes: [{ id: "a", type: "text", origin: "analysis", content: { markdown: md } }], metadata: { takeaway: "Gate first" } });
    const items = ["D1", "D2", "D3", "D4", "D5"];
    expect(missingAnalysis(reply("D1 is decided."), "decision", items)).toEqual(["an analysis line for D2, D3, D4, D5"]);
    expect(missingAnalysis(reply("D1, D2 and D3 are proposed; D10 is unrelated."), "decision", items)).toEqual([]);
    expect(missingAnalysis(reply("D1 is decided."), "comparison", items)).toEqual([]);
  });
});
