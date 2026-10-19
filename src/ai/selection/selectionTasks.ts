/**
 * The AI tasks behind `✨ Ask AI` (F18), registered with the task registry
 * (F26) — features request a task, never a model:
 *
 * - `summarize` — Summarize (Markdown prose, streamable)
 * - `generate_note` — Explain / Create test cases / Create plan (Markdown prose, streamable)
 * - `transform_note` — Turn into tasks (structured JSON → a todo block)
 *
 * The context is always the serialized, bounded `SelectionContext`
 * (`serializeContext`), never a screenshot.
 */
import { z } from "zod";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";

const scope = z.enum(["selection", "canvas", "workspace"]);

export const summarizeInput = z.object({ scope, context: z.string().min(1) });
export type SummarizeInput = z.infer<typeof summarizeInput>;

export const noteKind = z.enum(["explain", "test_cases", "plan"]);
export type NoteKind = z.infer<typeof noteKind>;
export const generateNoteInput = z.object({ kind: noteKind, scope, context: z.string().min(1) });
export type GenerateNoteInput = z.infer<typeof generateNoteInput>;

export const transformNoteInput = z.object({ kind: z.literal("tasks"), scope, context: z.string().min(1) });
export type TransformNoteInput = z.infer<typeof transformNoteInput>;

/** Markdown prose: any non-empty text. */
const markdownOutput = z.string().refine((s) => s.trim().length > 0, "Empty response");

export const tasksOutput = z.object({
  title: z.string().trim().min(1).max(120),
  tasks: z
    .array(z.object({ text: z.string().trim().min(1).max(300) }))
    .min(1)
    .max(30),
});
export type TasksOutput = z.infer<typeof tasksOutput>;

const SYSTEM =
  "You are the assistant inside Acute-Notes, a canvas note-taking app. You work only from the canvas content provided. " +
  "Objects are numbered like [1] only so the relationships list can refer to them. Never write these numbers in your reply (no \"[1]\", \"[2]\"): " +
  "name things by what they are, e.g. \"the Checkout API\". Never invent facts that the content does not support; say so when something is unclear.";

const MARKDOWN_RULES =
  "Reply in concise Markdown (headings, short paragraphs, bullet or numbered lists, checklists, tables, code blocks). " +
  "Do not add a top-level title — the app adds one. Do not wrap the whole reply in a code fence.";

const NOTE_INSTRUCTIONS: Record<NoteKind, string> = {
  explain:
    "Explain the content below to a colleague seeing it for the first time: what it is about, the key ideas, and how the parts relate. Use the relationships between objects where they help.",
  test_cases:
    "Write test cases for what the content below describes. Group them by area. For each: a short name, preconditions if any, steps, and the expected result. Cover edge cases and failure paths, not just the happy path.",
  plan:
    "Turn the content below into a practical plan: goal, ordered phases or steps with concrete deliverables, dependencies between steps, and open questions or risks.",
};

function withRepair(prompt: string, repairFeedback?: string): string {
  return repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt;
}

export const summarizeTask: TaskDefinition<SummarizeInput, string> = {
  task: "summarize",
  inputSchema: summarizeInput,
  outputSchema: markdownOutput,
  outputFormat: "text",
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt: SYSTEM,
    prompt: withRepair(
      `Summarize the content below: one short paragraph with the gist, then the key points as a bullet list. ${MARKDOWN_RULES}\n\n${input.context}`,
      repairFeedback,
    ),
  }),
  policy: {},
};

export const generateNoteTask: TaskDefinition<GenerateNoteInput, string> = {
  task: "generate_note",
  inputSchema: generateNoteInput,
  outputSchema: markdownOutput,
  outputFormat: "text",
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt: SYSTEM,
    prompt: withRepair(`${NOTE_INSTRUCTIONS[input.kind]} ${MARKDOWN_RULES}\n\n${input.context}`, repairFeedback),
  }),
  policy: {},
};

export const transformNoteTask: TaskDefinition<TransformNoteInput, TasksOutput> = {
  task: "transform_note",
  inputSchema: transformNoteInput,
  outputSchema: tasksOutput,
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt: SYSTEM,
    prompt: withRepair(
      "Turn the content below into a list of concrete, actionable tasks (each starts with a verb, at most 30). " +
        'Reply with JSON only, exactly this shape: {"title": "<short list title>", "tasks": [{"text": "<task>"}]}.\n\n' +
        input.context,
      repairFeedback,
    ),
  }),
  policy: {},
};

export const chatInput = z.object({
  scope,
  /** Serialized canvas context; empty when the conversation's objects are gone. */
  context: z.string(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
  message: z.string().trim().min(1),
});
export type ChatInput = z.infer<typeof chatInput>;

/** Follow-ups and typed questions in an Ask AI conversation (F40). */
export const chatTask: TaskDefinition<ChatInput, string> = {
  task: "chat",
  inputSchema: chatInput,
  outputSchema: markdownOutput,
  outputFormat: "text",
  buildPrompt: ({ input, repairFeedback }) => {
    const history = input.history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
    const parts = [
      input.context ? `Canvas content:\n\n${input.context}` : "(The objects this conversation was about are no longer on the canvas.)",
      history ? `Conversation so far:\n\n${history}` : "",
      `User: ${input.message}`,
      `Answer the user's latest message using the canvas content and the conversation so far. ${MARKDOWN_RULES}`,
    ];
    return { systemPrompt: SYSTEM, prompt: withRepair(parts.filter(Boolean).join("\n\n"), repairFeedback) };
  },
  policy: {},
};

/** Registers the Ask AI tasks once (idempotent, so hot reload and tests can call it freely). */
export function registerSelectionTasks(registry: TaskRegistry): void {
  if (!registry.has(summarizeTask.task)) registry.register(summarizeTask);
  if (!registry.has(generateNoteTask.task)) registry.register(generateNoteTask);
  if (!registry.has(transformNoteTask.task)) registry.register(transformNoteTask);
  if (!registry.has(chatTask.task)) registry.register(chatTask);
}

registerSelectionTasks(getTaskRegistry());
