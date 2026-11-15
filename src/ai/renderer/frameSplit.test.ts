/**
 * Frame splitting (organisation-layout plan §3.3, F6; v2 only): a section too large to read whole is drawn as parts
 * along its meaning boundaries, at render time, with every key unchanged. The plan's §4.1 list: a 3-sub-topic section
 * over budget → 3 frames each within budget; explanations stay with their card; a diagram, levelled, comparison or
 * small section never splits; no boundary → no split; keys unchanged; kn-01's single frame never splits.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProposedChange } from "@/ai/changes/changeSet";
import { parseChangeSet } from "@/ai/changes/changeSet";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { fitsScreen, groupParts, linkComponents, partFrameKey, partTitle, partTitleKey, splittable, SPLIT_MAX, type SplitUnit } from "./frameSplit";
import { geometryOf } from "./geometry";
import { layoutPlan, layoutPlanWithParts } from "./layout";
import { renderVisualPlan } from "./render";

const stubMarkdown = (md: string) => [{ type: "paragraph" as const, content: md }];
const LONG = "A card body long enough to wrap over several lines, so that the section grows the way distilled notes do. ".repeat(3);

async function render(plan: VisualPlan, organisation?: "v1" | "v2") {
  return renderVisualPlan(plan, {
    operationId: "op",
    title: "Visualize",
    metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock", operationId: "op" },
    context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 1000 } },
    parseMarkdown: stubMarkdown,
    ...(organisation ? { organisation } : {}),
  });
}

const frames = (changes: readonly ProposedChange[]) => changes.flatMap((c) => (c.kind === "create_frame" ? [c] : []));
const fits = (b: { width: number; height: number }) => b.width <= SPLIT_MAX.width && b.height <= SPLIT_MAX.height;

/**
 * One section of `topics` sub-topics (a heading each, then `cards` text cards), the first card of each explained by a
 * card of its own; and a small second section linked to the first topic.
 */
function bigPlan(options: { topics?: number; cards?: number; group?: Partial<Extract<VisualNode, { type: "group" }>>; headings?: boolean; link?: "chain" | "none" } = {}): VisualPlan {
  const { topics = 3, cards = 4, headings = true, link = "none" } = options;
  const nodes: VisualNode[] = [{ id: "g", type: "group", stableKey: "doc › Big#0 § group#0", content: { label: "Big section", arrangement: "grid", takeaway: "One long section." }, ...options.group } as VisualNode];
  const relationships: VisualRelationship[] = [];
  for (let t = 1; t <= topics; t++) {
    if (headings) nodes.push({ id: `h${t}`, type: "heading", parent: "g", stableKey: `doc › Big#0 § h${t}`, content: { text: `Topic ${"ABCDEFG"[t - 1]}` } });
    for (let c = 1; c <= cards; c++) nodes.push({ id: `t${t}c${c}`, type: "text", parent: "g", stableKey: `doc › Big#0 § t${t}c${c}`, title: `Topic ${t} card ${c}`, content: { markdown: LONG } });
    nodes.push({ id: `t${t}x`, type: "text", parent: "g", stableKey: `doc › Big#0 § t${t}x`, title: `Why ${t}`, content: { markdown: "Because the source says so." } });
    relationships.push({ from: `t${t}c1`, to: `t${t}x`, type: "explained_by", label: "why" });
    if (link === "chain") for (let c = 1; c < cards; c++) relationships.push({ from: `t${t}c${c}`, to: `t${t}c${c + 1}`, type: "flows_to" });
  }
  nodes.push({ id: "g2", type: "group", content: { label: "Small", arrangement: "grid" } }, { id: "s1", type: "text", parent: "g2", content: { markdown: "Small card." } }, { id: "s2", type: "text", parent: "g2", content: { markdown: "Another." } });
  relationships.push({ from: "s1", to: "t1c2", type: "relates_to", label: "see" });
  return { version: 1, template: "sectioned", nodes, relationships };
}

