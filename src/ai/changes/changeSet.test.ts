import { describe, expect, it } from "vitest";
import {
  describeChanges,
  describeDropped,
  InvalidChangeSetError,
  MAX_CHANGES,
  parseChangeSet,
  proposedBounds,
  resolveChangeSet,
  summarizeChanges,
  type ChangeSet,
} from "./changeSet";
import { connectorEndpoints } from "./geometry";
import { PendingChanges } from "./pendingChanges";

const box = (x = 0, y = 0) => ({ x, y, width: 100, height: 50 });
const block = (key: string, x = 0) => ({ kind: "create_block", key, blockType: "text", content: [{ type: "paragraph", content: key }], box: box(x) });
const page = (key: string, x = 0) => ({ kind: "create_page", key, title: `Page ${key}`, content: [{ type: "paragraph", content: key }], box: box(x) });

function input(changes: unknown[], extra: Record<string, unknown> = {}) {
  return { operationId: "op_1", title: "Summary", metadata: { createdBy: "ai", task: "summarize", provider: "mock" }, changes, ...extra };
}

function problems(value: unknown): string[] {
  try {
    parseChangeSet(value);
  } catch (err) {
    if (err instanceof InvalidChangeSetError) return err.problems;
    throw err;
  }
  return [];
}

describe("parseChangeSet", () => {
  it("accepts a valid set and stamps the operation id into the provenance", () => {
    const set = parseChangeSet(
      input([
        block("a"),
        { kind: "create_shape", key: "b", shape: "diamond", label: "Gateway", box: box(200) },
        { kind: "connect", key: "c", from: { created: "a" }, to: { created: "b" }, relation: "depends_on" },
        { kind: "connect", key: "d", from: { existing: "el_1" }, to: { created: "a" } },
        { kind: "move", target: "el_2", to: { x: 5, y: 6 } },
      ]),
    );
    expect(set.changes).toHaveLength(5);
    expect(set.metadata).toEqual({ createdBy: "ai", task: "summarize", provider: "mock", operationId: "op_1" });
  });

  it("rejects malformed input with every problem listed and returns nothing partial", () => {
    expect(problems(input([]))).toHaveLength(1); // no changes
    expect(problems({ ...input([block("a")]), metadata: { createdBy: "user" } }).join()).toMatch(/metadata/);
    expect(problems(input([{ ...block("a"), box: { x: 0, y: 0, width: -1, height: 10 } }])).join()).toMatch(/box/);
    expect(problems(input([{ ...block("a"), box: { x: Number.NaN, y: 0, width: 10, height: 10 } }])).join()).toMatch(/box/);
    expect(problems(input([{ ...block("a"), content: [{ type: "script" }] }])).join()).toMatch(/content/);
    expect(problems(input([{ kind: "delete", target: "el_1" }])).join()).toMatch(/kind/);
    expect(problems(input([{ kind: "connect", key: "c", from: { created: "a" }, to: { existing: "x" }, relation: "loves" }])).join()).toMatch(/relation/);
  });

  it("checks references between its own changes", () => {
    const found = problems(
      input([
        block("a"),
        block("a"),
        { kind: "connect", key: "c", from: { created: "a" }, to: { created: "ghost" } },
        { kind: "connect", key: "d", from: { created: "a" }, to: { created: "a" } },
        { kind: "connect", key: "e", from: { created: "a" }, to: { created: "c" } }, // a connection is not an object
        { kind: "move", target: "x", to: { x: 0, y: 0 } },
        { kind: "move", target: "x", to: { x: 1, y: 1 } },
      ]),
    );
    expect(found).toEqual([
      'changes.1: duplicate key "a"',
      'changes.6: "x" is moved twice',
      'changes.2: connects to unknown object "ghost"',
      "changes.3: connects an object to itself",
      'changes.4: connects to unknown object "c"',
    ]);
  });

  it("caps the size of a set", () => {
    const many = Array.from({ length: MAX_CHANGES + 1 }, (_, i) => block(`k${i}`));
    expect(problems(input(many))).toHaveLength(1);
    expect(problems(input(many.slice(0, MAX_CHANGES)))).toEqual([]);
  });

  it("accepts create_page (F30): a new page, connectable and countable like any other created object", () => {
    const set = parseChangeSet(input([page("p"), { kind: "connect", key: "c", from: { existing: "el_1" }, to: { created: "p" } }]));
    expect(set.changes).toEqual([
      { kind: "create_page", key: "p", title: "Page p", content: [{ type: "paragraph", content: "p" }], box: box(0) },
      { kind: "connect", key: "c", from: { existing: "el_1" }, to: { created: "p" } },
    ]);
    expect(problems(input([{ ...page("p"), title: "" }])).join()).toMatch(/title/);
  });
});

