/**
 * The Acute-Notes MCP server (F20, PRD §F20): read-only resources over one
 * workspace, plus the F21 tool surface (`./tools`), built on the MCP
 * TypeScript SDK.
 *
 *   acute://workspace/{workspaceId}   canvases and pages (links only)
 *   acute://canvas/{canvasId}         objects (typed, excerpted) and relations
 *   acute://page/{pageId}             the page as Markdown
 *   acute://table/{objectId}          a table block's rows
 *   acute://todo/{objectId}           a todo block's items
 *   acute://context/current           what the user is looking at (F25)
 *   acute://lens/{lensKey}            a Lens root's hierarchy (Lens Phase 3; `./tools/lensTools`)
 *
 * Transport-agnostic: `createAcuteMcpServer` returns an unconnected
 * `McpServer`; whoever hosts it calls `server.connect(transport)`. Nothing
 * here imports React, the renderer or a transport. Tools reach the open
 * canvas only through `LiveCanvasActions` (`./tools/liveCanvas`), and write
 * tools only ever propose a change set for the user's review (F19).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, type ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import { CURRENT_CONTEXT_VERSION, type CurrentContext } from "./context/currentContext";
import { registerPrompts } from "./prompts/registry";
import { getCurrentContext as liveCurrentContext } from "./context/currentContextSource";
import { ResourceReader, type McpReadServices } from "./resources/reader";
import type { ResourceLink } from "./resources/serializers";
import { CURRENT_CONTEXT_URI, parseResourceUri, URI_TEMPLATES, type ResourceKind } from "./resources/uris";
import { sessionAutoAccept } from "@/ai/changes/autoAccept";
import { resolvePolicy } from "./tools/common";
import type { AgentStateRepository } from "@/persistence/repositories/types";
import { availableToolNames, getLiveCanvasActions, registerAcuteTools, type IngestToolOptions, type LensFocusHost, type LiveCanvasActions, type RepoMapToolOptions, type ToolCallUsage, type ToolPolicySource } from "./tools";

export const MCP_SERVER_NAME = "acute-notes";
export const MCP_SERVER_VERSION = "0.1.0";
export const JSON_MIME = "application/json";

/** MCP's "resource not found" error code (spec: Resources → Error handling). */
export const RESOURCE_NOT_FOUND = -32002;

export interface AcuteMcpServerDeps {
  /** Only these repositories are reachable; AI settings, credentials and conversations are not. */
  services: McpReadServices;
  /** The one workspace this server exposes. Everything else is "not found". */
  workspaceId: string;
  /** The live current context; defaults to the open canvas's (`currentContextSource`). */
  getCurrentContext?: () => Promise<CurrentContext | null>;
  /** The open canvas's actions for write tools; defaults to the registered one (`registerLiveCanvasActions`). */
  getLiveCanvas?: () => LiveCanvasActions | null;
  /** The tab's Lens panel for `focus_lens`; defaults to the registered one (`registerLensFocusHost`). */
  getLensFocus?: () => LensFocusHost | null;
  /** Checked on every tool call. Default: reads allowed, writes allowed as proposals for review. */
  toolPolicy?: ToolPolicySource;
  /** Markdown → rich content for created text blocks and pages; defaults to the app's parser (tests inject a stub). */
  parseMarkdown?: ParseMarkdown;
  /** F43: serve the repo-map tools and the `map_repo` prompt, with their store. */
  repoMap?: RepoMapToolOptions;
  /** Serve the content-import tools (AI imports, guarded by the user's setting); never to a remote session, as the repo-map tools. */
  ingest?: IngestToolOptions;
  /** Agent State (D46): told about every tool call, for the session's usage. */
  onToolCall?: (call: ToolCallUsage) => void;
  /** Agent State (D31): the change log and session records (Phase 7B's history tools, `sync_session`). */
  agentState?: AgentStateRepository;
  /** This connection's MCP session id (the relay's); one is made when not given. */
  sessionId?: string;
  /**
   * The client is not a trusted local one (secret URL, OAuth, a tunnel, the hosted app). Its session can never
   * auto-accept, and the repo-map tools (whose own auto-accept path is per map session) aren't served to it, so every
   * change it proposes waits for the user's explicit review.
   */
  remote?: boolean;
}

/** `acute://context/current` when no canvas of this workspace is open. */
export interface CurrentContextUnavailable {
  uri: typeof CURRENT_CONTEXT_URI;
  version: typeof CURRENT_CONTEXT_VERSION;
  available: false;
}

const json = (uri: string, payload: unknown): ReadResourceResult => ({
  contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(payload) }],
});

