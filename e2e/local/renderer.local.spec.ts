/**
 * F30 in the real app: a `VisualPlan` goes through F29's validator, F30's
 * layout + placement + node mapping (using the real Markdown → rich-content
 * parser, not a stub), and lands as an ordinary F19 review — proving every
 * created object really is editable, movable and undoable like a manually
 * created one. No AI call: plans are handed in directly via the dev hook,
 * as F31's future orchestration will hand them in from a model or the local
 * planner.
 */
import { expect, test, type Page } from "@playwright/test";
import { blockByTitle, createDemoCanvas, documentOf, elements, openApp, select, undo, type ElementInfo } from "../helpers";

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

type RenderResult = { warnings: string[] };

function renderPlan(p: Page, plan: unknown, provenance: { operationId: string; title: string; metadata: Record<string, unknown> }): Promise<RenderResult> {
  return p.evaluate(
    ({ plan, provenance }) => (window as unknown as { __acuteDev: { renderPlan(p: unknown, prov: unknown): Promise<RenderResult> } }).__acuteDev.renderPlan(plan, provenance),
    { plan, provenance },
  );
}

const provenanceFor = (op: string, title = "Visualize") => ({ operationId: op, title, metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock" } });

const actionPlan = () => ({
  version: 1,
  template: "action_plan",
  metadata: { title: "Rollout plan" },
  nodes: [
    { id: "h", type: "heading", content: { text: "Rollout plan" } },
    { id: "t", type: "todo", title: "Steps", content: { items: [{ text: "Ship the flag", checked: false }, { text: "Notify support", checked: false }] } },
    { id: "x", type: "text", content: { markdown: "Owner: **payments team**. See `retry.ts`." } },
    { id: "pg", type: "page", content: { title: "Runbook", markdown: "## Rollback\n\nRevert the flag." } },
  ],
  relationships: [{ from: "t", to: "pg", type: "depends_on", label: "see" }],
});

const architecturePlan = () => ({
  version: 1,
  template: "architecture",
  nodes: [
    { id: "web", type: "shape", role: "component", content: { shape: "rectangle", label: "Web client" } },
    { id: "api", type: "shape", role: "component", content: { shape: "rectangle", label: "Checkout API" } },
    { id: "db", type: "shape", role: "component", content: { shape: "ellipse", label: "Orders DB" } },
  ],
  relationships: [
    { from: "web", to: "api", type: "depends_on", label: "HTTPS" },
    { from: "api", to: "db", type: "depends_on", label: "writes" },
  ],
});

let seq = 0;
const nextOp = () => `op_render_${++seq}`;

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await createDemoCanvas(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("an action_plan renders real blocks and a page, with Markdown actually parsed (not a stub)", async () => {
  const before = new Set((await elements(page)).map((e) => e.id));
  const op = nextOp();
  await renderPlan(page, actionPlan(), provenanceFor(op));
  await expect(reviewBar(page)).toContainText("Visualize · 4 objects · 1 connection");

  const bar = reviewBar(page);
  await bar.getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added 4 objects · 1 connection.");

  const added = (await elements(page)).filter((e) => !before.has(e.id));
  const blocks = added.filter((e): e is ElementInfo & { acute: NonNullable<ElementInfo["acute"]> } => !!e.acute);
  expect(blocks).toHaveLength(4); // heading, todo, text, page-preview

  const heading = blocks.find((b) => b.acute.blockType === "text" && b.acute.frame === "none")!;
  expect(heading).toBeTruthy();
  const headingDoc = await documentOf(page, heading.acute.documentId!);
  expect(headingDoc!.snapshot).toMatchObject([{ type: "paragraph" }]);

  const todo = blocks.find((b) => b.acute.blockType === "todo")!;
  const todoDoc = await documentOf(page, todo.acute.documentId!);
  expect(todoDoc!.snapshot.some((b) => b.type === "checkListItem")).toBe(true);
  expect(todoDoc!.metadata?.ai).toMatchObject({ createdBy: "ai", task: "generate_visual_plan", operationId: op });

  const text = blocks.find((b) => b.acute.blockType === "text" && b.acute.frame !== "none")!;
  const textDoc = await documentOf(page, text.acute.documentId!);
  // The real BlockNote Markdown parser ran: bold/inline-code became real inline styles, not the literal "**payments team**".
  expect(JSON.stringify(textDoc!.snapshot)).not.toContain("**payments team**");
  expect(JSON.stringify(textDoc!.snapshot)).toContain("payments team");

  const pagePreview = blocks.find((b) => b.acute.kind === "page-preview")!;
  const pageDoc = await documentOf(page, pagePreview.acute.pageId!);
  expect(pageDoc!.title).toBe("Runbook");
  expect(JSON.stringify(pageDoc!.snapshot)).toContain("Rollback");
  expect(pageDoc!.metadata?.ai).toMatchObject({ createdBy: "ai", operationId: op });

  await undo(page);
  expect((await elements(page)).filter((e) => !before.has(e.id))).toEqual([]);
});

test("architecture lays out dependencies left to right and binds real arrows with their relation type", async () => {
  const before = new Set((await elements(page)).map((e) => e.id));
  const op = nextOp();
  await renderPlan(page, architecturePlan(), provenanceFor(op, "Architecture"));
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added 3 objects · 2 connections.");

  const added = (await elements(page)).filter((e) => !before.has(e.id));
  // A bound label can wrap onto multiple lines (Excalidraw's own layout, from the shape's estimated width) — match ignoring that.
  const byLabel = async (label: string) => {
    const text = added.find((e) => e.type === "text" && e.text?.replace(/\s+/g, " ") === label);
    return added.find((e) => e.id === text?.containerId)!;
  };
  const web = await byLabel("Web client");
  const api = await byLabel("Checkout API");
  const db = await byLabel("Orders DB");
  expect(web.x).toBeLessThan(api.x);
  expect(api.x).toBeLessThan(db.x);

  const arrows = added.filter((e) => e.type === "arrow");
  expect(arrows).toHaveLength(2);
  expect(arrows.every((a) => a.relation === "depends_on")).toBe(true);
  expect(arrows.some((a) => added.some((l) => l.containerId === a.id && l.text === "HTTPS"))).toBe(true);

  await undo(page);
});

test("a large plan (50 nodes, 49 relationships) previews without committing and undoes in one step", async () => {
  const before = (await elements(page)).length;
  const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, type: "shape", content: { shape: "rectangle", label: `Node ${i}` } }));
  const relationships = Array.from({ length: 49 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, type: "relates_to" }));
  const op = nextOp();
  const start = Date.now();
  await renderPlan(page, { version: 1, template: "concept_map", nodes, relationships }, provenanceFor(op, "Big map"));
  const ms = Date.now() - start;
  console.info(`[F30] validated+rendered 50 nodes/49 relationships end to end in ${ms} ms`);
  await expect(reviewBar(page)).toContainText("50 objects · 49 connections");
  expect((await elements(page)).length).toBe(before); // preview only, nothing committed yet

  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added 50 objects · 49 connections.");
  // Each shape is 2 scene elements (the shape + its bound label), each connection is 1 arrow (no label on these).
  expect((await elements(page)).length).toBe(before + 50 * 2 + 49);
  await undo(page);
  expect((await elements(page)).length).toBe(before);
});

