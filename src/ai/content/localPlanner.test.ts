import { describe, expect, it } from "vitest";
import { chunkForAnalysis } from "./chunking";
import { MAX_PLAN_NODES, PAGE_THRESHOLD_CHARS, assessStructure, planLocally } from "./localPlanner";
import { parseContent } from "./parser";

async function plan(input: string) {
  return planLocally(await parseContent(input), input);
}

const summary = (r: Awaited<ReturnType<typeof plan>>) => r.plan?.nodes.map((n) => `${n.type}${n.title ? `(${n.title})` : ""}`);

describe("planLocally", () => {
  it("checklists → todo blocks under their heading (action plan), no AI needed", async () => {
    const r = await plan("# Launch\n\n- [x] Write the RFC\n- [ ] Load test\n  - [ ] 3x peak\n- Update runbook\n");
    expect(r.sufficient).toBe(true);
    expect(r.plan).toMatchObject({ version: 1, template: "action_plan", metadata: { title: "Launch" }, relationships: [] });
    expect(r.plan!.nodes).toEqual([
      { id: "n1", type: "heading", role: "title", content: { text: "Launch" }, sourceSpan: { start: 0, end: 8 }, stableKey: "Launch#heading0" },
      {
        id: "n2",
        type: "todo",
        title: "Launch",
        content: {
          items: [
            { text: "Write the RFC", checked: true },
            { text: "Load test", checked: false },
            { text: "3x peak", checked: false },
            { text: "Update runbook", checked: false },
          ],
        },
        sourceSpan: expect.any(Object),
        stableKey: "Launch#todo0",
      },
    ]);
    expect(r.reasons[0]).toBe("1 checklist");
  });

  it("Markdown tables → a table block (comparison)", async () => {
    const r = await plan("| Option | Cost |\n| --- | --- |\n| A | $ |\n| B | $$ |\n");
    expect(r.sufficient).toBe(true);
    expect(r.plan!.template).toBe("comparison");
    expect(r.plan!.nodes).toMatchObject([{ type: "table", content: { columns: ["Option", "Cost"], rows: [["A", "$"], ["B", "$$"]] } }]);
  });

  it("fenced code → a code block with its language", async () => {
    const r = await plan("## Retry\n\n```ts\nawait retry(3);\n```\n");
    expect(r.sufficient).toBe(true);
    // The section's heading is its frame's title (F42), so the block itself carries no title.
    expect(r.plan!.nodes[0]).toMatchObject({ type: "group", content: { label: "Retry" } });
    expect(r.plan!.nodes[1]).toMatchObject({ type: "code", parent: r.plan!.nodes[0]!.id, content: { language: "ts", source: "await retry(3);" } });
    expect(r.plan!.nodes[1]!.title).toBeUndefined();
  });

  it("heading-sectioned documents → a section (group) per heading with one text block each, Markdown kept verbatim", async () => {
    const input = "# Design\n\nIntro with **bold**.\n\n## Goals\n\n- Fast\n- Safe\n\nMore text.\n\n## Risks\n\nTimeouts.\n\n#### Detail\n\nDeep note.\n";
    const r = await plan(input);
    expect(r.sufficient).toBe(true);
    expect(r.plan!.template).toBe("sectioned");
    expect(summary(r)).toEqual(["heading", "text(Design)", "group", "text", "group", "text"]);
    expect(r.plan!.nodes.filter((n) => n.type === "group").map((n) => n.type === "group" && n.content.label)).toEqual(["Goals", "Risks"]);
    expect(r.plan!.nodes[3]!.parent).toBe(r.plan!.nodes[2]!.id);
    // Keyed like the heading it replaces, so earlier versions still match.
    expect(r.plan!.nodes[2]!.stableKey).toBe("Design › Goals#heading0");
    expect(r.plan!.nodes[1]).toMatchObject({ content: { markdown: "Intro with **bold**." } });
    expect(r.plan!.nodes[3]).toMatchObject({ content: { markdown: "- Fast\n- Safe\n\nMore text." } });
    // Level-4 headings stay inside their section's text.
    expect(r.plan!.nodes[5]).toMatchObject({ content: { markdown: "Timeouts.\n\n#### Detail\n\nDeep note." } });
    for (const n of r.plan!.nodes) expect(input.slice(n.sourceSpan!.start, n.sourceSpan!.end).length).toBeGreaterThan(0);
  });

  it("long sections become pages", async () => {
    const long = "Words ".repeat(Math.ceil(PAGE_THRESHOLD_CHARS / 6) + 10).trim();
    const r = await plan(`# Notes\n\n## Background\n\n${long}\n\n## Next\n\nShort.`);
    expect(summary(r)).toEqual(["heading", "group", "page", "group", "text"]);
    expect(r.plan!.nodes[2]).toMatchObject({ content: { title: "Background", markdown: long } });
  });

  it("a short numbered list of steps → a flow of shapes, connected in order", async () => {
    const r = await plan("# Login\n\n1. User logs in\n2. API validates\n3. Token issued\n");
    expect(r.plan!.template).toBe("flow");
    expect(r.plan!.nodes.map((n) => (n.type === "shape" ? n.content.label : n.type))).toEqual(["User logs in", "API validates", "Token issued"]);
    expect(r.plan!.relationships).toEqual([
      { from: "n1", to: "n2", type: "flows_to" },
      { from: "n2", to: "n3", type: "flows_to" },
    ]);
    expect(r.plan!.nodes[0]).toMatchObject({ role: "step", stableKey: "Login#step0" });
  });

  it("prose needs AI analysis, but still gets a structure-only plan to fall back on", async () => {
    const r = await plan(
      "Our checkout fails when the gateway times out. Customers then retry and sometimes get charged twice.\n\nWe think idempotency keys derived from the order id would stop the double charges, but the queue design matters too.",
    );
    expect(r.sufficient).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.reasons).toEqual([expect.stringMatching(/^mostly prose \(100%\)/)]);
    expect(summary(r)).toEqual(["text"]);
  });

  it("keeps stable keys when wording changes, so later regenerations match nodes", async () => {
    const a = await plan("# Plan\n\n- [ ] Ship it\n\n## Risks\n\nNone yet.");
    const b = await plan("# Plan\n\n- [ ] Ship it today, carefully\n- [ ] Tell support\n\n## Risks\n\nTimeouts, maybe.");
    expect(a.plan!.nodes.map((n) => n.stableKey)).toEqual(b.plan!.nodes.map((n) => n.stableKey));
    expect(a.plan!.nodes.map((n) => n.stableKey)).toEqual(["Plan#heading0", "Plan#todo0", "Plan › Risks#heading0", "Plan › Risks#text0"]);
  });

  it("is deterministic", async () => {
    const input = "# X\n\n- [ ] a\n\n| a |\n| - |\n| 1 |\n\n```\ncode\n```\n";
    expect(await plan(input)).toEqual(await plan(input));
  });

  it("refuses plans over the node limit, and plans nothing for empty content", async () => {
    const many = Array.from({ length: MAX_PLAN_NODES }, (_, i) => `## S${i}\n\nText ${i}.`).join("\n\n");
    const r = await plan(many);
    expect(r.plan).toBeNull();
    expect(r.sufficient).toBe(false);
    expect(r.reasons.at(-1)).toMatch(/too many parts \(120\)/);
    expect(await plan("  ")).toMatchObject({ sufficient: false, plan: null, reasons: ["No content"] });
  });

  it("rejects a parse that doesn't belong to the input", async () => {
    const parsed = await parseContent("# A");
    expect(() => planLocally(parsed, "# B, longer")).toThrow(/does not match/);
  });
});

