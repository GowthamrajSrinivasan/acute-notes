/**
 * Acute Lens, Phase 1A-i (plan: .ai/docs/acute-lens-plan.md §10): opening an interactive frame in Lens shows the
 * same nodes and relationships in the canvas's own arrangement, a selected node's passport card (details and
 * relations), and "Back to canvas" returns to the originating element — all without changing the scene.
 */
import { expect, test, type Page } from "@playwright/test";
import { canvasHome, elements, openApp, select, selectedIds, waitForCanvas } from "../helpers";

type Raw = { id: string; customData?: Record<string, unknown> };

function raw(page: Page, id: string): Promise<Raw | undefined> {
  return page.evaluate((elementId) => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): Raw[] } } }).__acuteDev.api;
    const el = api.getSceneElements().find((e) => e.id === elementId);
    return el && { id: el.id, customData: el.customData };
  }, id);
}

test("open in Lens, inspect a node, and return to canvas unchanged", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (
      window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }
    ).__acuteDev.renderPlan(
      {
        version: 1,
        template: "sectioned",
        nodes: [
          { id: "g", type: "group", content: { label: "Payments", arrangement: "tree" } },
          { id: "ui", type: "shape", parent: "g", content: { shape: "rectangle", label: "Frontend", kind: "frontend" } },
          { id: "api", type: "shape", parent: "g", content: { shape: "rectangle", label: "API", kind: "backend" } },
        ],
        relationships: [{ from: "ui", to: "api", type: "flows_to", label: "request" }],
      },
      { operationId: "op_lens", title: "Lens fixture", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  const undo = page.getByTestId("acute-undo");

  // The frame's switch, then AC1: "✨ Open in Lens" opens it docked at that frame's level.
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await expect.poll(() => undo.isEnabled()).toBe(true);

  // Everything from here is what AC10 says Lens must never change.
  const before = await elements(page);
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  await expect(lens).toBeVisible();
  await expect(lens).toContainText("L1 Architecture");
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("Payments");

  // AC2: the canvas's own nodes, kinds and the arrow's label and direction.
  const frontend = lens.locator('g.acute-lens-node[aria-label="Frontend"]');
  const api = lens.locator('g.acute-lens-node[aria-label="API"]');
  await expect(frontend).toBeVisible();
  await expect(api).toBeVisible();
  await expect(lens).toContainText("request");

  // AC1 (cont'd) / AC3: selecting a node shows its passport — kind, level, reach and relationships.
  await frontend.click();
  const inspector = lens.locator(".acute-lens-panel__inspector");
  await expect(inspector).toContainText("Frontend");
  await expect(inspector).toContainText("Payments");
  await expect(inspector).toContainText("0 upstream · 1 downstream");
  await expect(inspector.getByRole("region", { name: "Outgoing" })).toContainText("API");
  await expect(inspector.getByRole("region", { name: "Outgoing" })).toContainText("flows to");

  // Clicking a relationship selects the neighbour (still inside Lens, not the canvas).
  await inspector.getByRole("button", { name: /API/ }).click();
  await expect(inspector).toContainText("1 upstream · 0 downstream");

  // AC6: visual zoom changes only the diagram's scale, never the level shown in the header.
  await lens.getByRole("button", { name: "Zoom in" }).click();
  await expect(lens.locator(".acute-lens-panel__zoom-value")).toHaveText("110%");
  await expect(lens).toContainText("L1 Architecture");

  // AC13: Lens and the page panel never show together.
  await expect(page.locator(".acute-page-panel")).toHaveCount(0);

  // AC9: "← Back to canvas" selects the originating element (API, the last Lens selection).
  await page.getByRole("button", { name: "Back to canvas" }).click();
  await expect(lens).toBeHidden();
  const apiId = (await elements(page)).find((e) => e.text === "API")!.containerId!;
  await expect.poll(() => selectedIds(page)).toEqual([apiId]);

  // AC10: opening, navigating and closing Lens changed no element.
  expect(await elements(page)).toEqual(before);
  // ...and added no undo step: the only step in the whole session is still "Interactive diagram".
  await undo.click();
  await expect(undo).toBeDisabled();
  expect((await raw(page, frame.id))?.customData?.acuteDiagram).toBeUndefined();
});

