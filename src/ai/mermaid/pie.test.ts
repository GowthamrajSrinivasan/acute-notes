import { describe, expect, it } from "vitest";
import { parsePie } from "./pie";
import type { PieGraph } from "./types";

function parse(source: string): PieGraph {
  const r = parsePie(source);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error.message}`);
  return r.graph;
}

function fails(source: string) {
  const r = parsePie(source);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

describe("parsePie", () => {
  it("reads slices, in order, with decimals", () => {
    const g = parse('pie\n"Dogs" : 42.5\n"Cats" : 7');
    expect(g.kind).toBe("pie");
    expect(g.slices).toEqual([
      { label: "Dogs", value: 42.5, span: expect.any(Object) },
      { label: "Cats", value: 7, span: expect.any(Object) },
    ]);
  });

  it("reads a title (frontmatter or a `title` line) and `showData`", () => {
    expect(parse('pie title Pets\n"Dogs" : 1').title).toBe("Pets");
    expect(parse('pie showData\ntitle Pets\n"Dogs" : 1').showData).toBe(true);
    expect(parse('pie\n"Dogs" : 1').showData).toBe(false);
  });

  it("syntax errors: no header, a non-slice line, with line/column", () => {
    expect(fails('"Dogs" : 1')).toMatchObject({ code: "syntax", kind: "pie" });
    const e = fails('pie\n"Dogs" : 1\nnot a slice');
    expect(e).toMatchObject({ code: "syntax", line: 3 });
  });

  it("no slices at all is reported distinctly", () => {
    expect(fails("pie\ntitle Empty")).toMatchObject({ code: "no_nodes" });
  });
});
