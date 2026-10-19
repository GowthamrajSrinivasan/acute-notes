import { describe, expect, it } from "vitest";
import { parseState } from "./state";
import type { MermaidGraph } from "./types";

function parse(source: string): MermaidGraph {
  const r = parseState(source);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error.message}`);
  return r.graph;
}

const edges = (g: MermaidGraph) => g.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);

describe("parseState", () => {
  it("reads transitions, labels and [*] start/end pseudo-states", () => {
    const g = parse("stateDiagram-v2\n[*] --> Still\nStill --> Moving : push\nMoving --> Still: stop\nMoving --> [*]");
    expect(g.kind).toBe("state");
    expect(edges(g)).toEqual(["_start>Still", "Still>Moving:push", "Moving>Still:stop", "Moving>_end"]);
    expect(g.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ["_start", "start", "Start"],
      ["Still", "round", "Still"],
      ["Moving", "round", "Moving"],
      ["_end", "end", "End"],
    ]);
  });

  it("reads aliases, descriptions and choice/fork stereotypes", () => {
    const g = parse(
      [
        "stateDiagram",
        'state "Waiting for payment" as Wait',
        "Paid : Payment received",
        "Paid : receipt sent",
        "state check <<choice>>",
        "state split <<fork>>",
        "Wait --> check",
        "check --> Paid : ok",
      ].join("\n"),
    );
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId.Wait).toMatchObject({ label: "Waiting for payment", shape: "round" });
    expect(byId.Paid).toMatchObject({ label: "Payment received\nreceipt sent" });
    expect(byId.check).toMatchObject({ shape: "choice" });
    expect(byId.split).toMatchObject({ shape: "fork", label: "fork" });
  });

  it("maps composite states to subgraphs with their own start/end", () => {
    const g = parse(["stateDiagram-v2", "[*] --> Active", "state Active {", "  direction LR", "  [*] --> Idle", "  Idle --> Busy", "  Busy --> [*]", "}", "Active --> [*]"].join("\n"));
    expect(g.subgraphs).toEqual([expect.objectContaining({ id: "Active", title: "Active", direction: "LR" })]);
    const sub = Object.fromEntries(g.nodes.map((n) => [n.id, n.subgraph]));
    expect(sub).toMatchObject({ _start: undefined, _start_Active: "Active", Idle: "Active", Busy: "Active", _end_Active: "Active", _end: undefined });
    expect(edges(g)).toContain("_start>Active");
  });

  it("skips notes, styling and concurrency separators, and reports them", () => {
    const g = parse(
      ["stateDiagram-v2", "A --> B", "note right of A : a note", "note left of B", "  multi", "  line", "end note", "classDef hot fill:red", "class A hot", "A:::hot --> C", "--", "C --> D"].join(
        "\n",
      ),
    );
    expect(edges(g)).toEqual(["A>B", "A>C", "C>D"]);
    expect(g.notes.join(" | ")).toMatch(/2 notes skipped.*2 styling lines ignored.*concurrent regions/);
  });

  it.each([
    ["no header", "A --> B", 1],
    ["unclosed composite", "stateDiagram-v2\nstate A {\nB --> C", 2],
    ["stray }", "stateDiagram-v2\nA --> B\n}", 3],
    ["unclosed note", "stateDiagram-v2\nnote left of A\ntext", 3],
    ["bad id", "stateDiagram-v2\nA --> {B}", 2],
    ["bad declaration", 'stateDiagram-v2\nstate "Unclosed as A', 2],
    ["composite choice", "stateDiagram-v2\nstate c <<choice>> {\n}", 2],
  ] as const)("malformed: %s → typed syntax error", (_name, source, line) => {
    const r = parseState(source);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "syntax", kind: "state", line });
  });
});