type AcuteDevApi = { renderPlan(plan: unknown, p: unknown): Promise<unknown> };
function renderPlan(page: Page, plan: unknown, meta: { operationId: string; title: string }): Promise<unknown> {
  const full = { ...meta, metadata: { createdBy: "import" } };
  return page.evaluate(([p, m]) => (window as unknown as { __acuteDev: AcuteDevApi }).__acuteDev.renderPlan(p, m), [plan, full] as const);
}
function architecturePlan(title: string, nodes: { id: string; label: string; kind?: string }[], relationships: { from: string; to: string; label?: string }[] = []) {
  return {
    version: 1,
    template: "architecture",
    metadata: { title },
    nodes: nodes.map((n) => ({ id: n.id, type: "shape", content: { shape: "rectangle", label: n.label, kind: n.kind ?? "backend" } })),
    relationships: relationships.map((r) => ({ ...r, type: "flows_to" })),
  };
}

test("North Star: L1 → L4 through linked detail frames, and back (plan §10)", async ({ page }) => {
  await openApp(page);

  // Four independent frames, one per level, linked afterward by hand (D23's own "Link to detail frame").
  await renderPlan(
    page,
    architecturePlan("Payments", [{ id: "ui", label: "Frontend", kind: "frontend" }, { id: "api", label: "API", kind: "backend" }], [{ from: "ui", to: "api", label: "request" }]),
    { operationId: "op_l1", title: "L1" },
  );
  await page.getByRole("button", { name: "Accept all" }).click();
  await renderPlan(
    page,
    architecturePlan("Payment Service", [{ id: "stripe", label: "Stripe", kind: "external" }, { id: "webhook", label: "Webhook", kind: "backend" }], [{ from: "stripe", to: "webhook" }]),
    { operationId: "op_l2", title: "L2" },
  );
  await page.getByRole("button", { name: "Accept all" }).click();
  await renderPlan(
    page,
    architecturePlan("Webhook Flow", [{ id: "receive", label: "Receive", kind: "backend" }, { id: "verify", label: "Verify", kind: "backend" }], [{ from: "receive", to: "verify" }]),
    { operationId: "op_l3", title: "L3" },
  );
  await page.getByRole("button", { name: "Accept all" }).click();
  await renderPlan(page, architecturePlan("Verify Operation", [{ id: "op", label: "updateStatus", kind: "backend" }]), { operationId: "op_l4", title: "L4" });
  await page.getByRole("button", { name: "Accept all" }).click();

  const frames = (await elements(page)).filter((e) => e.type === "frame");
  const api = (await elements(page)).find((e) => e.text === "API")!;

  // Mark every frame interactive.
  for (const f of frames) {
    await select(page, f.id);
    await page.getByLabel("Interactive diagram").check();
    await expect.poll(async () => (await raw(page, f.id))?.customData?.acuteDiagram).toMatchObject({ interactive: true });
  }

  // Link each node to the next level's frame via "Link to detail frame…" (D23), picking "Existing frames".
  const linkTo = async (nodeTextId: string, frameTitle: string) => {
    const node = (await elements(page)).find((e) => e.text === nodeTextId)!;
    await select(page, node.containerId!);
    await page.getByRole("button", { name: "Link to detail frame…" }).click();
    const menu = page.getByRole("menu", { name: "Link to detail frame" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: frameTitle }).click();
  };
  await linkTo("API", "Payment Service");
  await linkTo("Webhook", "Webhook Flow");
  await linkTo("Verify", "Verify Operation");

  // AC1: "Open in Lens" from a node assigns its key and opens Lens with it selected.
  await select(page, api.containerId!);
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens).toContainText("L1 Architecture");
  const inspector = lens.locator(".acute-lens-panel__inspector");
  await expect(inspector).toContainText("API");

  // AC4: "Zoom in" on a node with a detail link shows its child frame at the next level; the breadcrumb updates.
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens).toContainText("L2 Component");
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment Service");
  await expect(lens.locator('g.acute-lens-node[aria-label="Webhook"]')).toBeVisible();

  await lens.locator('g.acute-lens-node[aria-label="Webhook"]').click();
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens).toContainText("L3 Flow");
  await expect(lens.locator('g.acute-lens-node[aria-label="Verify"]')).toBeVisible();

  await lens.locator('g.acute-lens-node[aria-label="Verify"]').click();
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens).toContainText("L4 Operation");
  await expect(lens.locator('g.acute-lens-node[aria-label="updateStatus"]')).toBeVisible();

  // AC5 (⌫): zooms out one level, same as the breadcrumb.
  await lens.press("Backspace");
  await expect(lens).toContainText("L3 Flow");
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("Webhook Flow");
  await lens.locator('g.acute-lens-node[aria-label="Verify"]').click();
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens).toContainText("L4 Operation");

  // AC7: the level rail never offers what can't happen — L5 isn't linked from here, and isn't clickable.
  const rail = lens.locator(".acute-lens-panel__rail-item");
  await expect(rail.filter({ hasText: "L5 Source" })).toBeDisabled();
  await expect(rail.filter({ hasText: "L4 Operation" })).toHaveAttribute("aria-current", "true");

  // AC5: the breadcrumb returns to an ancestor, with the node drilled through there selected.
  await lens.locator(".acute-lens-panel__crumb").filter({ hasText: "Payments" }).getByRole("button").click();
  await expect(lens).toContainText("L1 Architecture");
  await expect(inspector).toContainText("API"); // the node this whole path was drilled through

  // AC9 / AC10: back to canvas selects the originating element; the scene itself never changed.
  const beforeClose = await elements(page);
  await page.getByRole("button", { name: "Back to canvas" }).click();
  await expect(lens).toBeHidden();
  await expect.poll(() => selectedIds(page)).toEqual([api.containerId]);
  expect(await elements(page)).toEqual(beforeClose);
});

