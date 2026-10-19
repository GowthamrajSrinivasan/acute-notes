/**
 * Choices (G3) through "Update from new content" on an AI-tier source (mock model): a `[!choice]` callout is drawn by
 * code — box, option cards, dotted `option_of` links — and resolving it changes the canvas without a model call unless
 * the notes' own wording changes.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet, type ChangeSet } from "@/ai/changes/changeSet";
import { accepted, acceptUpdate, firstRun, modelReply, runtimeWith, update } from "@/testUtils/reconcileHarness";
import { resolveChoice } from "./choices";
import { choiceOfKey } from "./choiceNodes";

const TEN = `Intro prose, no structure.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nBody of part ${i}.`).join("\n\n")}`;
const CALLOUT = `> [!choice] How part 3 reads
> - Body of part 3. _(in your notes)_
> - Body of part three, revised. _(from “Merged content”, 2026-10-09)_`;
/** TEN with the callout at the end of Part 3. */
const WITH_CHOICE = TEN.replace("Body of part 3.", `Body of part 3.\n\n${CALLOUT}`);

const generateCalls = (spy: ReturnType<typeof runtimeWith>["spy"]) => spy.mock.calls.filter((c) => c[0]!.task === "generate_visual_plan");
const created = (set: ChangeSet) => set.changes.flatMap((c) => (c.kind === "create_block" || c.kind === "create_page" ? [c] : []));

describe("choices drawn by code", () => {
  it("a callout becomes a 'Needs your call' box and one card per option, linked by dotted option_of links — no model call", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await update(a, WITH_CHOICE, runtime);
    expect(generateCalls(spy)).toHaveLength(0); // Part 3's own text didn't change
    const keys = created(r.changeSet!).map((c) => c.stableNodeKey);
    expect(keys.sort()).toEqual(["Part 3 § choice:how-part-3-reads", "Part 3 § choice:how-part-3-reads:option0", "Part 3 § choice:how-part-3-reads:option1"]);
    expect(r.changeSet!.changes.filter((c) => c.kind === "connect").map((c) => c.kind === "connect" && c.relation)).toEqual(["option_of", "option_of"]);
    const box = created(r.changeSet!).find((c) => c.stableNodeKey === "Part 3 § choice:how-part-3-reads")!;
    expect(JSON.stringify(box)).toContain("Needs your call");
    // The version keeps the callout: it is the record of the open choice.
    expect(r.changeSet!.contentSource!.text).toContain("> [!choice] How part 3 reads");
  });

  it("choosing what the notes say: the box becomes the choice, the options go, a 'Changed over time' page appears — no model call", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const a2 = acceptUpdate(a, (await update(a, WITH_CHOICE, runtime)).changeSet!);
    spy.mockClear();
    const r = await update(a2, resolveChoice(WITH_CHOICE, "how-part-3-reads", 0), runtime);
    expect(generateCalls(spy)).toHaveLength(0);
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds.filter((k) => k === "remove")).toHaveLength(2); // the two option cards (their links go with them)
    expect(r.changeSet!.changes.find((c) => c.kind === "update_block")).toMatchObject({ stableNodeKey: "Part 3 § choice:how-part-3-reads" });
    expect(JSON.stringify(r.changeSet!.changes.find((c) => c.kind === "update_block"))).toContain("Body of part 3.");
    const trail = created(r.changeSet!).find((c) => c.stableNodeKey === "Part 3 § trail");
    expect(trail).toBeDefined();
    expect(JSON.stringify(trail)).toContain("Changed over time");
    expect(JSON.stringify(trail)).toContain("over “Body of part three, revised.”");
  });

  it("choosing the other option replaces the notes' wording: that one section is generated again", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const a2 = acceptUpdate(a, (await update(a, WITH_CHOICE, runtime)).changeSet!);
    spy.mockClear();
    const text = resolveChoice(WITH_CHOICE, "how-part-3-reads", 1);
    expect(text).toContain("## Part 3\n\nBody of part three, revised.");
    const r = await update(a2, text, runtime);
    expect(generateCalls(spy)).toHaveLength(1);
    expect(generateCalls(spy)[0]![0]!.prompt).toContain("Body of part three, revised.");
    expect(generateCalls(spy)[0]![0]!.prompt).not.toContain("[!choice]"); // the model never sees a callout
    expect(r.reanalyzedUnits).toEqual(["Part 3"]);
  });

  it("two choices in one section are one valid change set: a single frame join holds both groups (the review accepts it)", async () => {
    const { runtime } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const second = CALLOUT.replace("How part 3 reads", "Who owns part 3").replace("Body of part 3.", "Body of part 3.").replace("Body of part three, revised.", "Part 3 is owned by the platform team.");
    const r = await update(a, WITH_CHOICE.replace(CALLOUT, `${CALLOUT}\n\n${second}`), runtime);
    expect(created(r.changeSet!).filter((c) => /§ choice:[^:]+$/.test(c.stableNodeKey ?? ""))).toHaveLength(2);
    const joins = r.changeSet!.changes.filter((c) => c.kind === "update_frame");
    expect(joins.length).toBeLessThanOrEqual(1);
    expect(new Set(joins.map((c) => c.kind === "update_frame" && c.target)).size).toBe(joins.length);
    expect(() => parseChangeSet(r.changeSet)).not.toThrow();
  });

  it("an unchanged re-send with an open choice proposes nothing", async () => {
    const { runtime } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const a2 = acceptUpdate(a, (await update(a, WITH_CHOICE, runtime)).changeSet!);
    const r = await update(a2, WITH_CHOICE, runtime);
    expect(r.changeSet?.changes.filter((c) => c.kind !== "connect") ?? []).toEqual([]); // (the harness passes no existing arrows)
  });
});

describe("choiceOfKey", () => {
  it("reads a box, a chosen card and an option card; anything else is not a choice", () => {
    expect(choiceOfKey("Part 3 § choice:how-part-3-reads")).toEqual({ section: "Part 3", id: "how-part-3-reads", option: null });
    expect(choiceOfKey("A ⨁ B § choice:db-2:option1")).toEqual({ section: "A ⨁ B", id: "db-2", option: 1 });
    expect(choiceOfKey("Part 3 § shape#0")).toBeNull();
  });
});
