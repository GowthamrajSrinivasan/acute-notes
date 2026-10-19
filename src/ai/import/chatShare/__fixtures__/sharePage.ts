/**
 * Builds a ChatGPT-shaped share page for tests: a conversation tree encoded as the turbo-stream chunk the real page
 * embeds (shape verified against live pages in Phase 0), so extractor tests run without the network.
 */

export interface FixtureMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text?: string;
  at?: number;
  recipient?: string;
  contentType?: string;
  hidden?: boolean;
  branchingFrom?: { id: string; title: string };
}

export interface FixtureConversation {
  title: string;
  conversationId: string;
  /** The messages on the visible path, root first; `extra` messages hang off the root as unused siblings. */
  messages: FixtureMessage[];
  extra?: FixtureMessage[];
}

function encode(root: unknown): string {
  const table: unknown[] = [];
  const add = (value: unknown): number => {
    if (value === null) return -5;
    if (value === undefined) return -7;
    const index = table.length;
    table.push(null);
    if (Array.isArray(value)) {
      table[index] = value.map(add);
    } else if (value && typeof value === "object") {
      const obj: Record<string, number> = {};
      for (const [k, v] of Object.entries(value)) {
        const keyIndex = add(k);
        obj[`_${keyIndex}`] = add(v);
      }
      table[index] = obj;
    } else {
      table[index] = value;
    }
    return index;
  };
  add(root);
  return JSON.stringify(table);
}

const toRaw = (m: FixtureMessage) => ({
  id: m.id,
  author: { role: m.role },
  create_time: m.at ?? null,
  recipient: m.recipient ?? "all",
  content: { content_type: m.contentType ?? "text", parts: m.text === undefined ? [] : [m.text] },
  metadata: {
    ...(m.hidden ? { is_visually_hidden_from_conversation: true } : {}),
    ...(m.branchingFrom
      ? { branching_from_conversation_id: m.branchingFrom.id, branching_from_conversation_title: m.branchingFrom.title }
      : {}),
  },
});

export function conversationPayload(c: FixtureConversation): Record<string, unknown> {
  const mapping: Record<string, unknown> = { root: { id: "root", parent: null, children: [c.messages[0]?.id], message: null } };
  c.messages.forEach((m, i) => {
    mapping[m.id] = {
      id: m.id,
      parent: i === 0 ? "root" : c.messages[i - 1]!.id,
      children: i + 1 < c.messages.length ? [c.messages[i + 1]!.id] : [],
      message: toRaw(m),
    };
  });
  for (const m of c.extra ?? []) mapping[m.id] = { id: m.id, parent: "root", children: [], message: toRaw(m) };
  return {
    title: c.title,
    create_time: 1_760_000_000,
    conversation_id: `share-${c.conversationId}`,
    backing_conversation_id: c.conversationId,
    current_node: c.messages[c.messages.length - 1]!.id,
    mapping,
  };
}

/** A share page whose first stream chunk carries `c`; `null` yields the "not found" page. */
export function sharePage(c: FixtureConversation | null): string {
  const serverResponse = c ? { type: "data", data: conversationPayload(c) } : { type: "error", error: "Conversation not found" };
  const chunk = encode({
    loaderData: { root: { theme: "light" }, "routes/share.$shareId.($action)": { serverResponse } },
    actionData: null,
    errors: null,
  });
  const enqueue = (s: string) => `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(s)});</script>`;
  return `<!DOCTYPE html><html><head><title>ChatGPT</title></head><body>${enqueue(chunk)}${enqueue("P43:[{}]\n")}</body></html>`;
}
