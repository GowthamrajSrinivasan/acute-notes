/**
 * F33 preview: a pasted ```mermaid fence stays a Mermaid code block and is
 * shown as its diagram on the canvas; a source that doesn't parse shows its
 * code with a note instead of an error graphic.
 */
import { expect, test } from "@playwright/test";
import { documentOf, elements, openApp, pasteText, shapeByLabel } from "../helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a pasted Mermaid block previews as its diagram", async ({ page }) => {
  await openApp(page);
  const id = await pasteText(page, "```mermaid\nflowchart LR\n  A[Paste] --> B{Valid?}\n  B -->|yes| C[Diagram]\n  B -->|no| A\n```", { x: 700, y: 450 });

  const block = page.locator(`.acute-block[data-element-id="${id}"]`);
  const diagram = block.locator(".acute-preview__mermaid svg");
  await expect(diagram).toBeVisible();
  await expect(block.locator(".acute-preview__mermaid")).toContainText("Diagram");

  const documentId = await page.evaluate(
    (elementId) =>
      (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[] } } }).__acuteDev.api
        .getSceneElements()
        .find((el) => el.id === elementId)?.customData?.acute?.documentId,
    id,
  );
  const doc = await documentOf(page, documentId!);
  expect(doc!.snapshot.find((b) => b.type === "codeBlock")?.props?.language).toBe("mermaid");

  if (process.env.ACUTE_SHOT) await block.screenshot({ path: process.env.ACUTE_SHOT });
});

test("Visualize turns a Mermaid diagram into native shapes and flows_to arrows, with no AI", async ({ page }) => {
  await openApp(page);
  const before = new Set((await elements(page)).map((e) => e.id));
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill("```mermaid\nflowchart LR\n  A[Paste] --> B{Valid?}\n  B -->|yes| C[Diagram]\n  B -->|no| A\n```\n");
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Accept all" }).click();

  const added = (await elements(page)).filter((e) => !before.has(e.id));
  expect(added.filter((e) => e.type === "rectangle").length).toBe(2);
  expect(added.filter((e) => e.type === "diamond").length).toBe(1);
  const arrows = added.filter((e) => e.type === "arrow");
  expect(arrows).toHaveLength(3);
  expect(arrows.every((a) => a.relation === "flows_to")).toBe(true);
  for (const label of ["Paste", "Valid?", "Diagram"]) await shapeByLabel(page, label);
});

async function visualize(page: import("@playwright/test").Page, source: string) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill(source);
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Accept all" }).click();
}

test("Visualize turns a Mermaid class diagram into member cards and typed arrows, with no AI", async ({ page }) => {
  await openApp(page);
  const before = new Set((await elements(page)).map((e) => e.id));
  await visualize(
    page,
    ["```mermaid", "classDiagram", "  Animal <|-- Duck", "  Animal : +int age", "  class Duck {", "    +swim()", "  }", "  Duck ..> Food", "  Pond o-- Duck", "```", ""].join("\n"),
  );

  const added = (await elements(page)).filter((e) => !before.has(e.id));
  expect(added.filter((e) => e.acute?.blockType === "text")).toHaveLength(2);
  const arrows = added.filter((e) => e.type === "arrow");
  expect(arrows.map((a) => a.relation).sort()).toEqual(["depends_on", "implements", "relates_to"]);
  for (const label of ["Food", "Pond"]) await shapeByLabel(page, label);
  if (process.env.ACUTE_SHOT) await page.screenshot({ path: process.env.ACUTE_SHOT.replace(/\.png$/, "-class.png") });
});

test("Visualize turns a Mermaid ER diagram into table cards, with no AI", async ({ page }) => {
  await openApp(page);
  const before = new Set((await elements(page)).map((e) => e.id));
  await visualize(
    page,
    ["```mermaid", "erDiagram", "  CUSTOMER ||--o{ ORDER : places", "  CUSTOMER {", "    string name", "    string id PK", "  }", "  ORDER {", "    int number PK", "  }", "```", ""].join("\n"),
  );

  const added = (await elements(page)).filter((e) => !before.has(e.id));
  expect(added.filter((e) => e.acute?.blockType === "table")).toHaveLength(2);
  const arrows = added.filter((e) => e.type === "arrow");
  expect(arrows).toHaveLength(1);
  expect(arrows[0]!.relation).toBe("relates_to");
  if (process.env.ACUTE_SHOT) await page.screenshot({ path: process.env.ACUTE_SHOT.replace(/\.png$/, "-er.png") });
});

test("a Mermaid block that doesn't parse shows its source and a note", async ({ page }) => {
  await openApp(page);
  const id = await pasteText(page, "```mermaid\nflowchart LR\n  A --> (\n```", { x: 700, y: 450 });
  const block = page.locator(`.acute-block[data-element-id="${id}"]`);
  await expect(block.locator(".acute-preview__mermaid-note")).toBeVisible();
  await expect(block.locator(".acute-preview__code")).toContainText("A --> (");
  await expect(page.locator("body > [id^='dacute-mermaid']")).toHaveCount(0);
});
