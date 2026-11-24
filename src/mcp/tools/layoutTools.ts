/**
 * Intelligent UI tools (note-taking-modes plan §4.3, Step 5): the MCP client composes a card's OpenUI layout with its own
 * model, and the canvas checks and proposes it. No tool here calls a model or spends the user's AI credit.
 *
 *   get_layout_grammar   the card library's syntax, signatures, the canvas's limits and rules, one example per layout
 *   create_layout_card   a new text card: Markdown (its text) + Lang (how it is drawn), optionally citing one source
 *   update_layout_card   a card's text, its layout, or both — or removes its layout; aimed at one object id
 *
 * The rules (P1–P5 of the plan):
 * - Gated (D6): off until the user turns on ⋮ → MCP access → "Allow intelligent UI" for the workspace; free in this build.
 *   `ToolPolicy.entitlement("intelligent_ui")` is checked too, so a later plan limit attaches without changing a tool.
 * - Rich text stays the source of truth (P2): the card's Markdown is stored as its content; the layout rides beside it.
 * - Checked, never trusted (P5, D3): every layout goes through `checkLayout` (structure, static, limits, citations that
 *   exist in the named source, numbers in the text). Passing is structural only; the result never calls a layout right.
 * - Reviewed (P4): proposals only, through `proposeChangeSet`; never in the auto-accept set. Updates name their target
 *   and carry the baseline the call saw, so an edit made before Accept is never overwritten (Keep mine / Use proposed);
 *   `expectedContentHash` (from `get_block`) refuses at once when the card changed since the client read it.
 *
 * No React or OpenUI imports here (as every tool module): the app supplies the check and the grammar (`LayoutToolOptions`).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { keepFormatting } from "@/ai/changes/keepFormatting";
import { cardContentHash } from "@/ai/openui/cardLayout";
import type { LayoutCheck, LayoutCheckInput } from "@/ai/openui/layoutCheck";
import { fingerprintOf, labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import { loadDefaultParser } from "@/ai/renderer/render";
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import { getEmbedRef } from "@/domain/canvas/adapter";
import { CARD_LAYOUT_LANG_MAX, type RichContent } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { cut } from "../context/currentContext";
import { DESTRUCTIVE_ANNOTATIONS, entitlementResult, guarded, READ_ANNOTATIONS, ToolFailure, toolResult, WRITE_ANNOTATIONS } from "./common";
import type { LiveCanvasActions } from "./liveCanvas";
import { onePlan, PROPOSED_SHAPE, proposeChangeSet, renderPlan, sanitizeClientName, type WriteToolDeps } from "./writeTools";

export const LAYOUT_READ_TOOLS = ["get_layout_grammar"] as const;
export const LAYOUT_WRITE_TOOLS = ["create_layout_card", "update_layout_card"] as const;
export const LAYOUT_TOOL_NAMES = [...LAYOUT_READ_TOOLS, ...LAYOUT_WRITE_TOOLS] as const;
/** The feature a plan limit would name (D49). */
export const INTELLIGENT_UI_FEATURE = "intelligent_ui";

/** What the app supplies (the tools themselves import no React, OpenUI or storage). */
export interface LayoutToolOptions {
  /** Whether the user allowed intelligent UI over MCP for this workspace; read on every call. */
  allowed(): boolean;
  /** The canvas's content sources, for the passages a card may cite. */
  contentSources: ContentSourceRepository;
  /** `layoutCheck.ts` `checkLayout`, with its review lines (`layoutReviewLines`). */
  check(input: LayoutCheckInput): Promise<{ check: LayoutCheck; lines: string[] }>;
  /** `layoutGrammar.ts` `layoutGrammar` plus its examples. */
  grammar(): Promise<{ grammar: string; examples: readonly { layout: string; use: string; lang: string }[] }>;
}

export interface LayoutToolDeps extends WriteToolDeps {
  layout: LayoutToolOptions;
}

export const LAYOUT_MESSAGES = {
  off: 'Intelligent UI is turned off for this workspace. Ask the user to turn on ⋮ → MCP access → "Allow intelligent UI" (it is free: your own model composes the layout).',
  refused: "The layout was refused; nothing was proposed.",
} as const;

/** A created card's height for its layout: room for its visible text (Cards view never resizes a block). */
export function layoutCardHeight(textChars: number): number {
  return Math.min(560, Math.max(180, 120 + Math.ceil(textChars / 45) * 18));
}

const sourceIdArg = z.string().trim().min(1).max(200).optional().describe("A content source on the open canvas whose passages the layout cites (CitationChip unit ids). Without it the card cites nothing.");
const langArg = z.string().trim().min(1).max(CARD_LAYOUT_LANG_MAX).describe("The card's layout as OpenUI Lang (read get_layout_grammar first).");
const canvasIdArg = z.string().min(1).max(200).optional().describe("The canvas to propose on; must be the open canvas (the default).");

