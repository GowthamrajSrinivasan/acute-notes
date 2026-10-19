/**
 * F25: provenance on AI-created objects and `acute://context/current`,
 * without calling AI. AI changes are proposed through the dev hook (or from a
 * saved conversation's Insert) and accepted; the properties panel's Origin
 * section then offers View context, View changes and Undo / Remove.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  acceptProposal,
  askAISurface,
  blockByTitle,
  createDemoCanvas,
  elements,
  openApp,
  openHistory,
  seedConversation,
  select,
  selectedIds,
} from "../helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let seq = 0;

const origin = (p: Page) => p.getByRole("group", { name: "Origin" });

/** Proposes a note + shape + connection and accepts it; returns the new element ids. */
async function acceptVisualize(p: Page): Promise<{ op: string; ids: string[] }> {
  const before = new Set((await elements(p)).map((e) => e.id));
  const op = `op_prov_${++seq}`;
  await p.evaluate(
    (s) => void (window as unknown as { __acuteDev: { proposeChanges(s: unknown): unknown } }).__acuteDev.proposeChanges(s),
    {
      operationId: op,
      title: "Visualize",
      metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "copilot", model: "gpt-test" },
      changes: [
        { kind: "create_block", key: "n", blockType: "text", content: [{ type: "paragraph", content: `Note ${seq}` }], box: { x: 2600, y: seq * 400, width: 260, height: 140 } },
        { kind: "create_shape", key: "s", shape: "ellipse", label: `Shape ${seq}`, box: { x: 3000, y: seq * 400, width: 180, height: 100 } },
        { kind: "connect", key: "c", from: { created: "n" }, to: { created: "s" } },
      ],
    },
  );
  await acceptProposal(p);
  const ids = (await elements(p)).filter((e) => !before.has(e.id) && !(e.type === "text" && e.containerId)).map((e) => e.id);
  return { op, ids };
}

const blockOf = async (p: Page, ids: string[]) => (await elements(p)).find((e) => ids.includes(e.id) && e.type === "embeddable")!.id;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await createDemoCanvas(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("a user-created object shows no origin", async () => {
  await select(page, (await blockByTitle(page, "Launch checklist")).id);
  await expect(page.getByRole("button", { name: "Ask AI" }).first()).toBeVisible();
  await expect(origin(page)).toHaveCount(0);
});

test("an AI-created object shows where it came from; View changes selects the whole operation; Undo reverts it", async () => {
  const { ids } = await acceptVisualize(page);
  expect(ids).toHaveLength(3);
  await select(page, await blockOf(page, ids));
  await expect(origin(page)).toContainText("Created by AI · Visualize · GitHub Copilot · gpt-test");

  await origin(page).getByRole("button", { name: /View changes/ }).click();
  await expect.poll(async () => (await selectedIds(page)).sort()).toEqual([...ids].sort());

  await origin(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await elements(page)).filter((e) => ids.includes(e.id))).toEqual([]);
});

test("after later edits, Undo becomes Remove: it deletes the operation's objects as one step Ctrl+Z restores", async () => {
  const { ids } = await acceptVisualize(page);
  // A later user edit: the AI step is no longer the latest.
  const lastStep = () => page.evaluate(() => (window as unknown as { __acuteDev: { history: { lastStepId: number | null } } }).__acuteDev.history.lastStepId);
  const aiStep = await lastStep();
  // An ordinary user step: a new rectangle, committed like any user input.
  await page.evaluate(() => {
    type Dev = { api: { getSceneElementsIncludingDeleted(): unknown[]; updateScene(s: unknown): void }; history: { noteUserInput(): void; commit(): void } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    dev.history.noteUserInput();
    const rect = { id: "user_rect", type: "rectangle", x: 4000, y: 4000, width: 50, height: 50, version: 1, versionNonce: 1, isDeleted: false, angle: 0, strokeColor: "#000", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, boundElements: null, updated: 1, link: null, locked: false };
    dev.api.updateScene({ elements: [...dev.api.getSceneElementsIncludingDeleted(), rect] });
    dev.history.commit();
  });
  await expect.poll(lastStep).not.toBe(aiStep);

  const shapeId = (await elements(page)).find((e) => ids.includes(e.id) && e.type === "ellipse")!.id;
  await select(page, shapeId);
  await expect(origin(page)).toContainText("Created by AI");
  const remove = origin(page).getByRole("button", { name: "Remove" });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect.poll(async () => (await elements(page)).filter((e) => ids.includes(e.id))).toEqual([]);

  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(async () => (await elements(page)).filter((e) => ids.includes(e.id)).length).toBe(3);
  // The user's own later step was not touched.
  expect((await elements(page)).some((e) => e.id === "user_rect")).toBe(true);
});

test("View context opens the conversation whose reply was inserted", async () => {
  const overviewId = (await blockByTitle(page, "Checkout revamp — overview")).id;
  await seedConversation(page, { anchorIds: [overviewId], anchorLabel: "Checkout revamp — overview", question: "What changed?", reply: "Retries are now **idempotent**." });
  const panel = await openHistory(page, overviewId);
  await panel.getByRole("button", { name: /What changed\?/ }).click();
  const before = new Set((await elements(page)).map((e) => e.id));
  await askAISurface(page).locator(".acute-ask-ai__reply").last().getByRole("button", { name: "Insert on canvas" }).click();
  await acceptProposal(page);
  await askAISurface(page).getByRole("button", { name: "Close" }).click();

  const inserted = (await elements(page)).find((e) => !before.has(e.id))!;
  await select(page, inserted.id);
  await expect(origin(page)).toContainText("Created by AI · Chat reply · GitHub Copilot · test");
  await origin(page).getByRole("button", { name: "View context" }).click();
  const surface = askAISurface(page);
  await expect(surface.locator(".acute-ask-ai__you")).toContainText("What changed?");
  await expect(surface.locator(".acute-ask-ai__result")).toContainText("Retries are now idempotent.");
  await surface.getByRole("button", { name: "Close" }).click();
});

test("acute://context/current describes the selection with provenance, bounded, with no secrets", async () => {
  const { op, ids } = await acceptVisualize(page);
  const blockId = await blockOf(page, ids);
  await select(page, blockId);
  const ctx = await page.evaluate(() => (window as unknown as { __acuteDev: { currentContext(): Promise<unknown> } }).__acuteDev.currentContext());
  const c = ctx as {
    uri: string;
    workspace: { name: string };
    canvas: { title: string };
    selection: { id: string; excerpt?: string; provenance?: Record<string, unknown> }[];
    nearby: { id: string }[];
    relations: { from: string; to: string }[];
    recentChanges: string[];
  };
  expect(c.uri).toBe("acute://context/current");
  expect(c.workspace.name).not.toBe("");
  expect(c.canvas.title).toBe("AI test canvas");
  expect(c.selection).toHaveLength(1);
  expect(c.selection[0]).toMatchObject({ id: blockId, excerpt: `Note ${seq}`, provenance: { createdBy: "ai", operationId: op, task: "generate_visual_plan" } });
  expect(c.nearby.map((o) => o.id)).toContain(ids.find((id) => id !== blockId && c.relations.some((r) => r.to === id)));
  expect(c.recentChanges[0]).toBe("Visualize: 2 objects · 1 connection");
  expect(c.nearby.length).toBeLessThanOrEqual(12);
  expect(JSON.stringify(ctx)).not.toMatch(/customData|acuteMeta|apiKey|token|Bearer/i);
});
