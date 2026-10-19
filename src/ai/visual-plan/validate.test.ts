import { describe, expect, it } from "vitest";
import { RECOVERABLE_PLAN_FIXTURES, REJECTED_PLAN_FIXTURES, VALID_PLAN_FIXTURES } from "./fixtures";
import { TEXT_LIMITS } from "./schema";
import { missingWords } from "@/ai/fidelity/information";
import { MAX_PLAN_NODES, MAX_RELATIONSHIPS, MAX_SECTIONED_PLAN_NODES, InvalidVisualPlanError, validateVisualPlan } from "./validate";

const text = (id: string, markdown: string) => ({ id, type: "text", content: { markdown } });

describe("validateVisualPlan — valid fixtures", () => {
  it("accepts every template's fixture unchanged, with no warnings", () => {
    for (const [template, fixture] of Object.entries(VALID_PLAN_FIXTURES)) {
      const { plan, warnings } = validateVisualPlan(fixture);
      expect(plan, template).toEqual(fixture);
      expect(warnings, template).toEqual([]);
    }
  });
});

describe("validateVisualPlan — rejected outright (unusable)", () => {
  it.each(Object.entries(REJECTED_PLAN_FIXTURES))("rejects %s", (_name, fixture) => {
    expect(() => validateVisualPlan(fixture)).toThrow(InvalidVisualPlanError);
  });

  it("never returns anything partial when it throws", () => {
    try {
      validateVisualPlan(REJECTED_PLAN_FIXTURES.missingNodes);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidVisualPlanError);
      expect((err as InstanceType<typeof InvalidVisualPlanError>).problems.length).toBeGreaterThan(0);
    }
  });

  it("a plan whose only node is invalid is rejected (nothing survives)", () => {
    expect(() => validateVisualPlan(REJECTED_PLAN_FIXTURES.everyNodeInvalid)).toThrow(/no usable nodes/);
  });
});

