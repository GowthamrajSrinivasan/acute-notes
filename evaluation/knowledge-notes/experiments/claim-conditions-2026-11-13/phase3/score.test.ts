/**
 * Phase 3 scoring from the frozen adjudicated labels (`adjudicated/`, `FREEZE-v2.json`). $0, saved output only.
 * Reports what the saved notes DID (coverage, integrity, missing citations), and how the existing rule checks compare
 * with the adjudicated labels. The prototype detector is not scored here (phase 3 decision: no detector work).
 *
 *   P3_SCORE_OUT=<file> npx vitest run --config vitest.evaluation.config.ts evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/phase3/score.test.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { Omission } from "@/ai/fidelity/contracts";
import { cardReviews, inspectSection, CITES, UNCITED } from "@/ai/fidelity/knowledgeCheck";
import { checkGeneratedCards } from "@/ai/openui/notesCheck";
import { DATASET_ROOT } from "../../../tooling/load";
import { loadRecorded } from "../phase2/data";
import { ALL_CASES, OPENUI, P3, type Verdict } from "./agreement.test";
import { openuiCards } from "./openuiPackets.test";

type Outcome = "carried" | "frame" | "arrow_label" | "linked" | "separated" | "absent";
interface NoteLabels { claimCards: string[]; carriers: string[]; perClaimCard: Record<string, Outcome>; changedFromV1?: Record<string, string> }
interface AdjRecord {
  id: string;
  conditionUnits: string[];
  verdict: Verdict;
  claimUnits: string[];
  status: "agreed" | "adjudicated" | "unresolved";
  notes?: Record<string, NoteLabels>;
}
interface Adj { caseId: string; records: AdjRecord[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as T;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const tally = (xs: readonly string[]) => xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});
const rate = (a: number, b: number) => (b ? Number((a / b).toFixed(2)) : null);
const isFailure = (o?: Outcome) => o === "separated" || o === "absent";
/** A carrier id may be `arrow:a->b` (an arrow label): it has no citations of its own. */
const isArrow = (id: string) => id.startsWith("arrow:");

function noteSetResult(records: AdjRecord[], key: string, cites: Map<string, string[]>, ruleFlagged: Set<string>) {
  const scoped = records.filter((r) => r.notes?.[key]);
  const pairs: { record: string; verdict: Verdict; card: string; outcome: Outcome; citesClaim: boolean }[] = [];
  for (const r of scoped) for (const [card, outcome] of Object.entries(r.notes![key]!.perClaimCard)) pairs.push({ record: r.id, verdict: r.verdict, card, outcome, citesClaim: (cites.get(card) ?? []).some((u) => r.claimUnits.includes(u)) });
  const claimPairs = pairs.filter((p) => p.verdict === "claim");
  const failures = claimPairs.filter((p) => isFailure(p.outcome));
  const ruleOn = (ps: typeof pairs) => {
    const tp = ps.filter((p) => isFailure(p.outcome) && ruleFlagged.has(p.card)).length;
    const fp = ps.filter((p) => !isFailure(p.outcome) && ruleFlagged.has(p.card)).length;
    const fn = ps.filter((p) => isFailure(p.outcome) && !ruleFlagged.has(p.card)).length;
    return { tp, fp, fn, tn: ps.length - tp - fp - fn, precision: rate(tp, tp + fp), recall: rate(tp, tp + fn) };
  };
  const carrierRefs = scoped.flatMap((r) => r.notes![key]!.carriers.filter((c) => !isArrow(c)).map((c) => ({ r, c })));
  const claimRefs = scoped.flatMap((r) => r.notes![key]!.claimCards.map((c) => ({ r, c })));
  return {
    records: { byVerdict: tally(scoped.map((r) => r.verdict)) },
    coverage: {
      // A condition is covered when any node, frame or arrow label carries it.
      claimOrSet: { records: scoped.filter((r) => r.verdict !== "ambiguous").length, gaps: scoped.filter((r) => r.verdict !== "ambiguous" && !r.notes![key]!.carriers.length).map((r) => r.id) },
      ambiguous: { records: scoped.filter((r) => r.verdict === "ambiguous").length, gaps: scoped.filter((r) => r.verdict === "ambiguous" && !r.notes![key]!.carriers.length).map((r) => r.id) },
      arrowLabelOnlyCarriers: scoped.filter((r) => { const c = r.notes![key]!.carriers; return c.length > 0 && c.every(isArrow); }).map((r) => r.id),
    },
    integrity: {
      claimPairs: claimPairs.length,
      outcomes: tally(claimPairs.map((p) => p.outcome)),
      failures: failures.map((p) => `${p.record}|${p.card}:${p.outcome}`),
      ambiguousPairs: { n: pairs.filter((p) => p.verdict === "ambiguous").length, outcomes: tally(pairs.filter((p) => p.verdict === "ambiguous").map((p) => p.outcome)) },
      // Protocol-driven changes ("separated→linked") apart from cards added under a widened claim link or merged records.
      outcomeChangedByV2: scoped.flatMap((r) => Object.entries(r.notes![key]!.changedFromV1 ?? {}).filter(([, why]) => /^(carried|frame|linked|separated|absent|arrow_label)→/.test(String(why))).map(([card, why]) => `${r.id}|${card}: ${why}`)),
      otherLabelChanges: scoped.reduce((n, r) => n + Object.values(r.notes![key]!.changedFromV1 ?? {}).filter((why) => !/^(carried|frame|linked|separated|absent|arrow_label)→/.test(String(why))).length, 0),
    },
    citations: {
      // Missing citations, reported apart from semantic failures.
      claimCardsNotCitingClaim: claimRefs.filter(({ r, c }) => !(cites.get(c) ?? []).some((u) => r.claimUnits.includes(u))).length,
      claimCardRefs: claimRefs.length,
      carriersNotCitingCondition: carrierRefs.filter(({ r, c }) => !(cites.get(c) ?? []).some((u) => r.conditionUnits.includes(u))).length,
      carrierRefs: carrierRefs.length,
      integrityFailuresOnCitedClaimCards: failures.filter((p) => p.citesClaim).length,
      integrityFailuresOnUncitedClaimCards: failures.filter((p) => !p.citesClaim).length,
    },
    rules: { claimPairs: ruleOn(claimPairs) },
  };
}

