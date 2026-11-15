/**
 * Stage 5f (intelligent-update-engine-plan §13.6): the locate evaluation set and its scorer.
 *
 * - The scorer and the canvas builder, on a small inline set.
 * - Both splits: schema, references, the authoring rules (action counts, low-overlap and trap minimums), and no
 *   sentence shared with any other evaluation material.
 * - **The held-out split is pinned by hash and never scored here.** Only dev is scored (today's router, as a baseline).
 *   `UPDATE_LOCATE_REPORT=1` writes `evaluation/update-engine/locate/baseline-dev.md`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateLocate,
  formatLocate,
  itemHolding,
  itemsOf,
  LOCATE_ACTIONS,
  locateSetSchema,
  problemsOf,
  rankingPredictor,
  rate,
  routerPredictor,
  scoreCase,
  worldOf,
  adjudicationsSchema,
  descentPredictor,
  withAdjudications,
  type LocateSet,
} from "./locateEvaluation";
import { hashedProvider, similarity, type EmbeddingProvider, type EmbeddingVector } from "./embeddingProvider";
import { LocalModelProvider } from "./localModelEmbedding";

const DIR = resolve("evaluation/update-engine/locate");
const load = (f: string): LocateSet => locateSetSchema.parse(JSON.parse(readFileSync(join(DIR, f), "utf8")));
/** Dev as scored: the split with its adjudications applied (the file itself is never edited). */
const loadDev = (): LocateSet => {
  const adj = join(DIR, "adjudications-dev.json");
  return existsSync(adj) ? withAdjudications(load("dev.json"), adjudicationsSchema.parse(JSON.parse(readFileSync(adj, "utf8")))) : load("dev.json");
};
const sha = (f: string) => createHash("sha256").update(readFileSync(join(DIR, f))).digest("hex");

/** Fixed once, the moment the held-out split was written and before anything was scored. Never edit heldout.json. */
const HELDOUT_SHA256 = "bf726cbe53c0a80c9a9555759978dd17b8fec2243b83c6a61b80ba8fd16cbebe";

/**
 * The counts each author was asked for (§13.6). The brief listed "clarify" as an action but also asked for the likelier
 * real action in `expected`; the authors resolved that by marking those cases `ambiguous` with a real action, so
 * ambiguous cases are counted on their own and the action counts are over the unambiguous cases.
 */
const SPEC = {
  dev: { cases: 60, canvases: 5, ambiguous: 5, actions: { replace_item: 10, after_item: 8, append: 8, table_row: 5, cell: 4, duplicate: 7, new_block: 7, new_section: 6, clarify: 0 }, low: 36, traps: 18 },
  heldout: { cases: 40, canvases: 4, ambiguous: 3, actions: { replace_item: 7, after_item: 5, append: 5, table_row: 4, cell: 3, duplicate: 5, new_block: 5, new_section: 3, clarify: 0 }, low: 24, traps: 12 },
} as const;

const TINY: LocateSet = {
  split: "dev",
  author: "test",
  date: "2026-11-14",
  canvases: [
    {
      id: "t1",
      title: "Release",
      sections: [
        {
          id: "t1s1",
          name: "Store review",
          cards: [
            { id: "t1c01", kind: "list", items: ["Submit the build on Monday.", "Apple review takes two days.", "Google review takes one day."] },
            { id: "t1c02", kind: "text", text: "Version 4.2 ships to all users on 3 March. Beta testers get it a week earlier." },
          ],
        },
        {
          id: "t1s2",
          name: "Crash reporting",
          cards: [
            { id: "t1c03", kind: "table", header: ["Platform", "Tool"], rows: [["iOS", "Crashlytics"], ["Android", "Sentry"]] },
            { id: "t1c04", kind: "todo", items: ["Add symbol upload to CI"] },
          ],
        },
      ],
    },
  ],
  cases: [
    {
      id: "T1",
      canvas: "t1",
      text: "Apple review takes three days now.",
      expected: { card: "t1c01", section: "t1s1", action: "replace_item", item: 1, column: null, row: null, relation: "SUPERSEDES" },
      acceptable: [],
      ambiguous: false,
      trap: null,
      overlap: "high",
      tags: [],
      why: "",
    },
    {
      id: "T2",
      canvas: "t1",
      text: "We should hire a dentist.",
      expected: { card: null, section: null, action: "new_section", item: null, column: null, row: null, relation: "NEW" },
      acceptable: [],
      ambiguous: false,
      trap: null,
      overlap: "low",
      tags: [],
      why: "",
    },
  ],
};

