/**
 * AI conversation history (F40). A conversation belongs to one canvas and is
 * anchored to the objects selected when it started; its turns are
 * append-only. Device-local: never part of workspace documents, Yjs state or
 * workspace exports, and never holds secrets.
 *
 * Sync-ready by shape: a header that changes once per exchange plus
 * append-only turns keyed by (conversationId, seq), so a future cloud sync
 * (PRD Cloud Phase 1–2) pushes only turns it hasn't sent — no rewrites.
 */
import type { AIScope } from "@/ai/context/selectionContext";
import type { ProviderRole } from "@/ai/runtime";

export const CONVERSATION_SCHEMA_VERSION = 1;

export interface AIConversation {
  id: string;
  schemaVersion: number;
  workspaceId: string;
  canvasId: string;
  /** Canvas element ids selected when the conversation started. */
  anchorIds: string[];
  /** Short human label for the anchors, e.g. "Checkout API" or "3 objects". */
  anchorLabel: string;
  title: string;
  /** Scope follow-ups run with. */
  scope: AIScope;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TurnProvenance {
  task: string;
  providerId: string;
  role: ProviderRole;
  model: string;
  operationId: string;
}

export type AITurn =
  | {
      conversationId: string;
      seq: number;
      role: "user";
      createdAt: number;
      /** A menu action (e.g. "summarize"), or absent for a typed question. */
      action?: string;
      /** The action label or the question as typed. */
      text: string;
      scope: AIScope;
      /** Objects whose content was sent with this turn. */
      sourceIds: string[];
    }
  | {
      conversationId: string;
      seq: number;
      role: "assistant";
      createdAt: number;
      kind: "note" | "tasks";
      title: string;
      /** Markdown reply (tasks are stored as a Markdown checklist too, for display and export). */
      text: string;
      tasks?: string[];
      provenance: TurnProvenance;
    };

export type UserTurn = Extract<AITurn, { role: "user" }>;
export type AssistantTurn = Extract<AITurn, { role: "assistant" }>;
