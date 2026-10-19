/**
 * Capacity-aware merge planning (economy mode only; `reconcile/capacity.ts`). When the plan has no room left for any new node, everything a model
 * would plan for a new section or a grown "orphan" section is folded into a "More from this section" page anyway, so economy mode adds that text
 * as it is instead of asking for a plan. The oracle is the real `foldOverflow`. Mock models, no network; the saved layout D world.
 */
import { describe, expect, it, vi } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import type { AIRequest } from "@/ai/types";
import { isFatalAIError } from "@/ai/visualize/outlined";
import { appendedParagraphs, paragraphsOf } from "@/ai/reconcile/paragraphs";
import { analysisUnits } from "@/ai/reconcile/units";
import { foldOverflow } from "@/ai/visual-plan/repair";
import { templateFor } from "@/ai/visual-plan/templates";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { NODE_CAPS } from "@/ai/visual-plan/validate";
import { accepted, acceptUpdate, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { everyAddedNodeFolds, planIsFull, type CapacityCheck } from "@/ai/reconcile/capacity";
import { economyBlocks } from "@/ai/reconcile/plainCards";
import { updateFromNewContent } from "@/ai/reconcile/update";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { mergeIntoSource } from "./merge";
import { incomingText, notesText, recorded } from "./__fixtures__/layoutDWorld";

/** Lets one test switch the oracle off, which is the behaviour before this change (every plan call is made); records what it saw and what the real fold counted. */
const oracle = vi.hoisted(() => ({ off: false, calls: [] as { retained: number; result: boolean }[], folds: [] as { existingCounted: number }[] }));
vi.mock("@/ai/reconcile/capacity", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/ai/reconcile/capacity")>();
  return {
    ...real,
    everyAddedNodeFolds: (...args: Parameters<typeof real.everyAddedNodeFolds>) => {
      const result = oracle.off ? false : real.everyAddedNodeFolds(...args);
      oracle.calls.push({ retained: args[0].length, result });
      return result;
    },
    planIsFull: (...args: Parameters<typeof real.planIsFull>) => (oracle.off ? false : real.planIsFull(...args)),
  };
});
vi.mock("@/ai/visual-plan/repair", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/ai/visual-plan/repair")>();
  return {
    ...real,
    foldOverflow: (...args: Parameters<typeof real.foldOverflow>) => {
      const existing = args[3];
      // The merge's validation (the call that is given the previous plan's keys): how many existing nodes it really counts.
      if (existing && existing.size) oracle.folds.push({ existingCounted: args[0].filter((n) => n.type !== "group" && n.origin !== "plain" && !!n.stableKey && existing.has(n.stableKey)).length });
      return real.foldOverflow(...args);
    },
  };
});

const bodyOf = (prompt: string) => prompt.split("Content to visualize:\n\n")[1] ?? "";
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

// ---- the oracle itself ------------------------------------------------------------------------------------------------------------------------

