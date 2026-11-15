/**
 * Study plan §9 "re-verify when `CITATION_UPDATE_CONFIG` goes on (R2)": the parity tests in `concept.test.ts` pass
 * `enabled: true` per call. Here the shipped switch itself is on (set for this file only, restored after) and no call
 * overrides it, and the check goes one step further: once the update has rewritten each card's citations in place, the
 * card's concept key (`conceptOfNote`) is the key the stored history was remapped to, so answers stay with their card.
 * Offline; fixture 10 through the real splitter and matcher. Nothing under `ai/reconcile/**` changes.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseContent } from "@/ai/content/parser";
import type { Lineage, SourceUnit, UnitSet } from "@/ai/fidelity/contracts";
import { matchVersions, splitUnits } from "@/ai/fidelity/sourceUnits";
import { CITATION_UPDATE_CONFIG, planCitationUpdate } from "@/ai/reconcile/citations";
import { nextPathIds } from "@/ai/reconcile/topicIds";
import type { MetaRepository } from "@/persistence/repositories/types";
import { conceptOfNote, sortUnits } from "./concept";
import { loadStudy, recordAttempt } from "./store";

const V1 = readFileSync("src/ai/reconcile/__fixtures__/update-series/v1.md", "utf8");
const V2 = readFileSync("src/ai/reconcile/__fixtures__/update-series/v2.md", "utf8");
const DUP = "Check the logs carefully.";
const EDITED = "The cache invalidation is retried with exponential backoff up to three times before an alert fires.";
const DELETED = "A miss falls through to the primary database and fills the cache.";
const MOVED = "Deploys drain one cache node at a time behind the load balancer.";
const RENAMED = "The cache must not exceed 2 GB per node.";

const config = CITATION_UPDATE_CONFIG as { enabled: boolean };
const was = config.enabled;
beforeAll(() => void (config.enabled = true));
afterAll(() => void (config.enabled = was));

async function series() {
  const v1 = await splitUnits(V1);
  const pathIds = nextPathIds(undefined, await parseContent(V1), V1, await parseContent(V2), V2);
  const { units: v2, lineage } = await matchVersions({ ...v1, version: 1 }, { text: V2, version: 2, ...(pathIds ? { pathIds } : {}) });
  return { v1, v2, lineage };
}
const unitOf = (set: UnitSet, text: string): SourceUnit => set.units.find((u) => u.text === text)!;
function memoryMeta(): MetaRepository {
  const keys = new Map<string, unknown>();
  return { get: async <T,>(k: string) => structuredClone(keys.get(k)) as T | undefined, set: async (k, v) => void keys.set(k, structuredClone(v)), delete: async (k) => void keys.delete(k) };
}

describe("Study — parity with the citation update, switch on (R2)", () => {
  it("the shipped switch is on for this file and the plan runs in cards mode without an override", async () => {
    expect(CITATION_UPDATE_CONFIG.enabled).toBe(true);
    const { v1, v2, lineage } = await series();
    const plan = planCitationUpdate({ previous: v1, next: v2, lineage, previousVersion: 1, nextVersion: 2, cards: [{ objectId: "k", cites: [unitOf(v1, RENAMED).id], stableNodeKey: "k", edited: false }] });
    expect(plan.mode).toBe("cards");
  });

  it("after the update rewrites each card's citations, the card's concept is where its history went", async () => {
    const { v1, v2, lineage } = await series();
    const dup = v1.units.filter((u) => u.text === DUP).map((u) => u.id).find((id) => lineage.entries.some((e) => e.state === "ambiguous" && e.candidates?.includes(id)))!;
    const cards = [
      { objectId: "keep", cites: [unitOf(v1, RENAMED).id] },
      { objectId: "move", cites: [unitOf(v1, MOVED).id] },
      { objectId: "resend", cites: [unitOf(v1, EDITED).id] },
      { objectId: "recheck", cites: [unitOf(v1, DELETED).id, unitOf(v1, MOVED).id] },
      { objectId: "remove", cites: [unitOf(v1, DELETED).id] },
      { objectId: "review", cites: [dup] },
    ];
    const plan = planCitationUpdate({ previous: v1, next: v2, lineage, previousVersion: 1, nextVersion: 2, cards: cards.map((c) => ({ ...c, stableNodeKey: c.objectId, edited: false })) });
    if (plan.mode !== "cards") throw new Error(`plan in ${plan.mode} mode`);
    const sources = { get: async () => ({ latestVersion: 2 }), getVersion: async (_: string, v: number) => (v === 2 ? { lineage: lineage as Lineage } : null) };
    const expected: Record<string, string> = { keep: "kept", resend: "source_changed", recheck: "source_changed", review: "needs_review", remove: "retired" };
    const seen = new Set<string>();

    for (const d of plan.cards) {
      const card = cards.find((c) => c.objectId === d.objectId)!;
      // One workspace per card, so two cards narrowing onto the same units can't collide (§4 covers collisions).
      const meta = memoryMeta();
      const ws = `ws_${d.objectId}`;
      const before = conceptOfNote({ id: card.objectId, cites: card.cites, source: { sourceId: "s1", version: 1 } }, "cv");
      await recordAttempt(meta, ws, { concept: before, canvasId: "cv", title: card.objectId, kind: "quiz", correct: false, objectId: card.objectId, at: 1 });
      const loaded = await loadStudy(meta, ws, { now: 2, sources });
      seen.add(d.action);

      if (d.action === "remove") {
        expect(loaded.get(before.key)!.record.state, d.objectId).toBe("retired");
        continue;
      }
      // The card as the update leaves it: new citations at v2, or (review) unchanged until the user decides.
      const after = d.action === "review" ? before : conceptOfNote({ id: card.objectId, cites: d.cites, source: { sourceId: "s1", version: 2 } }, "cv");
      const history = loaded.get(after.key);
      expect(history, `${d.objectId} (${d.action}): history under the card's new key ${after.key}`).toBeDefined();
      expect(history!.record.attempts, d.objectId).toHaveLength(1);
      expect(history!.record.state ?? "kept", d.objectId).toBe(expected[d.action]);
      if (d.action !== "review") expect(history!.record.units).toEqual(sortUnits(d.cites));
      if (d.action === "recheck") expect(history!.record).toMatchObject({ reason: "narrowed", carriedFrom: before.key });
    }
    expect([...seen].sort()).toEqual(["keep", "recheck", "remove", "resend", "review"]);
  });
});
