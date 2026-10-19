/**
 * Content ingest tools for MCP clients: the same outline, plan, merge and update pipeline the Visualize dialog runs (`@/ai/ingest`),
 * including the decision model that files passages under existing topics, repeats left out, nothing removed or restated.
 *
 *   find_import_targets   the notes on the open canvas that content can be merged into or updated (a read; no AI)
 *   import_content        text or ChatGPT share links in; a change set proposed for the user's review out
 *
 * `import_content` spends the user's own AI credit, which no other tool does, so it is guarded: the user must turn it on for the workspace
 * (⋮ → MCP access), it is served to local sessions only, a call without `confirm: true` only previews (what would run, a rough cost, no AI),
 * economy mode (new text kept word for word as plain cards, no AI) is on unless the client turns it off, and the result is only ever a
 * proposal: nothing reaches the canvas until the user accepts it, and the tool is never in the auto-accept set.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ingestContent, prepareProposal, sceneSourceObjects, type IngestRequest } from "@/ai/ingest/ingest";
import { importSharedChats, type FetchLike } from "@/ai/ingest/sharedChats";
import { findMergeTargets, type MergeTarget } from "@/ai/ingest/targets";
import { MAX_CONTENT_CHARS } from "@/ai/content/parser";
import type { AIRuntime } from "@/ai/runtime";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { VISUAL_TEMPLATES } from "@/ai/visual-plan/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { cut } from "../context/currentContext";
import { guarded, READ_ANNOTATIONS, ToolFailure, toolResult, WRITE_ANNOTATIONS } from "./common";
import { MESSAGES, proposeChangeSet, sanitizeClientName, type WriteToolDeps } from "./writeTools";
import type { LiveCanvasActions } from "./liveCanvas";

export const INGEST_TOOL_NAMES = ["find_import_targets", "import_content"] as const;

/** What the app supplies so the tools can run the pipeline in the tab (the tools themselves import no React or storage). */
export interface IngestToolOptions {
  runtime: AIRuntime;
  contentSources: ContentSourceRepository;
  /** Whether the user allowed AI imports from MCP for this workspace; read on every call. */
  allowed(): boolean;
  /** Share-link fetching; the app's own import route by default (tests inject a stub). */
  fetch?: FetchLike;
}

export interface IngestToolDeps extends WriteToolDeps {
  ingest: IngestToolOptions;
  parseMarkdown?: ParseMarkdown;
}

const MESSAGES_INGEST = {
  off: "AI imports from MCP are turned off for this workspace. Ask the user to turn on ⋮ → MCP access → \"Allow AI imports\" (an import spends their AI credit). find_import_targets still works.",
  both: "Give either `text` or `shareLinks`, not both.",
  neither: "Give the content to import: `text`, or `shareLinks` (ChatGPT share links).",
  noTarget: "There are no notes on the open canvas to merge into or update. Use mode \"new\" to add the content as new notes.",
} as const;

/** Rough, from one measured workload (Gemini 2.5 Flash, three overlapping chats, about 100,000 characters in): a guide, not a quote. */
export function estimateCostUsd(characters: number, mode: IngestRequest["mode"], economy: boolean): { low: number; high: number } {
  const perThousand = mode === "merge" ? (economy ? [0.0006, 0.0016] : [0.002, 0.005]) : [0.003, 0.01];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { low: round((characters / 1000) * perThousand[0]!), high: round((characters / 1000) * perThousand[1]!) };
}

const ingestOutput = {
  status: z.enum(["proposed", "applied", "preview", "unchanged"]),
  mode: z.enum(["merge", "update", "new"]).optional(),
  target: z.object({ sourceId: z.string(), label: z.string() }).optional(),
  economy: z.boolean().optional(),
  characters: z.number().optional(),
  estimateUsd: z.object({ low: z.number(), high: z.number(), note: z.string() }).optional(),
  notices: z.array(z.string()).optional(),
  /** Conflicts between the content and the notes: shown on the canvas as "Needs your call" choices; the user decides, nothing is overwritten. */
  needsYourCall: z.array(z.string()).optional(),
  operationId: z.string().optional(),
  canvasId: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  changes: z.record(z.string(), z.number()).optional(),
  warnings: z.array(z.string()).optional(),
  layout: z.unknown().optional(),
};

/** Thrown inside the proposal builder when the content is already on the canvas: not an error, nothing to propose. */
class NothingToImport extends Error {
  constructor(readonly notices: string[]) {
    super("nothing to import");
  }
}

function liveOf(deps: IngestToolDeps): LiveCanvasActions {
  const live = deps.liveCanvas();
  if (!live || live.workspaceId !== deps.workspaceId) throw new ToolFailure(MESSAGES.noCanvas);
  return live;
}

