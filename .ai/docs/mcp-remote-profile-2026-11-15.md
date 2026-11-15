# Remote MCP tool profile — 2026-11-15

User-approved (2026-11-15): a restricted remote MCP profile for the first real ChatGPT session. Basis: the write-surface
audit, `.ai/docs/mcp-write-surface-audit-2026-11-15.md` (cited as "audit A1…A16, B, §3, §4").

## Rules

- **Who is remote:** any session `src/mcp/bridge/http.ts` does not prove local (not a bearer token, not a loopback
  Host, or forwarding headers present). Local sessions are unchanged: every tool, as before.
- **Opt-in by name.** A remote session sees and can call a tool only if its profile lists it
  (`src/mcp/tools/remoteProfile.ts`). A new tool, read or write, is hidden and uncallable remotely until it is reviewed
  and added. Nothing is inferred from annotations or tool groups.
- **Profiles:** `restricted` is the default. `full` only with the server-side setting `MCP_REMOTE_PROFILE=full`
  (case-insensitive). Unset, empty or any other value means `restricted`. `full` is for the later full gate to control.
- **Principle for `restricted` writes:** every change kind the tool can produce is a create, a position-only `move`,
  a frame-membership change (`group_objects`, `update_frame{add}`), or an `update_block` with its Accept-time baseline
  check. Anything that removes, restores, or overwrites fields or text without a baseline is excluded. Anything that
  writes without review is excluded.
- **Review flow unchanged.** Every allowed write still only proposes. The user accepts or rejects in the review, and
  remote sessions never auto-accept (audit §0).

## Enforcement (discovery and invocation, at two layers)

1. **Relay (Node, the HTTP server):** `src/mcp/bridge/relay.ts`, in `fromClient`. A remote `tools/call` naming a
   tool outside the profile gets the JSON-RPC error `-32602 "Tool <name> is not available to remote MCP sessions."`.
   The tab never sees it. A remote `tools/list` reply is filtered to the profile (`listedForProfile`). The profile is
   fixed when the session opens (`initialize`). The relay sends it to the tab on every frame (`messageFrame`). Local
   frames are unchanged.
2. **Tab server (where tools execute):** `src/mcp/server.ts` (`restrictToProfile`). For a remote session, every tool
   registered outside the profile is removed at once. So it is not listed, and a call fails as
   `MCP error -32602: Tool <name> not found` without running. The same filter applies to
   `acute://context/current.availableTools`. For restricted sessions, the server instructions no longer point the
   model at excluded tools.
3. **Profile selection:** `src/mcp/bridge/http.ts` reads `MCP_REMOTE_PROFILE` through `resolveRemoteProfile`.
   `protocol.ts`, `tabBridge.ts` and `McpBridgeHost.tsx` pass it through. A remote frame without a profile counts as
   `restricted`.

## Exact remote inventory

The tool counts do not include repo-map or ingest tools, which are never served remotely (audit §0). R = read,
W = write proposal. "dH" is `destructiveHint`.

### Allowed in `restricted` (34)

| Tool | R/W | dH | Why allowed | Audit |
|---|---|---|---|---|
| search_workspace, get_canvas, get_page, get_selected_content, get_related_objects, suggest_placement, get_consistency | R | false | Read-only, bounded, this workspace only | "Registered tools" |
| list_blocks, get_block | R | false | Read-only | "Registered tools" |
| get_project, list_projects, get_decisions, get_open_questions, get_implementation_plan, get_session_context, get_recent_changes, get_session_history, get_session_review, get_lens_impact | R | false | Read-only (the reads go through `ResourceReader`/`WorkspaceScan`) | "Registered tools" |
| get_lens, trace_lens_path | R | false | Read-only | "Registered tools" |
| focus_lens | R | false | No data written. The only effect is opening the Lens panel in the user's tab | "Registered tools", §3 |
| create_block, create_page, create_table, create_todo, create_connection | W | false | Creates only, through review. Reflow `move`s are position-only | B, A6 (Low) |
| render_visual_plan | W | false | Same create path, plus reflow moves | B, A6 (Low) |
| move_object | W | false | Position only. Content is untouched | A5 (Low) |
| update_block | W | **true** | Accept-time baseline (`expectedFingerprint`) with a Keep mine / Use proposed conflict. A stale target is never overwritten | A1 (Low, "Done") |
| group_blocks | W | false | Creates a frame and changes only membership. Content is preserved, and dead members are skipped at Accept | A10 (Low) |
| create_project | W | false | Creates only (template nodes and a frame). Refuses an existing name | B |
| log_finding | W | false | Creates a node plus `update_frame{add}`. No direct write | A11, B, §3 |
| annotate | W | false | `create_shape` + `connect` + `update_frame{add}`. No `update_node` | A8 correction, A11 |

