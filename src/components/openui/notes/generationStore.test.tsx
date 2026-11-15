// @vitest-environment happy-dom
/**
 * The generated-notes store (`generationStore.ts`): per canvas, outside any component, so a run keeps streaming while
 * the Notes view is closed or remounts; a new run cancels the old one and drops its late updates; pins are per run.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NotesCheck } from "@/ai/openui/notesCheck";
import type { GeneratedCard } from "@/ai/openui/notesTask";
import { generations, useGeneration, type GenSource } from "./generationStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let n = 0;
/** A fresh canvas id per test: the store is a module singleton, as in the app. */
const canvas = () => `cv-${++n}`;
const source: GenSource = { sourceId: "s1", version: 2, units: new Map([["u1", "Keys expire after 24 hours."]]), list: [] };
const card = (key: string): GeneratedCard => ({ key, lang: "", title: key, body: `${key} body`, cites: ["u1"], unknownUnits: [] });

describe("generations (store)", () => {
  it("an unknown canvas is idle with no pins", () => {
    const s = generations.get(canvas());
    expect(s.gen).toEqual({ status: "idle" });
    expect(s.pinned.size).toBe(0);
    expect(s.run).toBe(0);
  });

  it("streams: running updates grow the blocks, then done keeps the cards and the check; listeners hear each step", () => {
    const id = canvas();
    const heard: string[] = [];
    const off = generations.subscribe(() => heard.push(generations.get(id).gen.status));
    const { current } = generations.start(id);
    const base = { cards: new Map<string, GeneratedCard>(), source };
    for (const blocks of [["A"], ["A", "B"]]) if (current()) generations.setGen(id, { status: "running", blocks, ...base });
    const check: NotesCheck = { units: 1, unitsNotCovered: 0, cardsNeedingReview: 0, detailsMissing: 0, reviews: {} };
    generations.setGen(id, { status: "done", blocks: ["A", "B"], cards: new Map([["g1", card("g1")], ["g2", card("g2")]]), source, check });
    off();
    const gen = generations.get(id).gen;
    expect(gen.status).toBe("done");
    if (gen.status !== "done") return;
    expect(gen.blocks).toEqual(["A", "B"]);
    expect([...gen.cards.keys()]).toEqual(["g1", "g2"]);
    expect(gen.check).toBe(check);
    expect(heard).toEqual(["idle", "running", "running", "done"]); // start() itself notifies (run bump) while still idle
  });

  it("a new run aborts the old one: its signal fires, current() turns false, and the pins reset", () => {
    const id = canvas();
    const first = generations.start(id);
    generations.pin(id, "g1", "el_1");
    expect(generations.get(id).pinned.get("g1")).toBe("el_1");
    const second = generations.start(id);
    expect(first.signal.aborted).toBe(true);
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(true);
    expect(generations.get(id).run).toBe(2);
    expect(generations.get(id).pinned.size).toBe(0);
  });

  it("keeps canvases apart", () => {
    const a = canvas();
    const b = canvas();
    generations.start(a);
    generations.setGen(a, { status: "error", message: "boom" });
    generations.pin(a, "g1", "el_1");
    expect(generations.get(b).gen.status).toBe("idle");
    expect(generations.get(b).pinned.size).toBe(0);
    expect(generations.get(a).gen).toEqual({ status: "error", message: "boom" });
  });

  it("pin keeps earlier pins (a new map each time, so subscribers see a change)", () => {
    const id = canvas();
    generations.start(id);
    const before = generations.get(id).pinned;
    generations.pin(id, "g1", "el_1");
    generations.pin(id, "g2", "el_2");
    const after = generations.get(id).pinned;
    expect(after).not.toBe(before);
    expect([...after]).toEqual([["g1", "el_1"], ["g2", "el_2"]]);
  });
});

describe("useGeneration (survives a remount)", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe({ id }: { id: string }) {
    const { gen, pinned } = useGeneration(id);
    return <p>{`${gen.status}:${gen.status === "running" || gen.status === "done" ? gen.blocks.length : 0}:${pinned.size}`}</p>;
  }

  it("a run that streams while the view is unmounted shows its latest state on remount, and live updates after", () => {
    const id = canvas();
    act(() => root.render(<Probe id={id} />));
    expect(host.textContent).toBe("idle:0:0");
    const { current } = generations.start(id);
    act(() => generations.setGen(id, { status: "running", blocks: ["A"], cards: new Map(), source }));
    expect(host.textContent).toBe("running:1:0");

    act(() => root.render(<></>)); // the view closes; the run keeps going
    if (current()) generations.setGen(id, { status: "running", blocks: ["A", "B", "C"], cards: new Map(), source });
    act(() => root.render(<Probe id={id} />));
    expect(host.textContent).toBe("running:3:0");

    act(() => {
      generations.setGen(id, { status: "done", blocks: ["A", "B", "C"], cards: new Map([["g1", card("g1")]]), source });
      generations.pin(id, "g1", "el_9");
    });
    expect(host.textContent).toBe("done:3:1");
  });
});
