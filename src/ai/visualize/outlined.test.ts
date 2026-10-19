/**
 * F42 Phase 2: long, multi-section documents (an AI answer pasted whole) go to
 * AI, are outlined once, and each semantic section is generated with its
 * kind's rules — then updated section by section. A real AIProviderManager +
 * task registry + MockProvider, scripted per task.
 */
import { describe, expect, it, vi } from "vitest";
import { parseChangeSet, type ChangeSet } from "@/ai/changes/changeSet";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import type { ExistingObject } from "@/ai/reconcile/classify";
import { nodeFingerprint, nodeKind } from "@/ai/reconcile/nodes";
import { updateFromNewContent } from "@/ai/reconcile/update";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { ungroup } from "@/ai/visual-plan/groups";
import type { VisualPlan } from "@/ai/visual-plan/types";
import type { ContentSource } from "@/domain/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fidelityScore } from "../../../e2e/fidelityScore";
import { validateOutline } from "./outline";
import { sectionsOfPlan } from "./outlined";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { acceptUpdate } from "@/testUtils/reconcileHarness";
import { registerVisualizeTasks } from "./tasks";
import { visualizeContent } from "./visualize";
import { canRegenerate, canRetryWithAI, regenerateSections, retryWithAI } from "@/ai/fidelity/regenerate";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });
const filler = (topic: string) => `${topic} is described here in enough words to make this a realistic, long answer pasted from a chat assistant. `.repeat(3);

const DOC = `# Acute pricing

## Free

- Full editor and canvas
- 10 AI actions per month
${filler("The free plan")}

## Pro

- Everything in Free
- Generous monthly AI allowance
${filler("The pro plan")}

## Lifetime

- Pay once
- Bring your own API key
${filler("The lifetime deal")}

## Business model

\`\`\`text
ACUTE
 ├── FREE
 └── PAID
      ├── PRO
      └── LIFETIME
\`\`\`

## Why this model

${filler("The reasoning")}

## Measure first

Track median, P90 and P95 cost per user before setting limits.
`;

/** The outline a model would give: plans merged into one comparison, reasoning supporting, "Measure first" forgotten. */
const OUTLINE = {
  summary: "Free product + limited AI → Pro → optional BYOK",
  sections: [
    { id: "s1", label: "Plans", kind: "comparison", prominence: "primary", parts: ["u1", "u2", "u3"] },
    { id: "s2", label: "Why this model", kind: "supporting", prominence: "supporting", parts: ["u5"] },
    { id: "s3", label: "Business model", kind: "hierarchy", prominence: "primary", parts: ["u4"] },
  ],
  links: [{ from: "s3", to: "s1", type: "relates_to", label: "priced as" }],
};

/** A good section reply (Wave B): its plan, plus a takeaway and one node of the model's own analysis. */
function analysed(plan: { nodes: unknown[] } & Record<string, unknown>, label: string): unknown {
  const analysis = { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: `What ${label} means.` } };
  return { ...plan, nodes: [...plan.nodes, analysis], metadata: { takeaway: `${label} at a glance` } };
}

function sectionReply(req: AIRequest): unknown {
  const label = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1] ?? "?";
  return analysed(planOf(req, label) as { nodes: unknown[] }, label);
}

function planOf(req: AIRequest, label: string): unknown {
  if (label === "Plans") {
    return { version: 1, template: "sectioned", nodes: [{ id: "n1", type: "table", content: { columns: ["", "Free", "Pro", "Lifetime"], rows: [["AI", "10/month", "Generous", "Own key"]] } }], relationships: [] };
  }
  if (label === "Business model") {
    const shape = (id: string, l: string) => ({ id, type: "shape", content: { shape: "rectangle", label: l } });
    return {
      version: 1,
      template: "sectioned",
      nodes: [shape("a", "Acute"), shape("b", "Free"), shape("c", "Paid")],
      relationships: [
        { from: "a", to: "b", type: "relates_to" },
        { from: "a", to: "c", type: "relates_to" },
      ],
    };
  }
  // The section's own text, so a changed section gives a changed node.
  const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
  return { version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 300) } }], relationships: [] };
}

function scripted(overrides: Partial<Record<string, (req: AIRequest) => string>> = {}) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn((req: AIRequest) => {
    const custom = overrides[req.task];
    if (custom) return response(custom(req));
    if (req.task === "outline_document") return response(JSON.stringify(OUTLINE));
    if (req.task === "generate_visual_plan") return response(JSON.stringify(sectionReply(req)));
    return response("unexpected task");
  });
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy, tasks: () => spy.mock.calls.map((c) => c[0]!.task),
    prompts: (task: string) => spy.mock.calls.flatMap((c) => (c[0]!.task === task ? [c[0]!.prompt] : [])),
  };
}

