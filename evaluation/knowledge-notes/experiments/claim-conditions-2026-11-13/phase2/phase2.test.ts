/**
 * Phase 2 evaluation (PROTOCOL.md). $0, no model call, saved output only.
 *
 *   P2_OUT=<file> npx vitest run --config vitest.evaluation.config.ts evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/phase2/
 *     scores the DEV cases (kn-01–kn-04): use for tuning.
 *   P2_FINAL=1 … additionally scores the FROZEN final cases (kn-05–kn-12), after checking every label, packet and protocol
 *     hash against FREEZE.json, and records the hashes of the code it scored. Run once.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardReviews, inspectSection, CITES, UNCITED } from "@/ai/fidelity/knowledgeCheck";
import type { Omission } from "@/ai/fidelity/contracts";
import { DATASET_ROOT } from "../../../tooling/load";
import { RECORDS as PHASE1 } from "../records";
import { checkRecords, isFailure, type CheckRecord, type Outcome } from "./checker";
import { DEV, FINAL, PHASE2, loadLabels, loadRecorded, type CaseData, type LabelRecord } from "./data";
import { extractRecords, matchRecords } from "./extract";

const rate = (num: number, den: number) => (den ? Number((num / den).toFixed(2)) : null);
const confusion = (truth: (k: string) => boolean, flagged: (k: string) => boolean, universe: string[]) => {
  const tp = universe.filter((k) => truth(k) && flagged(k));
  const fp = universe.filter((k) => !truth(k) && flagged(k));
  const fn = universe.filter((k) => truth(k) && !flagged(k));
  return { tp: tp.length, fp: fp.length, fn: fn.length, tn: universe.length - tp.length - fp.length - fn.length, precision: rate(tp.length, tp.length + fp.length), recall: rate(tp.length, tp.length + fn.length), fpList: fp, fnList: fn };
};
const sum = (rows: Record<string, number | null | unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)]));

function ruleFlaggedCards(data: CaseData): Set<string> {
  const raw = { nodes: data.raw.nodes.map((n) => { const cites = data.nodes.find((x) => x.id === n.id)?.cites ?? []; return { ...n, ...(cites.length ? { [CITES]: cites } : n.type === "text" ? { [UNCITED]: true } : {}) }; }) };
  const reviews = cardReviews(inspectSection(raw, data.units, data.omitted as Omission[]));
  return new Set(Object.entries(reviews).filter(([, r]) => r.reasons.length).map(([k]) => k));
}

function scoreCase(caseId: string) {
  const data = loadRecorded(caseId);
  const labels = loadLabels(caseId).records;
  const claimRecs = labels.filter((r) => r.binding === "claim");
  const toCheck = (r: LabelRecord, withCards: boolean): CheckRecord => ({ id: r.id, claimUnits: r.claimUnits, conditionUnits: r.conditionUnits, binding: r.binding, ...(withCards ? { claimCards: r.claimCards } : {}) });

  // 1. Extraction.
  const extracted = extractRecords(data.units);
  const m = matchRecords(extracted, labels);
  const binding = { claim_claim: 0, claim_set: 0, set_claim: 0, set_set: 0 };
  for (const p of m.pairs) binding[`${p.r.binding}_${p.x.binding}` as keyof typeof binding]++;
  const extraction = { reviewed: labels.length, extracted: extracted.length, matched: m.pairs.length, precision: rate(m.pairs.length, extracted.length), recall: rate(m.pairs.length, labels.length), binding_truth_vs_extracted: binding, missed: m.unmatchedReviewed.map((r) => `${r.id} ${r.conditionUnits.join("+")}→${r.claimUnits.join("+")} (${r.binding})`), spurious: m.unmatchedExtracted.length };

  // 2. Integrity. Pairs (card, record) over claim-binding records.
  const truthPair = new Map<string, Outcome>();
  for (const r of claimRecs) for (const [card, o] of Object.entries(r.perClaimCard)) truthPair.set(`${r.id}|${card}`, o);
  const oracle = checkRecords(data, claimRecs.map((r) => toCheck(r, true)));
  const oracleAuto = checkRecords(data, claimRecs.map((r) => toCheck(r, false)));
  const pairsOf = (checks: ReturnType<typeof checkRecords>, recordIdOf: (id: string) => string | undefined) => {
    const out = new Map<string, Outcome>();
    for (const c of checks) {
      const rid = recordIdOf(c.id);
      for (const [card, o] of Object.entries(c.perClaimCard)) out.set(`${rid ?? `spurious:${c.id}`}|${card}`, o);
    }
    return out;
  };
  const scorePairs = (got: Map<string, Outcome>) => {
    const universe = [...new Set([...truthPair.keys(), ...got.keys()])];
    return confusion((k) => isFailure(truthPair.get(k)), (k) => isFailure(got.get(k)), universe);
  };
  const oraclePairs = pairsOf(oracle, (id) => id);
  const agreement5 = [...truthPair].filter(([k, o]) => oraclePairs.get(k) === o).length;
  // End to end: extracted records that match a reviewed one speak for it; the rest are spurious.
  const xToR = new Map(m.pairs.map((p) => [p.x.id, p.r.id]));
  const e2e = checkRecords(data, extracted.filter((x) => x.binding === "claim"));
  const rules = ruleFlaggedCards(data);
  const integrity = {
    pairs: truthPair.size,
    truthFailures: [...truthPair.values()].filter(isFailure).length,
    oracle: { ...scorePairs(oraclePairs), outcomeAgreement5way: rate(agreement5, truthPair.size) },
    oracleRecordsAutoCards: scorePairs(pairsOf(oracleAuto, (id) => id)),
    endToEnd: scorePairs(pairsOf(e2e, (id) => xToR.get(id))),
    rules: confusion((k) => isFailure(truthPair.get(k)), (k) => rules.has(k.split("|")[1]!), [...truthPair.keys()]),
  };

  // 3. Coverage and the clause detector (all records, oracle).
  const all = checkRecords(data, labels.map((r) => toCheck(r, true)));
  const coverage = confusion((id) => !labels.find((r) => r.id === id)!.carriers.length, (id) => !all.find((c) => c.id === id)!.covered, labels.map((r) => r.id));
  const carrierUniverse: string[] = [];
  const truthCarrier = new Set<string>();
  const gotCarrier = new Set<string>();
  for (const r of labels) {
    const c = all.find((x) => x.id === r.id)!;
    for (const n of data.nodes) carrierUniverse.push(`${r.id}|${n.id}`);
    r.carriers.forEach((n) => truthCarrier.add(`${r.id}|${n}`));
    c.carriers.forEach((n) => gotCarrier.add(`${r.id}|${n}`));
  }
  const carriers = confusion((k) => truthCarrier.has(k), (k) => gotCarrier.has(k), carrierUniverse);

  // 4. Citation completeness (separate; never part of 2 or 3).
  const cardNodes = data.nodes.filter((n) => ["text", "shape", "table", "code", "todo"].includes(n.type));
  const nodeCites = new Map(data.nodes.map((n) => [n.id, n.cites]));
  const claimCardRefs = labels.flatMap((r) => r.claimCards.map((c) => ({ r, c })));
  const carrierRefs = labels.flatMap((r) => r.carriers.map((c) => ({ r, c })));
  const citation = {
    cardsWithAnyCite: rate(cardNodes.filter((n) => n.cites.length).length, cardNodes.length),
    cards: cardNodes.length,
    claimCardsCitingClaim: rate(claimCardRefs.filter(({ r, c }) => (nodeCites.get(c) ?? []).some((u) => r.claimUnits.includes(u))).length, claimCardRefs.length),
    claimCardRefs: claimCardRefs.length,
    carriersCitingCondition: rate(carrierRefs.filter(({ r, c }) => (nodeCites.get(c) ?? []).some((u) => r.conditionUnits.includes(u))).length, carrierRefs.length),
    carrierRefs: carrierRefs.length,
    /** Pairs where a card cites the condition but the reviewer says it does NOT convey it: citations that would wrongly count as preservation. */
    citedButNotConveyed: labels.flatMap((r) => r.claimCards.filter((c) => (nodeCites.get(c) ?? []).some((u) => r.conditionUnits.includes(u)) && !r.carriers.includes(c) && r.conditionUnits.some((u) => !r.claimUnits.includes(u)))).length,
  };

  return { caseId, extraction, integrity, coverage, carriers, citation };
}

