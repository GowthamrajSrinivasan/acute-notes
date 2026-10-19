/**
 * The Acute-Notes MCP tool surface (F21, PRD §F21): a deliberately small,
 * typed set of tools, registered on the server `createAcuteMcpServer` builds.
 *
 *   Read   search_workspace, get_canvas, get_page, get_selected_content, get_related_objects
 *   Write  create_block, create_page, create_table, create_todo, create_connection, move_object, update_block, render_visual_plan
 *
 * Plus, when the app provides a repo-map store, F43's repo-map tools and the
 * `map_repo` prompt (`./repoMap`).
 *
 * Reads are scoped to one workspace and bounded. Writes only ever propose a
 * change set for the user's review (F19); the `ToolPolicy` can turn them off.
 * No React, Excalidraw or transport imports: the open canvas is reached only
 * through `LiveCanvasActions`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { newId } from "@/domain/ids";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import type { CurrentContext } from "../context/currentContext";
import type { ResourceReader, McpReadServices } from "../resources/reader";
import { resolvePolicy, type ToolPolicySource } from "./common";
import type { LiveCanvasActions } from "./liveCanvas";
import { READ_TOOL_NAMES, registerReadTools } from "./readTools";
import { getRepoMapHost, REPO_MAP_READ_TOOLS, REPO_MAP_TOOL_NAMES, registerRepoMapTools, type MapSectionWriter, type RepoMapHost, type RepoMapServices } from "./repoMap";
import { WorkspaceScan } from "../resources/workspaceScan";
import { registerWriteTools, sanitizeClientName, WRITE_TOOL_NAMES } from "./writeTools";
import { INGEST_TOOL_NAMES, registerIngestTools, type IngestToolOptions } from "./ingestTools";
import { PROJECT_READ_TOOLS, PROJECT_WRITE_TOOLS, registerProjectTools } from "./projectTools";
import { PROJECT_RESOURCE_TEMPLATES, registerProjectResources, SETUP_RESOURCE_TEMPLATE } from "./projectResources";
import { OBJECT_READ_TOOLS, OBJECT_WRITE_TOOLS, registerObjectTools } from "./objectTools";
import { LENS_READ_TOOLS, LENS_RESOURCE_TEMPLATE, LENS_WRITE_TOOLS, registerLensResource, registerLensTools } from "./lensTools";
import { getLensFocusHost, type LensFocusHost } from "./lensFocus";
import { URI_TEMPLATES } from "../resources/uris";
import type { AgentStateRepository } from "@/persistence/repositories/types";
import type { SetupRegistry } from "../setup/instructions";

export { DEFAULT_TOOL_POLICY, type ToolPolicy, type ToolPolicySource } from "./common";
export { getLiveCanvasActions, registerLiveCanvasActions, type LiveCanvasActions } from "./liveCanvas";
export { READ_TOOL_NAMES } from "./readTools";
export { WRITE_TOOL_NAMES } from "./writeTools";
export { INGEST_TOOL_NAMES, type IngestToolOptions } from "./ingestTools";
export { PROJECT_READ_TOOLS, PROJECT_TOOL_NAMES, PROJECT_WRITE_TOOLS } from "./projectTools";
export { OBJECT_READ_TOOLS, OBJECT_WRITE_TOOLS } from "./objectTools";
export { LENS_READ_TOOLS, LENS_WRITE_TOOLS } from "./lensTools";
export { getLensFocusHost, registerLensFocusHost, type LensFocusHost, type LensFocusRequest } from "./lensFocus";
export { REPO_MAP_TOOL_NAMES } from "./repoMap";

export interface AcuteToolDeps {
  services: McpReadServices;
  reader: ResourceReader;
  workspaceId: string;
  /** Scoped: null unless the current context is this workspace's. */
  currentContext(): Promise<CurrentContext | null>;
  liveCanvas(): LiveCanvasActions | null;
  /** The tab's Lens panel, for `focus_lens` (tab-only, D41); defaults to the one the app registered. */
  lensFocus?(): LensFocusHost | null;
  policy?: ToolPolicySource;
  parseMarkdown?: ParseMarkdown;
  /** F43's repo-map tools are served only with their store. */
  repoMap?: RepoMapToolOptions;
  /** The content-import tools (`find_import_targets`, `import_content`) are served only with the app's AI runtime and sources, to local sessions. */
  ingest?: IngestToolOptions;
  /** This connection's MCP session id; one is made when not given (D40, D32). */
  sessionId?: string;
  /** Agent State (D31): the change log and session records the Phase 7B tools read and `sync_session` writes. */
  agentState?: AgentStateRepository;
  /** Called after every tool call (D46: the session's usage — calls and characters returned per tool). */
  onToolCall?: (call: ToolCallUsage) => void;
}

