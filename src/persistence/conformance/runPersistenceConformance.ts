/**
 * The persistence contract as executable tests. Every backend of `PersistenceServices` (memory, IndexedDB, the
 * desktop SQLite store directly and through its IPC boundary) must pass this exact suite, so behaviour cannot drift
 * between platforms. See .ai/docs/sqlite-desktop-storage-plan.md.
 *
 * `create` must return a fresh, empty set of services each call.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DocumentRecord } from "@/domain/types";
import { DocumentProvider } from "@/sync/DocumentProvider";
import type { PersistenceServices } from "../repositories/types";
import { openWorkspace } from "../workspaceBootstrap";

export type ServicesFactory = () => PersistenceServices | Promise<PersistenceServices>;

export function doc(id: string, workspaceId: string, kind: DocumentRecord["kind"]): DocumentRecord {
  return { id, workspaceId, kind, title: id, snapshot: [], createdAt: 1, updatedAt: 1 };
}

const bytes = (...n: number[]) => new Uint8Array(n);
const arrays = (updates: Uint8Array[]) => updates.map((u) => [...u]);

export function runPersistenceConformance(name: string, create: ServicesFactory): void {
  describe(`${name} repositories (conformance)`, () => {
    describe("workspaces, canvases, documents", () => {
      it("returns null for missing records and overwrites on put", async () => {
        const s = await create();
        expect(await s.workspaces.get("nope")).toBeNull();
        expect(await s.canvases.get("nope")).toBeNull();
        expect(await s.documents.get("nope")).toBeNull();

        await s.workspaces.put({ id: "w", name: "One", canvasIds: [], createdAt: 1, updatedAt: 1 });
        await s.workspaces.put({ id: "w", name: "Two", canvasIds: ["c"], createdAt: 1, updatedAt: 2 });
        expect(await s.workspaces.get("w")).toEqual({ id: "w", name: "Two", canvasIds: ["c"], createdAt: 1, updatedAt: 2 });
        expect((await s.workspaces.list()).map((w) => w.id)).toEqual(["w"]);
        await s.workspaces.delete("w");
        expect(await s.workspaces.get("w")).toBeNull();
        await s.workspaces.delete("w"); // deleting a missing record is not an error
      });

      it("stores canvases by workspace", async () => {
        const s = await create();
        const now = Date.now();
        await s.canvases.put({ id: "cv1", workspaceId: "ws1", title: "A", createdAt: now, updatedAt: now });
        await s.canvases.put({ id: "cv2", workspaceId: "ws2", title: "B", createdAt: now, updatedAt: now });
        expect((await s.canvases.listByWorkspace("ws1")).map((c) => c.id)).toEqual(["cv1"]);
        await s.canvases.delete("cv1");
        expect(await s.canvases.listByWorkspace("ws1")).toEqual([]);
        expect(await s.canvases.get("cv2")).not.toBeNull();
      });

      it("lists documents by workspace and kind", async () => {
        const { documents } = await create();
        await documents.put(doc("page_1", "ws1", "page"));
        await documents.put(doc("doc_1", "ws1", "block"));
        await documents.put(doc("page_2", "ws2", "page"));
        expect((await documents.listByWorkspace("ws1", "page")).map((d) => d.id)).toEqual(["page_1"]);
        expect((await documents.listByWorkspace("ws1")).map((d) => d.id).sort()).toEqual(["doc_1", "page_1"]);
        expect(await documents.listByWorkspace("ws_none")).toEqual([]);
      });

      it("reads several documents at once in request order, null for missing", async () => {
        const { documents } = await create();
        await documents.put(doc("a", "ws", "page"));
        await documents.put(doc("b", "ws", "block"));
        const many = await documents.getMany(["b", "missing", "a", "b"]);
        expect(many.map((d) => d?.id ?? null)).toEqual(["b", null, "a", "b"]);
        expect(await documents.getMany([])).toEqual([]);
      });

      it("round-trips rich document content, metadata and optional fields exactly", async () => {
        const { documents } = await create();
        const record: DocumentRecord = {
          id: "p1",
          workspaceId: "ws",
          kind: "page",
          canvasId: "cv",
          title: "Ünïcode ✓ title",
          snapshot: [{ type: "paragraph", content: [{ type: "text", text: "hello", styles: { bold: true } }] }] as never,
          createdAt: 1,
          updatedAt: 2,
        };
        await documents.put(record);
        expect(await documents.get("p1")).toEqual(record);
        const { canvasId: _omit, ...withoutCanvas } = record;
        await documents.put(withoutCanvas);
        expect((await documents.get("p1"))?.canvasId).toBeUndefined();
      });

      it("opens a workspace idempotently, even under concurrent calls", async () => {
        const s = await create();
        const [a, b] = await Promise.all([openWorkspace(s, "default"), openWorkspace(s, "default")]);
        expect(a.canvas.id).toBe(b.canvas.id);
        const again = await openWorkspace(s, "default");
        expect(again.canvas.id).toBe(a.canvas.id);
        expect(await s.canvases.listByWorkspace("default")).toHaveLength(1);
        expect((await s.workspaces.get("default"))?.canvasIds).toEqual([a.canvas.id]);
      });
    });

    describe("assets", () => {
      it("stores image bytes and metadata, and reports presence", async () => {
        const { assets } = await create();
        expect(await assets.has("a1")).toBe(false);
        expect(await assets.get("a1")).toBeNull();

        const payload = new Uint8Array(4096).map((_, i) => i % 251);
        await assets.put({ id: "a1", blob: new Blob([payload], { type: "image/png" }), mimeType: "image/png", createdAt: 42 });
        expect(await assets.has("a1")).toBe(true);
        const got = await assets.get("a1");
        expect(got?.id).toBe("a1");
        expect(got?.mimeType).toBe("image/png");
        expect(got?.createdAt).toBe(42);
        expect(new Uint8Array(await got!.blob.arrayBuffer())).toEqual(payload);
        expect(await assets.has("other")).toBe(false);
      });

      it("accepts the same content-hash id twice and still returns the same bytes", async () => {
        const { assets } = await create();
        const put = (t: number) => assets.put({ id: "same", blob: new Blob([bytes(1, 2, 3)], { type: "image/png" }), mimeType: "image/png", createdAt: t });
        await put(1);
        await put(2);
        const got = await assets.get("same");
        expect(new Uint8Array(await got!.blob.arrayBuffer())).toEqual(bytes(1, 2, 3));
      });
    });

    describe("meta", () => {
      it("stores structured values and deletes them", async () => {
        const s = await create();
        await s.meta.set("ui.theme", "dark");
        expect(await s.meta.get("ui.theme")).toBe("dark");
        expect(await s.meta.get("missing")).toBeUndefined();
        await s.meta.set("obj", { a: [1, 2, { b: null }], c: "x" });
        expect(await s.meta.get("obj")).toEqual({ a: [1, 2, { b: null }], c: "x" });
        await s.meta.set("n", 0);
        expect(await s.meta.get("n")).toBe(0);
        await s.meta.set("f", false);
        expect(await s.meta.get("f")).toBe(false);
        await s.meta.delete("ui.theme");
        expect(await s.meta.get("ui.theme")).toBeUndefined();
        await s.meta.delete("ui.theme");
      });
    });

    describe("device-local stores", () => {
      it("stores non-secret AI connection config, keyed by connection id", async () => {
        const s = await create();
        await s.aiConnections.put({ providerId: "conn_a", authType: "api_key", model: "model-1" });
        await s.aiConnections.put({ providerId: "conn_b", authType: "local" });
        expect(await s.aiConnections.get("conn_a")).toEqual({ providerId: "conn_a", authType: "api_key", model: "model-1" });
        expect((await s.aiConnections.list()).map((c) => c.providerId).sort()).toEqual(["conn_a", "conn_b"]);
        await s.aiConnections.delete("conn_a");
        expect(await s.aiConnections.get("conn_a")).toBeNull();
      });

      it("stores AI conversations as headers plus append-only turns", async () => {
        const { aiConversations } = await create();
        const header = (id: string, workspaceId: string, updatedAt: number) => ({
          id,
          schemaVersion: 1,
          workspaceId,
          canvasId: "cv",
          anchorIds: ["b1"],
          anchorLabel: "x",
          title: id,
          scope: "selection" as const,
          turnCount: 2,
          createdAt: 0,
          updatedAt,
        });
        const turn = (conversationId: string, seq: number) => ({ conversationId, seq, role: "user" as const, createdAt: 0, text: `t${seq}`, scope: "selection" as const, sourceIds: [] });

        expect(await aiConversations.get("none")).toBeNull();
        await aiConversations.append(header("c1", "ws", 1), [turn("c1", 1), turn("c1", 0)]);
        await aiConversations.append(header("c1", "ws", 5), [turn("c1", 2)]);
        await aiConversations.append(header("c2", "ws", 3), [turn("c2", 0)]);
        await aiConversations.append(header("c3", "other", 9), [turn("c3", 0)]);

        expect((await aiConversations.listByWorkspace("ws")).map((c) => c.id)).toEqual(["c1", "c2"]);
        const c1 = await aiConversations.get("c1");
        expect(c1?.conversation.updatedAt).toBe(5);
        expect(c1?.turns.map((t) => t.seq)).toEqual([0, 1, 2]);

        // Re-appending a turn with the same seq replaces it rather than duplicating it.
        await aiConversations.append(header("c1", "ws", 6), [{ ...turn("c1", 1), text: "edited" }]);
        const edited = await aiConversations.get("c1");
        expect(edited?.turns.map((t) => [t.seq, t.text])).toEqual([[0, "t0"], [1, "edited"], [2, "t2"]]);

        await aiConversations.delete("c1");
        expect(await aiConversations.get("c1")).toBeNull();
        await aiConversations.deleteAll("ws");
        expect(await aiConversations.listByWorkspace("ws")).toEqual([]);
        expect(await aiConversations.listByWorkspace("other")).toHaveLength(1);
        await aiConversations.deleteAll();
        expect(await aiConversations.get("c3")).toBeNull();
      });

      it("stores content sources (F37) as a header plus append-only versions, per canvas", async () => {
        const { contentSources } = await create();
        const source = (id: string, canvasId: string, latestVersion: number) =>
          ({ id, workspaceId: "ws", canvasId, origin: "paste", tier: "local", template: "action_plan", latestVersion, createdAt: 1, updatedAt: latestVersion }) as const;
        const version = (sourceId: string, v: number) => ({ sourceId, version: v, text: `text ${v}`, plan: { version: 1 }, createdAt: v });
        await contentSources.append(source("s1", "cv", 1), version("s1", 1));
        await contentSources.append(source("s1", "cv", 2), version("s1", 2));
        await contentSources.append(source("s2", "other", 1), version("s2", 1));

        expect((await contentSources.get("s1"))?.latestVersion).toBe(2);
        expect((await contentSources.getVersion("s1", 1))?.text).toBe("text 1");
        expect((await contentSources.getVersion("s1", 2))?.text).toBe("text 2");
        expect(await contentSources.getVersion("s1", 3)).toBeNull();
        expect((await contentSources.listByCanvas("cv")).map((s) => s.id)).toEqual(["s1"]);
        await contentSources.delete("s1");
        expect(await contentSources.get("s1")).toBeNull();
        expect(await contentSources.getVersion("s1", 2)).toBeNull();
        expect(await contentSources.get("s2")).not.toBeNull();
      });

      it("stores repo maps (F43), finds one by repo, and lists per workspace", async () => {
        const { repoMaps } = await create();
        const map = (id: string, workspaceId: string, repo: string) => ({
          id,
          workspaceId,
          canvasId: `cv_${id}`,
          repo,
          title: repo,
          ids: { k: "n1" },
          nextId: 2,
          sections: { s: { sourceId: "src", label: "S", commit: "abc", nodes: { k: { path: "a.ts", lines: [1, 2] as [number, number] } }, order: 0 } },
          links: [{ from: "a", to: "b", type: "depends_on" as const, by: "s" }],
          reported: {},
          createdAt: 1,
          updatedAt: 2,
        });
        await repoMaps.put(map("m1", "ws", "org/a"));
        await repoMaps.put(map("m2", "ws", "org/b"));
        await repoMaps.put(map("m3", "other", "org/a"));
        expect(await repoMaps.get("m1")).toEqual(map("m1", "ws", "org/a"));
        expect((await repoMaps.findByRepo("ws", "org/a"))?.id).toBe("m1");
        expect(await repoMaps.findByRepo("ws", "org/zzz")).toBeNull();
        expect((await repoMaps.listByWorkspace("ws")).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
        await repoMaps.delete("m1");
        expect(await repoMaps.get("m1")).toBeNull();
      });

      it("deletes one workspace's agent change and session records", async () => {
        const { agentState } = await create();
        for (const [id, workspaceId] of [["chg_a", "ws_a"], ["chg_b", "ws_a"], ["chg_c", "ws_b"]] as const) {
          await agentState.putChange({ id, workspaceId, canvasId: "cv", operationId: id, tool: "create_shape", at: 1, outcome: "accepted", title: id, touched: [], inverse: [], revertible: false });
        }
        await agentState.putSession({ id: "mcp_a", workspaceId: "ws_a", startedAt: 1, changeIds: ["chg_a"] });
        await agentState.putSession({ id: "mcp_b", workspaceId: "ws_b", startedAt: 1, changeIds: ["chg_c"] });

        expect((await agentState.getChange("chg_a"))?.workspaceId).toBe("ws_a");
        expect(await agentState.getChange("none")).toBeNull();
        await agentState.deleteChanges(["chg_b"]);
        expect((await agentState.listChanges("ws_a")).map((r) => r.id)).toEqual(["chg_a"]);
        await agentState.deleteChanges([]);

        await agentState.deleteByWorkspace("ws_a");
        expect(await agentState.listChanges("ws_a")).toEqual([]);
        expect(await agentState.listSessions("ws_a")).toEqual([]);
        expect((await agentState.listChanges("ws_b")).map((r) => r.id)).toEqual(["chg_c"]);
        expect((await agentState.listSessions("ws_b")).map((r) => r.id)).toEqual(["mcp_b"]);
        await agentState.deleteByWorkspace("ws_none");
      });
    });

    describe("Yjs update log", () => {
      it("appends, loads and compacts Yjs updates per document", async () => {
        const { yupdates } = await create();
        await yupdates.append("doc/a", bytes(1));
        await yupdates.append("doc/b", bytes(9));
        await yupdates.append("doc/a", bytes(2));

        const loaded = await yupdates.load("doc/a");
        expect(arrays(loaded.updates)).toEqual([[1], [2]]);
        expect(loaded.keys).toHaveLength(2);
        expect(new Set(loaded.keys).size).toBe(2);

        await yupdates.append("doc/a", bytes(3)); // arrives after load
        await yupdates.compact("doc/a", loaded.keys, bytes(12));
        const after = await yupdates.load("doc/a");
        expect(arrays(after.updates).sort()).toEqual([[12], [3]].sort());
        expect((await yupdates.load("doc/b")).updates).toHaveLength(1);
      });

      it("loads updates in append order and never reuses a key, even after compaction", async () => {
        const { yupdates } = await create();
        for (let i = 0; i < 20; i++) await yupdates.append("d", bytes(i));
        const first = await yupdates.load("d");
        expect(arrays(first.updates)).toEqual(Array.from({ length: 20 }, (_, i) => [i]));
        await yupdates.compact("d", first.keys, bytes(255));
        await yupdates.append("d", bytes(100));
        const second = await yupdates.load("d");
        expect(second.keys).toHaveLength(2);
        for (const k of second.keys) expect(first.keys).not.toContain(k);
        expect(arrays(second.updates)).toEqual([[255], [100]]);
      });

      it("compacting with no loaded keys, or only stale keys, loses nothing", async () => {
        const { yupdates } = await create();
        await yupdates.append("d", bytes(1));
        const loaded = await yupdates.load("d");
        await yupdates.compact("d", loaded.keys, bytes(7));
        await yupdates.compact("d", loaded.keys, bytes(8)); // the keys are already gone
        expect(arrays((await yupdates.load("d")).updates).sort()).toEqual([[7], [8]]);
      });

      it("keeps byte-exact updates, including large and zero-filled ones", async () => {
        const { yupdates } = await create();
        const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
        await yupdates.append("d", big);
        await yupdates.append("d", new Uint8Array(0));
        await yupdates.append("d", new Uint8Array(16));
        const { updates } = await yupdates.load("d");
        expect(updates[0]).toEqual(big);
        expect(updates[1]).toHaveLength(0);
        expect(updates[2]).toEqual(new Uint8Array(16));
        expect(updates[0]).toBeInstanceOf(Uint8Array);
      });

      it("clears one document's update log only", async () => {
        const { yupdates } = await create();
        await yupdates.append("doc/a", bytes(1));
        await yupdates.append("doc/b", bytes(2));
        await yupdates.clear("doc/a");
        expect((await yupdates.load("doc/a")).updates).toHaveLength(0);
        expect((await yupdates.load("doc/b")).updates).toHaveLength(1);
        await yupdates.clear("never-existed");
      });

      it("returns an empty log for an unknown document", async () => {
        const { yupdates } = await create();
        expect(await yupdates.load("nothing")).toEqual({ keys: [], updates: [] });
      });
    });

    describe("DocumentProvider over this backend", () => {
      it("persists local edits, reloads them in a new provider, and survives compaction", async () => {
        const s = await create();
        const first = new DocumentProvider("doc/p", s.yupdates, { flushDelay: 0, compactThreshold: 3 });
        await first.load();
        for (let i = 0; i < 6; i++) {
          first.applyLocalChange((d) => d.getArray("items").push([`item ${i}`]));
          await first.flush();
        }
        await first.dispose();

        const second = new DocumentProvider("doc/p", s.yupdates, { flushDelay: 0, compactThreshold: 3 });
        await second.load();
        expect(second.doc.getArray("items").toArray()).toEqual(Array.from({ length: 6 }, (_, i) => `item ${i}`));
        await second.dispose();

        // After compaction the log is shorter than the number of edits but replays to the same state.
        const { updates } = await s.yupdates.load("doc/p");
        expect(updates.length).toBeLessThan(6);
        const replay = new Y.Doc();
        updates.forEach((u) => Y.applyUpdate(replay, u));
        expect(replay.getArray("items").toArray()).toHaveLength(6);
      });

      it("merges an update appended by another writer between load and compaction", async () => {
        const s = await create();
        const a = new DocumentProvider("doc/q", s.yupdates, { flushDelay: 0, compactThreshold: 1000 });
        await a.load();
        a.applyLocalChange((d) => d.getArray("items").push(["a1"]));
        await a.flush();
        const loaded = await s.yupdates.load("doc/q");

        const other = new Y.Doc();
        other.getArray("items").push(["from-other-writer"]);
        await s.yupdates.append("doc/q", Y.encodeStateAsUpdate(other)); // arrives after `loaded`
        await s.yupdates.compact("doc/q", loaded.keys, Y.encodeStateAsUpdate(a.doc));

        const replay = new Y.Doc();
        (await s.yupdates.load("doc/q")).updates.forEach((u) => Y.applyUpdate(replay, u));
        expect(replay.getArray("items").toArray().sort()).toEqual(["a1", "from-other-writer"]);
        await a.dispose();
      });
    });
  });
}
