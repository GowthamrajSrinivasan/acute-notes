/**
 * Shared helpers for the e2e suites (`e2e/local`, `e2e/ai`). Scene/document
 * access goes through the dev hooks (`window.__acuteDev`), which dev builds expose.
 */
import { expect, type Locator, type Page, type Request } from "@playwright/test";

export interface BlockInfo {
  id: string;
  kind: "rich-block" | "page-preview";
  blockType?: string;
  documentId: string;
  preview?: boolean;
}

export interface ElementInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  containerId?: string | null;
  relation?: string;
  acute?: { kind: string; blockType?: string; documentId?: string; pageId?: string; preview?: boolean; frame?: string };
}

export async function openApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await waitForCanvas(page);
}

export async function waitForCanvas(page: Page): Promise<void> {
  await page.locator(".excalidraw").waitFor();
  await page.waitForFunction(() => Boolean((window as unknown as { __acuteDev?: unknown }).__acuteDev));
}

/** Every live scene element, flattened to what tests assert on. */
export function elements(page: Page): Promise<ElementInfo[]> {
  return page.evaluate(() => {
    type El = {
      id: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      text?: string;
      containerId?: string | null;
      customData?: {
        acute?: { kind: string; blockType?: string; documentId?: string; pageId?: string; preview?: boolean; style?: { frame: string } };
        acuteRelation?: string;
      };
    };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    return api.getSceneElements().map((el) => {
      const a = el.customData?.acute;
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        ...(el.text !== undefined ? { text: el.text } : {}),
        ...(el.containerId ? { containerId: el.containerId } : {}),
        ...(el.customData?.acuteRelation ? { relation: el.customData.acuteRelation } : {}),
        ...(a ? { acute: { kind: a.kind, blockType: a.blockType, documentId: a.documentId, pageId: a.pageId, preview: a.preview, frame: a.style?.frame } } : {}),
      };
    });
  });
}

/** Acute blocks and page previews on the canvas. */
export async function blocks(page: Page): Promise<BlockInfo[]> {
  return (await elements(page)).flatMap((el) =>
    el.acute
      ? [
          {
            id: el.id,
            kind: el.acute.kind as BlockInfo["kind"],
            blockType: el.acute.blockType,
            documentId: (el.acute.documentId ?? el.acute.pageId)!,
            preview: el.acute.preview,
          },
        ]
      : [],
  );
}

export interface DocumentInfo {
  title: string;
  snapshot: Array<{ type: string; content?: unknown; props?: Record<string, unknown> }>;
  metadata?: { ai?: Record<string, unknown> };
}

export function documentOf(page: Page, documentId: string): Promise<DocumentInfo | null> {
  return page.evaluate((id) => {
    const store = (window as unknown as { __acuteDev: { store: { get(id: string): unknown } } }).__acuteDev.store;
    return (store.get(id) as DocumentInfo | null) ?? null;
  }, documentId);
}

/** Finds a block/page element by its document title. */
export async function blockByTitle(page: Page, title: string): Promise<BlockInfo> {
  for (const b of await blocks(page)) {
    if ((await documentOf(page, b.documentId))?.title === title) return b;
  }
  throw new Error(`No block titled "${title}"`);
}

/** Finds a shape by its bound label text. */
export async function shapeByLabel(page: Page, label: string): Promise<ElementInfo> {
  const els = await elements(page);
  const text = els.find((el) => el.type === "text" && el.containerId && el.text === label);
  const shape = text && els.find((el) => el.id === text.containerId);
  if (!shape) throw new Error(`No shape labelled "${label}"`);
  return shape;
}

export function select(page: Page, ...ids: string[]): Promise<void> {
  return page.evaluate((selected) => {
    const api = (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void } } }).__acuteDev.api;
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(selected.map((id) => [id, true])), selectedGroupIds: {}, activeEmbeddable: null } });
  }, ids);
}

export function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { getAppState(): { selectedElementIds: Record<string, true> } } } }).__acuteDev.api;
    return Object.keys(api.getAppState().selectedElementIds);
  });
}

