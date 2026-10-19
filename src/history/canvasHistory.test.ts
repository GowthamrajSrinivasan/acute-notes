import { describe, expect, it } from "vitest";
import { CanvasHistory, onlyBookkeepingChanged, type DocStep, type DocStepSource } from "./canvasHistory";

interface El {
  id: string;
  version: number;
  index: string;
  isDeleted: boolean;
  x: number;
  text?: string;
}

/** A tiny renderer stand-in: an immutable scene replaced on every change. */
function setup(docs?: DocStepSource) {
  let scene: El[] = [];
  let selected: string[] = [];
  const timers: (() => void)[] = [];
  const history = new CanvasHistory<El>({
    getElements: () => scene,
    apply: (elements, select) => {
      scene = elements;
      selected = select;
    },
    bump: (t, above) => ({ ...t, version: above + 1 }),
    markDeleted: (el) => ({ ...el, isDeleted: true }),
    docs,
    setTimer: (fn) => {
      timers.push(fn);
      return fn;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as () => void);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  history.init(scene);
  history.connect();
  const observe = (state = { interacting: false, editing: false }) => history.observe(scene, state);
  /** A user action: input, scene change, change event, then the commit timer fires. */
  const act = (change: (s: El[]) => El[], opts: { input?: boolean } = {}) => {
    if (opts.input !== false) history.noteUserInput();
    scene = change(scene);
    observe();
    flush();
  };
  const flush = () => {
    while (timers.length) timers.shift()!();
  };
  const set = (id: string, patch: Partial<El>) => (s: El[]) =>
    s.map((e) => (e.id === id ? { ...e, ...patch, version: e.version + 1 } : e));
  const add = (el: Omit<El, "version" | "isDeleted">) => (s: El[]) => [...s, { ...el, version: 1, isDeleted: false }];
  const view = () => scene.filter((e) => !e.isDeleted).map((e) => `${e.id}@${e.x}${e.text ? ":" + e.text : ""}`);
  return {
    history,
    act,
    set,
    add,
    view,
    observe,
    flush,
    get scene() {
      return scene;
    },
    setScene(s: El[]) {
      scene = s;
    },
    selected: () => selected,
  };
}

describe("CanvasHistory", () => {
  it("undoes and redoes create / move / delete as one step each", () => {
    const t = setup();
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    t.act(t.set("r", { x: 100 }));
    t.act(t.set("r", { isDeleted: true }));
    expect(t.view()).toEqual([]);
    t.history.undo();
    expect(t.view()).toEqual(["r@100"]);
    t.history.undo();
    expect(t.view()).toEqual(["r@0"]);
    t.history.undo();
    expect(t.view()).toEqual([]);
    expect(t.history.canUndo).toBe(false);
    t.history.redo();
    t.history.redo();
    expect(t.view()).toEqual(["r@100"]);
    t.history.redo();
    expect(t.view()).toEqual([]);
  });

  it("makes a whole gesture one step, however many change events it has", () => {
    const t = setup();
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    t.history.noteUserInput();
    for (let x = 1; x <= 50; x++) {
      t.setScene(t.set("r", { x })(t.scene));
      t.observe({ interacting: true, editing: false });
    }
    t.observe();
    t.flush();
    t.history.undo();
    expect(t.view()).toEqual(["r@0"]);
  });

  it("is immune to in-place mutation of element objects (Excalidraw mutates during drags)", () => {
    const t = setup();
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    // A drag mutates the same object, then the scene array is replaced.
    t.history.noteUserInput();
    const live = t.scene[0]!;
    live.x = 100;
    live.version += 1;
    t.setScene([...t.scene]);
    t.observe();
    t.flush();
    t.history.undo();
    expect(t.view()).toEqual(["r@0"]);
    t.history.undo();
    expect(t.view()).toEqual([]);
    t.history.redo();
    t.history.redo();
    expect(t.view()).toEqual(["r@100"]);
  });

  it("writes undone states with a higher version (forward change for persistence/sync)", () => {
    const t = setup();
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    t.act(t.set("r", { x: 5 }));
    const v = t.scene[0]!.version;
    t.history.undo();
    expect(t.scene[0]!.version).toBeGreaterThan(v);
    expect(t.selected()).toEqual(["r"]);
  });

  it("never records selection-only or input-less changes", () => {
    const t = setup();
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    // e.g. font re-measure after load: no user input since the last commit
    t.act(t.set("r", { x: 1 }), { input: false });
    t.history.undo();
    expect(t.view()).toEqual([]);
    expect(t.history.canUndo).toBe(false);
  });

  it("ignores bookkeeping-only changes", () => {
    expect(onlyBookkeepingChanged({ id: "a", x: 1, version: 1, status: "pending" }, { id: "a", x: 1, version: 2, status: "saved" })).toBe(true);
    expect(onlyBookkeepingChanged({ id: "a", points: [[0, 0]], version: 1 }, { id: "a", points: [[0, 1]], version: 2 })).toBe(false);
  });

  it("clears redo on a new step", () => {
    const t = setup();
    t.act(t.add({ id: "a", index: "a0", x: 0 }));
    t.act(t.add({ id: "b", index: "a1", x: 0 }));
    t.history.undo();
    t.act(t.add({ id: "c", index: "a2", x: 0 }));
    expect(t.history.canRedo).toBe(false);
    expect(t.history.redo()).toBe(false);
    expect(t.view()).toEqual(["a@0", "c@0"]);
  });

  it("treats an edit session as one step and skips items created and discarded in it", () => {
    const t = setup();
    t.history.noteUserInput();
    t.setScene(t.add({ id: "txt", index: "a0", x: 0, text: "" })(t.scene));
    t.observe({ interacting: false, editing: true });
    for (const text of ["h", "he", "hello"]) {
      t.setScene(t.set("txt", { text })(t.scene));
      t.observe({ interacting: false, editing: true });
    }
    t.observe();
    t.flush();
    // an empty item opened and discarded leaves no step
    t.history.noteUserInput();
    t.setScene(t.add({ id: "empty", index: "a1", x: 0 })(t.scene));
    t.observe({ interacting: false, editing: true });
    t.setScene(t.set("empty", { isDeleted: true })(t.scene));
    t.observe();
    t.flush();

    expect(t.view()).toEqual(["txt@0:hello"]);
    t.history.undo();
    expect(t.view()).toEqual([]);
    expect(t.history.canUndo).toBe(false);
  });

  it("restores z-order from fractional indices", () => {
    const t = setup();
    t.act(t.add({ id: "a", index: "a0", x: 0 }));
    t.act(t.add({ id: "b", index: "a1", x: 0 }));
    // bring "a" to front
    t.act((s) => [s[1]!, { ...s[0]!, index: "a2", version: s[0]!.version + 1 }]);
    expect(t.scene.map((e) => e.id)).toEqual(["b", "a"]);
    t.history.undo();
    expect(t.scene.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("absorbs an auto-size of an unchanged element, but folds it into a pending step", () => {
    const t = setup();
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    // auto-size with nothing pending: not a step
    const v = t.scene[0]!.version;
    t.history.noteUserInput();
    t.setScene(t.set("r", { x: 3 })(t.scene));
    t.history.absorbIfClean("r", v);
    t.observe();
    t.flush();
    t.history.undo();
    expect(t.view()).toEqual([]);
  });

  it("attaches content steps to the same entry and replays them in order", () => {
    const log: string[] = [];
    let pending: DocStep[] = [];
    let notify = () => {};
    const docs: DocStepSource = {
      take: () => {
        const out = pending;
        pending = [];
        return out;
      },
      hasPending: () => pending.length > 0,
      onPending: (l) => {
        notify = l;
        return () => {};
      },
    };
    const step = (name: string): DocStep => ({
      undo: () => log.push(`undo ${name}`),
      redo: () => log.push(`redo ${name}`),
      dispose: () => log.push(`dispose ${name}`),
    });
    const t = setup(docs);
    // typing into a block (content only, no canvas change)
    pending.push(step("typing"));
    notify();
    t.flush();
    expect(t.history.canUndo).toBe(true);
    t.history.undo();
    t.history.redo();
    t.history.undo();
    // a new step discards the redo entry and releases its resources
    t.act(t.add({ id: "r", index: "a0", x: 0 }));
    expect(log).toEqual(["undo typing", "redo typing", "undo typing", "dispose typing"]);
  });

  it("commits pending changes before undoing them", () => {
    const t = setup();
    t.history.noteUserInput();
    t.setScene(t.add({ id: "r", index: "a0", x: 0 })(t.scene));
    t.observe(); // timer not fired yet
    t.history.undo();
    expect(t.view()).toEqual([]);
  });

  it("drops the oldest steps beyond the limit", () => {
    let scene: El[] = [];
    const history = new CanvasHistory<El>({
      getElements: () => scene,
      apply: (e) => (scene = e),
      bump: (t, above) => ({ ...t, version: above + 1 }),
      markDeleted: (el) => ({ ...el, isDeleted: true }),
      limit: 3,
    });
    history.init(scene);
    for (let i = 0; i < 5; i++) {
      history.noteUserInput();
      scene = [...scene, { id: `e${i}`, version: 1, index: `a${i}`, isDeleted: false, x: 0 }];
      history.commit();
    }
    let undone = 0;
    while (history.undo()) undone++;
    expect(undone).toBe(3);
    expect(scene.filter((e) => !e.isDeleted).map((e) => e.id)).toEqual(["e0", "e1"]);
  });

  describe("record (programmatic transactions, F19)", () => {
    it("records many scene updates as one step, undone and redone as one", () => {
      const t = setup();
      t.act(t.add({ id: "mine", index: "a0", x: 0 }));
      const id = t.history.record(() => {
        for (let i = 1; i <= 30; i++) t.setScene(t.add({ id: `ai${i}`, index: `a${i}`, x: i })(t.scene));
        t.setScene(t.set("mine", { x: 500 })(t.scene));
      });
      expect(id).not.toBeNull();
      expect(t.history.lastStepId).toBe(id);
      expect(t.view()).toHaveLength(31);
      t.history.undo();
      expect(t.view()).toEqual(["mine@0"]);
      t.history.redo();
      expect(t.view()).toHaveLength(31);
      expect(t.view()).toContain("mine@500");
    });

    it("commits the user's pending changes as their own step first", () => {
      const t = setup();
      t.history.noteUserInput();
      t.setScene(t.add({ id: "mine", index: "a0", x: 0 })(t.scene));
      t.observe(); // pending: the commit timer has not fired
      t.history.record(() => t.setScene(t.add({ id: "ai", index: "a1", x: 0 })(t.scene)));
      t.history.undo();
      expect(t.view()).toEqual(["mine@0"]);
      t.history.undo();
      expect(t.view()).toEqual([]);
    });

    it("splits off the user's pending changes even while a gesture or edit is in progress", () => {
      const t = setup();
      t.act(t.add({ id: "mine", index: "a0", x: 0 }));
      t.history.noteUserInput();
      t.setScene(t.set("mine", { x: 9 })(t.scene));
      t.observe({ interacting: false, editing: true });
      t.history.record(() => t.setScene(t.add({ id: "ai", index: "a1", x: 0 })(t.scene)));
      t.history.undo();
      expect(t.view()).toEqual(["mine@9"]);
    });

    it("does not record the triggering input again when the change event arrives later", () => {
      const t = setup();
      t.history.noteUserInput(); // the Accept click
      t.history.record(() => t.setScene(t.add({ id: "ai", index: "a0", x: 0 })(t.scene)));
      t.observe();
      t.flush();
      t.history.undo();
      expect(t.view()).toEqual([]);
      expect(t.history.canUndo).toBe(false);
    });

    it("returns null and adds no step when nothing changed", () => {
      const t = setup();
      t.act(t.add({ id: "mine", index: "a0", x: 0 }));
      const before = t.history.lastStepId;
      expect(t.history.record(() => {})).toBeNull();
      expect(t.history.lastStepId).toBe(before);
    });

    it("clears the redo stack like any new step", () => {
      const t = setup();
      t.act(t.add({ id: "mine", index: "a0", x: 0 }));
      t.history.undo();
      expect(t.history.canRedo).toBe(true);
      t.history.record(() => t.setScene(t.add({ id: "ai", index: "a1", x: 0 })(t.scene)));
      expect(t.history.canRedo).toBe(false);
    });
  });
});
