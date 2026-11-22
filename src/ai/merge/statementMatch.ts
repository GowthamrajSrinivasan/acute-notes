/**
 * Statement matching (update engine plan §17): when new content is filed under a topic of the notes, each of its
 * statements is matched to the statement of the topic it is about, so the notes are **updated in place** instead of
 * growing a second copy beside the first:
 *
 * - `repeats`  — it says what the matched statement says (in any words): nothing changes;
 * - `replaces` — it is about the same matter and says something different (a new value, schedule, limit, yes/no): the newer
 *                statement takes the matched one's place, so the card that showed the old one is updated;
 * - `adds`     — it adds to the matched statement (an exception, a condition, a detail): it goes right after it, in the same
 *                paragraph, so it joins the card that holds that statement;
 * - `new`      — the topic states nothing about it: it is added at the end of the topic's own text (its last paragraph).
 *
 * Which statement is "the correct card" is a closed choice over numbered statements, so the answer is exact by construction.
 * It is answered by the **decision model** (its own connection, key and model): the typed decision model when one is enabled,
 * else the chat `match_statements` task with `preferDecisionModel`, which asks the configured decision model first and the
 * primary only when it fails. No AI, or a failed call: a deterministic match (`matchLocally`, word overlap and the claim-intent
 * rules of Stage 1a).
 *
 * Every answer is checked before it is used (`guarded`): a "repeats" that carries a number or a negation the matched statement
 * lacks is kept as an addition, and a "replaces" that shares too little with its target is kept as an addition — so a wrong
 * answer can only ever keep text, never lose it.
 */
import { z } from "zod";
import type { DecisionAnswer, DecisionRequest, DecisionTask } from "@/ai/decisions/types";
import { AIError } from "@/ai/errors";
import { significant } from "@/ai/fidelity/information";
import { quantitiesOf, sameQuantity } from "@/ai/fidelity/quantities";
import { wordOverlap } from "@/ai/fidelity/sourceUnits";
import { classifyClaimChange } from "@/ai/reconcile/intent";
import type { AIRuntime } from "@/ai/runtime";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import { statementsOf, type Statement } from "./statements";

export type MatchAction = "repeats" | "replaces" | "adds" | "new";

/** One part filed under one topic: the topic's text and the part's (only what the notes don't already say word for word). */
export const matchInput = z.object({
  items: z.array(z.object({ key: z.string().min(1), topic: z.string(), part: z.string() })).min(1),
});
export type MatchInput = z.infer<typeof matchInput>;
export const matchEnvelope = z.looseObject({ matches: z.array(z.unknown()) });

/** What to do with one statement of a part: its text, and the topic statement it is about (null for `new`). */
export interface StatementPlan {
  statement: string;
  action: MatchAction;
  /** The topic statement's text, exactly as `statementsOf` gives it; null when `new`. */
  target: string | null;
}

/** Below this share of words in common, a "replaces" is not trusted to be about the same matter: it is kept as an addition. */
export const REPLACE_MIN_OVERLAP = 0.25;
/**
 * A statement that contradicts its target replaces it only when it is the same claim flipped ("Write tools are disabled" → "enabled",
 * 0.75 in common). Less in common is an exception with its own, narrower subject ("Every tool requires an API key" → "The
 * health-check tool can be called without an API key", 0.5): it is added beside the rule, which still holds for everything else.
 */
export const FLIP_MIN_OVERLAP = 0.6;
/** The local answer: a statement sharing at least this much with one of the topic's is about it. */
const LOCAL_SAME_MATTER = 0.34;
/** Typed answers below this confidence go to the chat task. */
const PICK_MIN_CONFIDENCE = 0.6;
/** More statements than this in a topic or a part: the typed model isn't asked (the chat task answers). */
const MAX_STATEMENTS = 60;
const NONE = "none";
const ACTIONS: readonly MatchAction[] = ["repeats", "replaces", "adds", "new"];

