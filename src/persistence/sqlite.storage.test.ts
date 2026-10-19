import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteTestBackend, disposeSqliteTestBackends } from "./conformance/sqliteBackend";
import { StorageIpcError, STORAGE_METHODS } from "./repositories/ipc";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const { openDatabase: rawOpenDatabase, SCHEMA_VERSION } = require("../../electron/storage/db.cjs") as any;
const { createAssetFiles, fileNameFor } = require("../../electron/storage/assets.cjs") as any;
const { createStorageServices } = require("../../electron/storage/services.cjs") as any;
const { createDispatcher, registerStorageIpc, isTrustedSender, methodTable } = require("../../electron/storage/ipc.cjs") as any;
const { initStorage } = require("../../electron/storage/index.cjs") as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const dirs: string[] = [];
const openDbs: { close(): void }[] = [];
/** Opens a database and closes it in `afterAll` (an open handle blocks deleting its temp folder on Windows). */
const openDatabase = (file: string) => {
  const db = rawOpenDatabase(file);
  openDbs.push(db);
  return db;
};
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "acute-sqlite-storage-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const db of openDbs) {
    try {
      db.close();
    } catch {
      // Already closed by the test.
    }
  }
  disposeSqliteTestBackends();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const HASH_A = "a".repeat(40);

