import { describe, expect, it } from "vitest";
import { parseChart } from "./chartData";

const bar = JSON.stringify({ chartType: "bar", categories: ["Jan", "Feb"], series: [{ name: "Revenue", values: [10, 20] }] });

describe("parseChart", () => {
  it("parses a valid bar chart", () => {
    expect(parseChart(bar)).toEqual({ chartType: "bar", categories: ["Jan", "Feb"], series: [{ name: "Revenue", values: [10, 20] }] });
  });

  it("parses a valid multi-series line chart", () => {
    const line = JSON.stringify({ chartType: "line", categories: ["Q1", "Q2", "Q3"], series: [{ name: "A", values: [1, 2, 3] }, { name: "B", values: [3, 2, 1] }] });
    const data = parseChart(line);
    expect(data?.series).toHaveLength(2);
    expect(data?.categories).toEqual(["Q1", "Q2", "Q3"]);
  });

  it.each([
    ["not json at all", "not json at all"],
    ["an empty string", ""],
    ["missing chartType", JSON.stringify({ categories: ["a"], series: [{ name: "x", values: [1] }] })],
    ["an unknown chartType", JSON.stringify({ chartType: "pie", categories: ["a"], series: [{ name: "x", values: [1] }] })],
    ["no categories", JSON.stringify({ chartType: "bar", categories: [], series: [{ name: "x", values: [] }] })],
    ["no series", JSON.stringify({ chartType: "bar", categories: ["a"], series: [] })],
    ["a series shorter than categories", JSON.stringify({ chartType: "bar", categories: ["a", "b"], series: [{ name: "x", values: [1] }] })],
    ["a non-numeric value", JSON.stringify({ chartType: "bar", categories: ["a"], series: [{ name: "x", values: ["one"] }] })],
    ["a NaN/Infinity value", JSON.stringify({ chartType: "bar", categories: ["a"], series: [{ name: "x", values: [Infinity] }] })],
  ])("returns null for %s, never throws", (_label, source) => {
    expect(parseChart(source)).toBeNull();
  });
});
