import { turnHash } from "./hash";
import type { ShareLink } from "./providers";
import type { ChatTranscript, ChatTurn } from "./types";
import { decodeTurboChunk, streamChunks } from "./turboStream";

export type ChatShareErrorCode = "not_found" | "unreadable" | "empty";

export class ChatShareError extends Error {
  constructor(
    readonly code: ChatShareErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatShareError";
  }
}

const LOADER_KEY = "routes/share.$shareId.($action)";

interface RawMessage {
  id?: unknown;
  author?: { role?: unknown };
  create_time?: unknown;
  recipient?: unknown;
  content?: { content_type?: unknown; parts?: unknown };
  metadata?: Record<string, unknown>;
}
interface RawNode {
  id?: unknown;
  parent?: unknown;
  message?: RawMessage | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Map);

/** ChatGPT wraps web citations in private-use markers (`\ue200cite\ue202turn0search0\ue201`); they aren't prose. */
const CITATION = /\ue200[\s\S]*?\ue201/g;

/** The conversation object inside a decoded chunk (a `mapping` with a `current_node`), searched breadth-first and bounded. */
function findConversation(root: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [root];
  for (let seen = 0; queue.length && seen < 2000; seen++) {
    const value = queue.shift();
    if (!isRecord(value)) continue;
    if (isRecord(value.mapping) && typeof value.current_node === "string") return value;
    queue.push(...Object.values(value));
  }
  return null;
}

/** Whether a decoded chunk is the loader result reporting that the share doesn't exist (or was unshared). */
function reportsError(root: unknown): boolean {
  if (!isRecord(root)) return false;
  const loader = isRecord(root.loaderData) ? root.loaderData[LOADER_KEY] : null;
  const response = isRecord(loader) ? loader.serverResponse : null;
  return isRecord(response) && response.type === "error";
}

function visibleText(message: RawMessage): string | null {
  const role = message.author?.role;
  if (role !== "user" && role !== "assistant") return null;
  if (message.recipient !== undefined && message.recipient !== null && message.recipient !== "all") return null;
  if (message.metadata?.is_visually_hidden_from_conversation) return null;
  const type = message.content?.content_type;
  if (type !== "text" && type !== "multimodal_text") return null;
  const parts = message.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter((p): p is string => typeof p === "string")
    .join("\n\n")
    .replace(CITATION, "")
    .trim();
  return text || null;
}

/** The transcript of a ChatGPT share page's HTML. Throws `ChatShareError` when the page holds no readable conversation. */
export function extractChatGpt(html: string, link: ShareLink): ChatTranscript {
  const chunks = streamChunks(html);
  if (!chunks.length) throw new ChatShareError("unreadable", "The page doesn't contain a shared conversation.");

  let conversation: Record<string, unknown> | null = null;
  let errored = false;
  for (const chunk of chunks) {
    const json = chunk.replace(/^P\d+:/, "");
    let decoded: unknown;
    try {
      decoded = decodeTurboChunk(json);
    } catch {
      continue;
    }
    conversation = findConversation(decoded);
    if (conversation) break;
    errored ||= reportsError(decoded);
  }
  if (!conversation) {
    throw errored
      ? new ChatShareError("not_found", "That share link doesn't exist or is no longer shared.")
      : new ChatShareError("unreadable", "The page doesn't contain a shared conversation.");
  }

  const mapping = conversation.mapping as Record<string, RawNode>;
  const path: RawNode[] = [];
  const visited = new Set<string>();
  for (let id: unknown = conversation.current_node; typeof id === "string" && !visited.has(id); ) {
    visited.add(id);
    const node = mapping[id];
    if (!isRecord(node)) break;
    path.push(node as RawNode);
    id = node.parent;
  }
  path.reverse();

  const turns: ChatTurn[] = [];
  let branchedFrom: ChatTranscript["branchedFrom"];
  for (const node of path) {
    const message = node.message;
    if (!message) continue;
    const parentId = message.metadata?.branching_from_conversation_id;
    if (!branchedFrom && typeof parentId === "string") {
      const title = message.metadata?.branching_from_conversation_title;
      branchedFrom = {
        conversationId: parentId,
        ...(typeof title === "string" ? { title } : {}),
        atTurnId: typeof message.id === "string" ? message.id : String(node.id),
      };
    }
    const markdown = visibleText(message);
    if (markdown === null) continue;
    const role = message.author!.role as ChatTurn["role"];
    turns.push({
      id: typeof message.id === "string" ? message.id : String(node.id),
      index: turns.length,
      role,
      markdown,
      ...(typeof message.create_time === "number" ? { at: Math.round(message.create_time * 1000) } : {}),
      hash: turnHash(role, markdown),
    });
  }
  if (!turns.length) throw new ChatShareError("empty", "The shared conversation has no readable messages.");

  const created = conversation.create_time;
  return {
    provider: "chatgpt",
    url: link.url,
    shareId: link.shareId,
    ...(typeof conversation.backing_conversation_id === "string" ? { conversationId: conversation.backing_conversation_id } : {}),
    title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title.trim() : "Shared chat",
    ...(typeof created === "number" ? { sharedAt: Math.round(created * 1000) } : {}),
    ...(branchedFrom ? { branchedFrom } : {}),
    turns,
  };
}
