import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { promotionKey } from "@/ai/reconcile/tracking";
import { promotedMarkdown, promotionSet } from "./promotion";

const GEN = "gen_run1";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const parseMarkdown = (md: string) => [{ type: "paragraph" as const, content: md }];

describe("promotion (pin a generated note)", () => {
  it("is one create_block, additive only, that parses as a change set", async () => {
    const { set, key } = await promotionSet({ key: "g1", generationId: GEN, title: "Keys expire", body: "After 24h a retry is new.", detail: "Servers forget keys.", cites: ["u2"], source: { sourceId: "s1", version: 2 } }, context, parseMarkdown);
    expect(() => parseChangeSet(set)).not.toThrow();
    expect(set.changes.map((c) => c.kind)).not.toContain("update_block");
    expect(set.changes.map((c) => c.kind)).not.toContain("patch_block");
    expect(set.changes.filter((c) => c.kind === "create_block")).toHaveLength(1);
    expect(key).toBeTruthy();
    expect(set.metadata).toMatchObject({ createdBy: "ai", task: "generate_openui_notes", noteModel: "distil" });
  });

  it("links a sourced note through `passage` (opted out of updates) and cites its units", async () => {
    const { set } = await promotionSet({ key: "g1", generationId: GEN, title: "T", body: "B", cites: ["u2", "u3"], source: { sourceId: "s1", version: 2 } }, context, parseMarkdown);
    expect(set.passage).toEqual({ sourceId: "s1", version: 2 });
    expect(set.knowledge?.cards).toEqual({ [promotionKey(GEN, "g1")]: { sourceUnits: ["u2", "u3"] } });
    expect(set.contentSource).toBeUndefined();
  });

  it("writes a plain AI card when the note has no source or no citations", async () => {
    const { set } = await promotionSet({ key: "g2", generationId: GEN, title: "T", body: "B", cites: [] }, context, parseMarkdown);
    expect(set.passage).toBeUndefined();
    expect(set.knowledge).toBeUndefined();
    expect(set.metadata.noteModel).toBeUndefined();
  });

  it("two generation runs pinning their own g1 get distinct card keys (R3: was `openui § g1` for both)", async () => {
    const note = { key: "g1", title: "T", body: "B", cites: ["u2"], source: { sourceId: "s1", version: 2 } };
    const first = await promotionSet({ ...note, generationId: "gen_runA" }, context, parseMarkdown);
    const second = await promotionSet({ ...note, generationId: "gen_runB" }, context, parseMarkdown);
    const keyOf = (set: typeof first.set) => Object.keys(set.knowledge?.cards ?? {})[0];
    const nodeKeyOf = (set: typeof first.set) => set.changes.find((c) => c.kind === "create_block")?.stableNodeKey;
    expect(keyOf(first.set)).toBe("promoted § gen_runA § g1");
    expect(keyOf(second.set)).toBe("promoted § gen_runB § g1");
    expect(nodeKeyOf(first.set)).toBe(keyOf(first.set));
    expect(nodeKeyOf(first.set)).not.toBe(nodeKeyOf(second.set));
  });

  it("keeps the detail as its own paragraph", () => {
    expect(promotedMarkdown({ title: "T", body: "B", detail: "D" })).toBe("B\n\nD");
    expect(promotedMarkdown({ title: "T", body: "" })).toBe("T");
  });

  it("carries the free check's review onto the card, so a flagged card lands in the review queue", async () => {
    const review = { reasons: ['"300 seconds" is not on any card citing it'] };
    const { set } = await promotionSet({ key: "g3", generationId: GEN, title: "T", body: "B", cites: ["u7"], source: { sourceId: "s1", version: 2 }, review }, context, parseMarkdown);
    expect(set.knowledge?.cards[promotionKey(GEN, "g3")]).toEqual({ sourceUnits: ["u7"], review });
    expect(() => parseChangeSet(set)).not.toThrow();
  });
});
