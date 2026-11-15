/**
 * Diagram shapes (composite shapes: cylinder, hexagon, parallelogram, trapezoid, document, predefined process) in the
 * real app: drawn from native parts, each still behaves like one shape. For the cylinder in depth: one double-click
 * edits its label; a side handle stretches it in one direction without scaling the label; its rim keeps a sensible
 * height; rotating turns the whole outline; each of those is one undo step; the panel's Shape section sets its colours;
 * a copy gets an outline of its own. Then every shape from the Add block menu, and from a visual plan (the AI's and
 * Mermaid's path).
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp, undo } from "../helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

type Point = { x: number; y: number };
interface Shape {
  id: string;
  kind: string;
  group: string;
  box: { x: number; y: number; width: number; height: number };
  angle: number;
  hostStroke: string;
  hostFill: string;
  label?: string;
  fontSize?: number;
  parts: { part: string; angle: number; width: number; height: number; y: number; strokeColor: string }[];
  /** Viewport points: centre, the bottom-edge handle, the rotation handle. */
  at: { center: Point; bottom: Point; rotate: Point };
}

/** Every live composite shape on the canvas (hosts in scene order), with its parts and label. */
function shapes(page: Page): Promise<Shape[]> {
  return page.evaluate(() => {
    type El = {
      id: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      angle: number;
      groupIds: string[];
      strokeColor: string;
      backgroundColor: string;
      text?: string;
      fontSize?: number;
      containerId?: string | null;
      customData?: { acuteShape?: string; acuteShapePart?: string };
    };
    type AppState = { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[]; getAppState(): AppState } } }).__acuteDev.api;
    const s = api.getAppState();
    const toView = (x: number, y: number) => ({ x: (x + s.scrollX) * s.zoom.value + s.offsetLeft, y: (y + s.scrollY) * s.zoom.value + s.offsetTop });
    const els = api.getSceneElements();
    return els
      .filter((el) => el.type === "rectangle" && !!el.customData?.acuteShape)
      .map((h) => {
        const label = els.find((t) => t.type === "text" && t.containerId === h.id);
        return {
          id: h.id,
          kind: h.customData!.acuteShape!,
          group: h.groupIds[0]!,
          box: { x: h.x, y: h.y, width: h.width, height: h.height },
          angle: h.angle,
          hostStroke: h.strokeColor,
          hostFill: h.backgroundColor,
          ...(label ? { label: label.text, fontSize: label.fontSize } : {}),
          parts: els
            .filter((p) => p.customData?.acuteShapePart && p.groupIds[0] === h.groupIds[0])
            .map((p) => ({ part: p.customData!.acuteShapePart!, angle: p.angle, width: p.width, height: p.height, y: p.y - h.y, strokeColor: p.strokeColor })),
          at: {
            center: toView(h.x + h.width / 2, h.y + h.height / 2),
            bottom: toView(h.x + h.width / 2, h.y + h.height),
            rotate: toView(h.x + h.width / 2, h.y),
          },
        };
      });
  });
}

async function only(page: Page): Promise<Shape> {
  const all = await shapes(page);
  expect(all).toHaveLength(1);
  return all[0]!;
}

function selection(page: Page): Promise<{ ids: string[]; groups: string[] }> {
  return page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { getAppState(): { selectedElementIds: Record<string, true>; selectedGroupIds: Record<string, boolean> } } } })
      .__acuteDev.api;
    const s = api.getAppState();
    return { ids: Object.keys(s.selectedElementIds), groups: Object.keys(s.selectedGroupIds).filter((g) => s.selectedGroupIds[g]) };
  });
}

async function drag(page: Page, from: Point, by: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + (by.x * i) / 6, from.y + (by.y * i) / 6);
  await page.mouse.up();
}

/** The lines each shape is drawn with (the rest are a body alone). */
const PARTS: Record<string, string[]> = { cylinder: ["body", "rim"], subroutine: ["body", "left", "right"] };

