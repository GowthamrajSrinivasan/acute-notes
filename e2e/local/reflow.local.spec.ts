/**
 * F41 in the real app: when AI output has no free space where it belongs,
 * the layout engine makes room locally, as reviewable `move` changes in the
 * same change set. No AI call: plans go in through the dev hook, and the
 * selection is the anchor (as for Ask AI → Visualize on a selection).
 *
 * The scene is a tight flow, A → B → C (48 px apart, less than the 64 px an
 * insertion needs). Inserting a step beside A pushes B and C along the row.
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, select, shapeByLabel, undo } from "../helpers";

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

type Raw = { id: string; x: number; y: number; width: number; height: number; acuteLayout?: { x: number; y: number }; startBinding?: string; endBinding?: string; points?: [number, number][] };

function raw(p: Page, id: string): Promise<Raw> {
  return p.evaluate((id) => {
    type El = { id: string; x: number; y: number; width: number; height: number; points?: [number, number][]; customData?: { acuteLayout?: { x: number; y: number } }; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
    const el = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements().find((e) => e.id === id)!;
    return { id: el.id, x: el.x, y: el.y, width: el.width, height: el.height, acuteLayout: el.customData?.acuteLayout, startBinding: el.startBinding?.elementId, endBinding: el.endBinding?.elementId, points: el.points };
  }, id);
}

function renderPlan(p: Page, plan: unknown, operationId: string): Promise<unknown> {
  const provenance = { operationId, title: "Visualize", metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock" } };
  return p.evaluate(
    ({ plan, provenance }) => (window as unknown as { __acuteDev: { renderPlan(p: unknown, prov: unknown): Promise<unknown> } }).__acuteDev.renderPlan(plan, provenance),
    { plan, provenance },
  );
}

/** Nudges an object as a user drag would (a new position, no layout hint change). */
function userMove(p: Page, id: string, dy: number): Promise<void> {
  return p.evaluate(
    ({ id, dy }) => {
      type El = { id: string; y: number };
      const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[]; updateScene(s: unknown): void } } }).__acuteDev.api;
      api.updateScene({ elements: api.getSceneElements().map((e) => (e.id === id ? { ...e, y: e.y + dy, version: ((e as unknown as { version: number }).version ?? 0) + 1 } : e)) });
    },
    { id, dy },
  );
}

const shape = (id: string, label: string) => ({ id, type: "shape", content: { shape: "rectangle", label } });
const step = { version: 1, template: "flow", nodes: [shape("n", "New step")], relationships: [] };

test.describe.configure({ mode: "serial" });
let page: Page;
let a: Raw, b: Raw, c: Raw;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await renderPlan(
    page,
    { version: 1, template: "flow", nodes: [shape("a", "Alpha"), shape("b", "Bravo"), shape("c", "Charlie")], relationships: [{ from: "a", to: "b", type: "relates_to" }, { from: "b", to: "c", type: "relates_to" }] },
    "op_flow",
  );
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const byLabel = async (l: string) => raw(page, (await shapeByLabel(page, l)).id);
  a = await byLabel("Alpha");
  b = await byLabel("Bravo");
  c = await byLabel("Charlie");
});
test.afterAll(async () => {
  await page?.context().close();
});

test("every object Acute creates records where it put it (the layout hint)", async () => {
  for (const o of [a, b, c]) expect(o.acuteLayout).toEqual({ x: o.x, y: o.y });
});

test("no room beside A: the new step goes right next to it and B, C are proposed to move along — nothing moves before Accept", async () => {
  await select(page, a.id);
  const before = await elements(page);
  await renderPlan(page, step, "op_step_1");
  await expect(reviewBar(page)).toContainText("2 moves");
  expect(await elements(page)).toEqual(before); // still only a proposal
  // Reject: the canvas is exactly as it was.
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
  await expect(reviewBar(page)).toBeHidden();
  expect(await elements(page)).toEqual(before);
});

test("Accept: the step sits in line after A, B and C moved along the row (and nothing overlaps), bound arrows follow, one undo restores all", async () => {
  await select(page, a.id);
  await renderPlan(page, step, "op_step_2");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const added = await raw(page, (await shapeByLabel(page, "New step")).id);
  expect(added).toMatchObject({ x: a.x + a.width + 64, y: a.y });
  const [b2, c2] = await Promise.all([raw(page, b.id), raw(page, c.id)]);
  expect(b2.y).toBe(b.y);
  expect(b2.x).toBeGreaterThanOrEqual(added.x + added.width + 64);
  expect(c2.x - c.x).toBe(b2.x - b.x); // C keeps its spacing from B
  // Still "placed by Acute" where Acute moved them.
  expect(b2.acuteLayout).toEqual({ x: b2.x, y: b2.y });
  // The A → B arrow still ends at B, where B is now.
  const arrow = (await elements(page)).find((e) => e.type === "arrow" && e.x < b2.x && e.x + e.width > a.x + a.width - 1)!;
  const r = await raw(page, arrow.id);
  expect([r.startBinding, r.endBinding]).toEqual([a.id, b.id]);
  // Its end is on B's edge where B is now (it may enter B from above: the new step now sits between A and B, and
  // a link skipping a box runs around it, out of and back into the same side — Wave D).
  const endX = r.x + r.points!.at(-1)![0];
  const endY = r.y + r.points!.at(-1)![1];
  expect(endX).toBeGreaterThan(added.x + added.width);
  expect(endX).toBeGreaterThanOrEqual(b2.x - 10);
  expect(endX).toBeLessThanOrEqual(b2.x + b2.width + 10);
  expect(endY).toBeGreaterThanOrEqual(b2.y - 10);
  expect(endY).toBeLessThanOrEqual(b2.y + b2.height + 10);

  await undo(page);
  const [b3, c3] = await Promise.all([raw(page, b.id), raw(page, c.id)]);
  expect([b3.x, c3.x]).toEqual([b.x, c.x]);
});

test("objects the user moved are not pushed when a free slot nearby costs less", async () => {
  await userMove(page, b.id, 1);
  await userMove(page, c.id, 1);
  expect((await raw(page, b.id)).acuteLayout).not.toEqual({ x: b.x, y: b.y + 1 });
  await select(page, a.id);
  await renderPlan(page, step, "op_step_3");
  await expect(reviewBar(page)).toBeVisible();
  await expect(reviewBar(page)).not.toContainText("move");
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
});