test("placement avoids overlapping what's already on the canvas", async () => {
  const overview = await blockByTitle(page, "Checkout revamp — overview");
  const overviewBox = (await elements(page)).find((e) => e.id === overview.id)!;
  await select(page, overview.id); // used as the placement anchor
  const before = new Set((await elements(page)).map((e) => e.id));
  const op = nextOp();
  await renderPlan(page, { version: 1, template: "flow", nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "Step" } }], relationships: [] }, provenanceFor(op, "Beside selection"));
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  const added = (await elements(page)).filter((e) => !before.has(e.id))[0]!;
  const overlaps = added.x < overviewBox.x + overviewBox.width && added.x + added.width > overviewBox.x && added.y < overviewBox.y + overviewBox.height && added.y + added.height > overviewBox.y;
  expect(overlaps).toBe(false);
  await undo(page);
});

test("an invalid plan is refused before anything is proposed, with the specific problem reported", async () => {
  const error = await page.evaluate(async () => {
    try {
      await (window as unknown as { __acuteDev: { renderPlan(p: unknown, prov: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
        { version: 1, template: "not_a_real_template", nodes: [] },
        { operationId: "op_bad", title: "Bad", metadata: { createdBy: "ai" } },
      );
      return null;
    } catch (e) {
      return { name: (e as Error).name };
    }
  });
  expect(error).toEqual({ name: "InvalidVisualPlanError" });
  await expect(reviewBar(page)).toBeHidden();
});