function distilRules(caseId: string): { cites: Map<string, string[]>; flagged: Set<string> } {
  const data = loadRecorded(caseId);
  const raw = { nodes: data.raw.nodes.map((n) => { const cites = data.nodes.find((x) => x.id === n.id)?.cites ?? []; return { ...n, ...(cites.length ? { [CITES]: cites } : n.type === "text" ? { [UNCITED]: true } : {}) }; }) };
  const reviews = cardReviews(inspectSection(raw, data.units, data.omitted as Omission[]));
  return { cites: new Map(data.nodes.map((n) => [n.id, n.cites])), flagged: new Set(Object.entries(reviews).filter(([, r]) => r.reasons.length).map(([k]) => k)) };
}

it.skipIf(!process.env.P3_SCORE_OUT)("phase 3 results from the frozen adjudicated labels", { timeout: 120_000 }, async () => {
  const freeze = readJson<{ sha256: Record<string, string>; frozenAt: string }>(join(P3, "FREEZE-v2.json"));
  for (const [file, hash] of Object.entries(freeze.sha256)) expect(sha(join(P3, file)), `${file} changed since the v2 freeze`).toBe(hash);
  const out: Record<string, unknown> = { frozenAt: freeze.frozenAt, cost: "$0 (no model call)" };
  const adjudicated: Record<string, unknown> = {};
  for (const caseId of ALL_CASES) {
    const raw = readJson<Adj>(join(P3, "adjudicated", `${caseId}.json`));
    // Two reviewers can propose the same additional condition (kn-02: both proposed u40, u12, u9): count it once.
    const key = (r: AdjRecord) => [...r.conditionUnits].sort().join("+");
    const adj = { ...raw, records: raw.records.filter((r, i) => !r.id.startsWith("a") || !raw.records.slice(0, i).some((o) => key(o) === key(r))) };
    const duplicatesDropped = raw.records.length - adj.records.length;
    const base = { duplicatesDropped, verdicts: tally(adj.records.map((r) => r.verdict)), status: tally(adj.records.map((r) => r.status)), verdictByStatus: tally(adj.records.map((r) => `${r.status}:${r.verdict}`)) };
    if (OPENUI.has(caseId)) {
      const sets: Record<string, unknown> = {};
      for (const v of ["v1", "v2"] as const) {
        const { units, cards } = await openuiCards(caseId, v);
        const check = checkGeneratedCards(cards, units);
        const flagged = new Set(Object.entries(check.reviews).filter(([, r]) => r.reasons.length).map(([k]) => `${v}:${k}`));
        const cites = new Map(cards.map((c) => [`${v}:${c.key}`, c.cites]));
        sets[`openui-${v}`] = { cards: cards.length, uncitedCards: cards.filter((c) => !c.cites.length).length, ...noteSetResult(adj.records, `openui-${v}`, cites, flagged) };
      }
      adjudicated[caseId] = { ...base, noteSets: sets };
    } else {
      const { cites, flagged } = distilRules(caseId);
      adjudicated[caseId] = { ...base, noteSets: { distil: noteSetResult(adj.records, "distil", cites, flagged) } };
    }
  }
  out.cases = adjudicated;
  // Golden assertion coverage on the OpenUI replies: as scored 2026-11-13 by openuiFidelity.test.ts (same files), split by dimension.
  const rep = readJson<Record<string, { perAssertion: Record<string, { severity: string; openui: string; openuiV2: string }> }>>(join(DATASET_ROOT, "experiments", "openui-2026-11-13", "report.json"));
  const assertions: Record<string, unknown> = {};
  for (const caseId of OPENUI) {
    const ev = readJson<{ assertions: { id: string; dimension: string }[] }>(join(DATASET_ROOT, "cases", caseId, "evaluation.json"));
    const dim = new Map(ev.assertions.map((a) => [a.id, a.dimension]));
    const rows = Object.entries(rep[caseId]!.perAssertion).map(([id, a]) => ({ id, dimension: dim.get(id), severity: a.severity, v1: a.openui, v2: a.openuiV2 }));
    assertions[caseId] = Object.fromEntries(["coverage", "source_fidelity", "traceability"].map((d) => [d, { v1: tally(rows.filter((r) => r.dimension === d).map((r) => r.v1)), v2: tally(rows.filter((r) => r.dimension === d).map((r) => r.v2)), failingV2: rows.filter((r) => r.dimension === d && r.v2 === "fail").map((r) => `${r.severity}:${r.id}`) }]));
  }
  out.goldenAssertions = assertions;
  writeFileSync(process.env.P3_SCORE_OUT!, `${JSON.stringify(out, null, 2)}\n`);
});
