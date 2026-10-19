/**
 * The desktop app's SQLite storage, through the real Electron IPC (preload -> ipcMain -> node:sqlite):
 * content created in the UI lands in the database and asset files, survives a restart and a hard kill, and a
 * second instance cannot open the database. Runs against the packaged app (default) or `electron .` (dev mode).
 * No AI is used.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Y from "yjs";

const ROOT = resolve(process.cwd()); // `npm run test:desktop-storage` runs from the repo root
const DEV = process.env.ACUTE_DESKTOP_MODE === "dev";
const EXE = process.env.ACUTE_DESKTOP_EXE ?? join(ROOT, "dist-desktop", "win-unpacked", "Acute Notes.exe");
const WORKSPACE = "default";
/** A 2×2 red PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

test.skip(!DEV && !existsSync(EXE), `No packaged app at ${EXE}. Run \`npm run desktop:pack\` first.`);

const userDataDirs: string[] = [];
const apps: ElectronApplication[] = [];

function newUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), "acute-desktop-e2e-"));
  userDataDirs.push(dir);
  return dir;
}

function launchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VS Code shells set it, which would make Electron start as plain Node
  return env;
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch(
    DEV ? { args: [ROOT, `--user-data-dir=${userData}`], cwd: ROOT, env: launchEnv() as Record<string, string> } : { executablePath: EXE, args: [`--user-data-dir=${userData}`], env: launchEnv() as Record<string, string> },
  );
  apps.push(app);
  const page = await app.firstWindow();
  await page.locator(".excalidraw").waitFor({ timeout: 90_000 });
  return { app, page };
}

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => undefined);
});
test.afterAll(() => {
  for (const dir of userDataDirs) rmSync(dir, { recursive: true, force: true });
});

type Response = { ok: true; value: unknown } | { ok: false; error: { code?: string; message: string } };

/** One storage request, exactly as the app's own persistence layer sends it. */
function storage(page: Page, service: string, method: string, ...args: unknown[]): Promise<Response> {
  return page.evaluate(([s, m, a]) => (window as unknown as { acuteDesktop: { storage: { invoke(s: string, m: string, a: unknown[]): Promise<unknown> } } }).acuteDesktop.storage.invoke(s as string, m as string, a as unknown[]), [service, method, args] as const) as Promise<Response>;
}

async function value<T>(page: Page, service: string, method: string, ...args: unknown[]): Promise<T> {
  const res = await storage(page, service, method, ...args);
  if (!res.ok) throw new Error(`${service}.${method}: ${res.error.message}`);
  return res.value as T;
}

/** The live canvas's persisted scene, decoded from the SQLite Yjs log. */
async function sceneElements(page: Page): Promise<{ id: string; type: string }[]> {
  const ws = await value<{ canvasIds: string[] } | null>(page, "workspaces", "get", WORKSPACE);
  const canvasId = ws?.canvasIds[0];
  if (!canvasId) return [];
  const { updates } = await value<{ updates: Uint8Array[] }>(page, "yupdates", "load", `canvas/${canvasId}`);
  const doc = new Y.Doc();
  updates.forEach((u) => Y.applyUpdate(doc, u));
  return [...doc.getMap("elements").values()].map((e) => e as { id: string; type: string; isDeleted?: boolean }).filter((e) => !e.isDeleted).map(({ id, type }) => ({ id, type }));
}

/** Read-only look into the database file itself, from the test process (WAL allows a concurrent reader). */
function sqlite<T>(userData: string, query: string): T[] {
  const { DatabaseSync } = createRequire(join(ROOT, "package.json"))("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(userData, "storage", "acute-notes.sqlite3"), { readOnly: true });
  try {
    return db.prepare(query).all() as T[];
  } finally {
    db.close();
  }
}

const assetFiles = (userData: string): string[] => {
  const root = join(userData, "storage", "assets");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else out.push(join(dir, entry.name));
    }
  };
  walk(root);
  return out;
};

