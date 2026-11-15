/**
 * Offline evaluation of the claim–condition prototype (`claimConditions.ts`, `records.ts`) on the saved OpenUI v2 cards
 * (`../openui-2026-11-13/*.openui-v2.txt`), against adjudicated truth, with controls, compared with the existing rule
 * checks (`checkGeneratedCards`). $0: no model call. Report: set CC_OUT=<file>.
 *
 * Truth (2026-11-13, provisional): the session's 24 hand labels, re-reviewed blind by an independent reviewer
 * (`.ai/docs/claim-condition-prototype-2026-11-13.md` §1), then split into three questions:
 *  - INTEGRITY: the card states a claim whose own limiting condition it lacks (kn-02 g31 definite; kn-01 g2 arguable:
 *    the golden assertion says the window must sit on the replay card, but the source's own sentence u2 is equally
 *    unconditional and the qualifications are separate sentences other cards carry);
 *  - COVERAGE: a condition no card in the set states (kn-02: "nothing the origin does will shorten that wait",
 *    "they still need a TTL, a purge or both");
 *  - WORDING: distortions of the card's own sentence (kn-01 g1, g4; kn-02 g10, g33, g47). Out of scope here: the
 *    distortion/meaning checks own them, and this prototype must not claim them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { checkGeneratedCards } from "@/ai/openui/notesCheck";
import { cardOf, splitCards } from "@/ai/openui/notesTask";
import { DATASET_ROOT } from "../../tooling/load";
import { remapRecord, validateClaimConditions, type NoteCard, type ValidationResult } from "./claimConditions";
import { RECORDS } from "./records";

const OPENUI = join(DATASET_ROOT, "experiments", "openui-2026-11-13");
const CASES = ["kn-01-idempotency-keys", "kn-02-edge-cache-invalidation"] as const;

/** The 24 labelled cards. */
const LABELLED: Record<string, string[]> = {
  "kn-01-idempotency-keys": ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"],
  "kn-02-edge-cache-invalidation": ["g7", "g9", "g10", "g14", "g23", "g26", "g27", "g31", "g33", "g34", "g35", "g37", "g41", "g47", "g48"],
};
const INTEGRITY: Record<string, { definite: string[]; arguable: string[] }> = {
  "kn-01-idempotency-keys": { definite: [], arguable: ["g2"] },
  "kn-02-edge-cache-invalidation": { definite: ["g31"], arguable: [] },
};
const WORDING: Record<string, string[]> = {
  "kn-01-idempotency-keys": ["g1", "g4"],
  "kn-02-edge-cache-invalidation": ["g10", "g33", "g47"],
};
/** Records whose condition is on no card (adjudicated by reading every card; the reviewer agreed on both). */
const COVERAGE_GAPS = new Set(["kn02.ttl.cannot-shorten", "kn02.versioned.still-need"]);
/** The 7 cards the first labels called problems (the meaning-check run's positives), for the reconciliation table. */
const FIRST_LABELS: Record<string, string[]> = {
  "kn-01-idempotency-keys": ["g1", "g2", "g4"],
  "kn-02-edge-cache-invalidation": ["g9", "g31", "g41", "g47"],
};

const goldenOf = (caseId: string) => {
  const e = JSON.parse(readFileSync(join(DATASET_ROOT, "cases", caseId, "evaluation.json"), "utf8").replace(/^﻿/, "")) as { assertions: { id: string; check?: { all?: string[][] } }[] };
  return (id: string) => {
    const groups = e.assertions.find((a) => a.id === id)?.check?.all;
    if (!groups) throw new Error(`${caseId}: golden ${id} has no marker groups`);
    return groups;
  };
};

async function load(caseId: string, file: string) {
  const units = (await splitUnits(readFileSync(join(DATASET_ROOT, "cases", caseId, "source.md"), "utf8").replace(/\r\n?/g, "\n"))).units;
  const known = new Set(units.map((u) => u.id));
  const cards = splitCards(readFileSync(join(OPENUI, file), "utf8")).flatMap((b, i) => cardOf(b, i, known) ?? []);
  return { units, cards };
}

