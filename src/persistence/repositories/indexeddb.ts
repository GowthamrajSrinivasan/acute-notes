import type { IDBPDatabase } from "idb";
import type { AcuteDB } from "../db";
import type { PersistenceServices } from "./types";

type DB = Promise<IDBPDatabase<AcuteDB>>;

/** IndexedDB-backed repositories sharing one database connection. */
export function createIndexedDbServices(dbPromise: DB): PersistenceServices {
  return {
    workspaces: {
      get: async (id) => (await (await dbPromise).get("workspaces", id)) ?? null,
      put: async (ws) => void (await (await dbPromise).put("workspaces", ws)),
      delete: async (id) => (await dbPromise).delete("workspaces", id),
      list: async () => (await dbPromise).getAll("workspaces"),
    },
    canvases: {
      get: async (id) => (await (await dbPromise).get("canvases", id)) ?? null,
      put: async (c) => void (await (await dbPromise).put("canvases", c)),
      delete: async (id) => (await dbPromise).delete("canvases", id),
      listByWorkspace: async (wsId) => (await dbPromise).getAllFromIndex("canvases", "byWorkspace", wsId),
    },
    documents: {
      get: async (id) => (await (await dbPromise).get("documents", id)) ?? null,
      async getMany(ids) {
        if (!ids.length) return [];
        const tx = (await dbPromise).transaction("documents", "readonly");
        const records = await Promise.all(ids.map(async (id) => (await tx.store.get(id)) ?? null));
        await tx.done;
        return records;
      },
      put: async (d) => void (await (await dbPromise).put("documents", d)),
      delete: async (id) => (await dbPromise).delete("documents", id),
      listByWorkspace: async (wsId, kind) =>
        kind
          ? (await dbPromise).getAllFromIndex("documents", "byWorkspaceKind", [wsId, kind])
          : (await dbPromise).getAllFromIndex("documents", "byWorkspace", wsId),
    },
    assets: {
      put: async (a) => void (await (await dbPromise).put("assets", a)),
      get: async (id) => (await (await dbPromise).get("assets", id)) ?? null,
      has: async (id) => (await (await dbPromise).getKey("assets", id)) !== undefined,
    },
    meta: {
      get: async <T,>(key: string) => (await (await dbPromise).get("meta", key)) as T | undefined,
      set: async (key, value) => void (await (await dbPromise).put("meta", value, key)),
      delete: async (key) => (await dbPromise).delete("meta", key),
    },
    aiConnections: {
      get: async (id) => (await (await dbPromise).get("aiConnections", id)) ?? null,
      put: async (c) => void (await (await dbPromise).put("aiConnections", c)),
      delete: async (id) => (await dbPromise).delete("aiConnections", id),
      list: async () => (await dbPromise).getAll("aiConnections"),
    },
    aiConversations: {
      listByWorkspace: async (wsId) =>
        (await (await dbPromise).getAllFromIndex("aiConversations", "byWorkspace", wsId)).sort((a, b) => b.updatedAt - a.updatedAt),
      async get(id) {
        const db = await dbPromise;
        const tx = db.transaction(["aiConversations", "aiTurns"], "readonly");
        const [conversation, turns] = await Promise.all([tx.objectStore("aiConversations").get(id), tx.objectStore("aiTurns").index("byConversation").getAll(id)]);
        await tx.done;
        return conversation ? { conversation, turns: turns.sort((a, b) => a.seq - b.seq) } : null;
      },
      async append(conversation, turns) {
        const db = await dbPromise;
        const tx = db.transaction(["aiConversations", "aiTurns"], "readwrite");
        await Promise.all([tx.objectStore("aiConversations").put(conversation), ...turns.map((t) => tx.objectStore("aiTurns").put(t))]);
        await tx.done;
      },
      async delete(id) {
        const db = await dbPromise;
        const tx = db.transaction(["aiConversations", "aiTurns"], "readwrite");
        const turns = tx.objectStore("aiTurns");
        const keys = await turns.index("byConversation").getAllKeys(id);
        await Promise.all([tx.objectStore("aiConversations").delete(id), ...keys.map((k) => turns.delete(k))]);
        await tx.done;
      },
      async deleteAll(wsId) {
        const db = await dbPromise;
        const tx = db.transaction(["aiConversations", "aiTurns"], "readwrite");
        const headers = tx.objectStore("aiConversations");
        const turns = tx.objectStore("aiTurns");
        if (wsId === undefined) {
          await Promise.all([headers.clear(), turns.clear()]);
        } else {
          const ids = await headers.index("byWorkspace").getAllKeys(wsId);
          for (const id of ids) {
            const keys = await turns.index("byConversation").getAllKeys(id);
            await Promise.all([headers.delete(id), ...keys.map((k) => turns.delete(k))]);
          }
        }
        await tx.done;
      },
    },
    contentSources: {
      get: async (id) => (await (await dbPromise).get("contentSources", id)) ?? null,
      getVersion: async (sourceId, version) => (await (await dbPromise).get("contentSourceVersions", [sourceId, version])) ?? null,
      async append(source, version) {
        const db = await dbPromise;
        const tx = db.transaction(["contentSources", "contentSourceVersions"], "readwrite");
        await Promise.all([tx.objectStore("contentSources").put(source), tx.objectStore("contentSourceVersions").put(version)]);
        await tx.done;
      },
      listByCanvas: async (canvasId) => (await dbPromise).getAllFromIndex("contentSources", "byCanvas", canvasId),
      async delete(id) {
        const db = await dbPromise;
        const tx = db.transaction(["contentSources", "contentSourceVersions"], "readwrite");
        const versions = tx.objectStore("contentSourceVersions");
        const keys = await versions.index("bySource").getAllKeys(id);
        await Promise.all([tx.objectStore("contentSources").delete(id), ...keys.map((k) => versions.delete(k))]);
        await tx.done;
      },
    },
    repoMaps: {
      get: async (id) => (await (await dbPromise).get("repoMaps", id)) ?? null,
      findByRepo: async (wsId, repo) => (await (await dbPromise).getAllFromIndex("repoMaps", "byWorkspace", wsId)).find((m) => m.repo === repo) ?? null,
      listByWorkspace: async (wsId) => (await dbPromise).getAllFromIndex("repoMaps", "byWorkspace", wsId),
      put: async (record) => void (await (await dbPromise).put("repoMaps", record)),
      delete: async (id) => (await dbPromise).delete("repoMaps", id),
    },
    agentState: {
      putChange: async (record) => void (await (await dbPromise).put("agentChanges", record)),
      getChange: async (id) => (await (await dbPromise).get("agentChanges", id)) ?? null,
      listChanges: async (wsId) => (await dbPromise).getAllFromIndex("agentChanges", "byWorkspace", wsId),
      async deleteChanges(ids) {
        if (!ids.length) return;
        const tx = (await dbPromise).transaction("agentChanges", "readwrite");
        await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
      },
      putSession: async (record) => void (await (await dbPromise).put("agentSessions", record)),
      getSession: async (id) => (await (await dbPromise).get("agentSessions", id)) ?? null,
      listSessions: async (wsId) => (await dbPromise).getAllFromIndex("agentSessions", "byWorkspace", wsId),
      async deleteByWorkspace(wsId) {
        const tx = (await dbPromise).transaction(["agentChanges", "agentSessions"], "readwrite");
        const changes = tx.objectStore("agentChanges");
        const sessions = tx.objectStore("agentSessions");
        const [changeIds, sessionIds] = await Promise.all([changes.index("byWorkspace").getAllKeys(wsId), sessions.index("byWorkspace").getAllKeys(wsId)]);
        await Promise.all([...changeIds.map((id) => changes.delete(id)), ...sessionIds.map((id) => sessions.delete(id)), tx.done]);
      },
    },
    yupdates: {
      async load(docId) {
        const db = await dbPromise;
        const tx = db.transaction("yupdates", "readonly");
        const index = tx.store.index("byDoc");
        const [keys, values] = await Promise.all([index.getAllKeys(docId), index.getAll(docId)]);
        await tx.done;
        return { keys, updates: values.map((v) => v.update) };
      },
      async append(docId, update) {
        await (await dbPromise).add("yupdates", { docId, update, createdAt: Date.now() });
      },
      async compact(docId, loadedKeys, merged) {
        const db = await dbPromise;
        const tx = db.transaction("yupdates", "readwrite");
        await Promise.all([
          tx.store.add({ docId, update: merged, createdAt: Date.now() }),
          ...loadedKeys.map((k) => tx.store.delete(k)),
        ]);
        await tx.done;
      },
      async clear(docId) {
        const db = await dbPromise;
        const tx = db.transaction("yupdates", "readwrite");
        const keys = await tx.store.index("byDoc").getAllKeys(docId);
        await Promise.all(keys.map((k) => tx.store.delete(k)));
        await tx.done;
      },
    },
  };
}
