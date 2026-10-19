/**
 * AI conversation history (F40): the in-memory view of a workspace's
 * conversations over `AIConversationRepository`, plus the device-local
 * "Save AI conversations on this device" setting (on by default).
 *
 * Writes: one transaction per completed exchange (question + reply), never
 * per streamed token; a cancelled exchange writes nothing. With saving off,
 * conversations still work for the session but are never written.
 */
import type { AIScope } from "@/ai/context/selectionContext";
import { newId } from "@/domain/ids";
import { getPersistence, type AIConversationRepository, type MetaRepository } from "@/persistence";
import { conversationTitle, conversationsFor, conversationsToJson, conversationToMarkdown, orphanedBy, type ConversationsExport } from "./history";
import { CONVERSATION_SCHEMA_VERSION, type AIConversation, type AITurn, type AssistantTurn, type UserTurn } from "./types";

const SAVE_KEY = "ai.saveConversations";

export interface StartConversation {
  workspaceId: string;
  canvasId: string;
  anchorIds: string[];
  anchorLabel: string;
  scope: AIScope;
}

type NewUserTurn = Omit<UserTurn, "conversationId" | "seq" | "createdAt" | "role">;
type NewAssistantTurn = Omit<AssistantTurn, "conversationId" | "seq" | "createdAt" | "role">;

export class ConversationStore {
  private readonly headers = new Map<string, AIConversation>();
  private readonly turns = new Map<string, AITurn[]>();
  /** Conversations that exist only in memory (not yet answered, or saving is off). */
  private readonly unsaved = new Set<string>();
  private readonly loaded = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private save = true;
  private readonly saveListeners = new Set<() => void>();

  constructor(
    private readonly repo: () => AIConversationRepository,
    private readonly meta: () => MetaRepository,
  ) {}

  // ---- setting -----------------------------------------------------------

  isSaving(): boolean {
    return this.save;
  }

  async setSaving(on: boolean): Promise<void> {
    if (on === this.save) return;
    this.save = on;
    for (const l of this.saveListeners) l();
    await this.meta().set(SAVE_KEY, on);
  }

  subscribeSaving(listener: () => void): () => void {
    this.saveListeners.add(listener);
    return () => this.saveListeners.delete(listener);
  }

  async loadSetting(): Promise<void> {
    const stored = await this.meta().get<boolean>(SAVE_KEY);
    if (typeof stored === "boolean" && stored !== this.save) {
      this.save = stored;
      for (const l of this.saveListeners) l();
    }
  }

  // ---- reads -------------------------------------------------------------

  /** Loads a workspace's conversation headers once (turns load on open). */
  load(workspaceId: string): Promise<void> {
    let p = this.loaded.get(workspaceId);
    if (!p) {
      p = this.repo()
        .listByWorkspace(workspaceId)
        .then((list) => {
          for (const c of list) if (!this.headers.has(c.id)) this.headers.set(c.id, c);
          this.emit();
        });
      this.loaded.set(workspaceId, p);
    }
    return p;
  }

