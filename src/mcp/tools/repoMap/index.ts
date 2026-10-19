/**
 * Repo Map over MCP (F43): five tools and one prompt, registered beside
 * F21's. An IDE agent (Claude Code, Copilot, Cursor, …) sends a repository
 * one module at a time; Acute validates, lays out, reconciles and stages it
 * for the user's review on a map canvas it created (`service.ts`).
 *
 *   begin_repo_map      create or reopen the map canvas; starts a mapping session
 *   upsert_map_section  one module → one frame; idempotent by key
 *   link_map_nodes      links between modules, drawn when both ends exist
 *   get_map_status      keys only: what is mapped, stale, pending, corrected
 *   remove_map_nodes    a removal for review (never auto-accepted)
 *   prompt map_repo     the playbook
 *
 * Nothing here reads the repository, runs git, touches the file system or
 * calls a model (a guard test checks this module's imports).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { describeLayout, type LayoutReport } from "@/ai/changes/layoutCheck";
import { plural, ToolFailure, toolError, toolResult } from "../common";
import { expandLensNodePrompt, keepLensCurrentPrompt, mapRepoPrompt, tidyMapPrompt } from "./prompt";
import { LINKS_SHAPE, MAP_REF, parseLinks, parseSectionInput, REPO_MAP_LIMITS, RepoMapRejection, SECTION_SHAPE } from "./schema";
import { RepoMapService, type RepoMapDeps } from "./service";

export { registerRepoMapHost, getRepoMapHost, type RepoMapHost } from "./host";
export { resetRepoMapState, type RepoMapServices } from "./service";

export const REPO_MAP_TOOL_NAMES = ["begin_repo_map", "upsert_map_section", "link_map_nodes", "get_map_status", "remove_map_nodes", "tidy_map_section"] as const;
/** The ones that work in a read-only workspace. */
export const REPO_MAP_READ_TOOLS = ["get_map_status"] as const;
export const REPO_MAP_PROMPT = "map_repo";
export const TIDY_MAP_PROMPT = "tidy_map";
export const EXPAND_LENS_PROMPT = "expand_lens_node";
export const KEEP_LENS_CURRENT_PROMPT = "keep_lens_current";

const STAGING: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READING: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const REMOVING: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

/** What the layout checks found, and how to repair it (the playbook's repair loop). */
function layoutNote(layout: LayoutReport | undefined): string {
  const found = layout ? describeLayout(layout.counts) : null;
  if (!layout || !found) return "";
  const fatal = layout.issues.some((i) => i.severity === "fatal");
  return ` Layout: ${found}.${fatal ? " Fix the fatal ones (see layout.issues: each has a subject and fixes) by re-sending the section — drop low-value links, split the section or reorder cards." : ""}`;
}

const REVIEW_NOTE =
  "Changes are staged for the user's review on the map canvas (one pending set that grows as calls arrive); the result's status says what happened: staged, applied (only if the user switched on auto-accept), unchanged, or rejected.";

/** A rejection: the whole call changed nothing; the reason and message say what to fix. */
function rejected(err: RepoMapRejection): CallToolResult {
  const payload = { status: "rejected", ...err.rejection };
  return { isError: true, content: [{ type: "text", text: `Rejected (${err.rejection.reason}): ${err.rejection.message} Nothing was written.` }, { type: "text", text: JSON.stringify(payload) }] };
}

async function run(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof RepoMapRejection) return rejected(err);
    if (err instanceof ToolFailure) return toolError(err.message);
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

/** Sends one section as `upsert_map_section` does, with the same result; `sync_session` uses it for `architecture`. */
export type MapSectionWriter = (args: Record<string, unknown>) => Promise<CallToolResult>;