describe("schema and migrations (B1)", () => {
  it("creates schema v1 in a new file, and reopening keeps the data without re-migrating", () => {
    const file = join(tmp(), "db.sqlite3");
    const db = openDatabase(file);
    expect(db.prepare("PRAGMA user_version").get().user_version).toBe(SCHEMA_VERSION);
    expect(db.prepare("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    expect(db.prepare("PRAGMA foreign_keys").get().foreign_keys).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r: { name: string }) => r.name).sort();
    expect(tables).toEqual(
      ["agent_changes", "agent_sessions", "ai_connections", "ai_conversations", "ai_turns", "assets", "canvases", "content_source_versions", "content_sources", "documents", "meta", "repo_maps", "workspaces", "yupdates"].sort(),
    );
    db.prepare("INSERT INTO workspaces(id, json) VALUES('w', '{}')").run();
    db.close();

    const again = openDatabase(file);
    expect(again.prepare("SELECT COUNT(*) AS c FROM workspaces").get().c).toBe(1);
    again.close();
  });

  it("refuses a database written by a newer schema, with a clear message, and releases the file", () => {
    const file = join(tmp(), "db.sqlite3");
    openDatabase(file).close();
    const { DatabaseSync } = require("node:sqlite");
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();

    expect(() => openDatabase(file)).toThrow(/newer version of Acute Notes/);
    try {
      openDatabase(file);
    } catch (err) {
      expect((err as { code?: string }).code).toBe("DB_TOO_NEW");
    }
    rmSync(file); // would fail on Windows if the failed open had leaked the handle
    expect(existsSync(file)).toBe(false);
  });
});

describe("asset files (B3)", () => {
  it("stores a content-hash id as <root>/<first two chars>/<id> and nothing else in the database folder", async () => {
    const b = createSqliteTestBackend();
    await b.services.assets.put({ id: HASH_A, blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), mimeType: "image/png", createdAt: 1 });
    expect(existsSync(join(b.dir, "storage", "assets", "aa", HASH_A))).toBe(true);
    expect(readdirSync(join(b.dir, "storage", "assets", "aa"))).toEqual([HASH_A]); // no leftover temp files
  });

  it("keeps hostile ids inside the asset folder and gives case-different ids different files", async () => {
    const b = createSqliteTestBackend();
    const put = (id: string, byte: number) => b.services.assets.put({ id, blob: new Blob([new Uint8Array([byte])]), mimeType: "image/png", createdAt: 1 });
    await put("../../../escape", 1);
    await put("..\\..\\escape2", 2);
    await put("A", 3);
    await put("a", 4);
    expect(fileNameFor("../../../escape")).not.toContain("..");
    expect(fileNameFor("A")).not.toBe(fileNameFor("a"));
    const bytes = async (id: string) => [...new Uint8Array(await (await b.services.assets.get(id))!.blob.arrayBuffer())];
    expect([await bytes("A"), await bytes("a")]).toEqual([[3], [4]]);
    expect(await bytes("../../../escape")).toEqual([1]);
    expect(existsSync(join(b.dir, "escape"))).toBe(false);
    expect(readdirSync(b.dir)).toEqual(["storage"]); // nothing was written beside the storage folder
  });

  it("reports an asset as missing when its file is gone, and never leaves a row for a failed write", async () => {
    const root = tmp();
    const db = openDatabase(join(root, "db.sqlite3"));
    const real = createAssetFiles(join(root, "assets"));
    const services = createStorageServices(db, real);
    await services.assets.put({ id: HASH_A, data: new Uint8Array([9]), mimeType: "image/png", createdAt: 1 });
    expect(await services.assets.has(HASH_A)).toBe(true);
    real.remove(fileNameFor(HASH_A));
    expect(await services.assets.has(HASH_A)).toBe(false);
    expect(await services.assets.get(HASH_A)).toBeNull();

    const failing = createStorageServices(db, { ...real, write: () => { throw new Error("disk full"); } });
    await expect(failing.assets.put({ id: "b".repeat(40), data: new Uint8Array([1]), mimeType: "image/png", createdAt: 1 })).rejects.toThrow("disk full");
    expect(db.prepare("SELECT COUNT(*) AS c FROM assets WHERE id = ?").get("b".repeat(40)).c).toBe(0);
    db.close();
  });

  it("writes atomically: a failed rename leaves no partial or temporary file", () => {
    const root = tmp();
    const files = createAssetFiles(join(root, "assets"));
    const target = fileNameFor(HASH_A);
    mkdirSync(join(root, "assets", target), { recursive: true }); // a directory where the file should go: rename fails
    expect(() => files.write(target, new Uint8Array([1]))).toThrow();
    expect(readdirSync(join(root, "assets", "aa")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("validated IPC boundary (B4)", () => {
  const services = (() => {
    const root = tmp();
    return createStorageServices(openDatabase(join(root, "db.sqlite3")), createAssetFiles(join(root, "assets")));
  })();
  const invoke = createDispatcher(services);

  it("exposes exactly the methods of the contract: contract, main-process services and renderer proxy agree", () => {
    const fromServices = Object.fromEntries(Object.entries(services).map(([s, api]) => [s, Object.keys(api as object).sort()]));
    const fromContract = Object.fromEntries(Object.entries(methodTable()).map(([s, m]) => [s, Object.keys(m as object).sort()]));
    const fromProxy = Object.fromEntries(Object.entries(STORAGE_METHODS).map(([s, m]) => [s, [...m].sort()]));
    expect(fromContract).toEqual(fromServices);
    expect(fromProxy).toEqual(fromServices);
  });

  it("rejects unknown services and methods, including prototype tricks, without running anything", async () => {
    for (const [service, method] of [["nope", "get"], ["workspaces", "nope"], ["__proto__", "get"], ["workspaces", "constructor"], ["workspaces", "__proto__"], ["constructor", "constructor"], ["workspaces", "toString"]]) {
      const res = await invoke(service, method, ["x"]);
      expect(res).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    }
    expect(await invoke(42, "get", [])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("workspaces", "get", "x")).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
  });

  it("rejects wrongly-typed, oversized and extra arguments, and treats SQL text as an ordinary id", async () => {
    expect(await invoke("workspaces", "get", [123])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("workspaces", "get", [""])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("workspaces", "get", ["x".repeat(2000)])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("workspaces", "get", ["a", "b"])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("workspaces", "put", ["string"])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("workspaces", "put", [[1, 2]])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("documents", "getMany", [["ok", 5]])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("yupdates", "append", ["d", [1, 2, 3]])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("yupdates", "compact", ["d", [1.5], new Uint8Array(1)])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await invoke("assets", "put", [{ id: "a", mimeType: "x", createdAt: 1, data: "not bytes" }])).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });

    // An injection attempt is just a string key: parameters are always bound, never concatenated.
    const evil = "x'; DROP TABLE workspaces; --";
    expect(await invoke("workspaces", "get", [evil])).toEqual({ ok: true, value: null });
    expect(await invoke("workspaces", "list", [])).toEqual({ ok: true, value: [] });
  });

  it("returns database errors as a structured error, not a crash", async () => {
    const res = await invoke("workspaces", "put", [{ name: "no id" }]);
    expect(res.ok).toBe(false);
    expect(typeof res.error.message).toBe("string");
  });

  it("surfaces an error from the main process as a StorageIpcError with its code in the renderer", async () => {
    const b = createSqliteTestBackend();
    const err = await b.services.workspaces.get("").catch((e) => e);
    expect(err).toBeInstanceOf(StorageIpcError);
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("only trusts the app's own main frame, and refuses other senders before touching storage", async () => {
    const mainFrame = { url: "acute://app/workspace" };
    const sender = { mainFrame };
    expect(isTrustedSender({ senderFrame: mainFrame, sender })).toBe(true);
    expect(isTrustedSender({ senderFrame: { url: "https://evil.example/" }, sender })).toBe(false);
    expect(isTrustedSender({ senderFrame: { url: "acute://app.evil.example/" }, sender })).toBe(false);
    expect(isTrustedSender({ senderFrame: { url: "acute://app/x" }, sender: { mainFrame: {} } })).toBe(false); // a subframe
    expect(isTrustedSender({ senderFrame: null, sender })).toBe(false);

    let handler: ((event: unknown, ...args: unknown[]) => Promise<unknown>) | undefined;
    let calls = 0;
    registerStorageIpc({ handle: (_ch: string, h: typeof handler) => void (handler = h) }, async () => (calls++, { ok: true, value: null }));
    expect(await handler!({ senderFrame: { url: "https://evil.example/" }, sender }, "workspaces", "list", [])).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(calls).toBe(0);
    expect(await handler!({ senderFrame: mainFrame, sender }, "workspaces", "list", [])).toEqual({ ok: true, value: null });
    expect(calls).toBe(1);
  });
});

describe("restart persistence (B2/B6)", () => {
  it("returns every kind of data after the database is closed and opened again from the same folder", async () => {
    const dir = tmp();
    const first = createSqliteTestBackend(dir);
    const s1 = first.services;
    await s1.workspaces.put({ id: "w", name: "W", canvasIds: ["c"], createdAt: 1, updatedAt: 1 });
    await s1.documents.put({ id: "d", workspaceId: "w", kind: "page", title: "T", snapshot: [], createdAt: 1, updatedAt: 1 });
    await s1.yupdates.append("doc", new Uint8Array([1, 2, 3]));
    await s1.meta.set("k", { when: new Date(5), bytes: new Uint8Array([7]) });
    await s1.assets.put({ id: HASH_A, blob: new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }), mimeType: "image/png", createdAt: 9 });
    first.storage.close();

    const second = initStorage(dir);
    const { createIpcServices } = await import("./repositories/ipc");
    const s2 = createIpcServices(async (s, m, a) => structuredClone(await second.invoke(s, m, structuredClone(a))));
    expect((await s2.workspaces.get("w"))?.name).toBe("W");
    expect((await s2.documents.get("d"))?.title).toBe("T");
    expect([...(await s2.yupdates.load("doc")).updates[0]!]).toEqual([1, 2, 3]);
    const meta = (await s2.meta.get("k")) as { when: Date; bytes: Uint8Array };
    expect(meta.when).toEqual(new Date(5));
    expect([...meta.bytes]).toEqual([7]);
    expect([...new Uint8Array(await (await s2.assets.get(HASH_A))!.blob.arrayBuffer())]).toEqual([4, 5, 6]);
    second.close();
  });

  it("starts with an empty store in a brand-new folder", async () => {
    const b = createSqliteTestBackend();
    expect(await b.services.workspaces.list()).toEqual([]);
    expect(existsSync(join(b.dir, "storage", "acute-notes.sqlite3"))).toBe(true);
    writeFileSync(join(b.dir, "storage", "marker"), "x"); // the folder is ours to write in
  });
});