### Excluded from `restricted` (served only under `full`)

| Tool | R/W | dH | Why excluded | Audit |
|---|---|---|---|---|
| delete_object | W | true | `remove` has no baseline. It deletes blocks the user edited during review, and an empty section frame with them | A2 (High), §4.2 |
| delete_connection | W | true | `remove` has no baseline, so a label edited during review is lost | A3 (Medium) |
| revert_agent_changes | W | true | `restore`/`remove` are checked at proposal time only and by version only. They overwrite or delete in-place edits | A4 (High), §4.1 |
| update_connection | W | true | Overwrites the label or explanation without a baseline. `null` clears it | A7 (Low–Medium) |
| update_knowledge | W | true | `update_node` field patch with no baseline. It can supersede constraints | A8 (Medium) |
| update_progress | W | false | `update_node` status patches with no baseline | A8 (Medium) |
| record_decision | W | false | Mostly creates, but `supersedes` emits an `update_node` status change with no baseline. That drives later agents' warnings | A8 (Medium) |
| sync_session | W | false | **Direct, unreviewed write** of the session record (summary, next). It is read back by the next session. It also emits `update_node` | §3, A8 |
| link_lens_detail | W | false | `set_lens` overwrites drill links without a baseline (metadata). Excluded out of caution | A9 (Low) |

### Excluded from every remote profile

| Tool | R/W | dH | Why | Ref |
|---|---|---|---|---|
| get_weak_concepts | R | false | **Excluded pending remote verification (user condition):** it goes remote only after workspace authorization and retired-history filtering are verified through the remote auth path and the HTTP exposure filter. The exclusion is enforced in `remoteProfile.ts` (`REMOTE_EXCLUDED_TOOLS`); `studyTools.ts` and `readTools.ts` are untouched | Integrator instruction 2026-11-15 |
| begin_repo_map, upsert_map_section, link_map_nodes, get_map_status, remove_map_nodes, tidy_map_section, find_import_targets, import_content | R/W | — | Never registered for remote sessions (`server.ts`), and not in any profile | audit §0 |

## destructiveHint changes (all sessions)

The old comment in `common.ts` said write tools "never delete or overwrite", which was false (audit §4.8). Write tools
that, once accepted, can remove, restore or replace existing content now use `DESTRUCTIVE_ANNOTATIONS`
(`destructiveHint: true`): `delete_object`, `delete_connection` (both already did), plus `revert_agent_changes`,
`update_block`, `update_connection` and `update_knowledge`. Position, membership and status-like changes keep
`destructiveHint: false`: `move_object`, `group_blocks`, `update_progress`, `record_decision`, `sync_session` and
`link_lens_detail`. In `restricted`, the only advertised destructive tool is `update_block`, which is baseline-checked.

## Known limits

- Prompts (`sync_progress`, the decision prompt, the onboarding text in `projectResources.ts`) still mention excluded
  tools for remote sessions. Calling those tools fails as described above. The prompts were not changed.
- Per-tool usage counters (`recordUsage`) still run for every remote call. They are metadata, not an MCP tool, and
  are written by the tab (audit §3).
- The relay keeps its relays on `globalThis`, so a running `next dev` keeps using relay objects created before this
  change until the server restarts. Until then, only the tab layer enforces (e2e run of 2026-11-15:
  `MCP error -32602: Tool delete_object not found`). After a restart, the relay refuses first.