const notFound = (uri: string) => new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${uri}`, { uri });

const toListed = (links: readonly ResourceLink[]) => ({
  resources: links.map((l) => ({ uri: l.uri, name: l.title, mimeType: JSON_MIME })),
});

const variable = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
};

const DESCRIPTIONS: Record<ResourceKind, { title: string; description: string; variable: string }> = {
  workspace: { title: "Workspace", description: "A workspace: its canvases (in order) and pages, as links to their own resources.", variable: "workspaceId" },
  canvas: {
    title: "Canvas",
    description: "A canvas: its objects in z-order (stable id, typed kind, bounds, excerpt, provenance) and the relations between them.",
    variable: "canvasId",
  },
  page: { title: "Page", description: "A page's content as GFM Markdown, with its title and provenance.", variable: "pageId" },
  table: { title: "Table block", description: "A table block on a canvas, by its object id: header rows and plain-text cells.", variable: "objectId" },
  todo: { title: "Todo block", description: "A todo block on a canvas, by its object id: items with checked state and nesting.", variable: "objectId" },
};

export function createAcuteMcpServer(deps: AcuteMcpServerDeps): McpServer {
  if (deps.remote && deps.sessionId) sessionAutoAccept.markRemote(deps.sessionId);
  const repoMap = deps.remote ? undefined : deps.repoMap;
  const ingest = deps.remote ? undefined : deps.ingest;
  const reader = new ResourceReader(deps.services, deps.workspaceId);
  const currentContext = deps.getCurrentContext ?? (() => liveCurrentContext(deps.services));
  const scopedContext = async () => {
    const ctx = await currentContext();
    return ctx && ctx.workspace.id === deps.workspaceId ? ctx : null;
  };
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Access to one Acute-Notes workspace. Start from acute://context/current (what the user is looking at) " +
        "or acute://workspace/{id}; payloads link to other resources by URI. Every payload is bounded: `truncated` says when something was left out. " +
        "Read tools search and read the workspace. Write tools never change anything directly: each proposes a change on the open canvas " +
        "for the user to review, and returns status \"proposed\" (one proposal per session can wait for review at a time). " +
        "Session loop: before significant work call get_session_context with your task and honour its warnings (constraints and enforced decisions); " +
        "record durable knowledge as you go (record_decision, log_finding, update_progress); after the work call sync_session once with a summary and next. " +
        "Acute is the documented understanding of the project, not a substitute for the source code: when they disagree, the code wins — record the divergence. " +
        "Never fabricate project state. For a project file with these instructions, read acute://setup/instructions/{claude|codex|cursor}.",
    },
  );

  const readers: Record<ResourceKind, (id: string) => Promise<unknown>> = {
    workspace: (id) => reader.workspace(id),
    canvas: (id) => reader.canvas(id),
    page: (id) => reader.page(id),
    table: (id) => reader.table(id),
    todo: (id) => reader.todo(id),
  };
  const listers: Record<ResourceKind, () => Promise<ResourceLink[]>> = {
    workspace: () => reader.listWorkspaces(),
    canvas: () => reader.listCanvases(),
    page: () => reader.listPages(),
    table: () => reader.listBlocks("table"),
    todo: () => reader.listBlocks("todo"),
  };

  for (const kind of Object.keys(URI_TEMPLATES) as ResourceKind[]) {
    const meta = DESCRIPTIONS[kind];
    server.registerResource(
      kind,
      new ResourceTemplate(URI_TEMPLATES[kind], { list: async () => toListed(await listers[kind]()) }),
      { title: meta.title, description: meta.description, mimeType: JSON_MIME },
      async (uri, variables) => {
        const id = variable(variables[meta.variable]);
        const payload = id ? await readers[kind](id) : null;
        if (!payload) throw notFound(uri.href);
        return json(uri.href, payload);
      },
    );
  }

  const currentPayload = async (): Promise<CurrentContext | CurrentContextUnavailable> => {
    const ctx = await scopedContext();
    return ctx
      ? { ...ctx, availableTools: availableToolNames(deps.toolPolicy, { repoMap: !!repoMap, ingest: !!ingest }) }
      : { uri: CURRENT_CONTEXT_URI, version: CURRENT_CONTEXT_VERSION, available: false };
  };

  server.registerResource(
    "current-context",
    CURRENT_CONTEXT_URI,
    {
      title: "Current context",
      description: "What the user is looking at now: the selection, nearby objects, the open page, their relations, and recent accepted AI changes.",
      mimeType: JSON_MIME,
    },
    async (uri) => json(uri.href, await currentPayload()),
  );

  // Reusable actions (§13.13), each on bounded context — the same payloads the resources serve.
  registerPrompts(server, {
    read: async (uri) => {
      if (uri === CURRENT_CONTEXT_URI) return currentPayload();
      const ref = parseResourceUri(uri);
      return ref?.kind === "canvas" ? reader.canvas(ref.id) : null;
    },
    writes: () => resolvePolicy(deps.toolPolicy).allowWrites,
  });

  registerAcuteTools(server, {
    services: deps.services,
    reader,
    workspaceId: deps.workspaceId,
    currentContext: scopedContext,
    liveCanvas: deps.getLiveCanvas ?? getLiveCanvasActions,
    ...(deps.getLensFocus ? { lensFocus: deps.getLensFocus } : {}),
    ...(deps.toolPolicy ? { policy: deps.toolPolicy } : {}),
    ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
    ...(repoMap ? { repoMap } : {}),
    ...(ingest ? { ingest } : {}),
    ...(deps.sessionId ? { sessionId: deps.sessionId } : {}),
    ...(deps.onToolCall ? { onToolCall: deps.onToolCall } : {}),
    ...(deps.agentState ? { agentState: deps.agentState } : {}),
  });

  return server;
}
