/**
 * Repository contracts (PRD §9.1). UI and domain code depend only on these;
 * the local IndexedDB implementation can later be swapped or augmented by a
 * cloud implementation without touching callers.
 */
import type { AgentChangeRecord, AgentSessionRecord } from "@/ai/changes/agentState";
import type { AIConversation, AITurn } from "@/ai/conversations/types";
import type { AIProviderConfig } from "@/ai/types";
import type { CanvasDocument, ContentSource, ContentSourceVersion, DocumentRecord, RelationType, Workspace } from "@/domain/types";
import type { StoredAsset } from "../db";

export type { StoredAsset };

export interface WorkspaceRepository {
  get(id: string): Promise<Workspace | null>;
  put(workspace: Workspace): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<Workspace[]>;
}

export interface CanvasRepository {
  get(id: string): Promise<CanvasDocument | null>;
  put(canvas: CanvasDocument): Promise<void>;
  delete(id: string): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<CanvasDocument[]>;
}

export interface DocumentRepository {
  get(id: string): Promise<DocumentRecord | null>;
  /** Several records in one read (same order as `ids`; `null` = missing). */
  getMany(ids: readonly string[]): Promise<(DocumentRecord | null)[]>;
  put(doc: DocumentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /** All documents of a workspace, or only those of one kind. */
  listByWorkspace(workspaceId: string, kind?: DocumentRecord["kind"]): Promise<DocumentRecord[]>;
}

export interface AssetRepository {
  put(asset: StoredAsset): Promise<void>;
  get(id: string): Promise<StoredAsset | null>;
  has(id: string): Promise<boolean>;
}

export interface MetaRepository {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Non-secret AI connection config (F27) — never a secret; see `src/ai/credentials/`. */
export interface AISettingsRepository {
  get(providerId: string): Promise<AIProviderConfig | null>;
  put(config: AIProviderConfig): Promise<void>;
  delete(providerId: string): Promise<void>;
  list(): Promise<AIProviderConfig[]>;
}

/**
 * AI conversation history (F40). Turns are append-only and each exchange is
 * written once, when it completes — the unit a future cloud sync would push.
 */
export interface AIConversationRepository {
  /** Headers of a workspace's conversations, newest first. */
  listByWorkspace(workspaceId: string): Promise<AIConversation[]>;
  get(id: string): Promise<{ conversation: AIConversation; turns: AITurn[] } | null>;
  /** Writes the header and appends turns in one transaction. */
  append(conversation: AIConversation, turns: readonly AITurn[]): Promise<void>;
  delete(id: string): Promise<void>;
  /** Every conversation of a workspace, or all of them. */
  deleteAll(workspaceId?: string): Promise<void>;
}

/** Content sources (F37): device-local, never part of workspace documents, Yjs state or exports. */
export interface ContentSourceRepository {
  get(id: string): Promise<ContentSource | null>;
  getVersion(sourceId: string, version: number): Promise<ContentSourceVersion | null>;
  /** Writes the source header and appends one version, in one transaction. */
  append(source: ContentSource, version: ContentSourceVersion): Promise<void>;
  listByCanvas(canvasId: string): Promise<ContentSource[]>;
  /** A source and all its versions. */
  delete(id: string): Promise<void>;
}

/**
 * A repo map's bookkeeping (F43): which canvas it is, the content source of
 * each section, the keys it has seen, the links it was told about, and the
 * last commit. Device-local, beside content sources — never in workspace
 * documents, Yjs state or exports — and it holds no content the canvas
 * doesn't already show (keys, repo paths, section names).
 */
export interface RepoMapRecord {
  id: string;
  workspaceId: string;
  /** The map canvas, created by `begin_repo_map`; the only canvas the map may write to. */
  canvasId: string;
  /** The repo's display name, e.g. `org/name`; one map per repo per workspace. */
  repo: string;
  title: string;
  lastCommit?: string;
  /** Short plan-node ids for keys, stable for the map's life. */
  ids: Record<string, string>;
  nextId: number;
  /** By section key. */
  sections: Record<string, RepoMapSection>;
  /** Links between sections (and ones sent ahead of their ends), by their ends' keys. */
  links: RepoMapLink[];
  /** What `get_map_status` last reported as each key's correction (so each is reported once). */
  reported: Record<string, string>;
  /**
   * The repository's absolute folder on this computer, when the agent gave it (Lens Phase 2): the target of the L5
   * source card's "Open in VS Code". Device-local, like the whole record; never exported.
   */
  repoRoot?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RepoMapSection {
  /** Its F37 content source. */
  sourceId: string;
  label: string;
  /** The commit it was last sent at. */
  commit: string;
  /** Its node keys, with the repo path each cites (never read by Acute). */
  nodes: Record<string, { path?: string; lines?: [number, number] }>;
  /** Arrival order, for listing. */
  order: number;
  /** The card (in another section) this section details one level down (Wave 1b levels). */
  parent?: string;
}

export interface RepoMapLink {
  from: string;
  to: string;
  type: RelationType;
  label?: string;
  /** The section whose upsert declared it, or "" for `link_map_nodes`. */
  by: string;
}

export interface RepoMapRepository {
  get(id: string): Promise<RepoMapRecord | null>;
  /** The map of `repo` in a workspace, if any. */
  findByRepo(workspaceId: string, repo: string): Promise<RepoMapRecord | null>;
  /** Every map of a workspace. */
  listByWorkspace(workspaceId: string): Promise<RepoMapRecord[]>;
  put(record: RepoMapRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Agent State (plan §3.7, D31): the change log and MCP session records, history about the canvas, never a fact
 * source. Device-local, never in workspace exports or Yjs.
 */
export interface AgentStateRepository {
  putChange(record: AgentChangeRecord): Promise<void>;
  getChange(id: string): Promise<AgentChangeRecord | null>;
  /** A workspace's change records, in no particular order. */
  listChanges(workspaceId: string): Promise<AgentChangeRecord[]>;
  deleteChanges(ids: readonly string[]): Promise<void>;
  putSession(record: AgentSessionRecord): Promise<void>;
  getSession(id: string): Promise<AgentSessionRecord | null>;
  listSessions(workspaceId: string): Promise<AgentSessionRecord[]>;
  /** Removes every change and session record of a workspace (when the workspace is deleted). */
  deleteByWorkspace(workspaceId: string): Promise<void>;
}

export interface LoadedUpdates {
  /** Storage keys of the loaded updates, used for safe compaction. */
  keys: number[];
  updates: Uint8Array[];
}

/** Append-only persistence for Yjs document updates. */
export interface YUpdateStore {
  load(docId: string): Promise<LoadedUpdates>;
  append(docId: string, update: Uint8Array): Promise<void>;
  /**
   * Atomically replaces exactly the given previously-loaded updates with one
   * merged update. Updates appended concurrently (e.g. by another tab) are
   * left untouched, so compaction can never lose data.
   */
  compact(docId: string, loadedKeys: number[], merged: Uint8Array): Promise<void>;
  /** Removes a document's whole update log (the document is deleted). */
  clear(docId: string): Promise<void>;
}

export interface PersistenceServices {
  workspaces: WorkspaceRepository;
  canvases: CanvasRepository;
  documents: DocumentRepository;
  assets: AssetRepository;
  meta: MetaRepository;
  yupdates: YUpdateStore;
  aiConnections: AISettingsRepository;
  aiConversations: AIConversationRepository;
  contentSources: ContentSourceRepository;
  /** Repo maps (F43), beside content sources. */
  repoMaps: RepoMapRepository;
  /** Agent State (Lens Phase 7A): change log and MCP sessions. */
  agentState: AgentStateRepository;
}
