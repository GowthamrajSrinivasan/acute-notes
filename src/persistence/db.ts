/**
 * Single local IndexedDB database for all Acute-Notes state (F13).
 *
 * UI code never touches this module directly; it goes through the repository
 * interfaces in `./repositories`. Schema changes are expressed as ordered,
 * additive migrations so existing local data is always upgraded in place.
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import type { AIConversation, AITurn } from "@/ai/conversations/types";
import type { AIProviderConfig } from "@/ai/types";
import type { CanvasDocument, ContentSource, ContentSourceVersion, DocumentRecord, Workspace } from "@/domain/types";
import type { AgentChangeRecord, AgentSessionRecord } from "@/ai/changes/agentState";
import type { RepoMapRecord } from "./repositories/types";

export const DB_NAME = "acute-notes";

export interface StoredAsset {
  id: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

export interface StoredYUpdate {
  docId: string;
  update: Uint8Array;
  createdAt: number;
}

export interface AcuteDB extends DBSchema {
  workspaces: { key: string; value: Workspace };
  canvases: { key: string; value: CanvasDocument; indexes: { byWorkspace: string } };
  documents: {
    key: string;
    value: DocumentRecord;
    indexes: { byWorkspace: string; byWorkspaceKind: [string, DocumentRecord["kind"]] };
  };
  /** Append-only Yjs update log, compacted per document on load. */
  yupdates: { key: number; value: StoredYUpdate; indexes: { byDoc: string } };
  assets: { key: string; value: StoredAsset };
  /** Small key/value store for UI preferences and app metadata. */
  meta: { key: string; value: unknown };
  /** Non-secret AI connection config (F27) — secrets never live here, see `src/ai/credentials/`. */
  aiConnections: { key: string; value: AIProviderConfig };
  /** AI conversation headers (F40) — device-local, never in workspace exports or Yjs. */
  aiConversations: { key: string; value: AIConversation; indexes: { byWorkspace: string } };
  /** AI conversation turns (F40), append-only, keyed [conversationId, seq]. */
  aiTurns: { key: [string, number]; value: AITurn; indexes: { byConversation: string } };
  /** Visualize content sources (F37) — device-local, never in workspace exports or Yjs. */
  contentSources: { key: string; value: ContentSource; indexes: { byCanvas: string } };
  /** Their append-only versions, keyed [sourceId, version]. */
  contentSourceVersions: { key: [string, number]; value: ContentSourceVersion; indexes: { bySource: string } };
  /** Repo maps' bookkeeping (F43) — device-local, never in workspace exports or Yjs. */
  repoMaps: { key: string; value: RepoMapRecord; indexes: { byWorkspace: string } };
  /** Agent State's change log (Lens Phase 7A, D31): one record per accepted, rejected or expired change set. */
  agentChanges: { key: string; value: AgentChangeRecord; indexes: { byWorkspace: string } };
  /** Agent State's MCP sessions (D31): one record per session. */
  agentSessions: { key: string; value: AgentSessionRecord; indexes: { byWorkspace: string } };
}

type UpgradeTx = IDBPTransaction<AcuteDB, StoreNames<AcuteDB>[], "versionchange">;
type Migration = (db: IDBPDatabase<AcuteDB>, tx: UpgradeTx) => void;

/**
 * Ordered migrations: index 0 upgrades an empty database to version 1, and so
 * on. Never edit a released migration; append a new one instead.
 */
export const MIGRATIONS: readonly Migration[] = [
  // v1 — initial schema
  (db) => {
    db.createObjectStore("workspaces", { keyPath: "id" });
    db.createObjectStore("canvases", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
    db.createObjectStore("documents", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
    db.createObjectStore("yupdates", { autoIncrement: true }).createIndex("byDoc", "docId");
    db.createObjectStore("assets", { keyPath: "id" });
    db.createObjectStore("meta");
  },
  // v2 — list pages without loading every block's snapshot
  (_db, tx) => {
    tx.objectStore("documents").createIndex("byWorkspaceKind", ["workspaceId", "kind"]);
  },
  // v3 — AI connection settings (F27), keyed by connection id
  (db) => {
    db.createObjectStore("aiConnections", { keyPath: "providerId" });
  },
  // v4 — AI conversation history (F40): small headers + append-only turns
  (db) => {
    db.createObjectStore("aiConversations", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
    db.createObjectStore("aiTurns", { keyPath: ["conversationId", "seq"] }).createIndex("byConversation", "conversationId");
  },
  // v5 — Visualize content sources (F37): headers + append-only versions
  (db) => {
    db.createObjectStore("contentSources", { keyPath: "id" }).createIndex("byCanvas", "canvasId");
    db.createObjectStore("contentSourceVersions", { keyPath: ["sourceId", "version"] }).createIndex("bySource", "sourceId");
  },
  // v6 — repo maps over MCP (F43): one bookkeeping record per map
  (db) => {
    db.createObjectStore("repoMaps", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
  },
  // v7 — Agent State (Lens Phase 7A, D31): the change log and MCP session records
  (db) => {
    db.createObjectStore("agentChanges", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
    db.createObjectStore("agentSessions", { keyPath: "id" }).createIndex("byWorkspace", "workspaceId");
  },
];

export const DB_VERSION = MIGRATIONS.length;

export function openAcuteDB(name = DB_NAME): Promise<IDBPDatabase<AcuteDB>> {
  return openDB<AcuteDB>(name, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      const target = newVersion ?? DB_VERSION;
      for (let v = oldVersion; v < target; v++) MIGRATIONS[v]?.(db, tx);
    },
    blocked() {
      console.warn("[acute-notes] Database upgrade blocked by another open tab.");
    },
    blocking(_current, _blocked, event) {
      // A newer tab wants to upgrade: release our connection so it can proceed.
      (event.target as IDBDatabase).close();
    },
  });
}
