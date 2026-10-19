/**
 * F33 end to end: Mermaid source → `convertMermaid` → a plan that F29's
 * `validateVisualPlan` accepts unchanged → F30's `renderVisualPlan` → a real,
 * F19-parseable change set (pure: stub Markdown parser, no DOM).
 */
import { wrapArchitecturePlan } from "@/ai/visual-plan/architectureFrame";
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { renderVisualPlan, type RenderContext } from "@/ai/renderer/render";
import { MAX_PLAN_NODES, validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { convertMermaid, MAX_MERMAID_SOURCE } from "./convert";
import type { MermaidConversionResult } from "./types";

type Success = Extract<MermaidConversionResult, { ok: true }>;

function convert(source: string, options?: Parameters<typeof convertMermaid>[1]): Success {
  const r = convertMermaid(source, options);
  if (!r.ok) throw new Error(`expected a conversion, got ${r.error.code}: ${r.error.message}`);
  return r;
}

const shapeNodes = (plan: VisualPlan) => plan.nodes.filter((n): n is Extract<VisualNode, { type: "shape" }> => n.type === "shape");
const ids = (plan: VisualPlan) => plan.nodes.map((n) => n.id);
const rels = (plan: VisualPlan) => plan.relationships.map((r) => `${r.from}>${r.to}${r.label ? `:${r.label}` : ""}`);

const emptyContext: RenderContext = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const renderOptions = {
  operationId: "op_mermaid",
  title: "Convert Mermaid to canvas",
  metadata: { createdBy: "import" as const, operationId: "op_mermaid" },
  context: emptyContext,
  parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
};

/** The plan is already F29's output: validating it again changes nothing and drops nothing. */
function expectRevalidates(plan: VisualPlan) {
  const again = validateVisualPlan(plan);
  expect(again.plan).toEqual(plan);
  expect(again.warnings.filter((w) => /dropped|made top-level|kept the first/.test(w))).toEqual([]);
}

const CHECKOUT = `flowchart TD
  %% the classic example
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[fa:fa-car Car]`;

describe("convertMermaid — flowcharts to templates", () => {
  it("a top-down tree → decision_tree, rooted at its single start, with stable keys and source spans", () => {
    const r = convert(CHECKOUT);
    expect(r.kind).toBe("flowchart");
    expect(r.plan.template).toBe("decision_tree");
    expect(ids(r.plan)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(rels(r.plan)).toEqual(["A>B:Get money", "B>C", "C>D:One", "C>E:Two", "C>F:Three"]);
    expect(r.plan.relationships.every((rel) => rel.type === "flows_to")).toBe(true);
    const byId = Object.fromEntries(shapeNodes(r.plan).map((n) => [n.id, n]));
    expect(byId.A).toMatchObject({ role: "decision", content: { shape: "rectangle", label: "Christmas" }, stableKey: "mermaid:flowchart:node:A" });
    expect(byId.C).toMatchObject({ role: "decision", content: { shape: "diamond", label: "Let me think" } });
    expect(byId.B!.role).toBe("step");
    expect(byId.D!.role).toBe("outcome");
    const span = byId.C!.sourceSpan!;
    expect(CHECKOUT.slice(span.start, span.end)).toBe("C{Let me think}");
    expect(r.plan.metadata?.summary).toBe("Converted from a Mermaid flowchart: 6 nodes, 5 links.");
    expectRevalidates(r.plan);
  });

  it("puts the tree root first even when it is mentioned later", () => {
    const r = convert("flowchart TD\nB --> C\nB --> D\nA --> B");
    expect(r.plan.template).toBe("decision_tree");
    expect(ids(r.plan)[0]).toBe("A");
  });

  it("offsets every span into the containing document", () => {
    const r = convert(CHECKOUT, { sourceOffset: 100 });
    const c = r.plan.nodes.find((n) => n.id === "C")!;
    expect(CHECKOUT.slice(c.sourceSpan!.start - 100, c.sourceSpan!.end - 100)).toBe("C{Let me think}");
  });

  it("a single chain → flow, in path order, all steps", () => {
    const r = convert("graph LR\nC --> D\nA[Log in] --> B[Validate]\nB --> C[Token]\nD[Dashboard]");
    expect(r.plan.template).toBe("flow");
    expect(ids(r.plan)).toEqual(["A", "B", "C", "D"]);
    expect(shapeNodes(r.plan).every((n) => n.role === "step")).toBe(true);
    expect(r.warnings).toEqual([]);
    expectRevalidates(r.plan);
  });

  it("a branching left-to-right graph → architecture", () => {
    const r = convert("flowchart LR\nweb --> api\napi --> db[(Postgres)]\napi --> cache[(Redis)]\nworker --> db");
    expect(r.plan.template).toBe("architecture");
    expect(shapeNodes(r.plan).every((n) => n.role === "component")).toBe(true);
    // Databases keep their cylinder (a composite canvas shape), so nothing is approximated.
    expect(shapeNodes(r.plan).filter((n) => n.content.shape === "cylinder").map((n) => n.id)).toEqual(["db", "cache"]);
    expect(r.warnings.join()).not.toContain("cylinder");
    expectRevalidates(r.plan);
  });

  it("a top-down graph with several starts → architecture, with a note", () => {
    const r = convert("flowchart TD\nA --> C\nB --> C\nC --> D");
    expect(r.plan.template).toBe("architecture");
    expect(r.warnings.join()).toContain("2 starting points");
  });

  it("a graph with loops keeps every link and its layered layout, starting from its first node", () => {
    const retry = convert("flowchart TD\nA --> B{ok?}\nB -->|no| A\nB -->|yes| C");
    expect(retry.plan.template).toBe("decision_tree");
    expect(retry.plan.nodes[0]).toMatchObject({ id: "A" });
    expect(rels(retry.plan)).toEqual(["A>B", "B>A:no", "B>C:yes"]);
    expect(retry.warnings.join()).not.toContain("starting points");
    expectRevalidates(retry.plan);

    const ring = convert(`flowchart LR\n${Array.from({ length: 10 }, (_, i) => `n${i} --> n${(i + 1) % 10}`).join("\n")}`);
    expect(ring.plan.template).toBe("architecture");
    expect(ring.plan.relationships).toHaveLength(10);
    expectRevalidates(ring.plan);
  });

  it("arrows are flows_to; undirected and two-way links are relates_to", () => {
    const r = convert("flowchart LR\nA --> B\nB -.-> C\nC ==> D\nD --- E\nE <--> F");
    expect(r.plan.relationships.map((rel) => `${rel.from}>${rel.to}:${rel.type}`)).toEqual([
      "A>B:flows_to",
      "B>C:flows_to",
      "C>D:flows_to",
      "D>E:relates_to",
      "E>F:relates_to",
    ]);
    expectRevalidates(r.plan);
  });

  it("notes a bottom-up or right-to-left direction", () => {
    expect(convert("flowchart BT\nA --> B --> C").warnings.join()).toContain("bottom to top");
    expect(convert("flowchart RL\nA --> B --> C").warnings.join()).toContain("right to left");
  });

  it("maps Mermaid shapes onto the canvas's native and diagram shapes", () => {
    const r = convert(
      "flowchart LR\na[r] --> b(r) --> c([e]) --> d((e)) --> e{d} --> f{{h}} --> g[(c)] --> h>a]\n" +
        "h --> i[[s]] --> j[/p/] --> k[\\p\\] --> l[\\t/] --> m[/t\\] --> n@{ shape: doc, label: \"Report\" }",
    );
    expect(Object.fromEntries(shapeNodes(r.plan).map((n) => [n.id, n.content.shape]))).toEqual({
      a: "rectangle",
      b: "rectangle",
      c: "ellipse",
      d: "ellipse",
      e: "diamond",
      f: "hexagon",
      g: "cylinder",
      h: "rectangle",
      i: "subroutine",
      j: "parallelogram",
      k: "parallelogram",
      l: "trapezoid",
      m: "trapezoid",
      n: "document",
    });
    // Only the asymmetric flag has no equivalent; the left-leaning parallelogram and the wide-bottomed trapezoid are drawn mirrored.
    expect(r.warnings.join()).toContain("(asymmetric) are drawn as rectangles");
    expect(r.warnings.join()).toContain("(parallelogram-alt, trapezoid) are drawn mirrored");
  });

  it("drops invisible and self links, dedupes repeats, and notes link styles it can't keep", () => {
    const r = convert("flowchart LR\nA --> B\nA --> B\nA ~~~ C\nC --> C\nB -.-> C\nB <--> A");
    expect(rels(r.plan)).toEqual(["A>B", "B>C", "B>A"]);
    const w = r.warnings.join(" | ");
    expect(w).toContain("1 invisible link");
    expect(w).toContain("C → itself");
    expect(w).toContain("2 links drawn as plain connections");
  });

  it("shortens over-long labels instead of losing the node", () => {
    const r = convert(`flowchart LR\nA[${"x".repeat(400)}] --> B`);
    const a = shapeNodes(r.plan).find((n) => n.id === "A")!;
    expect(a.content.label).toHaveLength(300);
    expect(a.content.label.endsWith("…")).toBe(true);
    expect(r.warnings.join()).toContain("shortened");
  });

  it("carries the frontmatter title into the plan metadata", () => {
    expect(convert("---\ntitle: Login\n---\nflowchart LR\nA --> B").plan.metadata?.title).toBe("Login");
  });

  it("is deterministic", () => {
    expect(convertMermaid(CHECKOUT)).toEqual(convertMermaid(CHECKOUT));
  });
});

describe("convertMermaid — subgraphs become sections (F42 groups)", () => {
  const SOURCE = [
    "flowchart TB",
    "  subgraph fe [Frontend]",
    "    ui[Web UI] --> state[Store]",
    "  end",
    "  subgraph be [Backend]",
    "    direction LR",
    "    api --> svc",
    "  end",
    "  ext[Partner]",
    "  state --> api",
    "  ext --> be",
  ].join("\n");

  it("groups members under a group node, with arrangements and links to a subgraph by id", () => {
    const r = convert(SOURCE);
    expect(r.plan.template).toBe("sectioned");
    expect(ids(r.plan)).toEqual(["fe", "ui", "state", "be", "api", "svc", "ext"]);
    const groups = r.plan.nodes.filter((n) => n.type === "group");
    expect(groups).toEqual([
      expect.objectContaining({ id: "fe", content: { label: "Frontend", arrangement: "tree" }, stableKey: "mermaid:flowchart:subgraph:fe" }),
      expect.objectContaining({ id: "be", content: { label: "Backend", arrangement: "chain" }, stableKey: "mermaid:flowchart:subgraph:be" }),
    ]);
    const parents = Object.fromEntries(r.plan.nodes.filter((n) => n.type !== "group").map((n) => [n.id, n.parent]));
    expect(parents).toEqual({ ui: "fe", state: "fe", api: "be", svc: "be", ext: undefined });
    expect(rels(r.plan)).toContain("ext>be");
    const fe = groups[0]!;
    expect(SOURCE.slice(fe.sourceSpan!.start, fe.sourceSpan!.end)).toMatch(/^subgraph fe \[Frontend\][\s\S]*end$/);
    expect(r.plan.metadata?.summary).toContain("2 sections");
    expectRevalidates(r.plan);
  });

  it("flattens nesting: each subgraph with nodes of its own is a section; an empty wrapper isn't drawn", () => {
    const r = convert(["flowchart LR", "subgraph cloud [Cloud]", "  subgraph a [A]", "    a1 --> a2", "  end", "  subgraph b [B]", "    b1", "  end", "end", "cloud --> x", "a2 --> b1"].join("\n"));
    expect(r.plan.nodes.filter((n) => n.type === "group").map((n) => n.id)).toEqual(["a", "b"]);
    const w = r.warnings.join(" | ");
    expect(w).toContain('subgraph "Cloud" has no nodes of its own');
    expect(w).toContain("link cloud → x");
    expect(rels(r.plan)).toEqual(["a1>a2", "a2>b1"]);
    expectRevalidates(r.plan);
  });

  it("uses tree inside a top-down subgraph even when its links loop", () => {
    const r = convert("flowchart TB\nsubgraph s [Loop]\n  a --> b\n  b --> a\nend");
    expect(r.plan.nodes[0]).toMatchObject({ type: "group", content: { arrangement: "tree" } });
  });
});

describe("convertMermaid — state diagrams", () => {
  it("a simple machine: start/end circles, labelled transitions", () => {
    const r = convert("stateDiagram-v2\n[*] --> Still\nStill --> Moving : push\nMoving --> Still : stop\nMoving --> Crash\nCrash --> [*]");
    expect(r.kind).toBe("state");
    expect(r.plan.template).toBe("decision_tree"); // loops (Moving → Still) keep the layered layout, rooted at the start
    expect(r.plan.relationships.every((rel) => rel.type === "flows_to")).toBe(true);
    const byId = Object.fromEntries(shapeNodes(r.plan).map((n) => [n.id, n]));
    expect(byId._start).toMatchObject({ content: { shape: "ellipse", label: "Start" }, stableKey: "mermaid:state:node:_start" });
    expect(byId._end).toMatchObject({ content: { shape: "ellipse", label: "End" } });
    expect(rels(r.plan)).toContain("Still>Moving:push");
    expectRevalidates(r.plan);
  });

  it("a composite state becomes a section", () => {
    const r = convert(["stateDiagram-v2", "[*] --> Active", "state Active {", "  [*] --> Idle", "  Idle --> Busy : job", "}", "Active --> Done"].join("\n"));
    expect(r.plan.template).toBe("sectioned");
    expect(r.plan.nodes.find((n) => n.id === "Active")).toMatchObject({ type: "group", content: { label: "Active", arrangement: "tree" } });
    expect(rels(r.plan)).toEqual(["_start>Active", "_start_Active>Idle", "Idle>Busy:job", "Active>Done"]);
    expectRevalidates(r.plan);
  });
});

describe("convertMermaid — sequence diagrams", () => {
  it("messages become chained, numbered steps — in order, never deduped", () => {
    const r = convert("sequenceDiagram\nparticipant A as Alice\nparticipant B as Bob\nAlice->>Bob: Hi\nBob-->>Alice: Hi\nAlice->>Bob: Hi");
    expect(r.kind).toBe("sequence");
    expect(r.plan.template).toBe("flow");
    expect(ids(r.plan)).toEqual(["msg1", "msg2", "msg3"]);
    expect(shapeNodes(r.plan).map((n) => n.content.label)).toEqual(["Alice → Bob: Hi", "Bob → Alice: Hi (async)", "Alice → Bob: Hi"]);
    expect(rels(r.plan)).toEqual(["msg1>msg2", "msg2>msg3"]);
    expect(r.plan.relationships.every((rel) => rel.type === "flows_to")).toBe(true);
    expectRevalidates(r.plan);
  });

  it("a note attaches to the message it follows, as a linked detail card", () => {
    const r = convert("sequenceDiagram\nA->>B: Submit\nNote right of B: Validates the payload\nB-->>A: Ack");
    expect(r.plan.nodes).toMatchObject([{ id: "msg1" }, { id: "msg2" }, { id: "note1", type: "text", content: { markdown: "Validates the payload" } }]);
    expect(rels(r.plan)).toEqual(["msg1>msg2", "msg1>note1"]);
    expect(r.plan.relationships.find((rel) => rel.to === "note1")?.type).toBe("explained_by");
  });

  it("loop/alt blocks become bracketed label prefixes, never dropped", () => {
    const r = convert("sequenceDiagram\nloop Retry up to 3x\nA->>B: Submit\nend\nalt Success\nB-->>A: Ack\nelse Failure\nB-->>A: Nack\nend");
    const labels = shapeNodes(r.plan).map((n) => n.content.label);
    expect(labels).toEqual(["A → B: [loop: Retry up to 3x] Submit", "B → A: [alt: Success] Ack (async)", "B → A: [alt: Failure] Nack (async)"]);
    expectRevalidates(r.plan);
  });

  it("unclosed block / unmatched end / unknown construct → syntax errors", () => {
    const fails = (source: string) => {
      const r = convertMermaid(source);
      if (r.ok) throw new Error("expected a failure");
      return r.error;
    };
    expect(fails("sequenceDiagram\nloop Retry\nA->>B: Hi")).toMatchObject({ code: "syntax" });
    expect(fails("sequenceDiagram\nend")).toMatchObject({ code: "syntax" });
    expect(fails("sequenceDiagram\ncreate participant A")).toMatchObject({ code: "syntax" });
  });
});

describe("convertMermaid — pie charts (Wave E)", () => {
  it("becomes one table: label, value and share — the fallback a bare table already supports", () => {
    const r = convert('pie title Pets\n"Dogs" : 386\n"Cats" : 85\n"Rats" : 15');
    expect(r.kind).toBe("pie");
    expect(r.plan.template).toBe("comparison");
    expect(r.plan.metadata?.title).toBe("Pets");
    const table = r.plan.nodes[0];
    expect(table).toMatchObject({ type: "table", content: { columns: ["Label", "Value", "Share"], rows: [["Dogs", "386", "79.4%"], ["Cats", "85", "17.5%"], ["Rats", "15", "3.1%"]] } });
    expectRevalidates(r.plan);
  });

  it("syntax errors and no-slice diagrams are typed, not thrown", () => {
    const fails = (source: string) => {
      const r = convertMermaid(source);
      if (r.ok) throw new Error("expected a failure");
      return r.error;
    };
    expect(fails("pie\nnot a slice")).toMatchObject({ code: "syntax" });
    expect(fails("pie\ntitle Empty")).toMatchObject({ code: "no_nodes" });
  });
});

describe("convertMermaid — gantt charts (Wave E)", () => {
  it("becomes chained, numbered steps in source order — section/start/duration folded into the label", () => {
    const r = convert(["gantt", "title Launch plan", "dateFormat YYYY-MM-DD", "section Design", "Mockups :a1, 2024-01-01, 5d", "section Build", "Implement :after a1, 10d", "Ship : 2d"].join("\n"));
    expect(r.kind).toBe("gantt");
    expect(r.plan.template).toBe("timeline");
    expect(r.plan.metadata?.title).toBe("Launch plan");
    expect(ids(r.plan)).toEqual(["task1", "task2", "task3"]);
    expect(shapeNodes(r.plan).map((n) => n.content.label)).toEqual(["[Design] Mockups (2024-01-01 · 5d)", "[Build] Implement (after a1 · 10d)", "[Build] Ship (2d)"]);
    expect(rels(r.plan)).toEqual(["task1>task2", "task2>task3"]);
    expectRevalidates(r.plan);
  });

  it("tags (done/active/crit/milestone) are read past, never breaking the parse", () => {
    const r = convert("gantt\nA task :done, crit, a1, 2024-01-01, 3d\nB task :active, after a1, 2d");
    expect(shapeNodes(r.plan).map((n) => n.content.label)).toEqual(["A task (2024-01-01 · 3d)", "B task (after a1 · 2d)"]);
  });

  it("syntax errors and no-task diagrams are typed, not thrown", () => {
    const fails = (source: string) => {
      const r = convertMermaid(source);
      if (r.ok) throw new Error("expected a failure");
      return r.error;
    };
    expect(fails("gantt\nnot a task line")).toMatchObject({ code: "syntax" });
    expect(fails("gantt\ntitle Empty")).toMatchObject({ code: "no_nodes" });
  });
});

describe("convertMermaid — typed failures, never a throw", () => {
  const fails = (source: string, options?: Parameters<typeof convertMermaid>[1]) => {
    const r = convertMermaid(source, options);
    if (r.ok) throw new Error("expected a failure");
    return r.error;
  };

  it("empty / not Mermaid", () => {
    expect(fails("").code).toBe("empty");
    expect(fails("  \n%% nothing\n").code).toBe("empty");
    expect(fails("hello world").code).toBe("not_mermaid");
    expect(fails("hello world", { language: "mermaid" }).code).toBe("unsupported_diagram");
  });

  it.each([
    ["mindmap\n  root", "mindmap"],
    ["gitGraph\ncommit", "gitgraph"],
  ] as const)("unsupported kind: %j", (source, kind) => {
    const e = fails(source);
    expect(e).toMatchObject({ code: "unsupported_diagram", kind });
    expect(e.message).toContain("only flowcharts, state, class, entity-relationship, sequence, pie, gantt and architecture diagrams");
  });

  it("syntax errors carry the line", () => {
    expect(fails("flowchart LR\nA --> B\nA -->")).toMatchObject({ code: "syntax", line: 3 });
    expect(fails("stateDiagram-v2\nstate A {")).toMatchObject({ code: "syntax", kind: "state" });
  });

  it("no nodes", () => {
    expect(fails("flowchart LR").code).toBe("no_nodes");
    expect(fails("flowchart LR\nsubgraph s\nend").code).toBe("no_nodes");
  });

  it("too large: over F29's node limit, or an over-long source", () => {
    const many = `flowchart LR\n${Array.from({ length: MAX_PLAN_NODES + 1 }, (_, i) => `n${i}`).join("\n")}`;
    expect(fails(many)).toMatchObject({ code: "too_large" });
    expect(fails(`flowchart LR\nA[${"x".repeat(MAX_MERMAID_SOURCE)}]`).code).toBe("too_large");
    // Exactly at the limit converts.
    expect(convert(`flowchart LR\n${Array.from({ length: MAX_PLAN_NODES }, (_, i) => `n${i}`).join("\n")}`).plan.nodes).toHaveLength(MAX_PLAN_NODES);
  });

  it("never throws on junk", () => {
    const junk = ["flowchart LR\n[[[", "flowchart LR\n-->", "flowchart LR\nA-->B-->", "graph\n{}", "stateDiagram\n-->", 'flowchart LR\nA["unclosed', "flowchart LR\n&&&", "stateDiagram-v2\n}}}", "graph TD\nA@{"];
    for (const j of junk) expect(() => convertMermaid(j)).not.toThrow();
    for (const j of junk) expect(convertMermaid(j).ok).toBe(false);
    expect(convertMermaid(null as unknown as string)).toMatchObject({ ok: false, error: { code: "empty" } });
  });
});

describe("convertMermaid → renderVisualPlan (F30), pure", () => {
  const cases: [string, string][] = [
    ["decision_tree", CHECKOUT],
    ["flow", "graph LR\nA --> B --> C"],
    ["decision_tree (loop)", "flowchart TD\nA --> B{ok?}\nB -->|no| A\nB -->|yes| C"],
    ["architecture", "flowchart LR\nweb --> api\napi --> db\napi --> cache"],
    ["architecture (ring)", `flowchart LR\n${Array.from({ length: 10 }, (_, i) => `n${i} --> n${(i + 1) % 10}`).join("\n")}`],
    ["sectioned", "flowchart TB\nsubgraph fe [Frontend]\n  ui --> st\nend\nsubgraph be [Backend]\n  api --> svc\nend\nst --> api\nx --> be"],
    ["state composite", "stateDiagram-v2\n[*] --> Active\nstate Active {\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> Idle\n}\nActive --> [*]"],
  ];

  for (const [name, source] of cases) {
    it(`renders ${name} into a parseable change set with one object per node and one connect per link`, async () => {
      const { plan } = convert(source);
      const set = await renderVisualPlan(plan, renderOptions);
      expect(() => parseChangeSet(set)).not.toThrow();
      // Sections as the renderer sees them: an architecture plan with component kinds is wrapped in one diagram frame.
      const wrapped = wrapArchitecturePlan(plan);
      const groups = wrapped.nodes.filter((n) => n.type === "group").length;
      expect(set.changes.filter((c) => c.kind !== "connect" && c.kind !== "move")).toHaveLength(wrapped.nodes.length + groups);
      expect(set.changes.filter((c) => c.kind === "connect")).toHaveLength(plan.relationships.length);
      expect(set.changes.filter((c) => c.kind === "create_shape")).toHaveLength(wrapped.nodes.length - groups);
    });
  }
});
