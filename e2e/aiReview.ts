/**
 * Shared helpers for the AI update workflows (`e2e/ai/semanticUpdate.spec.ts`,
 * `e2e/ai/followUpReplies.spec.ts`): finding objects by their text, the links
 * between them, and running "Update from new content" while attaching what the
 * model actually replied, so a report shows *why* a step came out as it did.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { action, aiTaskOf, openAskAI } from "./helpers";

export const AI_TIMEOUT = 150_000;
/** Demo mode (`--demo`, ACUTE_DEMO=1): slowed actions (playwright.config), pauses to look, and a caption per step. */
export const DEMO = process.env.ACUTE_DEMO === "1";
/** Pause on each review bar, and after each Accept: ACUTE_SHOW_MS, or 3.5 s in demo mode. */
export const SHOW_MS = Number(process.env.ACUTE_SHOW_MS ?? (DEMO ? 3500 : 0));

/**
 * Demo mode only: a caption pinned to the top of the page naming what's being
 * shown ("Test 2 — …"), so a headed run reads like a walkthrough. A no-op
 * otherwise; never intercepts clicks.
 */
export async function caption(page: Page, text: string, detail = ""): Promise<void> {
  if (!DEMO) return;
  await page.evaluate(
    ({ text, detail }) => {
      let el = document.getElementById("acute-e2e-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "acute-e2e-caption";
        el.setAttribute("aria-hidden", "true");
        Object.assign(el.style, {
          position: "fixed",
          top: "56px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: "2147483647",
          pointerEvents: "none",
          maxWidth: "min(900px, calc(100vw - 32px))",
          padding: "10px 16px",
          borderRadius: "10px",
          background: "rgba(30, 30, 46, 0.92)",
          color: "#fff",
          font: "600 15px/1.4 system-ui, sans-serif",
          boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
          textAlign: "center",
        });
        document.body.appendChild(el);
      }
      el.innerHTML = "";
      const title = document.createElement("div");
      title.textContent = text;
      el.appendChild(title);
      if (detail) {
        const sub = document.createElement("div");
        sub.textContent = detail;
        Object.assign(sub.style, { font: "400 13px/1.4 system-ui, sans-serif", opacity: "0.85", marginTop: "2px" });
        el.appendChild(sub);
      }
    },
    { text, detail },
  );
  await page.waitForTimeout(Math.min(SHOW_MS, 2000));
}

/** Demo mode only: a pause to look at the result. */
export async function look(page: Page): Promise<void> {
  if (SHOW_MS) await page.waitForTimeout(SHOW_MS);
}

export const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
export const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
export const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
export const nothingChanged = (p: Page) => p.getByText("Nothing changed — the canvas already matches this content.");

export type Obj = { id: string; x: number; y: number; width: number; height: number; text: string };

/** Objects (blocks, pages or shapes) whose visible text — document text, or a shape's label — matches `pattern`. */
export function objectsMatching(p: Page, pattern: RegExp): Promise<Obj[]> {
  return p.evaluate(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      type Inline = string | { text?: string; content?: unknown };
      type El = { id: string; type: string; x: number; y: number; width: number; height: number; text?: string; containerId?: string | null; customData?: { acute?: { documentId?: string; pageId?: string } } };
      type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown; title?: string } | null } };
      const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      // Only the words a user sees — never the JSON keys and block types ("codeBlock" must not match /lock/).
      const textOf = (v: unknown): string => {
        if (typeof v === "string") return v;
        if (Array.isArray(v)) return v.map(textOf).join(" ");
        if (v && typeof v === "object") {
          const o = v as { text?: Inline; content?: unknown; children?: unknown; rows?: unknown; cells?: unknown };
          return [typeof o.text === "string" ? o.text : "", textOf(o.content), textOf(o.children), textOf(o.rows), textOf(o.cells)].join(" ");
        }
        return "";
      };
      const els = dev.api.getSceneElements();
      const labels = new Map(els.filter((e) => e.type === "text" && e.containerId).map((e) => [e.containerId!, e.text ?? ""] as const));
      return els.flatMap((el) => {
        if (el.type === "text" || el.type === "arrow") return [];
        const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
        const doc = docId ? dev.store.get(docId) : null;
        const text = (doc ? `${doc.title ?? ""} ${textOf(doc.snapshot)}` : (labels.get(el.id) ?? "")).replace(/\s+/g, " ").trim();
        return text && re.test(text) ? [{ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height, text }] : [];
      });
    },
    { source: pattern.source, flags: pattern.flags },
  );
}