const itemRef = (i: number) => `i${i + 1}`;
const topicStatements = (input: MatchInput, i: number) => statementsOf(input.items[i]!.topic, `${itemRef(i)}.t`);
const partStatements = (input: MatchInput, i: number) => statementsOf(input.items[i]!.part, `${itemRef(i)}.n`);
const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const matchStatementsTask: TaskDefinition<MatchInput, unknown> = {
  task: "match_statements",
  inputSchema: matchInput,
  outputSchema: matchEnvelope,
  buildPrompt: ({ input, repairFeedback }) => {
    const blocks = input.items
      .map((_, i) => {
        const t = topicStatements(input, i).map((s) => `  [${s.id}] ${excerpt(s.text, 400)}`).join("\n");
        const n = partStatements(input, i).map((s) => `  [${s.id}] ${excerpt(s.text, 400)}`).join("\n");
        return `Item ${itemRef(i)}\nThe notes say:\n${t || "  (nothing yet)"}\nThe newer content says:\n${n}`;
      })
      .join("\n\n");
    const prompt =
      `A user's notes are being updated with newer content about the same subject. For each statement of the newer content, find the statement of the notes it is about, and say what it does to it:\n\n` +
      `- "repeats": it says the same as that statement, in any words. Nothing changes.\n` +
      `- "replaces": it is about the same specific matter (the same setting, value, schedule, limit, rule or yes/no) and says something different. The newer statement wins.\n` +
      `- "adds": it adds to that statement without changing it — an exception, a condition, an example or a detail.\n` +
      `- "new": the notes say nothing about its matter. Use target "none".\n\n` +
      `Pick the target only from the same item's notes, by its id. Every statement of the newer content gets exactly one answer.\n\n` +
      `Reply with JSON only, exactly this shape:\n{"matches":[{"statement":"i1.n.s0","target":"i1.t.s0","action":"repeats"},{"statement":"i1.n.s1","target":"i1.t.s3","action":"replaces"},{"statement":"i1.n.s2","target":"none","action":"new"}]}\n\n` +
      blocks;
    return {
      systemPrompt: "You are a careful editor keeping a user's notes current. You match each new statement to the statement of the notes it is about, and you never invent ids.",
      prompt: repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt,
    };
  },
  // Choosing which statement (which card) a new one is about is a closed routing choice: the decision model answers it first.
  policy: { preferDecisionModel: true },
  timeoutMs: 120_000,
};

const targetQuestion = (s: Statement) => `${s.id.replace(/\./g, "_")}_target`;
const actionQuestion = (s: Statement) => `${s.id.replace(/\./g, "_")}_action`;

/** `match_statements` as typed decisions: per statement of each part, which statement of its topic it is about, and what it does to it. */
export const matchStatementsDecision: DecisionTask<MatchInput, unknown> = {
  fallbackTask: "match_statements",
  timeoutMs: 30_000,
  buildRequest: (input) => {
    if (input.items.some((_, i) => topicStatements(input, i).length > MAX_STATEMENTS || partStatements(input, i).length > MAX_STATEMENTS)) return null;
    return input.items.map((item, i): DecisionRequest => {
      const topic = topicStatements(input, i);
      const choices = [...topic.map((s) => ({ value: s.id, description: excerpt(s.text, 300) })), { value: NONE, description: "the notes say nothing about this matter" }];
      const questions = Object.fromEntries(
        partStatements(input, i).flatMap((s) => [
          [
            targetQuestion(s),
            {
              type: "choice" as const,
              instructions: `Newer statement: “${excerpt(s.text, 300)}”. Which statement of the notes is about the same specific matter (the same setting, value, schedule, limit, rule or fact)? Choose none if the notes say nothing about it.`,
              choices,
            },
          ],
          [
            actionQuestion(s),
            {
              type: "choice" as const,
              instructions: `Newer statement: “${excerpt(s.text, 300)}”. Compared with the statement of the notes it is about, does it repeat it (same meaning), replace it (same matter, something different: the newer one wins), add to it (an exception, condition or detail), or is it new (the notes say nothing about it)?`,
              choices: ACTIONS.map((a) => ({ value: a })),
            },
          ],
        ]),
      );
      return { state: { notes: excerpt(item.topic, 12_000) }, questions };
    });
  },
  interpret: (answers: Record<string, DecisionAnswer>, input) => {
    const matches: { statement: string; target: string; action: MatchAction }[] = [];
    for (let i = 0; i < input.items.length; i++) {
      const topic = topicStatements(input, i);
      for (const s of partStatements(input, i)) {
        const target = answers[targetQuestion(s)];
        const action = answers[actionQuestion(s)];
        if (target?.type !== "choice" || action?.type !== "choice") return null;
        if (target.confidence < PICK_MIN_CONFIDENCE || action.confidence < PICK_MIN_CONFIDENCE) return null;
        if (target.choice !== NONE && !topic.some((t) => t.id === target.choice)) return null;
        if (!ACTIONS.includes(action.choice as MatchAction)) return null;
        matches.push({ statement: s.id, target: target.choice, action: action.choice as MatchAction });
      }
    }
    return { matches };
  },
};

/** A "repeats" is trusted only when the newer statement brings no number or negation its target lacks. */
function reallyRepeats(target: string, statement: string): boolean {
  const verdict = classifyClaimChange(target, statement);
  if (verdict.intent === "DUPLICATE") return true;
  if (verdict.intent === "CONTRADICTS" || verdict.intent === "SUPERSEDES") return false;
  const had = quantitiesOf(target);
  return quantitiesOf(statement).every((q) => had.some((h) => sameQuantity(q, h)));
}

