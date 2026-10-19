"use client";

/**
 * Shared UI state for the AI side panel (F18 Ask AI + F40 conversations):
 * AI mode for React, which tab the panel shows, open requests (optionally
 * on a saved conversation), and the conversation store as hooks.
 */
import { useSyncExternalStore } from "react";
import { getAIMode, subscribeAIMode, type AIMode } from "@/ai/aiMode";
import { getConversationStore } from "@/ai/conversations/conversationStore";

export function useAIMode(): AIMode {
  return useSyncExternalStore(subscribeAIMode, getAIMode, () => "off");
}

/** "agent": the agent change log (Agent State, Lens Phase 7A) — what agents and AI changed, reverted from there. */
export type AIPanelTab = "chat" | "history" | "agent";
export type HistoryFilter = "selection" | "all";
/**
 * What a new chat is about: `"selection"` (the properties panel, opened on a
 * selection) or `"auto"` (the header: the selection when there is one, else
 * the whole canvas).
 */
export type ChatContext = "selection" | "auto";

export interface AIPanelState {
  open: boolean;
  tab: AIPanelTab;
  /** Set by an open request for a saved conversation (consumed by the panel). */
  conversationId?: string;
  /** Set by `openHistory` to choose the History filter. */
  historyFilter?: HistoryFilter;
  /** Set by `openChat` for a new chat (consumed by the panel). */
  context?: ChatContext;
  /** Bumped on every open request, so repeating one is noticed. */
  seq: number;
}

let state: AIPanelState = { open: false, tab: "chat", seq: 0 };
const listeners = new Set<() => void>();
function set(next: AIPanelState) {
  state = next;
  for (const l of listeners) l();
}

export const aiPanel = {
  get: (): AIPanelState => state,
  /** ✨ Ask AI: the Chat tab (a new chat, or a saved conversation). */
  openChat(options: { conversationId?: string; context?: ChatContext } = {}) {
    set({ open: true, tab: "chat", seq: state.seq + 1, ...options });
  },
  /** The History tab; defaults to the selection's conversations when something is selected. */
  openHistory(filter?: HistoryFilter) {
    set({ open: true, tab: "history", seq: state.seq + 1, ...(filter ? { historyFilter: filter } : {}) });
  },
  /** The agent log tab (Agent State's change log). */
  openAgentHistory() {
    set({ open: true, tab: "agent", seq: state.seq + 1 });
  },
  setTab(tab: AIPanelTab) {
    if (state.tab !== tab) set({ ...state, tab, conversationId: undefined, historyFilter: undefined, context: undefined });
  },
  close() {
    if (state.open) set({ open: false, tab: state.tab, seq: state.seq });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useAIPanel(): AIPanelState {
  return useSyncExternalStore(aiPanel.subscribe, aiPanel.get, () => state);
}

/** Re-renders when conversations change; read lists from `getConversationStore()`. */
export function useConversationsVersion(): number {
  const store = getConversationStore();
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.getVersion(),
    () => 0,
  );
}

export function useSaveConversations(): boolean {
  const store = getConversationStore();
  return useSyncExternalStore(
    (l) => store.subscribeSaving(l),
    () => store.isSaving(),
    () => true,
  );
}

/** Asks the header to open AI settings (it owns that dialog). */
export const OPEN_AI_SETTINGS_EVENT = "acute:open-ai-settings";

export function openAISettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_AI_SETTINGS_EVENT));
}
