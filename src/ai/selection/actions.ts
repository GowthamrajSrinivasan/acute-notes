/**
 * `✨ Ask AI` selection actions (F18, PRD §6.4). Each action maps to one AI
 * task (F26) — or, for Find related, to deterministic local search — and
 * returns a structured result that maps to an Acute-Notes command (insert a
 * text or todo block, reveal objects). Nothing here touches the canvas: the
 * UI applies a result only when the user asks it to.
 */
import { newId } from "@/domain/ids";
import type { AIMetadata, RichContent } from "@/domain/types";
import { findRelated, type RelatedMatch } from "@/ai/context/related";
import { serializeContext, type AIScope, type SelectionContext } from "@/ai/context/selectionContext";
import type { AIRuntime, ProviderRole } from "@/ai/runtime";
import type { AITask } from "@/ai/tasks";
import { AI_PROVIDER_DESCRIPTORS } from "@/ai/providers/registry";
import type { HistoryMessage } from "@/ai/conversations/history";
import type { ChatInput, GenerateNoteInput, NoteKind, SummarizeInput, TasksOutput, TransformNoteInput } from "./selectionTasks";

export type SelectionActionId =
  | "explain"
  | "summarize"
  | "visualize"
  | "update_from_content"
  | "update_from_chats"
  | "rearrange_layout"
  | "revisualize_ai"
  | "find_related"
  | "turn_into_tasks"
  | "create_test_cases"
  | "create_plan";

export interface SelectionAction {
  id: SelectionActionId;
  label: string;
  /** Shown while running, e.g. "Summarizing…". */
  progress: string;
  /** The AI task it runs; absent for local-only actions. */
  task?: AITask;
  scopes: readonly AIScope[];
  /** False until the feature behind it exists. */
  available: boolean;
}

const ALL_SCOPES: readonly AIScope[] = ["selection", "canvas", "workspace"];

/** Menu order per PRD §6.4. */
export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  { id: "explain", label: "Explain", progress: "Explaining…", task: "generate_note", scopes: ALL_SCOPES, available: true },
  { id: "summarize", label: "Summarize", progress: "Summarizing…", task: "summarize", scopes: ALL_SCOPES, available: true },
  { id: "visualize", label: "Visualize", progress: "Visualizing…", task: "generate_visual_plan", scopes: ["selection"], available: true },
  // F39: listed only when the selection has Visualize-derived objects (AIPanel filters it).
  { id: "update_from_content", label: "Update from new content", progress: "Updating…", task: "generate_visual_plan", scopes: ["selection"], available: true },
  // The same notes updated from ChatGPT conversations (share links): merged by topic, repeats left out, nothing removed, conflicts left for the user. Opens the Visualize dialog on "Merge into existing notes".
  { id: "update_from_chats", label: "Update from ChatGPT chats", progress: "Updating…", scopes: ["selection"], available: true },
  // Visualize-derived selections only. The same content, laid out again with the current grouping and layout rules: no AI, shown for review.
  { id: "rearrange_layout", label: "Re-arrange layout", progress: "Arranging…", scopes: ["selection"], available: true },
  // The same content analysed again by AI under the current logic (every section), reconciled with the canvas for review.
  { id: "revisualize_ai", label: "Re-visualize with AI", progress: "Re-visualizing…", task: "generate_visual_plan", scopes: ["selection"], available: true },
  // Related to the selection, searched across the canvas or workspace.
  { id: "find_related", label: "Find related items", progress: "Searching…", scopes: ["canvas", "workspace"], available: true },
  { id: "turn_into_tasks", label: "Turn into tasks", progress: "Creating tasks…", task: "transform_note", scopes: ALL_SCOPES, available: true },
  { id: "create_test_cases", label: "Create test cases", progress: "Writing test cases…", task: "generate_note", scopes: ALL_SCOPES, available: true },
  { id: "create_plan", label: "Create plan", progress: "Planning…", task: "generate_note", scopes: ALL_SCOPES, available: true },
];

export function getSelectionAction(id: SelectionActionId): SelectionAction {
  return SELECTION_ACTIONS.find((a) => a.id === id)!;
}