describe("parseChangeSet — a split set (F42 Phase 4)", () => {
  const split = { sourceId: "src_1", version: 2, of: "Plan#table0", fingerprint: "t456" };

  it("carries the split block's source link to the writer", () => {
    expect(parseChangeSet(input([block("a")], { split })).split).toEqual(split);
  });

  it("is never also a content version", () => {
    const contentSource = { sourceId: "src_1", version: 3, origin: "paste", tier: "local", template: "sectioned", text: "x", plan: {} };
    expect(problems(input([block("a")], { split, contentSource }))).toEqual([expect.stringMatching(/^split:/)]);
  });
});

describe("resolveChangeSet", () => {
  const set: ChangeSet = parseChangeSet(
    input([
      block("a"),
      block("b", 300),
      { kind: "connect", key: "ab", from: { created: "a" }, to: { created: "b" } },
      { kind: "connect", key: "xa", from: { existing: "x" }, to: { created: "a" } },
      { kind: "connect", key: "ay", from: { created: "a" }, to: { existing: "y" } },
      { kind: "move", target: "y", to: { x: 0, y: 0 } },
    ]),
  );

  it("keeps everything while the referenced objects are live", () => {
    const r = resolveChangeSet(set, () => true);
    expect(r.changes).toHaveLength(6);
    expect(r.dropped).toEqual([]);
  });

  it("drops (and reports) only the changes that refer to a deleted object", () => {
    const r = resolveChangeSet(set, (id) => id !== "y");
    expect(r.changes.map((c) => ("key" in c ? c.key : "move"))).toEqual(["a", "b", "ab", "xa"]);
    expect(r.dropped.map((d) => [d.change.kind, d.reason])).toEqual([
      ["connect", "object_deleted"],
      ["move", "object_deleted"],
    ]);
    expect(describeDropped(r.dropped)).toBe("2 changes were skipped: objects they refer to were deleted.");
    expect(describeDropped([])).toBeNull();
  });
});

describe("summaries and geometry", () => {
  it("describes what a set does", () => {
    const one = parseChangeSet(input([block("a")]));
    expect(describeChanges(one.changes)).toBe("1 block");
    const linked = parseChangeSet(input([block("a"), { kind: "connect", key: "c", from: { existing: "x" }, to: { created: "a" } }]));
    expect(describeChanges(linked.changes)).toBe("1 block · 1 connection");
    const mixed = parseChangeSet(
      input([
        block("a"),
        { kind: "create_shape", key: "b", shape: "ellipse", box: box() },
        { kind: "connect", key: "c", from: { created: "a" }, to: { created: "b" } },
        { kind: "move", target: "x", to: { x: 0, y: 0 } },
      ]),
    );
    expect(describeChanges(mixed.changes)).toBe("2 objects · 1 connection · 1 move");
    // A page alongside blocks isn't "blocks" either — it's "objects".
    expect(describeChanges(parseChangeSet(input([block("a"), page("p")])).changes)).toBe("2 objects");
  });

  it("counts sections, unless the caller already names them (a merged F43 set)", () => {
    const framed = parseChangeSet(input([block("a"), { kind: "create_frame", key: "f", title: "Relay", box: box(), children: ["a"] }]));
    expect(describeChanges(framed.changes)).toBe("1 section · 1 block");
    expect(describeChanges(framed.changes, { omitSections: true })).toBe("1 block");
  });

  it("bounds created boxes and move destinations", () => {
    const set = parseChangeSet(input([block("a", 0), block("b", 300), { kind: "move", target: "x", to: { x: -50, y: 400 } }]));
    const b = proposedBounds(set.changes, (id) => (id === "x" ? { x: 0, y: 0, width: 10, height: 20 } : undefined));
    expect(b).toEqual({ x: -50, y: 0, width: 450, height: 420 });
  });

  it("connects facing sides", () => {
    expect(connectorEndpoints(box(0), box(300))).toEqual({ start: { x: 108, y: 25 }, end: { x: 292, y: 25 } });
    expect(connectorEndpoints(box(0, 0), box(0, 300))).toEqual({ start: { x: 50, y: 58 }, end: { x: 50, y: 292 } });
  });
});