const targetsOn = (deps: IngestToolDeps, live: LiveCanvasActions): Promise<MergeTarget[]> =>
  findMergeTargets(deps.ingest.contentSources, live.canvasId, live.elements(), (id) => live.getDocument?.(id));

export function registerIngestTools(server: McpServer, deps: IngestToolDeps): void {
  const client = () => sanitizeClientName(deps.clientName?.());

  server.registerTool(
    "find_import_targets",
    {
      title: "Find notes to import into",
      description:
        "Lists the notes on the open canvas that new content can be merged into or updated (their sourceId and a label), newest first. Use a sourceId as `targetSourceId` of import_content. Read-only; no AI.",
      inputSchema: {},
      outputSchema: { canvasId: z.string(), targets: z.array(z.object({ sourceId: z.string(), label: z.string(), updatedAt: z.number() })) },
      annotations: READ_ANNOTATIONS,
    },
    (() =>
      guarded(async () => {
        const live = liveOf(deps);
        const targets = await targetsOn(deps, live);
        return toolResult(targets.length ? `${targets.length} notes on the open canvas can take new content.` : "No notes on the open canvas yet: import with mode \"new\".", { canvasId: live.canvasId, targets });
      })) as never,
  );

  server.registerTool(
    "import_content",
    {
      title: "Import content (AI)",
      description:
        "Turns new text, or ChatGPT share links, into notes on the open canvas with the same pipeline as Visualize: mode \"merge\" files it under the topics of existing notes (passages already there are left out, nothing is removed or restated), \"update\" reconciles an edited version of existing notes, \"new\" adds separate notes. " +
        "Spends the user's AI credit and can take minutes. Without `confirm: true` it only previews (what would run, a rough cost; no AI). Needs the user's permission in MCP access. Proposes a change for review; nothing changes until they accept it.",
      inputSchema: {
        text: z.string().max(MAX_CONTENT_CHARS).optional().describe(`The content, Markdown or plain text (at most ${MAX_CONTENT_CHARS.toLocaleString("en-US")} characters).`),
        shareLinks: z.array(z.string().max(300)).max(10).optional().describe("ChatGPT share links instead of `text`; turns a branch shares with its parent are kept once."),
        skipSharedTurns: z.boolean().optional().describe("With shareLinks: leave out turns a branch shares with its parent (default true)."),
        mode: z.enum(["merge", "update", "new"]).optional().describe("Default: merge when the canvas has notes, else new."),
        targetSourceId: z.string().min(1).max(200).optional().describe("Which notes to merge into or update (find_import_targets); merge defaults to the newest."),
        economy: z.boolean().optional().describe("Merge only: keep new text that joins an existing topic word for word as plain cards, no AI (default true: cheaper)."),
        template: z.enum(VISUAL_TEMPLATES).optional().describe("Mode new only: force a visual template."),
        confirm: z.boolean().optional().describe("Run the import. Without it the call only previews and costs nothing."),
        canvasId: z.string().min(1).max(200).optional().describe("The canvas to propose on; must be the open canvas (the default)."),
      },
      outputSchema: ingestOutput,
      annotations: WRITE_ANNOTATIONS,
    },
    ((args: ImportArgs, extra?: { signal?: AbortSignal }) => guarded(() => runImport(deps, args, extra?.signal, client))) as never,
  );
}

interface ImportArgs {
  text?: string;
  shareLinks?: string[];
  skipSharedTurns?: boolean;
  mode?: "merge" | "update" | "new";
  targetSourceId?: string;
  economy?: boolean;
  template?: (typeof VISUAL_TEMPLATES)[number];
  confirm?: boolean;
  canvasId?: string;
}

