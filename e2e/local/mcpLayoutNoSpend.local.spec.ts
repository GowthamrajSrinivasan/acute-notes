/**
 * Note-taking modes plan Step 8 (local part): an MCP client composes cards with its own AI, and the canvas spends none.
 * The SDK's own MCP client stands in for an IDE agent; an AI provider is connected (a fake key, every AI request answered
 * by this spec and counted), so any in-app model call the MCP path set off would show up. On an AI-managed canvas it:
 * reads the grammar, creates 3 layout cards (IdeaCard, FlowDiagram, Callout) and makes 2 updates (a layout-only change
 * read with get_block's contentHash, and a text + layout change), each accepted in the review bar. Then: no request
 * reached `/api/ai`, and the app's per-call log (`__acuteDev.callStats`) recorded no model call. With "Allow intelligent
 * UI" off, the tools refuse. No console errors.
 *
 * It switches MCP access on (and off again at the end): run it only against a dev server bound to loopback
 * (`npx next dev -H 127.0.0.1`), as the MCP gate specs.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test, type Page, type Route } from "@playwright/test";
import { openAISettings, openApp } from "../helpers";

const ENDPOINT = "http://localhost:3000/api/mcp";
/** AI provider APIs a browser-side (BYOK direct) call would reach. */
const PROVIDER_HOSTS = ["https://api.openai.com/**", "https://api.anthropic.com/**", "https://openrouter.ai/**", "https://generativelanguage.googleapis.com/**"];

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const moreMenu = (p: Page) => p.getByRole("menu", { name: "More" });
const viewToggle = (p: Page) => p.getByRole("radiogroup", { name: "View" });
const mcpDialog = (p: Page) => p.getByRole("dialog", { name: "MCP access" });

type CallRecord = { task: string };
type Dev = {
  api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { layout?: { lang: string } } | null };
  callStats(clear?: boolean): Promise<{ records: CallRecord[] }>;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** Every live element with a stored layout: its id and its layout's Lang. */
const layoutCards = (p: Page) =>
  dev(p, (d) =>
    d.api.getSceneElements().flatMap((e) => {
      const doc = !e.isDeleted ? e.customData?.acute?.documentId : undefined;
      const lang = doc ? d.store.get(doc)?.layout?.lang : undefined;
      return lang ? [{ id: e.id, lang }] : [];
    }),
  );

const IDEA = `root = IdeaCard("Retry policy", "Jobs retry 5 times, then give up after 30 seconds.", "high")`;
const IDEA_MD = "### Retry policy\n\nJobs retry 5 times, then give up after 30 seconds.";
const FLOW = `root = FlowDiagram("Release pipeline", ["Build", "QA sign-off", "Deploy"], ["CI builds and tests", "A QA engineer signs off", "The release manager deploys"])`;
const FLOW_MD = "### Release pipeline\n\n1. **Build**\n\n   CI builds and tests\n\n2. **QA sign-off**\n\n   A QA engineer signs off\n\n3. **Deploy**\n\n   The release manager deploys";
const CALLOUT = `root = Callout("warning", "Freeze the main branch before 10:00 on release day.")`;
const CALLOUT_MD = "### Branch freeze\n\nFreeze the main branch before 10:00 on release day.";
/** Update 1 (layout only): the idea card becomes a callout; its text is unchanged. */
const IDEA_AS_CALLOUT = `root = Callout("info", "Jobs retry 5 times, then give up after 30 seconds.")`;
/** Update 2 (text and layout): the flow gains a step. */
const FLOW2 = `root = FlowDiagram("Release pipeline", ["Build", "QA sign-off", "Deploy", "Monitor"], ["CI builds and tests", "A QA engineer signs off", "The release manager deploys", "The team watches error rates"])`;
const FLOW2_MD = `${FLOW_MD}\n\n4. **Monitor**\n\n   The team watches error rates`;

async function connectFakeKey(page: Page) {
  const settings = await openAISettings(page);
  const row = settings.locator(".acute-ai-row").filter({ has: page.locator(".acute-ai-row__title", { hasText: /^OpenAI$/ }) });
  await row.getByRole("button", { name: "Connect key" }).click();
  const connect = page.getByRole("dialog", { name: "Connect OpenAI" });
  await connect.locator("#acute-connect-key").fill("sk-test-not-a-real-key");
  await connect.locator("#acute-connect-model").fill("test-model");
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connect).toBeHidden();
  await settings.getByRole("button", { name: "Close" }).click();
}