describe("validateVisualPlan — lenient recovery", () => {
  it("renames a duplicate node id instead of dropping its content (relationships keep pointing at the first)", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.duplicateNodeId);
    expect(plan.nodes.map((n) => n.id)).toEqual(["n1", "n1~dup2"]);
    expect(plan.nodes[1]).toMatchObject({ content: { markdown: "Second, same id" } });
    expect(warnings.join()).toMatch(/duplicate id, kept as "n1~dup2"/);
  });

  it("shows a node type the chosen template doesn't use as text, with the same content", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.disallowedNodeTypeForTemplate);
    expect(plan.nodes.map((n) => n.type)).toEqual(["table", "text"]);
    expect(plan.nodes[1]).toMatchObject({ id: "n2", content: { markdown: "```\nnot used by comparison\n```" } });
    expect(warnings.join()).toMatch(/"code".*comparison.*shown as text/i);
  });

  it("converts a table, checklist and page the template doesn't use to Markdown text", () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "concept_map",
      nodes: [
        { id: "t", type: "table", content: { columns: ["Plan", "Price"], rows: [["Pro", "$10"]] } },
        { id: "c", type: "todo", content: { items: [{ text: "Ship", checked: true }] } },
        { id: "p", type: "page", content: { title: "Runbook", markdown: "Steps" } },
      ],
      relationships: [{ from: "t", to: "c", type: "relates_to" }],
    });
    expect(plan.nodes.map((n) => [n.type, n.type === "text" ? n.content.markdown : ""])).toEqual([
      ["text", "| Plan | Price |\n| --- | --- |\n| Pro | $10 |"],
      ["text", "- [x] Ship"],
      ["text", "**Runbook**\n\nSteps"],
    ]);
    expect(plan.relationships).toEqual([{ from: "t", to: "c", type: "relates_to" }]); // links to a converted node survive
  });

  it("drops an empty node of a type the template doesn't use (nothing to keep)", () => {
    const { plan, warnings } = validateVisualPlan({ ...VALID_PLAN_FIXTURES.flow, nodes: [...VALID_PLAN_FIXTURES.flow.nodes, { id: "e", type: "todo", content: { items: [] } }] });
    expect(plan.nodes.some((n) => n.id === "e")).toBe(false);
    expect(warnings.join()).toMatch(/empty "todo" node/);
  });

  it("keeps the text of a node that fails its schema, as a text block", () => {
    const { plan, warnings } = validateVisualPlan({
      version: 1,
      template: "flow",
      nodes: [
        { id: "h", type: "shape", content: { shape: "star", label: "Validate token" } },
        { id: "k", type: "card", title: "Retry", content: { body: "3 attempts, exponential backoff" } },
      ],
      relationships: [{ from: "h", to: "k", type: "flows_to" }],
    });
    expect(plan.nodes).toEqual([
      { id: "h", type: "text", content: { markdown: "Validate token" } },
      { id: "k", type: "text", title: "Retry", content: { markdown: "Retry\n\n3 attempts, exponential backoff" } },
    ]);
    expect(plan.relationships).toHaveLength(1);
    expect(warnings.join()).toMatch(/node 0: invalid .*kept as a text block/);
  });

  it("keeps a table a table when the model shapes its rows or cells differently, or gives a malformed optional field", () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [
        {
          id: "t1",
          type: "table",
          importance: "critical",
          sourceSpan: { start: 1.5, end: 3 },
          content: {
            columns: ["Scenario", "Before", "Now"],
            rows: [{ Scenario: "Unknown unit", Before: "Rejected", Now: "Recognised" }, ["Temperature", null, 185]],
          },
        },
        { id: "t2", type: "table", content: { rows: [{ Unit: "degF", Factor: "offset" }] } },
      ],
      relationships: [],
    });
    expect(plan.nodes).toEqual([
      { id: "t1", type: "table", content: { columns: ["Scenario", "Before", "Now"], rows: [["Unknown unit", "Rejected", "Recognised"], ["Temperature", "", "185"]] } },
      { id: "t2", type: "table", content: { columns: ["Unit", "Factor"], rows: [["degF", "offset"]] } },
    ]);
  });

  it("a row object's unmatched keys fill the columns it has no key for, in order (live run: the case landed in a trailing column)", () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "t", type: "table", content: { columns: ["", "Before", "Now"], rows: [{ Case: "Temperature", Before: "Rejected", Now: "Not checked: state it in degC" }] } }],
      relationships: [],
    });
    expect(plan.nodes[0]).toMatchObject({ content: { columns: ["", "Before", "Now"], rows: [["Temperature", "Rejected", "Not checked: state it in degC"]] } });
  });

  it("text given beside \"content\" instead of in it is kept, not dropped", () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "a1", type: "text", origin: "analysis", markdown: "Temperature stays unchecked: the offset can't be converted." }],
      relationships: [],
    });
    expect(plan.nodes[0]).toMatchObject({ id: "a1", type: "text", content: { markdown: "Temperature stays unchecked: the offset can't be converted." } });
  });

  it("leaves out a column empty in every row (live run: an example's \"Free | Pro | Lifetime\" copied into a table about checks)", () => {
    const { plan, warnings } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "t", type: "table", content: { columns: ["Attribute", "Free", "Pro"], rows: [["Surface vs reservoir", "", ""], ["Named variables", "", ""]] } }],
      relationships: [],
    });
    expect(plan.nodes[0]).toMatchObject({ content: { columns: ["Attribute"], rows: [["Surface vs reservoir"], ["Named variables"]] } });
    expect(warnings.join()).toMatch(/2 empty table column\(s\) \(Free, Pro\) left out/);
  });

  it("never loses a cell's text: rows wrapping their cells, and cells given as nested text", () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [
        {
          id: "t",
          type: "table",
          content: {
            columns: ["Case", "Before", "Now"],
            rows: [{ cells: ["Temperature", "Rejected", "Not checked"] }, [{ text: "Own unit" }, ["Rejected"], { type: "text", text: "Never rejected" }]],
          },
        },
      ],
      relationships: [],
    });
    expect(plan.nodes[0]).toMatchObject({ content: { columns: ["Case", "Before", "Now"], rows: [["Temperature", "Rejected", "Not checked"], ["Own unit", "Rejected", "Never rejected"]] } });
  });

  it("a table that still can't be one is kept as a Markdown table, never one cell per paragraph", () => {
    const cell = "x".repeat(10);
    const { plan } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "t", type: "table", content: { columns: ["A", "B"], rows: [["1", cell]] }, title: 42 }],
      relationships: [],
    });
    expect(plan.nodes[0]).toMatchObject({ type: "text", content: { markdown: `| A | B |\n| --- | --- |\n| 1 | ${cell} |` } });
  });

  it("drops a label that only names the target's form (\"table\", \"list\"), keeping the link", () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [text("a", "Intro"), text("b", "Details")],
      relationships: [
        { from: "a", to: "b", type: "explained_by", label: "Table" },
        { from: "b", to: "a", type: "supports", label: "reasoning" },
      ],
    });
    expect(plan.relationships).toEqual([{ from: "a", to: "b", type: "explained_by" }, { from: "b", to: "a", type: "supports", label: "reasoning" }]);
  });

  it("drops a relationship whose endpoint isn't in the plan (dangling reference)", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.danglingRelationship);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.relationships).toEqual([]);
    expect(warnings.join()).toMatch(/refers to a node that isn't in the plan/);
  });

  it("drops a self-loop when the template doesn't allow one", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.selfLoop);
    expect(plan.relationships).toEqual([]);
    expect(warnings.join()).toMatch(/self-loop/);
  });

  it("drops a relationship type the chosen template doesn't use", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.disallowedRelationTypeForTemplate);
    expect(plan.relationships).toEqual([]);
    expect(warnings.join()).toMatch(/"implements".*flow/i);
  });

  it("drops a malformed relationship (fails its own schema) without touching the nodes", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.invalidRelationshipShape);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.relationships).toEqual([]);
    expect(warnings.join()).toMatch(/relationship 0: dropped/);
  });

  it("splits oversized content (over a text limit) across linked blocks instead of dropping it", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.oversizedContent);
    expect(plan.nodes.map((n) => n.id)).toEqual(["n1", "n1~2", "n2"]);
    expect(plan.relationships).toEqual([{ from: "n1", to: "n1~2", type: "explained_by" }]);
    expect(missingWords(RECOVERABLE_PLAN_FIXTURES.oversizedContent.nodes, plan.nodes)).toEqual([]);
    expect(warnings.join()).toMatch(/split into 2 linked blocks/);
  });

  it("past MAX_PLAN_NODES, keeps the first ones and folds the rest into a 'More from this section' page", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.tooManyNodes);
    expect(plan.nodes).toHaveLength(MAX_PLAN_NODES + 1);
    expect(plan.nodes[0]!.id).toBe("n0");
    const more = plan.nodes.at(-1)!;
    expect(more).toMatchObject({ type: "page", content: { title: "More from this section" } });
    expect(more.type === "page" && more.content.markdown).toContain("Note 64");
    expect(missingWords(RECOVERABLE_PLAN_FIXTURES.tooManyNodes.nodes, plan.nodes)).toEqual([]);
    expect(warnings.join()).toMatch(/5 past the limit were kept/);
  });

  it("a sectioned plan holds MAX_PLAN_NODES per section, folding each section's overflow into that section", () => {
    const section = (g: string, n: number) => [
      { id: g, type: "group", content: { label: g, arrangement: "grid" } },
      ...Array.from({ length: n }, (_, i) => ({ id: `${g}${i}`, type: "text", parent: g, content: { markdown: `${g} item ${i}` } })),
    ];
    const input = { version: 1, template: "sectioned", nodes: [...section("a", 70), ...section("b", 10)], relationships: [] };
    const { plan } = validateVisualPlan(input);
    const inSection = (g: string) => plan.nodes.filter((n) => n.parent === g);
    expect(inSection("a")).toHaveLength(MAX_PLAN_NODES + 1);
    expect(inSection("a").at(-1)).toMatchObject({ type: "page", parent: "a" });
    expect(inSection("b")).toHaveLength(10);
    expect(missingWords(input.nodes, plan.nodes)).toEqual([]);
    expect(MAX_SECTIONED_PLAN_NODES).toBeGreaterThan(MAX_PLAN_NODES);
  });

  it("caps relationships at MAX_RELATIONSHIPS", () => {
    const many = {
      version: 1,
      template: "concept_map",
      nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, type: "shape", content: { shape: "ellipse", label: `${i}` } })),
      relationships: Array.from({ length: MAX_RELATIONSHIPS + 10 }, (_, i) => ({ from: `n${i % 30}`, to: `n${(i + 1) % 30}`, type: "relates_to" })),
    };
    const { plan, warnings } = validateVisualPlan(many);
    expect(plan.relationships).toHaveLength(MAX_RELATIONSHIPS);
    expect(warnings.join()).toMatch(/too many relationships/);
  });

  it("strips unknown fields from a node without dropping it", () => {
    const { plan, warnings } = validateVisualPlan(RECOVERABLE_PLAN_FIXTURES.unknownFieldsStripped);
    expect(plan.nodes).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toMatch(/extraField|secretApiKey|should not survive/);
    expect(warnings).toEqual([]); // stripping unknown fields is silent sanitization, not a recovery warning
  });

  it("treats a wrong-shaped relationships field as none, with a warning, instead of rejecting the plan", () => {
    const { plan, warnings } = validateVisualPlan({ ...VALID_PLAN_FIXTURES.action_plan, relationships: "not a list" });
    expect(plan.relationships).toEqual([]);
    expect(warnings.join()).toMatch(/relationships wasn't a list/);
  });

  it("shortens an over-long plan title instead of dropping the metadata", () => {
    const { plan, warnings } = validateVisualPlan({ ...VALID_PLAN_FIXTURES.flow, metadata: { title: "x".repeat(TEXT_LIMITS.planTitle + 1) } });
    expect(plan.metadata?.title).toHaveLength(TEXT_LIMITS.planTitle);
    expect(warnings.join()).toMatch(/metadata: title over/);
  });

  it("drops metadata that is shaped wrong, keeping the rest of the plan", () => {
    const { plan, warnings } = validateVisualPlan({ ...VALID_PLAN_FIXTURES.flow, metadata: { title: 42 } });
    expect(plan.metadata).toBeUndefined();
    expect(warnings.join()).toMatch(/metadata: dropped/);
  });

  it("shortens an over-long relationship label instead of dropping the relationship, and reports it as a loss", () => {
    const flow = VALID_PLAN_FIXTURES.flow;
    const rel = { ...flow.relationships[0]!, label: "y".repeat(TEXT_LIMITS.relationshipLabel + 5) };
    const { plan, losses } = validateVisualPlan({ ...flow, relationships: [rel] });
    expect(plan.relationships[0]!.label).toHaveLength(TEXT_LIMITS.relationshipLabel);
    expect(losses.join()).toMatch(/label over/);
  });
});

