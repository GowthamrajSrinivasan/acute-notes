/** What a shared-chat extractor hands to the branch-skip layer and, later, the merge (chat-share plan §6.1). */

export type ChatProvider = "chatgpt" | "gemini" | "claude";

export interface ChatTurn {
  /** The provider's message id; the same in a parent and its branch. */
  id: string;
  /** Position among the visible turns of this conversation. */
  index: number;
  role: "user" | "assistant";
  markdown: string;
  /** Epoch milliseconds, when the provider gives one. */
  at?: number;
  /** `turnHash` of role + normalised text. */
  hash: string;
}

export interface ChatTranscript {
  provider: ChatProvider;
  url: string;
  shareId: string;
  /** ChatGPT: `backing_conversation_id`, the id a branch points at. */
  conversationId?: string;
  title: string;
  sharedAt?: number;
  branchedFrom?: { conversationId: string; title?: string; atTurnId: string };
  turns: ChatTurn[];
}
