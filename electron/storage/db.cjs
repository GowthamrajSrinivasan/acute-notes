// Desktop SQLite database (main process only). Uses Node's built-in `node:sqlite` (no native module; see
// .ai/docs/sqlite-desktop-storage-plan.md, B0). Everything that knows SQL lives in this folder.
const fs = require("node:fs");
const path = require("node:path");

/**
 * Ordered, append-only migrations: index 0 takes an empty database to schema version 1. Never edit a released
 * migration; append a new one. Records are stored as JSON text with the few columns the repositories query on.
 */
const MIGRATIONS = [
  // v1 — initial schema (mirrors the IndexedDB stores v1–v7)
  `
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, json TEXT NOT NULL);

  CREATE TABLE canvases (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX canvases_workspace ON canvases(workspace_id);

  CREATE TABLE documents (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX documents_workspace_kind ON documents(workspace_id, kind);

  -- Append-only Yjs update log. AUTOINCREMENT: a key is never reused, even after compaction deletes it.
  CREATE TABLE yupdates (seq INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, upd BLOB NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX yupdates_doc ON yupdates(doc_id);

  -- Asset metadata only; the bytes are content-addressed files beside the database (see assets.cjs).
  CREATE TABLE assets (id TEXT PRIMARY KEY, file TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);

  CREATE TABLE meta (key TEXT PRIMARY KEY, value BLOB NOT NULL);

  CREATE TABLE ai_connections (id TEXT PRIMARY KEY, json TEXT NOT NULL);

  CREATE TABLE ai_conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, updated_at REAL NOT NULL, json TEXT NOT NULL);
  CREATE INDEX ai_conversations_workspace ON ai_conversations(workspace_id);
  CREATE TABLE ai_turns (
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (conversation_id, seq));

  CREATE TABLE content_sources (id TEXT PRIMARY KEY, canvas_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX content_sources_canvas ON content_sources(canvas_id);
  CREATE TABLE content_source_versions (
    source_id TEXT NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (source_id, version));

  CREATE TABLE repo_maps (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repo TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX repo_maps_workspace ON repo_maps(workspace_id);

  CREATE TABLE agent_changes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX agent_changes_workspace ON agent_changes(workspace_id);
  CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX agent_sessions_workspace ON agent_sessions(workspace_id);
  `,
];

const SCHEMA_VERSION = MIGRATIONS.length;

class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

/** Runs `fn` in one write transaction (rolled back if it throws). `fn` must be synchronous and not nest. */
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original error matters more than a failed rollback.
    }
    throw err;
  }
}

/** Opens (creating or upgrading) the database at `file`. Throws StorageError("DB_TOO_NEW") for a newer schema. */
function openDatabase(file) {
  const { DatabaseSync } = require("node:sqlite");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const current = db.prepare("PRAGMA user_version").get().user_version;
    if (current > SCHEMA_VERSION) {
      throw new StorageError("DB_TOO_NEW", `This data was written by a newer version of Acute Notes (schema ${current}; this app supports ${SCHEMA_VERSION}). Update the app to open it.`);
    }
    for (let v = current; v < SCHEMA_VERSION; v++) {
      transaction(db, () => {
        db.exec(MIGRATIONS[v]);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

module.exports = { MIGRATIONS, SCHEMA_VERSION, StorageError, openDatabase, transaction };
