/**
 * Appended paragraphs by reference (content fidelity Wave B1, extended to the update path). A merge that adds text to an existing topic
 * asks the model for a plan of ONLY the appended blocks; those are numbered ([P1] paragraphs, [L1] lists, [T1] tables, [C1] code) so a
 * block that is a new concept can be placed by reference (`{"type":"source","ref":"L1"}`), word for word, instead of retyped.
 * Mock model, no network. Whatever the model answers (references, unknown references, retyped nodes) no appended word may be lost.
 */
import { describe, expect, it } from "vitest";
import type { AIRequest } from "@/ai/types";
import { accepted, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { mergeIntoSource, type MergeInput } from "./merge";

const PROSE = `Intro prose about the whole system and how it fits together in practice.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nThis part explains how the system handles case ${i}. It starts from the request, checks the permissions, and then decides what to do next based on the policy. Afterwards it records the outcome so that later steps can rely on it, and it reports any problems to the operator.`).join("\n\n")}`;

const PARAGRAPH = "Quotas are counted per workspace and reset at midnight UTC.";
const LIST = "- Free plan: 100 requests per day\n- Team plan: 10,000 requests per day";
const TABLE = "| Plan | Limit |\n|---|---|\n| Free | 100 |\n| Team | 10000 |";
const CHECKLIST = "- [ ] Review the quota alerts\n- [x] Document the reset time";
const CODE = "```sh\nmake quota-report\n```";
const INCOMING = `## Extra notes\n\n${[PARAGRAPH, LIST, TABLE, CHECKLIST, CODE].join("\n\n")}\n`;

type Reply = Record<string, unknown>;
const analysis = { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } };
const plan = (nodes: Reply[], relationships: Reply[] = []) => response(JSON.stringify({ version: 1, template: "sectioned", nodes, relationships }));

/** Runs a merge of INCOMING into a ten-part note; `appended` answers the one plan call that asks for only the appended blocks. */
async function run(appended: (prompt: string) => Reply[]) {
  const plans: string[] = [];
  const { runtime } = runtimeWith((req: AIRequest) => {
    if (req.task === "assign_to_topics") return response(JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }] }));
    if (req.task === "outline_document") return response(JSON.stringify({ summary: "S", sections: Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, label: i === 0 ? "Intro" : `Part ${i - 1}`, kind: "notes", parts: [`u${i + 1}`] })) }));
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", nodes: [analysis] }));
    if (req.prompt.includes("New paragraphs were appended to the section")) {
      plans.push(req.prompt);
      return plan(appended(req.prompt));
    }
    const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }, analysis], relationships: [], metadata: { takeaway: "T" } }));
  });
  const a = accepted(await firstRun(PROSE, runtime));
  const merged = await mergeIntoSource({ ...a, text: INCOMING, operationId: "op_m", title: "Merge", context } as MergeInput, runtime, { parseMarkdown: parse });
  const created = merged.changeSet!.changes.filter((c) => c.kind.startsWith("create"));
  return { a, merged, plans, created, changes: JSON.stringify(created) };
}

const ref = (id: string, to: string, extra: Reply = {}) => ({ id, type: "source", ref: to, ...extra });
/** Every source block, placed by reference in source order (the model's best case). */
const placeAll = (): Reply[] => [ref("n1", "P1"), ref("n2", "L1"), ref("n3", "T1"), ref("n4", "L2"), ref("n5", "C1")];

describe("appended blocks are numbered for the model", () => {
  it("the plan call for appended paragraphs shows them numbered, with the reference rule and how it applies to an existing topic", async () => {
    const r = await run(placeAll);
    expect(r.plans).toHaveLength(1);
    const prompt = r.plans[0]!;
    expect(prompt).toContain("The content below is numbered block by block");
    const content = prompt.split("Content to visualize:\n\n")[1]!;
    expect(content).toContain(`[P1] ${PARAGRAPH}`);
    expect(content).toContain(`[L1] ${LIST}`);
    expect(content).toContain("[T1] | Plan | Limit |");
    expect(content).toContain(`[L2] ${CHECKLIST}`);
    expect(content).toContain(`[C1] ${CODE}`);
    // A block that adds to what an existing node already describes is still replied as that node, not placed beside it.
    expect(prompt).toContain("not placed by reference");
    expect(prompt.indexOf("not placed by reference")).toBeLessThan(prompt.indexOf("Current representation:"));
  });
});