describe("frameSplit — pure rules", () => {
  it("fitsScreen: 3,200 × 1,800 is the most that reads whole at 50% zoom on 1600 × 900", () => {
    expect(fitsScreen({ width: 3200, height: 1800 })).toBe(true);
    expect(fitsScreen({ width: 3201, height: 100 })).toBe(false);
    expect(fitsScreen({ width: 100, height: 1801 })).toBe(false);
  });

  it("splittable: never a diagram, a Lens level, a comparison, or fewer than 4 core members", () => {
    const plan = bigPlan();
    const g = plan.nodes[0]!;
    expect(splittable(plan, g, 12)).toBe(true);
    expect(splittable(plan, g, 3)).toBe(false);
    const as = (content: object, role?: string) => ({ ...g, ...(role ? { role } : {}), content: { ...(g.type === "group" ? g.content : {}), ...content } }) as VisualNode;
    expect(splittable(plan, as({ diagram: "architecture" }), 12)).toBe(false);
    expect(splittable(plan, as({ level: 2 }), 12)).toBe(false);
    expect(splittable(plan, as({}, "comparison"), 12)).toBe(false);
    expect(splittable(plan, as({ arrangement: "compare" }), 12)).toBe(false);
    // A shape with a kind makes its section a diagram.
    const kinded: VisualPlan = { ...plan, nodes: [...plan.nodes, { id: "k", type: "shape", parent: "g", content: { shape: "rectangle", label: "API", kind: "backend" } }] };
    expect(splittable(kinded, g, 12)).toBe(false);
  });

  const unit = (id: string, core = 2, label?: string): SplitUnit => {
    const nodes = Array.from({ length: core }, (_, i) => ({ id: `${id}${i}`, type: "text", content: { markdown: "x" } }) as VisualNode);
    return { core: nodes, members: nodes, ...(label ? { label } : {}) };
  };

  it("groupParts: one part per sub-topic; a part under 2 core members joins its smaller neighbour", () => {
    const parts = groupParts([unit("a", 3), unit("b", 1), unit("c", 2)], "sub-topics", () => true);
    expect(parts.map((p) => p.map((u) => u.core[0]!.id[0]).join(""))).toEqual(["a", "bc"]);
    expect(groupParts([unit("a", 1), unit("b", 3)], "sub-topics", () => true)).toHaveLength(1);
  });

  it("groupParts: link components fill a part while it fits, so unlinked cards aren't cut into pairs", () => {
    const units = ["a", "b", "c", "d", "e"].map((id) => unit(id, 1));
    const parts = groupParts(units, "links", (p) => p.length <= 3);
    expect(parts.map((p) => p.length)).toEqual([3, 2]);
  });

  it("linkComponents: linked cards stay one component, explanations go with their card", () => {
    const n = (id: string) => ({ id, type: "text", content: { markdown: id } }) as VisualNode;
    const [a, b, c, x] = [n("a"), n("b"), n("c"), n("x")];
    const comps = linkComponents([a, b, c], [a, b, c, x], [{ from: "c", to: "a", type: "flows_to" }], new Map([["x", "b"]]));
    expect(comps.map((u) => u.core.map((m) => m.id))).toEqual([["a", "c"], ["b"]]);
    expect(comps[1]!.members.map((m) => m.id)).toEqual(["b", "x"]);
  });

  it("partTitle: the section's own label for part 1, 'Section — sub-topic' after, '(2 of 3)' without names", () => {
    expect(partTitle("Ops", [unit("a", 2, "Sizing")], 1, 3)).toBe("Ops");
    expect(partTitle("Ops", [unit("a", 2, "Timeouts")], 2, 3)).toBe("Ops — Timeouts");
    expect(partTitle("Ops", [unit("a", 2, "Leaks"), unit("b", 2, "Alerts")], 3, 3)).toBe("Ops — Leaks, Alerts");
    expect(partTitle("Ops", [unit("a", 2)], 2, 3)).toBe("Ops (2 of 3)");
    expect(partFrameKey("g", 1)).toBe("g");
    expect(partFrameKey("g", 2)).toBe("g::part2");
    expect(partTitleKey("g", 2)).toBe("g::part2::title");
  });
});

