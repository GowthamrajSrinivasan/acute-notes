// Main-process blocking benchmark for the desktop SQLite store (plan B8). Runs the real services behind the real
// dispatcher; arguments and results go through structuredClone, as over Electron IPC. Because SQLite is synchronous,
// a request's service time IS the time the main process is blocked.
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/perf/desktopStorageBench.cjs
//
// (Run under Electron's own Node so the numbers match the app; plain `node` works too.)
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initStorage } = require("../../electron/storage/index.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acute-bench-"));
const storage = initStorage(dir);
const call = async (service, method, ...args) => {
  const res = structuredClone(await storage.invoke(service, method, structuredClone(args)));
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
};
const stats = (ms) => {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: +q(0.5).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};
async function each(n, fn) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn(i);
    times.push(performance.now() - t);
  }
  return stats(times);
}
const bytes = (n) => new Uint8Array(crypto.randomBytes(n));
const doc = (i) => ({ id: `d${i}`, workspaceId: "ws", kind: i % 3 ? "block" : "page", title: `Doc ${i}`, snapshot: [{ type: "paragraph", content: "x".repeat(2000) }], createdAt: 1, updatedAt: 1 });

(async () => {
  const out = { runtime: { electron: process.versions.electron ?? null, node: process.versions.node } };
  out.append_single_600B_x2000 = await each(2000, (i) => call("yupdates", "append", `doc${i % 40}`, bytes(600)));

  let t = performance.now();
  for (let i = 0; i < 1000; i++) await call("yupdates", "append", "big", bytes(1500));
  out.append_1000_sequential_total_ms = +(performance.now() - t).toFixed(0);

  out.load_doc_1000_updates = await each(30, () => call("yupdates", "load", "big"));
  const { keys } = await call("yupdates", "load", "big");
  t = performance.now();
  await call("yupdates", "compact", "big", keys, bytes(200_000));
  out.compact_1000_to_1_ms = +(performance.now() - t).toFixed(1);

  out.put_document_x3000_2KB = await each(3000, (i) => call("documents", "put", doc(i)));
  out.list_3000_documents = await each(10, () => call("documents", "listByWorkspace", "ws"));
  out.list_pages_only = await each(10, () => call("documents", "listByWorkspace", "ws", "page"));
  out.getMany_200 = await each(20, () => call("documents", "getMany", Array.from({ length: 200 }, (_, i) => `d${i * 10}`)));

  const ids = [];
  out.asset_put_2MB_x20 = await each(20, async (i) => {
    const data = bytes(2 * 1024 * 1024);
    const id = crypto.createHash("sha1").update(data).digest("hex");
    ids.push(id);
    await call("assets", "put", { id, data, mimeType: "image/png", createdAt: i });
  });
  out.asset_get_2MB_x20 = await each(20, (i) => call("assets", "get", ids[i]));
  out.asset_has_x500 = await each(500, (i) => call("assets", "has", ids[i % ids.length]));

  out.db_size_mb = +(fs.statSync(path.join(dir, "storage", "acute-notes.sqlite3")).size / 1048576).toFixed(1);
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