/** One tool call, for Agent State's per-session usage (D46). Nothing is limited or metered. */
export interface ToolCallUsage {
  session: string;
  /** The client's self-reported name, sanitized (D61). */
  agent?: string;
  tool: string;
  /** Characters of text the call returned. */
  chars: number;
}

/** Characters of text a tool result carries (its text content). */
export function resultChars(result: CallToolResult): number {
  return (result.content ?? []).reduce((n, c) => n + (c.type === "text" ? c.text.length : 0), 0);
}

/** Wraps every tool `server` registers from now on, so each call is reported to `onCall` once it returns. */
function meterTools(server: McpServer, onCall: (tool: string, result: CallToolResult) => void): void {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, cb: (...a: unknown[]) => Promise<CallToolResult>) => unknown;
  (server as unknown as { registerTool: typeof register }).registerTool = (name, config, cb) =>
    register(name, config, async (...a: unknown[]) => {
      const result = await cb(...a);
      try {
        onCall(name, result);
      } catch (err) {
        console.error("[acute-notes] Couldn't record a tool call", err);
      }
      return result;
    });
}

export interface RepoMapToolOptions {
  services: RepoMapServices;
  /** Creates and opens the map canvas; defaults to the one the app registered (`registerRepoMapHost`). */
  host?: () => RepoMapHost | null;
  /** How long `begin_repo_map` waits for the map canvas to open. */
  openTimeoutMs?: number;
}

/** The tools a client may call under `policy` (for `acute://context/current`'s `availableTools`). */
export function availableToolNames(policy?: ToolPolicySource, options: { repoMap?: boolean; ingest?: boolean } = {}): string[] {
  const writes = resolvePolicy(policy).allowWrites;
  const ingest = options.ingest ? (writes ? [...INGEST_TOOL_NAMES] : [INGEST_TOOL_NAMES[0]]) : [];
  const repoMap = options.repoMap ? (writes ? [...REPO_MAP_TOOL_NAMES] : [...REPO_MAP_READ_TOOLS]) : [];
  return [...READ_TOOL_NAMES, ...(writes ? WRITE_TOOL_NAMES : []), ...repoMap, ...ingest, ...PROJECT_READ_TOOLS, ...(writes ? PROJECT_WRITE_TOOLS : []), ...OBJECT_READ_TOOLS, ...(writes ? OBJECT_WRITE_TOOLS : []), ...LENS_READ_TOOLS, ...(writes ? LENS_WRITE_TOOLS : [])];
}