test("AC11: the deep link restores the same level and node after a reload", async ({ page }) => {
  await openApp(page);
  await renderPlan(
    page,
    architecturePlan("Payments", [{ id: "ui", label: "Frontend" }, { id: "api", label: "API" }], [{ from: "ui", to: "api" }]),
    { operationId: "op_deep", title: "L1" },
  );
  await page.getByRole("button", { name: "Accept all" }).click();
  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await lens.locator('g.acute-lens-node[aria-label="Frontend"]').click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain("lens=");

  const hashBefore = await page.evaluate(() => window.location.hash);
  await page.reload();
  await expect(page.getByRole("complementary", { name: /^Lens:/ })).toBeVisible();
  await expect(page.locator(".acute-lens-panel__crumb-current")).toHaveText("Payments");
  await expect(page.locator(".acute-lens-panel__inspector")).toContainText("Frontend");
  expect(await page.evaluate(() => window.location.hash)).toBe(hashBefore);
});

test("AC12: duplicating a node drops its key; renaming it keeps the key", async ({ page }) => {
  await openApp(page);
  await renderPlan(page, architecturePlan("Payments", [{ id: "ui", label: "Frontend" }]), { operationId: "op_identity", title: "L1" });
  await page.getByRole("button", { name: "Accept all" }).click();
  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  const node = (await elements(page)).find((e) => e.text === "Frontend")!;
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await select(page, node.containerId!);
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  await page.getByRole("button", { name: "Close Lens" }).click();

  const assignedKey = (await raw(page, node.containerId!))?.customData?.acuteNode as { key?: string } | undefined;
  expect(assignedKey?.key).toBeTruthy();

  // Renaming the node's label (a separate bound-text element) never touches the shape's own customData: the key survives.
  await page.evaluate((labelId) => {
    type TextEl = { id: string; text?: string; originalText?: string };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElementsIncludingDeleted(): TextEl[]; updateScene(s: unknown): void } } }).__acuteDev.api;
    const scene = api.getSceneElementsIncludingDeleted();
    api.updateScene({ elements: scene.map((e) => (e.id === labelId ? { ...e, text: "Gateway", originalText: "Gateway" } : e)) });
  }, node.id);
  expect(((await raw(page, node.containerId!))?.customData?.acuteNode as { key?: string } | undefined)?.key).toBe(assignedKey!.key);

  // A duplicate must not share the original's identity.
  const before = (await elements(page)).length;
  await page.mouse.click(900, 600); // a neutral point: moves focus off any panel control first
  await select(page, node.containerId!);
  await page.keyboard.press("Control+d");
  await expect.poll(async () => (await elements(page)).length).toBe(before + 2); // the duplicated shape + its own label
  const duplicateShape = (await elements(page)).find((e) => e.text === "Gateway" && e.containerId !== node.containerId)!.containerId;
  expect(((await raw(page, duplicateShape!))?.customData?.acuteNode as { key?: string } | undefined)?.key).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Phase 1B: evidence, the L5 source card, drills into another canvas, chips and Navigator rows
