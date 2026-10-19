/**
 * Acute Lens Phase 3 in the browser, over the real MCP bridge: a two-level repo map is read back with `get_lens`, a
 * path across the levels with `trace_lens_path`, and `focus_lens` opens Lens in the tab at a node with keys
 * highlighted. In the panel, the Trace action names every hop to a node picked on another level and Impact lists what
 * depends on a node; `link_lens_detail` proposes a drill link that Lens follows once accepted. No AI: the SDK's own
 * client stands in for an IDE agent.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test } from "@playwright/test";
import { canvasHome, openApp, waitForCanvas } from "../helpers";

const ENDPOINT = "http://localhost:3000/api/mcp";

type LensNode = { key: string; label: string; child?: { frame: string } };

test("focus_lens opens Lens at a node; Trace and Impact work across levels; link_lens_detail is reviewed", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();

  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const tool = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    return res.structuredContent as T;
  };

  const begun = await tool<{ canvasId: string; mapId: string }>("begin_repo_map", { repo: `acme/lens-${Date.now()}`, commit: "c1" });
  await expect.poll(() => canvasHome(page).canvasId).toBe(begun.canvasId);
  await waitForCanvas(page);
  await tool("upsert_map_section", {
    mapId: begun.mapId,
    commit: "c1",
    section: { key: "mod:overview", label: "Overview", arrangement: "grid", level: 1 },
    nodes: [
      { key: "mod:payments", type: "shape", shape: "rectangle", label: "Payments", kind: "backend" },
      { key: "mod:orders", type: "shape", shape: "rectangle", label: "Orders", kind: "backend" },
    ],
    relationships: [{ from: "mod:orders", to: "mod:payments", type: "calls" }],
  });
  await tool("upsert_map_section", {
    mapId: begun.mapId,
    commit: "c1",
    section: { key: "mod:payments:parts", label: "Payment parts", arrangement: "grid", parent: "mod:payments", level: 2 },
    nodes: [
      { key: "sym:charge", type: "shape", shape: "rectangle", label: "Charge", kind: "function" },
      { key: "sym:refund", type: "shape", shape: "rectangle", label: "Refund", kind: "function" },
    ],
    relationships: [{ from: "sym:refund", to: "sym:charge", type: "calls" }],
  });
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();

  // get_lens: the map's own canvas has one Lens root; its tree has both levels, keyed by the agent's keys (D21).
  const lens = await tool<{ frames: { key: string; title: string; level: number }[]; nodes: LensNode[] }>("get_lens", { root: begun.canvasId });
  expect(lens.frames.map((f) => [f.title, f.level])).toEqual([
    ["Overview", 1],
    ["Payment parts", 2],
  ]);
  const partsFrame = lens.frames[1]!.key;
  expect(lens.nodes.find((n) => n.key === "mod:payments")?.child?.frame).toBe(partsFrame);

  // trace_lens_path: every hop named, across the levels.
  const trace = await tool<{ hops: { text: string }[] }>("trace_lens_path", { from: "Orders", to: "sym:charge" });
  expect(trace.hops.map((h) => h.text)).toEqual(["Orders calls Payments", "Payments contains Charge (zoom in, L1 → L2)"]);

  // focus_lens: Lens opens in the tab at Charge's level, Charge selected, Refund highlighted.
  const focused = await tool("focus_lens", { key: "sym:charge", highlight: ["sym:refund"] });
  expect(focused).toMatchObject({ focused: true, node: "sym:charge", level: 2 });
  const panel = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(panel.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment parts");
  await expect(panel.locator(".acute-lens-panel__crumbs")).toContainText("Overview");
  await expect(panel.locator('g.acute-lens-node[aria-label="Charge"]')).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('g.acute-lens-node[aria-label="Refund"]')).toHaveAttribute("data-mark", "focus");
  await expect(panel.getByRole("region", { name: "Highlighted by your agent" })).toContainText("1 highlighted by your IDE agent");

  // The Trace action: from Charge to a node picked on the level above, every hop named.
  await panel.getByRole("button", { name: "⇢ Trace" }).click();
  const traceCard = panel.getByRole("region", { name: "Trace" });
  await expect(traceCard).toContainText("Now click the end");
  await panel.locator(".acute-lens-panel__crumbs").getByRole("button", { name: "Overview" }).click();
  // Clicking a node ends the path (no second button); what Charge can reach is outlined on this level.
  await expect(panel.locator('g.acute-lens-node[aria-label="Orders"]')).toHaveAttribute("data-mark", "candidate-against");
  await panel.locator('g.acute-lens-node[aria-label="Orders"]').click();
  await expect(traceCard.getByTestId("lens-trace-summary")).toHaveText("2 hops, partly against the arrows");
  await expect(traceCard.getByTestId("lens-trace-hop")).toHaveText(["↓ Payments contains Charge (zoom out, L2 → L1)", "↓ Orders calls Payments (against the arrow)"]);
  await expect(panel.locator('g.acute-lens-node[aria-label="Payments"]')).toHaveAttribute("data-mark", "trace");
  // A stop in the list opens Lens at its level.
  await traceCard.getByRole("button", { name: "Charge" }).click();
  await expect(panel.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment parts");
  await traceCard.getByRole("button", { name: "Clear" }).click();
  await expect(traceCard).toBeHidden();

  // The Path button (archify's route probe): pick the start, see what it reaches, pick the end; the route is in the link.
  await panel.locator(".acute-lens-panel__crumbs").getByRole("button", { name: "Overview" }).click();
  await panel.getByRole("button", { name: "⇢ Path" }).click();
  await expect(traceCard).toContainText("Click where the path starts");
  await panel.locator('g.acute-lens-node[aria-label="Orders"]').click();
  await expect(traceCard).toContainText("Now click the end");
  await expect(panel.locator('g.acute-lens-node[aria-label="Payments"]')).toHaveAttribute("data-mark", "candidate");
  await panel.locator('g.acute-lens-node[aria-label="Payments"]').click();
  await expect(traceCard.getByTestId("lens-trace-summary")).toHaveText("1 hop, along the arrows");
  await expect(panel.locator('g.acute-lens-node[aria-label="Orders"]')).toHaveAttribute("data-mark", "start");
  await expect(panel.locator('g.acute-lens-node[aria-label="Payments"]')).toHaveAttribute("data-mark", "end");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/from=.+&to=/);
  await traceCard.getByRole("button", { name: "Clear" }).click();
  await expect(traceCard).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toMatch(/from=/);
  // Back down to the parts level for the Impact step.
  await panel.locator('g.acute-lens-node[aria-label="Payments"]').dblclick();
  await expect(panel.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment parts");

  // Impact: what depends on Charge (Refund calls it) and the level that contains it.
  await panel.locator('g.acute-lens-node[aria-label="Charge"]').click();
  await panel.getByRole("button", { name: "◎ Impact" }).click();
  const impact = panel.getByRole("region", { name: "Impact" });
  await expect(impact).toContainText("Affected");
  await expect(impact).toContainText("Refund — calls Charge");
  await expect(panel.locator('g.acute-lens-node[aria-label="Refund"]')).toHaveAttribute("data-mark", "affected");
  await expect(panel.locator('g.acute-lens-node[aria-label="Charge"]')).toHaveAttribute("data-mark", "modified");
  await impact.getByRole("button", { name: "Clear" }).click();

  // link_lens_detail: Orders → the parts level, proposed for review; Lens follows it once accepted.
  const proposed = await tool("link_lens_detail", { links: [{ node: "mod:orders", frame: partsFrame }], reason: "Orders' detail lives with the payment parts" });
  expect(proposed).toMatchObject({ status: "proposed", changes: { set_lens: 1 } });
  await expect(review).toContainText("Lens: set 1 drill link");
  await review.getByRole("button", { name: "Review", exact: true }).click();
  await expect(review).toContainText("Lens: Orders — zoom in to “Payment parts”");
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();
  await panel.locator(".acute-lens-panel__crumbs").getByRole("button", { name: "Overview" }).click();
  await panel.locator('g.acute-lens-node[aria-label="Orders"]').click();
  await panel.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(panel.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment parts");

  await client.close();
});
