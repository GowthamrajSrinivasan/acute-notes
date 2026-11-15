import { describe, expect, it } from "vitest";
import { MAX_TEXT_SEGMENT, bodyStartOf, buildSourceView, matchesFilter, totalCounts, type Segment, type UnitSegment } from "./segments";
import { buildStub, spreadSelection, stubLongSourceData, stubSourcePanelData, withoutUnits } from "./stubData";

const units = (segs: Segment[]) => segs.filter((s): s is UnitSegment => s.kind === "unit");

describe("buildSourceView", () => {
  const data = stubSourcePanelData();

  it("splits into a lead-in and one section per heading, bodies without the heading line", () => {
    const view = buildSourceView(data, { units: [] });
    expect(view.sections.map((s) => s.heading)).toEqual(["", "Caching", "Invalidation", "Limits", "Open questions"]);
    const caching = view.sections[1]!;
    expect(data.text.slice(caching.start, caching.bodyStart)).toBe("## Caching\n");
    // Nested section: the parent owns only the text up to its child.
    expect(caching.end).toBe(view.sections[2]!.start);
    expect(view.sections[2]!.level).toBe(3);
  });

  it("covers the text exactly once, in order", () => {
    const view = buildSourceView(data, { units: [] });
    let at = 0;
    for (const s of view.sections) {
      expect(s.start).toBe(at);
      let pos = s.bodyStart;
      for (const seg of s.segments) {
        expect(seg.start).toBe(pos);
        pos = seg.end;
      }
      expect(pos).toBe(s.end);
      at = s.end;
    }
    expect(at).toBe(data.text.length);
  });

  it("marks every unit with its outcome and reasons, and counts per section", () => {
    const view = buildSourceView(data, { units: [] });
    const all = view.sections.flatMap((s) => units(s.segments));
    expect(all.map((u) => u.unit)).toEqual(data.units.map((u) => u.id));
    const review = all.find((u) => u.unit === "u3")!;
    expect(review.outcome).toBe("needs_review");
    expect(review.reasons[0]).toContain("condition changed");
    expect(view.sections[1]!.counts).toEqual({ represented: 2, omitted: 1, needs_review: 1 });
    expect(totalCounts(view.sections)).toEqual({ represented: 6, omitted: 2, needs_review: 2 });
  });

  it("orders the selection's passages by position and maps units to sections", () => {
    const view = buildSourceView(data, { units: ["u9", "u2", "missing"] });
    expect(view.passages.map((p) => p.key)).toEqual(["u2", "u9"]);
    expect(view.passages.map((p) => p.section)).toEqual([1, 3]);
    expect(view.sections[1]!.selected).toBe(1);
    expect(view.sectionOfUnit.get("u9")).toBe(3);
    expect(units(view.sections[1]!.segments).find((u) => u.unit === "u2")!.selected).toBe(true);
  });

  it("selects the units a span-only selection overlaps", () => {
    const u5 = data.units.find((u) => u.id === "u5")!;
    const view = buildSourceView(data, { units: [], spans: [{ start: u5.span.start + 2, end: u5.span.start + 4 }] });
    expect(view.passages.map((p) => p.key)).toEqual(["u5"]);
  });

  it("highlights by span only when the source has no units", () => {
    const bare = withoutUnits(data);
    const u2 = data.units.find((u) => u.id === "u2")!;
    const u8 = data.units.find((u) => u.id === "u8")!;
    const view = buildSourceView(bare, { units: ["u2"], spans: [u8.span, u2.span] });
    expect(view.bySpan).toBe(true);
    expect(view.passages.map((p) => [p.start, p.end])).toEqual([
      [u2.span.start, u2.span.end],
      [u8.span.start, u8.span.end],
    ]);
    const marked = view.sections.flatMap((s) => s.segments).filter((s) => s.kind === "text" && s.passage);
    expect(marked.map((s) => bare.text.slice(s.start, s.end))).toEqual([u2.text, u8.text]);
    expect(totalCounts(view.sections)).toEqual({ represented: 0, omitted: 0, needs_review: 0 });
  });

  it("treats a source without headings as one open section", () => {
    const data2 = buildStub([], { lead: "Just one line." });
    const view = buildSourceView({ ...data2, sections: [] }, { units: ["u1"] });
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]!.heading).toBe("");
    expect(view.passages).toHaveLength(1);
  });

  it("clips overlapping units and ignores spans outside the text", () => {
    const d = buildStub([{ heading: "A", paragraphs: [[{ text: "One two." }, { text: "Three four." }]] }]);
    d.units[1]!.span = { start: d.units[0]!.span.start + 2, end: d.units[1]!.span.end };
    const view = buildSourceView(d, { units: [], spans: [{ start: -5, end: 1e9 }] });
    const segs = units(view.sections.flatMap((s) => s.segments));
    expect(segs[1]!.start).toBe(segs[0]!.end);
  });

  it("splits long plain runs so they window", () => {
    const text = `${"word ".repeat(2000)}\n`;
    const view = buildSourceView({ sourceId: "s", version: 1, latestVersion: 1, text, sections: [], units: [], outcome: {}, reasons: {} }, { units: [] });
    const segs = view.sections[0]!.segments;
    expect(segs.length).toBeGreaterThan(5);
    expect(Math.max(...segs.map((s) => s.end - s.start))).toBeLessThanOrEqual(MAX_TEXT_SEGMENT);
    expect(segs.map((s) => text.slice(s.start, s.end)).join("")).toBe(text);
  });
});

