// @vitest-environment happy-dom
/**
 * Flow cards through Visualize and the update engine (note-taking-modes plan Step 6), with a scripted model (no AI spend):
 * on an AI-managed canvas a flow section is ONE text card with a FlowDiagram layout built from its text; on a Manual canvas
 * it stays native shapes, exactly as before. An update of the section changes the card in place (no removal, no shapes);
 * a source with no flow card updates exactly as before. Distil ideas on collapsed nodes move to the card.
 */
import { describe, expect, it } from "vitest";
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { markdownToContent } from "@/components/blocks/editor/markdown";
import type { SectionKnowledge } from "@/ai/fidelity/knowledgeCheck";
import type { AIRequest } from "@/ai/types";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { FLOW_CARD_ROLE } from "@/ai/visual-plan/flowCards";
import { accepted, acceptUpdate, context, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { updateFromNewContent } from "@/ai/reconcile/update";
import { flowOfContent } from "@/ai/openui/flowLayout";
import { withFlowCitations, withRenamedIdeas } from "./flowRun";
import { flowMarkdown } from "@/ai/openui/flowLayout";
import { visualizeContent } from "./visualize";

const filler = (topic: string) => `${topic} is described here in enough words to make this a realistic, long answer pasted from a chat assistant. `.repeat(3);
const doc = (tests: number) => `# Release process

## Pipeline

We build, then QA signs off, then we deploy. CI runs ${tests} tests on every build.
${filler("The pipeline")}

## Notes

${filler("The notes")}
`;

const OUTLINE = {
  summary: "How a release ships",
  sections: [
    { id: "s1", label: "Pipeline", kind: "flow", prominence: "primary", parts: ["u1"] },
    { id: "s2", label: "Notes", kind: "notes", prominence: "supporting", parts: ["u2"] },
  ],
  links: [],
};

function sectionReply(req: AIRequest): unknown {
  const label = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1] ?? "?";
  const analysis = { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: `What ${label} means.` } };
  const metadata = { takeaway: `${label} at a glance` };
  if (label === "Pipeline") {
    const tests = /CI runs (\d+) tests/.exec(req.prompt)?.[1] ?? "?";
    const shape = (id: string, l: string) => ({ id, type: "shape", content: { shape: "rectangle", label: l } });
    return {
      version: 1,
      template: "sectioned",
      // Out of order on purpose: the links decide the order.
      nodes: [shape("deploy", "Deploy"), shape("build", "Build"), shape("qa", "QA sign-off"), { id: "t1", type: "text", content: { markdown: `CI runs ${tests} tests.` } }, analysis],
      relationships: [
        { from: "build", to: "qa", type: "flows_to" },
        { from: "qa", to: "deploy", type: "flows_to" },
        { from: "build", to: "t1", type: "explained_by" },
      ],
      metadata,
    };
  }
  const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
  return { version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }, analysis], relationships: [], metadata };
}

const model = () =>
  runtimeWith((req) => {
    if (req.task === "outline_document") return response(JSON.stringify(OUTLINE));
    if (req.task === "generate_visual_plan") return response(JSON.stringify(sectionReply(req)));
    if (req.task === "match_statements") return response(JSON.stringify({ matches: [] }));
    return response("unexpected task");
  });

const run = (canvasNoteMode: "ai" | "manual" | undefined, parseMarkdown = markdownToContent, text = doc(1200)) =>
  visualizeContent({ text, operationId: "op_1", title: "Visualize", context, ...(canvasNoteMode ? { canvasNoteMode } : {}) }, model().runtime, { parseMarkdown });

const blocks = (set: ChangeSet) => set.changes.filter((c): c is Extract<ProposedChange, { kind: "create_block" }> => c.kind === "create_block");
const shapes = (set: ChangeSet) => set.changes.filter((c) => c.kind === "create_shape");

