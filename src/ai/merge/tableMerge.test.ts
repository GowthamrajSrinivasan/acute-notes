/**
 * U2 (update engine plan §17.7): tables and lists in new content update the notes in place. A table about a table the topic already
 * holds is merged into it row by row (one table, changed cells replaced, repeats left out, new rows added to it); a list item that
 * revises one replaces it, a new one joins the same list. Deterministic: no model is asked about rows.
 */
import { describe, expect, it } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import { analysisUnits } from "@/ai/reconcile/units";
import { accepted, context, firstRun, modelReply, parse, runtimeWith } from "@/testUtils/reconcileHarness";
import { composeMerged } from "./compose";
import { mergeIntoSource } from "./merge";
import type { StatementPlan } from "./statementMatch";
import { mergeTables, parseTable, rowCells, tablesIn, tableText } from "./tableMerge";

const NOTES = `# Gateway

## Limits

The gateway enforces these limits per client.

| Setting | Value | Notes |
| --- | --- | --- |
| Timeout | 30 s | per call |
| Retries | 5 | on 5xx only |
| Sessions | 4 | concurrent |

## Owners

The payments team owns the gateway.
`;

const ONE_TABLE = (text: string) => text.match(/^\| Setting/gm)?.length ?? 0;

async function compose(notes: string, incoming: string, revise?: Map<string, StatementPlan[]>) {
  const { parsed } = await analyzeContent(notes);
  const { parsed: incomingParsed } = await analyzeContent(incoming);
  const units = analysisUnits(parsed, notes);
  const parts = analysisUnits(incomingParsed, incoming);
  const limits = units.find((u) => u.text.includes("| Setting") || u.key.includes("Limits") || u.text.includes("- "))!;
  return composeMerged({ text: notes, parsed, units, incoming, incomingParsed, parts, assignment: new Map(parts.map((p) => [p.key, limits.key] as const)), ...(revise ? { revise: new Map([...revise].map(([, v]) => [parts[0]!.key, v] as const)) } : {}) });
}

describe("tableMerge — rows by key", () => {
  it("parses a table, splits cells on unescaped pipes only, and finds tables outside code fences", () => {
    expect(rowCells("| a | b \\| c |  |")).toEqual(["a", "b \\| c", ""]);
    const t = parseTable("| K | V |\n|---|---|\n| x | 1 |")!;
    expect(t).toMatchObject({ header: ["K", "V"], headerLine: "| K | V |", rows: [{ cells: ["x", "1"], line: "| x | 1 |" }] });
    expect(parseTable("not a table")).toBeNull();
    const text = "Intro.\n\n```\n| K | V |\n|---|---|\n```\n\n| K | V |\n|---|---|\n| y | 2 |\n";
    const found = tablesIn(text, 0, text.length);
    expect(found).toHaveLength(1);
    expect(text.slice(found[0]!.start, found[0]!.end)).toBe("| K | V |\n|---|---|\n| y | 2 |");
  });

  it("replaces changed cells, leaves repeats out, adds new keys to the same table, and keeps untouched rows' exact text", () => {
    const existing = parseTable("| Setting | Value | Notes |\n| --- | --- | --- |\n|Timeout|30 s|per call|\n| Retries | 5 | on 5xx only |")!;
    const incoming = parseTable("| Setting | Value |\n|---|---|\n| Timeout | 120 s |\n| Retries | 5 |\n| Rate limit | 100/min |")!;
    const r = mergeTables(existing, incoming)!;
    expect(r.replaced).toEqual([{ was: "| Timeout | 30 s | per call |", now: "| Timeout | 120 s | per call |" }]);
    expect(r.added).toEqual(["| Rate limit | 100/min |  |"]);
    expect(r.repeated).toBe(1);
    expect(tableText(r.table)).toBe("| Setting | Value | Notes |\n| --- | --- | --- |\n| Timeout | 120 s | per call |\n| Retries | 5 | on 5xx only |\n| Rate limit | 100/min |  |");
  });

  it("a column the new table adds is added to the existing one, empty where old rows say nothing; an empty cell never blanks one", () => {
    const existing = parseTable("| Setting | Value |\n|---|---|\n| Timeout | 30 s |\n| Retries | 5 |")!;
    const incoming = parseTable("| Setting | Value | Owner |\n|---|---|---|\n| Timeout |  | platform |")!;
    const r = mergeTables(existing, incoming)!;
    expect(tableText(r.table)).toBe("| Setting | Value | Owner |\n|---|--- | --- |\n| Timeout | 30 s | platform |\n| Retries | 5 |  |");
  });

  it("the key is the shared column whose values overlap most when the first column isn't shared; a non-unique key merges nothing", () => {
    const existing = parseTable("| Owner | Service | Tier |\n|---|---|---|\n| ana | auth | 1 |\n| bo | billing | 2 |")!;
    const incoming = parseTable("| Region | Service | Tier |\n|---|---|---|\n| eu | billing | 1 |")!;
    // Keyed by Service; the Region column it brings is added to the existing table.
    expect(mergeTables(existing, incoming)!.replaced).toEqual([{ was: "| bo | billing | 2 |  |", now: "| bo | billing | 1 | eu |" }]);
    const dup = parseTable("| K | V |\n|---|---|\n| x | 1 |\n| x | 2 |")!;
    expect(mergeTables(dup, parseTable("| K | V |\n|---|---|\n| x | 3 |")!)).toBeNull();
  });
});

