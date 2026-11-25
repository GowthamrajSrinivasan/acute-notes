/**
 * Note-taking modes plan Step 8 (paid part): a REAL MCP client — the Claude Code CLI, on the signed-in user's own Claude
 * subscription — composes 3 layout cards and makes 2 updates on an AI-managed canvas, from a short set of notes. This
 * spec plays the user: it accepts every proposal in the review bar as it appears. Then it checks what landed, and that
 * the canvas's own AI spent nothing (the same two counters as `e2e/local/mcpLayoutNoSpend.local.spec.ts`, which also
 * proves they catch an in-app call).
 *
 * Costs the CLI's usage (not the app's AI credit): REFUSES to run unless `MCP_CLIENT_RUN_APPROVED_BY` says who approved
 * it. Switches MCP access on (off again at the end): run it only against a dev server bound to loopback
 * (`npx next dev -H 127.0.0.1`). Evidence goes to `MCP_CLIENT_RUN_OUT` (default `test-results/mcp-layout-client`).
 *
 *   MCP_CLIENT_RUN_APPROVED_BY="<name>" ACUTE_AI_E2E=1 \
 *     npx playwright test --project=ai --no-deps --trace off e2e/ai/mcpLayoutClient.spec.ts
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { openAISettings, openApp } from "../helpers";

const APPROVED_BY = (process.env.MCP_CLIENT_RUN_APPROVED_BY ?? "").trim();
const OUT = process.env.MCP_CLIENT_RUN_OUT ?? "test-results/mcp-layout-client";
const ENDPOINT = "http://localhost:3000/api/mcp";
const PROVIDER_HOSTS = ["https://api.openai.com/**", "https://api.anthropic.com/**", "https://openrouter.ai/**", "https://generativelanguage.googleapis.com/**"];
/** The CLI's own model, unless set (its default for the signed-in account otherwise). */
const MODEL = process.env.MCP_CLIENT_MODEL ?? "";
const CLIENT_TIMEOUT_MS = 8 * 60_000;

const NOTES = `Retry policy: jobs retry 5 times, then give up after 30 seconds.
Release steps: the release manager freezes main at 10:00 on Tuesday; CI builds the candidate and runs about 4,000 tests; two reviewers approve it; the on-call engineer deploys it in three waves.
Branch freeze: nobody merges to main after the freeze until the release is out.`;

const PROMPT = `You are exercising an MCP server named "acute" (a canvas notes app). Use only its tools. A person is watching the app and accepts each change you propose within a few seconds.

1. Call get_layout_grammar once.
2. From the notes below, create exactly 3 cards with create_layout_card, each with Markdown text and an OpenUI layout that says only what its text says:
   (a) the retry policy, as an IdeaCard;
   (b) the release steps, as a FlowDiagram (one step per action, in order);
   (c) the branch-freeze rule, as a Callout.
3. Call list_blocks until all 3 cards are on the canvas (each appears once accepted; wait and retry), then get_block each card you are about to change.
4. Make exactly 2 updates with update_layout_card, each sending expectedContentHash from get_block:
   (i) the retry-policy card: its layout only, now a warning Callout (keep its text);
   (ii) the release-steps card: add a last step "Monitor: the team watches error rates for 30 minutes" to both its Markdown and its FlowDiagram.
5. If a tool refuses a layout, read why, fix it and try again (at most 2 retries per card).
End with one line listing the ids of the cards you created and updated.

Notes:
${NOTES}`;

type CallRecord = { task: string };
type Dev = {
  api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { layout?: { lang: string; contentHash?: string } } | null };
  callStats(clear?: boolean): Promise<{ records: CallRecord[] }>;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const moreMenu = (p: Page) => p.getByRole("menu", { name: "More" });

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
  return page.getByRole("dialog", { name: "MCP access" });
}

/** Runs the Claude Code CLI against the canvas's MCP server; resolves with its stream-json lines and exit code. */
function runClient(mcpConfig: string): Promise<{ code: number | null; lines: string[]; stderr: string }> {
  const args = ["-p", PROMPT, "--mcp-config", mcpConfig, "--strict-mcp-config", "--allowedTools", "mcp__acute", "--output-format", "stream-json", "--verbose", "--no-session-persistence"];
  if (MODEL) args.push("--model", MODEL);
  // An empty working folder: the client starts without this repo's instructions, settings or hooks.
  const cwd = mkdtempSync(path.join(tmpdir(), "acute-mcp-client-"));
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "claude.exe" : "claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    const lines: string[] = [];
    let buf = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      lines.push(...parts.filter((l) => l.trim()));
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const timer = setTimeout(() => child.kill(), CLIENT_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf.trim()) lines.push(buf.trim());
      resolve({ code, lines, stderr });
    });
  });
}