describe("Visualize on an AI-managed canvas: a flow section is one FlowDiagram card", () => {
  it("AI mode: one card with the steps in order and their detail; no step shapes; the analysis card stays", async () => {
    const { changeSet } = await run("ai");
    expect(shapes(changeSet)).toHaveLength(0);
    const cards = blocks(changeSet).filter((c) => c.layout);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.layout!.lang).toBe(`root = FlowDiagram("Pipeline", ["Build", "QA sign-off", "Deploy"], ["CI runs 1200 tests.", "", ""])`);
    expect(flowOfContent({ title: "Untitled", snapshot: card.content })?.steps.map((s) => s.label)).toEqual(["Build", "QA sign-off", "Deploy"]);
    // Sized from its FlowDiagram (three short steps in one row), not from its text: narrower than 720, and short.
    expect(card.box.width).toBeLessThan(720);
    expect(card.box.height).toBeLessThan(200);
    expect(blocks(changeSet).some((c) => JSON.stringify(c.content).includes("What Pipeline means."))).toBe(true);
    // The stored plan is the collapsed one (so an update finds the same card); nothing connects to the card.
    const stored = changeSet.contentSource!.plan as VisualPlan;
    expect(stored.nodes.filter((n) => n.role === FLOW_CARD_ROLE).map((n) => n.stableKey)).toEqual([expect.stringMatching(/ § flow-card#0$/)]);
    expect(changeSet.changes.filter((c) => c.kind === "connect")).toHaveLength(0);
  });

  it("Manual mode (and no mode): native shapes and links, no layout — as before", async () => {
    for (const mode of ["manual", undefined] as const) {
      const { changeSet } = await run(mode);
      expect(shapes(changeSet)).toHaveLength(3);
      expect(blocks(changeSet).some((c) => c.layout)).toBe(false);
      expect(changeSet.changes.filter((c) => c.kind === "connect").length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("Updating a flow card (update engine hook)", () => {
  const update = (a: ReturnType<typeof accepted>, text: string) => updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update", context }, model().runtime, { parseMarkdown: parse });

  it("a changed flow section updates its card in place: no removal, no shapes added", async () => {
    const first = await run("ai", parse);
    const a = accepted(first.changeSet);
    const card = a.existing.find((o) => o.stableNodeKey.endsWith("flow-card#0"))!;
    expect(card).toBeTruthy();
    const r = await update(a, doc(1500));
    const set = r.changeSet!;
    // Nothing of the flow is removed (the one removal is the first run's safety-net page, proposed in Manual mode too).
    expect(r.removals).toEqual([{ key: "Release process › Pipeline § page#0", replacedBy: false }]);
    expect(set.changes.filter((c) => c.kind === "remove" && c.target === card.objectId)).toEqual([]);
    expect(shapes(set)).toHaveLength(0);
    const changed = set.changes.filter((c) => c.kind === "update_block" && c.target === card.objectId);
    expect(changed).toHaveLength(1);
    expect(JSON.stringify(changed[0])).toContain("CI runs 1500 tests.");
    // Accepted, then updated again with the same text: nothing to review (the stored plan kept the card).
    const again = await update(acceptUpdate(a, set), doc(1500));
    expect(again.changeSet?.changes.filter((c) => c.kind === "update_block" || c.kind === "create_shape" || (c.kind === "remove" && c.target === card.objectId)) ?? []).toEqual([]);
  });

  it("a source with no flow card updates exactly as before (the section stays native)", async () => {
    const first = await run("manual", parse);
    const r = await update(accepted(first.changeSet), doc(1500));
    expect(r.removals).toEqual([{ key: "Release process › Pipeline § page#0", replacedBy: false }]);
    expect(r.changeSet!.changes.some((c) => c.kind === "update_block" || c.kind === "update_shape" || c.kind === "create_block" || c.kind === "create_shape")).toBe(true);
    expect(JSON.stringify(r.changeSet!.contentSource!.plan)).not.toContain(FLOW_CARD_ROLE);
  });
});

describe("distil knowledge follows the card", () => {
  it("ideas, reviews and flags on collapsed nodes move to the card; others are untouched", () => {
    const section = {
      units: ["u1"],
      ideas: [
        { id: "t1", title: "", body: "CI runs tests", cites: ["u1"] },
        { id: "an1", title: "Status", body: "x", cites: [] },
      ],
      omitted: [],
      problems: [],
      flags: [{ code: "unsupported", card: "t1", detail: "d" }],
      hints: [],
      reviews: { t1: { reasons: ["unsupported"] }, build: { reasons: ["uncited"] } },
    } as unknown as SectionKnowledge;
    const [out] = withRenamedIdeas([section], new Map([["t1", "g::flow"], ["build", "g::flow"]]));
    expect(out!.ideas.map((i) => i.id)).toEqual(["g::flow", "an1"]);
    expect(Object.keys(out!.reviews)).toEqual(["g::flow"]);
    expect(out!.reviews["g::flow"]!.reasons).toEqual(["unsupported", "uncited"]);
    expect(out!.flags[0]!.card).toBe("g::flow");
  });
  it("a flow card's FlowDiagram shows the units the card cites; other blocks are untouched", () => {
    const content = [{ type: "heading" as const, props: { level: 3 }, content: "Pipeline" }, ...markdownToContent(flowMarkdown([{ label: "Build" }, { label: "Deploy" }]))];
    const set = {
      operationId: "op",
      title: "t",
      metadata: { createdBy: "ai" },
      changes: [
        { kind: "create_block", key: "g::flow", blockType: "text", content, box: { x: 0, y: 0, width: 720, height: 120 }, layout: { lang: "old" } },
        { kind: "create_block", key: "other", blockType: "text", content, box: { x: 0, y: 0, width: 300, height: 120 }, layout: { lang: "kept" } },
      ],
    } as unknown as ChangeSet;
    withFlowCitations(set, [{ id: "g::flow", type: "text", content: { markdown: "" } }], { "g::flow": ["u2", "u5"], other: ["u9"] });
    const [card, other] = blocks(set);
    expect(card!.layout!.lang).toBe(`root = FlowDiagram("Pipeline", ["Build", "Deploy"], ["", ""], ["u2", "u5"])`);
    expect(other!.layout!.lang).toBe("kept");
  });
});
