/**
 * `compose_card_layout` (note-taking-modes plan Step 7): the canvas's own AI changes one layout card — "Ask AI to change"
 * on a layout card, "Ask AI to refresh" on one whose text changed. The user's in-app action, asked first, ONE model request
 * (`requestPolicy.ts`: no SDK retry, no schema repair). The reply is the card's Markdown and its OpenUI Lang; the caller
 * checks the layout against that text (`layoutCheck.ts`) and puts it up for review — nothing changes until it is accepted.
 */
import { z } from "zod";
import { AIError } from "@/ai/errors";
import type { AIRuntime } from "@/ai/runtime";
import { setOneRequestPolicy } from "@/ai/requestPolicy";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import { CARD_LAYOUT_LANG_MAX } from "@/domain/types";
import { layoutGrammar } from "./layoutGrammar";

export const COMPOSE_LAYOUT_TASK = "compose_card_layout" as const;

/** The reply is one card: its Markdown and its Lang, well under this. */
export const COMPOSE_LAYOUT_MAX_OUTPUT_TOKENS = 6_000;

const composeInput = z.object({
  /** The card's Markdown as it is now. */
  markdown: z.string().min(1).max(20_000),
  /** Its stored layout, when it has one (for "keep the structure" and "refresh"). */
  currentLang: z.string().max(CARD_LAYOUT_LANG_MAX).optional(),
  /** What the user asked for. */
  instruction: z.string().min(1).max(2_000),
  /** The source units the card cites — the only ids a layout may cite. */
  cites: z.array(z.string().max(40)).max(50),
  /** Layout only: the card's text is fixed; the reply is a layout alone (any Markdown in it is ignored by the caller). */
  keepText: z.boolean().optional(),
});
export type ComposeLayoutInput = z.infer<typeof composeInput>;

const RULES = [
  "Reply with the card's Markdown between <markdown> and </markdown> (left out when the request says the text is fixed), then its layout between <layout> and </layout>, and nothing else.",
  "Return the card's Markdown exactly as given unless the instruction asks to change what the card SAYS; then change only that. A request about how the card LOOKS — a timeline, a table, a callout, a diagram, an order, a summary line — changes only the layout, never the Markdown.",
  "Build every label, summary and cell from the card's own words; numbers may be written as digits.",
  "The layout shows what the Markdown says — no fact, number or name the Markdown doesn't have.",
];

function prompt(input: ComposeLayoutInput): string {
  return [
    `Instruction: ${input.instruction}`,
    ...(input.keepText ? ["Layout only: the card's text is fixed. Reply with only the <layout> part, built from the text as it is; do not include <markdown>."] : []),
    input.cites.length ? `The card cites these source units; cite only these ids: ${input.cites.join(", ")}.` : "The card cites no source; use no CitationChip or citations.",
    "Card Markdown:",
    input.markdown,
    ...(input.currentLang ? ["Current layout:", input.currentLang] : ["The card has no layout yet."]),
  ].join("\n\n");
}

export const composeLayoutTask: TaskDefinition<ComposeLayoutInput, string> = {
  task: COMPOSE_LAYOUT_TASK,
  inputSchema: composeInput,
  // Any reply is taken as it is (the caller reads and checks it), so the runtime never sends a repair: one click, one request.
  outputSchema: z.string().catch(""),
  outputFormat: "text",
  buildPrompt: ({ input }) => ({ systemPrompt: `${layoutGrammar()}\n\n## This request\n\n${RULES.map((r) => `- ${r}`).join("\n")}`, prompt: prompt(input) }),
  policy: {},
  timeoutMs: 120_000,
};

export function registerComposeLayoutTask(registry: TaskRegistry): void {
  if (!registry.has(COMPOSE_LAYOUT_TASK)) registry.register(composeLayoutTask);
}
registerComposeLayoutTask(getTaskRegistry());
setOneRequestPolicy(COMPOSE_LAYOUT_TASK, { maxTokens: COMPOSE_LAYOUT_MAX_OUTPUT_TOKENS });

const between = (text: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(text);
  return m ? m[1]!.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, "").trim() : null;
};

/** The reply's Markdown and Lang (each null when missing or empty). */
export function readComposed(text: string): { markdown: string | null; lang: string | null } {
  return { markdown: between(text, "markdown") || null, lang: between(text, "layout") || null };
}

/** Runs the task once. Throws what the runtime throws (AI off, no provider, cancelled), and `invalid_output` for a reply with no layout. */
export async function composeLayout(
  runtime: AIRuntime,
  input: ComposeLayoutInput,
  opts: { signal?: AbortSignal } = {},
): Promise<{ markdown: string | null; lang: string; provenance: { providerId: string; model: string } }> {
  // A fresh signal per run: the one-request guard tells runs apart by it.
  const run = new AbortController();
  const onAbort = () => run.abort(opts.signal?.reason);
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await runtime.run<ComposeLayoutInput, string>(COMPOSE_LAYOUT_TASK, input, { signal: run.signal });
    const { markdown, lang } = readComposed(result.data);
    if (!lang) throw new AIError("invalid_output", "The AI's reply had no layout.");
    return { markdown, lang, provenance: { providerId: result.providerId, model: result.usage.model } };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
