import { describe, expect, it } from "vitest";
import type { VisualNode } from "@/ai/visual-plan/types";
import { flowMarkdown } from "@/ai/openui/flowLayout";
import { FLOW_CARD_ROLE } from "@/ai/visual-plan/flowCards";
import { measureNode } from "./measure";

const shape = (label: string, importance?: VisualNode["importance"]): VisualNode => ({ id: "n", type: "shape", importance, content: { shape: "rectangle", label } });

describe("measureNode", () => {
  it("sizes every node type from its content, never zero and never absurdly large", () => {
    const nodes: VisualNode[] = [
      { id: "n", type: "heading", content: { text: "Section" } },
      { id: "n", type: "text", content: { markdown: "Short." } },
      { id: "n", type: "todo", content: { items: [{ text: "a", checked: false }, { text: "b", checked: true }] } },
      { id: "n", type: "table", content: { columns: ["A", "B"], rows: [["1", "2"]] } },
      { id: "n", type: "code", content: { source: "x = 1;" } },
      { id: "n", type: "page", content: { title: "T", markdown: "Body" } },
      shape("Node"),
    ];
    for (const n of nodes) {
      const size = measureNode(n);
      expect(size.width, n.type).toBeGreaterThan(0);
      expect(size.height, n.type).toBeGreaterThan(0);
      expect(size.width, n.type).toBeLessThan(2000);
      expect(size.height, n.type).toBeLessThan(2000);
    }
  });

  it("grows a shape's width with its label, within bounds", () => {
    const short = measureNode(shape("Go"));
    const long = measureNode(shape("A much longer label describing this step in detail"));
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("fits a shape's label in its shape's text area: diamonds and ellipses need more room, long labels wrap taller", () => {
    const of = (s: "rectangle" | "diamond" | "ellipse", label: string) => measureNode({ id: "n", type: "shape", content: { shape: s, label } });
    // Excalidraw's diamond text area is half its width; one long word must still fit on one line (~14 chars × 20 px × 0.51 em).
    expect(of("diamond", "Authentication").width / 2).toBeGreaterThan(14 * 20 * 0.51 + 10);
    expect(of("ellipse", "Session created").width).toBeGreaterThan(of("rectangle", "Session created").width);
    const long = "Session token issued to the client application after validation";
    expect(of("rectangle", long).height).toBeGreaterThan(of("rectangle", "Go").height);
    expect(of("ellipse", long).height).toBeGreaterThan(of("ellipse", "Go").height);
  });

  it("never shrinks a less important shape below what its label needs", () => {
    const label = "A much longer label describing this step in detail";
    const low = measureNode({ id: "n", type: "shape", importance: "low", content: { shape: "diamond", label } });
    const medium = measureNode({ id: "n", type: "shape", content: { shape: "diamond", label } });
    expect(low).toEqual(medium);
  });

  it("grows a todo/table/code block's height with more content, within bounds", () => {
    const fewItems = measureNode({ id: "n", type: "todo", content: { items: [{ text: "a", checked: false }] } });
    const manyItems = measureNode({ id: "n", type: "todo", content: { items: Array.from({ length: 8 }, (_, i) => ({ text: `item ${i}`, checked: false })) } });
    expect(manyItems.height).toBeGreaterThan(fewItems.height);

    const smallTable = measureNode({ id: "n", type: "table", content: { columns: ["A"], rows: [["1"]] } });
    const bigTable = measureNode({ id: "n", type: "table", content: { columns: ["A"], rows: Array.from({ length: 10 }, (_, i) => [`${i}`]) } });
    expect(bigTable.height).toBeGreaterThan(smallTable.height);

    const shortCode = measureNode({ id: "n", type: "code", content: { source: "x" } });
    const longCode = measureNode({ id: "n", type: "code", content: { source: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") } });
    expect(longCode.height).toBeGreaterThan(shortCode.height);
  });

  it("sizes a chart (Wave E) from its data, not char/line counts, and taller with a legend for 2+ series", () => {
    const oneSeries = JSON.stringify({ chartType: "bar", categories: ["A", "B"], series: [{ name: "x", values: [1, 2] }] });
    const twoSeries = JSON.stringify({ chartType: "bar", categories: ["A", "B"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] });
    const one = measureNode({ id: "n", type: "code", content: { language: "acute-chart", source: oneSeries } });
    const two = measureNode({ id: "n", type: "code", content: { language: "acute-chart", source: twoSeries } });
    expect(two.height).toBeGreaterThan(one.height); // the legend row
    expect(one.width).toBe(two.width); // a fixed plot area either way

    // The same JSON string, sized as code (no `language`) vs as a chart, must not coincide by char-count luck.
    const asCode = measureNode({ id: "n", type: "code", content: { source: oneSeries } });
    expect(one.width).not.toBe(asCode.width);

    // Malformed JSON falls back to the normal code sizing instead of throwing.
    expect(() => measureNode({ id: "n", type: "code", content: { language: "acute-chart", source: "not json" } })).not.toThrow();
  });

  it("scales size by importance — never by color (there's no color field to set)", () => {
    const low = measureNode(shape("Node", "low"));
    const medium = measureNode(shape("Node", "medium"));
    const high = measureNode(shape("Node", "high"));
    expect(low.width).toBeLessThan(medium.width);
    expect(high.width).toBeGreaterThan(medium.width);
    expect(low.height).toBeLessThan(medium.height);
    expect(high.height).toBeGreaterThan(medium.height);
    expect(Object.keys(high)).toEqual(["width", "height"]); // no color, no style field
  });

  it("is deterministic", () => {
    const node: VisualNode = { id: "n", type: "text", importance: "high", content: { markdown: "Some content here." } };
    expect(measureNode(node)).toEqual(measureNode(node));
  });
});

describe("a flow card is sized from its FlowDiagram, not its text", () => {
  const flow = (labels: string[], detail = "") =>
    measureNode({ id: "f", type: "text", role: FLOW_CARD_ROLE, title: "Release process", content: { markdown: flowMarkdown(labels.map((label) => ({ label, markdown: detail }))) } });
  const text = (labels: string[], detail = "") => measureNode({ id: "t", type: "text", title: "Release process", content: { markdown: flowMarkdown(labels.map((label) => ({ label, markdown: detail }))) } });

  it("five steps with details: one short card, far shorter than the same text drawn as text", () => {
    const steps = ["Freeze main branch", "Build and test", "Approve candidate", "Deploy", "Monitor"];
    const detail = "The release manager freezes the branch at 10:00 on Tuesday.";
    const card = flow(steps, detail);
    expect(card.width).toBeLessThanOrEqual(720);
    // Two rows of steps at most, a detail and the chips: no taller than ~260 px; the text sizing gave ~400+.
    expect(card.height).toBeLessThan(260);
    expect(card.height).toBeLessThan(text(steps, detail).height);
  });

  it("a few short steps: the card is only as wide as its row (never under the text minimum)", () => {
    const card = flow(["Plan", "Do", "Check"]);
    expect(card.width).toBeLessThan(500);
    expect(card.width).toBeGreaterThanOrEqual(200);
  });

  it("more steps wrap onto more rows: taller, never wider than 720", () => {
    const few = flow(["Collect the data", "Clean it", "Train"]);
    const many = flow(Array.from({ length: 12 }, (_, i) => `A longer step label ${i + 1}`));
    expect(many.width).toBe(720);
    expect(many.height).toBeGreaterThan(few.height + 40);
  });

  it("room for a step's detail only when a step has one", () => {
    expect(flow(["A", "B"], "Some detail.").height).toBeGreaterThan(flow(["A", "B"]).height);
  });
});
