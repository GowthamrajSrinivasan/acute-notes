/**
 * Reading a `judge_consistency` reply **pair by pair** (plan §12.23, fix C). One bad item no longer loses the whole
 * call, and nothing is ever invented: every pair of the call ends as `classified` (a validated answer) or `failed` (with
 * a reason). A failed pair is never shown as compatible and never hidden as if checked; the ledger
 * (`judgeLedger.ts`) keeps it for a bounded retry.
 *
 * - **Truncated** (the provider's `finish_reason: "length"`, or a reply that stops inside its JSON): every pair fails as
 *   `truncated`. Complete-looking items before the cut are **not** salvaged: a cut-off reply can't be validated as a
 *   whole (fix B: never fabricate or keep half an answer).
 * - **Unreadable** (no JSON object with a `results` array): every pair fails as `unreadable`.
 * - **Readable**: each item is validated on its own against the documented contract (`judgeResult`; `null` reads as
 *   absent, fix A). A valid item classifies its pair. An invalid item fails its pair (`invalid_answer`) when its `ref`
 *   can be read; a pair answered twice fails (`duplicate_answer`); a pair not answered fails (`missing_answer`).
 *   Refs that name no pair of the call are ignored and counted.
 */
import { parseJsonReply } from "@/ai/runtime";
import { judgeResult, type JudgeAnswer } from "./judge";

export type FailReason = "truncated" | "unreadable" | "missing_answer" | "invalid_answer" | "duplicate_answer" | "call_error";

export type PairOutcome =
  | { state: "classified"; answer: JudgeAnswer; why?: string; suggestion?: string }
  | { state: "failed"; reason: FailReason; detail: string };

export interface ReplyReading {
  /** `ok`: every pair classified; `partial`: some failed; the others: the whole reply failed. */
  status: "ok" | "partial" | "truncated" | "unreadable";
  /** One outcome per key of the call, in the call's order. */
  pairs: Map<string, PairOutcome>;
  /** Items whose `ref` named no pair of this call. */
  unknownRefs: number;
}

/** Does `text` stop inside a JSON value (an open string, object or array)? A sign of a cut-off reply. */
export function endsInsideJson(text: string): boolean {
  const start = text.indexOf("{");
  if (start < 0) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return inString || depth > 0;
}

const all = (keys: readonly string[], reason: FailReason, detail: string) => new Map(keys.map((k) => [k, { state: "failed", reason, detail } as PairOutcome] as const));

/**
 * See module doc. `keys[i]` is the pair sent as `p${i + 1}`. `finishReason` is the provider's, when the caller has it
 * (the app's runtime doesn't pass it through today; a cut-off reply is then recognised by its shape).
 */
export function readJudgeReply(raw: string, keys: readonly string[], options: { finishReason?: string | null } = {}): ReplyReading {
  // Cut off: the provider says so, or the reply stops inside a JSON value — **even when an earlier complete block
  // parses** (§12.24 review: "{…compatible…} Wait, correction: {…contradi" must not classify from the first block).
  if (options.finishReason === "length" || endsInsideJson(raw)) {
    return { status: "truncated", pairs: all(keys, "truncated", "the reply was cut off before it finished"), unknownRefs: 0 };
  }
  const parsed = parseJsonReply(raw) as { results?: unknown } | string;
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.results)) {
    return { status: "unreadable", pairs: all(keys, "unreadable", "the reply had no readable results"), unknownRefs: 0 };
  }
  // More items than two per pair sent can't be an honest answer, and reading only a prefix could hide a duplicate.
  if (parsed.results.length > Math.max(keys.length, 1) * 2) {
    return { status: "unreadable", pairs: all(keys, "unreadable", `the reply had ${parsed.results.length} items for ${keys.length} pairs`), unknownRefs: 0 };
  }

  const byRef = new Map<string, string>(keys.map((k, i) => [`p${i + 1}`, k]));
  const seen = new Map<string, PairOutcome[]>();
  let unknownRefs = 0;
  for (const item of parsed.results) {
    const ref = typeof (item as { ref?: unknown })?.ref === "string" ? (item as { ref: string }).ref : null;
    const key = ref ? byRef.get(ref) : undefined;
    if (!key) {
      unknownRefs++;
      continue;
    }
    const r = judgeResult.safeParse(item);
    const outcome: PairOutcome = r.success
      ? { state: "classified", answer: r.data.answer, ...(r.data.why ? { why: r.data.why } : {}), ...(r.data.suggestion ? { suggestion: r.data.suggestion } : {}) }
      : { state: "failed", reason: "invalid_answer", detail: r.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ").slice(0, 200) };
    seen.set(key, [...(seen.get(key) ?? []), outcome]);
  }

  const pairs = new Map<string, PairOutcome>();
  for (const key of keys) {
    const got = seen.get(key) ?? [];
    if (!got.length) pairs.set(key, { state: "failed", reason: "missing_answer", detail: "the reply gave no answer for this pair" });
    else if (got.length > 1) pairs.set(key, { state: "failed", reason: "duplicate_answer", detail: `the reply answered this pair ${got.length} times` });
    else pairs.set(key, got[0]!);
  }
  const failed = [...pairs.values()].filter((p) => p.state === "failed").length;
  return { status: failed === 0 ? "ok" : "partial", pairs, unknownRefs };
}
