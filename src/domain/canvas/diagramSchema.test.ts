import { describe, expect, it } from "vitest";
import { visualNodeSchema } from "@/ai/visual-plan/schema";
import { DIAGRAM_LIMITS, clipDiagramText, nodeSemanticsSchema, shapeTextLosses } from "./diagramSchema";

const long = (n: number, word = "word") => Array.from({ length: Math.ceil(n / (word.length + 1)) }, () => word).join(" ").slice(0, n);

describe("a shape's text is shortened, never dropped", () => {
  it("keeps text that fits as it is (trimmed)", () => {
    expect(nodeSemanticsSchema.parse({ sublabel: "  FastAPI :8000 ", tag: "v2", details: [" one ", "two"] })).toEqual({ sublabel: "FastAPI :8000", tag: "v2", details: ["one", "two"] });
  });

  it("shortens an over-long sublabel or tag to the limit, ending in …", () => {
    const parsed = nodeSemanticsSchema.parse({ sublabel: long(DIAGRAM_LIMITS.sublabel + 50), tag: long(DIAGRAM_LIMITS.tag + 1) });
    expect(parsed.sublabel).toHaveLength(DIAGRAM_LIMITS.sublabel);
    expect(parsed.sublabel!.endsWith("…")).toBe(true);
    expect(parsed.tag!.length).toBeLessThanOrEqual(DIAGRAM_LIMITS.tag);
    expect(parsed.tag!.endsWith("…")).toBe(true);
  });

  it("one over-long detail is shortened; the rest of the list stays", () => {
    const parsed = nodeSemanticsSchema.parse({ details: ["short", long(DIAGRAM_LIMITS.detail + 10), "also short"] });
    expect(parsed.details).toHaveLength(3);
    expect(parsed.details![0]).toBe("short");
    expect(parsed.details![1]).toHaveLength(DIAGRAM_LIMITS.detail);
    expect(parsed.details![2]).toBe("also short");
  });

  it("details past the limit are left off the list, the first ones kept; empty and non-string items go", () => {
    const items = Array.from({ length: DIAGRAM_LIMITS.details + 3 }, (_, i) => `detail ${i}`);
    expect(nodeSemanticsSchema.parse({ details: items }).details).toEqual(items.slice(0, DIAGRAM_LIMITS.details));
    expect(nodeSemanticsSchema.parse({ details: ["", "  ", 3, "kept"] }).details).toEqual(["kept"]);
    expect(nodeSemanticsSchema.parse({ details: ["", 3] }).details).toBeUndefined();
  });

  it("a wrong type still drops only that field", () => {
    expect(nodeSemanticsSchema.parse({ sublabel: 42, details: "not a list", kind: "nonsense" })).toEqual({});
  });

  it("through the plan's shape node schema too", () => {
    const parsed = visualNodeSchema.parse({ id: "n1", type: "shape", content: { shape: "rectangle", label: "API", sublabel: long(300), details: Array.from({ length: 10 }, (_, i) => `d${i}`) } }) as { content: { sublabel?: string; details?: string[] } };
    expect(parsed.content.sublabel).toHaveLength(DIAGRAM_LIMITS.sublabel);
    expect(parsed.content.details).toHaveLength(DIAGRAM_LIMITS.details);
  });
});

describe("shapeTextLosses", () => {
  it("is empty when everything fits, or for content that isn't an object", () => {
    expect(shapeTextLosses({ sublabel: "ok", details: ["a", "b"] })).toEqual({ notes: [], overflow: [] });
    expect(shapeTextLosses(null)).toEqual({ notes: [], overflow: [] });
  });

  it("names each loss and gives back the full text of what didn't fit", () => {
    const sub = long(DIAGRAM_LIMITS.sublabel + 1);
    const detail = long(DIAGRAM_LIMITS.detail + 5, "detail");
    const details = ["a", detail, ...Array.from({ length: DIAGRAM_LIMITS.details }, (_, i) => `extra ${i}`)];
    const r = shapeTextLosses({ sublabel: ` ${sub} `, details });
    expect(r.notes).toEqual([`sublabel over ${DIAGRAM_LIMITS.sublabel} characters shortened`, `a detail over ${DIAGRAM_LIMITS.detail} characters shortened`, `2 details past ${DIAGRAM_LIMITS.details} left off the shape`]);
    expect(r.overflow).toEqual([sub, detail, "extra 6", "extra 7"]);
  });

  it("clipDiagramText matches the repair's clip", () => {
    expect(clipDiagramText("abcdef", 6)).toBe("abcdef");
    expect(clipDiagramText("abc defgh", 6)).toBe("abc d…");
  });
});