/** Every object (not arrows, not shape labels) — for "what did this step create?". */
export function allObjects(p: Page): Promise<Obj[]> {
  return objectsMatching(p, /[\s\S]*/);
}

/** Relation types of the arrows between two objects, either direction ("(none)" for an untyped arrow). */
export function relationsBetween(p: Page, a: string, b: string): Promise<string[]> {
  return p.evaluate(
    ({ a, b }) => {
      type El = { type: string; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null; customData?: { acuteRelation?: string } };
      const els = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements();
      return els.filter((e) => e.type === "arrow" && [e.startBinding?.elementId, e.endBinding?.elementId].sort().join() === [a, b].sort().join()).map((e) => e.customData?.acuteRelation ?? "(none)");
    },
    { a, b },
  );
}

/** One AI workflow's session: records AI requests and attaches each step's model replies to the report. */
export function aiSession(page: Page, requests: Request[]) {
  const generateCalls = () => requests.filter((r) => r.method() === "POST" && aiTaskOf(r) === "generate_visual_plan");

  const attachReplies = async (label: string) => {
    for (const [i, r] of generateCalls().entries()) {
      const body = await (await r.response())?.text().catch(() => "(no body)");
      let text = body ?? "(no response)";
      try {
        text = (JSON.parse(text) as { text?: string }).text ?? text;
      } catch {
        /* not JSON: attach as is */
      }
      await test.info().attach(`${label} — model reply ${i + 1}`, { body: text, contentType: "text/plain" });
    }
  };

  /** Ask AI → Update from new content on `anchorId`; returns the review summary (list expanded), or null for "Nothing changed". */
  const update = async (anchorId: string, text: string, label: string): Promise<string | null> => {
    const surface = await openAskAI(page, anchorId);
    await (await action(surface, "Update from new content")).click();
    await updateDialog(page).getByRole("textbox").fill(text);
    // A previous step's "Nothing changed" toast must not be read as this step's result.
    await expect(nothingChanged(page)).toBeHidden({ timeout: 15_000 });
    requests.length = 0;
    await updateDialog(page).getByRole("button", { name: "Update", exact: true }).click();
    await expect(reviewBar(page).or(nothingChanged(page))).toBeVisible({ timeout: AI_TIMEOUT });
    await attachReplies(label);
    if (!(await reviewBar(page).isVisible())) {
      test.info().annotations.push({ type: `${label} review`, description: "Nothing changed" });
      return null;
    }
    await reviewBar(page).getByRole("button", { name: "Review" }).click();
    const summary = (await reviewBar(page).innerText()).replace(/\s+/g, " ");
    test.info().annotations.push({ type: `${label} review`, description: summary });
    if (SHOW_MS) await page.waitForTimeout(SHOW_MS);
    return summary;
  };

  /** ⋮ → Visualize content…, with a forced template (so the model builds it), then Accept. */
  const visualize = async (text: string, template: string) => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(text);
    await visualizeDialog(page).getByRole("radiogroup", { name: "Template" }).locator(`input[value="${template}"]`).check();
    requests.length = 0;
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await attachReplies("first run");
    if (SHOW_MS) await page.waitForTimeout(SHOW_MS);
    await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
    await expect(reviewBar(page)).toBeHidden();
    await look(page);
  };

  const accept = async () => {
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    await look(page); // the accepted result, before the next step
  };

  const reject = async () => {
    await reviewBar(page).getByRole("button", { name: "Reject" }).click();
    await expect(reviewBar(page)).toBeHidden();
  };

  return { generateCalls, update, visualize, accept, reject };
}