async function drawRectangle(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await page.keyboard.press("r");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 140, y + 90, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function insertCanvasImage(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("i");
  await (await chooser).setFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await page.mouse.click(760, 520);
}

async function addPageWithTextAndImage(page: Page, text: string): Promise<void> {
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await page.keyboard.press("b");
  await page.getByRole("menuitem", { name: "Page" }).click();
  const editor = page.locator(".acute-page-editor .ProseMirror");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type(text);
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    const el = document.querySelector<HTMLElement>(".acute-page-editor .ProseMirror")!;
    el.focus();
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
}

type PageDoc = { id: string; snapshot: { type: string; props?: { url?: string } }[] };

test("content created in the UI is stored in SQLite and asset files, and survives a restart", async () => {
  const userData = newUserData();
  const first = await launch(userData);

  // The renderer is wired to the store, and offers nothing but `invoke`.
  expect(await first.page.evaluate(() => Object.keys((window as unknown as { acuteDesktop: { storage: object } }).acuteDesktop.storage))).toEqual(["invoke"]);
  expect(await first.page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
  expect((await value<{ id: string } | null>(first.page, "workspaces", "get", WORKSPACE))?.id).toBe(WORKSPACE);

  await drawRectangle(first.page, 420, 300);
  await insertCanvasImage(first.page);
  await addPageWithTextAndImage(first.page, "hello desktop storage");

  await expect
    .poll(async () => {
      const types = (await sceneElements(first.page)).map((e) => e.type);
      const pages = await value<PageDoc[]>(first.page, "documents", "listByWorkspace", WORKSPACE, "page");
      const imageInPage = pages.some((p) => p.snapshot.some((b) => b.type === "image" && b.props?.url?.startsWith("acute-asset://")));
      return { rect: types.includes("rectangle"), canvasImage: types.includes("image"), pageImage: imageInPage, assetFiles: assetFiles(userData).length > 0 };
    }, { timeout: 30_000 })
    .toEqual({ rect: true, canvasImage: true, pageImage: true, assetFiles: true });

  // The database file, read directly: the rows are there, and the file system holds the bytes.
  expect(sqlite<{ c: number }>(userData, "SELECT COUNT(*) AS c FROM yupdates")[0]!.c).toBeGreaterThan(0);
  expect(sqlite<{ c: number }>(userData, "SELECT COUNT(*) AS c FROM documents WHERE kind = 'page'")[0]!.c).toBe(1);
  const assetRows = sqlite<{ id: string; file: string; size: number }>(userData, "SELECT id, file, size FROM assets");
  expect(assetRows.length).toBeGreaterThanOrEqual(1);
  for (const row of assetRows) expect(existsSync(join(userData, "storage", "assets", row.file))).toBe(true);
  const pageBefore = (await value<PageDoc[]>(first.page, "documents", "listByWorkspace", WORKSPACE, "page"))[0]!;
  const sceneBefore = (await sceneElements(first.page)).map((e) => e.id).sort();

  await first.app.close();

  // Relaunch on the same folder: nothing duplicated, nothing lost, images still resolve.
  const second = await launch(userData);
  expect(await value<unknown[]>(second.page, "canvases", "listByWorkspace", WORKSPACE)).toHaveLength(1);
  expect(await value<unknown[]>(second.page, "workspaces", "list")).toHaveLength(1);
  expect((await sceneElements(second.page)).map((e) => e.id).sort()).toEqual(sceneBefore);
  const pageAfter = (await value<PageDoc[]>(second.page, "documents", "listByWorkspace", WORKSPACE, "page"))[0]!;
  expect(pageAfter).toEqual(pageBefore);
  for (const row of assetRows) expect(await value<boolean>(second.page, "assets", "has", row.id)).toBe(true);
  expect(sqlite<{ integrity_check: string }>(userData, "PRAGMA integrity_check")[0]!.integrity_check).toBe("ok");
});

test("data written just before a hard kill is still there after relaunch", async () => {
  const userData = newUserData();
  const first = await launch(userData);
  await drawRectangle(first.page, 420, 300);
  await expect.poll(async () => (await sceneElements(first.page)).filter((e) => e.type === "rectangle").length, { timeout: 30_000 }).toBe(1);

  const pid = first.app.process().pid!;
  execFileSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore" }); // no graceful shutdown: no quit handlers run
  apps.splice(apps.indexOf(first.app), 1);

  const second = await launch(userData);
  await expect.poll(async () => (await sceneElements(second.page)).filter((e) => e.type === "rectangle").length).toBe(1);
  expect(sqlite<{ integrity_check: string }>(userData, "PRAGMA integrity_check")[0]!.integrity_check).toBe("ok");
});

test("a second instance on the same data folder quits without touching the database", async () => {
  test.skip(DEV, "uses the packaged executable");
  const userData = newUserData();
  const first = await launch(userData);
  const before = sqlite<{ c: number }>(userData, "SELECT COUNT(*) AS c FROM workspaces")[0]!.c;

  const second = spawn(EXE, [`--user-data-dir=${userData}`], { env: launchEnv(), stdio: "ignore" });
  const exit = await new Promise<number | null>((done) => {
    const timer = setTimeout(() => {
      second.kill();
      done(-1);
    }, 30_000);
    second.once("exit", (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
  expect(exit).toBe(0); // the lock made it quit on its own

  expect(sqlite<{ c: number }>(userData, "SELECT COUNT(*) AS c FROM workspaces")[0]!.c).toBe(before);
  expect(await value<unknown[]>(first.page, "workspaces", "list")).toHaveLength(1); // the first instance still works
});

test("a bad or foreign request is refused with a structured error", async () => {
  const userData = newUserData();
  const { page } = await launch(userData);
  const unknown = await storage(page, "workspaces", "exec", "DROP TABLE workspaces");
  expect(unknown).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  const wrongType = await storage(page, "workspaces", "get", { not: "a string" });
  expect(wrongType).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  expect(await value<unknown[]>(page, "workspaces", "list")).toHaveLength(1);
});
