/**
 * The `map_repo` MCP prompt (F43, §13.13): the playbook an IDE agent follows
 * to build and maintain a repo map, so maps come out the same from any
 * client. Deterministic text; the only inputs are the repo's display name
 * and an optional focus.
 */
import { REPO_MAP_LIMITS } from "./schema";

export function mapRepoPrompt(args: { repo?: string; focus?: string }): string {
  const repo = args.repo?.trim() || "this repository";
  const L = REPO_MAP_LIMITS;
  return [
    `Build (or refresh) a visual map of ${repo} on an Acute-Notes canvas. You do all the reading and understanding; Acute-Notes only validates, lays out and renders what you send, and the user reviews it.`,
    args.focus?.trim() ? `Focus on: ${args.focus.trim()}.` : "",
    "",
    "Steps:",
    `1. List the repository tree (your own tools; Acute-Notes never reads files). Pick modules of roughly 5–40 files each — usually one directory. At most ${L.sectionsPerMap} modules and ${L.nodesPerMap} cards in total; if the repo is bigger, map at a coarser level.`,
    `2. Call begin_repo_map with repo "${repo}" and the current commit (e.g. \`git rev-parse --short HEAD\`). It returns the mapId and what is already mapped.`,
    "3. Call get_map_status with the commit and, if the map exists, changedPaths from `git diff --name-only <mapped commit>..HEAD`. Only modules that are new, or that contain a stale key, need work.",
    `4. Map in levels, overview first, so no screen gets crowded. Each call may hold at most ${L.primaryCardsPerCall} primary cards (detail cards linked explained_by from one of them don't count); there is no limit on the map as a whole.`,
    `   - First the overview: one section (key mod:overview, label "Overview") with one card per major component or module — at most ${L.primaryCardsPerCall} — grouped by what they do (stage, lifecycle, trust boundary), not by folder. Link the one obvious main path with flows_to, and only the few other links that matter. Remove low-value links before adding more.`,
    "   - Then each module as a child: upsert_map_section with section.parent set to the overview card it details. It is placed under the overview and linked from that card. A module too big for one call becomes its own children the same way (parent = one of its cards).",
    `5. For each module section: read it, then call upsert_map_section once with one section (key mod:<dir>, a short label, arrangement tree/grid/chain/stack). Card keys: file:<path> for a file, sym:<path>#<name> for a symbol — the same key every time, so re-sending updates in place and never duplicates. Put source.path (repo-relative) and source.lines on each card.`,
    `   - Write short card text: one concise concept per card (title + one or two sentences). Put detail in separate cards linked with an explained_by relationship, not in the concept. At most ${L.textPerNode} characters per card; code cards at most ${L.codeLines} lines — prefer prose.`,
    "   - Relationships use keys: depends_on, references, implements, flows_to, supports, relates_to, explained_by, … . A key in a module you haven't sent yet is fine: the link waits and is drawn when that key arrives.",
    "   - Link across modules at the overview level (overview card to overview card). Link detailed cards in different modules only when that specific link is the point; each such link crosses the canvas.",
    "   - Never put secret values, credentials, tokens, private keys, connection strings or .env contents in a card — describe them instead (\"reads the API key from the environment\"). Calls that look like they contain one are rejected.",
    "   - Each result has `layout`: issues with a code, subject (map keys), evidence and fixes. Repair what it reports by re-sending the section: a link through a card (link_through_card) always; crossings, overlapping links and labels when you can. Prefer dropping low-value links, then reordering or splitting the section. Stop after two re-sends that don't lower `layout.score`.",
    "   - Lens levels: give each section its `level` — 1 the overview, 2 a module's components, 3 a flow through one handler (its steps, in order), 4 an operation (its functions, each with source.lines). A section with a parent defaults to one level below it.",
    "   - Give cards a `kind` when it is clear: frontend, backend, database, cloud, security, messagebus, external for components; endpoint, step, function, event, store for flow and operation levels.",
    "   - Relationship types for code: calls, reads, writes, publishes, subscribes, contains, as well as depends_on, flows_to, explained_by, … .",
    "   - At level 4, a function card with source.lines can be opened as source in Lens (L5). A `code` card (at most 40 lines) with the same source.path shows that code there.",
    "6. Add the remaining cross-module links with link_map_nodes once you know them.",
    "7. Call get_map_status again. `corrections` lists cards the user edited, deleted or opted out of: respect them — adopt the user's text, don't re-send deleted cards. `pendingEdges` are links whose other end you haven't sent.",
    "",
    "Each call's result says what happened: staged (waiting for the user's review in Acute-Notes), applied (the user switched on auto-accept), unchanged, or rejected (with the reason and the limit to fix — split the section or shorten cards and retry; nothing was written). Never assume a change was applied unless the result says so.",
    "To remove cards or a whole module that no longer exists, call remove_map_nodes with their keys (always reviewed by the user).",
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
}

/**
 * The `tidy_map` MCP prompt (Wave 1b item 1b): make an existing map easier to read without regenerating it —
 * structure only, never card text, measured by the layout checks.
 */
export function tidyMapPrompt(args: { repo?: string }): string {
  const repo = args.repo?.trim() || "this repository";
  return [
    `Tidy the repo map of ${repo} on the Acute-Notes canvas so it is easier to read. Change structure only: never rewrite, add or remove cards' text — that is what upsert_map_section is for.`,
    "",
    "Steps:",
    `1. Call get_map_status with mapId "${repo}" and layout: true. layout.issues lists what makes the map hard to read, by key: links through cards (fatal), crossings, links running together or along a section border, overlapping labels.`,
    "2. Pick the sections with the most issues (the keys in each issue's subject tell you which). For each, call tidy_map_section once:",
    "   - order: the section's cards with its main path first, so linked cards become neighbours;",
    "   - dropLinks: links that add little — duplicates of a path already shown, links to everything from one hub, detail links better shown at the overview level. Only links the map drew can be dropped;",
    "   - parent: when a section sits under the wrong overview card, or should be top-level (null).",
    "3. Read the result's layout: `improved` compares the section before and after. If it isn't cleaner, try once more with another order or fewer links; stop after two tries that don't lower the score — the user can reject a tidy.",
    "4. Call get_map_status with layout: true again and report what changed. Everything is staged for the user's review; nothing is applied until they accept it.",
    "",
    "Cards the user moved or locked stay where they are, and nothing the map didn't draw is ever touched.",
  ].join("\n");
}

/**
 * The `expand_lens_node` MCP prompt (Lens Phase 2, plan §7.2): read the code behind one card and send its next level
 * as a child section — the step Lens's "Ask your IDE agent" asks for.
 */
export function expandLensNodePrompt(args: { key?: string; repo?: string }): string {
  const key = args.key?.trim() || "<the card's key>";
  const repo = args.repo?.trim() || "this repository";
  return [
    `Expand the card ${key} of the repo map of ${repo} one level down in Lens. Do not modify any code.`,
    `1. Call get_map_status (mapId "${repo}") to find the card's section and its level.`,
    `2. Read the code the card describes (its source.path; your own tools — Acute-Notes never reads files).`,
    `3. Call upsert_map_section once with a new section: key derived from the card (e.g. ${key}:detail), section.parent "${key}", section.level one more than the card's section, a short label.`,
    "   - Level 2: the module's components. Level 3: the steps of one flow, in order (kind step or endpoint, linked flows_to). Level 4: the functions doing the work (kind function), each with source.path and source.lines.",
    "   - Keep each card one short concept; reuse the same keys if this level already exists, so it updates in place.",
    "4. The section is staged for the user's review. Never assume it was applied unless the result says so.",
  ].join("\n");
}

/**
 * The `keep_lens_current` MCP prompt (Agent Sync, Lens plan §8): after each batch of edits, ask which cards cite the
 * changed files, re-read those and their ancestors, and re-send only the sections whose meaning changed — by the same
 * keys, so they update in place. Acute never watches files; the agent keeps the map current.
 */
export function keepLensCurrentPrompt(args: { repo?: string }): string {
  const repo = args.repo?.trim() || "this repository";
  return [
    `Keep the Acute-Notes map of ${repo} current while you work (Agent Sync). Do this after each batch of code edits, not after every keystroke.`,
    `1. Call get_map_status (mapId "${repo}") with changedFiles: [{ path, lines: [[first, last], ...] }] for the repo-relative files you changed, the line ranges from \`git diff -U0\` (or just changedPaths when you lack ranges; Acute-Notes never runs git or reads files). Cards citing other lines of the file stay fresh.`,
    "2. `stale` lists the cards citing those files; `affectedAncestors` lists the cards above them, level by level. Re-read the code behind each stale card; for each ancestor, decide whether its meaning changed — usually it didn't.",
    "3. Re-send only the sections holding cards whose meaning changed, one upsert_map_section call per section, with the same section and card keys (a key with a new label, source or links updates that card in place; never delete and re-add). Give the new commit.",
    "4. A card gone from the code: remove_map_nodes (the user reviews every removal). Leave everything else alone; never resend the whole map.",
    "5. Everything is staged for the user's review in Lens and on the canvas. Never assume it was applied unless the result says so.",
  ].join("\n");
}
