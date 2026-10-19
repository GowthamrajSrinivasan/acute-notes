import { describe, expect, it } from "vitest";
import { buildSetupInstructions, SETUP_CLIENTS, SETUP_FENCE, SETUP_LIMITS, SetupInstructionsError, setupPromptText, type SetupRegistry } from "./instructions";

const READS = ["search_workspace", "get_canvas", "get_page", "get_selected_content", "get_related_objects", "get_map_status", "get_project", "list_projects", "get_decisions", "get_open_questions", "get_implementation_plan", "get_session_context", "get_recent_changes", "get_session_history", "get_session_review", "get_lens_impact"];
const WRITES = ["create_block", "create_page", "create_table", "create_todo", "create_connection", "move_object", "update_block", "render_visual_plan", "delete_object", "begin_repo_map", "upsert_map_section", "link_map_nodes", "remove_map_nodes", "tidy_map_section", "create_project", "record_decision", "log_finding", "update_knowledge", "annotate", "update_progress", "sync_session", "revert_agent_changes"];
const registry: SetupRegistry = {
  tools: [...READS, ...WRITES],
  writeTools: WRITES,
  prompts: ["map_repo", "initialize_project", "update_architecture", "sync_progress", "document_decision", "setup_project_instructions"],
  resources: ["acute://context/current", "acute://project/{projectKey}", "acute://workspace/{workspaceId}", "acute://setup/instructions/{client}"],
};

/** Backticked identifiers in the text that look like tool or prompt names (snake_case). */
const namesIn = (content: string) => [...content.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!);

describe("setup artifact (MC11, setup plan §A4)", () => {
  for (const client of SETUP_CLIENTS) {
    for (const writesAllowed of [true, false]) {
      it(`${client}, writes ${writesAllowed ? "on" : "off"}: (a)–(f), only served names, fenced, within budget`, () => {
        const a = buildSetupInstructions(client, { registry, writesAllowed });
        const c = a.content;
        // (a) what it is and when to use it.
        expect(c).toMatch(/### What it is\n\S/);
        expect(c).toMatch(/### When to use it\n\S/);
        // (b) only names this server serves (and, with writes off, no write tool at all).
        // Payload fields the text explains are snake_case too; they are not tools.
        const served = new Set([...registry.tools.filter((t) => writesAllowed || !WRITES.includes(t)), ...registry.prompts, "retrieval_mode"]);
        for (const n of namesIn(c)) expect(served.has(n) || ["get_session_context"].includes(n), `${n} in ${client}`).toBe(true);
        if (!writesAllowed) for (const w of WRITES) expect(c, w).not.toContain(`\`${w}\``);
        // (c) initialisation and when to sync.
        expect(c.split("### Start of a session")[1]).toContain("`get_session_context`");
        if (writesAllowed) expect(c.split("### End of a session")[1]).toContain("`sync_session`");
        // (d) what to persist.
        if (writesAllowed) for (const t of ["record_decision", "log_finding", "update_progress", "update_knowledge", "upsert_map_section"]) expect(c.split("### What to record")[1]).toContain(`\`${t}\``);
        // (e) code wins.
        expect(c).toMatch(/### When Acute and the code disagree\n[\s\S]*source of truth/);
        // (f) no fabrication.
        expect(c).toContain("### Never fabricate project state");
        // Fence, budget, target.
        expect(c.indexOf(SETUP_FENCE.start)).toBeGreaterThanOrEqual(0);
        expect(c.trimEnd().endsWith(SETUP_FENCE.end)).toBe(true);
        expect(c.length).toBeLessThanOrEqual(SETUP_LIMITS.chars);
        expect(a.targetPath).toBe({ claude: "CLAUDE.md", codex: "AGENTS.md", cursor: ".cursor/rules/acute-notes.mdc" }[client]);
      });
    }
  }

  it("Cursor's rule carries its frontmatter ahead of the fence; Claude names the tool prefix", () => {
    const cursor = buildSetupInstructions("cursor", { registry, writesAllowed: true }).content;
    expect(cursor.startsWith('---\ndescription: "Acute Notes project memory: when and how to read and record it"\nalwaysApply: true\n---\n<!-- acute-notes:start -->')).toBe(true);
    expect(buildSetupInstructions("claude", { registry, writesAllowed: true }).content).toContain("`mcp__acute-notes__get_session_context`");
  });

  it("a placeholder naming something the server doesn't serve fails generation (S2)", () => {
    expect(() => buildSetupInstructions("codex", { registry: { ...registry, tools: registry.tools.filter((t) => t !== "record_decision") }, writesAllowed: true })).toThrow(SetupInstructionsError);
  });

  it("an optional tool group the server doesn't serve is left out instead of failing (the repo-map tools)", () => {
    const c = buildSetupInstructions("codex", { registry: { ...registry, tools: registry.tools.filter((t) => t !== "upsert_map_section") }, writesAllowed: true }).content;
    expect(c).not.toContain("upsert_map_section");
  });

  it("the project's style adds its one level-convention line", () => {
    expect(buildSetupInstructions("claude", { registry, writesAllowed: true, style: "service" }).content).toContain("L1 = services");
  });

  it("the setup prompt names the target file and the fence rule", () => {
    const t = setupPromptText("codex");
    expect(t).toContain("AGENTS.md");
    expect(t).toContain("replace only what is between the markers");
    expect(t).toContain("acute://setup/instructions/codex");
  });
});
