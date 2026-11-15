import { describe, expect, it } from "vitest";
import { CHUNK_CHARS, buildRows, defaultOpen, estimateHeight, rowAt, rowOfSection, rowOfSegment, rowOffsets, visibleRange } from "./layout";
import { buildSourceView } from "./segments";
import { describeChanges, summarizeLineage } from "./changes";
import { spreadSelection, stubLongSourceData, stubSourcePanelData } from "./stubData";

describe("buildRows", () => {
  const data = stubSourcePanelData();

  it("folds sections with nothing selected or flagged to their heading", () => {
    const view = buildSourceView(data, { units: ["u6"] });
    const rows = buildRows(view.sections, data.text, { filter: "all" });
    const open = rows.filter((r) => r.kind === "heading" && r.open).map((r) => view.sections[r.section]!.heading);
    // Caching and Limits need review; Invalidation has the selection; Open questions folds.
    expect(open).toEqual(["Caching", "Invalidation", "Limits"]);
    expect(rows.some((r) => r.kind === "chunk" && r.section === 4)).toBe(false);
    // The lead-in has no heading row and is always open.
    expect(rows[0]).toMatchObject({ kind: "chunk", section: 0 });
    expect(defaultOpen(view.sections[4]!)).toBe(false);
  });

  it("lets the user fold and unfold any section", () => {
    const view = buildSourceView(data, { units: [] });
    const rows = buildRows(view.sections, data.text, { filter: "all", toggled: new Map([[1, false], [4, true]]) });
    expect(rows.some((r) => r.kind === "chunk" && r.section === 1)).toBe(false);
    expect(rows.some((r) => r.kind === "chunk" && r.section === 4)).toBe(true);
  });

  it("lists matching passages under their headings for a filter", () => {
    const view = buildSourceView(data, { units: [] });
    const omitted = buildRows(view.sections, data.text, { filter: "omitted" });
    expect(omitted.map((r) => r.kind)).toEqual(["heading", "passage", "heading", "passage"]);
    expect(omitted.filter((r) => r.kind === "passage").map((r) => r.key)).toEqual(["p:u4", "p:u9"]);
    // u3 needs review but a card cites it: listed under Needs review, not under Not on canvas.
    const notOnCanvas = buildRows(view.sections, data.text, { filter: "not_on_canvas" });
    expect(notOnCanvas.filter((r) => r.kind === "passage").map((r) => r.key)).toEqual(["p:u4", "p:u8", "p:u9"]);
    const review = buildRows(view.sections, data.text, { filter: "needs_review" });
    expect(review.filter((r) => r.kind === "passage").map((r) => r.key)).toEqual(["p:u3", "p:u8"]);
    // Without onCanvas: anything not Represented.
    const fallback = buildSourceView({ ...data, onCanvas: undefined }, { units: [] });
    const rows = buildRows(fallback.sections, data.text, { filter: "not_on_canvas" });
    expect(rows.filter((r) => r.kind === "passage").map((r) => r.key)).toEqual(["p:u3", "p:u4", "p:u8", "p:u9"]);
  });

  it("chunks long sections and finds the row of a segment", () => {
    const long = stubLongSourceData(20_000);
    const view = buildSourceView(long, { units: [] });
    const rows = buildRows(view.sections, long.text, { filter: "all", toggled: new Map(view.sections.map((s) => [s.index, true])) });
    for (const r of rows) if (r.kind === "chunk") expect(r.chars).toBeLessThan(CHUNK_CHARS + 400);
    const section = view.sections[3]!;
    const lastSeg = section.segments.length - 1;
    const row = rows[rowOfSegment(rows, 3, lastSeg)]!;
    expect(row.kind === "chunk" && lastSeg >= row.from && lastSeg < row.to).toBe(true);
    expect(rows[rowOfSection(rows, 3)]!.kind).toBe("heading");
  });
});

