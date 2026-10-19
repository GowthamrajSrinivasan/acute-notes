# Content ingest service (shared by Visualize and MCP)

One entry point turns new text into a reviewable change set on the open canvas, with the same outline, plan, analysis, merge and update pipeline, the same decision model (Jev) for filing passages under existing topics, repeats left out and nothing removed or restated.

- `src/ai/ingest/ingest.ts`: `ingestContent({ mode: "new" | "update" | "merge", ... }, ports, options)`, `prepareProposal` (splits a large result into reviewable sections), `sourceInput`, `sceneSourceObjects`, `withEconomy`, `SourceUnavailableError`. Ports: AI runtime, content-source store, render context, one source's objects on the canvas. No React, Excalidraw or review UI.
- `src/ai/ingest/sharedChats.ts`: `importSharedChats(links, { skip })` reads ChatGPT share links through `/api/import/chat-share`, applies the branch skip and composes the Markdown. Uses only the public functions of `import/chatShare` (not changed).
- `src/ai/ingest/targets.ts`: `findMergeTargets` (moved from `components/ai/mergeTargets.ts`, which re-exports it).
- Callers: `VisualizeDialog` (thin: builds the ports from the live scene, calls the service, proposes to the review bar), `SharedChatsPanel` (uses `fetchTranscript`), and the MCP tools below.

## MCP tools (`src/mcp/tools/ingestTools.ts`)

- `find_import_targets` (read): notes on the open canvas that content can be merged into or updated.
- `import_content`: `text` or `shareLinks`, `mode` (merge | update | new), `targetSourceId`, `economy` (default on for merge), `confirm`.

Guards, because an import spends the user's AI credit: off for every workspace until ⋮ → MCP access → "Allow AI imports" (`src/state/mcpIngest.ts`, per device); served to local sessions only (never a remote session); without `confirm: true` it only previews (what would run, a rough cost, no AI); the result is a proposal only and `import_content` is not in the auto-accept set; refused while another proposal is under review or the workspace is read-only.

Wiring: `McpBridgeHost` passes `ingest: { runtime: AIRuntime, contentSources, allowed }` to `createAcuteMcpServer`; `registerAcuteTools` serves the tools only when it is given.

Not done: the agent setup instructions (`mcp/setup/instructions.ts`, approved core text) do not list the import tools; a long import may exceed an MCP client's request timeout (no progress notifications yet); the MCP client's cost estimate is a rough guide from one measured workload.

## Updating notes from ChatGPT chats, from the AI chat (2026-10-11)

- The AI chat panel (✨ Ask AI) lists **Update from ChatGPT chats** when the selection belongs to a content source. It opens the Visualize dialog on "Merge into existing notes" with those notes chosen and the "From shared chats" panel open (`OpenVisualizeOptions.mergeSourceId`). Paste the share links of the chat and its branches, then Merge. Conflicts are never applied: each is a "Needs your call" choice on the canvas (both versions kept, once each) until the user picks an option; `IngestResult.choices` and the MCP result's `needsYourCall` name them.
- **Fix found by the tests** (`merge/compose.ts: repeatOf`): a passage that differs from one in the notes only by a number (12 dollars to 15 dollars) was treated as a repeat and left out, so the change was lost without a conflict. A number, version or identifier the topic does not carry now makes it not a repeat, so the decision model sees both statements. Regression tests in `compose.test.ts`.
- **End-to-end tests** (`ingest/chatUpdate.test.ts`, small 3 topics, medium 20, large 80 topics, with a branch that adds, extends and contradicts): nothing earlier is lost (in the notes and on the canvas), nothing removed, repeats once, new facts once, new subjects as sections, contradictions as choices, the decision model (a deterministic stand-in for Jev) answers every assignment, and importing the same chats again adds nothing twice.
- The four known limits of this flow and what was done about each: `.ai/docs/chat-update-limits-plan.md` (conflicts deep in long topics, the stand-in model, UI tests, quoted questions).
