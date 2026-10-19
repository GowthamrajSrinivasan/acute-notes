/**
 * F42 Phase 3 end to end: an ASCII tree → `convertAsciiTree` → a plan F29's `validateVisualPlan` accepts
 * unchanged → F30's `renderVisualPlan` → a real, F19-parseable change set (pure: stub Markdown parser, no DOM).
 * Also `treePlanParts`, the pieces a document plan splices into a `tree` section.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { renderVisualPlan, type RenderContext } from "@/ai/renderer/render";
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { MAX_PLAN_NODES, validateVisualPlan } from "@/ai/visual-plan/validate";
import { convertAsciiTree, parseAsciiTree } from "./convert";
import { treePlanParts } from "./toVisualPlan";
import type { AsciiTreeConversionResult } from "./types";

type Success = Extract<AsciiTreeConversionResult, { ok: true }>;

function convert(source: string, options?: Parameters<typeof convertAsciiTree>[1]): Success {
  const r = convertAsciiTree(source, options);
  if (!r.ok) throw new Error(`expected a conversion, got ${r.error.code}: ${r.error.message}`);
  return r;
}

const shapes = (plan: VisualPlan) => plan.nodes.filter((n): n is Extract<VisualNode, { type: "shape" }> => n.type === "shape");
const labels = (plan: VisualPlan) => Object.fromEntries(shapes(plan).map((n) => [n.id, n.content.label]));
const rels = (plan: VisualPlan) => {
  const l = labels(plan);
  return plan.relationships.map((r) => `${l[r.from]}>${l[r.to]}:${r.type}`);
};

/** The plan is already F29's output: validating it again changes nothing and drops nothing. */
function expectRevalidates(plan: VisualPlan) {
  const again = validateVisualPlan(plan);
  expect(again.plan).toEqual(plan);
  expect(again.warnings.filter((w) => /dropped|made top-level|kept the first/.test(w))).toEqual([]);
}

const emptyContext: RenderContext = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const renderOptions = {
  operationId: "op_ascii",
  title: "Convert ASCII tree to canvas",
  metadata: { createdBy: "import" as const, operationId: "op_ascii" },
  context: emptyContext,
  parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
};

const PRICING = readFileSync("e2e/ai/fixtures/pricingAnswer.md", "utf8");
const FENCE = /```text\n([\s\S]*?)```/.exec(PRICING)!;
const BUSINESS_MODEL = FENCE[1]!;
/** Where the fence's body starts in the fixture: what a planner passes as `sourceOffset`. */
const BODY_OFFSET = FENCE.index + "```text\n".length;

const TREE_CMD = ".\n├── package.json\n├── src\n│   ├── index.ts\n│   └── utils\n│       └── math.ts\n└── README.md\n";
const TWO_ROOTS = "frontend/\n├── app\n└── lib\nbackend/\n├── api\n└── db\n";
const ORG = "        ┌─────┐\n        │ CEO │\n        └──┬──┘\n     ┌─────┴─────┐\n   ┌─┴─┐       ┌─┴─┐\n   │CTO│       │CFO│\n   └───┘       └───┘\n";

