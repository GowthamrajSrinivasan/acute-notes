/**
 * The route probe on the canvas (archify's "Path" tool): click ⇢ Path on an interactive frame, pick where the path
 * starts (what it can reach lights up), then where it ends (the route lights up). The scene is never changed.
 */
import { expect, test } from "@playwright/test";
import { elements, openApp, select, shapeByLabel } from "../helpers";

test("route probe: start, reachable nodes, end, route, leave", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "architecture",
        metadata: { title: "Route" },
        nodes: [
          { id: "ui", type: "shape", content: { shape: "rectangle", label: "CLI", kind: "frontend" } },
          { id: "router", type: "shape", content: { shape: "rectangle", label: "Router", kind: "backend" } },
          { id: "db", type: "shape", content: { shape: "cylinder", label: "Index", kind: "database" } },
          { id: "orphan", type: "shape", content: { shape: "rectangle", label: "Orphan", kind: "external" } },
        ],
        relationships: [
          { from: "ui", to: "router", type: "flows_to", label: "question" },
          { from: "router", to: "db", type: "depends_on" },
        ],
      },
      { operationId: "op_route", title: "Route", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const ui = await shapeByLabel(page, "CLI");
  const router = await shapeByLabel(page, "Router");
  const db = await shapeByLabel(page, "Index");
  const orphan = await shapeByLabel(page, "Orphan");
  const before = JSON.stringify((await elements(page)).map((e) => [e.id, e.x, e.y]));

  const probe = page.getByRole("dialog", { name: "Path" });
  await page.locator("[data-route-chip]").click();
  await expect(probe).toContainText("Click where the path starts");
  await expect(probe).toContainText("Only nodes you can reach will light up");

  // Start: Router and Index are reachable from the CLI, the orphan isn't.
  await select(page, ui.id);
  await expect(probe).toContainText("Now click the end of the path from CLI");
  await expect(page.getByTestId("route-probe-reach")).toContainText("2 nodes can be reached");
  await expect(page.locator('.acute-route__node[data-role="candidate"]')).toHaveCount(2);
  await expect(page.locator('.acute-route__node[data-role="start"]')).toHaveCount(1);

  // An unreachable end says so and keeps waiting.
  await select(page, orphan.id);
  await expect(probe).toContainText("Orphan can't be reached from CLI");

  // End: the route, with its stops and flowing arrows.
  await select(page, db.id);
  await expect(probe).toContainText("CLI → Index");
  await expect(probe.getByRole("list", { name: "Path stops" }).getByRole("listitem")).toHaveText(["CLI →", "Router →", "Index"]);
  await expect(page.getByTestId("route-probe-summary")).toHaveText("2 hops, along the arrows");
  await expect(page.locator(".acute-route__edge")).toHaveCount(2);
  await expect(page.locator('.acute-route__node[data-role="via"]')).toHaveCount(1);
  await expect(page.locator('.acute-route__node[data-role="end"]')).toHaveCount(1);
  await page.screenshot({ path: "test-results/route-probe.png" });

  // Change the end, then leave with Esc.
  await probe.getByRole("button", { name: "Change end" }).click();
  await expect(probe).toContainText("Now click the end of the path from CLI");
  await select(page, router.id);
  await expect(page.getByTestId("route-probe-summary")).toHaveText("1 hop, along the arrows");
  await page.keyboard.press("Escape");
  await expect(probe).toBeHidden();
  await expect(page.locator(".acute-route__node")).toHaveCount(0);

  // Nothing on the canvas changed.
  expect(JSON.stringify((await elements(page)).map((e) => [e.id, e.x, e.y]))).toBe(before);
});

test("route probe: a node already selected is the start", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "architecture",
        metadata: { title: "Route" },
        nodes: [
          { id: "a", type: "shape", content: { shape: "rectangle", label: "Alpha", kind: "frontend" } },
          { id: "b", type: "shape", content: { shape: "rectangle", label: "Beta", kind: "backend" } },
        ],
        relationships: [{ from: "a", to: "b", type: "flows_to" }],
      },
      { operationId: "op_route2", title: "Route", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const alpha = await shapeByLabel(page, "Alpha");
  await select(page, alpha.id);
  await page.locator("[data-route-chip]").click();
  const probe = page.getByRole("dialog", { name: "Path" });
  await expect(probe).toContainText("Now click the end of the path from Alpha");

  // The finder picks the end too.
  await probe.getByLabel("Find end").fill("bet");
  await probe.getByRole("button", { name: "Beta" }).click();
  await expect(probe).toContainText("Alpha → Beta");
  await probe.getByRole("button", { name: "Clear" }).click();
  await expect(probe).toBeHidden();
});
