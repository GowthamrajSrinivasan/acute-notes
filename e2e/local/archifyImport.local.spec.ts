/**
 * Frames Phase 3 in the real app, with no AI: an Archify architecture document, or an architecture-like Mermaid
 * flowchart, pasted into Visualize lands as interactive diagram frames — kinds on the shapes, a node card with its
 * relationships, the document's info cards under the frame.
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, select, shapeByLabel } from "../helpers";

type Raw = { id: string; type: string; name?: string | null; strokeColor: string; customData?: Record<string, unknown> };

function frames(page: Page): Promise<Raw[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): Raw[] } } }).__acuteDev.api;
    return api.getSceneElements().filter((e) => e.type === "frame").map((e) => ({ id: e.id, type: e.type, name: e.name, strokeColor: e.strokeColor, customData: e.customData }));
  });
}

async function visualize(page: Page, text: string) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill(text);
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  const bar = page.getByRole("region", { name: "AI changes to review" });
  await bar.getByRole("button", { name: "Accept all" }).click();
  await expect(bar).toBeHidden();
}

const DOC = {
  schema_version: 1,
  diagram_type: "architecture",
  meta: { title: "Checkout platform" },
  components: [
    { id: "web", type: "frontend", label: "Storefront", sublabel: "Next.js" },
    { id: "api", type: "backend", label: "Order API", sublabel: "FastAPI :8000", tag: "stateless" },
    { id: "db", type: "database", label: "Orders DB", sublabel: "Postgres" },
    { id: "psp", type: "external", label: "Payment provider" },
  ],
  connections: [
    { from: "web", to: "api", label: "HTTPS" },
    { from: "api", to: "db", label: "SQL" },
    { from: "api", to: "psp", label: "charge", variant: "dashed" },
  ],
  cards: [{ dot: "rose", title: "Security", items: ["OAuth 2.0 with PKCE"] }],
};

test("a pasted Archify architecture document becomes an interactive diagram frame", async ({ page }) => {
  await openApp(page);
  await visualize(page, JSON.stringify(DOC, null, 2));

  const [frame] = await frames(page);
  expect(frame?.customData?.acuteDiagram).toMatchObject({ type: "architecture", interactive: true, cards: [{ kind: "security", title: "Security", items: ["OAuth 2.0 with PKCE"] }] });
  expect((await elements(page)).some((e) => e.type === "text" && e.text === "Order API")).toBe(true);

  const api = await shapeByLabel(page, "Order API");
  await select(page, api.id);
  const card = page.getByRole("dialog", { name: "Order API relationships" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Backend");
  await expect(card).toContainText("FastAPI :8000");
  await expect(card.getByRole("region", { name: "Incoming" })).toContainText("Storefront");
  await expect(card.getByRole("region", { name: "Outgoing" })).toContainText("Orders DB");
  await expect(card.getByRole("region", { name: "Outgoing" })).toContainText("depends on");
  await expect(page.locator(".acute-diagram-infocard")).toContainText("OAuth 2.0 with PKCE");
  await page.screenshot({ path: "test-results/archify-import.png" });
});

test("an architecture-like Mermaid flowchart lands in an interactive frame with guessed kinds", async ({ page }) => {
  await openApp(page);
  await visualize(page, "```mermaid\nflowchart LR\n  ui[Web app] --> api[Order API]\n  api --> db[(Orders)]\n  api --> q[Kafka]\n```");

  const [frame] = await frames(page);
  expect(frame?.customData?.acuteDiagram).toMatchObject({ type: "architecture", interactive: true });
  const api = await shapeByLabel(page, "Order API");
  await select(page, api.id);
  const card = page.getByRole("dialog", { name: "Order API relationships" });
  await expect(card).toContainText("Backend");
  await expect(card.getByRole("region", { name: "Outgoing" })).toContainText("Kafka");
});

async function zoomTo(page: Page, value: number) {
  await page.evaluate((zoom) => {
    const api = (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void } } }).__acuteDev.api;
    api.updateScene({ appState: { zoom: { value: zoom } } });
  }, value);
}

test("node sublabels and tags show on the canvas by zoom, and never change the shape's label", async ({ page }) => {
  await openApp(page);
  await visualize(page, JSON.stringify(DOC, null, 2));
  const details = page.locator(".acute-diagram-detail");

  await zoomTo(page, 1);
  await expect(details.filter({ hasText: "FastAPI :8000" })).toBeVisible();
  await expect(details.filter({ hasText: "stateless" })).toHaveCount(0);

  await zoomTo(page, 1.5);
  await expect(details.filter({ hasText: "stateless" })).toBeVisible();
  await page.screenshot({ path: "test-results/diagram-node-details.png" });

  await zoomTo(page, 0.5);
  await expect(details).toHaveCount(0);

  // The label is still only what was given: details are an overlay.
  expect((await elements(page)).find((e) => e.type === "text" && e.text?.includes("Order API"))?.text).toBe("Order API");
});

test("a Mermaid architecture-beta diagram lands in an interactive frame, icons as kinds", async ({ page }) => {
  await openApp(page);
  await visualize(
    page,
    "```mermaid\narchitecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  service disk(disk)[Storage] in api\n  db:L -- R:server\n  server:B --> T:disk\n```",
  );
  const [frame] = await frames(page);
  expect(frame?.customData?.acuteDiagram).toMatchObject({ type: "architecture", interactive: true });
  const server = await shapeByLabel(page, "Server");
  await select(page, server.id);
  const card = page.getByRole("dialog", { name: "Server relationships" });
  await expect(card).toContainText("Backend");
  await expect(card.getByRole("region", { name: "Outgoing" })).toContainText("Storage");
});