const layoutCheckShape = z.object({ lines: z.array(z.string()), cites: z.array(z.string()), notes: z.array(z.string()) });

export function registerLayoutTools(server: McpServer, deps: LayoutToolDeps): void {
  const client = () => sanitizeClientName(deps.clientName?.());
  const title = (what: string) => cut(`${client() ?? "MCP"}: ${what}`, 200).text;
  const meta = (task: (typeof LAYOUT_WRITE_TOOLS)[number]): ChangeSet["metadata"] => ({ createdBy: "mcp", task, ...(client() ? { provider: client()! } : {}) });

  /** The gate every layout tool passes first: the user's switch, then a plan limit (none in this build). */
  const gated = <A,>(run: (args: A) => ReturnType<typeof toolResult> | Promise<ReturnType<typeof toolResult>>) => (args: A) => {
    const refusal = deps.policy().entitlement?.(INTELLIGENT_UI_FEATURE);
    if (refusal) return entitlementResult(refusal);
    return guarded(async () => {
      if (!deps.layout.allowed()) throw new ToolFailure(LAYOUT_MESSAGES.off);
      return run(args);
    });
  };

  /** The passages a card may cite: the named source's latest version, which must belong to the open canvas. */
  const passagesFor = async (live: LiveCanvasActions, sourceId: string | undefined): Promise<Map<string, string>> => {
    if (!sourceId) return new Map();
    const source = await deps.layout.contentSources.get(sourceId);
    if (!source || source.canvasId !== live.canvasId) throw new ToolFailure(`No content source ${sourceId} on the open canvas.`);
    const version = await deps.layout.contentSources.getVersion(source.id, source.latestVersion);
    return new Map((version?.units?.units ?? []).map((u) => [u.id, u.text] as const));
  };

  /** Checks a layout against the card's text; refuses with every problem found, or returns the review lines and notes. */
  const checked = async (live: LiveCanvasActions, lang: string, content: RichContent, sourceId: string | undefined) => {
    const passages = await passagesFor(live, sourceId);
    const objects = new Set(live.elements().filter((e) => !e.isDeleted).map((e) => e.id));
    const { check, lines } = await deps.layout.check({ lang, card: { title: "Untitled", snapshot: content }, passages, objects });
    if (!check.ok) throw new ToolFailure(`${LAYOUT_MESSAGES.refused} ${check.errors.map((e) => e.message).join(" ")}`);
    return { check, lines };
  };

  server.registerTool(
    "get_layout_grammar",
    {
      title: "Get layout grammar",
      description:
        "How to compose a card's layout (OpenUI Lang) for create_layout_card and update_layout_card: the components and their arguments, the limits and rules the canvas checks, and one example per layout. Read it once per session.",
      inputSchema: {},
      outputSchema: { grammar: z.string(), examples: z.array(z.object({ layout: z.string(), use: z.string(), lang: z.string() })) },
      annotations: READ_ANNOTATIONS,
    },
    gated(async () => {
      const { grammar, examples } = await deps.layout.grammar();
      return toolResult(grammar, { grammar, examples: [...examples] });
    }) as never,
  );

  const markdown = z.string().trim().min(1).max(TEXT_LIMITS.markdown);
  server.registerTool(
    "create_layout_card",
    {
      title: "Create layout card",
      description:
        "Adds a text card to the open canvas with its Markdown (the card's text, which search, export and study read) and an OpenUI layout (how the Cards view draws it). The canvas checks the layout (structure, limits, citations, numbers) and proposes the card for the user's review; nothing changes until they accept. Read get_layout_grammar first.",
      inputSchema: { markdown: markdown.describe("The card's text, GFM Markdown."), lang: langArg, title: z.string().trim().min(1).max(TEXT_LIMITS.title).optional(), sourceId: sourceIdArg, canvasId: canvasIdArg },
      outputSchema: { ...PROPOSED_SHAPE, layoutCheck: layoutCheckShape.optional() },
      annotations: WRITE_ANNOTATIONS,
    },
    gated((args: { markdown: string; lang: string; title?: string; sourceId?: string; canvasId?: string }) =>
      proposeChangeSet(deps, args, async (live, operationId) => {
        const node = { id: "card", type: "text", ...(args.title ? { title: args.title } : {}), content: { markdown: args.markdown } };
        const { set, warnings } = await renderPlan(deps, live, operationId, onePlan(node), title("Add layout card"), meta("create_layout_card"));
        const card = set.changes.find((c): c is Extract<ProposedChange, { kind: "create_block" }> => c.kind === "create_block" && c.blockType === "text");
        if (!card) throw new ToolFailure("The Markdown didn't make a text card; nothing was proposed.");
        const { check, lines } = await checked(live, args.lang, card.content, args.sourceId);
        const changes = set.changes.map((c) => (c === card ? { ...card, layout: { lang: args.lang }, box: { ...card.box, height: Math.max(card.box.height, layoutCardHeight(check.stats.textChars)) } } : c));
        const notes = check.notes.map((n) => n.message);
        return { set: { ...set, changes }, warnings: [...warnings, ...notes], extra: { layoutCheck: { lines, cites: check.cites, notes } } };
      }),
    ) as never,
  );

  server.registerTool(
    "update_layout_card",
    {
      title: "Update layout card",
      description:
        "Changes one card on the open canvas: its Markdown, its layout, or both; or removes its layout (`removeLayout`). Send `expectedContentHash` from get_block so a card the user changed since you read it is refused. The layout is checked and the change proposed for the user's review; an edit they make before accepting is never overwritten.",
      inputSchema: {
        objectId: z.string().min(1).max(200).describe("The text card to change (from list_blocks or get_block)."),
        markdown: markdown.optional().describe("The card's new text, GFM Markdown. Without it the text stays as it is."),
        lang: langArg.optional(),
        removeLayout: z.literal(true).optional().describe("Removes the card's layout (its text stays)."),
        sourceId: sourceIdArg,
        expectedContentHash: z.string().min(1).max(64).optional().describe("The card's contentHash as get_block returned it."),
        canvasId: canvasIdArg,
      },
      outputSchema: { ...PROPOSED_SHAPE, layoutCheck: layoutCheckShape.optional() },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    gated((args: { objectId: string; markdown?: string; lang?: string; removeLayout?: true; sourceId?: string; expectedContentHash?: string; canvasId?: string }) => {
      if (!args.markdown && !args.lang && !args.removeLayout) throw new ToolFailure("Give `markdown`, `lang` or `removeLayout`.");
      if (args.lang && args.removeLayout) throw new ToolFailure("Give either `lang` or `removeLayout`, not both.");
      return proposeChangeSet(deps, args, async (live, operationId) => {
        const el = live.elements().find((e) => e.id === args.objectId && !e.isDeleted);
        const ref = el ? getEmbedRef(el) : null;
        if (!el || ref?.kind !== "rich-block" || ref.blockType !== "text") throw new ToolFailure(`No text card with id ${args.objectId} on the open canvas; update_layout_card changes text cards only.`);
        const record = live.getDocument?.(ref.documentId);
        if (!record) throw new ToolFailure(`The card ${args.objectId} isn't loaded on the open canvas; try again in a moment.`);
        if (args.expectedContentHash && args.expectedContentHash !== cardContentHash(record)) {
          throw new ToolFailure(`The card ${args.objectId} changed since you read it; read it again with get_block. Nothing was proposed.`);
        }
        const parse = deps.parseMarkdown ?? (await loadDefaultParser());
        const content = args.markdown ? keepFormatting(record.snapshot, parse(args.markdown)) : record.snapshot;
        const result = args.lang ? await checked(live, args.lang, content, args.sourceId) : null;
        // The same stale-target protection as update_block: an edit made before Accept asks Keep mine / Use proposed.
        const current = live.getDocument ? objectContent(el, labelsByContainer(live.elements()), live.getDocument) : null;
        const baseline = current && current.kind !== "shape" ? fingerprintOf(current) : undefined;
        const change: ProposedChange = {
          kind: "update_block",
          target: el.id,
          content,
          ...(baseline ? { expectedFingerprint: baseline } : {}),
          ...(args.lang ? { layout: { lang: args.lang } } : args.removeLayout ? { layout: null } : {}),
        };
        const warnings = result ? result.check.notes.map((n) => n.message) : [];
        if (!args.lang && !args.removeLayout && record.layout && record.layout.contentHash !== cardContentHash({ title: "Untitled", snapshot: content })) {
          warnings.push("The card's layout was composed for its old text, so it will be drawn from the new text and shown as out of date until you send `lang` again (or `removeLayout`).");
        }
        const what = args.removeLayout ? "Remove card layout" : args.lang && args.markdown ? "Update card and layout" : args.lang ? "Update card layout" : "Update card";
        return {
          set: { operationId, title: title(what), metadata: meta("update_layout_card"), changes: [change] },
          warnings,
          ...(result ? { extra: { layoutCheck: { lines: result.lines, cites: result.check.cites, notes: result.check.notes.map((n) => n.message) } } } : {}),
        };
      });
    }) as never,
  );
}
