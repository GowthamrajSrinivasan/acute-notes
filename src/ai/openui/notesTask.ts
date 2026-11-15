/**
 * `generate_openui_notes` (`.ai/docs/openui-integration-plan.md` Phase 2, "stream generated notes into the reading
 * view"): a stored source's units distilled into OpenUI Lang idea cards, one card per block, blocks separated by a line
 * holding only `---`. A `text` task, so the runtime streams it (`onText`) and the Notes view renders each card as it
 * arrives through the streaming-tolerant `Renderer`.
 *
 * The result is a preview until the user pins a card (`promote.ts`): nothing here writes to the canvas or the domain
 * (PRD §8). Only a user's click in the Notes view runs it; never part of Visualize.
 */
import { createParser, type ElementNode } from "@openuidev/react-lang";
import { z } from "zod";
import type { AIRuntime, AIRuntimeResult, RunOptions } from "@/ai/runtime";
import { AIError } from "@/ai/errors";
import { oneRequestUsageOf, setOneRequestPolicy } from "@/ai/requestPolicy";
import type { AIUsage } from "@/ai/types";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import { criticalReasonsOf } from "@/ai/fidelity/accounting";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { protectedItemsOf } from "@/ai/fidelity/exactness";
import { acuteCardLibrary, acuteCardSystemPrompt } from "./library";
import { propOrders, toPositional } from "./positional";

/** Bounds what one call may send (a long source is cut, and says so in the prompt). */
export const NOTES_MAX_UNITS = 400;
export const NOTES_MAX_CHARS = 60_000;
/**
 * The output cap of the one model request a run makes (`ai/requestPolicy.ts`: no SDK retry, no repair, no fallback).
 * Sized from kn-02 (8,133-char source, 63 units): its 14-card reply is 6,717 chars, about 1,900 output tokens measured
 * 2026-11-13 (`.ai/docs/openui-live-2026-11-13.md`); 6,000 leaves about 3x for longer sources and reasoning tokens,
 * which these endpoints count inside `max_tokens`. A reply cut at the cap keeps its finished cards.
 */
export const NOTES_MAX_OUTPUT_TOKENS = 6_000;

const notesInput = z.object({
  title: z.string().max(300).optional(),
  units: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        /** Protected details (`protectedItemsOf`, exact tier) the cards citing this unit must keep character for character. */
        keep: z.array(z.string()).optional(),
        /** The unit carries a condition, limit, requirement or decision (`criticalReasonsOf`) that must stay with its claim. */
        critical: z.boolean().optional(),
      }),
    )
    .min(1),
  truncated: z.boolean().optional(),
});
export type OpenUiNotesInput = z.infer<typeof notesInput>;

const CARD_SEPARATOR = /^[ \t]*---[ \t]*$/m;

const FORMAT_RULES = [
  "Arguments are POSITIONAL, in exactly the order each component's signature lists them. Never write name=value arguments. Use null to skip an optional argument that comes before one you need.",
  'Example block: root = IdeaCard("Keys expire", "After 24 hours a retry counts as a new payment.", "medium", [c1], "The server forgets the key once the window closes.")\nc1 = CitationChip("u7")',
  "Write several cards: one IdeaCard per idea, in the order the source presents them.",
  "Each card is its own OpenUI Lang block that starts with `root = ...`. Separate blocks with a line containing only `---`.",
  "Do not wrap the output in a code fence and do not write prose outside the cards.",
  "Cite source units only by the ids given in the list below ([u1], [u2] … appear as CitationChip(\"u1\")).",
  "Use `detail` for explanation a reader may want only on demand; keep `body` to one or two sentences.",
  // Fidelity, as distil Visualize's DISTIL_RULE asks (ai/visualize/tasks.ts): the free check in the Notes view reads these.
  "Brevity never drops a limit. A unit marked ⟨condition⟩ carries a condition, limit or caveat (\"only when …\", \"unless …\", \"at most …\", \"but …\"): keep it with its claim on the same card, in `body`, never only in `detail` and never on another card.",
  "Details listed after a unit as ⟨keep exactly: …⟩ (numbers with their units, identifiers, paths, quoted text) must appear, character for character, in `body` or `detail` of a card citing that unit.",
  "Represent only what the source says. Every unit that isn't filler should be cited by a card that says what it says; cite a unit only on a card that says what that unit says.",
  "Cards are numbered g1, g2, g3 … in output order. To point a reader to a closely related card, add NoteLink(\"g3\") to `extras`; only link cards you actually write.",
];

