/**
 * F23 in the real app: a typed arrow's relation survives its ends moving, is
 * copied with a duplicated sub-diagram (the copy connects the copies), is not
 * copied onto an arrow duplicated on its own, and goes away with an endpoint.
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, select, shapeByLabel } from "../helpers";

type Arrow = { id: string; from?: string; to?: string; relation?: string };

function arrows(p: Page): Promise<Arrow[]> {
  return p.evaluate(() => {
    type El = { id: string; type: string; isDeleted?: boolean; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null; customData?: { acuteRelation?: string } };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    return api
      .getSceneElements()
      .filter((e) => e.type === "arrow")
      .map((e) => ({ id: e.id, from: e.startBinding?.elementId, to: e.endBinding?.elementId, relation: e.customData?.acuteRelation }));
  });
}

test("typed relations through move, duplicate and delete", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "flow",
        nodes: [
          { id: "a", type: "shape", content: { shape: "rectangle", label: "Service" } },
          { id: "b", type: "shape", content: { shape: "rectangle", label: "Database" } },
        ],
        relationships: [{ from: "a", to: "b", type: "depends_on" }],
      },
      { operationId: "op_rel", title: "Relations", metadata: { createdBy: "import" } },
    ),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  const service = await shapeByLabel(page, "Service");
  const database = await shapeByLabel(page, "Database");
  const [original] = await arrows(page);
  expect(original).toMatchObject({ from: service.id, to: database.id, relation: "depends_on" });

  // Excalidraw's own shortcuts need focus in the canvas: click an empty spot first.
  const focusCanvas = () => page.mouse.click(1300, 820);
  await focusCanvas();

  // Moving an end keeps the relation (it lives on the arrow's bindings, not its geometry).
  await select(page, database.id);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await shapeByLabel(page, "Database")).y).toBeGreaterThan(database.y);
  expect((await arrows(page)).find((a) => a.id === original!.id)).toMatchObject({ from: service.id, to: database.id, relation: "depends_on" });

  // Duplicating the whole sub-diagram: the copied arrow connects the copies, with the same type.
  await select(page, service.id, database.id, original!.id);
  await page.keyboard.press("ControlOrMeta+D");
  await expect.poll(async () => (await arrows(page)).length).toBe(2);
  const copy = (await arrows(page)).find((a) => a.id !== original!.id)!;
  expect(copy.relation).toBe("depends_on");
  expect([copy.from, copy.to]).not.toContain(service.id);
  expect([copy.from, copy.to]).not.toContain(database.id);
  expect(copy.from && copy.to).toBeTruthy();

  // Duplicating the arrow on its own gives an untyped arrow.
  await focusCanvas();
  await select(page, original!.id);
  await page.keyboard.press("ControlOrMeta+D");
  await expect.poll(async () => (await arrows(page)).length).toBe(3);
  const lone = (await arrows(page)).find((a) => a.id !== original!.id && a.id !== copy.id)!;
  expect(lone.relation).toBeUndefined();

  // Deleting an end removes the relation with it: no typed arrow is left pointing at nothing.
  await focusCanvas();
  await select(page, database.id);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await elements(page)).some((e) => e.id === database.id)).toBe(false);
  const typedToDeleted = (await arrows(page)).filter((a) => a.relation && (a.from === database.id || a.to === database.id));
  expect(typedToDeleted).toEqual([]);
});
