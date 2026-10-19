/**
 * Acute Lens, Phase 6 (plan: .ai/docs/acute-lens-plan.md §3.6, §9): the Project profile by hand — a project frame,
 * a decision with options and a choice, a finding promoted to a decision, the lanes in Lens, all surviving a reload —
 * and D59's key invariant: "Move to canvas…" keeps a node's key so a decision's `refs` to it still resolve, while a
 * delete of a referenced node says so.
 */
import { expect, test, type Page } from "@playwright/test";
import { canvasHome, elements, openApp, select, waitForCanvas } from "../helpers";

type Raw = { id: string; customData?: Record<string, unknown> };
type AcuteNode = { kind?: string; key?: string; status?: string; chosen?: string; stage?: string; refs?: string[]; options?: { label: string }[]; project?: string };

function scene(page: Page): Promise<Raw[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): Raw[] } } }).__acuteDev.api;
    return api.getSceneElements().map((e) => ({ id: e.id, customData: e.customData }));
  });
}
const nodeOf = (r: Raw | undefined) => r?.customData?.acuteNode as AcuteNode | undefined;
async function node(page: Page, id: string): Promise<AcuteNode | undefined> {
  return nodeOf((await scene(page)).find((e) => e.id === id));
}
async function byKind(page: Page, kind: string): Promise<Raw[]> {
  return (await scene(page)).filter((e) => nodeOf(e)?.kind === kind);
}

type AcuteDevApi = { renderPlan(plan: unknown, p: unknown): Promise<unknown> };
async function interactiveFrame(page: Page, title: string, labels: string[], operationId: string): Promise<string> {
  const plan = {
    version: 1,
    template: "architecture",
    metadata: { title },
    nodes: labels.map((label, i) => ({ id: `n${i}`, type: "shape", content: { shape: "rectangle", label, kind: "backend" } })),
    relationships: [],
  };
  const meta = { operationId, title, metadata: { createdBy: "import" } };
  await page.evaluate(([p, m]) => (window as unknown as { __acuteDev: AcuteDevApi }).__acuteDev.renderPlan(p, m), [plan, meta] as const);
  await page.getByRole("button", { name: "Accept all" }).click();
  const frame = (await elements(page)).filter((e) => e.type === "frame").at(-1)!;
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  return frame.id;
}

/** "Add to project…" on the frame; returns the new node's id (the command selects it). */
async function addToProject(page: Page, frameId: string, label: string): Promise<string> {
  const kind = label.toLowerCase().replace(/ /g, "_");
  const before = (await byKind(page, kind)).length;
  await select(page, frameId);
  await page.getByRole("button", { name: "Add to project…" }).click();
  await page.getByRole("menu", { name: "Add to project" }).getByRole("menuitem", { name: label, exact: true }).click();
  await expect.poll(async () => (await byKind(page, kind)).length).toBe(before + 1);
  return (await byKind(page, kind)).at(-1)!.id;
}

/** Switches canvas through the Navigator (the other, unselected canvas row). */
async function switchCanvas(page: Page, to: string): Promise<void> {
  if (await page.getByRole("button", { name: "Show workspaces" }).isVisible()) await page.getByRole("button", { name: "Show workspaces" }).click();
  await page.getByRole("treeitem", { selected: false }).filter({ hasNot: page.getByRole("group") }).getByRole("button").first().click();
  await expect.poll(() => canvasHome(page).canvasId).toBe(to);
  await waitForCanvas(page);
}