export function registerAcuteTools(server: McpServer, deps: AcuteToolDeps): void {
  const sessionId = deps.sessionId ?? newId("mcp");
  const agent = () => sanitizeClientName(server.server.getClientVersion()?.name);
  if (deps.onToolCall) {
    const onToolCall = deps.onToolCall;
    meterTools(server, (tool, result) => onToolCall({ session: sessionId, ...(agent() ? { agent: agent() } : {}), tool, chars: resultChars(result) }));
  }
  registerReadTools(server, {
    reader: deps.reader,
    scan: new WorkspaceScan(deps.services, deps.workspaceId),
    workspaceId: deps.workspaceId,
    currentContext: deps.currentContext,
  });
  registerWriteTools(server, {
    workspaceId: deps.workspaceId,
    liveCanvas: deps.liveCanvas,
    // Re-read on every call, so a policy given as a function (a user setting) applies at once.
    policy: () => resolvePolicy(deps.policy),
    // What the connected client said it is in `initialize` (undefined before that, or when it didn't say).
    clientName: () => server.server.getClientVersion()?.name,
    sessionId: () => sessionId,
    ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
  });
  if (deps.ingest) {
    registerIngestTools(server, {
      workspaceId: deps.workspaceId,
      liveCanvas: deps.liveCanvas,
      policy: () => resolvePolicy(deps.policy),
      clientName: () => server.server.getClientVersion()?.name,
      sessionId: () => sessionId,
      ingest: deps.ingest,
      ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
    });
  }
  let upsertMapSection: MapSectionWriter | undefined;
  if (deps.repoMap) {
    const options = deps.repoMap;
    upsertMapSection = registerRepoMapTools(server, {
      workspaceId: deps.workspaceId,
      services: options.services,
      canvases: deps.services.canvases,
      liveCanvas: deps.liveCanvas,
      host: options.host ?? getRepoMapHost,
      policy: () => resolvePolicy(deps.policy),
      clientName: () => sanitizeClientName(server.server.getClientVersion()?.name),
      ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
      ...(options.openTimeoutMs !== undefined ? { openTimeoutMs: options.openTimeoutMs } : {}),
    });
  }

  // Phase 7B: the Project-profile tools, their resources and prompts, and the setup artifact.
  const projectDeps = {
    workspaceId: deps.workspaceId,
    scan: new WorkspaceScan(deps.services, deps.workspaceId),
    liveCanvas: deps.liveCanvas,
    policy: () => resolvePolicy(deps.policy),
    clientName: () => server.server.getClientVersion()?.name,
    sessionId: () => sessionId,
    currentContext: deps.currentContext,
    ...(deps.agentState ? { agentState: deps.agentState } : {}),
    ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
    ...(upsertMapSection ? { upsertMapSection } : {}),
  };
  registerProjectTools(server, projectDeps);
  // Phase 7C: the core object tools (D50, D62), on the same change-set path.
  registerObjectTools(server, { workspaceId: deps.workspaceId, scan: projectDeps.scan, liveCanvas: deps.liveCanvas, policy: projectDeps.policy, clientName: projectDeps.clientName, sessionId: () => sessionId });
  // Lens Phase 3: the Lens tools and `acute://lens/{lensKey}`.
  registerLensTools(server, { ...projectDeps, lensFocus: deps.lensFocus ?? getLensFocusHost });
  registerLensResource(server, projectDeps);
  registerProjectResources(server, projectDeps, () => liveRegistry(server));
}

/** Every write tool name across the groups (left out of a read-only artifact, S3). */
export const ALL_WRITE_TOOLS: readonly string[] = [...WRITE_TOOL_NAMES, ...REPO_MAP_TOOL_NAMES.filter((t) => !(REPO_MAP_READ_TOOLS as readonly string[]).includes(t)), ...PROJECT_WRITE_TOOLS, ...OBJECT_WRITE_TOOLS, ...LENS_WRITE_TOOLS];

/**
 * What this server actually serves, for the setup artifact (S2): its registered tools and prompts (read from the SDK's
 * own registry, so the list can't drift from what is served) and its resource templates.
 */
export function liveRegistry(server: McpServer): SetupRegistry {
  const internals = server as unknown as { _registeredTools?: Record<string, { enabled?: boolean }>; _registeredPrompts?: Record<string, { enabled?: boolean }> };
  const names = (r?: Record<string, { enabled?: boolean }>) => Object.entries(r ?? {}).filter(([, v]) => v.enabled !== false).map(([k]) => k);
  return {
    tools: names(internals._registeredTools),
    writeTools: ALL_WRITE_TOOLS,
    prompts: names(internals._registeredPrompts),
    resources: ["acute://context/current", ...Object.values(PROJECT_RESOURCE_TEMPLATES), ...Object.values(URI_TEMPLATES), LENS_RESOURCE_TEMPLATE, SETUP_RESOURCE_TEMPLATE],
  };
}