// ---------------------------------------------------------------------------

/** One frame from `architecturePlan`, accepted and switched to "Interactive diagram"; returns the frame id. */
async function interactiveFrame(page: Page, title: string, nodes: { id: string; label: string; kind?: string }[], operationId: string): Promise<string> {
  await renderPlan(page, architecturePlan(title, nodes), { operationId, title });
  await page.getByRole("button", { name: "Accept all" }).click();
  const frame = (await elements(page)).filter((e) => e.type === "frame").at(-1)!;
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await expect.poll(async () => (await raw(page, frame.id))?.customData?.acuteDiagram).toMatchObject({ interactive: true });
  return frame.id;
}

test("AC8: an L4 node's Source opens the L5 source card, with editor links only once known, and back to canvas", async ({ page }) => {
  await openApp(page);
  const frameId = await interactiveFrame(page, "Verify Operation", [{ id: "op", label: "updateStatus" }], "op_l5");
  await select(page, frameId);
  await page.getByLabel("Set level").selectOption({ label: "L4 Operation" });

  // The properties panel's "Source" field: path, lines, role → `acuteNode.sources`, one entry per Add.
  const node = (await elements(page)).find((e) => e.text === "updateStatus")!;
  await select(page, node.containerId!);
  const source = page.getByRole("group", { name: "Source" });
  await source.getByLabel("Source path").fill("src/payment.service.ts");
  await source.getByLabel("Source lines").fill("143-158");
  await source.getByRole("button", { name: "Add source" }).click();
  await source.getByLabel("Source path").fill("src/payment.service.test.ts");
  await source.getByLabel("Source role").selectOption("test");
  await source.getByRole("button", { name: "Add source" }).click();
  await expect
    .poll(async () => ((await raw(page, node.containerId!))?.customData?.acuteNode as { sources?: unknown } | undefined)?.sources)
    .toEqual([{ path: "src/payment.service.ts", lines: [143, 158] }, { path: "src/payment.service.test.ts", role: "test" }]);

  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens).toContainText("L4 Operation");
  const before = await elements(page);

  // The Evidence node action (D16): code grouped by role (D48), the user as its origin, and the canvas object.
  const inspector = lens.locator(".acute-lens-panel__inspector");
  await inspector.getByRole("button", { name: "📄 Evidence" }).click();
  const evidence = inspector.getByRole("region", { name: "Evidence" });
  await expect(evidence.getByRole("group", { name: "Implementation" })).toContainText("src/payment.service.ts");
  await expect(evidence.getByRole("group", { name: "Tests" })).toContainText("src/payment.service.test.ts");
  await expect(evidence).toContainText("from you");
  await expect(evidence.getByRole("button", { name: /Show on canvas/ })).toBeVisible();

  // L5 is reachable now (AC7 stays honest): the rail offers it, and Zoom in opens the source card.
  const rail = lens.locator(".acute-lens-panel__rail-item");
  await expect(rail.filter({ hasText: "L5 Source" })).toBeEnabled();
  await inspector.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens.locator(".acute-lens-panel__level")).toHaveText("L5 Source");
  await expect(rail.filter({ hasText: "L5 Source" })).toHaveAttribute("aria-current", "true");
  const card = lens.getByRole("article", { name: "Source of updateStatus" });
  await expect(card).toContainText("L4 Operation · Verify Operation");
  await expect(card).toContainText("src/payment.service.ts");
  await expect(card).toContainText("lines 143–158");
  await expect(card).toContainText("from you");

  // AC8: "Open in VS Code" / "Open on GitHub" appear only once their targets are known.
  await expect(card.getByRole("link")).toHaveCount(0);
  await card.getByText("Add code links…").click();
  await card.getByLabel("Local repo folder").fill("C:\\src\\shop");
  await card.getByLabel("Repository URL").fill("https://github.com/acme/shop");
  await card.getByRole("button", { name: "Save links" }).click();
  await expect(card.getByRole("link", { name: "Open in VS Code" }).first()).toHaveAttribute("href", "vscode://file/C:/src/shop/src/payment.service.ts:143");
  await expect(card.getByRole("link", { name: "Open on GitHub" }).first()).toHaveAttribute("href", "https://github.com/acme/shop/blob/HEAD/src/payment.service.ts#L143-L158");

  // ⌫ goes back up to L4; Back to canvas from L5 selects the node itself.
  await lens.press("Backspace");
  await expect(lens.locator(".acute-lens-panel__level")).toHaveText("L4 Operation");
  await inspector.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens.locator(".acute-lens-panel__level")).toHaveText("L5 Source");
  await page.getByRole("button", { name: "Back to canvas" }).click();
  await expect(lens).toBeHidden();
  await expect.poll(() => selectedIds(page)).toEqual([node.containerId]);
  // AC10: navigating, the evidence and the code links changed no element.
  expect(await elements(page)).toEqual(before);
});

