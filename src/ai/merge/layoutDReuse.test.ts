/**
 * The layout D merge end to end with mock models and saved data only (`__fixtures__/layoutDWorld.ts`: the first chat's 34 topics and
 * Jev's saved answers for the 116 parts; no chat text, no network, no model). The first import is an outlined source of 21 sections
 * (344 objects, 20 frames — the live run's numbers); the merge files the three chats into it.
 *
 * Guards the benchmark's regressions (2026-10-10): every section regenerated (a whole new outline, 104 plan calls), "More from this
 * section" pages in place of the unplaced parts' cards, and the review's removals; and that a refused or interrupted run proposes nothing.
 * Mock call counts here are not billed costs.
 */
import { describe, expect, it } from "vitest";
import { AIError } from "@/ai/errors";
import { analyzeContent } from "@/ai/content/analyze";
import { analysisUnits } from "@/ai/reconcile/units";
import type { AIRequest } from "@/ai/types";
import { accepted, acceptUpdate, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { mergeIntoSource } from "./merge";
import { incomingText, notesText, recorded } from "./__fixtures__/layoutDWorld";

const bodyOf = (prompt: string) => prompt.split("Content to visualize:\n\n")[1] ?? "";

interface WorldOptions {
  /** Characters of source text per node a mock plan draws (the real first run drew about 85 to 95: 283 of the 300-node limit). */
  nodeChars?: number;
  /** After the first import, refuse every plan and analysis call past this many (as the harness's cost cap did), with a network error. */
  refuseAfter?: number;
  /** After the first import, every plan reply is cut off mid-JSON, as an output budget that is too small would cut it. */
  truncate?: boolean;
}

/** The mock model: outline = 13 sections of two units, then single ones (21 in all); plans = one text node per `nodeChars`; assignment = the saved answers. */
function world({ nodeChars = 95, refuseAfter, truncate }: WorldOptions = {}) {
  const calls: string[] = [];
  let refusing = false;
  let generated = 0;
  const byLeaf = new Map(recorded.map((r) => [r.leaf, r]));
  const { runtime } = runtimeWith((req: AIRequest) => {
    calls.push(req.task);
    const generates = req.task === "generate_visual_plan" || req.task === "generate_section_analysis";
    if (refusing && generates && refuseAfter !== undefined && ++generated > refuseAfter) throw new AIError("network", "refused by the cost cap");
    if (req.task === "outline_document") {
      const n = Math.max(...[...req.prompt.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1])));
      const sections: { id: string; label: string; kind: string; parts: string[] }[] = [];
      for (let i = 1; i <= n; ) {
        const pair = sections.length < 13 && i + 1 <= n;
        sections.push({ id: `s${sections.length + 1}`, label: `Section ${sections.length + 1}`, kind: "notes", parts: pair ? [`u${i}`, `u${i + 1}`] : [`u${i}`] });
        i += pair ? 2 : 1;
      }
      return response(JSON.stringify({ summary: "S", sections }));
    }
    if (req.task === "assign_to_topics") {
      const rows = [...req.prompt.matchAll(/\[(p\d+)\](?: \(under “[^”]*”\))?\n#+ ([^\n]+)/g)];
      return response(JSON.stringify({ assignments: rows.map(([, ref, leaf]) => { const r = byLeaf.get(leaf!); return { part: ref, topic: !r || r.confidence < 0.5 ? "unsure" : r.topic }; }) }));
    }
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", analysis: [{ id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }] }));
    if (refusing && truncate && req.task === "generate_visual_plan") return response('{"version":1,"template":"sectioned","nodes":[{"id":"n1","type":"text","content":{"markdown":"cut o');
    const label = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1] ?? "S";
    const text = bodyOf(req.prompt);
    const prefix = /Current representation/.test(req.prompt) ? "m" : "n";
    const nodes = Array.from({ length: Math.max(1, Math.ceil(text.length / nodeChars)) }, (_, i) => ({ id: `${prefix}${i + 1}`, type: "text", content: { markdown: text.slice(i * nodeChars, (i + 1) * nodeChars) || "." } }));
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [...nodes, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: `What ${label} means.` } }], relationships: [], metadata: { takeaway: `${label} at a glance` } }));
  });
  return {
    runtime,
    calls,
    /** The first import of the first chat, accepted; then the merge of all three chats (calls counted from here). */
    async run(signal?: AbortSignal) {
      const a = accepted(await firstRun(notesText(), runtime));
      calls.length = 0;
      refusing = true;
      const merged = await mergeIntoSource({ ...a, text: incomingText(), operationId: "op_m", title: "Merge", context }, runtime, { parseMarkdown: parse, ...(signal ? { signal } : {}) });
      return { a, merged, again: (a2: ReturnType<typeof accepted>) => mergeIntoSource({ ...a2, text: incomingText(), operationId: "op_m2", title: "Merge again", context }, runtime, { parseMarkdown: parse }) };
    },
  };
}