/** The outline is where the host says: parts span its box, at its angle. */
function expectConsistent(c: Shape): void {
  expect(c.parts.map((p) => p.part).sort()).toEqual([...(PARTS[c.kind] ?? ["body"])].sort());
  const body = c.parts.find((p) => p.part === "body")!;
  expect(body.width).toBeCloseTo(c.box.width, 0);
  expect(body.height).toBeCloseTo(c.box.height, 0);
  for (const p of c.parts) expect(p.angle).toBeCloseTo(c.angle, 3);
  expect(c.hostStroke).toBe("transparent");
  expect(c.hostFill).toBe("transparent");
}

/** `count` shapes, each in a group of its own with all its parts drawn. */
function settled(all: Shape[], count: number): boolean {
  return all.length === count && new Set(all.map((s) => s.group)).size === count && all.every((s) => s.parts.length === (PARTS[s.kind] ?? ["body"]).length);
}

test("cylinder: insert, label, stretch, rotate, recolour, copy", async ({ page }) => {
  await openApp(page);
  // A clean canvas at 100 %, so the pointer targets below are the cylinder's.
  await page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void; getSceneElementsIncludingDeleted(): object[] } } }).__acuteDev.api;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((el) => ({ ...el, isDeleted: true })),
      appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0, selectedElementIds: {} },
    });
  });

  // Insert from the Add block menu: one shape, its host selected alone.
  await page.getByTestId("toolbar-acute-block").click({ force: true });
  await page.getByRole("menuitem", { name: "Cylinder (database)" }).click();
  let c = await only(page);
  expectConsistent(c);
  expect(await selection(page)).toEqual({ ids: [c.id], groups: [] });

  // One double-click edits its label.
  await page.mouse.dblclick(c.at.center.x, c.at.center.y);
  await page.keyboard.type("Orders DB");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await only(page)).label).toBe("Orders DB");
  c = await only(page);
  const font = c.fontSize!;

  // Clicking its outline selects the shape as one: the host alone once the click is done.
  await page.mouse.click(1200, 700);
  await page.mouse.click(c.at.center.x, c.at.center.y + 30);
  await expect.poll(async () => selection(page)).toEqual({ ids: [c.id], groups: [] });

  // The bottom handle stretches the height only; the label keeps its size; the rim doesn't stretch.
  const before = c.box;
  await drag(page, { x: c.at.bottom.x, y: c.at.bottom.y + 5 }, { x: 0, y: 150 });
  await expect.poll(async () => Math.round((await only(page)).box.height)).toBeGreaterThan(before.height + 100);
  c = await only(page);
  expect(c.box.width).toBeCloseTo(before.width, 0);
  expect(c.fontSize).toBe(font);
  expectConsistent(c);
  expect(c.parts.find((p) => p.part === "rim")!.height).toBeLessThanOrEqual(18);

  // One undo step puts it back, outline and all.
  await undo(page);
  await expect.poll(async () => Math.round((await only(page)).box.height)).toBe(Math.round(before.height));
  expectConsistent(await only(page));

  // Rotating turns the whole outline.
  c = await only(page);
  await page.mouse.click(c.at.center.x, c.at.center.y);
  await drag(page, { x: c.at.rotate.x, y: c.at.rotate.y - 18 }, { x: 150, y: 60 });
  await expect.poll(async () => (await only(page)).angle).toBeGreaterThan(0.3);
  expectConsistent(await only(page));
  await undo(page);
  await expect.poll(async () => (await only(page)).angle).toBe(0);
  expectConsistent(await only(page));

  // The panel's Shape section sets its colours (Excalidraw's own pickers are hidden for it).
  c = await only(page);
  await page.mouse.click(c.at.center.x, c.at.center.y);
  const section = page.getByTestId("acute-shape-section");
  await expect(section).toBeVisible();
  await expect(page.locator('.App-menu__left [data-acute-section="stroke"]')).toBeHidden();
  await section.getByRole("button", { name: "Stroke #e03131" }).click();
  await section.getByRole("button", { name: "Background #ffec99" }).click();
  await expect.poll(async () => (await only(page)).parts.map((p) => p.strokeColor)).toEqual(["#e03131", "#e03131"]);
  await expect(section.getByRole("button", { name: "Stroke #e03131" })).toHaveAttribute("aria-pressed", "true");
  expectConsistent(await only(page));

  // A copy (duplicate, then paste) gets an outline of its own, in the same colours. (Back on the canvas first: the
  // swatch just clicked has the keyboard focus.)
  c = await only(page);
  await page.mouse.click(c.at.center.x, c.at.center.y);
  await page.keyboard.press("Control+d");
  // A new host shows up before the canvas has given it a group and an outline of its own (a fix-up just after the
  // change), so wait for that, not only for the host: reading it earlier is what made this step flaky under load.
  await expect.poll(async () => settled(await shapes(page), 2)).toBe(true);
  await page.keyboard.press("Control+c");
  await page.mouse.move(900, 600);
  await page.keyboard.press("Control+v");
  await expect.poll(async () => settled(await shapes(page), 3)).toBe(true);
  const copies = await shapes(page);
  expect(new Set(copies.map((x) => x.group)).size).toBe(3);
  for (const copy of copies) {
    expectConsistent(copy);
    expect(copy.parts.every((p) => p.strokeColor === "#e03131")).toBe(true);
  }

  // Deleting one takes its outline with it.
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  const parts = await page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): { customData?: { acuteShapePart?: string } }[] } } }).__acuteDev.api;
    return api.getSceneElements().filter((el) => el.customData?.acuteShapePart).length;
  });
  expect(parts).toBe(4);
});