describe("appended blocks placed by reference are inserted verbatim", () => {
  it("a paragraph, a list, a table, a checklist and code: each appears once, as the node of its own kind, in source order", async () => {
    const r = await run(placeAll);
    const nodes = (r.merged.changeSet!.contentSource!.plan as { nodes: { id: string; type: string; stableKey?: string; content: Record<string, unknown> }[] }).nodes;
    const ofType = (type: string) => nodes.filter((n) => n.type === type);
    // (the first import of the ten-part note has no table, checklist or code of its own)
    expect(ofType("table")).toHaveLength(1);
    expect(ofType("table")[0]!.content).toEqual({ columns: ["Plan", "Limit"], rows: [["Free", "100"], ["Team", "10000"]] });
    expect(ofType("todo")[0]!.content).toEqual({ items: [{ text: "Review the quota alerts", checked: false }, { text: "Document the reset time", checked: true }] });
    expect(ofType("code")[0]!.content).toEqual({ language: "sh", source: "make quota-report" });
    const markdown = nodes.flatMap((n) => (typeof n.content.markdown === "string" ? [n.content.markdown] : []));
    expect(markdown.filter((m) => m === PARAGRAPH)).toHaveLength(1);
    expect(markdown.filter((m) => m === LIST)).toHaveLength(1);
    // Source order: the nodes follow the order of the blocks.
    const at = [(n: (typeof nodes)[number]) => n.content.markdown === PARAGRAPH, (n: (typeof nodes)[number]) => n.content.markdown === LIST, (n: (typeof nodes)[number]) => n.type === "table", (n: (typeof nodes)[number]) => n.type === "todo", (n: (typeof nodes)[number]) => n.type === "code"].map((pred) => nodes.findIndex(pred));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((x, y) => x - y));
    expect(nodes.every((n) => n.stableKey)).toBe(true);
  });

  it("keeps the node's own id, title and links when it places a block", async () => {
    const r = await run(() => [ref("n1", "P1", { title: "Quota rule" }), ref("n2", "L1"), ref("n3", "T1"), ref("n4", "L2"), ref("n5", "C1")]);
    expect(r.changes).toContain("Quota rule");
    expect(r.changes).toContain(PARAGRAPH);
  });

  it("the same reply gives the same result: resolving references is deterministic", async () => {
    const first = await run(placeAll);
    const second = await run(placeAll);
    const same = (x: typeof first) => JSON.stringify(x.merged.changeSet).replaceAll(x.a.source.id, "SRC");
    expect(same(second)).toBe(same(first));
  });

  it("every object of the first import stays and nothing is proposed for removal", async () => {
    const r = await run(placeAll);
    expect(r.merged.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
    expect(r.merged.diagnostics.removals).toEqual([]);
    const stored = new Set((r.merged.changeSet!.contentSource!.plan as { nodes: { stableKey?: string }[] }).nodes.map((n) => n.stableKey));
    expect(r.a.existing.filter((o) => !stored.has(o.stableNodeKey))).toEqual([]);
  });
});

describe("a reference that doesn't resolve never loses content", () => {
  it("an unknown reference: the block it meant is still on the canvas, verbatim, and the other references still resolve", async () => {
    const r = await run(() => [ref("n1", "P1"), ref("n2", "L9"), ref("n3", "T1"), ref("n4", "L2"), ref("n5", "C1")]);
    expect(r.changes).toContain(PARAGRAPH);
    expect(r.changes).toContain("Team plan: 10,000 requests per day");
    expect(r.changes).toContain("make quota-report");
    expect(r.changes).toContain("Review the quota alerts");
  });

  it("a block the model leaves out is attached, so a reply made of references can't drop it either", async () => {
    const r = await run(() => [ref("n1", "P1"), ref("n3", "T1"), ref("n5", "C1")]);
    expect(r.changes).toContain("Free plan: 100 requests per day");
    expect(r.changes).toContain("Document the reset time");
  });

  it("a reply that references nothing is used as it always was: no block is attached beside the model's own nodes", async () => {
    const own = [{ id: "n1", type: "text", content: { markdown: "My own summary of quotas, billing and the reset." } }];
    const r = await run(() => own);
    expect(r.changes).toContain("My own summary of quotas");
    expect(r.changes).not.toContain("src~");
  });
});
