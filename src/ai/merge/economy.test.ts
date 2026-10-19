/**
 * Economy import (opt-in, per import, off by default): text appended to an existing topic becomes plain verbatim cards, with no model
 * call. Mock model, no network. Off must be the current behaviour exactly; on must make no plan call for appended text, keep every
 * word and every object, and say so in the review.
 */
import { describe, expect, it } from "vitest";
import type { AIRequest } from "@/ai/types";
import { accepted, acceptUpdate, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { mergeIntoSource, type MergeInput } from "./merge";

const PROSE = `Intro prose about the whole system and how it fits together in practice.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nThis part explains how the system handles case ${i}. It starts from the request, checks the permissions, and then decides what to do next based on the policy. Afterwards it records the outcome so that later steps can rely on it, and it reports any problems to the operator.`).join("\n\n")}`;

const APPENDED = ["Quotas are counted per workspace and reset at midnight UTC.", "Billing cycles close on the first of each month, with a grace period of three days."];
/** Two parts: the first goes to topic "Part 0" (t2) with confidence, the second is unsure and ends up an unplaced plain card. */
const INCOMING = `## Extra notes\n\n${APPENDED.join("\n\n")}\n\n## Orphan idea\n\nA fresh thought about telemetry sampling, retention windows and dashboards that nothing else covers, written out at some length so that it is a passage of its own and not a fragment that follows the part above it.\n`;

async function run(economy: boolean | undefined) {
  const tasks: string[] = [];
  const { runtime } = runtimeWith((req: AIRequest) => {
    tasks.push(req.task);
    if (req.task === "assign_to_topics") return response(JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }, { part: "p2", topic: "unsure" }] }));
    if (req.task === "outline_document") return response(JSON.stringify({ summary: "S", sections: Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, label: i === 0 ? "Intro" : `Part ${i - 1}`, kind: "notes", parts: [`u${i + 1}`] })) }));
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", analysis: [{ id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }] }));
    const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }], relationships: [], metadata: { takeaway: "T" } }));
  });
  const a = accepted(await firstRun(PROSE, runtime));
  tasks.length = 0;
  const input = { ...a, text: INCOMING, operationId: "op_m", title: "Merge", context, ...(economy === undefined ? {} : { economy }) } as MergeInput;
  const merged = await mergeIntoSource(input, runtime, { parseMarkdown: parse });
  return { a, merged, tasks, count: (t: string) => tasks.filter((x) => x === t).length };
}

describe("economy import", () => {
  it("OFF is the current behaviour: leaving the flag out or false gives the same result, and the appended text is planned by the model", async () => {
    const left = await run(undefined);
    const off = await run(false);
    expect(left.count("generate_visual_plan")).toBe(1);
    expect(off.count("generate_visual_plan")).toBe(1);
    // (the source id is random per run)
    const same = (r: typeof off) => JSON.stringify(r.merged.changeSet).replaceAll(r.a.source.id, "SRC");
    expect(same(off)).toBe(same(left));
    expect(off.merged.notices).toEqual(left.merged.notices);
    expect(off.merged.report.economy).toEqual([]);
    expect(off.merged.diagnostics.economy).toEqual([]);
    expect(off.merged.notices.some((n) => n.includes("Economy"))).toBe(false);
  });

  it("ON: no plan or analysis call for the appended text; the unplaced part is still a plain card with no call", async () => {
    const on = await run(true);
    expect(on.count("generate_visual_plan")).toBe(0);
    expect(on.count("generate_section_analysis")).toBe(0);
    expect(on.count("outline_document")).toBe(0);
    expect(on.merged.report.unplaced).toEqual(["Orphan idea"]);
    expect(on.merged.diagnostics.economy).toEqual([{ section: "Part 0", cards: 2 }]);
  });

  it("ON: the text is kept verbatim in the notes (same merged text as off) and as one card per appended paragraph", async () => {
    const off = await run(false);
    const on = await run(true);
    expect(on.merged.changeSet!.contentSource!.text).toBe(off.merged.changeSet!.contentSource!.text);
    const changes = JSON.stringify(on.merged.changeSet!.changes);
    for (const p of APPENDED) expect(changes, p).toContain(p);
    expect(changes).toContain("A fresh thought about telemetry sampling");
  });

  it("ON: nothing is removed — every object of the first import stays, and no removal is proposed", async () => {
    const on = await run(true);
    expect(on.merged.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
    expect(on.merged.diagnostics.removals).toEqual([]);
    const stored = new Set((on.merged.changeSet!.contentSource!.plan as { nodes: { stableKey?: string }[] }).nodes.map((n) => n.stableKey));
    expect(on.a.existing.filter((o) => !stored.has(o.stableNodeKey))).toEqual([]);
  });

  it("ON: the review says plainly which passages were not analysed, and by which mode", async () => {
    const on = await run(true);
    expect(on.merged.report.economy).toEqual(["Extra notes"]);
    const notice = on.merged.notices.find((n) => n.startsWith("Economy import"))!;
    expect(notice).toBe("Economy import: one passage was added to existing topics as plain verbatim cards and was not analysed by AI — no links or analysis were drawn for it (“Extra notes”). Run the import without economy mode to have AI analyse it.");
    // the unplaced rule is unchanged: its own notice, its own card
    expect(on.merged.notices.some((n) => n.startsWith("AI couldn't place one passage"))).toBe(true);
  });

  it("ON: a later update of the same source reuses the cards (nothing planned, nothing added again)", async () => {
    const on = await run(true);
    const a2 = acceptUpdate(on.a, on.merged.changeSet!);
    const { runtime } = runtimeWith((req: AIRequest) => (req.task === "assign_to_topics" ? response(JSON.stringify({ assignments: [] })) : response("never")));
    const again = await mergeIntoSource({ ...a2, text: INCOMING, operationId: "op_m2", title: "Merge again", context, economy: true }, runtime, { parseMarkdown: parse });
    expect(again.changeSet?.changes.filter((c) => c.kind.startsWith("create") || c.kind === "remove") ?? []).toEqual([]);
  });
});