const flat = (n: number, section: string, over: Partial<VisualNode> = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `${section}${i}`, type: "text", stableKey: `${section} § k${i}`, content: { markdown: "x" }, ...over }) as VisualNode);
/** `total` existing nodes spread over sections of at most 50 (so no section limit is involved). */
const spread = (total: number) => Array.from({ length: Math.ceil(total / 50) }, (_, s) => flat(Math.min(50, total - s * 50), `S${s}`)).flat();
const keysOf = (nodes: VisualNode[]) => new Set(nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
/** What the merge's validation does with `added` on top of `existing`: how many of the added nodes stay nodes (are not folded). */
const keptOfAdded = (existing: VisualNode[], added: VisualNode[]) => {
  const { nodes } = foldOverflow([...existing, ...added], templateFor("sectioned"), NODE_CAPS, keysOf(existing));
  return added.filter((a) => nodes.some((n) => n.id === a.id)).length;
};

describe("the oracle: the real foldOverflow decides, at the boundary", () => {
  it("299 counted nodes leave room; 300 and 301 do not", () => {
    expect(everyAddedNodeFolds(spread(299), keysOf(spread(299)))).toBe(false);
    expect(everyAddedNodeFolds(spread(300), keysOf(spread(300)))).toBe(true);
    expect(everyAddedNodeFolds(spread(301), keysOf(spread(301)))).toBe(true);
  });

  it("agrees with an actual fold: whenever it says no room, no node added in any section is kept; whenever it says room, one is", () => {
    const added = [...flat(3, "S0n"), ...flat(3, "Brand new section"), ...flat(2, "Another")].map((n, i) => ({ ...n, id: `new${i}` }));
    for (const total of [0, 1, 150, 298, 299, 300, 301, 450]) {
      const existing = spread(total);
      const says = everyAddedNodeFolds(existing, keysOf(existing));
      const kept = keptOfAdded(existing, added);
      if (says) expect(kept, `${total} existing`).toBe(0);
      else expect(kept, `${total} existing`).toBeGreaterThan(0);
    }
  });

  it("counts exactly what foldOverflow counts: plain cards are not counted; a section at its own limit does not stand for the whole plan", () => {
    const plain = flat(100, "P", { origin: "plain" });
    const existing = [...spread(200), ...plain];
    expect(everyAddedNodeFolds(existing, keysOf(existing))).toBe(false);
    // One section full (60) but the plan has room: a new section can still be planned.
    const full = [...flat(60, "Full"), ...spread(40)];
    expect(everyAddedNodeFolds(full, keysOf(full))).toBe(false);
    expect(keptOfAdded(full, flat(2, "Elsewhere").map((n, i) => ({ ...n, id: `e${i}` })))).toBeGreaterThan(0);
  });

  it("falls back (false) on shapes it cannot judge: nothing retained, frames, nodes with a parent, or a key clash with its probe", () => {
    expect(everyAddedNodeFolds([], new Set())).toBe(false);
    const frame = { id: "g0", type: "group", content: { label: "g", arrangement: "grid" } } as unknown as VisualNode;
    expect(everyAddedNodeFolds([...spread(300), frame], keysOf(spread(300)))).toBe(false);
    expect(everyAddedNodeFolds(spread(300).map((n) => ({ ...n, parent: "g0" }) as VisualNode), keysOf(spread(300)))).toBe(false);
    expect(everyAddedNodeFolds(spread(300), new Set(["(capacity probe) § probe"]))).toBe(false);
  });
});

describe("the oracle reports what it saw, and the report changes no answer", () => {
  const seen = (retained: VisualNode[], existing = keysOf(retained)) => {
    let check: CapacityCheck | undefined;
    const answer = everyAddedNodeFolds(retained, existing, (c) => (check = c));
    return { answer, check: check! };
  };

  it("folds: the cap, what it was given, what the real fold counted, and where the probe would stand", () => {
    const { answer, check } = seen(spread(300));
    expect(answer).toBe(true);
    expect(check).toEqual({ answer: "folds", cap: 300, retained: 300, unreadableCharts: 0, counted: 300, projected: 301, probes: 1 });
  });

  it("room: the same record, with the probe inside the cap", () => {
    const { answer, check } = seen(spread(299));
    expect(answer).toBe(false);
    expect(check).toEqual({ answer: "room", cap: 300, retained: 299, unreadableCharts: 0, counted: 299, projected: 300, probes: 1 });
  });

  it("what the real fold counted can be less than what it was given: plain cards are given but not counted; unreadable charts are left out and said so", () => {
    const withPlain = [...spread(250), ...flat(60, "P", { origin: "plain" })];
    expect(seen(withPlain).check).toMatchObject({ retained: 310, counted: 250, projected: 251, answer: "room" });
    const chart = (i: number) => ({ id: `chart${i}`, type: "code", stableKey: `C § chart${i}`, content: { language: "acute-chart", source: "not chart json" } }) as unknown as VisualNode;
    expect(seen([...spread(299), chart(0), chart(1)]).check).toMatchObject({ retained: 301, unreadableCharts: 2, counted: 299, answer: "room" });
  });

  it("unsupported: says why, has no counts, and answers false (the caller plans as before)", () => {
    const frame = { id: "g0", type: "group", content: { label: "g", arrangement: "grid" } } as unknown as VisualNode;
    expect(seen([])).toMatchObject({ answer: false, check: { answer: "unsupported", reason: "nothing retained to count", retained: 0 } });
    expect(seen([...spread(300), frame]).check).toMatchObject({ answer: "unsupported", reason: "frames or nodes with a parent in the plan" });
    expect(seen(spread(300).map((n) => ({ ...n, parent: "g0" }) as VisualNode)).check.reason).toBe("frames or nodes with a parent in the plan");
    const clash = seen(spread(300), new Set(["(capacity probe) § probe"]));
    expect(clash).toMatchObject({ answer: false, check: { answer: "unsupported", reason: "the probe's key is a real key" } });
    for (const u of [seen([]), clash]) expect(u.check.counted).toBeUndefined();
  });

  it("asking for the report never changes the answer", () => {
    for (const total of [0, 1, 299, 300, 301, 450]) {
      const nodes = spread(total);
      expect(everyAddedNodeFolds(nodes, keysOf(nodes), () => undefined), `${total}`).toBe(everyAddedNodeFolds(nodes, keysOf(nodes)));
    }
  });
});

describe("planIsFull: the same question asked of the real validation, once the replies are in", () => {
  it("agrees with everyAddedNodeFolds on a plain plan, and says full at the cap exactly", () => {
    for (const total of [1, 150, 299, 300, 301, 450]) {
      const nodes = spread(total);
      expect(planIsFull(nodes, keysOf(nodes)), `${total}`).toBe(everyAddedNodeFolds(nodes, keysOf(nodes)));
    }
  });

  it("counts nodes the plan does not have yet as kept (new nodes), and only existing ones first: a new node past the cap is folded, so the probe is", () => {
    const old = spread(250);
    const fresh = flat(60, "F");
    expect(planIsFull([...old, ...fresh], keysOf(old))).toBe(true);
    expect(planIsFull([...old, ...fresh.slice(0, 40)], keysOf(old))).toBe(false);
  });

  it("an entry that is not a node, and an unreadable chart, are left out (it can only say room); unsupported shapes answer false with a reason", () => {
    let check: CapacityCheck | undefined;
    expect(planIsFull([...spread(299), null, "x", 3], keysOf(spread(299)), (c) => (check = c))).toBe(false);
    expect(check).toMatchObject({ answer: "room", counted: 299 });
    expect(planIsFull([], new Set(), (c) => (check = c))).toBe(false);
    expect(check).toMatchObject({ answer: "unsupported", reason: "nothing planned to count" });
    const frame = { id: "g0", type: "group", content: { label: "g", arrangement: "grid" } };
    expect(planIsFull([...spread(300), frame], new Set(), (c) => (check = c))).toBe(false);
    expect(check?.answer).toBe("unsupported");
    expect(planIsFull(spread(300), new Set(["(capacity probe) § probe"]), (c) => (check = c))).toBe(false);
    expect(check).toMatchObject({ answer: "unsupported", reason: "the probe's key is a real key" });
  });
});

describe("the oracle and validation's own removals", () => {
  const text = (id: string, section: string, i: number) => ({ id, type: "text", stableKey: `${section} § k${i}`, content: { markdown: "x" } }) as unknown as VisualNode;
  const chart = (i: number) => ({ id: `chart${i}`, type: "code", stableKey: `C § chart${i}`, content: { language: "acute-chart", source: "this is not chart json" } }) as unknown as VisualNode;

  it("an unreadable chart is not counted: validation drops it as soon as the plan holds a table, which frees room the count would have hidden", () => {
    const existing = [...Array.from({ length: 298 }, (_, i) => text(`e${i}`, `S${Math.floor(i / 50)}`, i)), chart(0), chart(1)];
    const keys = keysOf(existing);
    // The counterexample this guards: 300 nodes, yet a merge that adds a table keeps new nodes, because the two charts are dropped first.
    const added = [{ id: "t1", type: "table", stableKey: "New § table", content: { columns: ["a"], rows: [["b"]] } } as unknown as VisualNode, text("n1", "New", 1), text("n2", "New", 2), text("n3", "New", 3)];
    const { plan } = validateVisualPlan({ version: 1, template: "sectioned", nodes: [...existing, ...added], relationships: [] }, { existing: keys });
    expect(plan.nodes.filter((n) => ["t1", "n1", "n2", "n3"].includes(n.id)).length).toBeGreaterThan(0);
    expect(everyAddedNodeFolds(existing, keys)).toBe(false);
    // A readable chart is an ordinary node and counts.
    const readable = [...Array.from({ length: 299 }, (_, i) => text(`r${i}`, `S${Math.floor(i / 50)}`, i)), { id: "ok", type: "code", stableKey: "C § ok", content: { language: "acute-chart", source: JSON.stringify({ chartType: "bar", categories: ["a"], series: [{ name: "s", values: [1] }] }) } } as unknown as VisualNode];
    expect(everyAddedNodeFolds(readable, keysOf(readable))).toBe(true);
  });
});

// ---- the merge, on the saved layout D world -----------------------------------------------------------------------------------------------

interface WorldOptions {
  /** Characters of source per node a mock plan draws: 78 fills the first import past the plan's limit (dense), 300 leaves room. */
  nodeChars: number;
  /** Leaf headings the mock assignment calls a new topic. */
  newLeaves?: string[];
}

const runs = new Map<string, Promise<{ result: { a: ReturnType<typeof accepted>; merged: Awaited<ReturnType<typeof mergeIntoSource>>; again: () => ReturnType<typeof mergeIntoSource> }; calls: { task: string; section?: string }[] }>>();

function world({ nodeChars, newLeaves = [] }: WorldOptions) {
  const calls: { task: string; section?: string }[] = [];
  const byLeaf = new Map(recorded.map((r) => [r.leaf, r]));
  const { runtime } = runtimeWith((req: AIRequest) => {
    const section = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1];
    calls.push({ task: req.task, ...(section ? { section } : {}) });
    if (req.task === "outline_document") {
      const n = Math.max(...[...req.prompt.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1])));
      const sections: unknown[] = [];
      for (let i = 1; i <= n; ) {
        const pair = sections.length < 13 && i + 1 <= n;
        sections.push({ id: `s${sections.length + 1}`, label: `Section ${sections.length + 1}`, kind: "notes", parts: pair ? [`u${i}`, `u${i + 1}`] : [`u${i}`] });
        i += pair ? 2 : 1;
      }
      return response(JSON.stringify({ summary: "S", sections }));
    }
    if (req.task === "assign_to_topics") {
      const rows = [...req.prompt.matchAll(/\[(p\d+)\](?: \(under “[^”]*”\))?\n#+ ([^\n]+)/g)];
      return response(JSON.stringify({ assignments: rows.map(([, ref, leaf]) => { const r = byLeaf.get(leaf!); return { part: ref, topic: newLeaves.includes(leaf!) ? "new" : !r || r.confidence < 0.5 ? "unsure" : r.topic }; }) }));
    }
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", analysis: [{ id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }] }));
    const label = section ?? "S";
    const text = bodyOf(req.prompt);
    const nodes = Array.from({ length: Math.max(1, Math.ceil(text.length / nodeChars)) }, (_, i) => ({ id: `n${i + 1}`, type: "text", content: { markdown: text.slice(i * nodeChars, (i + 1) * nodeChars) || "." } }));
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [...nodes, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: `What ${label} means.` } }], relationships: [{ from: "n1", to: "an1", type: "relates_to" }], metadata: { takeaway: `${label} at a glance` } }));
  });
  return {
    calls,
    count: (task: string) => calls.filter((c) => c.task === task).length,
    /** One first import and one merge. Identical runs are deterministic, so they are made once per file (`fresh` makes a new one, for the tests that watch the run). */
    async merge(economy: boolean | undefined, fresh = false) {
      const key = `${nodeChars}|${newLeaves.join(",")}|${String(economy)}|${oracle.off}`;
      const hit = fresh ? undefined : runs.get(key);
      if (hit) {
        const done = await hit;
        calls.length = 0;
        calls.push(...done.calls);
        return done.result;
      }
      const made = (async () => {
        const a = accepted(await firstRun(notesText(), runtime));
        calls.length = 0;
        const merged = await mergeIntoSource({ ...a, text: incomingText(), operationId: "op_m", title: "Merge", context, ...(economy === undefined ? {} : { economy }) } as never, runtime, { parseMarkdown: parse });
        let second: ReturnType<typeof mergeIntoSource> | undefined;
        const again = () => (second ??= mergeIntoSource({ ...acceptUpdate(a, merged.changeSet!), text: incomingText(), operationId: "op_m2", title: "Merge again", context, ...(economy === undefined ? {} : { economy }) } as never, runtime, { parseMarkdown: parse }));
        return { result: { a, merged, again }, calls: [...calls] };
      })();
      if (!fresh) runs.set(key, made);
      return (await made).result;
    },
  };
}

