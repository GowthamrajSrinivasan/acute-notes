/**
 * The review's layout rows (note-taking modes, layout preview): an update that sets, changes or removes a card's layout
 * says so and carries both layouts for the preview; a text-only update carries none; new text cards with a layout are
 * listed by their first line.
 */
import { describe, expect, it } from "vitest";
import type { ProposedChange } from "@/ai/changes/changeSet";
import { blockUpdateDiffs, newLayoutCards } from "./BlockUpdateDiffs";

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const NOW = `root = IdeaCard("A", "B")`;
const NEXT = `root = Callout("info", "B")`;
const update = (layout?: { lang: string } | null): ProposedChange => ({ kind: "update_block", target: "el1", content: [p("A"), p("B")], ...(layout !== undefined ? { layout } : {}) }) as ProposedChange;

describe("layout rows in the review", () => {
  const read = (layouts: Record<string, string | null>) => (t: string) => layouts[t] ?? null;

  it("an update with a layout carries the layout now and as proposed", () => {
    const [d] = blockUpdateDiffs([update({ lang: NEXT })], () => "A\nB", read({ el1: NOW }));
    expect(d!.layout).toEqual({ current: NOW, proposed: NEXT });
  });

  it("adding a layout to a card with none, and removing one", () => {
    expect(blockUpdateDiffs([update({ lang: NEXT })], () => "A", read({}))[0]!.layout).toEqual({ current: null, proposed: NEXT });
    expect(blockUpdateDiffs([update(null)], () => "A", read({ el1: NOW }))[0]!.layout).toEqual({ current: NOW, proposed: null });
  });

  it("a text-only update has no layout row", () => {
    expect(blockUpdateDiffs([update()], () => "A", read({ el1: NOW }))[0]!.layout).toBeUndefined();
  });

  it("new text cards with a layout are listed by their first line; other creates are not", () => {
    const changes = [
      { kind: "create_block", key: "k1", blockType: "text", content: [p(""), p("Release pipeline")], box: { x: 0, y: 0, width: 1, height: 1 }, layout: { lang: NEXT } },
      { kind: "create_block", key: "k2", blockType: "text", content: [p("No layout")], box: { x: 0, y: 0, width: 1, height: 1 } },
      { kind: "create_block", key: "k3", blockType: "code", content: [p("x")], box: { x: 0, y: 0, width: 1, height: 1 }, layout: { lang: NEXT } },
    ] as unknown as ProposedChange[];
    expect(newLayoutCards(changes)).toEqual([{ key: "k1", name: "Release pipeline", lang: NEXT }]);
  });
});