describe("composeMerged — one table, updated in place", () => {
  it("a table about the topic's table updates it: one table, changed cell replaced, repeat left out, new row at its end", async () => {
    const r = await compose(NOTES, "## Limits\n\n| Setting | Value |\n| --- | --- |\n| Timeout | 120 s |\n| Sessions | 4 |\n| Rate limit | 100 per minute |\n");
    expect(ONE_TABLE(r.text)).toBe(1);
    expect(r.text).toBe(
      NOTES.replace("| Timeout | 30 s | per call |", "| Timeout | 120 s | per call |").replace("| Sessions | 4 | concurrent |", "| Sessions | 4 | concurrent |\n| Rate limit | 100 per minute |  |"),
    );
    expect(r.report.replaced).toEqual([{ topic: expect.any(String), was: "| Timeout | 30 s | per call |", now: "| Timeout | 120 s | per call |" }]);
    expect(r.report.added?.map((a) => a.statement)).toEqual(["| Rate limit | 100 per minute |  |"]);
    expect(r.report.repeated).toBe(1);
    expect(r.report.choices).toEqual([]);
  });

  it("the same table again changes nothing (a repeat)", async () => {
    const r = await compose(NOTES, "## Limits\n\n| Setting | Value | Notes |\n| --- | --- | --- |\n| Timeout | 30 s | per call |\n");
    expect(r.text).toBe(NOTES);
  });

  it("a table about something the topic doesn't hold is filed whole, below the topic's text (as before)", async () => {
    const incoming = "## Limits\n\n| Region | Latency |\n| --- | --- |\n| eu | 40 ms |\n";
    const r = await compose(NOTES, incoming);
    expect(r.text).toContain("| Region | Latency |\n| --- | --- |\n| eu | 40 ms |");
    expect(ONE_TABLE(r.text)).toBe(1);
  });

  it("a paragraph with a table beside it (matched statements): the statement is revised and the table merged, both in place", async () => {
    const plans: StatementPlan[] = [{ statement: "The gateway enforces these limits per tenant.", action: "replaces", target: "The gateway enforces these limits per client." }];
    const r = await compose(NOTES, "## Limits\n\nThe gateway enforces these limits per tenant.\n\n| Setting | Value |\n| --- | --- |\n| Retries | 3 |\n", new Map([["x", plans]]));
    expect(r.text).toBe(NOTES.replace("per client.", "per tenant.").replace("| Retries | 5 | on 5xx only |", "| Retries | 3 | on 5xx only |"));
  });
});

describe("composeMerged — lists, statement by statement (§17)", () => {
  it("a revised list item replaces the item in place; a new item joins the end of the same list", async () => {
    const notes = "# Rules\n\n- Every tool requires an API key.\n- Calls are logged for 30 days.\n";
    const plans: StatementPlan[] = [
      { statement: "Calls are logged for 90 days.", action: "replaces", target: "Calls are logged for 30 days." },
      { statement: "Write tools are off by default.", action: "new", target: null },
    ];
    const r = await compose(notes, "# More\n\n- Calls are logged for 90 days.\n- Write tools are off by default.\n", new Map([["x", plans]]));
    expect(r.text).toBe("# Rules\n\n- Every tool requires an API key.\n- Calls are logged for 90 days.\n- Write tools are off by default.\n");
  });
});

describe("mergeIntoSource — a table update proposes no new object", () => {
  it("the table's topic is updated: no new block, frame, removal or choice", async () => {
    const { runtime } = runtimeWith(modelReply);
    const a = accepted(await firstRun(NOTES, runtime, "architecture"));
    const before = a.existing.length;
    const r = await mergeIntoSource({ ...a, text: "## Limits\n\n| Setting | Value |\n| --- | --- |\n| Timeout | 120 s |\n| Rate limit | 100 per minute |\n", operationId: "op_t", title: "Merge into existing notes", context }, runtime, { parseMarkdown: parse });
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds).not.toContain("create_block");
    expect(kinds).not.toContain("create_frame");
    expect(kinds).not.toContain("remove");
    expect(kinds.some((k) => k === "update_block" || k === "update_shape")).toBe(true);
    const text = r.changeSet!.contentSource!.text;
    expect(ONE_TABLE(text)).toBe(1);
    expect(text).toContain("| Timeout | 120 s | per call |");
    expect(text).not.toContain("30 s");
    expect(text).toContain("| Rate limit | 100 per minute |  |");
    expect(a.existing.length).toBe(before);
  });
});
