/**
 * Output cap and temperature per AI task, for BYOK connections (intelligent-update-engine-plan #7, 2026-11-23; provisional
 * values, recorded in the plan §19).
 *
 * Until now no task set either, and the Copilot SDK sent BYOK requests with no `max_tokens` and `temperature: 1` (§12.30).
 * The direct BYOK path (`host/byok/directChat.ts`) sends what the request carries, so the adapter
 * (`providers/copilot/copilotProvider.ts`) fills these in **only where the request didn't set its own**.
 *
 * - **Caps bound a runaway reply, they don't shape a normal one.** Measured completion tokens (reasoning included,
 *   gpt-oss-120b, `.ai/docs/decision-spike/data/*.stats.jsonl`, 3,081 calls): a measured task gets about twice its largest
 *   reply, rounded up, and never less than 4,096; a task with no measurement gets 16,384. A reply cut at the cap says
 *   `finishReason: "length"` and goes through the runtime's usual repair.
 * - **Temperature by kind of task:** 0 for judgments (the same input should get the same answer), 0.3 for structured
 *   generation (plans, outlines, notes), 0.7 for conversation.
 */

export interface TaskLimits {
  maxTokens: number;
  temperature: number;
}

/** Tasks with no measurement: a generous cap. */
export const UNMEASURED_MAX_TOKENS = 16_384;

const JUDGE = 0;
const STRUCTURED = 0.3;
const CONVERSE = 0.7;

/** Measured (largest reply → cap): decide 393, check_card_meaning 318, find_revisions 375, generate_section_analysis 1,597,
 * outline_document 6,336, generate_visual_plan 7,362. */
const LIMITS: Record<string, TaskLimits> = {
  // Judgments
  classify: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: JUDGE },
  decide: { maxTokens: 4_096, temperature: JUDGE },
  check_card_meaning: { maxTokens: 4_096, temperature: JUDGE },
  find_revisions: { maxTokens: 4_096, temperature: JUDGE },
  assign_to_topics: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: JUDGE },
  match_statements: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: JUDGE },
  route_content: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: JUDGE },
  judge_consistency: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: JUDGE },
  lens_assess: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: JUDGE },
  // Structured generation
  generate_visual_plan: { maxTokens: 16_384, temperature: STRUCTURED },
  outline_document: { maxTokens: 13_312, temperature: STRUCTURED },
  generate_section_analysis: { maxTokens: 4_096, temperature: STRUCTURED },
  resend_cards: { maxTokens: 16_384, temperature: STRUCTURED },
  generate_openui_notes: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  compose_card_layout: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  extract_content: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  extract_entities: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  extract_relationships: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  summarize: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  generate_note: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  transform_note: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  organize: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  lens_review: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  lens_navigate: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  lens_expand: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED },
  // Conversation
  chat: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: CONVERSE },
  suggest: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: CONVERSE },
  lens_explain: { maxTokens: UNMEASURED_MAX_TOKENS, temperature: CONVERSE },
};

/** The task's limits; an unknown task gets the unmeasured cap at the structured temperature. */
export function taskLimitsOf(task: string): TaskLimits {
  return LIMITS[task] ?? { maxTokens: UNMEASURED_MAX_TOKENS, temperature: STRUCTURED };
}
