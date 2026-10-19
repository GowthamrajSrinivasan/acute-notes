/**
 * Agent State, Lens Phase 7A (plan: .ai/docs/acute-lens-plan.md §3.7, D30–D32, D40, D46, D61): an agent's accepted
 * change appears in the Agent log with the client's reported name and its reason; "Revert…" stages the inverse
 * for review and accepting it restores the canvas (a removal of what it added, a restore of what it changed); an
 * element edited since comes back as a conflict; a rejection is logged with the user's reason; two sessions' sets
 * wait side by side. No AI, no MCP client: sets are proposed through the dev hook, as an MCP tool would.
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, select } from "../helpers";

type Raw = { id: string; x: number; isDeleted?: boolean; customData?: Record<string, unknown> };
type AcuteDev = { proposeChanges(set: unknown): unknown; renderPlan(plan: unknown, p: unknown): Promise<unknown>; api: { getSceneElementsIncludingDeleted(): Raw[]; updateScene(s: unknown): void } };

function raw(page: Page, id: string): Promise<Raw | undefined> {
  return page.evaluate((elementId) => {
    const el = (window as unknown as { __acuteDev: AcuteDev }).__acuteDev.api.getSceneElementsIncludingDeleted().find((e) => e.id === elementId);
    return el && { id: el.id, x: el.x, isDeleted: el.isDeleted, customData: el.customData };
  }, id);
}

function propose(page: Page, set: Record<string, unknown>): Promise<unknown> {
  return page.evaluate((s) => (window as unknown as { __acuteDev: AcuteDev }).__acuteDev.proposeChanges(s), set);
}

/** One shape on the canvas, accepted: returns its id and x. */
async function shapeOnCanvas(page: Page, label: string): Promise<{ id: string; x: number }> {
  await page.evaluate(
    ([l]) =>
      (window as unknown as { __acuteDev: AcuteDev }).__acuteDev.renderPlan(
        { version: 1, template: "flow", nodes: [{ id: "n", type: "shape", content: { shape: "rectangle", label: l } }], relationships: [] },
        { operationId: `op_seed_${l}`, title: "Seed", metadata: { createdBy: "import" } },
      ),
    [label] as const,
  );
  await page.getByRole("region", { name: "AI changes to review" }).getByRole("button", { name: "Accept all" }).click();
  const id = (await elements(page)).find((e) => e.text === label)!.containerId!;
  return { id, x: (await raw(page, id))!.x };
}

const agentSet = (id: string, extra: Record<string, unknown>) => ({
  operationId: id,
  title: "Codex: Tidy the webhook",
  metadata: { createdBy: "mcp", task: "move_object", provider: "Codex" },
  agent: "Codex",
  session: "mcp_e2e",
  reason: "Make room for the queue",
  ...extra,
});

async function openAgentHistory(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agent log" }).click();
  const tab = page.getByRole("tabpanel", { name: "Agent log" });
  await expect(tab).toBeVisible();
  return tab;
}

