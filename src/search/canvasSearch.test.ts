import { describe, expect, it } from "vitest";
import { searchSources } from "./canvasSearch";

describe("canvas search", () => {
  const sources = [
    { elementId: "n1", kind: "text" as const, text: "Server logs" },
    { elementId: "r1", kind: "rich" as const, text: "Plan\nFix the server bug\nAdd server tests" },
    { elementId: "r2", kind: "rich" as const, text: "Unrelated" },
  ];

  it("finds matches in native and rich text, case-insensitively, with counts", () => {
    const results = searchSources(sources, "SERVER");
    expect(results.map((r) => [r.elementId, r.kind, r.count])).toEqual([
      ["n1", "text", 1],
      ["r1", "rich", 2],
    ]);
    expect(results[1]?.snippet).toMatchObject({ match: "server" });
    expect(results[1]?.snippet.before).toContain("Fix the");
  });

  it("returns nothing for a blank query", () => {
    expect(searchSources(sources, "   ")).toEqual([]);
  });
});