describe("windowing", () => {
  it("computes offsets and the visible range", () => {
    const data = stubSourcePanelData();
    const view = buildSourceView(data, { units: [] });
    const rows = buildRows(view.sections, data.text, { filter: "all", toggled: new Map(view.sections.map((s) => [s.index, true])) });
    const offsets = rowOffsets(rows, () => 100);
    expect(offsets[rows.length]).toBe(rows.length * 100);
    expect(rowAt(offsets, 0)).toBe(0);
    expect(rowAt(offsets, 250)).toBe(2);
    expect(rowAt(offsets, 1e9)).toBe(rows.length - 1);
    expect(visibleRange(offsets, 200, 100, 0)).toEqual([2, 3]);
    expect(visibleRange(new Float64Array([0]), 0, 100)).toEqual([0, -1]);
    expect(estimateHeight(rows[0]!)).toBeGreaterThan(0);
  });
});

describe("What changed", () => {
  it("summarises the lineage with the card version's passages", () => {
    const data = stubSourcePanelData();
    const view = buildSourceView(data, { units: [] });
    const s = summarizeLineage(data.lineage, view.unitById);
    expect(describeChanges(s)).toBe("1 changed · 1 moved · 1 removed · 1 unclear · 1 added");
    expect(s.items.map((i) => [i.state, i.unit])).toEqual([
      ["changed", "u2"],
      ["removed", "u4"],
      ["moved", "u7"],
      ["ambiguous", "u9"],
    ]);
    expect(describeChanges(summarizeLineage(undefined, view.unitById))).toBe("");
  });
});

describe("200k-character source (§5.2 budgets)", () => {
  it("segments, lays out and windows well under 100 ms", () => {
    const data = stubLongSourceData(200_000);
    const selection = { units: spreadSelection(data, 3) };
    // Warm up once (JIT), then time the median of a few runs.
    buildRows(buildSourceView(data, selection).sections, data.text, { filter: "all" });
    const times: number[] = [];
    let rowsCount = 0;
    let rendered = 0;
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      const view = buildSourceView(data, selection);
      const rows = buildRows(view.sections, data.text, { filter: "all" });
      const offsets = rowOffsets(rows, (r) => estimateHeight(r));
      const p = view.passages[2]!;
      const segment = view.sections[p.section]!.segments.findIndex((s) => s.kind === "unit" && s.unit === p.key);
      const row = rowOfSegment(rows, p.section, segment);
      const [first, last] = visibleRange(offsets, offsets[row]!, 600);
      times.push(performance.now() - t0);
      rowsCount = rows.length;
      rendered = last - first + 1;
      expect(row).toBeGreaterThan(0);
    }
    const all = (() => {
      const t0 = performance.now();
      const view = buildSourceView(data, selection);
      const rows = buildRows(view.sections, data.text, { filter: "all", toggled: new Map(view.sections.map((s) => [s.index, true])) });
      rowOffsets(rows, (r) => estimateHeight(r));
      return { ms: performance.now() - t0, rows: rows.length };
    })();
    const filtered = (() => {
      const t0 = performance.now();
      const view = buildSourceView(data, selection);
      const rows = buildRows(view.sections, data.text, { filter: "not_on_canvas" });
      rowOffsets(rows, (r) => estimateHeight(r));
      return { ms: performance.now() - t0, rows: rows.length };
    })();
    const median = [...times].sort((a, b) => a - b)[2]!;
    console.info(
      `[perf] Source panel 200k (${data.text.length} chars, ${data.units.length} units): view+rows+window median ${median.toFixed(1)} ms (${rowsCount} rows, ${rendered} rendered); all unfolded ${all.ms.toFixed(1)} ms (${all.rows} rows); "Not on canvas" ${filtered.ms.toFixed(1)} ms (${filtered.rows} rows); budget 100 ms`,
    );
    expect(median).toBeLessThan(100);
    expect(all.ms).toBeLessThan(100);
    expect(filtered.ms).toBeLessThan(100);
    expect(rendered).toBeLessThan(40);
  });
});