test("accept an agent's change → Agent log → Revert… → review → the canvas is restored", async ({ page }) => {
  await openApp(page);
  const webhook = await shapeOnCanvas(page, "Webhook");

  // The agent moves the shape, gives it a sublabel and adds a new one.
  await propose(
    page,
    agentSet("op_agent_1", {
      changes: [
        { kind: "move", target: webhook.id, to: { x: webhook.x + 600, y: 0 } },
        { kind: "update_node", target: webhook.id, semantics: { sublabel: "verifies signatures" } },
        { kind: "create_shape", key: "q", shape: "rectangle", label: "Queue", box: { x: webhook.x, y: 400, width: 160, height: 80 } },
      ],
    }),
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();
  await expect.poll(async () => (await raw(page, webhook.id))!.x).toBe(webhook.x + 600);
  const queueId = (await elements(page)).find((e) => e.text === "Queue")!.containerId!;

  // The Agent log lists it: the client's reported name (D61), its reason, what it touched.
  const history = await openAgentHistory(page);
  const row = history.getByRole("listitem", { name: "Change: Codex: Tidy the webhook" });
  await expect(row).toContainText("Accepted");
  await expect(row).toContainText("Codex (as reported by the client)");
  await expect(row).toContainText("Reason: Make room for the queue");
  await expect(history.getByRole("region", { name: /^Session · Codex/ })).toBeVisible();

  // Revert… stages the inverse for review; nothing changes until it is accepted.
  await row.getByRole("button", { name: "Revert…" }).click();
  await expect(review).toContainText("Revert: Codex: Tidy the webhook");
  expect((await raw(page, webhook.id))!.x).toBe(webhook.x + 600);
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  // Restored: back where it was, no sublabel, and the shape it added is gone. Same id throughout.
  await expect.poll(async () => (await raw(page, webhook.id))!.x).toBe(webhook.x);
  expect(((await raw(page, webhook.id))!.customData?.acuteNode as { sublabel?: string } | undefined)?.sublabel).toBeUndefined();
  expect((await raw(page, queueId))!.isDeleted).toBe(true);

  // The original is marked reverted and the revert has its own row; a second Revert… isn't offered.
  await expect(row).toContainText("Reverted");
  await expect(row.getByRole("button", { name: "Revert…" })).toHaveCount(0);
  await expect(history.getByRole("listitem", { name: "Change: Revert: Codex: Tidy the webhook" })).toContainText("Accepted");
});

test("an element edited since the change comes back as a conflict; a rejection is logged with its reason; two sessions wait side by side", async ({ page }) => {
  await openApp(page);
  const webhook = await shapeOnCanvas(page, "Webhook");
  const review = page.getByRole("region", { name: "AI changes to review" });

  await propose(page, agentSet("op_agent_2", { changes: [{ kind: "move", target: webhook.id, to: { x: webhook.x + 300, y: 0 } }] }));
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();

  // The user moves it again by hand (the shape and its label, as a drag does): reverting must not silently undo that.
  await page.evaluate(
    ([id]) => {
      const api = (window as unknown as { __acuteDev: AcuteDev }).__acuteDev.api;
      const moved = (e: Raw & { containerId?: string | null }) => e.id === id || e.containerId === id;
      api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => (moved(e) ? { ...e, x: e.x + 50, version: ((e as unknown as { version: number }).version ?? 1) + 1 } : e)) });
    },
    [webhook.id] as const,
  );
  const history = await openAgentHistory(page);
  await history.getByRole("listitem", { name: "Change: Codex: Tidy the webhook" }).getByRole("button", { name: "Revert…" }).click();
  const conflicts = review.getByRole("listitem", { name: /^Conflict:/ });
  // The shape and its bound label are one card, decided together.
  await expect(conflicts).toHaveCount(1);
  await expect(conflicts.first()).toContainText("changed after the agent's change");
  // Nothing clean to write until the conflict is decided.
  await expect(review.getByRole("button", { name: "Accept all clean changes" })).toBeDisabled();
  await conflicts.first().getByRole("button", { name: "Revert anyway" }).click();
  await review.getByRole("button", { name: "Accept all clean changes" }).click();
  await expect.poll(async () => (await raw(page, webhook.id))!.x).toBe(webhook.x);
  // The label came back with it, not left where the hand move put it.
  const labelX = () =>
    page.evaluate((id) => {
      const all = (window as unknown as { __acuteDev: AcuteDev }).__acuteDev.api.getSceneElementsIncludingDeleted() as (Raw & { containerId?: string | null; width: number })[];
      const shape = all.find((e) => e.id === id)!;
      const label = all.find((e) => e.containerId === id && !e.isDeleted)!;
      return label.x >= shape.x && label.x + label.width <= shape.x + (shape as { width: number }).width;
    }, webhook.id);
  await expect.poll(labelX).toBe(true);

  // Two sessions' proposals wait side by side (D40); rejecting one logs the user's reason (D46).
  await propose(page, agentSet("op_a", { title: "Codex: Move it", changes: [{ kind: "move", target: webhook.id, to: { x: 5, y: 5 } }] }));
  await propose(page, { ...agentSet("op_b", { title: "Claude Code: Add a note" }), agent: "Claude Code", session: "mcp_other", changes: [{ kind: "create_shape", key: "n", shape: "rectangle", label: "Note", box: { x: 0, y: 600, width: 100, height: 60 } }] });
  const sets = review.getByRole("tablist", { name: "Change sets waiting for review" });
  await expect(sets.getByRole("tab")).toHaveCount(2);
  await sets.getByRole("tab", { name: "Codex: Move it" }).click();
  await review.getByRole("button", { name: /^Review/ }).click();
  await review.getByLabel("Reason for rejecting (optional)").fill("Never move the webhook");
  await review.getByRole("button", { name: "Reject" }).click();
  // The other session's set is still waiting.
  await expect(review).toContainText("Claude Code: Add a note");
  await expect(history.getByRole("listitem", { name: "Change: Codex: Move it" })).toContainText("Rejected because: Never move the webhook");
  await select(page, webhook.id);
});