function prompt(input: OpenUiNotesInput): string {
  const units = input.units
    .map((u) => [`[${u.id}] ${u.text}`, u.critical ? " ⟨condition⟩" : "", u.keep?.length ? ` ⟨keep exactly: ${u.keep.map((k) => JSON.stringify(k)).join(", ")}⟩` : ""].join(""))
    .join("\n");
  return [
    input.title ? `Source: ${input.title}` : "",
    input.truncated ? "(The source was long; only its first part is listed.)" : "",
    "Source units:",
    units,
  ]
    .filter(Boolean)
    .join("\n");
}

export const generateOpenUiNotesTask: TaskDefinition<OpenUiNotesInput, string> = {
  task: "generate_openui_notes",
  inputSchema: notesInput,
  // Any reply is accepted as it is (an empty one becomes an error in `generateOpenUiNotes`), so the runtime never
  // sends a schema repair: one click, one request.
  outputSchema: z.string().catch(""),
  outputFormat: "text",
  buildPrompt: ({ input, repairFeedback }) => ({
    systemPrompt: acuteCardSystemPrompt({ additionalRules: FORMAT_RULES }),
    prompt: repairFeedback ? `${prompt(input)}\n\n${repairFeedback}` : prompt(input),
  }),
  policy: {},
  // Above the SDK's 60 s default: a reply discarded at the timeout would still be billed.
  timeoutMs: 120_000,
};

export function registerOpenUiNotesTask(registry: TaskRegistry): void {
  if (!registry.has("generate_openui_notes")) registry.register(generateOpenUiNotesTask);
}
registerOpenUiNotesTask(getTaskRegistry());
setOneRequestPolicy("generate_openui_notes", { maxTokens: NOTES_MAX_OUTPUT_TOKENS });

type NotesUnit = OpenUiNotesInput["units"][number];

/** A source version's units with what the cards must keep: protected details and critical conditions (pure, no model). */
export function annotateUnits(units: readonly SourceUnit[]): NotesUnit[] {
  const keep = new Map<string, string[]>();
  for (const item of protectedItemsOf(units)) if (item.tier === "exact" && item.kind !== "table" && item.kind !== "code") (keep.get(item.unit) ?? keep.set(item.unit, []).get(item.unit)!).push(item.value);
  return units.map((u) => {
    const critical = criticalReasonsOf(u, {}).some((r) => r === "condition" || r === "limitation" || r === "requirement" || r === "decision");
    const k = keep.get(u.id);
    return { id: u.id, text: u.text, ...(k?.length ? { keep: k } : {}), ...(critical ? { critical: true } : {}) };
  });
}

/** Bounds a source's units to what one call sends. */
export function notesInputOf(units: readonly NotesUnit[], title?: string): OpenUiNotesInput {
  const out: NotesUnit[] = [];
  let chars = 0;
  for (const u of units) {
    if (out.length >= NOTES_MAX_UNITS || chars + u.text.length > NOTES_MAX_CHARS) break;
    out.push(u);
    chars += u.text.length;
  }
  return { ...(title ? { title } : {}), units: out, ...(out.length < units.length ? { truncated: true } : {}) };
}

/** The card blocks in (possibly partial) output; a fenced reply is unwrapped, empty blocks dropped. */
export function splitCards(text: string): string[] {
  return splitBlocks(text).map((b) => toPositional(b, ORDERS));
}

function splitBlocks(text: string): string[] {
  const unfenced = text.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, "");
  return unfenced
    .split(CARD_SEPARATOR)
    .map((b) => b.trim())
    .filter(Boolean);
}