/** Pastes Markdown onto the canvas at a point (becomes an Acute text item) and returns its element id. */
export async function pasteText(page: Page, text: string, at: { x: number; y: number }): Promise<string> {
  const before = new Set((await blocks(page)).map((b) => b.id));
  await page.keyboard.press("Escape");
  await page.mouse.click(at.x, at.y);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press("ControlOrMeta+V");
  await expect.poll(async () => (await blocks(page)).filter((b) => !before.has(b.id)).length).toBe(1);
  return (await blocks(page)).find((b) => !before.has(b.id))!.id;
}

/**
 * The selection's `✨ Ask AI` (in the properties panel): shown only for
 * selections with usable content. The header has its own, always-visible one
 * (`headerAskAIButton`).
 */
export function askAIButton(page: Page): Locator {
  return page.getByRole("main", { name: "Canvas" }).getByRole("button", { name: "Ask AI" });
}

/** The header's `✨ Ask AI` (selection, else the whole canvas); hidden only while AI mode is Off. */
export function headerAskAIButton(page: Page): Locator {
  return page.getByRole("banner").getByRole("button", { name: "Ask AI" });
}

/** The AI side panel (Chat and History tabs). */
export function askAISurface(page: Page): Locator {
  return page.getByRole("complementary", { name: "Ask AI" });
}

/** Selects the elements and opens the AI panel on its Chat tab. */
export async function openAskAI(page: Page, ...ids: string[]): Promise<Locator> {
  await select(page, ...ids);
  await askAIButton(page).click();
  const surface = askAISurface(page);
  await expect(surface.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  return surface;
}

/** Selects the elements and opens the AI panel on its History tab (clock button). */
export async function openHistory(page: Page, ...ids: string[]): Promise<Locator> {
  await select(page, ...ids);
  await page.getByRole("button", { name: "AI conversation history" }).click();
  const panel = askAISurface(page);
  await expect(panel.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  return panel;
}

export async function showConversations(panel: Locator, which: "Selected" | "All on this canvas"): Promise<void> {
  await panel.getByRole("radiogroup", { name: "Show conversations" }).getByText(which, { exact: true }).click();
  await expect(panel.getByRole("radio", { name: which })).toBeChecked();
}

/** The Sharing chip above the composer (what the chat can see; click to change the scope). */
export function sharingChip(surface: Locator): Locator {
  return surface.getByRole("button", { name: /^Sharing/ });
}

export async function chooseScope(surface: Locator, scope: "Selection" | "This canvas" | "This workspace"): Promise<void> {
  await sharingChip(surface).click();
  await surface.getByRole("radiogroup", { name: "AI scope" }).getByText(scope, { exact: true }).click();
  if (scope !== "Selection") await expect(sharingChip(surface)).toContainText(`Sharing ${scope.toLowerCase()}`);
}

/** An action in the composer's actions menu (opened by the Actions button, like typing "/"). */
export async function action(surface: Locator, label: string): Promise<Locator> {
  const menu = surface.getByRole("menu", { name: "AI actions" });
  if (!(await menu.isVisible())) await surface.getByRole("button", { name: "Actions" }).click();
  return menu.getByRole("menuitem", { name: new RegExp(`^${label}`) });
}

export async function openAISettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "AI settings" }).click();
  const dialog = page.getByRole("dialog", { name: "AI Providers" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function setAIMode(page: Page, mode: "On" | "Off"): Promise<void> {
  const settings = await openAISettings(page);
  await settings.getByRole("radiogroup", { name: "AI features" }).getByText(mode).click();
  await expect(settings.getByRole("radiogroup", { name: "AI features" }).getByRole("radio", { name: mode })).toBeChecked();
  await settings.getByRole("button", { name: "Close" }).click();
}

/** Connects the machine's signed-in Copilot subscription (it becomes primary, being the first connection). */
export async function connectCopilot(page: Page): Promise<void> {
  const settings = await openAISettings(page);
  const row = settings.locator(".acute-ai-row", { hasText: "GitHub Copilot" });
  await row.getByRole("button", { name: "Connect", exact: true }).click();
  const connect = page.getByRole("dialog", { name: "Connect GitHub Copilot" });
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connect).toBeHidden();
  // The first connection becomes primary on its own.
  await expect(row.getByRole("button", { name: "★ Primary" })).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
}

/** ⋮ → Create AI test canvas; waits until the canvas is filled. */
export async function createDemoCanvas(page: Page): Promise<void> {
  const before = page.url();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Create AI test canvas/ }).click();
  await page.waitForURL((url) => url.href !== before);
  await waitForCanvas(page);
  await page.waitForFunction(() => {
    const dev = (window as unknown as { __acuteDev?: { api: { getSceneElements(): unknown[] } } }).__acuteDev;
    return (dev?.api.getSceneElements().length ?? 0) > 20;
  });
  // Documents are cached as the canvas seeds; give previews a moment to resolve.
  await expect.poll(async () => (await blocks(page)).length).toBeGreaterThanOrEqual(8);
}