test.describe("A real MCP client composes layout cards; the canvas spends no AI (Step 8, paid)", () => {
  test.skip(!APPROVED_BY, "MCP_CLIENT_RUN_APPROVED_BY is not set: this run uses the Claude Code CLI's paid usage and needs the user's approval");
  test.setTimeout(CLIENT_TIMEOUT_MS + 120_000);

  test("3 cards and 2 updates, every proposal reviewed; no in-app AI call", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openApp(page);

    const aiRequests: string[] = [];
    let counting = false;
    await page.route("**/api/ai/**", async (route: Route) => {
      const p = new URL(route.request().url()).pathname;
      if (counting) aiRequests.push(p);
      if (!p.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
      return route.fulfill({ status: 200, json: { text: "{}", model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
    });
    for (const host of PROVIDER_HOSTS) {
      await page.route(host, async (route: Route) => {
        if (counting) aiRequests.push(route.request().url());
        return route.abort();
      });
    }
    await connectFakeKey(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await moreMenu(page).getByRole("menuitem", { name: /^AI-managed notes/ }).click();

    const dialog = await openMcpAccess(page);
    await dialog.getByRole("radio", { name: "On" }).click();
    await expect(dialog.getByRole("status")).toContainText("Ready");
    await dialog.getByRole("radio", { name: "Read and propose changes" }).click();
    await dialog.getByRole("checkbox", { name: /^Allow intelligent UI/ }).check();
    await dialog.getByRole("button", { name: "Show" }).click();
    const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
    await dialog.getByRole("button", { name: "Done" }).click();

    // The token stays in test-results (gitignored) and is revoked when MCP access goes off at the end.
    const config = path.resolve("test-results", "mcp-layout-client.mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { acute: { type: "http", url: ENDPOINT, headers: { Authorization: `Bearer ${token}` } } } }));
    await dev(page, (d) => d.callStats(true));
    counting = true;

    // The user: accept every proposal as it appears, keeping its title and summary.
    const reviewed: { title: string; text: string }[] = [];
    let running = true;
    const accepting = (async () => {
      while (running) {
        if (await review(page).isVisible().catch(() => false)) {
          const text = ((await review(page).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
          await review(page).getByRole("button", { name: /^Accept all/ }).click().catch(() => undefined);
          await expect(review(page)).toBeHidden({ timeout: 5000 }).catch(() => undefined);
          reviewed.push({ title: text.slice(0, 160), text });
          await page.screenshot({ path: path.join(OUT, `accepted-${reviewed.length}.png`) }).catch(() => undefined);
        }
        await page.waitForTimeout(400);
      }
    })();

    const started = Date.now();
    const client = await runClient(config);
    running = false;
    await accepting;
    writeFileSync(path.join(OUT, "client-stream.jsonl"), client.lines.join("\n"));
    if (client.stderr) writeFileSync(path.join(OUT, "client-stderr.txt"), client.stderr);

    // What the client did, from its stream: tool calls by name, and the result line (cost, turns).
    const events = client.lines.flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const toolCalls = events.flatMap((e) =>
      e.type === "assistant" ? (((e.message as { content?: { type: string; name?: string }[] })?.content ?? []).filter((c) => c.type === "tool_use").map((c) => c.name!)) : [],
    );
    const result = events.find((e) => e.type === "result") as { total_cost_usd?: number; num_turns?: number; result?: string; is_error?: boolean } | undefined;

    await page.waitForTimeout(4000);
    const cards = await dev(page, (d) =>
      d.api.getSceneElements().flatMap((e) => {
        const doc = !e.isDeleted ? e.customData?.acute?.documentId : undefined;
        const layout = doc ? d.store.get(doc)?.layout : undefined;
        return layout ? [{ id: e.id, lang: layout.lang }] : [];
      }),
    );
    const { records } = await dev(page, (d) => d.callStats());
    await page.screenshot({ path: path.join(OUT, "final.png") });

    const report = {
      approvedBy: APPROVED_BY,
      client: "Claude Code CLI (signed-in subscription)",
      model: MODEL || "CLI default",
      exitCode: client.code,
      seconds: Math.round((Date.now() - started) / 1000),
      clientCostUsdAsReported: result?.total_cost_usd ?? null,
      turns: result?.num_turns ?? null,
      toolCalls,
      reviewed: reviewed.map((r) => r.title),
      cards,
      inAppAiRequests: aiRequests,
      inAppModelCalls: records.map((r) => r.task),
      consoleErrors,
      finalLine: result?.result ?? null,
    };
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

    expect(client.code, client.stderr.slice(0, 2000)).toBe(0);
    expect(toolCalls.filter((t) => t.endsWith("create_layout_card")).length).toBeGreaterThanOrEqual(3);
    expect(toolCalls.filter((t) => t.endsWith("update_layout_card")).length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.some((c) => /^root\s*=\s*FlowDiagram\(/.test(c.lang) && /Monitor/.test(c.lang))).toBe(true);
    expect(cards.some((c) => /^root\s*=\s*Callout\(\s*"warning"/.test(c.lang) && /5 times/.test(c.lang))).toBe(true);
    // The canvas's own AI spent nothing.
    expect(aiRequests).toEqual([]);
    expect(records).toEqual([]);
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });

  // MCP access off again (revoking the token), whatever happened above.
  test.afterEach(async ({ page }) => {
    const off = await openMcpAccess(page).catch(() => null);
    if (!off) return;
    await off.getByRole("radio", { name: "Off" }).click().catch(() => undefined);
    await off.getByRole("button", { name: "Done" }).click().catch(() => undefined);
  });
});