async function runImport(deps: IngestToolDeps, args: ImportArgs, signal: AbortSignal | undefined, client: () => string | undefined) {
  if (!deps.ingest.allowed()) throw new ToolFailure(MESSAGES_INGEST.off);
  if (!deps.policy().allowWrites) throw new ToolFailure(MESSAGES.writesDisabled);
  if (args.text !== undefined && args.shareLinks?.length) throw new ToolFailure(MESSAGES_INGEST.both);
  if (!args.text?.trim() && !args.shareLinks?.length) throw new ToolFailure(MESSAGES_INGEST.neither);

  const notices: string[] = [];
  let text = args.text ?? "";
  if (args.shareLinks?.length) {
    const read = await importSharedChats(args.shareLinks.join("\n"), { skip: args.skipSharedTurns ?? true, ...(deps.ingest.fetch ? { fetch: deps.ingest.fetch } : {}) });
    if (read.unsupported.length) notices.push(`Not a supported share link (only ChatGPT links are): ${read.unsupported.join(", ")}`);
    if (read.duplicates) notices.push(`${read.duplicates} duplicate link${read.duplicates === 1 ? "" : "s"} ignored`);
    for (const f of read.failed) notices.push(`Could not read ${f.url}: ${f.error}`);
    for (const c of read.chats) if (c.kept < c.turns) notices.push(`"${c.title}": ${c.kept} of ${c.turns} turns kept${c.notes.map((n) => ` · ${n}`).join("")}`);
    if (!read.markdown) throw new ToolFailure(`Nothing could be read from those links. ${notices.join(" ")}`.trim());
    text = read.markdown;
  }
  if (text.length > MAX_CONTENT_CHARS) throw new ToolFailure(`That content is ${text.length.toLocaleString("en-US")} characters; the limit is ${MAX_CONTENT_CHARS.toLocaleString("en-US")}. Import it in parts.`);

  const live = liveOf(deps);
  if (args.canvasId && args.canvasId !== live.canvasId) throw new ToolFailure(`Canvas ${args.canvasId} isn't the open canvas; changes can only be proposed on the open canvas (${live.canvasId}).`);
  const targets = await targetsOn(deps, live);
  const mode = args.mode ?? (targets.length ? "merge" : "new");
  let target: MergeTarget | undefined;
  if (mode !== "new") {
    if (!targets.length) throw new ToolFailure(MESSAGES_INGEST.noTarget);
    target = args.targetSourceId ? targets.find((t) => t.sourceId === args.targetSourceId) : targets[0];
    if (!target) throw new ToolFailure(`No such notes on the open canvas: ${args.targetSourceId}. Available: ${targets.map((t) => `${t.sourceId} (${cut(t.label, 40).text})`).join("; ")}`);
  }
  const economy = mode === "merge" ? (args.economy ?? true) : false;
  const estimate = { ...estimateCostUsd(text.length, mode, economy), note: "A rough guide from one measured workload on Gemini 2.5 Flash; your model's price and the content differ." };
  const targetShape = target ? { sourceId: target.sourceId, label: target.label } : undefined;

  if (!args.confirm) {
    const what = mode === "new" ? "add it as new notes" : `${mode} it ${mode === "merge" ? "into" : "as an update of"} "${target!.label}"`;
    return toolResult(
      `Preview only, nothing ran and nothing was spent: this would ${what} (${text.length.toLocaleString("en-US")} characters${mode === "merge" ? `, economy ${economy ? "on" : "off"}` : ""}), roughly $${estimate.low}–$${estimate.high} of AI credit. Call again with confirm: true to run it.`,
      { status: "preview" as const, mode, ...(targetShape ? { target: targetShape } : {}), economy, characters: text.length, estimateUsd: estimate, notices },
    );
  }

  const request: IngestRequest =
    mode === "new"
      ? { mode, text, ...(args.template ? { template: args.template } : {}) }
      : mode === "update"
        ? { mode, sourceId: target!.sourceId, text }
        : { mode, sourceId: target!.sourceId, text, economy };
  try {
    return await proposeChangeSet(deps, { canvasId: args.canvasId, mode, ...(target ? { target: target.sourceId } : {}), economy, characters: text.length }, async (open) => {
      const result = await ingestContent(
        request,
        {
          runtime: deps.ingest.runtime,
          contentSources: deps.ingest.contentSources,
          renderContext: () => open.renderContext(),
          sourceObjects: sceneSourceObjects(() => open.elements(), (id) => open.getDocument?.(id)),
        },
        { ...(signal ? { signal } : {}), ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}) },
      );
      if (!result.changeSet) throw new NothingToImport([...notices, ...result.notices]);
      const prepared = prepareProposal(result.changeSet, result.notices);
      const conflict = result.choices.length ? [`${result.choices.length} conflict${result.choices.length === 1 ? "" : "s"} between this content and the user's notes: ${result.choices.map((c) => `“${c}”`).join(", ")}. None is applied; each is shown on the canvas as "Needs your call" and waits for the user to pick an option. Tell the user.`] : [];
      const name = client();
      const set: ChangeSet = {
        ...prepared.proposal,
        title: cut(`${name ?? "MCP"}: Import (${mode})`, 200).text,
        metadata: { ...prepared.proposal.metadata, createdBy: "mcp", task: "import_content", ...(name ? { provider: name } : {}) },
      };
      return { set, warnings: [...notices, ...prepared.notices, ...conflict], extra: { mode, ...(targetShape ? { target: targetShape } : {}), economy, characters: text.length, ...(result.choices.length ? { needsYourCall: result.choices } : {}) } };
    });
  } catch (err) {
    if (err instanceof NothingToImport) {
      return toolResult("Nothing to import: the canvas already matches this content.", { status: "unchanged" as const, mode, ...(targetShape ? { target: targetShape } : {}), economy, characters: text.length, notices: err.notices });
    }
    throw err;
  }
}