type Run = Awaited<ReturnType<ReturnType<typeof world>["merge"]>>;
const planOf = (r: Run) => r.merged.changeSet!.contentSource!.plan as VisualPlan;
const textOf = (r: Run) => r.merged.changeSet!.contentSource!.text;
const unitsOf = async (md: string) => analysisUnits((await analyzeContent(md, {})).parsed, md);
const NEW_LEAVES = ["Block Runtime", "Encapsulation"];

describe("dense first import (no room left), economy on: plan calls for orphan and new sections are skipped", () => {
  it("skips them, says which and why, and still adds every paragraph once, verbatim, in order", async () => {
    const w = world({ nodeChars: 78, newLeaves: NEW_LEAVES });
    const r = await w.merge(true);
    const d = r.merged.diagnostics;
    // Before this change these were model calls (see the oracle-off run below); now none is made.
    expect(w.count("generate_visual_plan")).toBe(0);
    expect(w.count("outline_document")).toBe(0);
    expect(w.count("generate_section_analysis")).toBe(0);
    expect(d.calls.plans).toEqual({ appended: 0, regenerated: 0, piece: 0, new: 0 });
    expect(d.planSkips.length).toBeGreaterThan(0);
    expect(new Set(d.planSkips.map((s) => s.path))).toEqual(new Set(["orphan", "added"]));
    expect(d.removals).toEqual([]);

    // Content: each skipped section's text is in the stored plan exactly once and in source order.
    const all = strings(planOf(r).nodes);
    const before = new Map((await unitsOf(r.a.previous.text)).map((u) => [u.key, u.text] as const));
    const after = new Map((await unitsOf(textOf(r))).map((u) => [u.key, u.text] as const));
    let checked = 0;
    for (const skip of d.planSkips) {
      const key = skip.section;
      const paragraphs = skip.path === "orphan" ? appendedParagraphs(before.get(key) ?? "", after.get(key) ?? "") ?? [] : paragraphsOf((after.get(key) ?? "").replace(/^#{1,6}\s[^\n]*\n+/, ""));
      let last = -1;
      // (a bare "---" paragraph is a chat separator, and matches every page separator: only real content is checked)
      for (const p of paragraphs.filter((x) => x.length > 20)) {
        const hits = all.filter((s) => s.includes(p));
        expect(hits.length, `${skip.path} ${key.slice(-30)}: ${p.slice(0, 30)}`).toBe(1);
        const at = all.findIndex((s) => s.includes(p));
        expect(at, "source order").toBeGreaterThanOrEqual(last);
        last = at;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 90_000);

  it("changes nothing else about the merge: the notes text, the merge report, the conflicts and the change set's own metadata match the run that plans them", async () => {
    oracle.off = false;
    const skipped = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    oracle.off = true;
    const planned = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    oracle.off = false;
    expect(textOf(skipped)).toBe(textOf(planned));
    // Everything in the report matches, `economy` included (a skipped orphan is not counted there); only `planSkipped` says what was skipped.
    const pick = (r: Run) => { const { planSkipped: _skipped, ...rest } = r.merged.report; return rest; };
    expect(pick(skipped)).toEqual(pick(planned));
    expect(skipped.merged.diagnostics.conflictsPicked).toBe(planned.merged.diagnostics.conflictsPicked);
    expect(skipped.merged.diagnostics.removals).toEqual(planned.merged.diagnostics.removals);
    expect(skipped.merged.changeSet!.metadata).toMatchObject({ createdBy: planned.merged.changeSet!.metadata.createdBy, operationId: "op_m" });
    // The oracle-off run is the old behaviour: it did ask the model for the sections the other run skipped.
    expect(planned.merged.diagnostics.planSkips).toEqual([]);
    expect(planned.merged.diagnostics.calls.plans.new).toBeGreaterThan(0);
  }, 120_000);

  it("analysis text and links are what is given up: nothing the model would have written is added, and the page carries no analysis tag either way", async () => {
    oracle.off = false;
    const skipped = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    oracle.off = true;
    const planned = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    oracle.off = false;
    const analysisText = (r: Run) => strings(planOf(r).nodes).filter((s) => /^What .* means\.$/.test(s) || s.includes("What Roblox for software. means") || /\*\*Status\*\*/.test(s));
    // Planned: the model's analysis lines ended up as plain text in the folded pages, unmarked; skipped: the model wrote none.
    expect(analysisText(planned).length).toBeGreaterThan(analysisText(skipped).length);
    for (const r of [skipped, planned]) expect(planOf(r).nodes.filter((n) => n.origin === "analysis" && (n.stableKey ?? "").includes("more~"))).toEqual([]);
    // Links: every link to a folded node is dropped by validation either way; the skipped run has none the planned run lacks.
    expect(planOf(skipped).relationships.length).toBeLessThanOrEqual(planOf(planned).relationships.length);
    // The skipped sections still have their title and their text, in a page: nothing is missing from what the planned run showed.
    for (const skip of skipped.merged.diagnostics.planSkips) expect(strings(planOf(skipped).nodes).some((s) => s.includes(skip.section.split(" › ").at(-1)!.slice(0, 20)))).toBe(true);
  }, 120_000);
});

describe("content and duplication when planning is skipped", () => {
  const sep = "\n\n---\n\n";
  const pagesOf = (r: Run) => planOf(r).nodes.filter((n) => n.type === "page") as (VisualNode & { type: "page"; content: { title: string; markdown: string } })[];
  const labelOf = (key: string) => key.split(" › ").at(-1)!;

  /** Distinct filler words of a text (the saved world's bodies are made of `w…x` words), for "is this text still on the canvas". */
  const wordsOf = (t: string) => [...new Set(t.split(/\s+/).filter((w) => /^w[0-9a-z]+x\.?$/.test(w)))];
  const occurrences = (r: Run, w: string) => strings(planOf(r).nodes).join(" ").split(w).length - 1;

  it("a pure-append orphan adds exactly its appended blocks, as one page of its own; its earlier text is neither lost nor shown twice", async () => {
    const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    const before = new Map((await unitsOf(r.a.previous.text)).map((u) => [u.key, u.text] as const));
    const after = new Map((await unitsOf(textOf(r))).map((u) => [u.key, u.text] as const));
    const orphans = r.merged.diagnostics.planSkips.filter((x) => x.path === "orphan");
    expect(orphans.length).toBeGreaterThan(0);
    for (const o of orphans) {
      const blocks = economyBlocks(appendedParagraphs(before.get(o.section) ?? "", after.get(o.section) ?? "") ?? []);
      const page = pagesOf(r).find((p) => p.content.title === `More from this section — ${labelOf(o.section)}`);
      expect(page, o.section).toBeDefined();
      const parts = page!.content.markdown.split(sep);
      // The section's own title heads the page; everything after it is the appended blocks, and nothing else.
      if (parts[0] === labelOf(o.section)) parts.shift();
      expect(parts, o.section).toEqual(blocks);
      // Its earlier text is on the canvas (in the first import's page, which survives), exactly as often as it was.
      const earlier = before.get(o.section) ?? "";
      const wasIn = (w: string) => strings((r.a.previous.plan as VisualPlan).nodes).join(" ").split(w).length - 1;
      const kept = wordsOf(earlier).filter((w) => wasIn(w) > 0);
      expect(kept.length, "the mock's first import holds most of it").toBeGreaterThan(wordsOf(earlier).length / 2);
      for (const w of kept) expect(occurrences(r, w), w).toBe(wasIn(w));
    }
    const keys = planOf(r).nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
  }, 90_000);

  // The merge's new overflow pages used to get the positional keys the first import's pages already had ("page#0", …), so the merge updated those pages in
  // place with other sections' content and their earlier content was nowhere in the plan. Pages are now keyed by their section and number (`foldOverflow`).
  for (const [name, economy, off] of [["economy on, capacity skip on", true, false], ["economy on, capacity skip off", true, true], ["economy off", false, false]] as const) {
    it(`a merge adds its overflow pages beside the first import's, never over them (${name})`, async () => {
      oracle.off = off;
      const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(economy);
      oracle.off = false;
      const oldPages = (r.a.previous.plan as VisualPlan).nodes.filter((n) => n.type === "page") as unknown as { stableKey: string; content: { markdown: string } }[];
      expect(oldPages.length).toBeGreaterThan(1);
      const finalPages = new Map(pagesOf(r).map((p) => [p.stableKey, p.content.markdown] as const));
      // Every page the first import had is still there, with the same key and the same content.
      for (const old of oldPages) expect(finalPages.get(old.stableKey), old.stableKey).toBe(old.content.markdown);
      // The merge's own pages are new objects: nothing existing is updated, no pages are removed, and every key is unique.
      const kinds = r.merged.changeSet!.changes.reduce<Record<string, number>>((o, c) => ({ ...o, [c.kind]: (o[c.kind] ?? 0) + 1 }), {});
      expect(kinds.update_block ?? 0).toBe(0);
      expect(kinds.create_page ?? 0).toBe(pagesOf(r).length - oldPages.length);
      expect(r.merged.diagnostics.removals).toEqual([]);
      const keys = planOf(r).nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : []));
      expect(new Set(keys).size).toBe(keys.length);
      // (Long plain cards are pages too; the overflow pages are the ones titled "More from this section".)
      const added = pagesOf(r).filter((p) => p.content.title.startsWith("More from this section") && !oldPages.some((o) => o.stableKey === p.stableKey));
      expect(added.length).toBeGreaterThan(0);
      for (const p of added) expect(p.stableKey, "section-scoped, not positional").toMatch(/^more~.+~\d+$/);
    }, 90_000);
  }

  it("the same input gives the same page keys and contents, and importing it again on top adds, updates or removes no page", async () => {
    const first = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    // An independent run (not the memoized one): the comparison means nothing otherwise.
    const second = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true, true);
    const pageSig = (r: Run) => pagesOf(r).map((p) => [p.stableKey, p.content.title, p.content.markdown]);
    expect(pageSig(second)).toEqual(pageSig(first));
    const again = await first.again();
    expect((again.changeSet?.changes ?? []).filter((c) => c.kind.startsWith("create") || c.kind.startsWith("update"))).toEqual([]);
    // Nothing removed is a page (the only removals are the frames below), and the stored plan has the same pages with the same keys.
    expect(again.diagnostics.removals.filter((r) => !r.key.endsWith(" § group#0"))).toEqual([]);
    const againPlan = (again.changeSet?.contentSource?.plan ?? planOf(first)) as VisualPlan;
    const pagesNow = againPlan.nodes.filter((n) => n.type === "page").map((n) => [n.stableKey, (n as { content: { markdown: string } }).content.markdown]);
    expect(pagesNow).toEqual(pageSig(first).map(([k, , md]) => [k, md]));
  }, 180_000);

  // Found while reviewing the page keys, and not caused by them (identical with the old positional keys, with the capacity skip off, and with economy off):
  // the first import had folded three sections' content into pages, and those pages were each their frame's only member. A merge stored its plan grouped
  // again by section, and a page names no section, so the three frames were stored empty; the next read dropped them, and an identical second import
  // proposed removing frames that were still on the canvas. A page now keeps the frame it was in (`regroupSections`).
  for (const [name, economy, off] of [["economy on, capacity skip on", true, false], ["economy on, capacity skip off", true, true], ["economy off", false, false]] as const) {
    it(`an identical second import proposes no change at all, and keeps every section frame (${name})`, async () => {
      oracle.off = off;
      const first = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(economy);
      const again = await first.again();
      oracle.off = false;
      const groups = (r: Run) => planOf(r).nodes.filter((n) => n.type === "group").map((n) => n.stableKey).sort();
      expect(again.diagnostics.removals).toEqual([]);
      expect((again.changeSet?.changes ?? []).filter((c) => c.kind === "remove" || c.kind.startsWith("create") || c.kind.startsWith("update"))).toEqual([]);
      // Every frame the first import had is still a frame in the plan the first merge stored, and the second merge keeps all of them.
      const firstFrames = (first.a.previous.plan as VisualPlan).nodes.filter((n) => n.type === "group").map((n) => n.stableKey);
      for (const key of firstFrames) expect(groups(first), key).toContain(key);
      expect(groups(first).length).toBeGreaterThanOrEqual(firstFrames.length);
      const againPlan = (again.changeSet?.contentSource?.plan ?? planOf(first)) as VisualPlan;
      expect(againPlan.nodes.filter((n) => n.type === "group").map((n) => n.stableKey).sort()).toEqual(groups(first));
    }, 180_000);
  }

  it("the frames the first import's pages were in still hold them after a merge: every page stays a member of the frame it was in", async () => {
    const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    const prev = r.a.previous.plan as VisualPlan;
    const frameKeyOf = (plan: VisualPlan, id: string | undefined) => plan.nodes.find((n) => n.id === id)?.stableKey;
    const oldPages = prev.nodes.filter((n) => n.type === "page" && n.parent);
    expect(oldPages.length).toBeGreaterThan(1);
    for (const old of oldPages) {
      const now = planOf(r).nodes.find((n) => n.stableKey === old.stableKey);
      expect(frameKeyOf(planOf(r), now?.parent), old.stableKey).toBe(frameKeyOf(prev, old.parent));
    }
  }, 90_000);

  it("a new section is added once, whole, as one page under its own name; it is not also a card of its own", async () => {
    const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    const after = new Map((await unitsOf(textOf(r))).map((u) => [u.key, u.text] as const));
    const added = r.merged.diagnostics.planSkips.filter((x) => x.path === "added");
    expect(added.length).toBeGreaterThan(0);
    for (const a of added) {
      const unit = after.get(a.section)!;
      const pages = pagesOf(r).filter((p) => p.content.title === `More from this section — ${labelOf(a.section)}`);
      expect(pages, a.section).toHaveLength(1);
      expect(pages[0]!.content.markdown.split(sep).filter((x) => x === unit)).toHaveLength(1);
      expect(strings(planOf(r).nodes).filter((x) => x.includes(unit)).length).toBe(1);
      expect(planOf(r).nodes.filter((n) => n.origin === "plain" && strings(n).some((x) => x.includes(unit)))).toEqual([]);
    }
  }, 90_000);
});

describe("scope: what is not an orphan append or a new section is still planned", () => {
  const section = (text: string, heading: string) => {
    const at = text.indexOf(`### ${heading}\n`);
    const end = text.indexOf("\n### ", at + 5);
    return { at, end: end < 0 ? text.length : end };
  };
  const labelOf = (key: string) => key.split(" › ").at(-1)!;

  /** The dense first import (made once), then a plain update (no merge) with economy and append-only on, as a merge sets them. */
  const calls: { task: string; section?: string }[] = [];
  /** Steers the reply for the regenerated section "The core idea": it names `keep` of its previous nodes as unchanged and adds `extra` new ones. */
  const regen: { mode: { keep: number; extra: number } | null; onReply?: () => void } = { mode: null };
  /** Sections (by a word of their name) whose plan call fails with a provider error, as an unusable provider would. */
  const failing: string[] = [];
  const bases = new Map<number, Promise<{ runtime: ReturnType<typeof runtimeWith>["runtime"]; a: ReturnType<typeof accepted> }>>();
  const firstAt = (nodeChars: number) => {
    const hit = bases.get(nodeChars);
    if (hit) return hit;
    const made = (async () => {
      const { runtime } = runtimeWith((req: AIRequest) => {
        const sectionName = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1];
        calls.push({ task: req.task, ...(sectionName ? { section: sectionName } : {}) });
        if (req.task === "outline_document") {
          const n = Math.max(...[...req.prompt.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1])));
          const sections = Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, label: `Section ${i + 1}`, kind: "notes", parts: [`u${i + 1}`] }));
          return response(JSON.stringify({ summary: "S", sections }));
        }
        if (req.task === "generate_visual_plan" && sectionName && failing.some((f) => sectionName.includes(f))) throw new Error(`the provider failed for ${sectionName}`);
        if (req.task === "generate_visual_plan" && regen.mode && sectionName?.includes("The core idea")) {
          regen.onReply?.();
          const { keep, extra } = regen.mode;
          const nodes = [
            ...Array.from({ length: keep }, (_, j) => ({ id: `p${j + 1}`, unchanged: true })),
            ...Array.from({ length: extra }, (_, j) => ({ id: `g${j + 1}`, type: "text", content: { markdown: `A new paragraph ${j + 1} of the regenerated section.` } })),
          ];
          return response(JSON.stringify({ version: 1, template: "sectioned", nodes: nodes.length ? nodes : [{ id: "g1", type: "text", content: { markdown: "Only this remains." } }], relationships: [], metadata: { takeaway: "T" } }));
        }
        if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", analysis: [{ id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }] }));
        const text = bodyOf(req.prompt);
        const nodes = Array.from({ length: Math.max(1, Math.ceil(text.length / nodeChars)) }, (_, i) => ({ id: `n${i + 1}`, type: "text", content: { markdown: text.slice(i * nodeChars, (i + 1) * nodeChars) || "." } }));
        return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [...nodes, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }], relationships: [], metadata: { takeaway: "T" } }));
      });
      return { runtime, a: accepted(await firstRun(notesText(), runtime)) };
    })();
    bases.set(nodeChars, made);
    return made;
  };
  async function run(change: (notes: string) => string, nodeChars = 78, extra: Record<string, unknown> = {}) {
    const { runtime, a } = await firstAt(nodeChars);
    calls.length = 0;
    const r = await updateFromNewContent({ ...a, text: change(a.previous.text), operationId: "op_u", title: "Update", context }, runtime, { parseMarkdown: parse, economy: true, appendOnly: true, ...extra });
    return { r, calls: calls.filter((c) => c.task === "generate_visual_plan") };
  }
  const ORPHAN = "Roblox for software.";
  const edit = (heading: string) => (t: string) => {
    const { at, end } = section(t, heading);
    return `${t.slice(0, at)}${t.slice(at, end).replace(/w[0-9a-z]+x/, "wEDITEDx")}${t.slice(end)}`;
  };
  const append = (heading: string, paragraph: string) => (t: string) => {
    const { end } = section(t, heading);
    return `${t.slice(0, end)}\n\n${paragraph}${t.slice(end)}`;
  };

  it("an orphan with only a paragraph appended is skipped; the same orphan with a word changed is planned by the model", async () => {
    const appended = await run(append(ORPHAN, "An extra paragraph appended to the orphan section."));
    expect(appended.r.planSkips.map((x) => [x.path, labelOf(x.section)])).toEqual([["orphan", ORPHAN]]);
    expect(appended.calls).toEqual([]);
    const edited = await run(edit(ORPHAN));
    expect(edited.r.planSkips).toEqual([]);
    expect(edited.calls.length).toBe(1);
  }, 120_000);

  it("a regenerated section is listed as left out of the count, with how many nodes it has and why; the count then falls short of the real fold's by exactly those and the re-made titles", async () => {
    const edited = await run(edit("The core idea"));
    const c = edited.r.capacity!;
    expect(c).toBeDefined();
    const left = c.sections.filter((x) => !x.counted);
    expect(left.map((x) => labelOf(x.section))).toEqual(["The core idea"]);
    expect(left[0]!.nodes).toBeGreaterThan(0);
    expect(left[0]!.why).toMatch(/regenerated/);
    expect(c.actualCounted! - c.counted!).toBe(left[0]!.nodes + c.changedTitles - c.titlesCounted);
    // The same plan with only a paragraph appended counts that section's nodes, and the check says no room.
    const appended = await run(append("The core idea", "An extra paragraph appended to a drawn section."));
    expect(appended.r.capacity!.sections.map((x) => [labelOf(x.section), x.counted])).toEqual([["The core idea", true]]);
    expect(appended.r.capacity!.answer).toBe("folds");
    expect(appended.r.capacity!.retained).toBeGreaterThan(c.retained);
  }, 120_000);

  const newSection = (t: string) => `${t}

### A topic the notes did not have

A brand new paragraph that is about something else entirely, long enough to be a section of its own.`;
  /** The first import's size is set by how much source a mock node draws: 79 to 82 leave the plan at 300 to 306 once a regenerated section is back, 83 and more leave room. */
  const sweepAnswers = async (nodeChars: number) => {
    const x = await run((t) => newSection(edit("The core idea")(t)), nodeChars);
    return { x, c: x.r.capacity!, again: x.r.capacity!.afterReplies! };
  };

  it("an edited section plus a new section, first import at 306 nodes: the first check says room (the regenerated section is not counted), the recheck after the replies says full, and the new section is cards with no plan call", async () => {
    const { x, c, again } = await sweepAnswers(80);
    expect(c.answer).toBe("room");
    expect(c.counted!).toBeLessThan(c.cap);
    expect(again.answer).toBe("folds");
    expect(again.counted!).toBeGreaterThanOrEqual(again.cap);
    // Exact: what the recheck counted is what the plan's real fold then counted.
    expect(again.counted).toBe(c.actualCounted);
    expect(x.r.planSkips.map((p) => p.path)).toEqual(["added"]);
    // The regenerated section is still planned by the model; only the new section's plan is skipped.
    expect(x.calls.length).toBe(1);
    expect(x.calls[0]!.section).toMatch(/The core idea/);
  }, 120_000);

  it("the same edit with the first import at 299 nodes: the recheck says room, the new section is planned as before", async () => {
    const { x, c, again } = await sweepAnswers(83);
    expect(c.answer).toBe("room");
    expect(again.answer).toBe("room");
    expect(again.counted).toBe(c.actualCounted);
    expect(again.counted!).toBeLessThan(again.cap);
    expect(x.r.planSkips).toEqual([]);
    expect(x.calls.length).toBe(2);
  }, 120_000);

  it("across first imports of 262 to 306 nodes the recheck counts exactly what the real fold counts, and skips the new section's plan exactly when that count has reached the cap", async () => {
    let skipped = 0;
    let planned = 0;
    for (const nodeChars of [78, 79, 80, 81, 82, 83, 84, 86, 90]) {
      const { x, c, again } = await sweepAnswers(nodeChars);
      // 78 is already full before the replies, so there is no recheck for it (the first answer decides).
      if (!again) {
        expect(c.answer, `${nodeChars}`).toBe("folds");
        continue;
      }
      expect(again.counted, `${nodeChars}`).toBe(c.actualCounted);
      const skip = x.r.planSkips.some((p) => p.path === "added");
      expect(skip, `${nodeChars}`).toBe(again.answer === "folds");
      expect(skip, `${nodeChars}`).toBe(again.counted! >= again.cap);
      if (skip) skipped++;
      else planned++;
    }
    expect(skipped).toBeGreaterThan(0);
    expect(planned).toBeGreaterThan(0);
  }, 600_000);

  it("an edited orphan is planned by the model like any other changed section, and the recheck counts what it returned: nothing is assumed for a section that has no reply", async () => {
    const x = await run((t) => newSection(edit(ORPHAN)(t)), 80);
    const c = x.r.capacity!;
    expect(x.calls.map((k) => k.section).some((n) => n?.includes(ORPHAN))).toBe(true);
    if (c.afterReplies) expect(c.afterReplies.counted).toBe(c.actualCounted);
    // Whatever the answer, a section that was planned is in the count only through its actual reply (`planned` is what the plan held).
    expect(c.sections.find((s) => s.section.includes(ORPHAN))?.counted ?? false).toBe(false);
  }, 120_000);

  it("`recheck` says why `afterReplies` is there or not: asked, not_needed_first_answer_full, not_needed_no_new_sections, not_applicable; absent never means passed", async () => {
    const asked = (await run((t) => newSection(edit("The core idea")(t)), 80)).r.capacity!;
    expect(asked.recheck).toBe("asked");
    expect(asked.afterReplies).toBeDefined();
    const alreadyFull = (await run((t) => newSection(append("The core idea", "An extra paragraph.")(t)))).r.capacity!;
    expect(alreadyFull.answer).toBe("folds");
    expect(alreadyFull.recheck).toBe("not_needed_first_answer_full");
    expect(alreadyFull.afterReplies).toBeUndefined();
    const noNew = (await run(edit("The core idea"), 80)).r.capacity!;
    expect(noNew.recheck).toBe("not_needed_no_new_sections");
    expect(noNew.afterReplies).toBeUndefined();
    // New sections only: no changed section or title, so there is no reply whose nodes could change the first count.
    const onlyNew = (await run(newSection, 90)).r.capacity!;
    expect(onlyNew.recheck).toBe("not_applicable");
    expect(onlyNew.afterReplies).toBeUndefined();
    // Whenever afterReplies is there the status is asked, and the other way round.
    for (const c of [asked, alreadyFull, noNew, onlyNew]) expect(c.afterReplies !== undefined).toBe(c.recheck === "asked");
  }, 120_000);

  it("a merge that is not economy and append-only has no capacity record, so no status to mistake", async () => {
    const off = await world({ nodeChars: 80, newLeaves: NEW_LEAVES }).merge(false);
    expect(off.merged.diagnostics.capacity).toBeUndefined();
  }, 120_000);

  describe("orphans are held until the regenerated sections reply, when the plan is expected to be full", () => {
    const orphanParagraph = "An extra paragraph appended to the orphan section.";
    /** An edited drawn section ("The core idea") and a pure-append orphan, on a first import of `nodeChars`. */
    const both = (t: string) => append(ORPHAN, orphanParagraph)(edit("The core idea")(t));
    const orphanCalls = (x: Awaited<ReturnType<typeof run>>) => x.calls.filter((k) => k.section?.includes(ORPHAN)).length;
    const regenCalls = (x: Awaited<ReturnType<typeof run>>) => x.calls.filter((k) => k.section?.includes("The core idea")).length;
    const plannedNodes = (x: Awaited<ReturnType<typeof run>>) => (x.r.overflow ?? []).filter((o) => o.section.includes(ORPHAN)).reduce((n, o) => n + o.folded, 0);
    const steer = async <T,>(mode: { keep: number; extra: number } | null, fn: () => Promise<T>, nodeChars = 80) => {
      // The first import is made without steering (it is the notes the merge starts from).
      await firstAt(nodeChars);
      regen.mode = mode;
      try {
        return await fn();
      } finally {
        regen.mode = null;
      }
    };

    it("the replies keep every node (or add more): the plan is full, so the orphan is held and then skipped with no plan call; the recheck counts what the real fold counts", async () => {
      for (const mode of [{ keep: 8, extra: 0 }, { keep: 8, extra: 40 }]) {
        const x = await steer(mode, () => run(both, 80));
        const c = x.r.capacity!;
        expect(c.answer, JSON.stringify(mode)).toBe("room");
        expect(c.orphanExpectation!).toBeGreaterThanOrEqual(c.cap);
        expect(c.hold).toMatchObject({ held: 1, answer: "folds" });
        expect(c.hold!.heldMs).toBeGreaterThanOrEqual(0);
        // Exact, titles made again included: the same count the plan's own fold then makes.
        expect(c.hold!.check!.counted).toBe(c.actualCounted);
        expect(c.orphans).toEqual([{ section: expect.stringContaining(ORPHAN), pureAppend: true, held: true, outcome: "skipped_after_hold" }]);
        expect(orphanCalls(x)).toBe(0);
        expect(regenCalls(x)).toBe(1);
        expect(x.r.planSkips.map((p) => [p.path, labelOf(p.section)])).toEqual([["orphan", ORPHAN]]);
        expect(x.r.economy.length).toBe(0);
      }
    }, 180_000);

    it("a reply that keeps no node leaves room: the orphan is held, then planned (one call, late), and what it plans is kept, not folded", async () => {
      const x = await steer({ keep: 0, extra: 0 }, () => run(both, 80));
      const c = x.r.capacity!;
      expect(c.hold).toMatchObject({ held: 1, answer: "room" });
      expect(c.hold!.check!.counted!).toBeLessThan(c.cap);
      expect(c.orphans).toEqual([{ section: expect.stringContaining(ORPHAN), pureAppend: true, held: true, outcome: "planned_after_hold" }]);
      expect(orphanCalls(x)).toBe(1);
      expect(regenCalls(x)).toBe(1);
      expect(x.r.planSkips).toEqual([]);
      // The plan has room for part of it: some of the 21 nodes the mock draws for the orphan are kept (the whole of it folds when the plan is full).
      expect(plannedNodes(x)).toBeLessThan(21);
    }, 180_000);

    it("a reply that keeps half of its nodes leaves room too (first import of 281 nodes, expectation exactly at the cap); the orphan is planned once", async () => {
      const x = await steer({ keep: 4, extra: 0 }, () => run(both, 81), 81);
      expect(x.r.capacity!.orphanExpectation).toBe(x.r.capacity!.cap);
      expect(x.r.capacity!.hold!.answer).toBe("room");
      expect(orphanCalls(x)).toBe(1);
      expect(x.r.capacity!.orphans.map((o) => o.outcome)).toEqual(["planned_after_hold"]);
    }, 180_000);

    it("an orphan that would overflow is never planned when the plan is full, and one that fits is planned: the hold only changes when, never whether, the plan decides", async () => {
      const skipped = await steer({ keep: 8, extra: 0 }, () => run(both, 80));
      const planned = await steer({ keep: 0, extra: 0 }, () => run(both, 80));
      expect(skipped.r.capacity!.hold!.check!.counted!).toBeGreaterThanOrEqual(skipped.r.capacity!.cap);
      expect(planned.r.capacity!.hold!.check!.counted!).toBeLessThan(planned.r.capacity!.cap);
      expect(orphanCalls(skipped)).toBe(0);
      expect(orphanCalls(planned)).toBe(1);
    }, 240_000);

    it("not held: the expectation is under the cap (first import of 279 nodes), the orphan starts at once as before", async () => {
      const x = await run(both, 83);
      const c = x.r.capacity!;
      expect(c.orphanExpectation!).toBeLessThan(c.cap);
      expect(c.hold).toBeUndefined();
      expect(c.orphans).toEqual([{ section: expect.stringContaining(ORPHAN), pureAppend: true, held: false, outcome: "planned" }]);
      expect(orphanCalls(x)).toBe(1);
    }, 180_000);

    it("not held: no section is regenerated (the first count is exact), an orphan that is not a pure append, or the first check already full", async () => {
      const onlyOrphan = await run(append(ORPHAN, orphanParagraph), 90);
      expect(onlyOrphan.r.capacity!.hold).toBeUndefined();
      expect(onlyOrphan.r.capacity!.orphans.map((o) => [o.pureAppend, o.held, o.outcome])).toEqual([[true, false, "planned"]]);
      // With nothing regenerated the first count is exact: at 306 nodes it says full and the orphan is skipped at once, not held.
      const exact = await run(append(ORPHAN, orphanParagraph), 80);
      expect(exact.r.capacity!.hold).toBeUndefined();
      expect(exact.r.capacity!.orphans.map((o) => [o.held, o.outcome])).toEqual([[false, "skipped"]]);
      expect(orphanCalls(onlyOrphan)).toBe(1);
      const edited = await run((t) => edit(ORPHAN)(edit("The core idea")(t)), 80);
      expect(edited.r.capacity!.hold).toBeUndefined();
      expect(edited.r.capacity!.orphans.map((o) => [o.pureAppend, o.held, o.outcome])).toEqual([[false, false, "planned"]]);
      expect(orphanCalls(edited)).toBe(1);
      // First import of 310 nodes: full before any reply, so the orphan is skipped at once (as before this change), and is not held.
      const early = await run(both, 78);
      expect(early.r.capacity!.answer).toBe("folds");
      expect(early.r.capacity!.hold).toBeUndefined();
      expect(early.r.capacity!.orphans.map((o) => [o.held, o.outcome])).toEqual([[false, "skipped"]]);
      expect(orphanCalls(early)).toBe(0);
    }, 240_000);

    it("a failed regenerated reply stops the update before any held orphan is asked; an abort during the hold does too", async () => {
      await firstAt(80);
      // The regenerated call fails (an unusable reply): the update fails, as it did, and no orphan call was made.
      regen.mode = { keep: 8, extra: 0 };
      regen.onReply = () => {
        throw new Error("the provider failed");
      };
      let failed: unknown;
      const sawCalls = async (options: Record<string, unknown>) => {
        try {
          await run(both, 80, options);
        } catch (err) {
          failed = err;
        }
        return calls.filter((c) => c.task === "generate_visual_plan");
      };
      const afterFailure = await sawCalls({});
      regen.onReply = undefined;
      expect(failed).toBeDefined();
      expect(afterFailure.some((c) => c.section?.includes("The core idea"))).toBe(true);
      expect(afterFailure.some((c) => c.section?.includes(ORPHAN))).toBe(false);
      // Aborted while the regenerated section replies: the held orphan is not asked.
      const controller = new AbortController();
      regen.onReply = () => controller.abort();
      failed = undefined;
      const afterAbort = await sawCalls({ signal: controller.signal });
      regen.mode = null;
      regen.onReply = undefined;
      expect(failed).toBeDefined();
      expect(afterAbort.some((c) => c.section?.includes("The core idea"))).toBe(true);
      expect(afterAbort.some((c) => c.section?.includes(ORPHAN))).toBe(false);
    }, 240_000);

    describe("failure semantics: the update fails as it did, and a call that was never made reports nothing", () => {
      const failWith = async (names: string[], nodeChars: number, mode: { keep: number; extra: number }) => {
        await firstAt(nodeChars);
        failing.splice(0, failing.length, ...names);
        regen.mode = mode;
        let message = "";
        try {
          await run(both, nodeChars);
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
        } finally {
          failing.length = 0;
          regen.mode = null;
        }
        return { message, asked: calls.filter((c) => c.task === "generate_visual_plan").map((c) => c.section ?? "") };
      };

      it("two calls in the same step that both fail are both reported (nothing is held at 262 nodes: they run together)", async () => {
        const { message, asked } = await failWith(["The core idea", ORPHAN], 90, { keep: 8, extra: 0 });
        expect(asked.some((n) => n.includes(ORPHAN)) && asked.some((n) => n.includes("The core idea"))).toBe(true);
        expect(message).toContain("The core idea");
        expect(message).toContain(ORPHAN);
      }, 180_000);

      it("a regenerated call that fails while an orphan is held: the update fails with its message, and the orphan, which was never asked, adds none", async () => {
        const { message, asked } = await failWith(["The core idea", ORPHAN], 80, { keep: 8, extra: 0 });
        expect(message).toContain("The core idea");
        expect(message).not.toContain(ORPHAN);
        expect(asked.some((n) => n.includes(ORPHAN))).toBe(false);
      }, 180_000);

      it("a held orphan that is planned after the hold and fails is reported, not dropped: the update fails", async () => {
        const { message, asked } = await failWith([ORPHAN], 80, { keep: 0, extra: 0 });
        expect(asked.filter((n) => n.includes(ORPHAN))).toHaveLength(1);
        expect(message).toContain(ORPHAN);
        expect(message).not.toContain("The core idea");
      }, 180_000);

      it("the same two failures without the hold (the first check already full, the orphan skipped at once) report the regenerated one only: nothing else was asked", async () => {
        const { message, asked } = await failWith(["The core idea", ORPHAN], 78, { keep: 8, extra: 0 });
        expect(message).toContain("The core idea");
        expect(asked.some((n) => n.includes(ORPHAN))).toBe(false);
      }, 180_000);

      it("an abort while the regenerated section replies is the same abort as without a hold, and the held orphan is not asked", async () => {
        await firstAt(80);
        const controller = new AbortController();
        regen.mode = { keep: 8, extra: 0 };
        regen.onReply = () => controller.abort();
        let failed: unknown;
        try {
          await run(both, 80, { signal: controller.signal });
        } catch (err) {
          failed = err;
        } finally {
          regen.mode = null;
          regen.onReply = undefined;
        }
        expect(failed).toBeDefined();
        // A cancellation in the app's own terms (an AbortError, or an AIError of kind cancelled): which of the two depends on whether a call saw the abort.
        expect(isFatalAIError(failed)).toBe(true);
        expect(calls.some((c) => c.section?.includes("The core idea"))).toBe(true);
        expect(calls.some((c) => c.section?.includes(ORPHAN))).toBe(false);
      }, 180_000);
    });

    it("economy off, or not append-only: nothing is held and there is no record", async () => {
      for (const options of [{ economy: false }, { appendOnly: false }]) {
        const x = await steer({ keep: 8, extra: 0 }, () => run(both, 80, options));
        expect(x.r.capacity, JSON.stringify(options)).toBeUndefined();
        expect(orphanCalls(x), JSON.stringify(options)).toBe(1);
      }
    }, 240_000);

    it("an identical repeated import changes nothing: no plan call, no hold", async () => {
      const x = await run((t) => t, 80);
      expect(x.calls).toEqual([]);
      expect(x.r.capacity?.hold).toBeUndefined();
      expect(x.r.planSkips).toEqual([]);
    }, 120_000);
  });

  it("a drawn section whose text was edited is regenerated by the model even with no room; one with a paragraph appended is economy cards, as before", async () => {
    const edited = await run(edit("The core idea"));
    expect(edited.r.planSkips).toEqual([]);
    expect(edited.calls.length).toBe(1);
    const appended = await run(append("The core idea", "An extra paragraph appended to a drawn section."));
    expect(appended.calls).toEqual([]);
    expect(appended.r.economy.map((e) => e.cards)).toEqual([1]);
    expect(appended.r.planSkips).toEqual([]);
  }, 120_000);
});

