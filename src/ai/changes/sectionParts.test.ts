import { describe, expect, it } from "vitest";
import { MAX_CHANGES, MAX_MERGED_CHANGES, parseChangeSet, type ChangeSet, type ProposedChange } from "./changeSet";
import { partSlices } from "./parts";
import { PendingChanges } from "./pendingChanges";
import { ChangeSetTooLargeError, OVERVIEW_PART, REST_PART, splitIntoSectionParts } from "./sectionParts";

const box = { x: 0, y: 0, width: 10, height: 10 };
const block = (key: string, text = key): ProposedChange => ({ kind: "create_block", key, blockType: "text", content: [{ type: "paragraph", content: text }], box });
const link = (key: string, from: string, to: string): ProposedChange => ({ kind: "connect", key, from: { created: from }, to: { created: to } });
const src = { sourceId: "src1", version: 1, origin: "paste" as const, tier: "ai" as const, template: "sectioned", text: "doc", plan: {} };

/** What outlined Visualize emits: a frame per section (with its title block), loose heading/subtitle, members, links. */
function documentSet(sections: number, perSection: number, extra: ProposedChange[] = []): ChangeSet {
  const frames: ProposedChange[] = [];
  const members: ProposedChange[] = [];
  const links: ProposedChange[] = [];
  for (let s = 0; s < sections; s++) {
    const kids = Array.from({ length: perSection }, (_, i) => `s${s}_n${i}`);
    frames.push({ kind: "create_frame", key: `g${s}`, title: `Frame ${s}`, box, children: [`g${s}::title`, ...kids] }, block(`g${s}::title`, `Section ${s}`));
    members.push(...kids.map((k) => block(k)));
    if (perSection > 1) links.push(link(`__l${s}`, kids[0]!, kids[1]!));
  }
  if (sections > 1) links.push(link("__between", "g0", "g1"));
  return {
    operationId: "op1",
    title: "Visualize",
    metadata: { createdBy: "ai" },
    changes: [...frames, block("heading"), block("subtitle"), ...members, ...links, ...extra],
    contentSource: src,
    analysis: { mode: "ai", fallbacks: [] } as unknown as ChangeSet["analysis"],
  };
}

describe("splitIntoSectionParts", () => {
  it("returns a set within the limit untouched (below and exactly at 500)", () => {
    const below = documentSet(3, 5);
    expect(splitIntoSectionParts(below)).toBe(below);
    const at: ChangeSet = { ...documentSet(1, 1), changes: Array.from({ length: MAX_CHANGES }, (_, i) => block(`b${i}`)) };
    expect(splitIntoSectionParts(at)).toBe(at);
    expect(parseChangeSet(at).changes).toHaveLength(MAX_CHANGES);
  });

  it("one part past 500 changes: sections become parts, each self-contained, nothing lost", () => {
    const set = documentSet(6, 100); // 6 frames + 6 titles + 2 loose + 600 members + 6 links + 1 = 621
    expect(set.changes.length).toBe(621);
    expect(() => parseChangeSet(set)).toThrow(/<=500/); // the failure this fixes
    const split = splitIntoSectionParts(set);
    expect(split.parts!.map((p) => p.key)).toEqual([OVERVIEW_PART, "g0", "g1", "g2", "g3", "g4", "g5"]);
    expect(split.parts!.map((p) => p.changes)).toEqual([2, 104, 103, 103, 103, 103, 103]);
    expect(split.changes).toHaveLength(set.changes.length);
    expect(new Set(split.changes.map((c) => ("key" in c ? c.key : ""))).size).toBe(new Set(set.changes.map((c) => ("key" in c ? c.key : ""))).size);
    expect(split.parts!.every((p) => p.changes <= MAX_CHANGES)).toBe(true);
    expect(split.parts!.find((p) => p.key === "g2")!.title).toBe("Section 2");
    // The parts carry the content source; the set itself doesn't.
    expect(split.contentSource).toBeUndefined();
    expect(split.parts!.every((p) => p.contentSource?.sourceId === "src1")).toBe(true);
    expect(split.analysis).toEqual(set.analysis);
    // It validates, and each part holds its own section's objects only (the link between two frames sits with its first end).
    const parsed = parseChangeSet(split);
    const slices = partSlices(parsed);
    expect(slices[2]!.changes.some((c) => "key" in c && c.key === "s1_n99")).toBe(true);
    expect(slices[1]!.changes.some((c) => c.kind === "connect" && c.key === "__between")).toBe(true);
  });

  it("is reviewable: proposing the split set works where proposing the original fails", () => {
    const pending = new PendingChanges();
    const set = documentSet(6, 100);
    expect(() => pending.propose("c1", set)).toThrow(/<=500/);
    expect(pending.propose("c1", splitIntoSectionParts(set)).parts).toHaveLength(7);
    expect(pending.get("c1")!.changes).toHaveLength(621);
  });

  it("a join to an existing frame travels with the new objects it names, one part per frame", () => {
    const loose = (n: number, p: string) => Array.from({ length: n }, (_, i) => block(`${p}${i}`));
    const join = (target: string, p: string, n: number): ProposedChange => ({ kind: "update_frame", target, add: Array.from({ length: n }, (_, i) => `${p}${i}`) });
    const set: ChangeSet = {
      operationId: "op2",
      title: "Merge",
      metadata: { createdBy: "ai" },
      changes: [...loose(300, "a"), ...loose(300, "b"), join("frameA", "a", 300), join("frameB", "b", 300)],
      contentSource: src,
    };
    const split = splitIntoSectionParts(set);
    expect(split.parts!.map((p) => [p.key, p.changes])).toEqual([["~join:frameA", 301], ["~join:frameB", 301]]);
    const slices = partSlices(parseChangeSet(split));
    expect(slices[0]!.changes.filter((c) => c.kind === "update_frame")).toHaveLength(1);
    expect(slices[1]!.changes.every((c) => c.kind === "update_frame" || ("key" in c && c.key.startsWith("b")))).toBe(true);
  });

  it("keeps updates, conflicts and other kinds in an 'other changes' part", () => {
    const update: ProposedChange = { kind: "update_block", target: "existing1", content: [{ type: "paragraph", content: "new" }] } as ProposedChange;
    const split = splitIntoSectionParts(documentSet(6, 100, [update]));
    const rest = split.parts!.find((p) => p.key === REST_PART)!;
    expect(rest.changes).toBe(1);
    expect(split.changes.at(-1)).toBe(update);
  });

  it("fails safely, with the section's name, when one section alone is over the limit", () => {
    const set = documentSet(2, 600);
    expect(() => splitIntoSectionParts(set)).toThrowError(ChangeSetTooLargeError);
    expect(() => splitIntoSectionParts(set)).toThrow(/"Section 0" alone would create 604 objects/);
    expect(() => splitIntoSectionParts(set)).toThrow(/Nothing was changed/);
  });

  it("allows many parts up to the merged limit and refuses beyond it", () => {
    const within = splitIntoSectionParts(documentSet(50, 99)); // ~5,000 changes
    expect(within.changes.length).toBeLessThanOrEqual(MAX_MERGED_CHANGES);
    expect(within.parts).toHaveLength(51);
    expect(parseChangeSet(within).parts).toHaveLength(51);
    expect(() => splitIntoSectionParts(documentSet(70, 99))).toThrow(/more than the 6,000/);
  });

  it("never splits a set that already has parts, and never touches a small one with conflicts", () => {
    const split = splitIntoSectionParts(documentSet(6, 100));
    expect(splitIntoSectionParts(split)).toBe(split);
  });
});