/** The scope an action actually runs with: the requested one if it supports it, else its narrowest. */
export function effectiveScope(action: SelectionAction, requested: AIScope): AIScope {
  return action.scopes.includes(requested) ? requested : action.scopes[0]!;
}

/** Who produced a result — becomes `metadata.ai` on anything inserted from it (F25). */
export interface AIProvenance {
  task: AITask;
  providerId: string;
  role: ProviderRole;
  model: string;
  operationId: string;
}

export type SelectionActionResult =
  | { kind: "note"; actionId: SelectionActionId; title: string; markdown: string; provenance: AIProvenance }
  | { kind: "tasks"; actionId: SelectionActionId; title: string; tasks: string[]; provenance: AIProvenance }
  | { kind: "related"; actionId: SelectionActionId; matches: RelatedMatch[] };

const NOTE_ACTIONS: Partial<Record<SelectionActionId, { kind: NoteKind; title: string }>> = {
  explain: { kind: "explain", title: "Explanation" },
  create_test_cases: { kind: "test_cases", title: "Test cases" },
  create_plan: { kind: "plan", title: "Plan" },
};

export interface RunActionOptions {
  signal?: AbortSignal;
  /** Streamed text so far, for a preview (text tasks on streaming providers only). */
  onText?: (textSoFar: string) => void;
}

/** Models sometimes wrap a Markdown reply in one code fence despite being asked not to. */
export function unwrapMarkdownFence(text: string): string {
  const m = /^\s*```(?:markdown|md)?[^\S\n]*\n([\s\S]*?)\n```\s*$/i.exec(text);
  return (m ? m[1]! : text).trim();
}

/**
 * Runs one action against a context built for its effective scope. Throws
 * `AIError` (e.g. `cancelled`, `disabled`, `model_unavailable`) from the
 * runtime; a cancelled run never resolves with a partial result.
 */
export async function runSelectionAction(
  runtime: AIRuntime,
  actionId: SelectionActionId,
  context: SelectionContext,
  opts: RunActionOptions = {},
): Promise<SelectionActionResult> {
  const action = getSelectionAction(actionId);
  if (!action.available) throw new Error(`"${action.label}" is not available yet.`);

  if (actionId === "find_related") return { kind: "related", actionId, matches: findRelated(context) };
  // Visualize (F31) opens its own dialog and runs a whole pipeline (F28–F30), never a single `generate_note`-shaped
  // exchange — the UI must special-case it before ever calling this function.
  if (actionId === "visualize" || actionId === "update_from_content" || actionId === "update_from_chats" || actionId === "rearrange_layout" || actionId === "revisualize_ai") {
    throw new Error(`"${action.label}" is not run through runSelectionAction — open the Visualize dialog instead.`);
  }

  const prompt = serializeContext(context);
  const operationId = newId("op");
  const provenance = (task: AITask, r: { providerId: string; role: ProviderRole; usage: { model: string } }): AIProvenance => ({
    task,
    providerId: r.providerId,
    role: r.role,
    model: r.usage.model,
    operationId,
  });

  if (actionId === "summarize") {
    const r = await runtime.run<SummarizeInput, string>("summarize", { scope: context.scope, context: prompt }, opts);
    return { kind: "note", actionId, title: "Summary", markdown: unwrapMarkdownFence(r.data), provenance: provenance("summarize", r) };
  }
  if (actionId === "turn_into_tasks") {
    const r = await runtime.run<TransformNoteInput, TasksOutput>(
      "transform_note",
      { kind: "tasks", scope: context.scope, context: prompt },
      { signal: opts.signal },
    );
    return { kind: "tasks", actionId, title: r.data.title, tasks: r.data.tasks.map((t) => t.text), provenance: provenance("transform_note", r) };
  }
  const note = NOTE_ACTIONS[actionId];
  if (!note) throw new Error(`Unknown selection action "${actionId}".`);
  const r = await runtime.run<GenerateNoteInput, string>("generate_note", { kind: note.kind, scope: context.scope, context: prompt }, opts);
  return { kind: "note", actionId, title: note.title, markdown: unwrapMarkdownFence(r.data), provenance: provenance("generate_note", r) };
}