test("Project profile by hand: a decision with options, Choose, Promote a finding, the lanes in Lens, and a reload", async ({ page }) => {
  await openApp(page);
  const frameId = await interactiveFrame(page, "Acme API", ["Notes"], "op_project");
  await page.getByLabel("Lens profile").selectOption("project");
  await expect.poll(async () => (await scene(page)).find((e) => e.id === frameId)?.customData?.acuteDiagram).toMatchObject({ profile: "project" });

  // A project node first: everything added after it is scoped to its key (D39).
  const projectId = await addToProject(page, frameId, "Project");
  const projectKey = (await node(page, projectId))!.key!;
  const focus = page.getByLabel("Focus", { exact: true });
  await focus.fill("Token rotation");
  await focus.press("Enter");
  await expect.poll(async () => (await node(page, projectId)) as Record<string, unknown>).toMatchObject({ focus: "Token rotation" });

  // A decision with two options (D34), then Choose one: it becomes accepted with that choice.
  const decisionId = await addToProject(page, frameId, "Decision");
  const options = page.getByRole("group", { name: "Options" });
  for (const label of ["Redis", "Postgres"]) {
    await options.getByLabel("Option label").fill(label);
    await options.getByRole("button", { name: "Add option" }).click();
  }
  await expect.poll(async () => (await node(page, decisionId))?.options?.map((o) => o.label)).toEqual(["Redis", "Postgres"]);
  await expect(page.getByRole("button", { name: "Accept decision" })).toBeDisabled(); // an open negotiation needs a choice first
  await options.getByRole("button", { name: "Choose Redis" }).click();
  await expect.poll(() => node(page, decisionId)).toMatchObject({ kind: "decision", status: "accepted", chosen: "Redis", project: projectKey });

  // A finding: Mark validated, then Promote to decision — the same node, same key (D33).
  const findingId = await addToProject(page, frameId, "Finding");
  const findingKey = (await node(page, findingId))!.key;
  await page.getByRole("button", { name: "Mark validated" }).click();
  await expect.poll(async () => (await node(page, findingId))?.stage).toBe("validated");
  await page.getByRole("button", { name: "Promote to decision" }).click();
  await expect.poll(() => node(page, findingId)).toMatchObject({ kind: "decision", status: "proposed", key: findingKey });

  // Lens: the project frame opens in its lanes, under the project banner with its focus, and each card's badge.
  await select(page, frameId);
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens).toContainText("L1 Lanes");
  await expect(lens.getByRole("group", { name: "Decisions lane" })).toContainText("Decisions · 2");
  await expect(lens.locator('g.acute-lens-node[data-kind="project"]')).toContainText("Focus: Token rotation");
  const chosen = lens.locator('g.acute-lens-node[data-kind="decision"]').filter({ hasText: "✓ Redis" });
  await expect(chosen).toHaveCount(1);

  // The Lens inspector shows the decision's options and choice.
  await chosen.click();
  const inspector = lens.getByRole("region", { name: "Project" });
  await expect(inspector.getByRole("group", { name: "Options" })).toContainText("Postgres");
  await expect(inspector.getByRole("group", { name: "Options" })).toContainText("chosen");

  // Reload: every field survives (they live in the canvas, D2).
  await page.getByRole("button", { name: "Close Lens" }).click();
  await page.reload();
  await waitForCanvas(page);
  await expect.poll(() => node(page, decisionId)).toMatchObject({ status: "accepted", chosen: "Redis" });
  expect(await node(page, findingId)).toMatchObject({ kind: "decision", key: findingKey });
  expect(await node(page, projectId)).toMatchObject({ kind: "project", key: projectKey });
});

test("D59: Move to canvas keeps a node's key, so a decision's ref to it still resolves; deleting a referenced node says so", async ({ page }) => {
  await openApp(page);
  const home = canvasHome(page);

  // A second canvas to move to, then back to the first.
  await page.getByRole("button", { name: "Show workspaces" }).click();
  await page.getByRole("button", { name: "New canvas" }).click();
  await expect.poll(() => canvasHome(page).canvasId).not.toBe(home.canvasId);
  const otherId = canvasHome(page).canvasId;
  await waitForCanvas(page);
  await switchCanvas(page, home.canvasId);

  // Architecture node A ("Cache") and a decision B whose refs name A (picked with "Link to node…").
  await interactiveFrame(page, "Architecture", ["Cache", "Queue"], "op_arch");
  const projectFrame = await interactiveFrame(page, "Project state", ["Notes"], "op_state");
  await page.getByLabel("Lens profile").selectOption("project");
  const decisionId = await addToProject(page, projectFrame, "Decision");
  await page.getByRole("group", { name: "References" }).getByRole("button", { name: "Link to node…" }).click();
  await page.getByRole("menu", { name: "Link to node" }).getByRole("menuitem", { name: /^Cache/ }).click();
  const cacheId = (await elements(page)).find((e) => e.text === "Cache")!.containerId!;
  await expect.poll(async () => (await node(page, cacheId))?.key).toBeTruthy();
  const key = (await node(page, cacheId))!.key!;
  await expect.poll(async () => (await node(page, decisionId))?.refs).toEqual([key]);

  // Move A to the other canvas: it leaves this one, B keeps its ref, and the ref still resolves (to the moved node).
  await select(page, cacheId);
  await page.getByRole("button", { name: "Move to canvas…" }).click();
  await page.getByRole("menu", { name: "Move to canvas" }).getByRole("menuitem").first().click();
  await expect(page.getByText(/^Moved 1 item/)).toBeVisible();
  await expect.poll(async () => (await scene(page)).some((e) => e.id === cacheId)).toBe(false);
  await expect(page.getByText(/is referenced by/)).toHaveCount(0); // a move is not a delete
  expect((await node(page, decisionId))?.refs).toEqual([key]);
  await select(page, decisionId);
  const ref = page.getByRole("group", { name: "References" }).locator("li");
  await expect(ref).toHaveCount(1);
  await expect(ref).toHaveAttribute("data-status", "resolved");
  await expect(ref.locator("code")).toHaveText("Cache");

  // On the other canvas: the same element id and the same key.
  await switchCanvas(page, otherId);
  await expect.poll(async () => (await node(page, cacheId))?.key).toBe(key);

  // Deleting it there, while B (on the first canvas) still refers to it: the notice names the count.
  await select(page, cacheId);
  // Keys go to the canvas only with focus in Excalidraw's container.
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await scene(page)).some((e) => e.id === cacheId)).toBe(false);
  await expect(page.getByText(/“Cache” is referenced by 1 node/)).toBeVisible();
});