/** Records requests to the AI host (`/api/ai/*`). */
export function recordAIRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/ai/")) requests.push(r);
  });
  return requests;
}

export interface RecordedUsage {
  task?: string;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Records token usage from every `/api/ai/run` response (the route returns the whole `AIResponse`, `usage`
 * included, verbatim — see `src/app/api/ai/run/route.ts`). Streaming (`/api/ai/stream`) isn't covered: Visualize's
 * structured-output tasks (`outline_document`, `generate_visual_plan`) always go through the non-streaming route.
 */
export function recordAIUsage(page: Page): RecordedUsage[] {
  const usages: RecordedUsage[] = [];
  page.on("response", (res) => {
    if (new URL(res.url()).pathname !== "/api/ai/run") return;
    void res
      .json()
      .then((body: unknown) => {
        const r = body as { usage?: { provider?: string; model?: string; promptTokens?: number; completionTokens?: number } };
        if (!r?.usage) return;
        const task = (res.request().postDataJSON() as { request?: { task?: string } } | null)?.request?.task;
        usages.push({ task, provider: r.usage.provider ?? "", model: r.usage.model ?? "", promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens });
      })
      .catch(() => {}); // a failed/non-JSON response (e.g. an error page) contributes no usage, never throws
  });
  return usages;
}

/** The prompt text sent in an AI host request. */
export function promptOf(request: Request): string {
  const body = request.postDataJSON() as { request?: { prompt?: string } } | null;
  return body?.request?.prompt ?? "";
}

export function aiTaskOf(request: Request): string | undefined {
  return (request.postDataJSON() as { request?: { task?: string } } | null)?.request?.task;
}

/**
 * Accepts the AI change set under review (F19): Insert only proposes; the
 * review bar's Accept all writes it as one undo step.
 */
export async function acceptProposal(page: Page): Promise<void> {
  const bar = page.getByRole("region", { name: "AI changes to review" });
  await bar.getByRole("button", { name: "Accept all" }).click();
  await expect(bar).toBeHidden();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added");
}

/** Undo through the app's history (the same path as Ctrl+Z). */
export function undo(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as { __acuteDev: { history: { undo(): void } } }).__acuteDev.history.undo());
}

/** workspaceId / canvasId of the open canvas, from the URL. */
export function canvasHome(page: Page): { workspaceId: string; canvasId: string } {
  const [, , workspaceId, canvasId] = new URL(page.url()).pathname.split("/");
  return { workspaceId: decodeURIComponent(workspaceId!), canvasId: decodeURIComponent(canvasId!) };
}

/**
 * Saves a conversation directly through the app's conversation store (dev
 * hook), with no AI call, so history UI can be tested deterministically.
 */
export function seedConversation(
  page: Page,
  input: { anchorIds: string[]; anchorLabel: string; question: string; reply: string; action?: string },
): Promise<string> {
  return page.evaluate(
    async ({ home, input }) => {
      type Store = {
        start(i: unknown): { id: string };
        recordExchange(id: string, u: unknown, a: unknown): Promise<unknown>;
      };
      const store = (window as unknown as { __acuteDev: { conversations: Store } }).__acuteDev.conversations;
      const c = store.start({ ...home, anchorIds: input.anchorIds, anchorLabel: input.anchorLabel, scope: "selection" });
      await store.recordExchange(
        c.id,
        { action: input.action, text: input.question, scope: "selection", sourceIds: input.anchorIds },
        {
          kind: "note",
          title: input.action ? "Summary" : "Answer",
          text: input.reply,
          provenance: { task: "chat", providerId: "copilot", role: "primary", model: "test", operationId: "op_test" },
        },
      );
      return c.id;
    },
    { home: canvasHome(page), input },
  );
}

/** The AI panel (its History tab when opened from the clock or ⋮ → AI conversations). */
export function historyPanel(page: Page): Locator {
  return askAISurface(page);
}