/** Registers the map tools; returns the section writer they share with `sync_session` (D38). */
export function registerRepoMapTools(server: McpServer, deps: RepoMapDeps): MapSectionWriter {
  const service = new RepoMapService(deps);
  const L = REPO_MAP_LIMITS;
  const register = <Shape extends z.ZodRawShape>(name: string, config: { title: string; description: string; inputSchema: Shape; annotations: ToolAnnotations }, body: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>) =>
    server.registerTool(name, config, ((args: z.infer<z.ZodObject<Shape>>) => run(() => body(args))) as never);

  register(
    "begin_repo_map",
    {
      title: "Begin repo map",
      description:
        "Starts mapping a code repository onto an Acute-Notes canvas: creates the map canvas on first use (later calls for the same repo reopen it) and opens it. " +
        "Returns the mapId and the map's status (as get_map_status). Starts a new mapping session. Acute-Notes never reads the repository: you send what you understood, module by module, with upsert_map_section.",
      inputSchema: {
        repo: z.string().trim().min(1).max(200).describe("The repo's display name, e.g. org/name."),
        commit: z.string().trim().min(1).max(100).describe("The commit you are mapping (e.g. short SHA)."),
        title: z.string().trim().min(1).max(200).optional().describe("The map canvas's title (first use only)."),
        repoRoot: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .refine((p) => /^([A-Za-z]:[\\/]|\/)/.test(p) && !/[\p{Cc}]/u.test(p), "an absolute folder path on this computer")
          .optional()
          .describe("Optional: the repository's absolute folder on this computer (e.g. from `git rev-parse --show-toplevel`), so the user can open a card's source in VS Code from Lens. Kept on this device only."),
      },
      annotations: STAGING,
    },
    async (args) => {
      const r = await service.begin(args);
      const text =
        `${r.created ? "Created" : "Reopened"} the map of ${args.repo} (${r.mapId}): ${plural(r.status.counts.sections, "section")}, ${plural(r.status.counts.nodes, "node")}.` +
        (r.open ? "" : " The map canvas isn't open yet; ask the user to open it in Acute-Notes before sending sections.");
      return toolResult(text, r);
    },
  );

  const upsertSection = async (args: { mapId: unknown; commit: unknown; section: unknown; nodes: unknown; relationships?: unknown }): Promise<CallToolResult> => {
    const input = parseSectionInput(args);
    if (typeof args.mapId !== "string") throw new ToolFailure("mapId: the mapId from begin_repo_map, or the repo name.");
    const r = await service.upsert(await service.resolveMapId(args.mapId), input);
    const count = (o: string) => r.outcomes.filter((x) => x.outcome === o).length;
    const text =
      `Section ${r.section}: ${r.status}. ${count("added")} added, ${count("updated")} updated, ${count("unchanged")} unchanged, ${count("conflict")} in conflict` +
      (r.removed.length ? `, ${r.removed.length} removed` : "") +
      (r.pendingEdges.length ? `; ${plural(r.pendingEdges.length, "link")} pending until the other end is sent` : "") +
      (r.status === "staged" ? ". Waiting for the user's review." : ".") +
      layoutNote(r.layout);
    return toolResult(text, r);
  };

  register(
    "upsert_map_section",
    {
      title: "Upsert map section",
      description:
        `Sends one module of the repo as one section (one frame) of the map: its cards (nodes) and links. Idempotent by key: re-sending a key updates that card, never duplicates it; an identical re-send is "unchanged". ` +
        `Node types: text {markdown}, heading {text}, table {columns, rows}, todo {items}, shape {shape, label}, code {code, language?}; each with key, optional title and source {path (repo-relative), lines: [first, last]}. ` +
        `Limits per call: ≤ ${L.nodesPerCall} nodes, ≤ ${L.textPerNode} characters of text per node, code ≤ ${L.codeLines} lines, ≤ ${L.relationshipsPerCall} relationships, ≤ ${L.requestBytes / 1024} KB. Per map: ≤ ${L.sectionsPerMap} sections, ≤ ${L.nodesPerMap} nodes (else map_full). ` +
        `A call over a limit, with an unknown node or relation type, a duplicate key or anything that looks like a secret is rejected whole, naming the reason. ` +
        `Cards the user edited are never overwritten (they come back as conflicts for the user, and as corrections in get_map_status). ${REVIEW_NOTE}`,
      inputSchema: SECTION_SHAPE,
      annotations: STAGING,
    },
    (args) => upsertSection(args),
  );

  register(
    "link_map_nodes",
    {
      title: "Link map nodes",
      description: `Draws links between cards or sections by key, e.g. across modules. A link to a key not sent yet is kept as pending and drawn when that key arrives. At most ${L.linksPerCall} links. ${REVIEW_NOTE}`,
      inputSchema: LINKS_SHAPE,
      annotations: STAGING,
    },
    async (args) => {
      const links = parseLinks(args.links);
      const r = await service.link(await service.resolveMapId(args.mapId), links);
      const n = (s: string) => r.links.filter((l) => l.state === s).length;
      return toolResult(`${n("staged")} staged, ${n("applied")} applied, ${n("already_drawn")} already drawn, ${n("pending")} pending.${layoutNote(r.layout)}`, r);
    },
  );

  register(
    "get_map_status",
    {
      title: "Get map status",
      description:
        `What the map holds, as keys only (no content): its sections and nodes with the commit each was mapped at; which are stale — their source.path is in changedPaths (a path ending in / matches everything under it), ` +
        `or, without changedPaths, they were mapped at a different commit than \`commit\`; \`affectedAncestors\`: the cards above the stale ones, up the section parents (L4 → L1), which may need re-sending if their meaning changed; pending links; what is staged for review; and \`corrections\`: cards the user edited (with their current text), deleted or opted out of since you last asked. ` +
        `Acute-Notes never runs git: pass changedPaths, or changedFiles with line ranges, from your own git diff. Stale cards get a quiet marker on the canvas until re-sent. At most ${L.statusKeys} keys (then truncated).`,
      inputSchema: {
        mapId: MAP_REF,
        commit: z.string().trim().min(1).max(100).optional(),
        changedPaths: z.array(z.string().max(L.pathLength)).max(L.changedPaths).optional().describe("Repo-relative paths changed since the map's commit."),
        changedFiles: z
          .array(z.object({ path: z.string().max(L.pathLength), lines: z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])).max(200).optional() }))
          .max(L.changedPaths)
          .optional()
          .describe("Like changedPaths, plus the [first, last] line ranges your diff touched (from `git diff -U0`): a card is stale only if its source.lines overlap one, or it has no lines."),
        layout: z.boolean().optional().describe("Also report the map canvas's layout issues by key (links through cards, crossings, …): where tidy_map_section would help."),
      },
      annotations: READING,
    },
    async (args) => {
      const r = await service.status(await service.resolveMapId(args.mapId), {
        ...(args.commit ? { commit: args.commit } : {}),
        ...(args.changedPaths ? { changedPaths: args.changedPaths } : {}),
        ...(args.changedFiles ? { changedFiles: args.changedFiles as { path: string; lines?: [number, number][] }[] } : {}),
        ...(args.layout ? { layout: true } : {}),
      });
      const text =
        `${plural(r.counts.sections, "section")}, ${plural(r.counts.nodes, "node")}; ${r.stale.length} stale` +
        (r.affectedAncestors.length ? ` (${plural(r.affectedAncestors.length, "ancestor")} may be affected)` : "") +
        `, ${r.pendingEdges.length} pending links, ${plural(r.corrections.length, "correction")}` +
        (r.staged.length ? `; ${r.staged.length} staged for review` : "") +
        (r.truncated ? " (truncated)" : "") +
        "." +
        ("layout" in r && r.layout ? ` Layout: ${describeLayout(r.layout.counts) ?? "clean"}.` : "");
      return toolResult(text, r);
    },
  );

  register(
    "remove_map_nodes",
    {
      title: "Remove map nodes",
      description:
        `Proposes removing cards (or whole sections, by section key) this map created — never anything else on the canvas. Always reviewed by the user, even under auto-accept. ` +
        `Links to removed keys are dropped. At most ${L.keysPerRemove} keys.`,
      inputSchema: { mapId: MAP_REF, keys: z.array(z.string().min(1).max(L.keyLength)).min(1).max(L.keysPerRemove) },
      annotations: REMOVING,
    },
    async (args) => {
      const r = await service.remove(await service.resolveMapId(args.mapId), args.keys);
      const removed = r.sections.reduce((n, s) => n + s.removed.length, 0);
      return toolResult(
        `Proposed removing ${plural(removed, "key")} from ${plural(r.sections.length, "section")} for the user's review` + (r.notFound.length ? `; not in the map: ${r.notFound.slice(0, 20).join(", ")}` : "") + ".",
        { ...r, status: r.sections.some((s) => s.status === "staged") ? "staged" : "unchanged" },
      );
    },
  );

  register(
    "tidy_map_section",
    {
      title: "Tidy map section",
      description:
        "Makes one accepted section of the map easier to read without regenerating it: lays its cards out again (moves only — `order` first, then along its own links, " +
        "`arrangement` grid/row/column), drops links the map drew (`dropLinks`, by their ends' keys), and moves the section under another parent card (`parent`, or null for top level). " +
        "Never edits card text; cards the user moved or locked stay where they are; nothing the map didn't draw is touched. " +
        "Always staged for the user's review (never auto-accepted). The result's layout compares the section before and after (`improved`).",
      inputSchema: {
        mapId: MAP_REF,
        section: z.string().min(1).max(L.keyLength).describe("The section's key."),
        order: z.array(z.string().min(1).max(L.keyLength)).max(L.nodesPerCall).optional().describe("Card keys in the order to lay them out (the main path first)."),
        arrangement: z.enum(["grid", "row", "column"]).optional().describe("Default: from the section's arrangement (chain → row, stack → column, else grid)."),
        dropLinks: z
          .array(z.object({ from: z.string().min(1).max(L.keyLength), to: z.string().min(1).max(L.keyLength), type: z.string().max(40).optional() }))
          .max(L.linksPerCall)
          .optional()
          .describe("Links the map drew to remove, by their ends' keys."),
        parent: z.string().min(1).max(L.keyLength).nullable().optional().describe("A card in another section this section details, or null to make it top-level."),
      },
      annotations: STAGING,
    },
    async (args) => {
      const r = await service.tidy(await service.resolveMapId(args.mapId), {
        section: args.section,
        ...(args.order ? { order: args.order } : {}),
        ...(args.arrangement ? { arrangement: args.arrangement } : {}),
        ...(args.dropLinks ? { dropLinks: args.dropLinks } : {}),
        ...(args.parent !== undefined ? { parent: args.parent } : {}),
      });
      const text =
        `Tidy ${r.section}: ${r.status}. ${plural(r.moved, "card")} moved, ${plural(r.droppedLinks.length, "link")} dropped` +
        (r.kept.length ? `, ${plural(r.kept.length, "card")} left where the user put ${r.kept.length === 1 ? "it" : "them"}` : "") +
        (r.notFound.length ? `; not drawn by the map: ${r.notFound.slice(0, 10).join(", ")}` : "") +
        `. Layout score ${r.layout.before.score} → ${r.layout.after.score}${r.layout.improved ? " (cleaner)" : " (not cleaner — consider another order or dropping links; the user can reject it)"}.` +
        (r.status === "staged" ? " Waiting for the user's review." : "");
      return toolResult(text, r);
    },
  );

  server.registerPrompt(
    TIDY_MAP_PROMPT,
    {
      title: "Tidy this map",
      description: "The playbook for making an existing repo map easier to read without regenerating it.",
      argsSchema: { repo: z.string().optional().describe("The repo's display name, e.g. org/name.") },
    },
    (args) => ({ messages: [{ role: "user", content: { type: "text", text: tidyMapPrompt(args) } }] }),
  );

  server.registerPrompt(
    EXPAND_LENS_PROMPT,
    {
      title: "Expand a Lens node",
      description: "Read the code behind one map card and send its next level down as a child section (what Lens's \"Ask your IDE agent\" copies).",
      argsSchema: { key: z.string().optional().describe("The card's key (e.g. mod:src/payments)."), repo: z.string().optional().describe("The repo's display name, e.g. org/name.") },
    },
    (args) => ({ messages: [{ role: "user", content: { type: "text", text: expandLensNodePrompt(args) } }] }),
  );

  server.registerPrompt(
    KEEP_LENS_CURRENT_PROMPT,
    {
      title: "Keep Lens current",
      description: "Agent Sync: after each batch of code edits, find the map cards they affect and re-send only those sections.",
      argsSchema: { repo: z.string().optional().describe("The repo's display name, e.g. org/name.") },
    },
    (args) => ({ messages: [{ role: "user", content: { type: "text", text: keepLensCurrentPrompt(args) } }] }),
  );

  server.registerPrompt(
    REPO_MAP_PROMPT,
    {
      title: "Map this repository",
      description: "The playbook for building and refreshing a repo map on an Acute-Notes canvas with the repo-map tools.",
      argsSchema: { repo: z.string().optional().describe("The repo's display name, e.g. org/name."), focus: z.string().optional().describe("Optional: which part to map first.") },
    },
    (args) => ({ messages: [{ role: "user", content: { type: "text", text: mapRepoPrompt(args) } }] }),
  );

  return (args) => run(() => upsertSection(args as Parameters<typeof upsertSection>[0]));
}