describe("5f — the scorer and the canvas builder", () => {
  it("the inline set is valid", () => {
    expect(problemsOf(TINY)).toEqual([]);
  });

  it("items are sentences, list/todo items and table data rows", () => {
    const cards = TINY.canvases[0]!.sections.flatMap((s) => s.cards);
    expect(itemsOf(cards[1]!)).toEqual(["Version 4.2 ships to all users on 3 March.", "Beta testers get it a week earlier."]);
    expect(itemsOf(cards[2]!)).toEqual(["iOS Crashlytics", "Android Sentry"]);
    expect(itemHolding(cards[0]!, "Apple review takes two days.")).toBe(1);
    expect(itemHolding(cards[0]!, "Something else entirely.")).toBeNull();
  });

  it("builds an index the router can read: lists, todos and tables included", () => {
    const w = worldOf(TINY.canvases[0]!);
    expect(w.index.get("t1c03")?.text).toMatch(/Crashlytics/);
    expect(w.index.get("t1c04")?.text).toMatch(/symbol upload/);
    expect(w.cards.get("t1c04")?.section).toBe("t1s2");
  });

  it("scores section, found, card, action and item separately", () => {
    const c = TINY.cases[0]!;
    const right = scoreCase(c, { action: "replace_item", card: "t1c01", section: "t1s1", item: 1, ranked: ["t1c01"] });
    expect(right).toMatchObject({ section: true, found1: true, found3: true, card: true, actionRight: true, item: true });
    const beside = scoreCase(c, { action: "new_block", card: null, near: "t1c01", section: "t1s1", item: null, ranked: ["t1c02", "t1c01"] });
    expect(beside).toMatchObject({ section: true, found1: true, card: false, actionRight: false });
    const ranker = scoreCase(c, { action: null, card: "t1c02", section: "t1s1", item: null, ranked: ["t1c02", "t1c03", "t1c01"] });
    expect(ranker).toMatchObject({ found1: false, found3: true });
    expect(ranker.actionRight).toBeUndefined();
    expect(scoreCase(TINY.cases[1]!, { action: "new_section", card: null, section: null, item: null, ranked: [] }).nowhere).toBe(true);
  });

  it("placed = destination, action and anchor together; after the last item reads as an append", () => {
    const c = TINY.cases[0]!;
    const count = (id: string) => ({ t1c01: 3, t1c02: 2, t1c03: 2, t1c04: 1 })[id];
    expect(scoreCase(c, { action: "replace_item", card: "t1c01", section: "t1s1", item: 1, ranked: ["t1c01"] }, count).placed).toBe(true);
    expect(scoreCase(c, { action: "replace_item", card: "t1c01", section: "t1s1", item: 0, ranked: ["t1c01"] }, count).placed).toBe(false);
    const appendCase = { ...c, expected: { ...c.expected, action: "append" as const, item: null, relation: "NEW" as const } };
    expect(scoreCase(appendCase, { action: "after_item", card: "t1c01", section: "t1s1", item: 2, ranked: ["t1c01"] }, count)).toMatchObject({ placed: true, actionRight: true });
    expect(scoreCase(appendCase, { action: "after_item", card: "t1c01", section: "t1s1", item: 1, ranked: ["t1c01"] }, count).placed).toBe(false);
  });

  it("adjudications apply over a split without editing it, and refuse a stale original", () => {
    const adj = { note: "", decisions: [{ case: "T1", original: TINY.cases[0]!.expected, adjudicated: { ...TINY.cases[0]!.expected, item: 2 }, rule: "r", decidedBy: "x", date: "d" }] };
    expect(withAdjudications(TINY, adj).cases[0]!.expected.item).toBe(2);
    expect(TINY.cases[0]!.expected.item).toBe(1);
    expect(() => withAdjudications(TINY, { ...adj, decisions: [{ ...adj.decisions[0]!, original: { ...adj.decisions[0]!.original, item: 0 } }] })).toThrow(/no longer matches/);
  });

  it("finds problems: unknown cards, out-of-range items, wrong card kinds", () => {
    const bad = structuredClone(TINY);
    bad.cases[0]!.expected.item = 9;
    bad.cases.push({ ...bad.cases[1]!, id: "T3", expected: { ...bad.cases[0]!.expected, card: "t1c02", action: "append", item: null } });
    bad.cases.push({ ...bad.cases[1]!, id: "T4", trap: "nope" });
    expect(problemsOf(bad)).toEqual(expect.arrayContaining([expect.stringMatching(/item 9 out of range/), expect.stringMatching(/append on a text card/), expect.stringMatching(/bad trap nope/)]));
  });

  it("runs end to end with the router and with a ranker", async () => {
    const router = await evaluateLocate(TINY, routerPredictor);
    expect(router).toHaveLength(2);
    const ranker = await evaluateLocate(TINY, rankingPredictor((t, w) => new Map([...w.cards.keys()].map((id) => [id, id === "t1c01" ? 1 : 0]))));
    expect(rate(ranker, "found1")).toEqual({ n: 1, d: 1 });
  });
});

