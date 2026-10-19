import { describe, expect, it } from "vitest";
import { parseGantt } from "./gantt";
import type { GanttGraph } from "./types";

function parse(source: string): GanttGraph {
  const r = parseGantt(source);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error.message}`);
  return r.graph;
}

function fails(source: string) {
  const r = parseGantt(source);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
}

describe("parseGantt", () => {
  it("reads tasks in source order, with section/start/duration", () => {
    const g = parse(["gantt", "title Launch plan", "dateFormat YYYY-MM-DD", "section Design", "Mockups :a1, 2024-01-01, 5d", "section Build", "Implement :after a1, 10d"].join("\n"));
    expect(g.kind).toBe("gantt");
    expect(g.title).toBe("Launch plan");
    expect(g.tasks).toEqual([
      { label: "Mockups", section: "Design", start: "2024-01-01", duration: "5d", span: expect.any(Object) },
      { label: "Implement", section: "Build", start: "after a1", duration: "10d", span: expect.any(Object) },
    ]);
  });

  it("a task naming only a duration is still read", () => {
    const g = parse("gantt\nQuick task : 2d");
    expect(g.tasks).toEqual([{ label: "Quick task", duration: "2d", span: expect.any(Object) }]);
  });

  it("tags (done/active/crit/milestone) are read past, not rejected", () => {
    const g = parse("gantt\nA task :done, crit, a1, 2024-01-01, 3d\nB task :active, milestone, after a1, 0d");
    expect(g.tasks.map((t) => [t.start, t.duration])).toEqual([
      ["2024-01-01", "3d"],
      ["after a1", "0d"],
    ]);
  });

  it("excludes lines are read past and reported", () => {
    const g = parse("gantt\nexcludes weekends\nTask : 1d");
    expect(g.skipped.some((s) => s.includes("excludes"))).toBe(true);
  });

  it("syntax errors: no header, no task name before `:`, unreadable line, with line/column", () => {
    expect(fails("Task : 1d")).toMatchObject({ code: "syntax", kind: "gantt" });
    expect(fails("gantt\n: 1d")).toMatchObject({ code: "syntax" });
    const e = fails("gantt\nTask : 1d\nnonsense here");
    expect(e).toMatchObject({ code: "syntax", line: 3 });
  });

  it("no tasks at all is reported distinctly", () => {
    expect(fails("gantt\ntitle Empty")).toMatchObject({ code: "no_nodes" });
  });
});