describe("bodyStartOf", () => {
  it("skips ATX and setext heading lines, and nothing else", () => {
    const atx = "## Title ##\nBody";
    expect(atx.slice(bodyStartOf(atx, 0, atx.length, "Title"))).toBe("Body");
    const setext = "Title\n=====\nBody";
    expect(setext.slice(bodyStartOf(setext, 0, setext.length, "Title"))).toBe("Body");
    const none = "Body first";
    expect(bodyStartOf(none, 0, none.length, "Title")).toBe(0);
  });
});

describe("matchesFilter", () => {
  it("maps the four filters to outcomes", () => {
    expect(matchesFilter("represented", "all")).toBe(true);
    expect(matchesFilter("needs_review", "needs_review")).toBe(true);
    expect(matchesFilter("omitted", "needs_review")).toBe(false);
    expect(matchesFilter("omitted", "omitted")).toBe(true);
    expect(matchesFilter("represented", "not_on_canvas")).toBe(false);
    expect(matchesFilter("omitted", "not_on_canvas")).toBe(true);
    expect(matchesFilter("needs_review", "not_on_canvas")).toBe(true);
    expect(matchesFilter(undefined, "not_on_canvas")).toBe(true);
  });

  it("uses onCanvas for Not on canvas when given: a flagged but cited unit is on the canvas", () => {
    expect(matchesFilter("needs_review", "not_on_canvas", true)).toBe(false);
    expect(matchesFilter("needs_review", "needs_review", true)).toBe(true);
    expect(matchesFilter("needs_review", "not_on_canvas", false)).toBe(true);
    expect(matchesFilter("represented", "not_on_canvas", false)).toBe(true);
    expect(matchesFilter("omitted", "not_on_canvas", false)).toBe(true);
  });

  it("counts Not on canvas per section from onCanvas, or from outcomes without it", () => {
    const data = stubSourcePanelData();
    const view = buildSourceView(data, { units: [] });
    // Caching: u3 is flagged but cited (on the canvas); only u4 is off it.
    expect(view.sections[1]!.notOnCanvas).toBe(1);
    expect(units(view.sections[1]!.segments).find((u) => u.unit === "u3")!.onCanvas).toBe(true);
    const fallback = buildSourceView({ ...data, onCanvas: undefined }, { units: [] });
    expect(fallback.sections[1]!.notOnCanvas).toBe(2);
    expect(units(fallback.sections[1]!.segments)[0]!.onCanvas).toBeUndefined();
  });
});

describe("stubLongSourceData", () => {
  it("is at least 200k characters with consistent spans and every outcome", () => {
    const data = stubLongSourceData();
    expect(data.text.length).toBeGreaterThanOrEqual(200_000);
    for (const u of data.units.slice(0, 200)) expect(data.text.slice(u.span.start, u.span.end)).toBe(u.text);
    const outcomes = new Set(Object.values(data.outcome));
    expect(outcomes).toEqual(new Set(["represented", "omitted", "needs_review"]));
    expect(spreadSelection(data, 3)).toHaveLength(3);
  });
});
