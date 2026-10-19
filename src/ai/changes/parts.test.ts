import { describe, expect, it } from "vitest";
import { MAX_CHANGES, parseChangeSet, type ChangeSet, type ProposedChange } from "./changeSet";
import { acceptParts, mergeSets, partSlices, withoutParts } from "./parts";
import { PendingChanges, PendingReviewError } from "./pendingChanges";

const block = (key: string): ProposedChange => ({ kind: "create_block", key, blockType: "text", content: [{ type: "paragraph", content: key }], box: { x: 0, y: 0, width: 10, height: 10 } });
const link = (key: string, from: string, to: string): ProposedChange => ({ kind: "connect", key, from: { created: from }, to: { created: to } });
const src = (id: string) => ({ sourceId: id, version: 1, origin: "mcp" as const, tier: "ai" as const, template: "sectioned", text: id, plan: {} });

function set(parts: { key: string; changes: ProposedChange[] }[], op = "op1"): ChangeSet {
  return {
    operationId: op,
    title: "Repo map",
    metadata: { createdBy: "mcp" },
    mergeKey: "repomap:m",
    changes: parts.flatMap((p) => p.changes),
    parts: parts.map((p) => ({ key: p.key, title: p.key, changes: p.changes.length, conflicts: 0, contentSource: src(p.key) })),
  };
}

describe("merged change sets (F43)", () => {
  it("parts must cover the changes exactly; a merged set may exceed one producer's cap", () => {
    expect(() => parseChangeSet({ ...set([{ key: "a", changes: [block("a1")] }]), parts: [{ key: "a", title: "a", changes: 2, conflicts: 0 }] })).toThrow(/cover 2 changes/);
    const big = Array.from({ length: MAX_CHANGES + 10 }, (_, i) => block(`b${i}`));
    expect(() => parseChangeSet({ operationId: "o", title: "t", metadata: { createdBy: "mcp" }, changes: big })).toThrow(/<=500/);
    expect(parseChangeSet(set([{ key: "a", changes: big.slice(0, 400) }, { key: "b", changes: big.slice(400) }])).changes).toHaveLength(big.length);
  });

  it("a part may link to another part's objects only when merged", () => {
    const incoming = set([{ key: "b", changes: [block("b1"), link("x", "b1", "a1")] }]);
    expect(() => parseChangeSet(incoming)).toThrow(/unknown object "a1"/);
    expect(parseChangeSet(incoming, { externalKeys: new Set(["a1"]) }).changes).toHaveLength(2);
  });

  it("merge replaces a section's part in place, appends new ones, and drops links to objects no part creates", () => {
    const current = set([{ key: "a", changes: [block("a1"), block("a2")] }, { key: "b", changes: [block("b1"), link("x", "b1", "a2")] }]);
    const merged = mergeSets(current, set([{ key: "a", changes: [block("a1")] }, { key: "c", changes: [block("c1")] }], "op2"))!;
    expect(merged.operationId).toBe("op1");
    expect(merged.parts!.map((p) => p.key)).toEqual(["a", "b", "c"]);
    expect(partSlices(merged)[1]!.changes.map((c) => ("key" in c ? c.key : ""))).toEqual(["b1"]);
    expect(withoutParts(merged, new Set(["a", "b", "c"]))).toBeNull();
  });

  it("PendingChanges.merge joins a set of the same merge key; another proposal waits beside it unless both change one object (D40)", () => {
    const pending = new PendingChanges();
    pending.merge("cv", set([{ key: "a", changes: [block("a1")] }]));
    pending.merge("cv", set([{ key: "b", changes: [block("b1"), link("x", "b1", "a1")] }], "op9"));
    expect(pending.get("cv")!.parts!.map((p) => p.key)).toEqual(["a", "b"]);
    const other = new PendingChanges();
    const move = (target: string) => ({ kind: "move" as const, target, to: { x: 1, y: 1 } });
    other.propose("cv", { operationId: "v", title: "Visualize", metadata: { createdBy: "ai" }, changes: [block("z"), move("shared")] });
    // A section that changes nothing the proposal changes waits in its own slot.
    other.merge("cv", set([{ key: "a", changes: [block("a1")] }]));
    expect(other.list("cv").map((s) => s.operationId)).toHaveLength(2);
    // One that moves the same object is refused, naming the proposal in the way.
    expect(() => other.merge("cv", set([{ key: "b", changes: [move("shared")] }], "op9"))).toThrow(/“Visualize” is under review/);
    expect(() => other.merge("cv", set([{ key: "b", changes: [move("shared")] }], "op9"))).toThrow(PendingReviewError);
  });

  it("accepting one part writes it in one step with its own content version; a link to a pending part waits there", () => {
    const s = parseChangeSet(set([{ key: "a", changes: [block("a1")] }, { key: "b", changes: [block("b1"), link("x", "b1", "a1")] }]));
    const writes: { source?: string; keys: string[] }[] = [];
    let n = 0;
    const canvas = () => ({
      boxOf: (id: string) => (id.startsWith("id") ? { x: 0, y: 0, width: 1, height: 1 } : undefined),
      write: (sub: ChangeSet, changes: readonly ProposedChange[]) => {
        writes.push({ ...(sub.contentSource ? { source: sub.contentSource.sourceId } : {}), keys: changes.map((c) => ("key" in c ? c.key : c.kind)) });
        return new Map(changes.flatMap((c) => ("key" in c ? [[c.key, `id${++n}`] as const] : [])));
      },
    });
    let steps = 0;
    const history = { record: (m: () => void) => (m(), ++steps) };
    const r = acceptParts(s, new Set(["b"]), new Map(), canvas, history);
    expect(steps).toBe(1);
    expect(writes).toEqual([{ source: "b", keys: ["b1"] }]);
    expect(r.accepted.map((p) => p.key)).toEqual(["b"]);
    const rest = parseChangeSet(r.rest);
    expect(rest.parts!.map((p) => p.key)).toEqual(["a"]);
    expect(rest.changes[1]).toMatchObject({ kind: "connect", from: { existing: "id1" }, to: { created: "a1" } });

    const all = acceptParts(rest, null, new Map(), canvas, history);
    expect(all.rest).toBeNull();
    expect(writes.at(-1)).toEqual({ source: "a", keys: ["a1", "x"] });
  });
});
