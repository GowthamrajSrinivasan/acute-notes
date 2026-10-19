/**
 * MCP prompts (PRD §13.13): a small, fixed registry of reusable actions an
 * MCP client can offer as slash commands — "Review this canvas", "Turn
 * findings into an action plan", … Each prompt resolves to bounded context
 * and one explicit action:
 *
 * - context: the payload it works on, embedded in the prompt as a resource
 *   (`acute://context/current`, or a canvas — the open one unless named),
 *   already bounded like every resource (`truncated` says what was left out);
 * - action: the one write tool the agent should use for its result — a single
 *   proposal the user reviews — or, when this workspace is read-only for MCP
 *   clients, an answer in the chat instead.
 *
 * Deterministic text: no model, no I/O beyond reading the embedded resource.
 * Nothing here is shown in the Acute-Notes UI. `map_repo` (F43) lives with its
 * tools in `tools/repoMap/`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CURRENT_CONTEXT_URI, resourceUri } from "../resources/uris";

/** What a prompt works on: the current context (selection first), or a whole canvas. */
export type PromptContext = "current" | "canvas";

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  context: PromptContext;
  /** The write tool the result goes through (one proposal). */
  output: "create_block" | "create_page" | "create_todo" | "render_visual_plan";
  /** What to do, in order. `writes`: whether the agent may propose the result on the canvas. */
  steps(args: { focus?: string }, writes: boolean): string[];
}

const ONE_PROPOSAL =
  "Propose the result with a single tool call (the user reviews it in Acute-Notes; only one proposal can be under review at a time). Never claim it was added: the result says \"proposed\".";
const CHAT_ONLY = "This workspace is read-only for MCP clients: give the result in the chat and don't call write tools.";
const IDS = "Refer to objects by their title or excerpt, and keep their ids for tool calls; don't invent objects that aren't in the context.";

const result = (writes: boolean, how: string) => (writes ? `${how} ${ONE_PROPOSAL}` : CHAT_ONLY);

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "review_canvas",
    title: "Review this canvas",
    description: "Review what's on the canvas: gaps, contradictions, unclear or unsupported claims, and what to do next.",
    context: "canvas",
    output: "create_block",
    steps: (a, writes) => [
      `Review the canvas below${a.focus ? `, focusing on ${a.focus}` : ""}. Read the objects and the relations between them; use get_related_objects for an object you need to see in context, and get_page for a page it links.`,
      "List: (1) gaps — what's missing for this to be complete; (2) contradictions between objects; (3) claims without support; (4) the three most useful next steps. Be specific and short.",
      IDS,
      result(writes, "Put the review in one text block titled \"Review\" with create_block (Markdown, one heading per list)."),
    ],
  },
  {
    name: "summarize_investigation",
    title: "Summarize this investigation",
    description: "Summarize the investigation on the canvas: the question, what was found, the evidence, and what's still open.",
    context: "canvas",
    output: "create_block",
    steps: (a, writes) => [
      `Summarize the investigation on the canvas below${a.focus ? ` about ${a.focus}` : ""}.`,
      "Structure: the question; findings (each with the object that supports it); what was ruled out; open questions. At most about 250 words.",
      IDS,
      result(writes, "Put the summary in one text block titled \"Summary\" with create_block."),
    ],
  },
  {
    name: "action_plan",
    title: "Turn findings into an action plan",
    description: "Turn the findings in the current context (the selection, or what's around it) into a to-do list of concrete actions.",
    context: "current",
    output: "create_todo",
    steps: (a, writes) => [
      `Turn the findings in the context below into an action plan${a.focus ? ` for ${a.focus}` : ""}. The selection is what the user means; if nothing is selected, use the nearby objects.`,
      "Each action: a verb first, concrete and checkable, in the order to do them. 3–10 actions. Leave out anything the findings don't support.",
      result(writes, "Propose it as one to-do list titled \"Action plan\" with create_todo."),
    ],
  },
  {
    name: "find_missing_scenarios",
    title: "Find missing scenarios",
    description: "List the scenarios, cases and edge cases the flow or plan in the current context doesn't cover yet.",
    context: "current",
    output: "create_block",
    steps: (a, writes) => [
      `Find the scenarios the flow, plan or spec in the context below doesn't cover${a.focus ? `, especially around ${a.focus}` : ""}: failure paths, edge cases, other actors, limits, timing and recovery.`,
      "For each: one line on what happens, and why it matters. Most important first; at most 12. Don't repeat what the canvas already covers.",
      IDS,
      result(writes, "Put them in one text block titled \"Missing scenarios\" with create_block."),
    ],
  },
  {
    name: "explain_architecture",
    title: "Explain this architecture",
    description: "Explain the architecture drawn on the canvas: its parts, how requests and data flow, and the main trade-offs.",
    context: "canvas",
    output: "create_block",
    steps: (a, writes) => [
      `Explain the architecture on the canvas below${a.focus ? `, starting from ${a.focus}` : ""}, to an engineer new to it. Use the drawn relations (depends_on, flows_to, …) as the source of truth; say where the canvas is silent rather than guessing.`,
      "Structure: the parts and what each is responsible for; the main path through them; where state lives; the main trade-offs and risks. Short paragraphs.",
      IDS,
      result(writes, "Put the explanation in one text block titled \"How it works\" with create_block."),
    ],
  },
  {
    name: "review_code",
    title: "Review this code",
    description: "Review the code blocks in the current context (the selection, or what's around it) for bugs, risks and simplifications.",
    context: "current",
    output: "create_block",
    steps: (a, writes) => [
      `Review the code blocks in the context below${a.focus ? `, focusing on ${a.focus}` : ""}. Only the code shown here is in scope; if you can read the repository it came from, say which files you checked.`,
      "List findings most severe first: bugs (with the input that breaks it), risks, then simplifications. For each: where, what, and the fix. Say plainly when you found nothing.",
      result(writes, "Put the findings in one text block titled \"Code review\" with create_block."),
    ],
  },
  {
    name: "meeting_notes",
    title: "Prepare meeting notes",
    description: "Prepare meeting notes from a canvas: agenda, the decisions to make, and the context each needs.",
    context: "canvas",
    output: "create_page",
    steps: (a, writes) => [
      `Prepare notes for a meeting about the canvas below${a.focus ? ` (${a.focus})` : ""}.`,
      "Structure: goal of the meeting; agenda (timed); decisions to make, each with the context and options from the canvas; open questions; a blank \"Decisions\" and \"Actions\" section to fill in during the meeting.",
      result(writes, "Propose it as one page titled \"Meeting notes: <topic>\" with create_page."),
    ],
  },
];