describe("frameSplit — rendered (organisation v2)", () => {
  it("a 3-sub-topic section over budget becomes 3 frames, each within budget, titled 'Section — sub-topic'", async () => {
    const plan = bigPlan();
    const v1 = frames((await render(plan)).changes);
    expect(v1.find((f) => f.key === "g")!.box).toSatisfy((b: { width: number; height: number }) => !fits(b));
    const set = await render(plan, "v2");
    expect(() => parseChangeSet(set)).not.toThrow();
    const drawn = frames(set.changes);
    const parts = drawn.filter((f) => f.key === "g" || f.key.startsWith("g::part"));
    expect(parts.map((f) => f.key)).toEqual(["g", "g::part2", "g::part3"]);
    for (const f of parts) expect(fits(f.box)).toBe(true);
    expect(parts.map((f) => f.overview?.title)).toEqual(["Big section", "Big section — Topic B", "Big section — Topic C"]);
    // The continuation titles are drawn inside their part, as section titles, with no stable key.
    for (const key of ["g::part2::title", "g::part3::title"]) {
      const title = set.changes.find((c) => c.kind === "create_block" && c.key === key);
      expect(title).toMatchObject({ fontSize: 36 });
      expect(title).not.toHaveProperty("stableNodeKey");
    }
    const g = geometryOf(set.changes, []);
    expect([g.cardOverlaps, g.frameOverlaps, g.outsideFrames, g.oversizedFrames]).toEqual([[], [], [], []]);
    expect(g.layout.counts.throughCards).toBe(0);
    // Parts read in order, right after the section.
    expect(g.readingOrder.inversions).toBe(0);
  });

  it("explanations stay with their card: each topic's explanation is in the same part as the card it explains", async () => {
    const drawn = frames((await render(bigPlan(), "v2")).changes);
    const partOf = (id: string) => drawn.find((f) => f.children.includes(id))?.key;
    for (let t = 1; t <= 3; t++) {
      expect(partOf(`t${t}x`)).toBe(partOf(`t${t}c1`));
      expect(partOf(`h${t}`)).toBe(partOf(`t${t}c1`));
    }
    expect(new Set([1, 2, 3].map((t) => partOf(`t${t}c1`))).size).toBe(3);
    // Part 1 keeps the section's title object and takeaway; later parts list their own title instead.
    expect(drawn.find((f) => f.key === "g")!.children.slice(0, 2)).toEqual(["g::title", "g::takeaway"]);
    expect(drawn.find((f) => f.key === "g::part2")!.children[0]).toBe("g::part2::title");
  });

  it("keys unchanged: every card and stable key a v1 render has, a v2 render has too, and the section's frame keeps its key", async () => {
    const plan = bigPlan();
    const keyed = (changes: readonly ProposedChange[]) => changes.flatMap((c) => ("key" in c && c.kind !== "create_frame" && !/::part\d+::title$/.test(c.key) ? [`${c.key}=${"stableNodeKey" in c ? c.stableNodeKey : ""}`] : [])).sort();
    const v1 = (await render(plan)).changes;
    const v2 = (await render(plan, "v2")).changes;
    // Only sub-topic backdrops differ: a part holding one sub-topic draws none (its frame names it).
    const noBackdrops = (keys: string[]) => keys.filter((k) => !/::cluster\d+=/.test(k));
    expect(noBackdrops(keyed(v2))).toEqual(noBackdrops(keyed(v1)));
    expect(frames(v2).some((f) => f.key === "g")).toBe(true);
    expect(v2.filter((c) => c.kind === "connect")).toHaveLength(plan.relationships.length);
  });

  it("a diagram, levelled, comparison or small section never splits, whatever its size", async () => {
    for (const group of [{ content: { label: "Big section", arrangement: "grid", diagram: "architecture" } }, { content: { label: "Big section", arrangement: "grid", level: 1 } }, { role: "comparison" }, { content: { label: "Big section", arrangement: "compare" } }] as const) {
      const { parts } = layoutPlanWithParts(bigPlan({ group: group as never }), { organisation: "v2" });
      expect(parts.size, JSON.stringify(group)).toBe(0);
    }
    // 3 core members: never split, however tall its cards.
    const small: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [{ id: "g", type: "group", content: { label: "S", arrangement: "stack" } }, ...[1, 2, 3].map((i) => ({ id: `n${i}`, type: "text", parent: "g", content: { markdown: LONG.repeat(6) } }) as VisualNode)],
      relationships: [],
    };
    expect(layoutPlanWithParts(small, { organisation: "v2" }).parts.size).toBe(0);
  });

  it("no boundary → no split: one link component without sub-topic headings stays one frame", async () => {
    const plan = bigPlan({ headings: false, link: "chain", topics: 7 });
    // Chain every topic's cards to the next topic's too: one component.
    const joins: VisualRelationship[] = [1, 2, 3, 4, 5, 6].map((t) => ({ from: `t${t}c4`, to: `t${t + 1}c1`, type: "flows_to" }));
    const joined: VisualPlan = { ...plan, relationships: [...plan.relationships, ...joins] };
    const { boxes, parts } = layoutPlanWithParts(joined, { organisation: "v2" });
    expect(parts.size).toBe(0);
    expect(fits(boxes.get("g")!)).toBe(false);
  });

  it("without sub-topics, separate link components split as 'Section (2 of N)'", async () => {
    const plan = bigPlan({ headings: false, link: "chain", topics: 4 });
    const { parts, boxes } = layoutPlanWithParts(plan, { organisation: "v2" });
    const split = parts.get("g")!;
    expect(split.length).toBeGreaterThanOrEqual(2);
    expect(split.slice(1).map((p) => p.title)).toEqual(split.slice(1).map((p) => `Big section (${p.index} of ${split.length})`));
    for (const p of split) expect(fits(boxes.get(p.key)!)).toBe(true);
    // A chain is never cut: each topic's cards share a part.
    for (let t = 1; t <= 4; t++) expect(new Set([1, 2, 3, 4].map((c) => split.find((p) => p.children.includes(`t${t}c${c}`))?.key)).size).toBe(1);
  });

  it("sub-groups are the first boundary: each sub-group goes to a part under its label", async () => {
    const plan = bigPlan({ headings: false, topics: 5 });
    const subs: VisualNode[] = [1, 2, 3, 4, 5].map((t) => ({ id: `sub${t}`, type: "group", parent: "g", content: { label: `Part ${t}`, arrangement: "grid" } }) as VisualNode);
    const nodes = [...plan.nodes.slice(0, 1), ...subs, ...plan.nodes.slice(1).map((n) => (/^t\d/.test(n.id) ? { ...n, parent: `sub${n.id[1]}` } : n))];
    const { parts } = layoutPlanWithParts({ ...plan, nodes }, { organisation: "v2" });
    const split = parts.get("g")!;
    expect(split.map((p) => p.title)).toEqual(["Big section", "Big section — Part 2", "Big section — Part 3", "Big section — Part 4", "Big section — Part 5"]);
    expect(split[1]!.children).toEqual(expect.arrayContaining(["t2c1", "t2x"]));
  });

  it("v1 never splits, and its layout is the same whether or not a split would apply", () => {
    const plan = bigPlan();
    expect(layoutPlanWithParts(plan).parts.size).toBe(0);
    expect([...layoutPlan(plan).keys()].some((k) => k.includes("::part"))).toBe(false);
  });

  it("is deterministic", async () => {
    expect(await render(bigPlan(), "v2")).toEqual(await render(bigPlan(), "v2"));
  });

  it("kn-01's single frame never splits", async () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "evaluation/knowledge-notes/cases/kn-01-idempotency-keys/reference/plan.json"), "utf8"));
    const plan = validateVisualPlan(raw).plan;
    expect(layoutPlanWithParts(plan, { organisation: "v2" }).parts.size).toBe(0);
    expect(frames((await render(plan, "v2")).changes)).toHaveLength(1);
  });
});
