import { describe, expect, it } from "vitest";
import { parseFlowchart } from "./flowchart";
import type { MermaidGraph } from "./types";

function parse(source: string): MermaidGraph {
  const r = parseFlowchart(source);
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error.message}`);
  return r.graph;
}

const edges = (g: MermaidGraph) => g.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);
const labels = (g: MermaidGraph) => Object.fromEntries(g.nodes.map((n) => [n.id, n.label]));
const shapes = (g: MermaidGraph) => Object.fromEntries(g.nodes.map((n) => [n.id, n.shape]));

describe("parseFlowchart — header and direction", () => {
  it.each([
    ["graph TD", "TB"],
    ["graph TB", "TB"],
    ["graph BT", "BT"],
    ["flowchart LR", "LR"],
    ["flowchart RL", "RL"],
    ["flowchart", "TB"],
  ] as const)("%s → %s", (header, direction) => {
    expect(parse(`${header}\nA-->B`).direction).toBe(direction);
  });

  it("accepts statements on the header line and `;` separators", () => {
    const g = parse("graph LR; A-->B; B-->C");
    expect(edges(g)).toEqual(["A>B", "B>C"]);
    expect(parseFlowchart("graph TD A-->B").ok).toBe(false); // Mermaid needs a `;` or newline after the header too
  });

  it("reads a title from frontmatter", () => {
    expect(parse("---\ntitle: Login flow\n---\nflowchart LR\nA-->B").title).toBe("Login flow");
    expect(parse("---\ntitle: \"Quoted\"\n---\nflowchart LR\nA-->B").title).toBe("Quoted");
  });
});

describe("parseFlowchart — node shapes and labels", () => {
  it("reads every classic shape", () => {
    const g = parse(
      [
        "flowchart TD",
        "a[rect]",
        "b(round)",
        "c([stadium])",
        "d[[sub]]",
        "e[(db)]",
        "f((circle))",
        "g(((double)))",
        "h>asym]",
        "i{rhombus}",
        "j{{hex}}",
        "k[/lean right/]",
        "l[\\lean left\\]",
        "m[/trap\\]",
        "n[\\trap alt/]",
        "o",
      ].join("\n"),
    );
    expect(shapes(g)).toEqual({
      a: "rect",
      b: "round",
      c: "stadium",
      d: "subroutine",
      e: "cylinder",
      f: "circle",
      g: "double-circle",
      h: "asymmetric",
      i: "rhombus",
      j: "hexagon",
      k: "parallelogram",
      l: "parallelogram-alt",
      m: "trapezoid",
      n: "trapezoid-alt",
      o: "default",
    });
    expect(labels(g)).toMatchObject({ a: "rect", g: "double", k: "lean right", o: "o" });
  });

  it("falls back to a plain rectangle when a longer opener has no closer", () => {
    const g = parse("flowchart TD\nA[/usr/bin]");
    expect(g.nodes[0]).toMatchObject({ shape: "rect", label: "/usr/bin" });
  });

  it("cleans quoted, markdown-string, <br> and entity-coded labels", () => {
    const g = parse(
      ['flowchart TD', 'A["Say (hi) [now]"]', 'B["`**bold** text`"]', "C[line one<br/>line two]", "D[A #quot;quote#quot; #35;1]", "E[<b>tag</b>  spaced   out]"].join("\n"),
    );
    expect(labels(g)).toEqual({ A: "Say (hi) [now]", B: "**bold** text", C: "line one\nline two", D: 'A "quote" #1', E: "tag spaced out" });
  });

  it("reads the v11 `@{ shape, label }` form", () => {
    const g = parse('flowchart TD\nA@{ shape: diam, label: "Ok?" }\nB@{ shape: cyl }\nC@{ shape: bolt, label: Zap }\nA --> B');
    expect(g.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ["A", "rhombus", "Ok?"],
      ["B", "cylinder", "B"],
      ["C", "rect", "Zap"],
    ]);
    expect(g.notes.some((n) => n.includes('"bolt"'))).toBe(true);
  });

  it("keeps first-mention order, and a later definition sets the label and shape", () => {
    const g = parse("flowchart LR\nA --> B\nB{Decide}\nA[Start]");
    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(labels(g)).toEqual({ A: "Start", B: "Decide" });
    expect(shapes(g)).toEqual({ A: "rect", B: "rhombus" });
  });

  it("points each node's span at its defining mention", () => {
    const src = "flowchart LR\nA --> B\nB{Decide}";
    const b = parse(src).nodes.find((n) => n.id === "B")!;
    expect(src.slice(b.span.start, b.span.end)).toBe("B{Decide}");
  });

  it("allows hyphenated, numeric and unicode ids, and ignores :::class", () => {
    const g = parse("flowchart LR\nnode-1:::hot --> 2\n2 --> été[Summer]");
    expect(g.nodes.map((n) => n.id)).toEqual(["node-1", "2", "été"]);
    expect(edges(g)).toEqual(["node-1>2", "2>été"]);
  });
});

describe("parseFlowchart — links", () => {
  it.each([
    ["A-->B", "solid", "arrow", false],
    ["A --- B", "solid", "none", false],
    ["A ---> B", "solid", "arrow", false],
    ["A-.->B", "dotted", "arrow", false],
    ["A -.- B", "dotted", "none", false],
    ["A -..-> B", "dotted", "arrow", false],
    ["A ==> B", "thick", "arrow", false],
    ["A === B", "thick", "none", false],
    ["A ~~~ B", "invisible", "none", false],
    ["A --o B", "solid", "circle", false],
    ["A --x B", "solid", "cross", false],
    ["A <--> B", "solid", "arrow", true],
    ["A o--o B", "solid", "circle", true],
    ["A x--x B", "solid", "cross", true],
  ] as const)("%s", (stmt, line, arrow, bidirectional) => {
    const g = parse(`flowchart LR\n${stmt}`);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", line, arrow, bidirectional });
  });

  it.each([
    ["A-->|yes|B", "yes"],
    ["A --> |yes| B", "yes"],
    ["A ---|plain| B", "plain"],
    ["A-- text here -->B", "text here"],
    ["A -- with - dash --> B", "with - dash"],
    ["A -- no head --- B", "no head"],
    ["A -. maybe .-> B", "maybe"],
    ["A == strong ==> B", "strong"],
  ] as const)("label: %s", (stmt, label) => {
    const g = parse(`flowchart LR\n${stmt}`);
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", label });
  });

  it("expands chains and & groups", () => {
    expect(edges(parse("flowchart LR\nA --> B --> C"))).toEqual(["A>B", "B>C"]);
    expect(edges(parse("flowchart LR\nA & B --> C & D"))).toEqual(["A>C", "A>D", "B>C", "B>D"]);
    expect(edges(parse("flowchart LR\nA -->|go| B & C --> D"))).toEqual(["A>B:go", "A>C:go", "B>D", "C>D"]);
  });

  it("defines nodes inline in a chain", () => {
    const g = parse("flowchart TD\nA[Start] --> B{Is it?} -->|Yes| C(OK)");
    expect(labels(g)).toEqual({ A: "Start", B: "Is it?", C: "OK" });
    expect(edges(g)).toEqual(["A>B", "B>C:Yes"]);
  });
});

describe("parseFlowchart — subgraphs, comments, ignored lines", () => {
  it("assigns nodes to their innermost subgraph, with titles and directions", () => {
    const g = parse(
      [
        "flowchart LR",
        "subgraph one [First One]",
        "  direction TB",
        "  a1 --> a2",
        "  subgraph inner",
        "    i1",
        "  end",
        "end",
        'subgraph "Quoted Title"',
        "  b1",
        "end",
        "subgraph Plain title words",
        "  c1",
        "end",
        "a2 --> b1",
        "one --> c1",
      ].join("\n"),
    );
    expect(g.subgraphs.map((s) => [s.id, s.title, s.parent, s.direction])).toEqual([
      ["one", "First One", undefined, "TB"],
      ["inner", "inner", "one", undefined],
      ["Quoted Title", "Quoted Title", undefined, undefined],
      ["Plain title words", "Plain title words", undefined, undefined],
    ]);
    expect(Object.fromEntries(g.nodes.map((n) => [n.id, n.subgraph]))).toMatchObject({ a1: "one", a2: "one", i1: "inner", b1: "Quoted Title", c1: "Plain title words" });
    expect(edges(g)).toContain("one>c1");
  });

  it("a node first mentioned outside keeps no subgraph until one mentions it", () => {
    const g = parse("flowchart LR\nA --> B\nsubgraph S\n  B\nend");
    expect(g.nodes.find((n) => n.id === "A")!.subgraph).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "B")!.subgraph).toBe("S");
  });

  it("skips comments, directives and styling/interaction lines", () => {
    const g = parse(
      [
        "%%{init: {'theme':'dark'}}%%",
        "flowchart LR",
        "%% a comment",
        "A --> B %% trailing",
        "classDef hot fill:#f00",
        "class A hot",
        "style B fill:#0f0",
        "linkStyle 0 stroke:#00f",
        'click A "https://example.com"',
        "accTitle: The title",
        "accDescr {",
        "  multi line",
        "}",
      ].join("\n"),
    );
    expect(edges(g)).toEqual(["A>B"]);
    expect(g.title).toBe("The title");
    expect(g.notes.join()).toContain("4 styling lines");
  });

  it("does not split on the `;` of an entity code", () => {
    expect(parse("flowchart LR\nA[x #59; y] --> B").nodes[0]!.label).toBe("x ; y");
  });
});

describe("parseFlowchart — malformed input is a typed error, never a throw", () => {
  it.each([
    ["no header", "A --> B", 1],
    ["wrong header", "flowchart sideways\nA-->B", 1],
    ["unclosed shape", "flowchart LR\nA[oops --> B", 2],
    ["dangling link", "flowchart LR\nA -->", 2],
    ["link text never closed", "flowchart LR\nA -- text B", 2],
    ["garbage between nodes", "flowchart LR\nA ?? B", 2],
    ["end without subgraph", "flowchart LR\nA\nend", 3],
    ["unclosed subgraph", "flowchart LR\nsubgraph S\nA", 2],
    ["bad direction", "flowchart LR\nsubgraph S\ndirection XY\nend", 3],
    ["unclosed pipe label", "flowchart LR\nA -->|oops B", 2],
    ["unclosed @{", "flowchart LR\nA@{ shape: rect", 2],
  ] as const)("%s", (_name, source, line) => {
    const r = parseFlowchart(source);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ code: "syntax", kind: "flowchart", line });
    expect(r.error.message).toMatch(/^line \d+: /);
    expect(r.error.column).toBeGreaterThan(0);
  });
});
