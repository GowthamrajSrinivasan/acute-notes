/**
 * The router's optional model step (intelligent-update-engine-plan Stage 2d): when the deterministic router can't tell
 * two places apart (`NEEDS_CLARIFICATION`), a model may read the content and the candidate cards and pick one or more,
 * say none fits (`new`), or answer `needs_clarification` with a question for the user. Grouping, not authoring.
 *
 * The model only chooses among the cards it was shown, by reference; it never invents a destination, and it never
 * changes either confidence — those stay the router's own measurements. A failed call or an unreadable reply leaves the
 * router's result as it was: the user is asked, as without AI.
 */
import { z } from "zod";
import type { AIRuntime } from "@/ai/runtime";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import type { RouteResult } from "./router";

export const ROUTE_CONTENT_LIMITS = { content: 4_000, candidates: 8, summary: 300 } as const;

const routeInput = z.object({
  content: z.string().min(1).max(ROUTE_CONTENT_LIMITS.content),
  candidates: z
    .array(z.object({ ref: z.string(), title: z.string().max(200), section: z.string().max(200).optional(), summary: z.string().max(ROUTE_CONTENT_LIMITS.summary) }))
    .min(1)
    .max(ROUTE_CONTENT_LIMITS.candidates),
});
type RouteContentInput = z.infer<typeof routeInput>;

const routeOutput = z.object({
  decision: z.enum(["route", "new", "needs_clarification"]),
  targets: z.array(z.string()).max(ROUTE_CONTENT_LIMITS.candidates).optional(),
  question: z.string().max(300).optional(),
  reason: z.string().max(300).optional(),
});
export type RouteContentOutput = z.infer<typeof routeOutput>;

const ref = (i: number) => `c${i + 1}`;

export const routeContentTask: TaskDefinition<RouteContentInput, RouteContentOutput> = {
  task: "route_content",
  inputSchema: routeInput,
  outputSchema: routeOutput,
  buildPrompt: ({ input, repairFeedback }) => {
    const cards = input.candidates.map((c) => `[${c.ref}] ${c.title}${c.section ? ` (section “${c.section}”)` : ""}\n${c.summary}`).join("\n\n");
    const prompt =
      `A user wants to add new content to their notes. Decide which existing card(s) it belongs with.\n\n` +
      `- "route": the content is about the same matter as one or more cards; list them in "targets" (most fitting first).\n` +
      `- "new": no card is about the same matter; it starts a new card.\n` +
      `- "needs_clarification": more than one card could fit and the content doesn't say which; ask the user one short question.\n` +
      `- Use only the card references shown. Never invent cards.\n\n` +
      `Reply with JSON only: {"decision":"route","targets":["c2"],"reason":"…"} or {"decision":"new","reason":"…"} or {"decision":"needs_clarification","question":"…"}\n\n` +
      `Cards:\n\n${cards}\n\nNew content:\n${input.content}`;
    return {
      systemPrompt: "You are an information architect. You file new content with the notes it belongs to, and you ask when it is genuinely unclear.",
      prompt: repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt,
    };
  },
  policy: { preferDecisionModel: true },
  timeoutMs: 60_000,
};

export function registerRouterTasks(registry: TaskRegistry): void {
  if (!registry.has(routeContentTask.task)) registry.register(routeContentTask);
}

registerRouterTasks(getTaskRegistry());

/** The model's answer, applied to a router result (see module doc). */
export interface RefinedRoute extends RouteResult {
  model?: { decision: RouteContentOutput["decision"]; targets: string[]; question?: string; reason?: string };
}

/**
 * Asks the model when the router couldn't decide (or always, with `force`). The decision may change; the candidates,
 * their order and their confidences don't — the model's picks are recorded beside them.
 */
export async function refineRoute(result: RouteResult, content: string, runtime: AIRuntime, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<RefinedRoute> {
  const shown = result.candidates.slice(0, ROUTE_CONTENT_LIMITS.candidates);
  if ((!options.force && result.decision !== "NEEDS_CLARIFICATION") || shown.length < 1) return result;
  const input: RouteContentInput = {
    content: content.slice(0, ROUTE_CONTENT_LIMITS.content),
    candidates: shown.map((c, i) => ({
      ref: ref(i),
      title: c.descriptor.title.slice(0, 200),
      ...(c.descriptor.section ? { section: c.descriptor.section.name.slice(0, 200) } : {}),
      summary: (c.descriptor.summary || c.descriptor.title).slice(0, ROUTE_CONTENT_LIMITS.summary),
    })),
  };
  let out: RouteContentOutput;
  try {
    out = (await runtime.run<RouteContentInput, RouteContentOutput>("route_content", input, options.signal ? { signal: options.signal } : {})).data;
  } catch {
    return result;
  }
  const byRef = new Map(shown.map((c, i) => [ref(i), c.id] as const));
  const targets = (out.targets ?? []).flatMap((r) => (byRef.has(r) ? [byRef.get(r)!] : []));
  const model = { decision: out.decision, targets, ...(out.question ? { question: out.question } : {}), ...(out.reason ? { reason: out.reason } : {}) };
  if (out.decision === "route" && targets.length) return { ...result, decision: "route", reason: `the model picked ${targets.length === 1 ? "one card" : `${targets.length} cards`}${out.reason ? `: ${out.reason}` : ""}`, model };
  if (out.decision === "new") return { ...result, decision: "NEW", reason: `the model found no card about this${out.reason ? `: ${out.reason}` : ""}`, model };
  return { ...result, decision: "NEEDS_CLARIFICATION", reason: out.question ?? result.reason, model };
}
