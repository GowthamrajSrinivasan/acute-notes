/**
 * Remote MCP tool profiles (2026-11-15, first real ChatGPT session): which tools a **remote** session (secret URL,
 * OAuth, a tunnel, the hosted app — anything `http.ts` doesn't prove local) may see and call.
 *
 * Remote availability is opt-in **by name**: a tool is served to a remote session only when its profile lists it here.
 * A newly registered tool (read or write) is therefore hidden and uncallable for remote sessions until someone reviews
 * it and adds it. Local sessions (a bearer token on this machine's loopback) are not filtered.
 *
 * Enforced twice: the relay (Node, `bridge/relay.ts`) refuses a `tools/call` for an unlisted name and filters
 * `tools/list`; the tab's server (`server.ts`) never registers an unlisted tool, so nothing can run it.
 *
 * Profiles:
 * - `restricted` (the default, and what any unknown value means): read tools, plus write proposals whose every change
 *   kind is a create, a position-only move, a membership change, or an `update_block` with its Accept-time baseline
 *   check. Nothing that removes, restores, or overwrites without a baseline; nothing that writes without review.
 *   Reasons per tool: `.ai/docs/mcp-remote-profile-2026-11-15.md` (audit: `mcp-write-surface-audit-2026-11-15.md`).
 * - `full`: every tool remote sessions could reach before this gate, except `REMOTE_EXCLUDED_TOOLS`. Only behind the explicit server-side setting
 *   `MCP_REMOTE_PROFILE=full`, for the full gate to control later.
 *
 * Pure (no imports): loaded by both the relay and the tab.
 */

export type RemoteProfile = "restricted" | "full";

export const DEFAULT_REMOTE_PROFILE: RemoteProfile = "restricted";

/** Read-only tools served to every remote profile. */
export const REMOTE_READ_TOOLS = [
  "search_workspace",
  "get_canvas",
  "get_page",
  "get_selected_content",
  "get_related_objects",
  "suggest_placement",
  "get_consistency",
  "list_blocks",
  "get_block",
  "get_project",
  "list_projects",
  "get_decisions",
  "get_open_questions",
  "get_implementation_plan",
  "get_session_context",
  "get_recent_changes",
  "get_session_history",
  "get_session_review",
  "get_lens_impact",
  "get_lens",
  "trace_lens_path",
  "focus_lens",
] as const;

/** Audited write proposals allowed in `restricted`: review flow only, and no un-baselined overwrite or removal. */
export const RESTRICTED_WRITE_TOOLS = [
  "create_block",
  "create_page",
  "create_table",
  "create_todo",
  "create_connection",
  "render_visual_plan",
  "move_object",
  "update_block",
  "group_blocks",
  "create_project",
  "log_finding",
  "annotate",
] as const;

/** Remote-reachable before this gate but excluded from `restricted` (served only under `full`). */
export const FULL_ONLY_WRITE_TOOLS = [
  "delete_object",
  "delete_connection",
  "revert_agent_changes",
  "update_connection",
  "update_knowledge",
  "update_progress",
  "record_decision",
  "sync_session",
  "link_lens_detail",
] as const;

/**
 * Served locally but to no remote profile yet. `get_weak_concepts` (Study Mode, read-only): the user's condition is that
 * it goes remote only once workspace authorization and retired-history filtering are verified through the remote auth
 * path and the HTTP exposure filter.
 */
export const REMOTE_EXCLUDED_TOOLS = ["get_weak_concepts"] as const;

export const REMOTE_PROFILE_TOOLS: Record<RemoteProfile, readonly string[]> = {
  restricted: [...REMOTE_READ_TOOLS, ...RESTRICTED_WRITE_TOOLS],
  full: [...REMOTE_READ_TOOLS, ...RESTRICTED_WRITE_TOOLS, ...FULL_ONLY_WRITE_TOOLS],
};

const SETS: Record<RemoteProfile, ReadonlySet<string>> = {
  restricted: new Set(REMOTE_PROFILE_TOOLS.restricted),
  full: new Set(REMOTE_PROFILE_TOOLS.full),
};

/** `full` only when the setting says exactly that; anything else (unset, empty, a typo) is `restricted`. */
export function resolveRemoteProfile(value: unknown): RemoteProfile {
  return typeof value === "string" && value.trim().toLowerCase() === "full" ? "full" : DEFAULT_REMOTE_PROFILE;
}

/** Whether a remote session under `profile` may see and call `tool`. An unknown profile value counts as `restricted`. */
export function remoteToolAllowed(profile: unknown, tool: string): boolean {
  return SETS[resolveRemoteProfile(profile)].has(tool);
}

/** Whether a session (remote or not) may see and call `tool`. Local sessions are not filtered. */
export function sessionToolAllowed(session: { remote: boolean; profile?: unknown }, tool: string): boolean {
  return !session.remote || remoteToolAllowed(session.profile, tool);
}

/** The refusal message for a tool a remote session may not use (it names neither credentials nor the setting's value). */
export function remoteToolRefusal(tool: string): string {
  return `Tool ${tool} is not available to remote MCP sessions.`;
}