export type NoteResult = Extract<SelectionActionResult, { kind: "note" }>;

/**
 * A typed question or follow-up in a conversation (F40): the `chat` task with
 * the canvas context (empty when its objects are gone) and bounded history.
 */
export async function runChat(
  runtime: AIRuntime,
  input: { context: SelectionContext | null; scope: AIScope; history: HistoryMessage[]; message: string },
  opts: RunActionOptions = {},
): Promise<NoteResult> {
  const r = await runtime.run<ChatInput, string>(
    "chat",
    { scope: input.scope, context: input.context ? serializeContext(input.context) : "", history: input.history, message: input.message },
    opts,
  );
  return {
    kind: "note",
    actionId: "explain",
    title: "Answer",
    markdown: unwrapMarkdownFence(r.data),
    provenance: { task: "chat", providerId: r.providerId, role: r.role, model: r.usage.model, operationId: newId("op") },
  };
}

/** A tasks result as todo-block content: its title, then one unchecked item per task. */
export function tasksToContent(title: string, tasks: readonly string[]): RichContent {
  return [
    { type: "heading", props: { level: 3 }, content: title },
    ...tasks.map((text) => ({ type: "checkListItem" as const, props: { checked: false }, content: text })),
  ];
}

/** `metadata.ai` for an object created from a result. Descriptive only — nothing may branch on it. */
export function provenanceMetadata(p: Omit<AIProvenance, "task"> & { task: string }): AIMetadata {
  return {
    createdBy: "ai",
    task: p.task,
    provider: p.providerId,
    ...authTypeOf(p.providerId),
    ...(p.model ? { model: p.model } : {}),
    operationId: p.operationId,
  };
}

/** How the connection is paid for / signed in to, from its descriptor (connection id = descriptor id). */
function authTypeOf(providerId: string): Pick<AIMetadata, "authType"> {
  const accessType = AI_PROVIDER_DESCRIPTORS.find((d) => d.id === providerId)?.accessType;
  return accessType ? { authType: accessType } : {};
}

export interface Suggestion {
  actionId: SelectionActionId;
  label: string;
}

/**
 * The three starter suggestions for a new chat, phrased for what is selected
 * (e.g. code → explain / test cases / plan) or for the scope when nothing is.
 */
export function suggestionsFor(items: readonly { kind: string; title?: string; text: string }[], scope: AIScope): Suggestion[] {
  if (scope !== "selection" || !items.length) {
    const where = scope === "workspace" ? "this workspace" : "this canvas";
    return [
      { actionId: "summarize", label: `Summarize ${where}` },
      { actionId: "turn_into_tasks", label: `List the open tasks in ${where}` },
      { actionId: "create_plan", label: `Create a plan from ${where}` },
    ];
  }
  const first = items[0]!;
  const name = (() => {
    if (items.length > 1) return `the ${items.length} selected objects`;
    const text = (first.title ?? first.text.replace(/^#+\s*/, "").split("\n")[0] ?? "").trim();
    return text ? `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : "the selection";
  })();
  const kinds = new Set(items.map((i) => i.kind));
  const only = (kind: string) => kinds.size === 1 && kinds.has(kind);
  if (only("code")) {
    return [
      { actionId: "explain", label: `Explain ${name}` },
      { actionId: "create_test_cases", label: `Create test cases for ${name}` },
      { actionId: "create_plan", label: `Plan changes to ${name}` },
    ];
  }
  if (only("todo")) {
    return [
      { actionId: "summarize", label: `Summarize progress on ${name}` },
      { actionId: "create_plan", label: `Create a plan for ${name}` },
      { actionId: "explain", label: `Explain ${name}` },
    ];
  }
  if (only("table")) {
    return [
      { actionId: "explain", label: `Explain ${name}` },
      { actionId: "summarize", label: `Summarize ${name}` },
      { actionId: "create_test_cases", label: `Create test cases from ${name}` },
    ];
  }
  return [
    { actionId: "explain", label: `Explain ${name}` },
    { actionId: "turn_into_tasks", label: `Turn ${name} into tasks` },
    { actionId: "create_plan", label: `Create a plan for ${name}` },
  ];
}