const confusion = (universe: string[], truth: Set<string>, flagged: Set<string>) => {
  const tp = universe.filter((k) => truth.has(k) && flagged.has(k)).length;
  const fn = universe.filter((k) => truth.has(k) && !flagged.has(k)).length;
  const fp = universe.filter((k) => !truth.has(k) && flagged.has(k)).length;
  const tn = universe.length - tp - fn - fp;
  return { tp, fp, fn, tn, precision: tp + fp ? Number((tp / (tp + fp)).toFixed(2)) : null, recall: tp + fn ? Number((tp / (tp + fn)).toFixed(2)) : null };
};

const report: Record<string, unknown> = { at: "2026-11-13", truth: "provisional; session labels re-reviewed blind by an independent reviewer", cost: "$0 (no model call)" };

describe("claim–condition prototype on the saved OpenUI v2 cards (offline)", () => {
  const all: { caseId: string; v: ValidationResult; va: ValidationResult; vc: ValidationResult; ruleFlagged: Set<string>; cards: NoteCard[]; ruleRecordFlag: Map<string, boolean> }[] = [];

  for (const caseId of CASES) {
    it(caseId, async () => {
      const { units, cards } = await load(caseId, `${caseId}.openui-v2.txt`);
      const v = validateClaimConditions(cards, RECORDS[caseId]!, goldenOf(caseId));
      const va = validateClaimConditions(cards, RECORDS[caseId]!, goldenOf(caseId), { anchored: true });
      const vc = validateClaimConditions(cards, RECORDS[caseId]!, goldenOf(caseId), { citeOnly: true });
      const rules = checkGeneratedCards(cards, units);
      const ruleFlagged = new Set(Object.entries(rules.reviews).filter(([, r]) => r.reasons.length).map(([k]) => k));
      // A rule "flags" a record when a card citing one of its condition units is Needs review (the closest comparable signal).
      const ruleRecordFlag = new Map(RECORDS[caseId]!.map((r) => [r.id, cards.some((c) => ruleFlagged.has(c.key) && c.cites.some((u) => r.condition.units.includes(u)))]));
      all.push({ caseId, v, va, vc, ruleFlagged, cards, ruleRecordFlag });
      report[caseId] = {
        cards: cards.length,
        records: v.records.map((r) => ({ id: r.id, binding: r.binding, covered: r.covered, carriers: r.carriers, carriersUncited: r.carriersUncited, perCard: r.perCard })),
        integrityFlags: v.integrityFlags,
        coverageGaps: v.coverageGaps,
        citeOnly: { integrityFlags: vc.integrityFlags, coverageGaps: vc.coverageGaps },
        anchored: { integrityFlags: va.integrityFlags, coverageGaps: va.coverageGaps, carriers: Object.fromEntries(va.records.map((r) => [r.id, r.carriers])) },
        integrityFlagsOutsideLabelled: Object.keys(v.integrityFlags).filter((k) => !LABELLED[caseId]!.includes(k)),
        rulesFlaggedLabelled: LABELLED[caseId]!.filter((k) => ruleFlagged.has(k)),
      };
      expect(cards.length).toBeGreaterThan(0);
    });
  }

  it("scores integrity, coverage and wording separately, vs the rule checks", () => {
    const universe: string[] = [];
    const strict = new Set<string>();
    const definite = new Set<string>();
    const proto = new Set<string>();
    const protoA = new Set<string>();
    const protoC = new Set<string>();
    const rule = new Set<string>();
    const wording = new Set<string>();
    for (const { caseId, v, ruleFlagged } of all) {
      for (const k of LABELLED[caseId]!) {
        const id = `${caseId.slice(0, 5)}:${k}`;
        universe.push(id);
        if (INTEGRITY[caseId]!.definite.includes(k)) definite.add(id);
        if (INTEGRITY[caseId]!.definite.includes(k) || INTEGRITY[caseId]!.arguable.includes(k)) strict.add(id);
        if (v.integrityFlags[k]) proto.add(id);
        if (all.find((x) => x.caseId === caseId)!.va.integrityFlags[k]) protoA.add(id);
        if (all.find((x) => x.caseId === caseId)!.vc.integrityFlags[k]) protoC.add(id);
        if (ruleFlagged.has(k)) rule.add(id);
        if (WORDING[caseId]!.includes(k)) wording.add(id);
      }
    }
    const arguable = [...strict].filter((x) => !definite.has(x));
    const lenientUniverse = universe.filter((x) => !arguable.includes(x));
    const recUniverse = all.flatMap(({ v }) => v.records.map((r) => r.id));
    const protoGaps = new Set(all.flatMap(({ v }) => v.coverageGaps));
    const protoGapsA = new Set(all.flatMap(({ va }) => va.coverageGaps));
    const protoGapsC = new Set(all.flatMap(({ vc }) => vc.coverageGaps));
    const ruleGaps = new Set(all.flatMap(({ ruleRecordFlag }) => [...ruleRecordFlag].filter(([, f]) => f).map(([id]) => id)));
    report.scores = {
      integrity: {
        note: "per card, over the 24 labelled cards",
        strict_g2_positive: { prototype: confusion(universe, strict, proto), anchored: confusion(universe, strict, protoA), citeOnly: confusion(universe, strict, protoC), rules: confusion(universe, strict, rule) },
        lenient_g2_excluded: { prototype: confusion(lenientUniverse, definite, proto), anchored: confusion(lenientUniverse, definite, protoA), citeOnly: confusion(lenientUniverse, definite, protoC), rules: confusion(lenientUniverse, definite, rule) },
      },
      coverage: {
        note: "per record (condition), over all records of both cases; rules count as flagging a record when a card citing one of its condition units is Needs review",
        prototype: confusion(recUniverse, COVERAGE_GAPS, protoGaps),
        anchored: confusion(recUniverse, COVERAGE_GAPS, protoGapsA),
        citeOnly: confusion(recUniverse, COVERAGE_GAPS, protoGapsC),
        citeOnlyMissedGaps: [...COVERAGE_GAPS].filter((x) => !protoGapsC.has(x)),
        prototypeFalseGaps: [...protoGaps].filter((x) => !COVERAGE_GAPS.has(x)),
        anchoredFalseGaps: [...protoGapsA].filter((x) => !COVERAGE_GAPS.has(x)),
        rules: confusion(recUniverse, COVERAGE_GAPS, ruleGaps),
      },
      wording_out_of_scope: {
        note: "the prototype should NOT flag these for integrity (they're the distortion checks' job)",
        cards: [...wording],
        prototypeFlagged: [...wording].filter((x) => proto.has(x)),
        anchoredFlagged: [...wording].filter((x) => protoA.has(x)),
        citeOnlyFlagged: [...wording].filter((x) => protoC.has(x)),
        rulesFlagged: [...wording].filter((x) => rule.has(x)),
      },
    };
    report.firstLabelsReconciled = all.flatMap(({ caseId, v, ruleFlagged }) =>
      FIRST_LABELS[caseId]!.map((k) => ({
        card: `${caseId.slice(0, 5)}:${k}`,
        integrity: INTEGRITY[caseId]!.definite.includes(k) ? "definite" : INTEGRITY[caseId]!.arguable.includes(k) ? "arguable" : "no",
        wording: WORDING[caseId]!.includes(k),
        prototype: v.integrityFlags[k] ?? [],
        rules: ruleFlagged.has(k),
      })),
    );
    expect(universe).toHaveLength(24);
  });

  it("writes the report when asked", () => {
    if (process.env.CC_OUT) writeFileSync(process.env.CC_OUT, `${JSON.stringify(report, null, 2)}\n`);
  });
});