for (const split of ["dev", "heldout"] as const) {
  const file = `${split}.json`;
  describe.skipIf(!existsSync(join(DIR, file)))(`5f — the ${split} split`, () => {
    it("parses, every reference resolves, and the authoring rules hold", () => {
      const set = load(file);
      const spec = SPEC[split];
      expect(set.split).toBe(split);
      expect(problemsOf(set)).toEqual([]);
      expect(set.cases).toHaveLength(spec.cases);
      expect(set.canvases).toHaveLength(spec.canvases);
      const clear = set.cases.filter((c) => !c.ambiguous);
      const counts = Object.fromEntries(LOCATE_ACTIONS.map((a) => [a, clear.filter((c) => c.expected.action === a).length]));
      expect(counts).toEqual(spec.actions);
      expect(set.cases.filter((c) => c.ambiguous)).toHaveLength(spec.ambiguous);
      expect(set.cases.filter((c) => c.overlap === "low").length).toBeGreaterThanOrEqual(spec.low);
      expect(set.cases.filter((c) => c.trap).length).toBeGreaterThanOrEqual(spec.traps);
    });
  });
}

describe.skipIf(!existsSync(join(DIR, "heldout.json")))("5f — held-out is sealed", () => {
  it("heldout.json is byte-for-byte what was written before anything was scored", () => {
    expect(sha("heldout.json")).toBe(HELDOUT_SHA256);
  });
});

describe.skipIf(!existsSync(join(DIR, "dev.json")) || !existsSync(join(DIR, "heldout.json")))("5f — no shared material", () => {
  it("no sentence of either split appears in the other or in any earlier evaluation material", () => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const textsOf = (set: LocateSet) => [...set.cases.map((c) => c.text), ...set.canvases.flatMap((cv) => cv.sections.flatMap((s) => s.cards.flatMap(itemsOf)))];
    const dev = new Set(textsOf(load("dev.json")).map(norm));
    const held = textsOf(load("heldout.json")).map(norm);
    expect(held.filter((t) => dev.has(t))).toEqual([]);
    const older: string[] = [];
    const probes = resolve("evaluation/update-engine/embedding-spike/probes.json");
    if (existsSync(probes)) {
      const p = JSON.parse(readFileSync(probes, "utf8")) as { pairs: { a: string; b: string }[]; canvas: { sections: { cards: { text: string }[] }[]; notes: { text: string }[] } };
      older.push(...p.pairs.flatMap((x) => [x.a, x.b]), ...p.canvas.sections.flatMap((s) => s.cards.map((c) => c.text)), ...p.canvas.notes.map((n) => n.text));
    }
    const consistency = resolve("evaluation/update-engine/consistency");
    for (const f of ["dev.json", "heldout.json", "regressions.json", "unseen/pairs.json", "unseen2/pairs.json", "unseen3/pairs.json"]) {
      const path = join(consistency, f);
      if (existsSync(path)) older.push(...(JSON.parse(readFileSync(path, "utf8")) as { pairs: { a: string; b: string }[] }).pairs.flatMap((x) => [x.a, x.b]));
    }
    const old = new Set(older.map(norm));
    expect([...dev, ...held].filter((t) => old.has(t))).toEqual([]);
  });
});