describe("convertAsciiTree", () => {
  it("the pricing fixture's business model → decision_tree of shapes, parent → child relates_to, spans into the document", () => {
    const r = convert(BUSINESS_MODEL, { sourceOffset: BODY_OFFSET, title: "Business model" });
    expect(r.style).toBe("box");
    expect(r.plan.template).toBe("decision_tree");
    expect(r.plan.metadata).toEqual({ title: "Business model", summary: "Converted from an ASCII tree: 8 nodes, 7 links." });
    expect(rels(r.plan)).toEqual([
      "ACUTE>FREE:relates_to",
      "FREE>Full editor/canvas\nFull basic features\n10 AI actions/month:relates_to",
      "ACUTE>PAID:relates_to",
      "PAID>PRO:relates_to",
      "PRO>Subscription:relates_to",
      "PAID>LIFETIME:relates_to",
      "LIFETIME>BYOK:relates_to",
    ]);
    const nodes = shapes(r.plan);
    expect(nodes.every((n) => n.content.shape === "rectangle")).toBe(true);
    expect(nodes[0]).toMatchObject({ id: "t1", role: "decision", content: { label: "ACUTE" }, stableKey: "ascii:tree:ACUTE" });
    expect(nodes.find((n) => n.content.label === "PRO")).toMatchObject({ role: "step", stableKey: "ascii:tree:ACUTE › PAID › PRO" });
    expect(nodes.find((n) => n.content.label === "BYOK")).toMatchObject({ role: "outcome", stableKey: "ascii:tree:ACUTE › PAID › LIFETIME › BYOK" });
    for (const n of nodes.filter((x) => !x.content.label.includes("\n"))) expect(PRICING.slice(n.sourceSpan!.start, n.sourceSpan!.end)).toBe(n.content.label);
    expect(r.warnings).toEqual([]);
    expectRevalidates(r.plan);
  });

  it("indented `tree` output → decision_tree rooted at the first node", () => {
    const r = convert(TREE_CMD);
    expect(r.style).toBe("indented");
    expect(r.plan.template).toBe("decision_tree");
    expect(shapes(r.plan).map((n) => n.role)).toEqual(["decision", "outcome", "step", "outcome", "step", "outcome", "outcome"]);
    expect(rels(r.plan)).toContain("utils>math.ts:relates_to");
    expectRevalidates(r.plan);
  });

  it("several trees → one `tree`-arranged section holding them all", () => {
    const r = convert(TWO_ROOTS, { title: "Repo layout" });
    expect(r.plan.template).toBe("sectioned");
    const group = r.plan.nodes[0]!;
    expect(group).toMatchObject({ id: "tree", type: "group", role: "hierarchy", content: { label: "Repo layout", arrangement: "tree" } });
    expect(shapes(r.plan).every((n) => n.parent === "tree")).toBe(true);
    expect(r.plan.metadata?.summary).toBe("Converted from an ASCII tree: 6 nodes, 4 links, 2 trees.");
    expectRevalidates(r.plan);
    expect(convert(TWO_ROOTS).plan.nodes[0]).toMatchObject({ content: { label: "Tree" } });
  });

  it("one tree plus a loose caption stays a decision_tree; the caption is a note", () => {
    const r = convert("  Business model\n\n      ROOT\n   ┌───┴───┐\n   A       B\n");
    expect(r.plan.template).toBe("decision_tree");
    expect(shapes(r.plan).map((n) => `${n.content.label}:${n.role}`)).toEqual(["Business model:note", "ROOT:decision", "A:outcome", "B:outcome"]);
    expect(r.warnings.join()).toContain("isn't connected");
  });

  it("stable keys: from the label path, repeated paths numbered, independent of layout", () => {
    const r = convert("root\n├── a\n│   └── x\n├── a\n│   └── x\n└── b\n");
    expect(shapes(r.plan).map((n) => n.stableKey)).toEqual([
      "ascii:tree:root",
      "ascii:tree:root › a",
      "ascii:tree:root › a › x",
      "ascii:tree:root › a#2",
      "ascii:tree:root › a › x#2",
      "ascii:tree:root › b",
    ]);
    // The same tree drawn top-down keeps its keys.
    const box = convert("     root\n  ┌───┴───┐\n  a       b\n  │\n  x\n");
    const indented = convert("root\n├── a\n│   └── x\n└── b\n");
    expect(shapes(box.plan).map((n) => n.stableKey).sort()).toEqual(shapes(indented.plan).map((n) => n.stableKey).sort());
    // Deep paths of long labels stay within the schema's key limit.
    const deep = ["L".repeat(80), ...Array.from({ length: 8 }, (_, d) => `${"    ".repeat(d)}└── ${"x".repeat(80)}${d}`)].join("\n");
    expect(shapes(convert(deep).plan).every((n) => n.stableKey!.length <= 300)).toBe(true);
  });

  it("caps labels at TEXT_LIMITS.shapeLabel, with a warning", () => {
    const r = convert(`root\n└── ${"word ".repeat(100).trim()}`);
    const long = shapes(r.plan)[1]!;
    expect(long.content.label.length).toBe(TEXT_LIMITS.shapeLabel);
    expect(long.content.label.endsWith("…")).toBe(true);
    expect(r.warnings.join()).toContain("1 label over 300 characters shortened");
    expectRevalidates(r.plan);
  });

  it("bounded by F29's node limit", () => {
    const tree = (n: number) => ["root", ...Array.from({ length: n - 1 }, (_, i) => `├── n${i}`)].join("\n");
    expect(convert(tree(MAX_PLAN_NODES)).plan.nodes).toHaveLength(MAX_PLAN_NODES);
    expect(convertAsciiTree(tree(MAX_PLAN_NODES + 1))).toMatchObject({ ok: false, error: { code: "too_large" } });
  });

  it("typed errors, never a throw", () => {
    expect(convertAsciiTree("")).toMatchObject({ ok: false, error: { code: "empty" } });
    expect(convertAsciiTree("| a | b |\n|---|---|\n")).toMatchObject({ ok: false, error: { code: "not_a_tree" } });
    expect(convertAsciiTree("    A\n   / \\\n  B   C\n")).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(convertAsciiTree(undefined as unknown as string)).toMatchObject({ ok: false, error: { code: "empty" } });
    // Fuzz: random mixes of drawing characters and words.
    const alphabet = [..."├└│┌┐┘┬┴┼─ |+-`\\/[]▼→ab\n\n  "];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 300; i++) {
      const s = Array.from({ length: 20 + Math.floor(rand() * 200) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      expect(() => convertAsciiTree(s)).not.toThrow();
      const r = convertAsciiTree(s);
      if (r.ok) expectRevalidates(r.plan);
    }
  });
});

describe("treePlanParts: a tree inside a document section", () => {
  it("shape nodes under a given group, keyed under the section, spans offset; the plan validates and renders", async () => {
    const parsed = parseAsciiTree(BUSINESS_MODEL);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const parts = treePlanParts(parsed.tree, { idPrefix: "n9_", keyPrefix: "Business model#", parent: "g1", sourceOffset: BODY_OFFSET });
    expect(parts.trees).toEqual(["n9_1"]);
    expect(parts.nodes[0]).toMatchObject({ id: "n9_1", parent: "g1", stableKey: "Business model#ascii:tree:ACUTE" });
    expect(PRICING.slice(parts.nodes[0]!.sourceSpan!.start, parts.nodes[0]!.sourceSpan!.end)).toBe("ACUTE");
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "n1", type: "heading", role: "title", content: { text: "Pricing" } },
        { id: "g1", type: "group", role: "hierarchy", content: { label: "Business model", arrangement: "tree" } },
        ...parts.nodes,
        { id: "g2", type: "group", content: { label: "Notes", arrangement: "grid" } },
        { id: "n2", type: "text", parent: "g2", content: { markdown: "Instrument from day one." } },
      ],
      relationships: parts.relationships,
    };
    const validated = validateVisualPlan(plan);
    expect(validated.plan).toEqual(plan);
    const set = await renderVisualPlan(validated.plan, renderOptions);
    expect(() => parseChangeSet(set)).not.toThrow();
    expect(set.changes.filter((c) => c.kind === "create_shape")).toHaveLength(parts.nodes.length);
    expect(set.changes.filter((c) => c.kind === "connect")).toHaveLength(parts.relationships.length);
    expect(set.changes.filter((c) => c.kind === "create_frame")).toHaveLength(2);
  });
});

describe("convertAsciiTree → renderVisualPlan (F30), pure", () => {
  const cases: [string, string][] = [
    ["the pricing business model (box)", BUSINESS_MODEL],
    ["`tree` output (indented)", TREE_CMD],
    ["an org chart of boxes", ORG],
    ["two roots (sectioned)", TWO_ROOTS],
    ["ASCII +--+ branches", "        root\n         |\n   +-----+-----+\n   |     |     |\n [ a ] [ b ]  [ c ]\n"],
    ["`tree /F`", "C:.\n├───src\n│   │   index.ts\n│   └───lib\n└───docs\n        readme.md\n"],
  ];
  for (const [name, source] of cases) {
    it(`renders ${name} into a parseable change set: one shape per node, one connect per link`, async () => {
      const { plan } = convert(source);
      expectRevalidates(plan);
      const set = await renderVisualPlan(plan, renderOptions);
      expect(() => parseChangeSet(set)).not.toThrow();
      const groups = plan.nodes.filter((n) => n.type === "group").length;
      expect(set.changes.filter((c) => c.kind === "create_shape")).toHaveLength(plan.nodes.length - groups);
      expect(set.changes.filter((c) => c.kind === "connect")).toHaveLength(plan.relationships.length);
    });
  }
});
