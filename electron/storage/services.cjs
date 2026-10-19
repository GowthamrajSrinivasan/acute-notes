// SQLite implementation of every PersistenceServices method (src/persistence/repositories/types.ts), with the same
// observable behaviour as the IndexedDB backend; src/persistence/conformance/ is the executable contract.
//
// These services speak plain, structured-cloneable data: asset bytes are `Uint8Array` (the renderer-side codec in
// src/persistence/repositories/ipc.ts converts to and from `Blob`). Every method is `async` for interface parity,
// but all SQL is synchronous with no `await` inside a transaction, so each method is atomic.
const v8 = require("node:v8");
const { transaction } = require("./db.cjs");

const parse = (row) => (row ? JSON.parse(row.json) : null);
const parseAll = (rows) => rows.map((r) => JSON.parse(r.json));

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {ReturnType<typeof import("./assets.cjs").createAssetFiles>} files
 */
function createStorageServices(db, files) {
  const cache = new Map();
  const sql = (text) => {
    let stmt = cache.get(text);
    if (!stmt) cache.set(text, (stmt = db.prepare(text)));
    return stmt;
  };
  const tx = (fn) => transaction(db, fn);
  const json = (value) => JSON.stringify(value);
  const idList = (ids) => JSON.stringify([...ids]);
  // node:sqlite binds an empty Uint8Array as NULL; COALESCE turns that back into an empty BLOB.
  const YINSERT = "INSERT INTO yupdates(doc_id, upd, created_at) VALUES(?, COALESCE(?, zeroblob(0)), ?)";

  return {
    workspaces: {
      get: async (id) => parse(sql("SELECT json FROM workspaces WHERE id = ?").get(id)),
      put: async (ws) => void sql("INSERT INTO workspaces(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(ws.id, json(ws)),
      delete: async (id) => void sql("DELETE FROM workspaces WHERE id = ?").run(id),
      list: async () => parseAll(sql("SELECT json FROM workspaces ORDER BY id").all()),
    },

    canvases: {
      get: async (id) => parse(sql("SELECT json FROM canvases WHERE id = ?").get(id)),
      put: async (c) =>
        void sql("INSERT INTO canvases(id, workspace_id, json) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, json = excluded.json").run(c.id, c.workspaceId, json(c)),
      delete: async (id) => void sql("DELETE FROM canvases WHERE id = ?").run(id),
      listByWorkspace: async (wsId) => parseAll(sql("SELECT json FROM canvases WHERE workspace_id = ? ORDER BY id").all(wsId)),
    },

    documents: {
      get: async (id) => parse(sql("SELECT json FROM documents WHERE id = ?").get(id)),
      async getMany(ids) {
        if (!ids.length) return [];
        const byId = new Map(sql("SELECT id, json FROM documents WHERE id IN (SELECT value FROM json_each(?))").all(idList(ids)).map((r) => [r.id, JSON.parse(r.json)]));
        return ids.map((id) => byId.get(id) ?? null);
      },
      put: async (d) =>
        void sql("INSERT INTO documents(id, workspace_id, kind, json) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, kind = excluded.kind, json = excluded.json").run(d.id, d.workspaceId, d.kind, json(d)),
      delete: async (id) => void sql("DELETE FROM documents WHERE id = ?").run(id),
      listByWorkspace: async (wsId, kind) =>
        parseAll(
          kind
            ? sql("SELECT json FROM documents WHERE workspace_id = ? AND kind = ? ORDER BY id").all(wsId, kind)
            : sql("SELECT json FROM documents WHERE workspace_id = ? ORDER BY id").all(wsId),
        ),
    },

    assets: {
      // Same semantics as IndexedDB `put`: the latest write for an id wins. The file is written first (atomically),
      // so a metadata row never points at a missing or partial file.
      async put(a) {
        const file = files.fileNameFor(a.id);
        files.write(file, a.data);
        sql("INSERT INTO assets(id, file, mime_type, size, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET file = excluded.file, mime_type = excluded.mime_type, size = excluded.size, created_at = excluded.created_at").run(a.id, file, a.mimeType, a.data.byteLength, a.createdAt);
      },
      async get(id) {
        const row = sql("SELECT file, mime_type, created_at FROM assets WHERE id = ?").get(id);
        if (!row) return null;
        const data = files.read(row.file);
        return data ? { id, data, mimeType: row.mime_type, createdAt: row.created_at } : null;
      },
      async has(id) {
        const row = sql("SELECT file FROM assets WHERE id = ?").get(id);
        return !!row && files.exists(row.file);
      },
    },

    meta: {
      async get(key) {
        const row = sql("SELECT value FROM meta WHERE key = ?").get(key);
        return row ? v8.deserialize(row.value) : undefined;
      },
      // v8 serialisation keeps what structured clone keeps (Uint8Array, Date, Map, undefined…), like IndexedDB.
      set: async (key, value) => void sql("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, v8.serialize(value)),
      delete: async (key) => void sql("DELETE FROM meta WHERE key = ?").run(key),
    },

    aiConnections: {
      get: async (id) => parse(sql("SELECT json FROM ai_connections WHERE id = ?").get(id)),
      put: async (c) => void sql("INSERT INTO ai_connections(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(c.providerId, json(c)),
      delete: async (id) => void sql("DELETE FROM ai_connections WHERE id = ?").run(id),
      list: async () => parseAll(sql("SELECT json FROM ai_connections ORDER BY id").all()),
    },

    aiConversations: {
      listByWorkspace: async (wsId) => parseAll(sql("SELECT json FROM ai_conversations WHERE workspace_id = ? ORDER BY updated_at DESC, id").all(wsId)),
      async get(id) {
        const conversation = parse(sql("SELECT json FROM ai_conversations WHERE id = ?").get(id));
        if (!conversation) return null;
        return { conversation, turns: parseAll(sql("SELECT json FROM ai_turns WHERE conversation_id = ? ORDER BY seq").all(id)) };
      },
      async append(conversation, turns) {
        tx(() => {
          sql("INSERT INTO ai_conversations(id, workspace_id, updated_at, json) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, updated_at = excluded.updated_at, json = excluded.json").run(conversation.id, conversation.workspaceId, conversation.updatedAt, json(conversation));
          const put = sql("INSERT INTO ai_turns(conversation_id, seq, json) VALUES(?, ?, ?) ON CONFLICT(conversation_id, seq) DO UPDATE SET json = excluded.json");
          for (const t of turns) put.run(conversation.id, t.seq, json(t));
        });
      },
      delete: async (id) => void sql("DELETE FROM ai_conversations WHERE id = ?").run(id), // turns cascade
      async deleteAll(wsId) {
        if (wsId === undefined) sql("DELETE FROM ai_conversations").run();
        else sql("DELETE FROM ai_conversations WHERE workspace_id = ?").run(wsId);
      },
    },

    contentSources: {
      get: async (id) => parse(sql("SELECT json FROM content_sources WHERE id = ?").get(id)),
      getVersion: async (sourceId, version) => parse(sql("SELECT json FROM content_source_versions WHERE source_id = ? AND version = ?").get(sourceId, version)),
      async append(source, version) {
        tx(() => {
          sql("INSERT INTO content_sources(id, canvas_id, json) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET canvas_id = excluded.canvas_id, json = excluded.json").run(source.id, source.canvasId, json(source));
          sql("INSERT INTO content_source_versions(source_id, version, json) VALUES(?, ?, ?) ON CONFLICT(source_id, version) DO UPDATE SET json = excluded.json").run(version.sourceId, version.version, json(version));
        });
      },
      listByCanvas: async (canvasId) => parseAll(sql("SELECT json FROM content_sources WHERE canvas_id = ? ORDER BY id").all(canvasId)),
      delete: async (id) => void sql("DELETE FROM content_sources WHERE id = ?").run(id), // versions cascade
    },

    repoMaps: {
      get: async (id) => parse(sql("SELECT json FROM repo_maps WHERE id = ?").get(id)),
      findByRepo: async (wsId, repo) => parse(sql("SELECT json FROM repo_maps WHERE workspace_id = ? AND repo = ? ORDER BY id LIMIT 1").get(wsId, repo)),
      listByWorkspace: async (wsId) => parseAll(sql("SELECT json FROM repo_maps WHERE workspace_id = ? ORDER BY id").all(wsId)),
      put: async (r) =>
        void sql("INSERT INTO repo_maps(id, workspace_id, repo, json) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, repo = excluded.repo, json = excluded.json").run(r.id, r.workspaceId, r.repo, json(r)),
      delete: async (id) => void sql("DELETE FROM repo_maps WHERE id = ?").run(id),
    },

    agentState: {
      putChange: async (r) => void sql("INSERT INTO agent_changes(id, workspace_id, json) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, json = excluded.json").run(r.id, r.workspaceId, json(r)),
      getChange: async (id) => parse(sql("SELECT json FROM agent_changes WHERE id = ?").get(id)),
      listChanges: async (wsId) => parseAll(sql("SELECT json FROM agent_changes WHERE workspace_id = ? ORDER BY id").all(wsId)),
      async deleteChanges(ids) {
        if (ids.length) sql("DELETE FROM agent_changes WHERE id IN (SELECT value FROM json_each(?))").run(idList(ids));
      },
      putSession: async (r) => void sql("INSERT INTO agent_sessions(id, workspace_id, json) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, json = excluded.json").run(r.id, r.workspaceId, json(r)),
      getSession: async (id) => parse(sql("SELECT json FROM agent_sessions WHERE id = ?").get(id)),
      listSessions: async (wsId) => parseAll(sql("SELECT json FROM agent_sessions WHERE workspace_id = ? ORDER BY id").all(wsId)),
      async deleteByWorkspace(wsId) {
        tx(() => {
          sql("DELETE FROM agent_changes WHERE workspace_id = ?").run(wsId);
          sql("DELETE FROM agent_sessions WHERE workspace_id = ?").run(wsId);
        });
      },
    },

    yupdates: {
      async load(docId) {
        const rows = sql("SELECT seq, upd FROM yupdates WHERE doc_id = ? ORDER BY seq").all(docId);
        return { keys: rows.map((r) => r.seq), updates: rows.map((r) => r.upd) };
      },
      append: async (docId, update) => void sql(YINSERT).run(docId, update, Date.now()),
      // One transaction: insert the merged update and delete exactly the previously-loaded rows. Rows appended since
      // (by another window, say) have other keys and are left alone, so compaction can never lose data.
      async compact(docId, loadedKeys, merged) {
        tx(() => {
          sql(YINSERT).run(docId, merged, Date.now());
          if (loadedKeys.length) sql("DELETE FROM yupdates WHERE doc_id = ? AND seq IN (SELECT value FROM json_each(?))").run(docId, idList(loadedKeys));
        });
      },
      clear: async (docId) => void sql("DELETE FROM yupdates WHERE doc_id = ?").run(docId),
    },
  };
}

module.exports = { createStorageServices };
