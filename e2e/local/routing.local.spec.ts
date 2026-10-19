/**
 * Wave 1b item 2 in the real app: connectors Acute draws are right-angle (elbow) arrows that
 * leave and enter boxes at right angles, spread where several share a side, and never run
 * through an unrelated object — both when a plan is accepted and after the user drags a card
 * (Excalidraw's own elbow routing only avoids the two ends, so Acute routes them again, in the
 * same undo step). No AI call: the plan goes in through the dev hook.
 */
import { expect, test, type Page } from "@playwright/test";
import { createDemoCanvas, openApp, undo } from "../helpers";

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  containerId?: string | null;
  elbowed?: boolean;
  points?: [number, number][];
  startBinding?: { elementId: string; fixedPoint?: [number, number] } | null;
  endBinding?: { elementId: string; fixedPoint?: [number, number] } | null;
};

const scene = (p: Page): Promise<El[]> =>
  p.evaluate(() => (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements().map((e) => ({ ...e })));

const shape = (id: string, label: string) => ({ id, type: "shape", role: "component", content: { shape: "rectangle", label } });

// A pipeline with a shared store (three links into one side) and a return path over the top.
const plan = () => ({
  version: 1,
  template: "architecture",
  nodes: [shape("cli", "CLI"), shape("router", "Router"), shape("lookup", "Lookup"), shape("retrieval", "Retrieval"), shape("draft", "Draft"), shape("gates", "Gates"), shape("store", "Store"), shape("llm", "LLM")],
  relationships: [
    { from: "cli", to: "router", type: "flows_to" },
    { from: "router", to: "lookup", type: "flows_to" },
    { from: "lookup", to: "retrieval", type: "flows_to" },
    { from: "retrieval", to: "draft", type: "flows_to" },
    { from: "draft", to: "gates", type: "flows_to" },
    { from: "router", to: "store", type: "depends_on" },
    { from: "lookup", to: "store", type: "depends_on" },
    { from: "retrieval", to: "store", type: "depends_on" },
    { from: "draft", to: "llm", type: "depends_on" },
    { from: "gates", to: "cli", type: "flows_to", label: "answer" },
  ],
});

const absolute = (a: El) => (a.points ?? []).map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
const orthogonal = (a: El) => absolute(a).every((p, i, all) => i === 0 || Math.abs(p.x - all[i - 1]!.x) < 0.6 || Math.abs(p.y - all[i - 1]!.y) < 0.6);

/** Unrelated boxes an arrow's route runs through (its own ends and labels excluded). */
function crossings(arrow: El, boxes: El[]): string[] {
  const pts = absolute(arrow);
  const ends = new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId]);
  return boxes
    .filter((b) => !ends.has(b.id))
    .filter((b) =>
      pts.some((p, i) => {
        if (i === 0) return false;
        const q = pts[i - 1]!;
        return Math.max(p.x, q.x) > b.x + 1 && Math.min(p.x, q.x) < b.x + b.width - 1 && Math.max(p.y, q.y) > b.y + 1 && Math.min(p.y, q.y) < b.y + b.height - 1;
      }),
    )
    .map((b) => b.id);
}

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await createDemoCanvas(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("accepted connectors are right-angle elbow arrows, spread on shared sides, clear of every other object; a drag re-routes them in the same undo step", async () => {
  const before = new Set((await scene(page)).map((e) => e.id));
  await page.evaluate(
    (p) =>
      (window as unknown as { __acuteDev: { renderPlan(p: unknown, prov: unknown): Promise<unknown> } }).__acuteDev.renderPlan(p, {
        operationId: "op_routing_1",
        title: "Routing",
        metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock" },
      }),
    plan(),
  );
  // The review preview draws the same right-angle routes (polylines, not straight lines).
  await expect(page.getByRole("region", { name: "AI changes to review" })).toContainText("10 connections");
  await expect(page.locator("polyline.acute-review-ghost--line")).toHaveCount(10);
  await page.getByRole("region", { name: "AI changes to review" }).getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added 8 objects · 10 connections.");

  const added = (await scene(page)).filter((e) => !before.has(e.id));
  const arrows = added.filter((e) => e.type === "arrow");
  const boxes = (await scene(page)).filter((e) => e.type !== "arrow" && !(e.type === "text" && e.containerId) && e.type !== "frame");
  expect(arrows).toHaveLength(10);
  for (const a of arrows) {
    expect(a.elbowed, "elbow arrow").toBe(true);
    expect(orthogonal(a), "every segment horizontal or vertical").toBe(true);
    expect(a.startBinding?.fixedPoint, "bound at a fixed point").toBeTruthy();
    expect(crossings(a, boxes), "runs through no unrelated object").toEqual([]);
  }
  // The three links into Store arrive at distinct points on its side.
  const labelled = (label: string) => added.find((e) => e.id === added.find((t) => t.type === "text" && t.text === label)?.containerId)!;
  const store = labelled("Store");
  const into = arrows.filter((a) => a.endBinding?.elementId === store.id).map((a) => JSON.stringify(a.endBinding!.fixedPoint));
  expect(into).toHaveLength(3);
  expect(new Set(into).size).toBe(3);

  // Drag Store to where a straight elbow from Router would cut through Lookup; Acute routes it clear again.
  const lookup = labelled("Lookup");
  const zoom = await page.evaluate(() => (window as unknown as { __acuteDev: { api: { getAppState(): { zoom: { value: number }; scrollX: number; scrollY: number } } } }).__acuteDev.api.getAppState());
  const toScreen = async (x: number, y: number) => {
    const canvas = await page.locator("canvas.excalidraw__canvas.interactive").boundingBox();
    return { x: (canvas?.x ?? 0) + (x + zoom.scrollX) * zoom.zoom.value, y: (canvas?.y ?? 0) + (y + zoom.scrollY) * zoom.zoom.value };
  };
  const from = await toScreen(store.x + store.width / 2, store.y + store.height / 2);
  const to = await toScreen(lookup.x + lookup.width / 2, lookup.y + lookup.height + 140);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const now = await scene(page);
      const b = now.filter((e) => e.type !== "arrow" && !(e.type === "text" && e.containerId) && e.type !== "frame");
      const moved = now.find((e) => e.id === store.id)!;
      const routed = now.filter((e) => arrows.some((a) => a.id === e.id));
      return moved.x !== store.x && routed.every((a) => orthogonal(a) && crossings(a, b).length === 0);
    })
    .toBe(true);

  // One undo reverts the drag and its re-route together.
  await undo(page);
  const restored = (await scene(page)).find((e) => e.id === store.id)!;
  expect([restored.x, restored.y]).toEqual([store.x, store.y]);
  await undo(page); // the accepted plan
});
