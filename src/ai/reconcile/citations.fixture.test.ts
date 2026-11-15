/**
 * Fixture 10 (knowledge-notes-plan §7.3, `__fixtures__/update-series/`): v1 → v2 with a rename, a move, an edit, a
 * deletion and a duplicate, through the real splitter, `nextPathIds` and `matchVersions`, then `planCitationUpdate`.
 * Cards are described by the text they cite, so nothing depends on id numbering.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseContent } from "@/ai/content/parser";
import type { CardReview, Lineage, SourceUnit, UnitSet } from "@/ai/fidelity/contracts";
import { matchVersions, splitUnits } from "@/ai/fidelity/sourceUnits";
import { planCitationUpdate, reviewAfterUpdate, type CardDecision, type CitedCard } from "./citations";
import { nextPathIds } from "./topicIds";

const V1 = readFileSync("src/ai/reconcile/__fixtures__/update-series/v1.md", "utf8");
const V2 = readFileSync("src/ai/reconcile/__fixtures__/update-series/v2.md", "utf8");

const DUP = "Check the logs carefully.";
const EDITED_BEFORE = "The cache invalidation is retried with exponential backoff up to three times before an alert fires.";
const EDITED_AFTER = EDITED_BEFORE.replace("three", "five");
const DELETED = "A miss falls through to the primary database and fills the cache.";
const MOVED = "Deploys drain one cache node at a time behind the load balancer.";

async function series() {
  const v1 = await splitUnits(V1);
  const pathIds = nextPathIds(undefined, await parseContent(V1), V1, await parseContent(V2), V2);
  const { units: v2, lineage } = await matchVersions({ ...v1, version: 1 }, { text: V2, version: 2, ...(pathIds ? { pathIds } : {}) });
  return { v1, v2, lineage, pathIds };
}

const all = (set: UnitSet, text: string): SourceUnit[] => set.units.filter((u) => u.text === text);
const one = (set: UnitSet, text: string): SourceUnit => {
  const found = all(set, text);
  if (found.length !== 1) throw new Error(`expected one unit "${text}", found ${found.length}`);
  return found[0]!;
};
const entryFrom = (lineage: Lineage, id: string) => lineage.entries.find((e) => e.from === id);
const entryTo = (lineage: Lineage, id: string) => lineage.entries.find((e) => e.to === id);

describe("fixture 10: unit identity across the series (§7.1)", () => {
  it("rename: the renamed section's units keep their ids and topic, not moved", async () => {
    const { v1, v2, lineage, pathIds } = await series();
    expect(pathIds).toEqual({ "Cache service › Constraints": "Cache service › Limits" });
    for (const text of ["The cache must not exceed 2 GB per node.", "Entries expire after ten minutes without a read."]) {
      expect(one(v2, text).id).toBe(one(v1, text).id);
      expect(one(v2, text).topic).toBe("Cache service › Limits");
      expect(entryTo(lineage, one(v2, text).id)).toEqual({ state: "unchanged", from: one(v1, text).id, to: one(v1, text).id });
    }
  });

  it("move: same id, unchanged, moved to Writes", async () => {
    const { v1, v2, lineage } = await series();
    expect(one(v2, MOVED).id).toBe(one(v1, MOVED).id);
    expect(one(v2, MOVED).topic).toBe("Cache service › Writes");
    expect(entryTo(lineage, one(v2, MOVED).id)).toMatchObject({ state: "unchanged", moved: true });
  });

  it("edit: same id, changed", async () => {
    const { v1, v2, lineage } = await series();
    expect(one(v2, EDITED_AFTER).id).toBe(one(v1, EDITED_BEFORE).id);
    expect(entryTo(lineage, one(v2, EDITED_AFTER).id)!.state).toBe("changed");
  });

  it("deletion: removed; additions: new ids, never an old one", async () => {
    const { v1, v2, lineage } = await series();
    expect(entryFrom(lineage, one(v1, DELETED).id)).toEqual({ state: "removed", from: one(v1, DELETED).id });
    const oldIds = new Set(v1.units.map((u) => u.id));
    for (const text of ["Reads are retried once on a timeout before the request fails.", "Rollbacks restore the previous build within five minutes."]) {
      expect(oldIds.has(one(v2, text).id)).toBe(false);
      expect(entryTo(lineage, one(v2, text).id)!.state).toBe("added");
    }
  });

  it("duplicates: Reads' copy pairs; the copy whose neighbours fit two old copies is ambiguous, never swapped", async () => {
    const { v1, v2, lineage } = await series();
    const [r1, w1, o1] = all(v1, DUP);
    const [r2, w2] = all(v2, DUP);
    expect(r2!.id).toBe(r1!.id);
    const amb = entryTo(lineage, w2!.id)!;
    expect(amb.state).toBe("ambiguous");
    expect(amb.candidates).toEqual([w1!.id, o1!.id]);
    expect(w2!.id).not.toBe(w1!.id);
    expect(w2!.id).not.toBe(o1!.id);
    // Candidates are reported through the ambiguous entry, not as removed.
    expect(lineage.entries.filter((e) => e.state === "removed").map((e) => e.from)).toEqual([one(v1, DELETED).id]);
  });
});

describe("fixture 10: citation updates (§6.1, §7.1 Updates)", () => {
  async function planned() {
    const s = await series();
    const ids = (...texts: string[]) => texts.map((t) => one(s.v1, t).id);
    const [, w1] = all(s.v1, DUP);
    const resolved: CardReview = { reasons: ["condition changed"], resolved: "kept" };
    const cards: CitedCard[] = [
      { objectId: "reads", stableNodeKey: "Cache service › Reads#k1", cites: ids("Results are served from the cache only when the cache holds a valid result.", DELETED), edited: false },
      { objectId: "miss", stableNodeKey: "Cache service › Reads#k2", cites: ids(DELETED), edited: false },
      { objectId: "writes", stableNodeKey: "Cache service › Writes#k1", cites: ids("Writes go to the primary database first, then invalidate the cache entry.", EDITED_BEFORE), edited: false },
      { objectId: "retries-edited", stableNodeKey: "Cache service › Writes#k2", cites: ids(EDITED_BEFORE), edited: true },
      { objectId: "limits", stableNodeKey: "Cache service › Limits#k1", cites: ids("The cache must not exceed 2 GB per node.", "Entries expire after ten minutes without a read."), edited: false, review: resolved },
      { objectId: "deploys", stableNodeKey: "Cache service › Operations#k1", cites: ids(MOVED), edited: false },
      { objectId: "logs", stableNodeKey: "Cache service › Writes#k3", cites: [w1!.id], edited: false },
      { objectId: "opted-out", stableNodeKey: "Cache service › Writes#k4", cites: ids(EDITED_BEFORE), edited: false, excluded: true },
      { objectId: "preserve-card", stableNodeKey: "Cache service › Reads#text0", edited: false },
    ];
    const plan = planCitationUpdate({ previous: s.v1, next: s.v2, lineage: s.lineage, previousVersion: 1, nextVersion: 2, cards, enabled: true });
    if (plan.mode !== "cards") throw new Error(`expected cards mode, got ${plan.reason}`);
    const card = (id: string): CardDecision => plan.cards.find((c) => c.objectId === id)!;
    return { ...s, plan, card, resolved };
  }

  it("one changed sentence resends only the cards citing it; an edited one is a conflict", async () => {
    const { plan, card, v2 } = await planned();
    expect(card("writes")).toMatchObject({ action: "resend", changes: [{ unit: one(v2, EDITED_AFTER).id, before: EDITED_BEFORE, after: EDITED_AFTER }] });
    expect(card("retries-edited").action).toBe("conflict");
    expect(plan.resend).toEqual([{ topic: "Cache service › Writes", cards: ["writes"] }]);
  });

  it("a move is proposed as a move, with no model call", async () => {
    const { card } = await planned();
    expect(card("deploys")).toMatchObject({ action: "keep", moveTo: "Cache service › Writes" });
  });

  it("a renamed section's card is kept where it is, and its resolved flag stays resolved", async () => {
    const { card, resolved } = await planned();
    const limits = card("limits");
    expect(limits.action).toBe("keep");
    expect(limits.moveTo).toBeUndefined();
    expect(reviewAfterUpdate(resolved, limits, [{ code: "condition_changed", detail: "condition changed" }])).toBe(resolved);
  });

  it("ambiguous → Needs review, no rewrite", async () => {
    const { card, plan, v2 } = await planned();
    const logs = card("logs");
    expect(logs.action).toBe("review");
    expect(logs.flags.map((f) => f.code)).toEqual(["source_ambiguous"]);
    expect(plan.resend.flatMap((r) => r.cards)).not.toContain("logs");
    expect(plan.ambiguousUnits).toEqual([all(v2, DUP)[1]!.id]);
  });

  it("removed unit → removal proposed; a card citing it and more is re-checked, marked source changed", async () => {
    const { card } = await planned();
    expect(card("miss").action).toBe("remove");
    const reads = card("reads");
    expect(reads.action).toBe("recheck");
    expect(reads.flags.map((f) => f.code)).toEqual(["source_changed"]);
    expect(reads.cites).toHaveLength(1);
  });

  it("an opted-out card is skipped; a card that cites nothing keeps the section path", async () => {
    const { card } = await planned();
    expect(card("opted-out").action).toBe("skip");
    expect(card("preserve-card").action).toBe("section");
  });

  it("new units are new content for their sections; ambiguous ones are not", async () => {
    const { plan, v2 } = await planned();
    expect(plan.newContent).toEqual([
      { topic: "Cache service › Reads", units: [one(v2, "Reads are retried once on a timeout before the request fails.").id] },
      { topic: "Cache service › Operations", units: [one(v2, "Rollbacks restore the previous build within five minutes.").id] },
    ]);
  });

  it("counts every decision", async () => {
    const { plan } = await planned();
    expect(plan.counts).toEqual({ keep: 2, resend: 1, conflict: 1, review: 1, recheck: 1, remove: 1, section: 1, skip: 1, moves: 1 });
  });
});