describe("assessStructure", () => {
  it("scores mixed content by how much is explicit", async () => {
    const r = assessStructure(await parseContent("Some intro prose that goes on for a while and explains things.\n\n- [ ] one\n- [ ] two\n"));
    // ≈ 75% prose, 25% checklist.
    expect(r.confidence).toBeCloseTo(0.23, 2);
    expect(r.sufficient).toBe(false);
  });
});

describe("chunkForAnalysis", () => {
  const doc = Array.from({ length: 6 }, (_, i) => `## Part ${i}\n\n${"Sentence. ".repeat(40)}`).join("\n\n");

  it("keeps small content in one chunk", async () => {
    const input = "# A\n\nText.";
    const chunks = chunkForAnalysis(await parseContent(input), input);
    expect(chunks).toEqual([{ index: 0, span: { start: 0, end: input.length }, path: ["A"], text: input }]);
  });

  it("splits along sections, merging neighbours up to the limit, and keeps spans exact", async () => {
    const parsed = await parseContent(doc);
    const chunks = chunkForAnalysis(parsed, doc, 900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(900);
      expect(doc.slice(c.span.start, c.span.end).trim()).toBe(c.text);
      expect(c.text.startsWith("## Part")).toBe(true); // chunks begin at a section
    }
    // Nothing lost: every section heading appears in exactly one chunk.
    expect(chunks.map((c) => c.text.match(/## Part \d/g)!.length).reduce((a, b) => a + b)).toBe(6);
  });

  it("splits a section by blocks, and cuts only a single oversized block by length", async () => {
    const input = `## Big\n\n${"a".repeat(50)}\n\n${"b".repeat(50)}\n\n${"c".repeat(250)}`;
    const chunks = chunkForAnalysis(await parseContent(input), input, 120);
    expect(chunks.every((c) => c.text.length <= 120)).toBe(true);
    // Heading + a + b fit in one chunk (110 chars); the 250-char block is cut in three.
    expect(chunks.map((c) => c.text[0])).toEqual(["#", "c", "c", "c"]);
    expect(chunks[0]!.text).toContain("b".repeat(50));
    expect(chunks.every((c) => c.path[0] === "Big")).toBe(true);
  });
});

describe("assessStructure — when AI would do much better (F42)", () => {
  it("recommends AI for a long document of several sections, and for an ASCII diagram, never for a short note", async () => {
    const para = "Words that make a realistic paragraph of an answer pasted from a chat assistant. ".repeat(8);
    const long = `# Doc\n\n## A\n\n${para}\n\n## B\n\n${para}\n\n## C\n\n${para}\n`;
    expect((await plan(long)).aiRecommended).toBe(true);
    // ASCII art only a model can redraw; a tree drawing is converted locally instead (F42 Phase 3).
    const art = "## Flow\n\n```\n┌──────┐    ┌──────┐\n│ Web  │───▶│ API  │\n└──────┘    └──────┘\n```\n";
    expect((await plan(art)).aiRecommended).toBe(true);
    const tree = await plan("## Model\n\n```\nACUTE\n ├── FREE\n └── PAID\n      ├── PRO\n      └── BYOK\n```\n");
    expect(tree.aiRecommended).toBeUndefined();
    expect(tree.plan!.nodes.flatMap((n) => (n.type === "shape" ? [n.content.label] : []))).toEqual(["ACUTE", "FREE", "PAID", "PRO", "BYOK"]);
    const short = await plan("# Plan\n\n## Steps\n\n- [ ] Backup\n\n## Risks\n\nLocks.\n");
    expect(short.sufficient).toBe(true);
    expect(short.aiRecommended).toBeUndefined();
  });
});

describe("assessStructure — content AI should analyse, not copy (content fidelity Revision 2)", () => {
  it("recommends AI for a table with an intro, even though the local plan would be sufficient", async () => {
    const table = "| Decision | My proposal |\n|---|---|\n| D1: the checklist | Replace it with the submit_answer gate |\n| D2: the skill change | Call the merge v3 and keep Draft 03 frozen |\n| D3: headings | Rename them to the four answer classes |\n";
    const r = await plan(`I've updated the plan, and the tracker is corrected.\n\n${table}`);
    expect(r.sufficient).toBe(true);
    expect(r.aiRecommended).toBe(true);
    expect(r.reasons.at(-1)).toMatch(/AI can analyse/);
  });

  it("keeps checklists, code and short notes local", async () => {
    const checklist = `# Launch\n\n${Array.from({ length: 12 }, (_, i) => `- [ ] Step ${i + 1} of the launch checklist`).join("\n")}\n`;
    expect((await plan(checklist)).aiRecommended).toBeUndefined();
    expect((await plan(`## Script\n\n\`\`\`sh\n${"echo build and deploy the whole thing\n".repeat(10)}\`\`\`\n`)).aiRecommended).toBeUndefined();
    expect((await plan("# Plan\n\n## Risks\n\nLocks.\n")).aiRecommended).toBeUndefined();
  });
});

describe("local tier: an ASCII tree inside a section (F42 Phase 3)", () => {
  it("becomes shapes in that section, linked parent → child, and the section lays out as a tree", async () => {
    const input = "# Plan\n\n## Model\n\n```\nACUTE\n ├── FREE\n └── PAID\n      └── PRO\n```\n\n## Risks\n\nLocks.\n";
    const r = await plan(input);
    expect(r.aiRecommended).toBeUndefined();
    const model = r.plan!.nodes.find((n) => n.type === "group" && n.content.label === "Model")!;
    expect(model.type === "group" && model.content.arrangement).toBe("tree");
    const shapes = r.plan!.nodes.filter((n) => n.type === "shape");
    expect(shapes.map((n) => n.type === "shape" && n.content.label)).toEqual(["ACUTE", "FREE", "PAID", "PRO"]);
    expect(shapes.every((n) => n.parent === model.id)).toBe(true);
    const label = (id: string) => shapes.find((n) => n.id === id)!;
    expect(r.plan!.relationships.map((x) => `${(label(x.from) as { content: { label: string } }).content.label}>${(label(x.to) as { content: { label: string } }).content.label}`)).toEqual([
      "ACUTE>FREE",
      "ACUTE>PAID",
      "PAID>PRO",
    ]);
    for (const n of shapes) expect(input.slice(n.sourceSpan!.start, n.sourceSpan!.end)).toBe((n as { content: { label: string } }).content.label);
    expect(new Set(r.plan!.nodes.map((n) => n.stableKey)).size).toBe(r.plan!.nodes.length);
  });
});