/** Checks one answer against the texts (see module doc): a doubtful answer keeps the statement, never drops it. */
export function guarded(plan: StatementPlan): StatementPlan {
  if (!plan.target) return plan.action === "new" ? plan : { ...plan, action: "new" };
  if (plan.action === "new") return { ...plan, target: null };
  if (plan.action === "repeats" && !reallyRepeats(plan.target, plan.statement)) return { ...plan, action: wordOverlap(plan.target, plan.statement) >= REPLACE_MIN_OVERLAP ? "replaces" : "adds" };
  if (plan.action === "replaces" && wordOverlap(plan.target, plan.statement) < REPLACE_MIN_OVERLAP && !sharesSubject(plan.target, plan.statement)) return { ...plan, action: "adds" };
  if (plan.action === "replaces" && isException(plan.target, plan.statement)) return { ...plan, action: "adds" };
  return plan;
}

/** `statement` contradicts `target` about a narrower subject: an exception to it, not a revision of it (see `FLIP_MIN_OVERLAP`). */
function isException(target: string, statement: string): boolean {
  return classifyClaimChange(target, statement).intent === "CONTRADICTS" && wordOverlap(target, statement) < FLIP_MIN_OVERLAP;
}

/** The two statements open with the same significant words (their subject): "Access tokens are rotated …" / "Access tokens expire …". */
function sharesSubject(a: string, b: string): boolean {
  const [x, y] = [significant(a).slice(0, 2), significant(b).slice(0, 2)];
  return x.length === 2 && x[0] === y[0] && x[1] === y[1];
}

/**
 * Whether any statement of `part` is about one of `topic`'s (the local bar): the free gate before the decision model is asked. A part
 * with none brings only new statements; matching them would change nothing.
 */
export function relatesTo(topic: string, part: string): boolean {
  const own = statementsOf(topic, "t").map((s) => s.text);
  return statementsOf(part, "n").some((s) => own.some((t) => wordOverlap(t, s.text) >= LOCAL_SAME_MATTER));
}

/** The deterministic answer: the topic statement most like each new one, and the claim-intent rules on the pair. */
export function matchLocally(topic: string, part: string): StatementPlan[] {
  const own = statementsOf(topic, "t");
  return statementsOf(part, "n").map((s) => {
    let best: { text: string; overlap: number } | null = null;
    for (const t of own) {
      const overlap = wordOverlap(t.text, s.text);
      if (!best || overlap > best.overlap) best = { text: t.text, overlap };
    }
    if (!best || best.overlap < LOCAL_SAME_MATTER) return { statement: s.text, action: "new", target: null };
    const intent = classifyClaimChange(best.text, s.text).intent;
    const action: MatchAction = intent === "DUPLICATE" ? "repeats" : intent === "UNCLEAR" ? "adds" : "replaces";
    return guarded({ statement: s.text, action, target: best.text });
  });
}

/** The plans in a reply (the chat task's, or the typed model's in the same shape); a statement left out gets the local answer. */
export function validateMatches(raw: unknown, input: MatchInput): Map<string, StatementPlan[]> {
  const rows = typeof raw === "object" && raw !== null && Array.isArray((raw as { matches?: unknown }).matches) ? (raw as { matches: unknown[] }).matches : [];
  const answered = new Map<string, { target: string; action: MatchAction }>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { statement, target, action } = row as { statement?: unknown; target?: unknown; action?: unknown };
    if (typeof statement !== "string" || typeof target !== "string" || !ACTIONS.includes(action as MatchAction)) continue;
    if (!answered.has(statement)) answered.set(statement, { target, action: action as MatchAction });
  }
  const out = new Map<string, StatementPlan[]>();
  input.items.forEach((item, i) => {
    const topic = topicStatements(input, i);
    const local = matchLocally(item.topic, item.part);
    out.set(
      item.key,
      partStatements(input, i).map((s, k) => {
        const a = answered.get(s.id);
        if (!a) return local[k]!;
        const target = a.target === NONE ? null : (topic.find((t) => t.id === a.target)?.text ?? undefined);
        if (target === undefined) return local[k]!;
        return guarded({ statement: s.text, action: a.action, target });
      }),
    );
  });
  return out;
}

/**
 * Per item (a part filed under a topic), what each of its statements does to the topic: asked of the decision model when
 * `useAI`, else (and when AI fails) answered locally. Never throws for an AI failure; `failed` says it fell back.
 */
export async function matchStatements(runtime: AIRuntime | null, input: MatchInput, signal?: AbortSignal): Promise<{ plans: Map<string, StatementPlan[]>; by: "ai" | "local"; failed: boolean }> {
  const local = () => new Map(input.items.map((item) => [item.key, matchLocally(item.topic, item.part)] as const));
  if (!runtime) return { plans: local(), by: "local", failed: false };
  try {
    const reply = await runtime.decide<MatchInput, unknown>(matchStatementsDecision, input, { signal });
    return { plans: validateMatches(reply.data, input), by: "ai", failed: false };
  } catch (err) {
    if (signal?.aborted || (err instanceof AIError && err.kind === "cancelled")) throw err;
    return { plans: local(), by: "local", failed: true };
  }
}

export function registerStatementMatchTask(registry: TaskRegistry): void {
  if (!registry.has(matchStatementsTask.task)) registry.register(matchStatementsTask as TaskDefinition<never, unknown>);
}

registerStatementMatchTask(getTaskRegistry());