test("cylinder: a visual plan draws one, labelled and connected", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "architecture",
        nodes: [
          { id: "api", type: "shape", content: { shape: "rectangle", label: "API" } },
          { id: "db", type: "shape", content: { shape: "cylinder", label: "Orders DB" } },
        ],
        relationships: [{ from: "api", to: "db", type: "depends_on" }],
      },
      { operationId: "op_cylinder", title: "Cylinder", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const c = await only(page);
  expect(c.label).toBe("Orders DB");
  expectConsistent(c);
  const bound = await page.evaluate((id) => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): { type: string; endBinding?: { elementId: string } | null }[] } } }).__acuteDev.api;
    return api.getSceneElements().filter((el) => el.type === "arrow" && el.endBinding?.elementId === id).length;
  }, c.id);
  expect(bound).toBe(1);
});

test("cylinder: Ungroup keeps each shape whole, labelled and connected (master plan L4)", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "architecture",
        nodes: [
          { id: "orders", type: "shape", content: { shape: "cylinder", label: "Orders DB" } },
          { id: "ledger", type: "shape", content: { shape: "cylinder", label: "Ledger DB" } },
        ],
        relationships: [{ from: "orders", to: "ledger", type: "depends_on" }],
      },
      { operationId: "op_ungroup", title: "Ungroup", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();
  const before = await shapes(page);
  expect(before).toHaveLength(2);

  // Select both shapes' groups (not one shape alone, which the canvas turns into its host) and Ungroup. A click on
  // empty canvas first gives the canvas the keyboard (the review bar had it).
  await page.mouse.click(1300, 820);
  await page.evaluate((groups) => {
    type El = { id: string; groupIds: string[] };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[]; updateScene(s: unknown): void } } }).__acuteDev.api;
    const ids = api.getSceneElements().filter((el) => groups.includes(el.groupIds[0] ?? ""));
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(ids.map((el) => [el.id, true])), selectedGroupIds: Object.fromEntries(groups.map((g) => [g, true])), editingGroupId: null } });
  }, before.map((s) => s.group));
  await page.keyboard.press("Control+Shift+G");

  // Still two shapes, each one group again (a new one) with its outline, its label and its connector.
  await expect
    .poll(async () => {
      const now = await shapes(page);
      return now.length === 2 && now.every((s) => !before.some((b) => b.group === s.group) && s.parts.length === 2);
    })
    .toBe(true);
  const after = await shapes(page);
  expect(after.map((s) => s.label).sort()).toEqual(["Ledger DB", "Orders DB"]);
  expect(new Set(after.map((s) => s.group)).size).toBe(2);
  for (const s of after) expectConsistent(s);
  const loose = await page.evaluate(() => {
    type El = { type: string; groupIds: string[]; customData?: { acuteShapePart?: string }; endBinding?: { elementId: string } | null; startBinding?: { elementId: string } | null };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    const els = api.getSceneElements();
    return { parts: els.filter((el) => el.customData?.acuteShapePart).length, ungrouped: els.filter((el) => el.customData?.acuteShapePart && !el.groupIds.length).length, bound: els.filter((el) => el.type === "arrow" && el.startBinding && el.endBinding).length };
  });
  expect(loose).toEqual({ parts: 4, ungrouped: 0, bound: 1 });
});