async function openMcpAccess(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await moreMenu(page).getByRole("menuitem", { name: "MCP access" }).click();
  return mcpDialog(page);
}

test.describe("MCP clients compose layout cards; the canvas spends no AI (note-taking modes Step 8, local)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  let client: Client;
  /** Every `/api/ai` request the page made after setup, by path. */
  const aiRequests: string[] = [];
  let counting = false;
  const consoleErrors: string[] = [];

  const tool = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    return res.structuredContent as T;
  };
  const acceptAll = async () => {
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
  };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    // A provider is connected, so the app *could* call a model: every AI request is answered here (nothing leaves the
    // machine) and counted once the MCP part starts.
    await page.route("**/api/ai/**", async (route: Route) => {
      const path = new URL(route.request().url()).pathname;
      if (counting) aiRequests.push(path);
      if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
      return route.fulfill({ status: 200, json: { text: "{}", model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
    });
    // A key-connected provider may be called straight from the browser (BYOK direct): counted too, and never sent.
    for (const host of PROVIDER_HOSTS) {
      await page.route(host, async (route: Route) => {
        if (counting) aiRequests.push(route.request().url());
        return route.abort();
      });
    }
    await connectFakeKey(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await moreMenu(page).getByRole("menuitem", { name: /^AI-managed notes/ }).click();
    await expect(viewToggle(page).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");

    const dialog = await openMcpAccess(page);
    await dialog.getByRole("radio", { name: "On" }).click();
    await expect(dialog.getByRole("status")).toContainText("Ready");
    await dialog.getByRole("radio", { name: "Read and propose changes" }).click();
    await dialog.getByRole("checkbox", { name: /^Allow intelligent UI/ }).check();
    await dialog.getByRole("button", { name: "Show" }).click();
    const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
    await dialog.getByRole("button", { name: "Done" }).click();

    client = new Client({ name: "e2e-layout-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    await dev(page, (d) => d.callStats(true));
    counting = true;
  });

  test.afterAll(async () => {
    await client?.close().catch(() => undefined);
    if (page) {
      // MCP access off again, as it was.
      const dialog = await openMcpAccess(page).catch(() => null);
      if (dialog) {
        await dialog.getByRole("radio", { name: "Off" }).click().catch(() => undefined);
        await dialog.getByRole("button", { name: "Done" }).click().catch(() => undefined);
      }
      await page.context().close();
    }
  });

  test("get_layout_grammar: the components, with one example per layout", async () => {
    const g = await tool<{ grammar: string; examples: { layout: string }[] }>("get_layout_grammar", {});
    expect(g.grammar).toContain("FlowDiagram");
    expect(g.examples.map((e) => e.layout)).toEqual(expect.arrayContaining(["IdeaCard", "FlowDiagram"]));
  });

  test("3 cards: each proposed for review, then drawn from its stored layout once accepted", async () => {
    for (const [markdown, lang] of [
      [IDEA_MD, IDEA],
      [FLOW_MD, FLOW],
      [CALLOUT_MD, CALLOUT],
    ] as const) {
      const r = await tool<{ status: string }>("create_layout_card", { markdown, lang });
      expect(r.status).toBe("proposed");
      await expect(review(page)).toContainText("e2e-layout-agent");
      await acceptAll();
    }
    await expect.poll(async () => (await layoutCards(page)).map((c) => c.lang).sort()).toEqual([CALLOUT, FLOW, IDEA].sort());
    // Drawn as cards: the idea card, the callout and the flow (its steps as buttons).
    const cards = await layoutCards(page);
    for (const c of cards) await expect(page.locator(`.acute-block[data-element-id="${c.id}"] [data-testid=acute-openui-card]`)).toBeVisible();
    const flowId = cards.find((c) => c.lang === FLOW)!.id;
    await expect(page.locator(`.acute-block[data-element-id="${flowId}"] .openui-flow__node`)).toHaveCount(3);
  });

  test("2 updates: a layout-only change read with get_block's contentHash, and a text + layout change", async () => {
    const cards = await layoutCards(page);
    const idea = cards.find((c) => c.lang === IDEA)!.id;
    const flow = cards.find((c) => c.lang === FLOW)!.id;

    // get_block reads the saved canvas: wait for the accepted cards to be saved.
    let read = "";
    await expect
      .poll(async () => {
        const res = (await client.callTool({ name: "get_block", arguments: { id: idea } })) as CallToolResult;
        const s = res.isError ? null : (res.structuredContent as { contentHash?: string; layout?: { lang: string; current: boolean } } | undefined);
        if (s?.contentHash && s.layout?.lang === IDEA && s.layout.current) read = s.contentHash;
        return read;
      })
      .not.toBe("");

    const u1 = await tool<{ status: string }>("update_layout_card", { objectId: idea, lang: IDEA_AS_CALLOUT, expectedContentHash: read });
    expect(u1.status).toBe("proposed");
    await expect(review(page)).toContainText("changes its layout");
    await acceptAll();

    const u2 = await tool<{ status: string }>("update_layout_card", { objectId: flow, markdown: FLOW2_MD, lang: FLOW2 });
    expect(u2.status).toBe("proposed");
    await acceptAll();

    await expect.poll(async () => (await layoutCards(page)).find((c) => c.id === idea)?.lang).toBe(IDEA_AS_CALLOUT);
    await expect.poll(async () => (await layoutCards(page)).find((c) => c.id === flow)?.lang).toBe(FLOW2);
    await expect(page.locator(`.acute-block[data-element-id="${flow}"] .openui-flow__node`)).toHaveCount(4);
    await dev(page, (d) => (d.api as unknown as { scrollToContent(e?: unknown, o?: unknown): void }).scrollToContent(undefined, { fitToContent: true, animate: false }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/mcp-layout/cards.png" });
  });

  test("no in-app AI was spent: no /api/ai request, no model call in the app's call log", async () => {
    // Work deferred after an Accept (after the next paint, checks queued on a commit) gets time to run first.
    await page.waitForTimeout(4000);
    expect(aiRequests).toEqual([]);
    const { records } = await dev(page, (d) => d.callStats());
    expect(records.map((r) => r.task)).toEqual([]);
  });

  test("'Allow intelligent UI' off: the layout tools refuse; nothing is proposed", async () => {
    const dialog = await openMcpAccess(page);
    await dialog.getByRole("checkbox", { name: /^Allow intelligent UI/ }).uncheck();
    await dialog.getByRole("button", { name: "Done" }).click();
    const res = (await client.callTool({ name: "create_layout_card", arguments: { markdown: IDEA_MD, lang: IDEA } })) as CallToolResult;
    expect(res.isError).toBe(true);
    await expect(review(page)).toBeHidden();
  });

  test("control: an in-app AI request IS seen by both counters (so the zero above means something)", async () => {
    // "Ask AI to change…" on a layout card is the canvas's own AI (one compose_card_layout request).
    const card = (await layoutCards(page)).find((c) => c.lang === IDEA_AS_CALLOUT)!.id;
    const block = page.locator(`.acute-block[data-element-id="${card}"]`);
    await dev(page, (d, x) => {
      const api = d.api as unknown as { updateScene(s: unknown): void; scrollToContent(e: unknown, o: unknown): void; getSceneElements(): { id: string }[] };
      api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} }, captureUpdate: "NEVER" });
      api.scrollToContent([api.getSceneElements().find((e) => e.id === x)], { fitToViewport: true, viewportZoomFactor: 0.5, animate: false });
    }, card);
    await page.waitForTimeout(300);
    const box = (await block.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
    await block.getByTestId("acute-layout-guard").getByRole("button", { name: "Ask AI to change…" }).click();
    const ask = block.getByTestId("acute-layout-ask");
    await ask.getByRole("textbox").fill("Make it a warning");
    await ask.getByRole("button", { name: "Ask AI" }).click();
    // The local answer ("{}") has no layout, so nothing is proposed; the request was still made and logged.
    await expect(ask.getByRole("alert")).toBeVisible();
    expect(aiRequests.some((p) => p.endsWith("/run"))).toBe(true);
    expect((await dev(page, (d) => d.callStats())).records.map((r) => r.task)).toContain("compose_card_layout");
    await ask.getByRole("button", { name: "Cancel" }).click();
  });

  test("no console errors", () => {
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });
});
