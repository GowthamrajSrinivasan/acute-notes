import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analysisUnits } from "@/ai/reconcile/units";
import { parseContent } from "./parser";
import type { ParsedBlock } from "./types";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fidelity", "__fixtures__", name), "utf8");
const kinds = (blocks: readonly ParsedBlock[]) => blocks.map((b) => (b.type === "heading" ? `h${b.level}:${b.text}` : b.type));

describe("structure recovery — bold-line titles", () => {
  it("a bold-only line above content becomes a heading, keeping a short trailing note", async () => {
    const text = "Intro.\n\n**Tests before the hand-off**\n- build passes\n\n**Branches** (new worktrees)\n- cmg-code\n";
    const parsed = await parseContent(text);
    expect(kinds(parsed.blocks)).toEqual(["paragraph", "h2:Tests before the hand-off", "list", "h2:Branches (new worktrees)", "list"]);
    for (const b of parsed.blocks) expect(text.slice(b.span.start, b.span.end).length).toBeGreaterThan(0);
  });

  it("a labelled sentence, a bold word in prose, or a bold line at the very end stays a paragraph", async () => {
    const parsed = await parseContent("**Status tracker:** no rows changed.\n\nThis is **very** important.\n\n**Done.**\n\n**Trailing**\n");
    expect(kinds(parsed.blocks)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph"]);
  });

  it("a bold title under a real heading sits one level below it", async () => {
    const parsed = await parseContent("## Results\n\n**Tests**\n\n- ok\n");
    expect(kinds(parsed.blocks)).toEqual(["h2:Results", "h3:Tests", "list"]);
  });
});

describe("structure recovery — tab-separated tables and plain titles", () => {
  it("consecutive tab-separated lines become a table, with the title line above it as its heading", async () => {
    const text = "Notes first.\nOther knobs\nKnob\tPurpose\tWhere\nPosture\tsets the mode\tindex.ts\nAudit log\tone file per session\n";
    const parsed = await parseContent(text);
    expect(kinds(parsed.blocks)).toEqual(["paragraph", "h2:Other knobs", "table"]);
    const table = parsed.blocks[2] as Extract<ParsedBlock, { type: "table" }>;
    expect(table.columns).toEqual(["Knob", "Purpose", "Where"]);
    expect(table.rows).toEqual([
      ["Posture", "sets the mode", "index.ts"],
      ["Audit log", "one file per session", ""],
    ]);
  });

  it("in a heading-less document, a short title above hard-broken long lines becomes a heading", async () => {
    const long = "One row per check. Where a check can fail more than one way, the ways are lettered and the outcome column uses the same letters.";
    const parsed = await parseContent(`Cheat sheet\n${long}\n\nPass / fail examples\n${long}\n`);
    expect(kinds(parsed.blocks)).toEqual(["h1:Cheat sheet", "paragraph", "h2:Pass / fail examples", "paragraph"]);
  });

  it("never touches soft-wrapped prose or a document with its own headings", async () => {
    const wrapped = "A short opening line\nthat is simply wrapped by the editor at a narrow width\nand goes on here.";
    expect(kinds((await parseContent(wrapped)).blocks)).toEqual(["paragraph"]);
    const withHeadings = `# Doc\n\nTitle-like line\n${"x ".repeat(80)}\n`;
    expect(kinds((await parseContent(withHeadings)).blocks)).toEqual(["h1:Doc", "paragraph"]);
  });
});

describe("structure recovery — a copied table with a row-label column (Wave A)", () => {
  const rows = ["D1\tDraft 03's checklist\tReplace it with the gate", "D2\tChanging the skill\tCall the merge v3 and keep Draft 03 frozen."];
  const expected = {
    columns: ["", "Decision", "My proposal"],
    rows: [
      ["D1", "Draft 03's checklist", "Replace it with the gate"],
      ["D2", "Changing the skill", "Call the merge v3 and keep Draft 03 frozen."],
    ],
  };
  const tableOf = (blocks: readonly ParsedBlock[]) => blocks.find((b): b is Extract<ParsedBlock, { type: "table" }> => b.type === "table");

  it("a header that starts with a tab (an empty corner cell) is joined back to its rows, not read as code", async () => {
    const text = ["Intro sentence of the reply.", "", "\tDecision\tMy proposal", ...rows, "", "Closing line."].join("\n");
    const parsed = await parseContent(text);
    expect(kinds(parsed.blocks)).toEqual(["paragraph", "table", "paragraph"]);
    expect(tableOf(parsed.blocks)).toMatchObject(expected);
  });

  it("a header one cell short of every row gets an empty first column, so each proposal stays in its own column", async () => {
    const text = ["Intro sentence of the reply.", "", "Decision\tMy proposal", ...rows].join("\n");
    const parsed = await parseContent(text);
    expect(tableOf(parsed.blocks)).toMatchObject(expected);
  });

  it("a real indented code block with tabs is left alone", async () => {
    const text = "Intro.\n\n    make\tbuild\n\nAfter it.\n";
    const parsed = await parseContent(text);
    expect(kinds(parsed.blocks)).toEqual(["paragraph", "code", "paragraph"]);
  });
});

describe("structure recovery — the sample documents (content fidelity fixtures)", () => {
  it("the cmg-verify cheat sheet splits into its sections, with its seven tables recovered", async () => {
    const text = fixture("cmg-verify-cheatsheet.txt");
    const parsed = await parseContent(text);
    expect(parsed.blocks.filter((b) => b.type === "table")).toHaveLength(7);
    const units = analysisUnits(parsed, text).map((u) => u.key.split(" › ").at(-1));
    expect(units).toEqual([
      "cmg-verify cheat sheet — SR3 deterministic checks",
      "Pass / fail examples per check",
      "Checks 0–7",
      "Hook points (the deterministic layer around the model)",
      "A1–A6 codes (what happens when a check fires)",
      "The engineer file (YAML)",
      "submit_answer outcomes",
      "Other knobs",
    ]);
    const passFail = parsed.blocks.find((b) => b.type === "table") as Extract<ParsedBlock, { type: "table" }>;
    expect(passFail.columns).toHaveLength(5);
    expect(passFail.rows).toHaveLength(10);
  });

  it("the hand-off note splits at its bold section titles", async () => {
    const text = fixture("handoff-status.md");
    const units = analysisUnits(await parseContent(text), text).map((u) => u.key);
    expect(units).toEqual([
      "(lead)",
      "Tests before the hand-off",
      "Branches and worktrees (new worktrees, so your existing checkouts are untouched)",
      "What's built",
      "Things that differ from the plan or need a decision",
    ]);
  });
});