test("a drill into a frame on a second canvas, and Back to canvas switches to it", async ({ page }) => {
  await openApp(page);
  const home = canvasHome(page);

  // A second canvas with an interactive "API detail" frame, made through the Navigator.
  await page.getByRole("button", { name: "Show workspaces" }).click();
  await page.getByRole("button", { name: "New canvas" }).click();
  await expect.poll(() => canvasHome(page).canvasId).not.toBe(home.canvasId);
  const detailId = canvasHome(page).canvasId;
  await waitForCanvas(page);
  await interactiveFrame(page, "API detail", [{ id: "h", label: "Handler" }], "op_detail");

  // The Navigator's Lens row for this canvas's root frame.
  if (await page.getByRole("button", { name: "Show workspaces" }).isVisible()) await page.getByRole("button", { name: "Show workspaces" }).click();
  await expect(page.getByRole("button", { name: "API detail (Lens, L1)" })).toBeVisible();

  // Back on the first canvas (switched in the Navigator, which saves the one being left), link its API node to
  // that frame ("On other canvases").
  const otherCanvas = page.getByRole("treeitem", { selected: false }).filter({ hasNot: page.getByRole("group") });
  await otherCanvas.getByRole("button").first().click();
  await expect.poll(() => canvasHome(page).canvasId).toBe(home.canvasId);
  await waitForCanvas(page);
  await interactiveFrame(page, "Payments", [{ id: "api", label: "API" }], "op_home");
  const api = (await elements(page)).find((e) => e.text === "API")!;
  await select(page, api.containerId!);
  await page.getByRole("button", { name: "Link to detail frame…" }).click();
  const menu = page.getByRole("menu", { name: "Link to detail frame" });
  await menu.getByRole("menuitem", { name: /API detail/ }).click();
  await expect
    .poll(async () => ((await raw(page, api.containerId!))?.customData?.acuteNode as { expandsTo?: unknown } | undefined)?.expandsTo)
    .toMatchObject({ canvasId: detailId });

  // Lens drills into the other canvas's frame without opening it (the canvas area doesn't change).
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  const inspector = lens.locator(".acute-lens-panel__inspector");
  await inspector.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("API detail");
  await expect(lens).toContainText("L2 Component");
  await lens.locator('g.acute-lens-node[aria-label="Handler"]').click();
  expect(canvasHome(page).canvasId).toBe(home.canvasId);

  // The breadcrumb still returns to the first canvas's level.
  await lens.locator(".acute-lens-panel__crumb").filter({ hasText: "Payments" }).getByRole("button").click();
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("Payments");
  await inspector.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await lens.locator('g.acute-lens-node[aria-label="Handler"]').click();

  // AC9: Back to canvas switches to the second canvas and selects Handler there.
  await page.getByRole("button", { name: "Back to canvas" }).click();
  await expect.poll(() => canvasHome(page).canvasId).toBe(detailId);
  await waitForCanvas(page);
  await expect
    .poll(async () => {
      const handler = (await elements(page)).find((e) => e.text === "Handler");
      return !!handler && (await selectedIds(page)).includes(handler.containerId!);
    })
    .toBe(true);
});

