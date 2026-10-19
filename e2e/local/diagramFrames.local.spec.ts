/**
 * Interactive architecture frames in the real app: a frame switched to "Interactive diagram" gives its shapes a kind
 * and sublabel from the properties panel, a selected node shows a passport card with its relationships, and clicking
 * a relationship goes to the neighbour. The overlay never changes the scene.
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, select, selectedIds, shapeByLabel } from "../helpers";

type Raw = { id: string; type: string; strokeColor: string; opacity: number; customData?: Record<string, unknown> };

function raw(page: Page, id: string): Promise<Raw | undefined> {
  return page.evaluate((elementId) => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): Raw[] } } }).__acuteDev.api;
    const el = api.getSceneElements().find((e) => e.id === elementId);
    return el && { id: el.id, type: el.type, strokeColor: el.strokeColor, opacity: el.opacity, customData: el.customData };
  }, id);
}

test("interactive diagram frame: kinds, passport card, navigation", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "sectioned",
        nodes: [
          { id: "g", type: "group", content: { label: "KnowFlow RAG", arrangement: "tree" } },
          { id: "ui", type: "shape", parent: "g", content: { shape: "rectangle", label: "CLI" } },
          { id: "router", type: "shape", parent: "g", content: { shape: "rectangle", label: "Router" } },
          { id: "db", type: "shape", parent: "g", content: { shape: "rectangle", label: "Index" } },
        ],
        relationships: [
          { from: "ui", to: "router", type: "flows_to", label: "question" },
          { from: "router", to: "db", type: "depends_on" },
        ],
      },
      { operationId: "op_diagram", title: "Diagram", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  const router = await shapeByLabel(page, "Router");
  const index = await shapeByLabel(page, "Index");

  // Not interactive yet: selecting a node shows no card.
  await select(page, router.id);
  await expect(page.getByRole("dialog", { name: "Router relationships" })).toHaveCount(0);

  // The frame's switch turns it into an interactive diagram.
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await expect.poll(async () => (await raw(page, frame.id))?.customData?.acuteDiagram).toEqual({ type: "architecture", interactive: true });

  // A node's kind (restyles it) and sublabel, from the panel.
  await select(page, router.id);
  await page.getByLabel("Node kind").selectOption("backend");
  await page.getByLabel("Sublabel").fill("manuals.py");
  await page.getByLabel("Sublabel").press("Enter");
  await expect.poll(async () => (await raw(page, router.id))?.customData?.acuteNode).toEqual({ kind: "backend", sublabel: "manuals.py" });
  expect((await raw(page, router.id))?.strokeColor).toBe("#059669");

  // The passport card: kind, sublabel, reach, and both relationships.
  const card = page.getByRole("dialog", { name: "Router relationships" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Backend");
  await expect(card).toContainText("manuals.py");
  await expect(card).toContainText("1 upstream · 1 downstream");
  await expect(card.getByRole("region", { name: "Incoming" })).toContainText("CLI");
  await expect(card.getByRole("region", { name: "Incoming" })).toContainText("question");
  await expect(card.getByRole("region", { name: "Outgoing" })).toContainText("depends on");

  // Legend under the frame.
  await expect(page.getByLabel("Legend")).toContainText("Backend");

  // The highlight is an overlay: no element's opacity changed.
  expect((await raw(page, index.id))?.opacity).toBe(100);

  await page.screenshot({ path: "test-results/diagram-frame-card.png" });

  // Clicking a relationship goes to the neighbour, and the card follows.
  await card.getByRole("button", { name: /Index/ }).click();
  await expect.poll(() => selectedIds(page)).toEqual([index.id]);
  await expect(page.getByRole("dialog", { name: "Index relationships" })).toBeVisible();

  // Closing clears the selection.
  await page.getByRole("dialog", { name: "Index relationships" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: /relationships/ })).toHaveCount(0);
});

test("an architecture plan with component kinds lands in an interactive diagram frame", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "architecture",
        metadata: { title: "KnowFlow RAG", cards: [{ kind: "cloud", title: "Cost", items: ["About $16 per manual", "Fast path skips retrieval"] }] },
        nodes: [
          { id: "ui", type: "shape", content: { shape: "rectangle", label: "CLI", kind: "frontend", sublabel: "query.py" } },
          { id: "router", type: "shape", content: { shape: "rectangle", label: "Router", kind: "backend", details: ["Routes to one manual", "Free when a product is named"] } },
          { id: "db", type: "shape", content: { shape: "cylinder", label: "Index", kind: "database", tag: "3,258 keywords" } },
        ],
        relationships: [
          { from: "ui", to: "router", type: "flows_to", label: "question" },
          { from: "router", to: "db", type: "depends_on", label: "owner lookup", explanation: "Picks the manual that owns the keyword" },
        ],
      },
      { operationId: "op_arch", title: "Architecture", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  expect((await raw(page, frame.id))?.customData?.acuteDiagram).toEqual({
    type: "architecture",
    interactive: true,
    cards: [{ kind: "cloud", title: "Cost", items: ["About $16 per manual", "Fast path skips retrieval"] }],
  });
  const router = await shapeByLabel(page, "Router");
  expect((await raw(page, router.id))?.strokeColor).toBe("#059669");

  // Legend and info cards under the frame.
  await expect(page.getByLabel("Legend")).toContainText("Database");
  await expect(page.locator(".acute-diagram-infocard")).toContainText("About $16 per manual");

  await select(page, router.id);
  const card = page.getByRole("dialog", { name: "Router relationships" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("KnowFlow RAG");
  await expect(card).toContainText("Free when a product is named");
  await expect(card.getByRole("region", { name: "Outgoing" })).toContainText("Picks the manual that owns the keyword");
  await page.screenshot({ path: "test-results/diagram-frame-architecture.png" });

  // The cylinder is a node too: clicking it (which selects its whole outline group) shows its card.
  await card.getByRole("button", { name: /Index/ }).click();
  await expect(page.getByRole("dialog", { name: "Index relationships" })).toContainText("3,258 keywords");

  // A click on the cylinder selects its host with the outline parts (one group): still the Index node's card.
  const index = await shapeByLabel(page, "Index");
  const group = await page.evaluate((hostId) => {
    type El = { id: string; groupIds: string[]; isDeleted?: boolean };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    const els = api.getSceneElements();
    const g = els.find((e) => e.id === hostId)!.groupIds[0];
    return els.filter((e) => g && e.groupIds[0] === g).map((e) => e.id);
  }, index.id);
  expect(group.length).toBeGreaterThan(1);
  await select(page);
  await expect(page.getByRole("dialog", { name: /relationships/ })).toHaveCount(0);
  await select(page, ...group);
  await expect(page.getByRole("dialog", { name: "Index relationships" })).toBeVisible();
});