function noProvider() {
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  return createAIRuntime({ manager: new AIProviderManager(), registry });
}

const run = (runtime: ReturnType<typeof scripted>["runtime"], text = DOC) => visualizeContent({ text, operationId: "op_1", title: "Visualize", context }, runtime, { parseMarkdown: parse });
const frames = (set: ChangeSet) => set.changes.filter((c): c is Extract<ChangeSet["changes"][number], { kind: "create_frame" }> => c.kind === "create_frame");
const blockText = (c: ChangeSet["changes"][number]) => ("content" in c ? JSON.stringify(c.content) : "");
/** A section's name: the XL title block inside its frame (the frame's own label is "<position> · <kind>"). */
const nameOf = (set: ChangeSet, frameKey: string) => {
  const title = set.changes.find((c) => c.kind === "create_block" && c.key === `${frameKey}::title`);
  return title && "content" in title ? String((title.content[0] as { content?: unknown }).content) : "";
};
const names = (set: ChangeSet) => frames(set).map((f) => nameOf(set, f.key));

describe("validateOutline", () => {
  const units = ["A", "B", "C", "D"].map((key) => ({ key }));

  it("merges parts into sections, keeps document order within a section, and names sections by their parts' keys", () => {
    const { outline, warnings } = validateOutline({ sections: [{ id: "s1", label: "Both", kind: "comparison", prominence: "primary", parts: ["u3", "u1"] }] }, units);
    expect(outline.sections[0]).toMatchObject({ key: "A ⨁ C", units: ["A", "C"], label: "Both", kind: "comparison", arrangement: "compare" });
    // Nothing is lost: every part the outline forgot gets a section of its own.
    expect(outline.sections.slice(1).map((s) => s.units)).toEqual([["B"], ["D"]]);
    expect(warnings.filter((w) => /wasn't in any section/.test(w))).toHaveLength(2);
  });

  it("splits a merged section too large to generate in one call back into one section per part, links following", () => {
    const big = [
      { key: "Doc › A", text: "a".repeat(7_000) },
      { key: "Doc › B", text: "b".repeat(7_000) },
      { key: "Doc › C", text: "c".repeat(100) },
    ];
    const { outline, warnings } = validateOutline(
      {
        sections: [
          { id: "s1", label: "Everything", kind: "comparison", prominence: "supporting", parts: ["u1", "u2"] },
          { id: "s2", label: "Small", kind: "notes", parts: ["u3"] },
        ],
        links: [{ from: "s2", to: "s1", type: "supports" }],
      },
      big,
    );
    expect(outline.sections.map((s) => [s.key, s.label, s.kind, s.prominence])).toEqual([
      ["Doc › A", "A", "comparison", "supporting"],
      ["Doc › B", "B", "comparison", "supporting"],
      ["Doc › C", "C", "notes", "primary"],
    ]);
    expect(outline.links).toEqual([{ from: "Doc › C", to: "Doc › A", type: "supports" }]);
    expect(warnings.join("\n")).toMatch(/too much for one section/);
    // Within the limit (6,000 characters), a merged section stays merged; a single part over it is never split here.
    const small = [{ key: "Doc › A", text: "a".repeat(3_000) }, { key: "Doc › C", text: "c".repeat(100) }];
    expect(validateOutline({ sections: [{ id: "s1", label: "Both", parts: ["u1", "u2"] }] }, small).outline.sections[0]!.units).toEqual(["Doc › A", "Doc › C"]);
    expect(validateOutline({ sections: [{ id: "s1", label: "One", parts: ["u1"] }] }, big).outline.sections[0]!.units).toEqual(["Doc › A"]);
  });

  it("is lenient: an unknown kind is notes, an unknown or repeated part is ignored, a section of nothing is dropped", () => {
    const { outline, warnings } = validateOutline(
      {
        sections: [
          { id: "s1", label: "One", kind: "mindmap", parts: ["u1", "u9"] },
          { id: "s2", label: "Again", kind: "flow", parts: ["u1"] },
          { id: "s3", label: "Rest", kind: "cards", prominence: "supporting", parts: ["u2", "u3", "u4"] },
        ],
        links: [
          { from: "s1", to: "s3", type: "invented" },
          { from: "s1", to: "s2" },
        ],
      },
      units,
    );
    expect(outline.sections.map((s) => [s.label, s.kind, s.prominence])).toEqual([
      ["A", "notes", "primary"], // one part: its own heading, not the model's label
      ["Rest", "cards", "supporting"],
    ]);
    expect(outline.links).toEqual([{ from: "A", to: "B ⨁ C ⨁ D", type: "relates_to" }]);
    expect(warnings.join("\n")).toMatch(/unknown kind/);
    expect(warnings.join("\n")).toMatch(/unknown part "u9"/);
    expect(warnings.join("\n")).toMatch(/already in another section/);
  });

  it("a reply with no usable section still covers every part", () => {
    expect(validateOutline({ sections: [] }, units).outline.sections.map((s) => s.key)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("Visualize — a long, multi-section document is outlined, then built section by section (F42)", () => {
  it("outline once, one generation per section, no template selection", async () => {
    const s = scripted();
    await run(s.runtime);
    expect(s.tasks().filter((t) => t === "outline_document")).toHaveLength(1);
    expect(s.tasks().filter((t) => t === "generate_visual_plan")).toHaveLength(4); // Plans, Why, Business model, + the forgotten "Measure first"
    expect(s.tasks()).not.toContain("select_template");
  });

  it("the outline decides the frames: merged plans, primary sections first, the forgotten part kept", async () => {
    const { changeSet, warnings, usedLocalTier } = await run(scripted().runtime);
    expect(usedLocalTier).toBe(false);
    expect(names(changeSet)).toEqual(["Plans", "Business model", "Measure first", "Why this model"]);
    // The label above each frame says where and what it is, never repeating the title inside.
    expect(frames(changeSet).map((f) => f.title)).toEqual(["1 · Comparison", "2 · Structure", "3 · Notes", "4 · Supporting detail"]);
    expect(warnings.join("\n")).toMatch(/Measure first" wasn't in any section/);
    expect(changeSet.contentSource).toMatchObject({ tier: "ai", template: "sectioned" });
    expect(() => parseChangeSet(changeSet)).not.toThrow();
  });

  it("each section is generated with its kind's rules; a comparison becomes one table inside its frame", async () => {
    const s = scripted();
    const { changeSet } = await run(s.runtime);
    const prompts = s.spy.mock.calls.map((c) => c[0]!).filter((r) => r.task === "generate_visual_plan");
    const plans = prompts.find((r) => r.prompt.includes('"Plans"'))!;
    expect(plans.prompt).toMatch(/ONE "table"/);
    expect(plans.prompt).toContain("The free plan"); // all three merged parts' text
    expect(plans.prompt).toContain("The lifetime deal");
    const table = changeSet.changes.find((c) => c.kind === "create_block" && c.blockType === "table")!;
    const plansFrame = frames(changeSet).find((f) => nameOf(changeSet, f.key) === "Plans")!;
    expect(plansFrame.children).toContain((table as { key: string }).key);
  });

  it("the document's title, the outline's summary as its subtitle, and a link drawn between two frames", async () => {
    const { changeSet } = await run(scripted().runtime);
    const texts = changeSet.changes.filter((c) => c.kind === "create_block").map(blockText);
    expect(texts.some((t) => t.includes("Acute pricing"))).toBe(true);
    expect(texts.some((t) => t.includes("Free product + limited AI"))).toBe(true);
    const byTitle = new Map(frames(changeSet).map((f) => [nameOf(changeSet, f.key), f.key] as const));
    const link = changeSet.changes.find((c) => c.kind === "connect" && c.label === "priced as");
    expect(link).toMatchObject({ from: { created: byTitle.get("Business model") }, to: { created: byTitle.get("Plans") } });
  });

  it("one section the model can't produce keeps every other section; its own structure is shown, with a notice", async () => {
    const s = scripted({
      generate_visual_plan: (req) => (req.prompt.includes('"Business model"') ? "not a plan" : JSON.stringify(sectionReply(req))),
    });
    const { changeSet, warnings, notices, usedLocalTier } = await run(s.runtime);
    expect(usedLocalTier).toBe(false);
    expect(s.tasks()).not.toContain("select_template"); // no fallback to per-unit analysis
    expect(names(changeSet)).toEqual(["Plans", "Business model", "Measure first", "Why this model"]);
    expect(warnings.join("\n")).toMatch(/Section "Business model" couldn't be analysed/);
    expect(notices).toEqual([`AI couldn't analyse the section "Business model", so its own structure is shown.`]);
    // Said for as long as the proposal is open (Wave A): which section, and why.
    expect(changeSet.analysis).toEqual({ mode: "ai", fallbacks: [{ key: expect.any(String), label: "Business model", cause: expect.stringMatching(/^invalid_output: /) }] });
    expect(() => parseChangeSet(changeSet)).not.toThrow();
    // The local tier's plan of the section: its tree drawing as shapes, not its raw text in a note.
    const frame = frames(changeSet).find((f) => nameOf(changeSet, f.key) === "Business model")!;
    const shapes = changeSet.changes.flatMap((c) => (c.kind === "create_shape" && frame.children.includes(c.key) ? [c.label] : []));
    expect(shapes).toEqual(expect.arrayContaining(["ACUTE", "FREE", "PAID", "PRO", "LIFETIME"]));
    expect(changeSet.changes.some((c) => c.kind === "create_page" && frame.children.includes(c.key))).toBe(false);
  });

  it("a failed section of tables and checklists keeps them as tables and checklists", async () => {
    const text = `${DOC}\n## Roadmap\n\n| Item | Size |\n|---|---|\n| Sharing | M |\n\n- [ ] Ship sharing\n- [x] Ship export\n`;
    const s = scripted({
      outline_document: () => JSON.stringify({ ...OUTLINE, sections: [...OUTLINE.sections, { id: "s4", label: "Roadmap", kind: "notes", parts: ["u7"] }] }),
      generate_visual_plan: (req) => (req.prompt.includes('"Roadmap"') ? "not a plan" : JSON.stringify(sectionReply(req))),
    });
    const { changeSet } = await run(s.runtime, text);
    const frame = frames(changeSet).find((f) => nameOf(changeSet, f.key) === "Roadmap")!;
    const types = changeSet.changes.flatMap((c) => (c.kind === "create_block" && frame.children.includes(c.key) ? [c.blockType] : []));
    expect(types).toEqual(expect.arrayContaining(["table", "todo"]));
  });

  it("an outline that fails falls back to analysing each section on its own, every node type allowed, with a note", async () => {
    const s = scripted({ outline_document: () => "not json at all" });
    const { changeSet, warnings, notices } = await run(s.runtime);
    expect(warnings.join("\n")).toMatch(/outline failed/);
    expect(notices.join("\n")).toMatch(/couldn't outline/);
    expect(changeSet.analysis).toMatchObject({ mode: "ai", outlineFailed: true, cause: expect.stringMatching(/^invalid_output: /), fallbacks: [] });
    // Each part is its own "notes" section: the kind whose rules allow every node type.
    expect(s.prompts("generate_visual_plan").every((p) => p.includes('It is a "notes" section'))).toBe(true);
    expect(names(changeSet)).toEqual(["Free", "Pro", "Lifetime", "Business model", "Why this model", "Measure first"]);
  });
});

describe("Visualize — nothing is lost after validation either (content fidelity)", () => {
  it("the cheat sheet merged into two big sections keeps every source unit on the canvas (long section keys)", async () => {
    const text = readFileSync(join(__dirname, "..", "fidelity", "__fixtures__", "cmg-verify-cheatsheet.txt"), "utf8");
    const s = scripted({
      outline_document: (req) => {
        const parts = [...new Set([...req.prompt.matchAll(/^\[(u\d+)\]/gm)].map((m) => m[1]!))];
        const half = Math.ceil(parts.length / 2);
        return JSON.stringify({ sections: [{ id: "s1", label: "A", kind: "comparison", parts: parts.slice(0, half) }, { id: "s2", label: "B", kind: "hierarchy", parts: parts.slice(half) }] });
      },
      // A lazy reply: one table by reference and a line of analysis. The safety net must supply the rest.
      generate_visual_plan: () =>
        JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "t", type: "source", ref: "T1" }, { id: "a", type: "text", origin: "analysis", content: { markdown: "x" } }], relationships: [], metadata: { takeaway: "t" } }),
    });
    const result = await run(s.runtime, text);
    // Measured on the change set — after validation — not on the replies.
    const strings: string[] = [];
    const deep = (v: unknown) => (typeof v === "string" ? strings.push(v) : Array.isArray(v) ? v.forEach(deep) : v && typeof v === "object" ? Object.values(v).forEach(deep) : 0);
    result.changeSet.changes.forEach(deep);
    const score = fidelityScore(text, strings);
    expect(score.skipped).toEqual([]);
    expect(score.units.covered).toBe(score.units.total);
    expect(result.warnings.join("\n")).not.toMatch(/dropped \(stableKey/);
  });
});

describe("Visualize — routing a structured document to AI (F42)", () => {
  it("with no AI configured, a long structured document still visualizes from its own structure — no error", async () => {
    const result = await visualizeContent({ text: DOC, operationId: "op", title: "Visualize", context }, noProvider(), { parseMarkdown: parse });
    expect(result.usedLocalTier).toBe(true);
    expect(result.changeSet.analysis).toEqual({ mode: "structure", reason: "no_provider", fallbacks: [] });
    expect(frames(result.changeSet).length).toBeGreaterThan(0);
  });

  it("when AI fails outright, the document's own structure is used, with a note", async () => {
    const s = scripted({ outline_document: () => "x", generate_visual_plan: () => "x" });
    const result = await run(s.runtime);
    expect(result.usedLocalTier).toBe(true);
    expect(result.warnings.join("\n")).toMatch(/AI analysis failed/);
    expect(result.changeSet.analysis).toMatchObject({ mode: "structure", reason: "ai_failed", cause: expect.stringMatching(/^invalid_output: /) });
  });

  it("a section that fell back can be retried on its own: the retry replaces it, and the others are reused", async () => {
    let fail = true;
    const s = scripted({
      generate_visual_plan: (req) => (fail && req.prompt.includes('"Business model"') ? "not a plan" : JSON.stringify(sectionReply(req))),
    });
    const first = await run(s.runtime);
    const [fallback] = first.changeSet.analysis!.fallbacks;
    expect(canRegenerate(first.changeSet.operationId)).toBe(true);
    fail = false;
    const calls = s.spy.mock.calls.length;
    const again = await regenerateSections(first.changeSet.operationId, [fallback!.key], s.runtime, { operationId: "op_2", context }, { parseMarkdown: parse });
    expect(again.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [] });
    expect(s.spy.mock.calls.slice(calls).map((c) => c[0]!.task)).toEqual(["generate_visual_plan"]); // no outline call, one section
  });

  it("a section that fell back stays reported when another section is regenerated", async () => {
    const s = scripted({
      generate_visual_plan: (req) => (req.prompt.includes('"Business model"') ? "not a plan" : JSON.stringify(sectionReply(req))),
    });
    const first = await run(s.runtime);
    const plans = first.changeSet.fidelity!.sections.find((x) => x.label === "Plans")!;
    const again = await regenerateSections(first.changeSet.operationId, [plans.key], s.runtime, { operationId: "op_3", context }, { parseMarkdown: parse });
    expect(again.changeSet.analysis!.fallbacks.map((f) => f.label)).toEqual(["Business model"]);
  });

  it("a short structured note stays on the local tier (no AI call), and the review says AI wasn't asked", async () => {
    const s = scripted();
    const result = await run(s.runtime, "# Plan\n\n## Steps\n\n- [ ] Backup\n\n## Risks\n\nLocks.\n");
    expect(result.usedLocalTier).toBe(true);
    expect(s.spy).not.toHaveBeenCalled();
    expect(result.changeSet.analysis).toEqual({ mode: "structure", reason: "structured", fallbacks: [] });
    // "Analyse with AI" runs it again, asking AI this time.
    expect(canRetryWithAI(result.changeSet.operationId)).toBe(true);
    const again = await retryWithAI(result.changeSet.operationId, s.runtime, { operationId: "op_4", context }, { parseMarkdown: parse });
    expect(again.usedLocalTier).toBe(false);
    expect(again.changeSet.analysis!.mode).toBe("ai");
    expect(s.spy.mock.calls[0]![0]!.task).toBe("outline_document");
  });

  it("a pasted chat reply with a decision table goes to AI, not straight into cards (Wave A)", async () => {
    const rows = [
      ["D1", "Draft 03's checklist", "Replace it with the submit_answer gate"],
      ["D2", "Changing the skill means rerunning the engineer's full test set", "Call the merge v3 and keep Draft 03 frozen."],
      ["D3", "Answer headings", "Rename the headings in render.ts to the four answer classes"],
    ];
    const text = [
      "I've updated the plan with everything in the engineer's package, and the tracker is corrected. Nothing is committed.",
      "",
      "\tDecision\tMy proposal",
      ...rows.map((r) => r.join("\t")),
      "",
      "Until the files arrive, the replay fixtures get rebuilt on our BASE/WATER pair.",
    ].join("\n");
    const outline = () => JSON.stringify({ sections: [{ id: "s1", label: "Decisions", kind: "decision", parts: ["u1"] }] });
    const status = (ids: string[]) => ({ id: "a1", type: "text", origin: "analysis", title: "Status", content: { markdown: ids.map((d) => `- ${d}: proposed`).join("\n") } });
    const tableOf = (set: ChangeSet) => set.changes.find((c) => c.kind === "create_block" && c.blockType === "table") as { content: { content: { rows: { cells: unknown[] }[] } }[] } | undefined;
    const columnsOf = (set: ChangeSet) => JSON.stringify(tableOf(set)).match(/Draft 03's checklist/g)?.length ?? 0;

    // Placed by reference (Wave B1): the table goes in whole, and a status covering every decision needs no retry.
    const byRef = scripted({
      outline_document: outline,
      generate_visual_plan: () =>
        JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "t", type: "source", ref: "T1", title: "Decisions" }, status(["D1", "D2", "D3"])], relationships: [], metadata: { takeaway: "Gate on submit_answer" } }),
    });
    const result = await run(byRef.runtime, text);
    expect(result.usedLocalTier).toBe(false);
    expect(byRef.tasks()).toEqual(["outline_document", "generate_visual_plan"]);
    // The model sees the table numbered, as a pipe table with its corner column.
    expect(byRef.prompts("generate_visual_plan")[0]).toContain("[T1] |   | Decision | My proposal |");
    expect(byRef.prompts("generate_visual_plan")[0]).toContain('"type":"source","ref":"T1"');
    expect(columnsOf(result.changeSet)).toBe(1); // the "what is decided" column is there
    expect(result.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [] });

    // Retyped with a column dropped: repaired to the full table in place; a status skipping D2 and D3 is retried.
    let calls = 0;
    const retyped = scripted({
      outline_document: outline,
      // The retry is a small analysis-only call, merged into the plan the section has.
      generate_section_analysis: () => JSON.stringify({ nodes: [{ ...status(["D1", "D2", "D3"]), id: "b1" }], relationships: [{ from: "b1", to: "t", type: "relates_to" }] }),
      generate_visual_plan: () =>
        JSON.stringify({
          version: 1,
          template: "sectioned",
          nodes: [{ id: "t", type: "table", content: { columns: ["Decision", "My proposal"], rows: rows.map((r) => [r[0], r[2]]) } }, status(calls++ === 0 ? ["D1"] : ["D1", "D2", "D3"])],
          relationships: [],
          metadata: { takeaway: "Gate on submit_answer" },
        }),
    });
    const repaired = await run(retyped.runtime, text);
    expect(columnsOf(repaired.changeSet)).toBe(1);
    expect(repaired.changeSet.changes.some((c) => c.kind === "create_page")).toBe(false); // nothing left for "Source details"
    expect(retyped.tasks()).toEqual(["outline_document", "generate_visual_plan", "generate_section_analysis"]);
    expect(retyped.prompts("generate_section_analysis")[0]).toContain("it lacks an analysis line for D2, D3");
    expect(repaired.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [] });
  });
});

describe("Update from new content — an outlined document is updated section by section (F42)", () => {
  function accepted(set: ChangeSet) {
    const cs = set.contentSource!;
    const plan = ungroup(cs.plan as VisualPlan);
    const existing = plan.nodes.map((n): ExistingObject => {
      const baseline = nodeFingerprint(n, parse);
      return { objectId: `el_${n.id}`, stableNodeKey: n.stableKey!, baseline, current: baseline, excluded: false, ...nodeKind(n) };
    });
    const source: ContentSource = { id: cs.sourceId, workspaceId: "ws", canvasId: "cv", origin: "paste", tier: cs.tier, template: cs.template, latestVersion: 1, createdAt: 1, updatedAt: 1 };
    return { source, previous: { sourceId: cs.sourceId, version: 1, text: cs.text, plan: cs.plan, createdAt: 1 }, existing };
  }
  async function setup() {
    const s = scripted();
    const a = accepted((await run(s.runtime)).changeSet);
    s.spy.mockClear();
    const update = (text: string) => updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update", context }, s.runtime, { parseMarkdown: parse });
    return { ...s, update, accepted: a };
  }

  it("identical text: no model call and nothing to review", async () => {
    const s = await setup();
    const r = await s.update(DOC);
    expect(s.spy).not.toHaveBeenCalled();
    expect(r.changeSet).toBeNull();
  });

  it("an edit inside one section regenerates only that section — no outline, no other section", async () => {
    const s = await setup();
    const r = await s.update(DOC.replace("Track median, P90 and P95 cost per user", "Track median, P90 and P99 cost per user"));
    expect(s.tasks()).toEqual(["generate_visual_plan"]);
    expect(r.reanalyzedUnits).toEqual(["Acute pricing › Measure first"]);
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds).toContain("update_block");
    expect(kinds).not.toContain("remove");
  });

  it("a paragraph appended to a section asks only for what it adds; an edited section is sent whole with how it changed", async () => {
    const s = await setup();
    const added = "Review the limits every quarter.";
    const r = await s.update(DOC.replace("Track median, P90 and P95 cost per user before setting limits.", `Track median, P90 and P95 cost per user before setting limits.\n\n${added}`));
    const appended = s.spy.mock.calls.map((c) => c[0]!.prompt);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toContain("the content below is ONLY those paragraphs");
    // Only the appended paragraph, numbered so it can be placed by reference (`reconcile/appendedRefs.ts`).
    expect(appended[0]!.split("Content to visualize:")[1]!.trim()).toBe(`[P1] ${added}`);
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
    expect(r.reconciliation.items.some((i) => i.state === "unchanged")).toBe(true);

    s.spy.mockClear();
    await s.update(DOC.replace("Track median, P90 and P95 cost per user", "Track median, P90 and P99 cost per user"));
    const edited = s.spy.mock.calls.map((c) => c[0]!.prompt)[0]!;
    expect(edited).not.toContain("ONLY those paragraphs");
    expect(edited).toContain("How this section's text changed");
  });

  it("sections past the frame limit (stored without a frame) are still known: an update doesn't generate them again", async () => {
    const parts = Array.from({ length: 24 }, (_, i) => `## Topic ${i}\n\nTopic ${i} covers its own subject number ${i} in a few words.`);
    const doc = `# Many topics\n\n${parts.join("\n\n")}\n`;
    const sections = parts.map((_, i) => ({ id: `s${i + 1}`, label: `Topic ${i}`, kind: "notes", prominence: "primary", parts: [`u${i + 1}`] }));
    const s = scripted({ outline_document: () => JSON.stringify({ sections, links: [] }) });
    const first = await run(s.runtime, doc);
    const a = accepted(first.changeSet);
    s.spy.mockClear();
    const r = await updateFromNewContent({ ...a, text: `${doc}\n## Topic 24\n\nTopic 24 is the one new subject here.\n`, operationId: "op_2", title: "Update", context }, s.runtime, { parseMarkdown: parse });
    // One outline and one generation, for the new topic only; all 24 earlier sections reused, framed or not.
    expect(s.tasks()).toEqual(["outline_document", "generate_visual_plan"]);
    expect(r.reusedUnits).toHaveLength(24);
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
  });

  it("a section that grows past one unit's size (split into numbered parts) is the same section: no re-outline, only what was added", async () => {
    const s = await setup();
    const grown = Array.from({ length: 40 }, (_, i) => `Limit note ${i}: ${"cost per user is reviewed against the plan limits each week. ".repeat(6)}`);
    const r = await s.update(`${DOC}\n${grown.join("\n\n")}\n`);
    expect(s.tasks()).toEqual(["generate_visual_plan"]);
    expect(r.reanalyzedUnits).toEqual(["Acute pricing › Measure first"]);
    expect(s.spy.mock.calls[0]![0]!.prompt).toContain("the content below is ONLY those paragraphs");
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
  });

  it("an edit to one of a merged section's parts regenerates that merged section, with its current representation", async () => {
    const s = await setup();
    await s.update(DOC.replace("Generous monthly AI allowance", "1,000 AI actions per month"));
    const calls = s.spy.mock.calls.map((c) => c[0]!);
    expect(calls.map((c) => c.task)).toEqual(["generate_visual_plan"]);
    expect(calls[0]!.prompt).toContain('"Plans"');
    expect(calls[0]!.prompt).toContain("Current representation");
  });

  it("a renamed heading over the same content keeps its section (G1): no re-outline, only that section regenerated, nothing removed", async () => {
    const s = await setup();
    const r = await s.update(DOC.replace("## Measure first", "## Instrument from day one"));
    expect(s.tasks()).toEqual(["generate_visual_plan"]);
    expect(r.reanalyzedUnits).toEqual(["Acute pricing › Measure first"]);
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
    expect(r.changeSet!.contentSource!.pathIds).toEqual({ "Acute pricing › Instrument from day one": "Acute pricing › Measure first" });
  });

  it("a new heading is outlined and generated on its own (G2.3): existing sections untouched, one new frame", async () => {
    const s = await setup();
    const r = await s.update(`${DOC}\n## FAQ\n\nCan I cancel? Yes, any time.\n`);
    expect(s.tasks()).toEqual(["outline_document", "generate_visual_plan"]);
    const outline = s.spy.mock.calls.map((c) => c[0]!).find((q) => q.task === "outline_document")!;
    expect(outline.prompt).toContain("Can I cancel?");
    expect(outline.prompt).not.toContain("Track median"); // the existing parts aren't outlined again
    expect(r.reanalyzedUnits).toEqual(["Acute pricing › FAQ"]);
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds.filter((k) => k === "create_frame")).toHaveLength(1);
    expect(kinds).not.toContain("remove");
    expect(kinds).not.toContain("update_block"); // nothing of the existing sections changes
    // The new run's document summary isn't added: the notes keep their own subtitle.
    expect(JSON.stringify(r.changeSet!.changes)).not.toContain("subtitle");
  });

  it("after an accepted update, the next one still knows the sections: identical text is no call, an edit regenerates one section", async () => {
    const s = await setup();
    const edited = DOC.replace("Track median, P90 and P95 cost per user", "Track median, P90 and P99 cost per user");
    const first = await s.update(edited);
    // The update stores its plan grouped by section again, like a first run.
    expect(sectionsOfPlan(validateVisualPlan(first.changeSet!.contentSource!.plan).plan).length).toBeGreaterThan(0);
    const a2 = acceptUpdate(s.accepted, first.changeSet!);
    const next = (text: string) => updateFromNewContent({ ...a2, text, operationId: "op_3", title: "Update", context }, s.runtime, { parseMarkdown: parse });
    s.spy.mockClear();
    expect((await next(edited)).changeSet).toBeNull();
    expect(s.spy).not.toHaveBeenCalled();
    const r = await next(edited.replace("Generous monthly AI allowance", "1,000 AI actions per month"));
    expect(s.tasks()).toEqual(["generate_visual_plan"]); // one section, no outline
    // Everything it changes is in that section (the same as an update of the first version would change).
    const touched = r.reconciliation.items.filter((i) => i.state !== "unchanged").map((i) => ("node" in i ? i.node.stableKey : i.object.stableNodeKey) ?? "");
    expect(touched.length).toBeGreaterThan(0);
    for (const key of touched) expect(key).toMatch(/^Acute pricing › Free ⨁ Acute pricing › Pro ⨁ Acute pricing › Lifetime § /);
  });

  it("the plan an update stores flattens back to exactly the plan it compared (no untouched title looks changed)", async () => {
    const s = await setup();
    const r = await s.update(`${DOC}\n## FAQ\n\nCan I cancel? Yes, any time.\n`);
    const stored = validateVisualPlan(r.changeSet!.contentSource!.plan).plan;
    expect(stored.nodes.some((n) => n.type === "group")).toBe(true);
    // Same nodes, field for field, as the flat plan the update reconciled (the nodes its reconciliation compared).
    const flatAgain = new Map(ungroup(stored).nodes.map((n) => [n.stableKey, n] as const));
    const compared = r.reconciliation.items.flatMap((i) => ("node" in i ? [i.node] : []));
    expect(compared.length).toBeGreaterThan(0);
    for (const n of compared) expect(flatAgain.get(n.stableKey), n.stableKey).toEqual(n);
    // And re-sending the same text proposes nothing.
    const a2 = acceptUpdate(s.accepted, r.changeSet!);
    s.spy.mockClear();
    const again = await updateFromNewContent({ ...a2, text: `${DOC}\n## FAQ\n\nCan I cancel? Yes, any time.\n`, operationId: "op_3", title: "Update", context }, s.runtime, { parseMarkdown: parse });
    expect(again.changeSet).toBeNull();
    expect(s.spy).not.toHaveBeenCalled();
  });

  it("a plan an earlier update stored flat still names its sections (kind unknown: notes)", async () => {
    const s = await setup();
    const grouped = validateVisualPlan(s.accepted.previous.plan).plan;
    const flat = sectionsOfPlan(ungroup(grouped));
    expect(flat.map((x) => x.key)).toEqual(sectionsOfPlan(grouped).map((x) => x.key));
    expect(new Set(flat.map((x) => x.kind))).toEqual(new Set(["notes"]));
  });

  it("a removed heading still re-outlines the whole document", async () => {
    const s = await setup();
    await s.update(DOC.replace(/## Measure first[\s\S]*$/, ""));
    const outline = s.spy.mock.calls.map((c) => c[0]!).find((q) => q.task === "outline_document");
    expect(outline).toBeDefined();
  });
});