const MENU: [string, string][] = [
  ["cylinder", "Cylinder (database)"],
  ["hexagon", "Hexagon (preparation)"],
  ["parallelogram", "Parallelogram (input / output)"],
  ["trapezoid", "Trapezoid (manual step)"],
  ["document", "Document"],
  ["subroutine", "Predefined process"],
];

test("every diagram shape inserts from the menu, and stretches like one shape", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void; getSceneElementsIncludingDeleted(): object[] } } }).__acuteDev.api;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((el) => ({ ...el, isDeleted: true })),
      appState: { zoom: { value: 0.6 }, scrollX: 0, scrollY: 0, selectedElementIds: {} },
    });
  });

  for (const [i, [, label]] of MENU.entries()) {
    // A shape goes in at the viewport centre: scroll first so each lands in its own place on a 3 × 2 grid.
    await page.evaluate(
      ({ scrollX, scrollY }) =>
        (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void } } }).__acuteDev.api.updateScene({ appState: { scrollX, scrollY } }),
      { scrollX: 300 - (i % 3) * 300, scrollY: 110 - Math.floor(i / 3) * 220 },
    );
    await page.getByTestId("toolbar-acute-block").click({ force: true });
    await page.getByRole("menuitem", { name: label }).click();
    await expect.poll(async () => (await shapes(page)).length).toBe(i + 1);
  }
  await expect.poll(async () => (await shapes(page)).map((s) => s.kind)).toEqual(MENU.map(([kind]) => kind));
  for (const s of await shapes(page)) expectConsistent(s);
  // Back to where the grid is in view.
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void } } }).__acuteDev.api.updateScene({ appState: { scrollX: 0, scrollY: 0 } }),
  );
  await page.screenshot({ path: test.info().outputPath("all-shapes.png") });

  // A hexagon stretches in one direction, its points staying the same size.
  const hexagon = (await shapes(page)).find((s) => s.kind === "hexagon")!;
  await page.mouse.click(1300, 850);
  await page.mouse.click(hexagon.at.center.x, hexagon.at.center.y);
  await expect.poll(async () => selection(page)).toEqual({ ids: [hexagon.id], groups: [] });
  await drag(page, { x: hexagon.at.bottom.x, y: hexagon.at.bottom.y + 5 }, { x: 0, y: 90 });
  await expect.poll(async () => (await shapes(page)).find((s) => s.id === hexagon.id)!.box.height).toBeGreaterThan(hexagon.box.height + 60);
  const stretched = (await shapes(page)).find((s) => s.id === hexagon.id)!;
  expect(stretched.box.width).toBeCloseTo(hexagon.box.width, 0);
  expectConsistent(stretched);
});

test("a visual plan draws every diagram shape, with review ghosts first", async ({ page }) => {
  await openApp(page);
  await page.evaluate(
    (kinds) =>
      (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
        {
          version: 1,
          template: "flow",
          nodes: kinds.map((kind, i) => ({ id: `n${i}`, type: "shape", content: { shape: kind, label: `A ${kind}` } })),
          relationships: kinds.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}`, type: "flows_to" })),
        },
        { operationId: "op_shapes", title: "Shapes", metadata: { createdBy: "import" } },
      ),
    MENU.map(([kind]) => kind),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toBeVisible();
  // Each diagram shape previews as its own outline (a filled body polygon), not as a box.
  await expect(page.locator(".acute-review-ghost polygon")).toHaveCount(MENU.length);
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const drawn = await shapes(page);
  expect(drawn.map((s) => s.kind).sort()).toEqual(MENU.map(([kind]) => kind).sort());
  for (const s of drawn) {
    expect(s.label).toBe(`A ${s.kind}`);
    expectConsistent(s);
  }
});