/** A ranker over a provider's vectors: each card embedded once (its indexed text, as the router sees it). */
function providerRanker(p: EmbeddingProvider) {
  const cache = new Map<string, Promise<Map<string, EmbeddingVector>>>();
  const cardsOf = (w: Parameters<Parameters<typeof rankingPredictor>[0]>[1]) => {
    let hit = cache.get(w.canvas.id);
    if (!hit) {
      const ids = [...w.cards.keys()];
      hit = p.embed(ids.map((id) => w.index.get(id)?.text ?? "")).then((vs) => new Map(ids.map((id, i) => [id, vs[i]!] as const)));
      cache.set(w.canvas.id, hit);
    }
    return hit;
  };
  return rankingPredictor(async (text, w) => {
    const [q] = await p.embed([text]);
    const cards = await cardsOf(w);
    return new Map([...cards].map(([id, v]) => [id, similarity(q!, v)] as const));
  });
}

describe.skipIf(process.env.EMBEDDING_SPIKE !== "1" || !existsSync(join(DIR, "dev.json")))("5f — dev, embedding rankers (opt-in EMBEDDING_SPIKE=1; never the held-out split)", () => {
  it(
    "ranks cards by the hashed embedder and by MiniLM-L6, by similarity alone",
    async () => {
      const dev = loadDev();
      const model = new LocalModelProvider("minilm-l6", { cacheDir: resolve(process.env.EMBEDDING_SPIKE_CACHE ?? "node_modules/.cache/acute-embedding-models"), allowDownload: true });
      expect((await model.ready()).state).toBe("ready");
      const text = [
        formatLocate("hashed embedder, similarity alone — dev", await evaluateLocate(dev, providerRanker(hashedProvider))),
        "",
        formatLocate("MiniLM-L6 (q8), similarity alone — dev", await evaluateLocate(dev, providerRanker(model))),
      ].join("\n");
      console.log(`\n${text}\n`);
      if (process.env.UPDATE_LOCATE_REPORT === "1")
        writeFileSync(join(DIR, "rankers-dev.md"), `# Locate evaluation — dev, embedding rankers\n\nGenerated by \`src/ai/router/locateEvaluation.test.ts\` (EMBEDDING_SPIKE=1 UPDATE_LOCATE_REPORT=1). Rankers decide no action, so only section, found@k and trapped apply. The held-out split is never scored here.\n\n${text}\n`);
    },
    5 * 60_000,
  );
});

describe.skipIf(!existsSync(join(DIR, "dev.json")))("5b–5c prototype on dev, hashed embedder (never the held-out split)", () => {
  it("scores the descent prototype with the hashed embedder and prints the table", async () => {
    const scores = await evaluateLocate(loadDev(), descentPredictor(hashedProvider, { ...HASHED_DESCENT }));
    console.log(`\n${formatLocate("5c descent prototype, hashed embedder — dev", scores)}\n`);
    expect(scores.length).toBe(SPEC.dev.cases);
  });
});

/** The hashed embedder's scores sit lower (§13.9): its own floors, scaled to its range. Provisional. */
const HASHED_DESCENT = { cardFloor: 0.1, sectionFloor: 0.05, itemMatch: 0.3, duplicate: 0.7, adjacency: 0.25, nowhereSectionGap: 0 } as const;