function aggregate(rows: ReturnType<typeof scoreCase>[]) {
  const pr = (pick: (r: ReturnType<typeof scoreCase>) => { tp: number; fp: number; fn: number; tn: number }) => {
    const s = sum(rows.map(pick) as unknown as Record<string, number>[], ["tp", "fp", "fn", "tn"]) as { tp: number; fp: number; fn: number; tn: number };
    return { ...s, precision: rate(s.tp, s.tp + s.fp), recall: rate(s.tp, s.tp + s.fn) };
  };
  const ex = sum(rows.map((r) => r.extraction) as unknown as Record<string, number>[], ["reviewed", "extracted", "matched"]) as { reviewed: number; extracted: number; matched: number };
  const binding = sum(rows.map((r) => r.extraction.binding_truth_vs_extracted), ["claim_claim", "claim_set", "set_claim", "set_set"]) as Record<string, number>;
  const cit = (k: "cardsWithAnyCite" | "claimCardsCitingClaim" | "carriersCitingCondition", n: "cards" | "claimCardRefs" | "carrierRefs") => {
    const den = rows.reduce((a, r) => a + r.citation[n], 0);
    return rate(rows.reduce((a, r) => a + (r.citation[k] ?? 0) * r.citation[n], 0), den);
  };
  return {
    cases: rows.length,
    extraction: { ...ex, precision: rate(ex.matched, ex.extracted), recall: rate(ex.matched, ex.reviewed), binding, bindingAccuracy: rate(binding.claim_claim! + binding.set_set!, ex.matched) },
    integrity: {
      pairs: rows.reduce((a, r) => a + r.integrity.pairs, 0),
      truthFailures: rows.reduce((a, r) => a + r.integrity.truthFailures, 0),
      oracle: pr((r) => r.integrity.oracle),
      oracleRecordsAutoCards: pr((r) => r.integrity.oracleRecordsAutoCards),
      endToEnd: pr((r) => r.integrity.endToEnd),
      rules: pr((r) => r.integrity.rules),
    },
    coverage: pr((r) => r.coverage),
    carriers: pr((r) => r.carriers),
    citation: {
      cardsWithAnyCite: cit("cardsWithAnyCite", "cards"),
      claimCardsCitingClaim: cit("claimCardsCitingClaim", "claimCardRefs"),
      carriersCitingCondition: cit("carriersCitingCondition", "carrierRefs"),
      citedButNotConveyed: rows.reduce((a, r) => a + r.citation.citedButNotConveyed, 0),
    },
  };
}

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("phase 2: claim–condition extraction and validation (offline)", () => {
  it("dev: kn-01/kn-02 extraction against the phase 1 records", () => {
    const rows = ["kn-01-idempotency-keys", "kn-02-edge-cache-invalidation"].map((caseId) => {
      const data = loadRecorded(caseId);
      const reviewed = PHASE1[caseId]!.map((r) => ({ id: r.id, claimUnits: r.claim.units, conditionUnits: r.condition.units, binding: r.binding }));
      const m = matchRecords(extractRecords(data.units), reviewed);
      return { caseId, reviewed: reviewed.length, extracted: extractRecords(data.units).length, matched: m.pairs.length, bindingAgree: m.pairs.filter((p) => p.x.binding === p.r.binding).length, missed: m.unmatchedReviewed.map((r) => r.id) };
    });
    report.devPhase1 = rows;
    expect(rows).toHaveLength(2);
  });

  it("dev: kn-03, kn-04", () => {
    const rows = DEV.map(scoreCase);
    report.dev = { aggregate: aggregate(rows), perCase: rows };
    expect(rows).toHaveLength(2);
  });

  // Timeout: the first final attempt (2026-11-13) hit vitest's 5 s default before producing any result.
  it.runIf(process.env.P2_FINAL === "1")("FINAL (frozen): kn-05–kn-12", { timeout: 120_000 }, () => {
    const freeze = JSON.parse(readFileSync(join(PHASE2, "FREEZE.json"), "utf8")) as { sha256: Record<string, string>; frozenAt: string };
    for (const [file, hash] of Object.entries(freeze.sha256)) expect(sha(join(PHASE2, file)), `${file} changed since the freeze`).toBe(hash);
    const rows = FINAL.map(scoreCase);
    report.final = {
      frozenAt: freeze.frozenAt,
      scoredCode: Object.fromEntries(["extract.ts", "clauseCheck.ts", "checker.ts", "data.ts", "phase2.test.ts"].map((f) => [f, sha(join(PHASE2, f))])),
      aggregate: aggregate(rows),
      perCase: rows,
    };
    expect(rows).toHaveLength(FINAL.length);
  });

  it("writes the report when asked", () => {
    if (process.env.P2_OUT) writeFileSync(process.env.P2_OUT, `${JSON.stringify(report, null, 2)}\n`);
  });
});

const report: Record<string, unknown> = { at: "2026-11-13", cost: "$0 (no model call)", data: "recordings/2026-10-19-distil-gemini-flash (saved output)", root: DATASET_ROOT.replace(/\\/g, "/").split("/").slice(-2).join("/") };
