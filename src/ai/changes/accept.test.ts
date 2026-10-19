/**
 * F19's transaction rules, deterministically: accept, reject, partial
 * failure (a referenced object deleted mid-review) and undo, against the real
 * canvas history and an in-memory scene standing in for the renderer.
 */
import { describe, expect, it } from "vitest";
import { CanvasHistory } from "@/history/canvasHistory";
import { acceptChangeSet, type ChangeSetCanvas } from "./accept";
import { parseChangeSet, type ChangeSet, type ProposedChange } from "./changeSet";
import { PendingChanges } from "./pendingChanges";

interface El {
  id: string;
  version: number;
  index: string;
  isDeleted: boolean;
  x: number;
  y: number;
  kind: string;
  from?: string;
  to?: string;
  operationId?: string;
}

function setup() {
  let scene: El[] = [];
  let writes = 0;
  const history = new CanvasHistory<El>({
    getElements: () => scene,
    apply: (elements) => (scene = elements),
    bump: (t, above) => ({ ...t, version: above + 1 }),
    markDeleted: (el) => ({ ...el, isDeleted: true }),
  });
  history.init(scene);
  const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted);
  let n = 0;
  const add = (el: Omit<El, "version" | "isDeleted" | "index">) => {
    scene = [...scene, { ...el, version: 1, isDeleted: false, index: `a${String(n++).padStart(3, "0")}` }];
  };
  /** A user edit: input, change, commit. */
  const user = (fn: () => void) => {
    history.noteUserInput();
    fn();
    history.commit();
  };
  // One scene update per change, like a writer that isn't batching: the history must still see one step.
  const canvas: ChangeSetCanvas = {
    boxOf: (id) => {
      const el = live(id);
      return el ? { x: el.x, y: el.y, width: 10, height: 10 } : undefined;
    },
    write(set: ChangeSet, changes: readonly ProposedChange[]) {
      writes++;
      const ids = new Map<string, string>();
      const idOf = (t: { existing: string } | { created: string }) => ("existing" in t ? t.existing : ids.get(t.created)!);
      for (const c of changes) {
        if (c.kind === "move") {
          scene = scene.map((e) => (e.id === c.target ? { ...e, x: c.to.x, y: c.to.y, version: e.version + 1 } : e));
          continue;
        }
        if (!("key" in c) || c.kind === "group_objects") continue; // reconciliation changes and groups aren't exercised by this harness
        const id = `el_${c.key}`;
        ids.set(c.key, id);
        if (c.kind === "connect") add({ id, kind: "arrow", x: 0, y: 0, from: idOf(c.from), to: idOf(c.to), operationId: set.metadata.operationId });
        else add({ id, kind: c.kind, x: c.box.x, y: c.box.y, operationId: set.metadata.operationId });
      }
      return ids;
    },
  };
  const remove = (id: string) => {
    scene = scene.map((e) => (e.id === id ? { ...e, isDeleted: true, version: e.version + 1 } : e));
  };
  const view = () => scene.filter((e) => !e.isDeleted).map((e) => `${e.id}@${e.x}`);
  return { history, canvas, add, remove, user, view, live, writes: () => writes };
}

const set = parseChangeSet({
  operationId: "op_visualize",
  title: "Visualize",
  metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock" },
  changes: [
    ...Array.from({ length: 20 }, (_, i) => ({ kind: "create_shape", key: `s${i}`, shape: "rectangle", label: `Node ${i}`, box: { x: i * 200, y: 0, width: 100, height: 50 } })),
    ...Array.from({ length: 19 }, (_, i) => ({ kind: "connect", key: `c${i}`, from: { created: `s${i}` }, to: { created: `s${i + 1}` } })),
    { kind: "connect", key: "anchor", from: { existing: "anchor" }, to: { created: "s0" } },
    { kind: "move", target: "loose", to: { x: 999, y: 0 } },
  ],
});

describe("acceptChangeSet", () => {
  it("accept: writes the whole set once, as one undo step, with provenance on every created object", () => {
    const t = setup();
    t.user(() => t.add({ id: "anchor", kind: "block", x: 0, y: 0 }));
    t.user(() => t.add({ id: "loose", kind: "shape", x: 5, y: 0 }));

    const r = acceptChangeSet(set, t.canvas, t.history);
    expect(t.writes()).toBe(1);
    expect(r.dropped).toEqual([]);
    expect(r.applied).toHaveLength(41);
    expect(r.created.size).toBe(40);
    expect(r.stepId).toBe(t.history.lastStepId);
    expect(t.view()).toHaveLength(42);
    for (const id of r.created.values()) expect(t.live(id)?.operationId).toBe("op_visualize");
    expect(t.live("loose")?.x).toBe(999);

    // One undo removes everything the operation did, and nothing of the user's.
    t.history.undo();
    expect(t.view()).toEqual(["anchor@0", "loose@5"]);
    t.history.redo();
    expect(t.view()).toHaveLength(42);
  });

  it("keeps the normal undo model after accepting: later edits are their own steps", () => {
    const t = setup();
    t.user(() => t.add({ id: "anchor", kind: "block", x: 0, y: 0 }));
    t.user(() => t.add({ id: "loose", kind: "shape", x: 5, y: 0 }));
    acceptChangeSet(set, t.canvas, t.history);
    t.user(() => t.add({ id: "after", kind: "block", x: 7, y: 0 }));
    t.history.undo();
    expect(t.live("after")).toBeUndefined();
    expect(t.view()).toHaveLength(42);
    t.history.undo();
    expect(t.view()).toEqual(["anchor@0", "loose@5"]);
  });

  it("reject: settling the review without accepting leaves the canvas and history untouched", () => {
    const t = setup();
    t.user(() => t.add({ id: "anchor", kind: "block", x: 0, y: 0 }));
    const pending = new PendingChanges();
    const proposed = pending.propose("cv", set);
    const step = t.history.lastStepId;
    pending.settle("cv", proposed.operationId);
    expect(pending.get("cv")).toBeNull();
    expect(t.writes()).toBe(0);
    expect(t.view()).toEqual(["anchor@0"]);
    expect(t.history.lastStepId).toBe(step);
  });

  it("partial failure: objects deleted mid-review drop only the changes that refer to them", () => {
    const t = setup();
    t.user(() => t.add({ id: "anchor", kind: "block", x: 0, y: 0 }));
    t.user(() => t.add({ id: "loose", kind: "shape", x: 5, y: 0 }));
    // While the set is pending, the user deletes both referenced objects.
    t.user(() => t.remove("anchor"));
    t.user(() => t.remove("loose"));

    const r = acceptChangeSet(set, t.canvas, t.history);
    expect(r.dropped.map((d) => d.change.kind)).toEqual(["connect", "move"]);
    expect(r.applied).toHaveLength(39);
    expect(t.view()).toHaveLength(39);
    t.history.undo();
    expect(t.view()).toEqual([]);
  });

  it("writes nothing and records no step when every change was dropped", () => {
    const t = setup();
    const onlyExisting = parseChangeSet({ ...set, changes: [{ kind: "move", target: "gone", to: { x: 0, y: 0 } }] });
    const r = acceptChangeSet(onlyExisting, t.canvas, t.history);
    expect(r.stepId).toBeNull();
    expect(r.dropped).toHaveLength(1);
    expect(t.writes()).toBe(0);
    expect(t.history.canUndo).toBe(false);
  });
});