describe.skipIf(process.env.EMBEDDING_SPIKE !== "1" || !existsSync(join(DIR, "dev.json")))("5b–5c prototype on dev, MiniLM-L6 (opt-in EMBEDDING_SPIKE=1; never the held-out split)", () => {
  it(
    "scores the descent at its defaults, then searches a small grid of settings on dev",
    async () => {
      const dev = loadDev();
      const model = new LocalModelProvider("minilm-l6", { cacheDir: resolve(process.env.EMBEDDING_SPIKE_CACHE ?? "node_modules/.cache/acute-embedding-models"), allowDownload: true });
      expect((await model.ready()).state).toBe("ready");
      const shared = new Map();
      const hashedScores = await evaluateLocate(dev, descentPredictor(hashedProvider, { ...HASHED_DESCENT }));
      const defaults = await evaluateLocate(dev, descentPredictor(model, {}, shared));
      const grid: { o: Record<string, number>; placed: number; found1: number }[] = [];
      for (const itemWeight of [0.3, 0.5, 0.7])
        for (const sectionWeight of [0, 0.3, 0.6])
          for (const cardFloor of [0.25, 0.3, 0.35, 0.4])
            for (const itemMatch of [0.45, 0.55, 0.65])
              for (const adjacency of [0.4, 0.5, 0.6])
                for (const entityBonus of [0, 0.05]) {
                  const o = { itemWeight, sectionWeight, cardFloor, itemMatch, adjacency, entityBonus };
                  const s = await evaluateLocate(dev, descentPredictor(model, o, shared));
                  grid.push({ o, placed: rate(s, "placed").n, found1: rate(s, "found1").n });
                }
      grid.sort((a, b) => b.placed - a.placed || b.found1 - a.found1);
      // The duplicate line, swept around the best setting (it was fixed at 0.85 in the grid).
      const top = grid[0]!;
      for (const duplicate of [0.6, 0.65, 0.7, 0.75, 0.8, 0.9]) {
        const o = { ...top.o, duplicate };
        const s = await evaluateLocate(dev, descentPredictor(model, o, shared));
        grid.push({ o, placed: rate(s, "placed").n, found1: rate(s, "found1").n });
      }
      grid.sort((a, b) => b.placed - a.placed || b.found1 - a.found1);
      const best = grid[0]!;
      const tuned = await evaluateLocate(dev, descentPredictor(model, best.o, shared));
      const spread = grid.filter((g) => g.placed >= best.placed - 2).length;
      const text = [
        formatLocate("5c descent prototype, hashed embedder — dev", hashedScores),
        "",
        formatLocate("5c descent prototype, MiniLM-L6, default settings — dev", defaults),
        "",
        formatLocate(`5c descent prototype, MiniLM-L6, best of ${grid.length} settings on dev — ${JSON.stringify(best.o)}`, tuned),
        "",
        `Settings within 2 placements of the best: ${spread} of ${grid.length} (a flat optimum is less likely to be over-fitted to dev). Top 5: ${grid.slice(0, 5).map((g) => `${g.placed}/${dev.cases.length} ${JSON.stringify(g.o)}`).join(" · ")}`,
        "",
        "Per case (tuned): " + tuned.map((s) => `${s.id} ${s.placed ? "✓" : "✗"} ${s.predicted.action ?? "-"} ${s.predicted.card ?? s.predicted.section ?? "-"}${s.predicted.item != null ? `[${s.predicted.item}]` : ""}${s.predicted.column ? `.${s.predicted.column}` : ""}`).join(" · "),
      ].join("\n");
      console.log(`\n${text}\n`);
      if (process.env.UPDATE_LOCATE_REPORT === "1")
        writeFileSync(join(DIR, "descent-dev.md"), `# Locate evaluation — dev, 5b–5c descent prototype\n\nGenerated by \`src/ai/router/locateEvaluation.test.ts\` (EMBEDDING_SPIKE=1 UPDATE_LOCATE_REPORT=1). Dev only; the held-out split is never scored here. Settings were searched on dev, so the tuned row is optimistic — the held-out split is what tells.\n\n${text}\n`);
    },
    20 * 60_000,
  );
});

describe.skipIf(!existsSync(join(DIR, "dev.json")))("5f — dev baseline (today's router; never the held-out split)", () => {
  it("scores the Stage 2 router on dev and prints the table", async () => {
    const scores = await evaluateLocate(loadDev(), routerPredictor);
    const text = formatLocate("Stage 2 router (hashed embedder, unchanged weights) — dev", scores);
    console.log(`\n${text}\n`);
    if (process.env.UPDATE_LOCATE_REPORT === "1")
      writeFileSync(
        join(DIR, "baseline-dev.md"),
        `# Locate evaluation — dev baseline\n\nGenerated by \`src/ai/router/locateEvaluation.test.ts\` (UPDATE_LOCATE_REPORT=1). The held-out split is never scored here.\n\n${text}\n\nPer case: ${JSON.stringify(scores.map((s) => ({ id: s.id, top: s.predicted.card ?? s.predicted.near ?? null, action: s.predicted.action })))}\n`,
      );
    expect(scores.length).toBe(SPEC.dev.cases);
  });
});