const count = (xs: readonly string[], what: string) => xs.filter((x) => x === what).length;
const moreFromSection = (changes: readonly unknown[]) => JSON.stringify(changes).match(/More from this section/g)?.length ?? 0;

describe("layout D: first import of chat 1, then the three-chat merge (mock models, saved data)", () => {
  it("the first import is the live run's shape: 21 sections, 20 frames, 344 objects", async () => {
    const w = world();
    const first = await firstRun(notesText(), w.runtime);
    expect((JSON.stringify(first.contentSource!.plan).match(/group#0/g) ?? []).length).toBe(20);
    expect(first.changes.length).toBe(344);
  });

  it("REUSE: the first import's sections are kept and only the grown ones get a plan call (appended paragraphs); no new outline", async () => {
    const w = world();
    const { merged } = await w.run();
    const d = merged.diagnostics.calls;
    expect(count(w.calls, "outline_document")).toBe(0);
    expect(d.plans.new).toBe(0);
    expect(d.plans.piece).toBe(0);
    expect(d.plans.appended).toBeGreaterThan(0);
    expect(d.plans.appended).toBe(count(w.calls, "generate_visual_plan"));
    expect(d.sectionsReused).toBeGreaterThan(0);
    // The counters: sections regenerated = the sections whose plan was called again (appended), not the plain cards.
    expect(merged.reanalyzedUnits).toHaveLength(d.plans.appended);
    expect(d.sectionsRegenerated).toHaveLength(d.plans.appended);
    expect(d.plainCards).toBe(merged.report.unplaced.length);
    expect(merged.report.unplaced.length).toBeGreaterThan(40);
  });

  it("the merged text keeps every one of the notes' own topics (a part filed into the chat title's own text adds no heading that nests the sections below it)", async () => {
    const w = world();
    const { a, merged } = await w.run();
    const text = merged.changeSet!.contentSource!.text;
    const keys = (md: string) => analyzeContent(md, {}).then(({ parsed }) => analysisUnits(parsed, md).map((u) => u.key));
    const before = await keys(a.previous.text);
    const after = new Set(await keys(text));
    expect(before.filter((k) => !after.has(k))).toEqual([]);
    // "My honest score" (a section with its own #### title) went into the chat title's text: its title is written as an italic label there.
    expect(text).toContain("*Competitive feature matrix*");
  });

  it("PLAIN CARDS: no unplaced part is folded into a \"More from this section\" page; each is one framed card with its heading and text", async () => {
    const w = world();
    const { merged } = await w.run();
    const changes = merged.changeSet!.changes;
    const frames = changes.filter((c) => c.kind === "create_frame").map((c) => JSON.stringify(c));
    const unplaced = merged.report.unplaced;
    expect(unplaced.length).toBeGreaterThan(40);
    for (const key of unplaced) {
      const label = key.split(" › ").at(-1)!;
      expect(frames.filter((f) => f.includes(JSON.stringify(label).slice(1, -1))), `card for ${key}`).toHaveLength(1);
    }
    // The only overflow pages left are paragraphs appended past the plan's 300-node limit (the first import already drew 283 of it).
    const overflow = changes.flatMap((c) => (JSON.stringify(c).includes("More from this section") ? [JSON.stringify(c)] : []));
    for (const o of overflow) for (const key of unplaced) expect(o, key).not.toContain(key.split(" › ").at(-1)!);
    expect(overflow.length).toBeLessThanOrEqual(merged.diagnostics.calls.plans.appended);
  });

  it("OVERFLOW LIMITS: within the node limits nothing is folded; past the plan's 300-node limit the appended paragraphs are (the limit is unchanged)", async () => {
    const roomy = await world({ nodeChars: 300 }).run();
    expect(moreFromSection(roomy.merged.changeSet!.changes)).toBe(0);
    const tight = await world({ nodeChars: 95 }).run();
    expect(moreFromSection(tight.merged.changeSet!.changes)).toBeGreaterThan(0);
  });

  it("DENSE FIRST IMPORT: when the first import filled the plan's 300-node limit, the sections it folded into pages are still the notes' sections — no new outline, no analysis cards", async () => {
    // 78 characters per node: the first import draws 365 objects; its last sections' nodes are all in "More from this section" pages whose
    // keys name no section, and the 21st section has no frame. (Live run 3: 343 objects; one outline call, 9 analysis cards.)
    const w = world({ nodeChars: 78 });
    const { a, merged } = await w.run();
    expect(JSON.stringify(a.previous.plan)).toContain("More from this section");
    const d = merged.diagnostics.calls;
    expect(count(w.calls, "outline_document")).toBe(0);
    expect(count(w.calls, "generate_section_analysis")).toBe(0);
    expect(d.plans.piece).toBe(0);
    expect(d.plans.appended + d.plans.new).toBe(count(w.calls, "generate_visual_plan"));
    expect(merged.diagnostics.removals).toEqual([]);
    const text = merged.changeSet!.contentSource!.text;
    for (const line of a.previous.text.split("\n").filter((l) => l.trim())) expect(text, line.slice(0, 40)).toContain(line);
  });

  it("DIAGNOSTICS: every plan call is listed with its section and source size; overflow is counted per section with its cause; no unplaced section is missed", async () => {
    const tight = await world({ nodeChars: 95 }).run();
    const d = tight.merged.diagnostics;
    expect(d.planCalls).toHaveLength(d.calls.plans.appended + d.calls.plans.new + d.calls.plans.piece + d.calls.plans.regenerated);
    expect(d.planCalls.every((c) => c.section && c.sourceChars > 0)).toBe(true);
    expect(d.plainMissed).toEqual([]);
    expect(d.overflow.length).toBeGreaterThan(0);
    expect(d.overflow.every((o) => o.why === "plan limit" && o.folded > 0 && o.pages > 0)).toBe(true);
    expect(d.overflow.reduce((n, o) => n + o.pages, 0)).toBe(moreFromSection(tight.merged.changeSet!.changes));
    const roomy = await world({ nodeChars: 300 }).run();
    expect(roomy.merged.diagnostics.overflow).toEqual([]);
  });

  it("NO REMOVAL: a completed merge proposes no removal, and every object and every sentence of the notes is still there", async () => {
    const w = world();
    const { a, merged } = await w.run();
    expect(merged.changeSet!.changes.filter((c) => c.kind === "remove")).toEqual([]);
    expect(merged.reconciliation.items.filter((i) => i.state === "remove")).toEqual([]);
    expect(merged.diagnostics.removals).toEqual([]);
    const stored = new Set((merged.changeSet!.contentSource!.plan as { nodes: { stableKey?: string }[] }).nodes.map((n) => n.stableKey));
    expect(a.existing.filter((o) => !stored.has(o.stableNodeKey))).toEqual([]);
    const text = merged.changeSet!.contentSource!.text;
    for (const line of a.previous.text.split("\n").filter((l) => l.trim())) expect(text, line.slice(0, 40)).toContain(line);
  });

  it("A SECOND IMPORT of the same chats: the accepted merge's sections and cards are all reused — no model call but the assignment, nothing added or removed", async () => {
    const w = world();
    const { a, merged, again } = await w.run();
    const a2 = acceptUpdate(a, merged.changeSet!);
    w.calls.length = 0;
    const second = await again(a2);
    expect(w.calls.filter((c) => c === "generate_visual_plan" || c === "generate_section_analysis" || c === "outline_document")).toEqual([]);
    expect(second.report.unplaced).toEqual([]);
    expect((second.changeSet?.changes ?? []).map((c) => c.kind + ":" + JSON.stringify(c).slice(0, 120)).slice(0, 6)).toEqual([]);
  });

  it("INTERRUPTED: refused calls leave no half-done merge — it is rejected whole, nothing is proposed, nothing is removed", async () => {
    const w = world({ refuseAfter: 8 });
    await expect(w.run()).rejects.toThrow(/couldn't be analysed .*network: refused by the cost cap/);
  });

  it("TRUNCATED REPLIES: a too-small output budget does not save money, it fails the merge — each cut reply is asked again once, then the whole merge is rejected (so any output cap needs a fallback first)", async () => {
    const w = world({ truncate: true });
    await expect(w.run()).rejects.toThrow(/couldn't be analysed/);
    // one repair retry per section before it gives up: the cut replies are paid for twice
    expect(count(w.calls, "generate_visual_plan")).toBe(34); // 17 grown sections, each asked twice
  });

  it("INTERRUPTED: a cancelled merge ends with an abort, not a result", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(world().run(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