/** Controls: hand-built note sets with a known answer. They test the validator, not the model. */
describe("controls", () => {
  const g1 = goldenOf("kn-01-idempotency-keys");
  const g2 = goldenOf("kn-02-edge-cache-invalidation");
  const r1 = RECORDS["kn-01-idempotency-keys"]!;
  const r2 = RECORDS["kn-02-edge-cache-invalidation"]!;
  const card = (key: string, body: string, cites: string[], more: Partial<NoteCard> = {}): NoteCard => ({ key, title: key, body, cites, ...more });
  const window = card("win", "Stored results expire after 24 hours; a later retry is treated as a new payment.", ["u6", "u7"]);
  const reuse = card("reuse", "Reusing a key with a different amount must be rejected.", ["u8"]);

  it("negative: a valid claim split across cards (the claim card keeps its limits; details elsewhere)", () => {
    const set = [card("replay", "If a request with that key already completed, the server returns the stored result, within 24 hours; a different amount with the same key is rejected.", ["u2"]), window, reuse];
    expect(validateClaimConditions(set, r1, g1).integrityFlags).toEqual({});
  });

  it("negative: the condition supplied as explicit context on the card (detail, callout)", () => {
    const viaDetail = card("replay", "If a request with that key already completed, the server returns the stored result.", ["u2"], { detail: "Only within 24 hours. A reused key with a different amount is rejected." });
    expect(validateClaimConditions([viaDetail, window, reuse], r1, g1).integrityFlags).toEqual({});
    const viaCallout = card("swr", "After the TTL the edge serves the expired copy immediately and refreshes it in the background.", ["u38"], { extras: ["At most 60 seconds past the TTL."] });
    expect(validateClaimConditions([viaCallout], r2, g2).integrityFlags.swr).toBeUndefined();
  });

  it("negative: the condition supplied by an explicit link (accepted by default; rejected under the strict policy)", () => {
    const linked = card("replay", "If a request with that key already completed, the server returns the stored result.", ["u2"], { links: ["win", "reuse"] });
    expect(validateClaimConditions([linked, window, reuse], r1, g1).integrityFlags).toEqual({});
    expect(validateClaimConditions([linked, window, reuse], r1, g1, { acceptLinks: false }).integrityFlags.replay?.map((f) => f.record).sort()).toEqual(["kn01.replay.reuse", "kn01.replay.window"]);
  });

  it("negative: unrelated source conditions don't flag a card", () => {
    // Same section, different claims: the example, the definition, versioned caching (whose HTML caveat is set-level).
    const set = [
      card("def", "A client attaches a unique key so the server can recognise a retry of the same operation.", ["u1"]),
      card("ex", "A checkout client sends Idempotency-Key 7f3c-91ab with a payment.", ["u3"]),
    ];
    expect(validateClaimConditions(set, r1, g1).integrityFlags).toEqual({});
    const assets = [card("long", "Versioned assets can be cached for a year (max-age=31536000).", ["u47"])];
    expect(validateClaimConditions(assets, r2, g2).integrityFlags).toEqual({});
  });

  it("positive: a nearby bound for a different claim doesn't count (stale-if-error's day is not the 60-second bound)", () => {
    const swr = card("swr", "After the TTL the edge serves the expired copy immediately; stale-if-error keeps serving for up to one day while the origin errors.", ["u38"]);
    expect(validateClaimConditions([swr], r2, g2).integrityFlags.swr?.map((f) => f.record)).toEqual(["kn02.swr.bound"]);
  });

  it("positive: a claim card with its condition only on another card is 'separated'; with it nowhere, 'absent'", () => {
    const bare = card("replay", "The server returns the stored result for a repeated key.", ["u2"]);
    const withOthers = validateClaimConditions([bare, window, reuse], r1, g1);
    expect(withOthers.integrityFlags.replay).toEqual(expect.arrayContaining([{ record: "kn01.replay.window", outcome: "separated" }, { record: "kn01.replay.reuse", outcome: "separated" }]));
    expect(validateClaimConditions([bare], r1, g1).integrityFlags.replay).toEqual(expect.arrayContaining([{ record: "kn01.replay.window", outcome: "absent" }]));
  });

  it("lineage: records follow unit ids across versions, and say when the link must be re-confirmed", () => {
    const rec = r1.find((r) => r.id === "kn01.replay.window")!;
    const base = { fromVersion: 1, toVersion: 2 };
    const same = remapRecord(rec, { ...base, entries: ["u2", "u6", "u7"].map((u, i) => ({ state: "unchanged" as const, from: u, to: `u${10 + i}` })) });
    expect(same).toMatchObject({ status: "kept", record: { claim: { units: ["u10"] }, condition: { units: ["u11", "u12"] } } });
    const changed = remapRecord(rec, { ...base, entries: [{ state: "unchanged", from: "u2", to: "u2" }, { state: "changed", from: "u6", to: "u6" }, { state: "unchanged", from: "u7", to: "u7" }] });
    expect(changed.status).toBe("source_changed");
    const removed = remapRecord(rec, { ...base, entries: [{ state: "unchanged", from: "u2", to: "u2" }, { state: "removed", from: "u6" }, { state: "unchanged", from: "u7", to: "u7" }] });
    expect(removed.status).toBe("retired");
  });
});
