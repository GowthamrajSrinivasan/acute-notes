/**
 * Newer content updates the notes in place (update engine, plan §17): Source A (an MCP server operations guide) is
 * visualized, then Source B (an MCP client runbook that revises some of its statements) is merged into it. The existing
 * objects are updated; no new objects are added, and a superseded statement ("30 seconds") is replaced, never kept
 * beside its revision ("120 seconds") or turned into a "Needs your call" box. Run it with:
 *
 *   npm run test:e2e:ai -- --yes --provider=aicredits --trace off --output <dir> e2e/ai/mcpSupersede.spec.ts
 *
 * Each step's review summary, the model replies, the scene and the source's text are attached to the report.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { reviewBar, visualizeDialog } from "../aiReview";

const AI_TIMEOUT = 360_000;

export const SOURCE_A = `# MCP server operations guide

The MCP server listens on port 3001.
Tool calls time out after 30 seconds.
Access tokens are rotated every night at 1 a.m.
Each client may open at most 5 concurrent sessions.
Write tools are disabled by default.
Every tool requires an API key.
The server logs every tool call to the audit log.
Read tools return their results as JSON.
`;

export const SOURCE_B = `# MCP client runbook

The MCP server listens on port 3001.
Tool calls time out after 120 seconds.
Access tokens are rotated once a week on Sunday.
Each client may open up to 8 concurrent sessions.
Write tools are enabled by default.
The health-check tool can be called without an API key.
In 2025 the server also accepted the SSE transport; since January 2026 it accepts Streamable HTTP only.
Tool calls are recorded in the audit log.
`;

type SceneObj = { id: string; type: string; text: string };

/** Every live object on the canvas (not arrows or shape labels), with the text a user sees on it. */
function scene(p: Page): Promise<SceneObj[]> {
  return p.evaluate(() => {
    type El = { id: string; type: string; isDeleted?: boolean; text?: string; containerId?: string | null; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown; title?: string } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const textOf = (v: unknown): string => {
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(textOf).join(" ");
      if (v && typeof v === "object") {
        const o = v as { text?: unknown; content?: unknown; children?: unknown; rows?: unknown; cells?: unknown };
        return [typeof o.text === "string" ? o.text : "", textOf(o.content), textOf(o.children), textOf(o.rows), textOf(o.cells)].join(" ");
      }
      return "";
    };
    const els = dev.api.getSceneElements().filter((e) => !e.isDeleted);
    const labels = new Map(els.filter((e) => e.type === "text" && e.containerId).map((e) => [e.containerId!, e.text ?? ""] as const));
    return els.flatMap((el) => {
      if (el.type === "arrow" || (el.type === "text" && el.containerId)) return [];
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const doc = docId ? dev.store.get(docId) : null;
      const text = (doc ? `${doc.title ?? ""} ${textOf(doc.snapshot)}` : el.type === "text" ? (el.text ?? "") : (labels.get(el.id) ?? "")).replace(/\s+/g, " ").trim();
      return [{ id: el.id, type: el.type, text }];
    });
  });
}

const sourceText = (p: Page, id: string) =>
  p.evaluate(async (i) => ((await (window as unknown as { __acuteDev: { contentSource(id: string): Promise<{ version: { text: string } } | null> } }).__acuteDev.contentSource(i))?.version.text ?? ""), id);

const firstSourceId = (p: Page) =>
  p.evaluate(async () => {
    type D = { api: { getSceneElements(): { id: string }[] }; reconciliation(id: string): Promise<{ link: { contentSourceId: string } | null } | null> };
    const d = (window as unknown as { __acuteDev: D }).__acuteDev;
    for (const el of d.api.getSceneElements()) {
      const link = (await d.reconciliation(el.id))?.link;
      if (link) return link.contentSourceId;
    }
    return null;
  });

async function attachRequests(label: string, requests: Request[]) {
  for (const [i, r] of requests.filter((q) => q.method() === "POST" && aiTaskOf(q)).entries()) {
    const body = await (await r.response())?.text().catch(() => "(no body)");
    await test.info().attach(`${label} — ${aiTaskOf(r)} ${i + 1}`, { body: `PROMPT:\n${promptOf(r)}\n\nREPLY:\n${body ?? ""}`, contentType: "text/plain" });
  }
}

async function acceptAll(p: Page, label: string) {
  await reviewBar(p).getByRole("button", { name: "Review" }).click();
  const summary = (await reviewBar(p).innerText()).replace(/\s+/g, " ");
  test.info().annotations.push({ type: `${label} review`, description: summary });
  await reviewBar(p).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(p)).toBeHidden();
  return summary;
}

test("MCP runbook merged into the MCP guide: the existing objects are updated in place, nothing new is added", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const page = await browser.newPage();
  const requests: Request[] = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);

  // Source A.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(SOURCE_A);
  requests.length = 0;
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  await attachRequests("A", requests);
  await acceptAll(page, "A");
  const before = await scene(page);
  await test.info().attach("scene after A", { body: JSON.stringify(before, null, 2), contentType: "application/json" });
  const sourceId = (await firstSourceId(page))!;
  expect(sourceId).toBeTruthy();

  // Source B: merged into the notes A made (the default on a canvas that has notes).
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(SOURCE_B);
  await expect(visualizeDialog(page).getByRole("radio", { name: /existing notes/ })).toBeChecked();
  requests.length = 0;
  await visualizeDialog(page).getByRole("button", { name: /^(Merge|Update)$/ }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  await attachRequests("B", requests);
  const summary = await acceptAll(page, "B");
  const after = await scene(page);
  const text = await sourceText(page, sourceId);
  await test.info().attach("scene after B", { body: JSON.stringify(after, null, 2), contentType: "application/json" });
  await test.info().attach("source text after B", { body: text, contentType: "text/plain" });

  const ids = new Set(before.map((o) => o.id));
  const added = after.filter((o) => !ids.has(o.id));
  const all = after.map((o) => o.text).join("\n");
  expect.soft(added, "no new objects on the canvas").toEqual([]);
  expect.soft(after.length, "the same number of objects").toBe(before.length);
  expect.soft(summary, "no 'Needs your call' box").not.toMatch(/Needs your call/i);
  expect.soft(all, "the timeout is revised").toMatch(/120 seconds/);
  expect.soft(all, "the old timeout is gone").not.toMatch(/30 seconds/);
  expect.soft(all, "the rotation is revised").toMatch(/once a week|weekly/i);
  expect.soft(all, "the old rotation is gone").not.toMatch(/every night|nightly/i);
  expect.soft(all, "the session limit is revised").toMatch(/\b8\b/);
  expect.soft(all, "write tools are revised").toMatch(/enabled by default/i);
  expect.soft(all, "the new exception is kept").toMatch(/health-check/i);
  expect.soft(text.match(/port 3001/g), "the repeated statement is in the notes once").toHaveLength(1);
});