export interface GeneratedCard {
  /** Stable within one run: `g1`, `g2`, … in output order. */
  key: string;
  lang: string;
  title: string;
  body: string;
  detail?: string;
  cites: string[];
  /** Cited ids that aren't units of the source (the card keeps them out of `cites`). */
  unknownUnits: string[];
}

const schema = acuteCardLibrary.toJSONSchema();
/** Each component's positional prop order, for repairing keyword-argument replies (`positional.ts`). */
const ORDERS = propOrders(schema);

/** A finished card block as a pinnable note, or null when it isn't a renderable IdeaCard. */
export function cardOf(lang: string, index: number, knownUnits: ReadonlySet<string>): GeneratedCard | null {
  const { root, meta } = createParser(schema).parse(lang);
  if (!root || meta.incomplete || root.typeName !== "IdeaCard") return null;
  const props = root.props as Record<string, unknown>;
  if (typeof props.title !== "string" || !props.title.trim()) return null;
  const cited = ((props.citations as ElementNode[] | undefined) ?? []).map((c) => c?.props?.unit).filter((u): u is string => typeof u === "string");
  return {
    key: `g${index + 1}`,
    lang,
    title: props.title.trim(),
    body: typeof props.body === "string" ? props.body.trim() : "",
    ...(typeof props.detail === "string" && props.detail.trim() ? { detail: props.detail.trim() } : {}),
    cites: [...new Set(cited.filter((u) => knownUnits.has(u)))],
    unknownUnits: [...new Set(cited.filter((u) => !knownUnits.has(u)))],
  };
}

export interface NotesStreamUpdate {
  /** Every block so far; the last one may still be arriving. */
  blocks: string[];
  done: boolean;
}

/**
 * Runs the task, reporting the card blocks as text arrives, and resolves with the finished cards (blocks that parse into
 * an IdeaCard). One model request per call (`ai/requestPolicy.ts`), identified by a signal of its own. Throws what the
 * runtime throws (AI off, no provider, cancelled), and `invalid_output` when the reply is empty.
 */
export async function generateOpenUiNotes(
  runtime: AIRuntime,
  input: OpenUiNotesInput,
  opts: { signal?: AbortSignal; onUpdate?: (update: NotesStreamUpdate) => void } = {},
): Promise<{ cards: GeneratedCard[]; dropped: number; providerId: string; usage: AIUsage; providerRequests?: number }> {
  // A fresh signal per run: the one-request guard tells runs apart by it, so a reused caller signal can't block a new click.
  const run = new AbortController();
  const outer = opts.signal;
  const onAbort = () => run.abort(outer?.reason);
  if (outer?.aborted) onAbort();
  else outer?.addEventListener("abort", onAbort, { once: true });
  const runOpts: RunOptions = {
    signal: run.signal,
    ...(opts.onUpdate ? { onText: (text: string) => opts.onUpdate!({ blocks: splitCards(text), done: false }) } : {}),
  };
  let result: AIRuntimeResult<string>;
  try {
    result = await runtime.run<OpenUiNotesInput, string>("generate_openui_notes", input, runOpts);
  } finally {
    outer?.removeEventListener("abort", onAbort);
  }
  const reported = oneRequestUsageOf(run.signal);
  if (!result.data.trim()) throw new AIError("invalid_output", "The model returned no notes.");
  const blocks = splitCards(result.data);
  opts.onUpdate?.({ blocks, done: true });
  const known = new Set(input.units.map((u) => u.id));
  const cards = blocks.map((b, i) => cardOf(b, i, known)).filter((c): c is GeneratedCard => c !== null);
  return {
    cards,
    dropped: blocks.length - cards.length,
    providerId: result.providerId,
    // A streamed run reports no usage through the runtime; the one-request guard keeps what the host reported.
    usage: reported?.usage ?? result.usage,
    ...(reported?.providerRequests !== undefined ? { providerRequests: reported.providerRequests } : {}),
  };
}