describe("PendingChanges", () => {
  it("holds one validated set per canvas; settling a stale id leaves a newer proposal", () => {
    const pending = new PendingChanges();
    let notified = 0;
    pending.subscribe(() => notified++);
    expect(() => pending.propose("cv_1", input([]))).toThrow(InvalidChangeSetError);
    expect(pending.get("cv_1")).toBeNull();

    pending.propose("cv_1", input([block("a")]));
    pending.propose("cv_1", input([block("b")], { operationId: "op_2" }));
    pending.propose("cv_2", input([block("c")]));
    expect(pending.get("cv_1")?.operationId).toBe("op_2");

    pending.settle("cv_1", "op_1"); // the replaced one: no-op
    expect(pending.get("cv_1")?.operationId).toBe("op_2");
    pending.settle("cv_1", "op_2");
    expect(pending.get("cv_1")).toBeNull();
    expect(pending.get("cv_2")).not.toBeNull();
    expect(notified).toBe(4);
  });
});

describe("reconciliation changes (F37-F39)", () => {
  const update = { kind: "update_block", target: "el_1", content: [{ type: "paragraph", content: "new" }], stableNodeKey: "Plan#text0" };
  const source = { sourceId: "src_1", version: 2, origin: "paste", tier: "local", template: "action_plan", text: "# Plan", plan: { version: 1 } };

  it("accepts updates, removals and baselines of existing objects, plus the content source and conflicts", () => {
    const set = parseChangeSet(
      input(
        [
          update,
          { kind: "update_shape", target: "el_2", label: "API v2", stableNodeKey: "U § shape#0" },
          { kind: "remove", target: "el_3" },
          { kind: "rebaseline", target: "el_4", stableNodeKey: "k" },
          { ...block("a"), stableNodeKey: "Plan#todo0" },
        ],
        {
          contentSource: source,
          conflicts: [{ target: "el_5", stableNodeKey: "k5", apply: { ...update, target: "el_5" }, keep: { kind: "rebaseline", target: "el_5", stableNodeKey: "k5" } }],
        },
      ),
    );
    expect(set.contentSource).toEqual(source);
    expect(set.conflicts).toHaveLength(1);
    expect(describeChanges(set.changes)).toBe("1 block · 2 updates · 1 removal");
  });

  it("allows a set of only conflicts, but not an empty one; one change per existing object", () => {
    const conflict = { target: "el_5", stableNodeKey: "k5", apply: { ...update, target: "el_5" }, keep: { kind: "rebaseline", target: "el_5", stableNodeKey: "k5" } };
    expect(problems(input([], { conflicts: [conflict] }))).toEqual([]);
    expect(problems(input([]))).toHaveLength(1);
    expect(problems(input([update, { kind: "remove", target: "el_1" }]))).toEqual(['changes.1: "el_1" is changed twice']);
  });

  it("drops (and reports) updates and removals of objects deleted since", () => {
    const set = parseChangeSet(input([update, { kind: "remove", target: "el_9" }, block("a")]));
    const r = resolveChangeSet(set, (id) => id !== "el_9");
    expect(r.changes.map((c) => c.kind)).toEqual(["update_block", "create_block"]);
    expect(r.dropped.map((d) => d.change.kind)).toEqual(["remove"]);
  });
});