  /** Conversations with at least one answered turn, newest first; optionally one canvas's. */
  list(workspaceId: string, canvasId?: string): AIConversation[] {
    return [...this.headers.values()]
      .filter((c) => c.workspaceId === workspaceId && c.turnCount > 0 && (!canvasId || c.canvasId === canvasId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** A selection's conversations (anchored to any selected element). */
  listFor(workspaceId: string, canvasId: string, elementIds: readonly string[]): AIConversation[] {
    return conversationsFor(this.list(workspaceId, canvasId), elementIds);
  }

  /** Conversations whose objects are all among `deletedIds`. */
  orphanedBy(workspaceId: string, canvasId: string, deletedIds: ReadonlySet<string>): AIConversation[] {
    return orphanedBy(this.list(workspaceId, canvasId), deletedIds);
  }

  /** Element ids that anchor a conversation on a canvas (for deletion checks). */
  anchoredIds(workspaceId: string, canvasId: string): Set<string> {
    return new Set(this.list(workspaceId, canvasId).flatMap((c) => c.anchorIds));
  }

  get(id: string): AIConversation | undefined {
    return this.headers.get(id);
  }

  isSaved(id: string): boolean {
    return this.headers.has(id) && !this.unsaved.has(id);
  }

  async getTurns(id: string): Promise<AITurn[]> {
    const cached = this.turns.get(id);
    if (cached) return cached;
    const stored = await this.repo().get(id);
    const turns = stored?.turns ?? [];
    this.turns.set(id, turns);
    return turns;
  }

  /**
   * The conversation on a canvas whose reply produced an AI operation (F25
   * "View context"); null when none is saved. Reads turns only on request.
   */
  async findByOperation(workspaceId: string, canvasId: string, operationId: string): Promise<string | null> {
    await this.load(workspaceId);
    for (const c of this.list(workspaceId, canvasId)) {
      const turns = await this.getTurns(c.id);
      if (turns.some((t) => t.role === "assistant" && t.provenance.operationId === operationId)) return c.id;
    }
    return null;
  }

  // ---- writes ------------------------------------------------------------

  /** A new, empty conversation (in memory until its first exchange completes). */
  start(input: StartConversation, now = Date.now()): AIConversation {
    const conversation: AIConversation = {
      id: newId("conv"),
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      ...input,
      title: input.anchorLabel,
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.headers.set(conversation.id, conversation);
    this.turns.set(conversation.id, []);
    this.unsaved.add(conversation.id);
    return conversation;
  }

  /** Records one completed exchange; one repository write when saving is on. */
  async recordExchange(id: string, user: NewUserTurn, assistant: NewAssistantTurn, now = Date.now()): Promise<AITurn[]> {
    const header = this.headers.get(id);
    if (!header) throw new Error(`Unknown conversation ${id}`);
    const turns = await this.getTurns(id);
    const seq = turns.length;
    const added: AITurn[] = [
      { ...user, conversationId: id, seq, createdAt: now, role: "user" },
      { ...assistant, conversationId: id, seq: seq + 1, createdAt: now, role: "assistant" },
    ];
    const next: AIConversation = {
      ...header,
      title: header.turnCount === 0 ? conversationTitle(user, header.anchorLabel) : header.title,
      turnCount: header.turnCount + added.length,
      updatedAt: now,
    };
    this.headers.set(id, next);
    this.turns.set(id, [...turns, ...added]);
    this.emit();

    if (this.save) {
      // Previously unsaved turns (e.g. saving was just turned on) go in the same write.
      const toWrite = this.unsaved.has(id) ? [...turns, ...added] : added;
      await this.repo().append(next, toWrite);
      this.unsaved.delete(id);
    }
    return added;
  }

  async delete(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const saved = !this.unsaved.has(id);
      this.headers.delete(id);
      this.turns.delete(id);
      this.unsaved.delete(id);
      if (saved) await this.repo().delete(id);
    }
    this.emit();
  }

  async deleteAll(workspaceId: string): Promise<void> {
    for (const c of [...this.headers.values()]) {
      if (c.workspaceId !== workspaceId) continue;
      this.headers.delete(c.id);
      this.turns.delete(c.id);
      this.unsaved.delete(c.id);
    }
    await this.repo().deleteAll(workspaceId);
    this.emit();
  }

  /** Every conversation on this device, in every workspace. */
  async deleteAllEverywhere(): Promise<void> {
    this.headers.clear();
    this.turns.clear();
    this.unsaved.clear();
    await this.repo().deleteAll();
    this.emit();
  }

  // ---- export ------------------------------------------------------------

  async exportMarkdown(id: string): Promise<string> {
    const header = this.headers.get(id);
    if (!header) throw new Error(`Unknown conversation ${id}`);
    return conversationToMarkdown(header, await this.getTurns(id));
  }

  async exportJson(workspaceId: string, canvasId?: string): Promise<ConversationsExport> {
    const items = await Promise.all(this.list(workspaceId, canvasId).map(async (conversation) => ({ conversation, turns: await this.getTurns(conversation.id) })));
    return conversationsToJson(items);
  }

  // ---- change notification (useSyncExternalStore) --------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

let store: ConversationStore | null = null;

/** App-wide conversation store over local persistence. */
export function getConversationStore(): ConversationStore {
  store ??= new ConversationStore(
    () => getPersistence().aiConversations,
    () => getPersistence().meta,
  );
  return store;
}