describe("the oracle never skips when a new node could survive (real merges, first imports of 284 to 305 nodes and a roomy one)", () => {
  it("what it retains never exceeds what the real fold counts, and whenever it says there is no room, no new node survives", async () => {
    let said = 0;
    // 305 nodes (dense), 284 (just under the cap, where the real fold still counts past 300) and 111 (roomy); a wider sweep of 22 worlds, including 300 exactly,
    // found no violation (evidence document).
    for (const nodeChars of [78, 85, 90, 95, 100, 110, 150, 300]) {
      const newLeaves = NEW_LEAVES;
      {
        oracle.off = false;
        oracle.calls.length = 0;
        oracle.folds.length = 0;
        const r = await world({ nodeChars, newLeaves: [...newLeaves] }).merge(true, true);
        const asked = oracle.calls.at(-1);
        const counted = oracle.folds.at(-1);
        expect(asked, `nodeChars ${nodeChars}`).toBeDefined();
        expect(counted, `nodeChars ${nodeChars}`).toBeDefined();
        expect(asked!.retained, `retained vs counted, nodeChars ${nodeChars}`).toBeLessThanOrEqual(counted!.existingCounted);
        const before = new Set((r.a.previous.plan as VisualPlan).nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
        const fresh = planOf(r).nodes.filter((n) => n.type !== "group" && n.origin !== "plain" && n.stableKey && !before.has(n.stableKey) && !String(n.id).startsWith("more~"));
        if (asked!.result) {
          said++;
          expect(fresh.length, `no room, nodeChars ${nodeChars}`).toBe(0);
        }
      }
    }
    // The sweep must include cases where it did say no room, or it proves nothing.
    expect(said).toBeGreaterThan(0);
  }, 300_000);
});

describe("the merge's capacity diagnostics: what the check saw next to what the real fold counted", () => {
  const record = (r: Run) => r.merged.diagnostics.capacity!;
  const excludedNodes = (c: NonNullable<ReturnType<typeof record>>) => c.sections.filter((x) => !x.counted).reduce((n, x) => n + x.nodes, 0);

  for (const [name, nodeChars, answer] of [["dense first import", 78, "folds"], ["first import just under the cap", 95, "folds"], ["roomy first import", 300, "room"]] as const) {
    it(`${name}: the record is there, the check's count never exceeds the fold's, and the difference is exactly what the check cannot know`, async () => {
      const r = await world({ nodeChars, newLeaves: NEW_LEAVES }).merge(true);
      const c = record(r);
      expect(c.answer).toBe(answer);
      expect(c.cap).toBe(300);
      expect(c.counted).toBeLessThanOrEqual(c.actualCounted!);
      // The difference between what the check counted and what the plan's real fold then counted is the nodes of the changed sections it left out
      // plus the titles of the changed sections it did not count (the ones of counted sections are in `retained`): nothing else.
      expect(c.actualCounted! - c.counted!).toBe(excludedNodes(c) + c.changedTitles - c.titlesCounted);
      // The first import's own overflow pages name no section, so they are neither retained nor in the plan the fold sees (a merge restores them
      // afterwards): the exact difference above holds with them present.
      if (nodeChars === 78) expect((r.a.previous.plan as VisualPlan).nodes.some((n) => n.type === "page")).toBe(true);
      expect(c.reusedNodes).toBeGreaterThan(0);
      expect(c.sections.length).toBeGreaterThan(0);
      expect(c.sections.every((x) => x.why.length > 0)).toBe(true);
    }, 90_000);
  }

  it("a first import just under the cap (284 nodes): counting the titles of the sections it counts makes the check say the plan is full, as the real fold finds it", async () => {
    const r = await world({ nodeChars: 95, newLeaves: NEW_LEAVES }).merge(true);
    const c = record(r);
    expect(c.titlesCounted).toBeGreaterThan(0);
    expect(c.counted!).toBeGreaterThanOrEqual(c.cap);
    expect(c.answer).toBe("folds");
    expect(c.actualCounted!).toBeGreaterThanOrEqual(c.cap);
    // Without those titles the count would stand under the cap (the missed skip of the first version of the check).
    expect(c.counted! - c.titlesCounted).toBeLessThan(c.cap);
    // The skip fires: the new sections are cards and no plan is asked for them, and no new node is kept.
    expect(r.merged.diagnostics.planSkips.some((x) => x.path === "added")).toBe(true);
    expect(r.merged.diagnostics.calls.plans.new).toBe(0);
    const before = new Set((r.a.previous.plan as VisualPlan).nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
    const fresh = planOf(r).nodes.filter((n) => n.type !== "group" && n.origin !== "plain" && n.stableKey && !before.has(n.stableKey) && !String(n.id).startsWith("more~"));
    expect(fresh.length).toBe(0);
  }, 90_000);

  it("titles are looked up by their exact key: the count is of the titles that exist, a section with no stored title adds none, and regenerated sections add none", async () => {
    const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    const c = record(r);
    const countedSections = c.sections.filter((x) => x.counted).length;
    expect(c.titlesCounted).toBeLessThanOrEqual(countedSections);
    expect(c.titlesCounted).toBeLessThanOrEqual(c.changedTitles);
  }, 90_000);

  it("a first import with room is still 'room' after the titles are counted: the count never reaches the cap, and never exceeds the fold's", async () => {
    const r = await world({ nodeChars: 300, newLeaves: NEW_LEAVES }).merge(true);
    const c = record(r);
    expect(c.answer).toBe("room");
    expect(c.counted!).toBeLessThan(c.cap);
    expect(c.counted!).toBeLessThanOrEqual(c.actualCounted!);
    expect(r.merged.diagnostics.planSkips.length).toBe(0);
  }, 90_000);

  it("only an economy, append-only merge is asked: economy off leaves no record", async () => {
    const off = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(false);
    expect(off.merged.diagnostics.capacity).toBeUndefined();
    const left = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(undefined);
    expect(left.merged.diagnostics.capacity).toBeUndefined();
  }, 120_000);

  it("the record does not change what is skipped (the same calls with the oracle answering as before)", async () => {
    const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    expect(record(r).answer).toBe("folds");
    expect(r.merged.diagnostics.planSkips.length).toBeGreaterThan(0);
    // Every orphan is listed with what became of it; in this world the first check is already full, so none is held.
    expect(record(r).orphans.length).toBeGreaterThan(0);
    expect(record(r).orphans.every((o) => !o.held && o.outcome === "skipped")).toBe(true);
    expect(record(r).hold).toBeUndefined();
    expect(r.merged.diagnostics.calls.plans).toEqual({ appended: 0, regenerated: 0, piece: 0, new: 0 });
  }, 90_000);
});

describe("what the review tells the user", () => {
  const labelOf = (key: string) => key.split(" › ").at(-1)!;

  it("skipped sections get their own notice, apart from the economy one: it says the plan was full, and names them; the economy notice and report.economy don't claim them", async () => {
    oracle.off = false;
    const r = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    const skips = r.merged.diagnostics.planSkips;
    expect(skips.length).toBeGreaterThan(0);
    const notice = r.merged.notices.find((n) => n.startsWith("The plan's 300-node limit is full"));
    expect(notice).toBeDefined();
    for (const s of skips.slice(0, 6)) expect(notice).toContain(`“${labelOf(s.section)}”`);
    expect(notice).toContain("folded into “More from this section” pages");
    expect(notice).not.toMatch(/economy/i);
    expect(r.merged.report.planSkipped).toEqual(skips.flatMap((s) => s.section.split(" ⨁ ")));
    // The economy notice is for sections economy mode handled by choice; it never names a skipped orphan, and the economy diagnostics don't count it.
    const economy = r.merged.notices.find((n) => n.startsWith("Economy import"));
    for (const s of skips) {
      if (economy) expect(economy).not.toContain(`“${labelOf(s.section)}”`);
      expect(r.merged.diagnostics.economy.map((e) => e.section)).not.toContain(s.section);
    }
    expect(r.merged.report.economy.length).toBeGreaterThan(0);
  }, 90_000);

  it("with the oracle off (every plan call made) or economy off there is no such notice and nothing is listed as skipped", async () => {
    oracle.off = true;
    const planned = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(true);
    oracle.off = false;
    const off = await world({ nodeChars: 78, newLeaves: NEW_LEAVES }).merge(false);
    for (const r of [planned, off]) {
      expect(r.merged.notices.some((n) => n.startsWith("The plan's 300-node limit is full"))).toBe(false);
      expect(r.merged.report.planSkipped).toEqual([]);
      expect(r.merged.diagnostics.planSkips).toEqual([]);
    }
    expect(off.merged.notices.some((n) => n.startsWith("Economy import"))).toBe(false);
  }, 120_000);
});

describe("roomy first import, economy on: nothing is skipped", () => {
  it("a new topic is planned by the model, as before", async () => {
    const w = world({ nodeChars: 300, newLeaves: NEW_LEAVES });
    const r = await w.merge(true);
    expect(r.merged.diagnostics.planSkips).toEqual([]);
    expect(w.count("generate_visual_plan")).toBeGreaterThan(0);
    expect(r.merged.diagnostics.calls.plans.new + r.merged.diagnostics.calls.plans.appended).toBeGreaterThan(0);
  }, 90_000);
});

describe("economy off: no behaviour change", () => {
  it("dense world, economy off or left out: the same calls and the same change set with the oracle on or off", async () => {
    const signature = async (economy: boolean | undefined, off: boolean) => {
      oracle.off = off;
      const w = world({ nodeChars: 78, newLeaves: NEW_LEAVES });
      const r = await w.merge(economy);
      oracle.off = false;
      return { calls: w.calls.map((c) => c.task).sort(), plans: r.merged.diagnostics.calls.plans, skips: r.merged.diagnostics.planSkips, set: JSON.stringify(r.merged.changeSet).replaceAll(r.a.source.id, "SRC") };
    };
    const left = await signature(undefined, false);
    const falseOn = await signature(false, false);
    const falseOff = await signature(false, true);
    expect(left.skips).toEqual([]);
    expect(falseOn.skips).toEqual([]);
    expect(falseOn).toEqual(falseOff);
    expect(left.set).toBe(falseOn.set);
    expect(falseOn.plans.new + falseOn.plans.appended).toBeGreaterThan(0);
  }, 180_000);
});
