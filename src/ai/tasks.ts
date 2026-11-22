/**
 * The AI task registry (PRD §13.15.8): features request a task, never a
 * model. Each task declares its input/output schema, how to build the
 * provider prompt from validated input, and its routing policy.
 *
 * F26 ships the registry mechanism only. Concrete task definitions
 * (generate_visual_plan, extract_content, ...) are registered by the
 * features that own their schema — F28/F29/F31, F18, F22, etc. — as each is
 * built, not stubbed here.
 */
import type { z } from "zod";

export type AITask =
  | "classify"
  | "extract_content"
  | "extract_entities"
  | "extract_relationships"
  | "summarize"
  | "generate_note"
  | "transform_note"
  | "organize"
  | "generate_visual_plan"
  | "outline_document"
  | "generate_section_analysis"
  // Knowledge Notes §3.4: the optional model check of distilled cards against the source they cite (one batched call per section).
  | "check_card_meaning"
  // Knowledge Notes §6.1 (Phase 3, behind its switch until R2): the cards citing changed passages, rewritten only as far as the change needs.
  | "resend_cards"
  // Topic merge (G2): which existing topic each part of new content belongs to.
  | "assign_to_topics"
  // Topic merge G3.3: where a document revises itself (a later statement replacing an earlier one in the same section).
  | "find_revisions"
  // Update engine §17: per statement of new content filed under a topic, which statement of the topic it repeats, replaces or adds to.
  | "match_statements"
  // OpenUI Notes view (openui-integration-plan Phase 2): a source distilled into OpenUI Lang idea cards, streamed into the reading view.
  | "generate_openui_notes"
  // Update engine Stage 2d: where content with no source belongs, among the router's candidate cards — or a question back.
  | "route_content"
  // Update engine Stage 4f: whether pairs of statements the rules left "possible" contradict — evidence for the user only (not active).
  | "judge_consistency"
  | "suggest"
  | "chat"
  // Acute Lens Phase 5 (plan §6): explain a node, map a question onto node keys, generate the next level.
  | "lens_explain"
  | "lens_navigate"
  | "lens_expand"
  // Design review of the level Lens shows: requirements, capacity, "what breaks at 10x", failure modes, tradeoffs.
  | "lens_review"
  // The same level assessed against a list of interview-style questions: a verdict, an answer and an improvement each.
  | "lens_assess";

export interface TaskRoutingPolicy {
  /**
   * Calls of tasks with this set share one cap on how many run at once, and a rate-limited one is retried after a
   * pause before the next provider is tried (the runtime's `maxConcurrent` / `rateLimitBackoffMs`). For the tasks a
   * document fans out into one call per section.
   */
  limitConcurrency?: boolean;
  /** Try the optional decision-model role first, discarding any failure and falling through to primary silently (§13.15.9). */
  preferDecisionModel?: boolean;
}

export interface TaskPromptInput<TIn> {
  input: TIn;
  /** Set on the one-shot repair retry after a schema-validation failure. */
  repairFeedback?: string;
}

export interface TaskDefinition<TIn = unknown, TOut = unknown> {
  task: AITask;
  inputSchema: z.ZodType<TIn>;
  outputSchema: z.ZodType<TOut>;
  /**
   * `json` (default): the response is parsed as JSON before validation.
   * `text`: the raw response text is validated as-is (e.g. Markdown prose) —
   * the only kind of task whose output may be streamed into a preview.
   */
  outputFormat?: "json" | "text";
  buildPrompt(input: TaskPromptInput<TIn>): { systemPrompt?: string; prompt: string };
  policy: TaskRoutingPolicy;
  /** How long one call may take; omitted leaves the connection's own default (the Copilot SDK's is 60s). */
  timeoutMs?: number;
}

export interface TaskRegistry {
  register<TIn, TOut>(def: TaskDefinition<TIn, TOut>): void;
  get<TIn = unknown, TOut = unknown>(task: AITask): TaskDefinition<TIn, TOut>;
  has(task: AITask): boolean;
}

/** Isolated registry instance — tests build their own instead of sharing global state. */
export function createTaskRegistry(): TaskRegistry {
  const defs = new Map<AITask, TaskDefinition<unknown, unknown>>();
  return {
    register(def) {
      if (defs.has(def.task)) {
        throw new Error(`AI task "${def.task}" is already registered.`);
      }
      defs.set(def.task, def as unknown as TaskDefinition<unknown, unknown>);
    },
    get<TIn, TOut>(task: AITask) {
      const def = defs.get(task);
      if (!def) throw new Error(`AI task "${task}" has no registered definition.`);
      return def as unknown as TaskDefinition<TIn, TOut>;
    },
    has(task) {
      return defs.has(task);
    },
  };
}

let registry: TaskRegistry | null = null;

/** App-wide task registry. Features register their tasks here once, at module load. */
export function getTaskRegistry(): TaskRegistry {
  if (!registry) registry = createTaskRegistry();
  return registry;
}