test("frame chips: ✨ L-level on interactive frames, a dim ✨ on viz-ready ones that opens Lens in one step", async ({ page }) => {
  await openApp(page);
  // Three nodes and two arrows in a plain (sectioned, not interactive) frame: viz-ready.
  await renderPlan(
    page,
    {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g", type: "group", content: { label: "Checkout", arrangement: "tree" } },
        ...["Cart", "Pay", "Ship"].map((label) => ({ id: label, type: "shape", parent: "g", content: { shape: "rectangle", label } })),
      ],
      relationships: [
        { from: "Cart", to: "Pay", type: "flows_to" },
        { from: "Pay", to: "Ship", type: "flows_to" },
      ],
    },
    { operationId: "op_chip", title: "Checkout" },
  );
  await page.getByRole("button", { name: "Accept all" }).click();
  const frame = (await elements(page)).find((e) => e.type === "frame")!;

  const ready = page.getByRole("button", { name: "Make Checkout interactive and open in Lens" });
  await expect(ready).toBeVisible();
  await ready.click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens).toContainText("L1 Architecture");
  expect((await raw(page, frame.id))?.customData?.acuteDiagram).toMatchObject({ interactive: true });

  await page.getByRole("button", { name: "Close Lens" }).click();
  const chip = page.getByRole("button", { name: "Open Checkout in Lens" });
  await expect(chip).toHaveText("✨ L1");
  await chip.click();
  await expect(lens).toBeVisible();
});

test("AC11: a two-level deep link (node keys contain dots) and sources survive a reload; a dead step is dropped; closing clears it", async ({ page }) => {
  await openApp(page);
  const parent = await interactiveFrame(page, "Payments", [{ id: "api", label: "API" }], "op_deep2_l1");
  await interactiveFrame(page, "Payment Service", [{ id: "hook", label: "Webhook" }], "op_deep2_l2");
  const apiNode = (await elements(page)).find((e) => e.text === "API")!;
  await select(page, apiNode.containerId!);
  await page.getByRole("button", { name: "Link to detail frame…" }).click();
  await page.getByRole("menu", { name: "Link to detail frame" }).getByRole("menuitem", { name: "Payment Service" }).click();
  const hook = (await elements(page)).find((e) => e.text === "Webhook")!;
  await select(page, hook.containerId!);
  const source = page.getByRole("group", { name: "Source" });
  await source.getByLabel("Source path").fill("src/webhook.ts");
  await source.getByRole("button", { name: "Add source" }).click();

  await select(page, apiNode.containerId!);
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await lens.locator(".acute-lens-panel__inspector").getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment Service");
  await lens.locator('g.acute-lens-node[aria-label="Webhook"]').click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain("node=");
  const hashBefore = await page.evaluate(() => window.location.hash);
  // The API node's key is "<frame>.api": the path step itself holds a dot.
  expect(decodeURIComponent(hashBefore)).toMatch(/path=[^&]*\.api/);

  await page.reload();
  const restored = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(restored.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment Service");
  await expect(restored).toContainText("L2 Component");
  await restored.locator(".acute-lens-panel__inspector").getByRole("button", { name: "📄 Evidence" }).click();
  await expect(restored.getByRole("region", { name: "Evidence" })).toContainText("src/webhook.ts");
  expect(await page.evaluate(() => window.location.hash)).toBe(hashBefore);

  // A deep link whose step no longer resolves opens at the level it can reach and drops the dead step.
  await page.evaluate((frameId) => {
    window.location.hash = `#lens=${encodeURIComponent(frameId)}&path=gone.node`;
  }, parent);
  await page.reload();
  const reopened = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(reopened.locator(".acute-lens-panel__crumb-current")).toHaveText("Payments");
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toContain("path=");
  // ...so the next drill works instead of appending after the dead key.
  await reopened.locator('g.acute-lens-node[aria-label="API"]').click();
  await reopened.locator(".acute-lens-panel__inspector").getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(reopened.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment Service");

  // Closing Lens clears the deep link, so a reload doesn't reopen it.
  await page.getByRole("button", { name: "Close Lens" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  await page.reload();
  await waitForCanvas(page);
  await expect(page.getByRole("complementary", { name: /^Lens:/ })).toHaveCount(0);
});
