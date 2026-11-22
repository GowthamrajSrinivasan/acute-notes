/**
 * Statement matching and in-place merge (update engine plan §17), on the MCP example: Source A (an operations guide) on the
 * canvas, Source B (a runbook revising some of its statements) merged into it. No network: the deterministic match, scripted
 * model answers, and the compose step.
 */
import { describe, expect, it } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import { analysisUnits } from "@/ai/reconcile/units";
import { accepted, context, firstRun, modelReply, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { composeMerged, findStatement } from "./compose";
import { mergeIntoSource } from "./merge";
import { guarded, matchLocally, matchStatements, validateMatches, type MatchInput, type StatementPlan } from "./statementMatch";

const SOURCE_A = `# MCP server operations guide

The MCP server listens on port 3001.
Tool calls time out after 30 seconds.
Access tokens are rotated every night at 1 a.m.
Each client may open at most 5 concurrent sessions.
Write tools are disabled by default.
Every tool requires an API key.
The server logs every tool call to the audit log.
Read tools return their results as JSON.
`;

const SOURCE_B = `# MCP client runbook

The MCP server listens on port 3001.
Tool calls time out after 120 seconds.
Access tokens are rotated once a week on Sunday.
Each client may open up to 8 concurrent sessions.
Write tools are enabled by default.
The health-check tool can be called without an API key.
In 2025 the server also accepted the SSE transport; since January 2026 it accepts Streamable HTTP only.
Tool calls are recorded in the audit log.
`;

const topicOf = (text: string) => text.slice(text.indexOf("\n\n") + 2);
const partOf = (text: string) => text.slice(text.indexOf("\n\n") + 2);
const byStatement = (plans: StatementPlan[]) => Object.fromEntries(plans.map((p) => [p.statement, { action: p.action, target: p.target }]));

describe("matchLocally — the deterministic answer (no AI, or AI failed)", () => {
  const plans = byStatement(matchLocally(topicOf(SOURCE_A), partOf(SOURCE_B)));

  it("a statement said word for word repeats; one with a changed value replaces the statement it revises", () => {
    expect(plans["The MCP server listens on port 3001."]).toEqual({ action: "repeats", target: "The MCP server listens on port 3001." });
    expect(plans["Tool calls time out after 120 seconds."]).toEqual({ action: "replaces", target: "Tool calls time out after 30 seconds." });
    expect(plans["Access tokens are rotated once a week on Sunday."]).toEqual({ action: "replaces", target: "Access tokens are rotated every night at 1 a.m." });
    expect(plans["Each client may open up to 8 concurrent sessions."]).toEqual({ action: "replaces", target: "Each client may open at most 5 concurrent sessions." });
    expect(plans["Write tools are enabled by default."]).toEqual({ action: "replaces", target: "Write tools are disabled by default." });
  });

  it("an exception is added beside its rule, never in its place; a same-subject flip replaces", () => {
    expect(plans["The health-check tool can be called without an API key."]).toEqual({ action: "adds", target: "Every tool requires an API key." });
    expect(guarded({ statement: "The health-check tool can be called without an API key.", action: "replaces", target: "Every tool requires an API key." }).action).toBe("adds");
    expect(guarded({ statement: "Write tools are enabled by default.", action: "replaces", target: "Write tools are disabled by default." }).action).toBe("replaces");
  });

  it("a statement about nothing the notes say is new; nothing is ever dropped", () => {
    expect(plans["In 2025 the server also accepted the SSE transport; since January 2026 it accepts Streamable HTTP only."]?.action).toBe("new");
    expect(Object.keys(plans)).toHaveLength(8);
  });
});

describe("guarded — a doubtful answer keeps text, never loses it", () => {
  it("a 'repeats' that brings a new number is not a repeat", () => {
    expect(guarded({ statement: "Tool calls time out after 120 seconds.", action: "repeats", target: "Tool calls time out after 30 seconds." }).action).toBe("replaces");
  });
  it("a 'replaces' of a statement about something else is kept as an addition", () => {
    expect(guarded({ statement: "Read tools return their results as JSON.", action: "replaces", target: "Access tokens are rotated every night at 1 a.m." }).action).toBe("adds");
  });
  it("'new' never has a target; a target-less answer is new", () => {
    expect(guarded({ statement: "x y z", action: "new", target: "a b c" })).toEqual({ statement: "x y z", action: "new", target: null });
    expect(guarded({ statement: "x y z", action: "adds", target: null }).action).toBe("new");
  });
});

describe("validateMatches — the model's answer, checked", () => {
  const input: MatchInput = { items: [{ key: "p", topic: topicOf(SOURCE_A), part: partOf(SOURCE_B) }] };

  it("ids resolve to the exact statements; an unknown id or a missing answer gets the local answer", () => {
    const plans = validateMatches(
      {
        matches: [
          { statement: "i1.n.s5", target: "i1.t.s5", action: "adds" },
          { statement: "i1.n.s7", target: "i1.t.s6", action: "repeats" },
          { statement: "i1.n.s1", target: "i1.t.s99", action: "replaces" },
        ],
      },
      input,
    ).get("p")!;
    const got = byStatement(plans);
    expect(got["The health-check tool can be called without an API key."]).toEqual({ action: "adds", target: "Every tool requires an API key." });
    expect(got["Tool calls are recorded in the audit log."]).toEqual({ action: "repeats", target: "The server logs every tool call to the audit log." });
    // Unknown target id: the local answer.
    expect(got["Tool calls time out after 120 seconds."]).toEqual({ action: "replaces", target: "Tool calls time out after 30 seconds." });
  });
});

describe("matchStatements — the decision model is asked first", () => {
  it("the chat task prefers the decision model; a failed call falls back to the local answer and says so", async () => {
    const { runtime, spy } = runtimeWith((req) => (req.task === "match_statements" ? response("not json at all") : response("{}")));
    const r = await matchStatements(runtime, { items: [{ key: "p", topic: topicOf(SOURCE_A), part: partOf(SOURCE_B) }] });
    expect(spy.mock.calls.some((c) => c[0]!.task === "match_statements")).toBe(true);
    expect(r.failed).toBe(true);
    expect(r.by).toBe("local");
    expect(r.plans.get("p")).toHaveLength(8);
  });
});

describe("composeMerged with `revise` — the topic is edited in place", () => {
  it("the MCP example: replaced where they stand, the addition beside its rule, the new statement at the end; no choice, no appended block", async () => {
    const { parsed } = await analyzeContent(SOURCE_A);
    const { parsed: incomingParsed } = await analyzeContent(SOURCE_B);
    const units = analysisUnits(parsed, SOURCE_A);
    const parts = analysisUnits(incomingParsed, SOURCE_B);
    const topic = units[0]!;
    const part = parts[0]!;
    const plans = validateMatches(
      { matches: [{ statement: "i1.n.s5", target: "i1.t.s5", action: "adds" }, { statement: "i1.n.s7", target: "i1.t.s6", action: "repeats" }] },
      { items: [{ key: part.key, topic: SOURCE_A.slice(topic.span.start, topic.span.end), part: partOf(SOURCE_B) }] },
    ).get(part.key)!;
    const r = composeMerged({ text: SOURCE_A, parsed, units, incoming: SOURCE_B, incomingParsed, parts, assignment: new Map([[part.key, topic.key]]), revise: new Map([[part.key, plans]]) });
    expect(r.text).toBe(`# MCP server operations guide

The MCP server listens on port 3001.
Tool calls time out after 120 seconds.
Access tokens are rotated once a week on Sunday.
Each client may open up to 8 concurrent sessions.
Write tools are enabled by default.
Every tool requires an API key.
The health-check tool can be called without an API key.
The server logs every tool call to the audit log.
Read tools return their results as JSON.
In 2025 the server also accepted the SSE transport; since January 2026 it accepts Streamable HTTP only.
`);
    expect(r.report.replaced?.map((x) => x.now)).toEqual(["Tool calls time out after 120 seconds.", "Access tokens are rotated once a week on Sunday.", "Each client may open up to 8 concurrent sessions.", "Write tools are enabled by default."]);
    expect(r.report.repeated).toBe(2);
    expect(r.report.choices).toEqual([]);
    expect(r.report.newTopics).toEqual([]);
  });

  it("findStatement matches across a paragraph's line breaks, and only a single occurrence", () => {
    const text = "Alpha one\ntwo three. Beta.";
    expect(findStatement(text, 0, text.length, "Alpha one two three.")).toEqual({ start: 0, end: 20 });
    expect(findStatement("Beta. Beta.", 0, 11, "Beta.")).toBeNull();
  });

  it("in a list, an addition is the next list item", async () => {
    const notes = "# Rules\n\n- Every tool requires an API key.\n- Calls are logged.\n";
    const incoming = "# More\n\n- The health-check tool can be called without an API key.\n";
    const { parsed } = await analyzeContent(notes);
    const { parsed: incomingParsed } = await analyzeContent(incoming);
    const units = analysisUnits(parsed, notes);
    const parts = analysisUnits(incomingParsed, incoming);
    const plan: StatementPlan = { statement: "The health-check tool can be called without an API key.", action: "adds", target: "Every tool requires an API key." };
    const r = composeMerged({ text: notes, parsed, units, incoming, incomingParsed, parts, assignment: new Map([[parts[0]!.key, units[0]!.key]]), revise: new Map([[parts[0]!.key, [plan]]]) });
    expect(r.text).toBe("# Rules\n\n- Every tool requires an API key.\n- The health-check tool can be called without an API key.\n- Calls are logged.\n");
  });
});

describe("mergeIntoSource — the existing card is updated, nothing is added", () => {
  it("Source B updates the object Source A made: an update, no new block, frame, removal or choice", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(SOURCE_A, runtime, "architecture"));
    spy.mockClear();
    const before = a.existing.length;
    const r = await mergeIntoSource({ ...a, text: SOURCE_B, operationId: "op_m", title: "Merge into existing notes", context }, runtime, { parseMarkdown: parse });
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds).not.toContain("create_block");
    expect(kinds).not.toContain("create_frame");
    expect(kinds).not.toContain("remove");
    expect(kinds.some((k) => k === "update_block" || k === "update_shape")).toBe(true);
    const text = r.changeSet!.contentSource!.text;
    expect(text).toContain("Tool calls time out after 120 seconds.");
    expect(text).not.toContain("30 seconds");
    expect(text.match(/port 3001/g)).toHaveLength(1);
    expect(text).not.toContain("[!choice]");
    expect(r.report.choices).toEqual([]);
    expect(r.notices.some((n) => /^Merged: updated 1 existing topic in place \(\d+ statements replaced, \d+ added\)/.test(n))).toBe(true);
    expect(a.existing.length).toBe(before);
    // Assignment is skipped (one topic, filed locally by heading words) or asked; the statements are matched, then the topic regenerated.
    expect(spy.mock.calls.map((c) => c[0]!.task)).toContain("match_statements");
  });
});