describe("validateVisualPlan — soft template-fit warnings (never fatal; role is optional on VisualNode)", () => {
  it("warns, but still returns a plan, when a recommended role is missing", () => {
    const { plan, warnings } = validateVisualPlan({
      version: 1,
      template: "problem_cause_solution",
      nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "Something" } }], // no role at all
      relationships: [],
    });
    expect(plan.nodes).toHaveLength(1);
    expect(warnings.join()).toMatch(/no node has role "problem" \/ "cause" \/ "solution"/);
  });

  it("warns when a template's plan is thinner than its recommended minimum", () => {
    const { warnings } = validateVisualPlan({
      version: 1,
      template: "architecture",
      nodes: [{ id: "n1", type: "shape", role: "component", content: { shape: "rectangle", label: "Only one" } }],
      relationships: [],
    });
    expect(warnings.join()).toMatch(/only 1 node.*at least 2/);
  });
});

describe("validateVisualPlan is deterministic and pure", () => {
  it("gives the same result for the same input, and never mutates its input", () => {
    const input = JSON.parse(JSON.stringify(RECOVERABLE_PLAN_FIXTURES.duplicateNodeId));
    const before = JSON.stringify(input);
    const a = validateVisualPlan(input);
    const b = validateVisualPlan(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("validateVisualPlan — a stable key over its limit is compacted, never a reason to drop the node", () => {
  it("keeps the node, with a key within the limit that is deterministic and distinct per original key", () => {
    // A section merging parts with long headings: every node's key carries the whole section key as a prefix.
    const section = Array.from({ length: 4 }, (_, i) => `Cheat sheet › Part ${i} with a rather long heading of its own, as copied documents have`).join(" + ");
    const node = (id: string, local: string) => ({ id, type: "text", stableKey: `${section} § ${local}`, content: { markdown: `Body ${id}` } });
    const { plan, losses } = validateVisualPlan({ version: 1, template: "sectioned", nodes: [node("a", "text#1"), node("b", "text#2")], relationships: [] });
    expect(plan.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(losses).toEqual([]);
    const [ka, kb] = plan.nodes.map((n) => n.stableKey!);
    expect(ka!.length).toBeLessThanOrEqual(300);
    expect(ka!.endsWith("§ text#1")).toBe(true);
    expect(ka).not.toBe(kb);
    expect(validateVisualPlan({ version: 1, template: "sectioned", nodes: [node("a", "text#1")], relationships: [] }).plan.nodes[0]!.stableKey).toBe(ka);
  });
});

describe("validateVisualPlan of a stored plan (an update's previous version)", () => {
  const groupedPlan = (groups: number) => ({
    version: 1,
    template: "sectioned",
    nodes: Array.from({ length: groups }, (_, i) => [
      { id: `g${i}`, type: "group", content: { label: `Section ${i}` } },
      { id: `t${i}`, type: "text", parent: `g${i}`, content: { markdown: `Body ${i}` } },
    ]).flat(),
    relationships: [],
  });

  it("a generated plan keeps its first 20 sections as frames, as before", () => {
    const { plan, warnings } = validateVisualPlan(groupedPlan(25));
    expect(plan.nodes.filter((n) => n.type === "group")).toHaveLength(20);
    expect(warnings.join(" ")).toMatch(/more than 20 groups/);
  });

  it("a stored plan keeps every frame a merge added: dropping their titles on the next update proposed removing them", () => {
    const { plan } = validateVisualPlan(groupedPlan(67), { stored: true });
    expect(plan.nodes.filter((n) => n.type === "group")).toHaveLength(67);
  });
});