export const PROMPT_NAMES = PROMPTS.map((p) => p.name);

export interface PromptDeps {
  /** Reads a resource payload (the same readers as the resources), or null when it isn't there. */
  read(uri: string): Promise<unknown | null>;
  /** Whether MCP clients may propose changes here (re-read on every call). */
  writes(): boolean;
}

const idArg = z.string().trim().min(1).max(200);

/** One prompt's messages: the bounded context as an embedded resource, then the instructions. */
export async function buildPrompt(def: PromptDefinition, args: { canvasId?: string; focus?: string }, deps: PromptDeps): Promise<GetPromptResult> {
  const focus = args.focus?.trim().slice(0, 200) || undefined;
  const uri = def.context === "canvas" && args.canvasId ? resourceUri("canvas", args.canvasId) : CURRENT_CONTEXT_URI;
  let payload = await deps.read(uri);
  let used = uri;
  // A canvas prompt without a canvasId works on the open canvas.
  if (def.context === "canvas" && !args.canvasId) {
    const current = payload as { available?: boolean; canvas?: { id?: string } } | null;
    const open = current && current.available !== false ? current.canvas?.id : undefined;
    if (open) {
      used = resourceUri("canvas", open);
      payload = await deps.read(used);
    }
  }
  const unavailable = !payload || (payload as { available?: boolean }).available === false;
  const text = [
    ...(unavailable
      ? [
          def.context === "current" || !args.canvasId
            ? "No canvas of this workspace is open in Acute-Notes, so there is no context yet. Ask the user to open the canvas (and select what they mean), then run this again."
            : `There is no canvas ${args.canvasId} in this workspace. Read acute://workspace/{id} for its canvases, then run this again with one of their ids.`,
        ]
      : [`The context is the resource above (${used}). It is bounded: if it says truncated, read the rest through its links or the read tools before concluding.`]),
    "",
    ...(unavailable ? [] : def.steps({ ...(focus ? { focus } : {}) }, deps.writes())),
  ].join("\n");
  return {
    description: def.title,
    messages: [
      ...(unavailable ? [] : [{ role: "user" as const, content: { type: "resource" as const, resource: { uri: used, mimeType: "application/json", text: JSON.stringify(payload) } } }]),
      { role: "user", content: { type: "text", text } },
    ],
  };
}

export function registerPrompts(server: McpServer, deps: PromptDeps): void {
  for (const def of PROMPTS) {
    const focus = z.string().max(200).optional().describe("Optional: what to focus on.");
    const argsSchema: Record<string, z.ZodOptional<z.ZodString>> = { focus };
    if (def.context === "canvas") argsSchema.canvasId = idArg.optional().describe("The canvas to work on (default: the open one).");
    server.registerPrompt(def.name, { title: def.title, description: def.description, argsSchema }, (args: { canvasId?: string; focus?: string }) => buildPrompt(def, args, deps));
  }
}