describe("update_node (D43)", () => {
  const node = (semantics: unknown, target = "el_1") => ({ kind: "update_node", target, semantics });
  const patchOf = (semantics: unknown) => {
    const c = parseChangeSet(input([node(semantics)])).changes[0]!;
    if (c.kind !== "update_node") throw new Error("not update_node");
    return c.semantics;
  };

  it("parses a valid patch and keeps null as a clear", () => {
    expect(patchOf({ kind: "decision", status: "proposed", reason: "why", reasonX: 1, sublabel: null, refs: ["a", "b"], order: 3 })).toEqual({
      kind: "decision",
      status: "proposed",
      reason: "why",
      sublabel: null,
      refs: ["a", "b"],
      order: 3,
    });
  });

  it("strips Lens keys and unknown keys", () => {
    const patch = patchOf({ status: "done", key: "k", expandsTo: { frameKey: "f" }, sources: [{ path: "a.ts" }], nope: 1 });
    expect(patch).toEqual({ status: "done" });
    expect(Object.keys(patch)).not.toContain("key");
  });

  it("drops a bad or oversized field alone", () => {
    expect(patchOf({ kind: "nonsense", status: "done", reason: "x".repeat(501), severity: "extreme", tag: "t" })).toEqual({ status: "done", tag: "t" });
  });

  it("rejects an empty target", () => {
    expect(problems(input([node({ status: "done" }, "")]))).toHaveLength(1);
  });

  it("counts as an update and refuses two changes to one object", () => {
    const set = parseChangeSet(input([node({ status: "done" })]));
    expect(summarizeChanges(set.changes).updated).toBe(1);
    expect(describeChanges(set.changes)).toBe("1 update");
    expect(problems(input([node({ status: "done" }), node({ tag: "x" })]))).toHaveLength(1);
  });
});

describe("set_lens (D43)", () => {
  const lens = (fields: Record<string, unknown>, target = "el_1") => ({ kind: "set_lens", target, ...fields });

  it("parses a level, a drill link, and null as a clear", () => {
    const set = parseChangeSet(input([lens({ level: 2 }), lens({ expandsTo: { frameKey: "pay-detail", canvasId: "cv_2" } }, "el_2"), lens({ expandsTo: null, level: null }, "el_3")]));
    expect(set.changes).toEqual([
      { kind: "set_lens", target: "el_1", level: 2 },
      { kind: "set_lens", target: "el_2", expandsTo: { frameKey: "pay-detail", canvasId: "cv_2" } },
      { kind: "set_lens", target: "el_3", expandsTo: null, level: null },
    ]);
    expect(describeChanges(set.changes)).toBe("3 updates");
  });

  it("rejects nothing to set, a level past L5, and stray fields in the link", () => {
    expect(problems(input([lens({})]))).toHaveLength(1);
    expect(problems(input([lens({ level: 6 })]))).toHaveLength(1);
    expect(problems(input([lens({ expandsTo: { frameKey: "f", key: "x" } })]))).toHaveLength(1);
    expect(problems(input([lens({ expandsTo: { frameKey: "" } })]))).toHaveLength(1);
  });
});

describe("parseChangeSet — the content source keeps everything a version needs", () => {
  it("keeps renamed sections' ids (G1) and where the text changed its mind (G3.3) — dropping them broke the next update", () => {
    const set = parseChangeSet({
      operationId: "op",
      title: "Update from new content",
      metadata: { createdBy: "ai" },
      changes: [{ kind: "update_shape", target: "el_1", label: "Team", stableNodeKey: "Launch › Team § shape#0" }],
      contentSource: {
        sourceId: "src_1",
        version: 2,
        origin: "paste",
        tier: "ai",
        template: "sectioned",
        text: "## Team\n\nPayments team.",
        plan: { version: 1, template: "sectioned", nodes: [], relationships: [] },
        pathIds: { "Launch › Team": "Launch › Owners" },
        revisions: [{ unit: "Launch › Team", earlier: "Two engineers.", later: "Actually, three engineers." }],
      },
    });
    expect(set.contentSource?.pathIds).toEqual({ "Launch › Team": "Launch › Owners" });
    expect(set.contentSource?.revisions).toEqual([{ unit: "Launch › Team", earlier: "Two engineers.", later: "Actually, three engineers." }]);
  });
});
