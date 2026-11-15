/**
 * Study Mode Phase 1 (study-mode-implementation-plan §1, §9): concept keys and the remap through lineage — the plan's
 * table row by row, on the real splitter and matcher over fixture 10 (`reconcile/__fixtures__/update-series/`), multi-step
 * chains, gaps, and parity with the citation update (`planCitationUpdate`). Offline; no store, no model.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseContent } from "@/ai/content/parser";
import type { Lineage, SourceUnit, UnitSet } from "@/ai/fidelity/contracts";
import { matchVersions, splitUnits } from "@/ai/fidelity/sourceUnits";
import { planCitationUpdate } from "@/ai/reconcile/citations";
import { nextPathIds } from "@/ai/reconcile/topicIds";
import { conceptKey, conceptOfNote, isLocalConcept, localConceptKey, MAX_KEY_UNITS, remapConcept, sortUnits, type Concept, type ConceptState } from "./concept";

const V1 = readFileSync("src/ai/reconcile/__fixtures__/update-series/v1.md", "utf8");
const V2 = readFileSync("src/ai/reconcile/__fixtures__/update-series/v2.md", "utf8");
const DUP = "Check the logs carefully.";
const EDITED = "The cache invalidation is retried with exponential backoff up to three times before an alert fires.";
const DELETED = "A miss falls through to the primary database and fills the cache.";
const MOVED = "Deploys drain one cache node at a time behind the load balancer.";
const RENAMED = "The cache must not exceed 2 GB per node.";

async function series() {
  const v1 = await splitUnits(V1);
  const pathIds = nextPathIds(undefined, await parseContent(V1), V1, await parseContent(V2), V2);
  const { units: v2, lineage } = await matchVersions({ ...v1, version: 1 }, { text: V2, version: 2, ...(pathIds ? { pathIds } : {}) });
  return { v1, v2, lineage };
}
const unitOf = (set: UnitSet, text: string): SourceUnit => {
  const found = set.units.filter((u) => u.text === text);
  if (found.length !== 1) throw new Error(`expected one unit "${text}", found ${found.length}`);
  return found[0]!;
};
const concept = (units: string[], version = 1): Concept => ({ key: conceptKey("s1", units), local: false, sourceId: "s1", units: sortUnits(units), sourceVersion: version });
const oneStep = (lineage: Lineage) => ({ lineageOf: (v: number) => (v === lineage.toVersion ? lineage : undefined), targetVersion: lineage.toVersion });

describe("Study Phase 1 — concept keys", () => {
  it("are the source's units, de-duplicated and sorted by counter (u9 before u10)", () => {
    expect(conceptKey("src_A", ["u10", "u9", "u10", "u2"])).toBe("c:src_A:u2+u9+u10");
    expect(conceptKey("src_A", ["u7", "u6"])).toBe(conceptKey("src_A", ["u6", "u7"]));
    expect(() => conceptKey("src_A", [])).toThrow();
  });

  it("are hashed above 16 units, deterministically", () => {
    const many = Array.from({ length: MAX_KEY_UNITS + 1 }, (_, i) => `u${i + 1}`);
    const k = conceptKey("src_A", many);
    expect(k).toMatch(/^c:src_A:h[0-9a-z]+$/); // cyrb53 in base 36
    expect(conceptKey("src_A", [...many].reverse())).toBe(k);
    expect(conceptKey("src_A", many.slice(0, MAX_KEY_UNITS))).toBe(`c:src_A:${many.slice(0, MAX_KEY_UNITS).join("+")}`);
  });

  it("come from every citation of a note, not only the first; no source or no cites → a local concept", () => {
    expect(conceptOfNote({ id: "n1", cites: ["u7", "u6"], source: { sourceId: "s1", version: 3 } }, "cv")).toEqual({ key: "c:s1:u6+u7", local: false, sourceId: "s1", units: ["u6", "u7"], sourceVersion: 3 });
    const local = conceptOfNote({ id: "n2", cites: [] , source: { sourceId: "s1", version: 3 } }, "cv");
    expect(local).toEqual({ key: localConceptKey("cv", "n2"), local: true });
    expect(isLocalConcept(local.key)).toBe(true);
    expect(conceptOfNote({ id: "n3", cites: ["u1"] }, "cv").local).toBe(true);
  });

  it("don't depend on the card: two cards citing the same units are one concept", () => {
    const a = conceptOfNote({ id: "el_1", cites: ["u2", "u5"], source: { sourceId: "s1", version: 1 } }, "cv");
    const b = conceptOfNote({ id: "el_9", cites: ["u5", "u2"], source: { sourceId: "s1", version: 1 } }, "cv");
    expect(a.key).toBe(b.key);
  });
});

describe("Study Phase 1 — remap through lineage, row by row (fixture 10)", () => {
  it("unchanged (renamed section, or moved): kept, same key", async () => {
    const { v1, lineage } = await series();
    for (const text of [RENAMED, MOVED]) {
      const c = concept([unitOf(v1, text).id]);
      expect(remapConcept(c, oneStep(lineage))).toMatchObject({ state: "kept", key: c.key, sourceVersion: 2 });
    }
  });

  it("changed: source_changed, same key (ids carry)", async () => {
    const { v1, lineage } = await series();
    const c = concept([unitOf(v1, EDITED).id, unitOf(v1, RENAMED).id]);
    expect(remapConcept(c, oneStep(lineage))).toMatchObject({ state: "source_changed", key: c.key, sourceVersion: 2 });
  });

  it("some removed: source_changed + narrowed, keyed over the survivors, carried from the old key", async () => {
    const { v1, lineage } = await series();
    const keep = unitOf(v1, RENAMED).id;
    const c = concept([unitOf(v1, DELETED).id, keep]);
    expect(remapConcept(c, oneStep(lineage))).toEqual({ state: "source_changed", reason: "narrowed", key: conceptKey("s1", [keep]), units: [keep], sourceVersion: 2, carriedFrom: c.key });
  });

  it("all removed: retired, old key", async () => {
    const { v1, lineage } = await series();
    const c = concept([unitOf(v1, DELETED).id]);
    expect(remapConcept(c, oneStep(lineage))).toMatchObject({ state: "retired", key: c.key });
  });

  it("an ambiguous candidate: needs_review, old key — found through `candidates`, not read as removed", async () => {
    const { v1, lineage } = await series();
    const dups = v1.units.filter((u) => u.text === DUP).map((u) => u.id);
    const ambiguous = dups.filter((id) => lineage.entries.some((e) => e.state === "ambiguous" && e.candidates?.includes(id)));
    expect(ambiguous.length).toBeGreaterThan(0);
    const c = concept([ambiguous[0]!, unitOf(v1, RENAMED).id]);
    expect(remapConcept(c, oneStep(lineage))).toMatchObject({ state: "needs_review", key: c.key, units: c.local ? [] : c.units });
  });

  it("partial removal never retires (the experiment's remapRecord did); ambiguity is never retirement", async () => {
    const { v1, lineage } = await series();
    expect(remapConcept(concept([unitOf(v1, DELETED).id, unitOf(v1, MOVED).id]), oneStep(lineage)).state).not.toBe("retired");
  });

  it("a missing or mismatched step: needs_review (lineage_gap), never assumed unchanged", async () => {
    const { v1, lineage } = await series();
    const c = concept([unitOf(v1, RENAMED).id]);
    expect(remapConcept(c, { lineageOf: () => undefined, targetVersion: 2 })).toMatchObject({ state: "needs_review", reason: "lineage_gap", key: c.key, sourceVersion: 1 });
    expect(remapConcept(c, { lineageOf: () => ({ ...lineage, fromVersion: 0 }), targetVersion: 2 }).reason).toBe("lineage_gap");
    expect(remapConcept(c, { lineageOf: () => ({ ...lineage, entries: [] }), targetVersion: 2 }).reason).toBe("lineage_gap");
  });

  it("source gone from this device: retired (source_missing); already current: kept; local: untouched", () => {
    const c = concept(["u1"], 2);
    expect(remapConcept(c, { lineageOf: () => undefined, targetVersion: 3, sourceExists: false })).toMatchObject({ state: "retired", reason: "source_missing" });
    expect(remapConcept(c, { lineageOf: () => undefined, targetVersion: 2 })).toMatchObject({ state: "kept", key: c.key });
    expect(remapConcept({ key: "l:cv:n1", local: true }, { lineageOf: () => undefined, targetVersion: 9 })).toMatchObject({ state: "kept", key: "l:cv:n1" });
  });
});

describe("Study Phase 1 — multi-step chains", () => {
  const step = (from: number, entries: Lineage["entries"]): Lineage => ({ fromVersion: from, toVersion: from + 1, entries });
  const chain = (...steps: Lineage[]) => ({ lineageOf: (v: number) => steps.find((s) => s.toVersion === v), targetVersion: steps[steps.length - 1]!.toVersion });

  it("changed in one step, unchanged in the next: source_changed at the end", () => {
    const r = remapConcept(concept(["u1", "u2"]), chain(step(1, [{ state: "changed", from: "u1", to: "u1" }, { state: "unchanged", from: "u2", to: "u2" }]), step(2, [{ state: "unchanged", from: "u1", to: "u1" }, { state: "unchanged", from: "u2", to: "u2" }])));
    expect(r).toMatchObject({ state: "source_changed", key: "c:s1:u1+u2", sourceVersion: 3 });
  });

  it("removed in step 1, ambiguous in step 2: needs_review (stops), the old key and version kept", () => {
    const r = remapConcept(concept(["u1", "u2"]), chain(step(1, [{ state: "removed", from: "u1" }, { state: "unchanged", from: "u2", to: "u2" }]), step(2, [{ state: "ambiguous", to: "u9", candidates: ["u2", "u3"] }])));
    expect(r).toMatchObject({ state: "needs_review", key: "c:s1:u1+u2", sourceVersion: 1 });
  });

  it("removed bit by bit until nothing is left: retired", () => {
    const r = remapConcept(concept(["u1", "u2"]), chain(step(1, [{ state: "removed", from: "u1" }, { state: "unchanged", from: "u2", to: "u2" }]), step(2, [{ state: "removed", from: "u2" }])));
    expect(r.state).toBe("retired");
  });

  it("a gap in the middle of the chain: lineage_gap", () => {
    const s1 = step(1, [{ state: "unchanged", from: "u1", to: "u1" }]);
    const s3 = step(3, [{ state: "unchanged", from: "u1", to: "u1" }]);
    expect(remapConcept(concept(["u1"]), { lineageOf: (v) => [s1, s3].find((s) => s.toVersion === v), targetVersion: 4 }).reason).toBe("lineage_gap");
  });

  it("a unit with no entry in a valid lineage counts as removed (as the citation update does)", () => {
    const r = remapConcept(concept(["u1", "u2"]), chain(step(1, [{ state: "unchanged", from: "u2", to: "u2" }])));
    expect(r).toMatchObject({ state: "source_changed", reason: "narrowed", key: "c:s1:u2" });
  });
});

describe("Study Phase 1 — parity with the citation update (one step, fixture 10)", () => {
  const MAP: Record<string, ConceptState> = { keep: "kept", resend: "source_changed", review: "needs_review", recheck: "source_changed", remove: "retired" };

  it("every card's action and its concept's state agree: keep↔kept, resend↔source_changed, review↔needs_review, recheck↔narrowed, remove↔retired", async () => {
    const { v1, v2, lineage } = await series();
    const dupAmbiguous = v1.units.filter((u) => u.text === DUP).map((u) => u.id).find((id) => lineage.entries.some((e) => e.state === "ambiguous" && e.candidates?.includes(id)))!;
    const cards = [
      { objectId: "keep", cites: [unitOf(v1, RENAMED).id] },
      { objectId: "move", cites: [unitOf(v1, MOVED).id] },
      { objectId: "resend", cites: [unitOf(v1, EDITED).id] },
      { objectId: "recheck", cites: [unitOf(v1, DELETED).id, unitOf(v1, RENAMED).id] },
      { objectId: "remove", cites: [unitOf(v1, DELETED).id] },
      { objectId: "review", cites: [dupAmbiguous] },
    ];
    const plan = planCitationUpdate({ previous: v1, next: v2, lineage, previousVersion: 1, nextVersion: 2, enabled: true, cards: cards.map((c) => ({ ...c, stableNodeKey: c.objectId, edited: false })) });
    if (plan.mode !== "cards") throw new Error(`plan in ${plan.mode} mode`);
    const actions = new Set<string>();
    for (const d of plan.cards) {
      const card = cards.find((c) => c.objectId === d.objectId)!;
      const r = remapConcept(concept(card.cites), oneStep(lineage));
      actions.add(d.action);
      expect(r.state, `${d.objectId}: ${d.action}`).toBe(MAP[d.action]);
      if (d.action === "recheck") {
        expect(r.reason).toBe("narrowed");
        expect(r.units).toEqual(sortUnits(d.cites));
      }
      if (d.action === "keep" || d.action === "resend") expect(r.units).toEqual(sortUnits(d.cites));
    }
    expect([...actions].sort()).toEqual(["keep", "recheck", "remove", "resend", "review"]);
  });
});
