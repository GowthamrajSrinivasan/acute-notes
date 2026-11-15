/**
 * Phase 3: reviewer agreement (claim link and binding, measured separately) and the adjudication packets.
 *
 *   P3_AGREE_OUT=<file>  writes the agreement report.
 *   P3_ADJ_PACKETS=1     writes adjudication packets (both reviews, the golden link, the note sets) to adjudication-packets/.
 *
 * Pairs compared:
 *  - kn-03–kn-12: the phase 2 reviewer (R1) vs the phase 3 second reviewer (R2), per R1 record;
 *  - kn-01/kn-02: two fresh blind reviewers (A vs B), per candidate;
 *  - every reviewer vs the golden `limits` link, where a candidate has one.
 * R1 used two verdicts (claim, set) — it had no `ambiguous` or `not_a_condition` — so R1-vs-R2 binding agreement is over
 * claim/set only, with R2's extra verdicts reported as their own rows.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { DATASET_ROOT } from "../../../tooling/load";
import type { Candidate } from "./build.test";

export const P3 = join(DATASET_ROOT, "experiments", "claim-conditions-2026-11-13", "phase3");
export const ALL_CASES = [
  "kn-01-idempotency-keys",
  "kn-02-edge-cache-invalidation",
  "kn-03-blue-green-deploy",
  "kn-04-queue-choice",
  "kn-05-incident-review-meeting",
  "kn-06-hybrid-search-reranking",
  "kn-07-photo-sharing-hld",
  "kn-08-helpdesk-answers-hld-lld",
  "kn-09-billing-codebase-map",
  "kn-10-inventory-architecture-frames",
  "kn-11-ambiguous-analytics-proposal",
  "kn-12-flag-rollout-update",
];
export const OPENUI = new Set(["kn-01-idempotency-keys", "kn-02-edge-cache-invalidation"]);

export type Verdict = "claim" | "set" | "ambiguous" | "not_a_condition";
export interface Review {
  caseId: string;
  reviewer: string;
  verdicts: { candidate: string; verdict: Verdict; claimUnits: string[]; conditionQuote?: string; claimQuote?: string; confidence?: string; note?: string }[];
  additional?: { conditionUnits: string[]; verdict: Verdict; claimUnits: string[]; conditionQuote?: string; claimQuote?: string; confidence?: string; note?: string }[];
}

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as T;
export const candidatesOf = (caseId: string) => readJson<Record<string, Candidate[]>>(join(P3, "candidates.json"))[caseId]!;
export const reviewsOf = (caseId: string): Review[] =>
  ["A", "B", "R2"].map((r) => join(P3, "review2", `${caseId}.${r}.json`)).filter(existsSync).map((p) => readJson<Review>(p));

export type LinkAgreement = "exact" | "overlap" | "disjoint" | "n/a";
export function linkAgreement(a: readonly string[], b: readonly string[]): LinkAgreement {
  if (!a.length || !b.length) return "n/a";
  const sa = [...a].sort().join("+");
  const sb = [...b].sort().join("+");
  if (sa === sb) return "exact";
  return a.some((x) => b.includes(x)) ? "overlap" : "disjoint";
}

/** Cohen's kappa over paired categorical labels. */
export function kappa(pairs: readonly [string, string][]): number | null {
  if (!pairs.length) return null;
  const cats = [...new Set(pairs.flat())];
  const n = pairs.length;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? null : Number(((po - pe) / (1 - pe)).toFixed(2));
}

const tally = (xs: readonly string[]) => xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});

export function agreement() {
  const r1r2: { caseId: string; candidate: string; r1: string; r1Binding: string; r2Verdict: Verdict; link: LinkAgreement }[] = [];
  const ab: { caseId: string; candidate: string; a: Verdict; b: Verdict; link: LinkAgreement }[] = [];
  const golden: { caseId: string; candidate: string; reviewer: string; verdict: Verdict; link: LinkAgreement }[] = [];
  const additional: Record<string, number> = {};
  for (const caseId of ALL_CASES) {
    const cands = candidatesOf(caseId);
    const reviews = reviewsOf(caseId);
    for (const rv of reviews) additional[`${caseId}.${rv.reviewer}`] = rv.additional?.length ?? 0;
    const v = (rv: Review, c: string) => rv.verdicts.find((x) => x.candidate === c);
    for (const c of cands) {
      for (const rv of reviews) {
        const got = v(rv, c.id);
        if (!got) continue;
        for (const g of c.sources.filter((s) => s.kind === "golden")) golden.push({ caseId, candidate: c.id, reviewer: rv.reviewer, verdict: got.verdict, link: got.verdict === "not_a_condition" ? "n/a" : linkAgreement(got.claimUnits, g.claimUnits) });
      }
      if (OPENUI.has(caseId)) {
        const a = reviews.find((r) => r.reviewer === "A");
        const b = reviews.find((r) => r.reviewer === "B");
        const va = a && v(a, c.id);
        const vb = b && v(b, c.id);
        if (va && vb) ab.push({ caseId, candidate: c.id, a: va.verdict, b: vb.verdict, link: va.verdict === "not_a_condition" || vb.verdict === "not_a_condition" ? "n/a" : linkAgreement(va.claimUnits, vb.claimUnits) });
      } else {
        const r2 = reviews.find((r) => r.reviewer === "R2");
        const got = r2 && v(r2, c.id);
        if (!got) continue;
        for (const s of c.sources.filter((x) => x.kind === "r1")) r1r2.push({ caseId, candidate: c.id, r1: s.ref, r1Binding: s.binding!, r2Verdict: got.verdict, link: got.verdict === "not_a_condition" ? "n/a" : linkAgreement(s.claimUnits, got.claimUnits) });
      }
    }
  }
  const bindingPairs = r1r2.filter((x) => x.r2Verdict === "claim" || x.r2Verdict === "set").map((x) => [x.r1Binding, x.r2Verdict] as [string, string]);
  const confusion = tally(r1r2.map((x) => `${x.r1Binding}→${x.r2Verdict}`));
  return {
    r1VsR2: {
      items: r1r2.length,
      r2Verdicts: tally(r1r2.map((x) => x.r2Verdict)),
      binding: {
        confusionR1toR2: confusion,
        claimSetItems: bindingPairs.length,
        agreementOnClaimSet: bindingPairs.length ? Number((bindingPairs.filter(([a, b]) => a === b).length / bindingPairs.length).toFixed(2)) : null,
        kappaOnClaimSet: kappa(bindingPairs),
      },
      claimLink: tally(r1r2.map((x) => x.link)),
      claimLinkWhenBothCondition: (() => {
        const xs = r1r2.filter((x) => x.link !== "n/a");
        return { n: xs.length, exact: xs.filter((x) => x.link === "exact").length, overlap: xs.filter((x) => x.link === "overlap").length, disjoint: xs.filter((x) => x.link === "disjoint").length };
      })(),
      perCase: Object.fromEntries(ALL_CASES.filter((c) => !OPENUI.has(c)).map((c) => {
        const xs = r1r2.filter((x) => x.caseId === c);
        return [c, { items: xs.length, bindingSame: xs.filter((x) => x.r1Binding === x.r2Verdict).length, linkExact: xs.filter((x) => x.link === "exact").length, notACondition: xs.filter((x) => x.r2Verdict === "not_a_condition").length, ambiguous: xs.filter((x) => x.r2Verdict === "ambiguous").length }];
      })),
      rows: r1r2,
    },
    aVsB: {
      items: ab.length,
      verdictAgreement4way: ab.length ? Number((ab.filter((x) => x.a === x.b).length / ab.length).toFixed(2)) : null,
      kappa4way: kappa(ab.map((x) => [x.a, x.b])),
      confusionAtoB: tally(ab.map((x) => `${x.a}→${x.b}`)),
      claimLink: tally(ab.map((x) => x.link)),
      rows: ab,
    },
    vsGolden: { items: golden.length, verdicts: tally(golden.map((x) => x.verdict)), claimLink: tally(golden.map((x) => x.link)), rows: golden },
    additionalConditions: additional,
  };
}

it.skipIf(!process.env.P3_AGREE_OUT)("reviewer agreement", () => {
  writeFileSync(process.env.P3_AGREE_OUT!, `${JSON.stringify(agreement(), null, 2)}\n`);
});

it.skipIf(!process.env.P3_ADJ_PACKETS)("adjudication packets", () => {
  for (const caseId of ALL_CASES) {
    const cands = candidatesOf(caseId);
    const reviews = reviewsOf(caseId);
    const packet = readFileSync(join(P3, "review-packets", `${caseId}.md`), "utf8");
    const units = packet.split("## Candidate conditions")[0]!;
    const L = [`# Adjudication packet: ${caseId}`, "", units.replace(/^# .*\n/, "").trim(), "", "## Candidates with every reading", ""];
    for (const c of cands) {
      L.push(`### ${c.id}: condition units ${c.conditionUnits.join(", ")}`);
      for (const s of c.sources) L.push(`- ${s.kind === "golden" ? "GOLDEN dataset link" : OPENUI.has(caseId) ? "phase 1 record (session author, golden-derived; NOT blind)" : "R1 (phase 2 blind reviewer)"} ${s.ref}: claim ${s.claimUnits.join("+") || "-"}${s.binding ? `, binding ${s.binding}` : ""}${s.summary ? ` — ${s.summary}` : ""}`);
      for (const rv of reviews) {
        const v = rv.verdicts.find((x) => x.candidate === c.id);
        if (v) L.push(`- ${rv.reviewer} (blind): ${v.verdict}, claim ${v.claimUnits.join("+") || "-"} (${v.confidence ?? "?"}) — condition "${v.conditionQuote ?? ""}" / claim "${v.claimQuote ?? ""}"${v.note ? ` — ${v.note}` : ""}`);
      }
      L.push("");
    }
    const extra = reviews.flatMap((rv) => (rv.additional ?? []).map((a) => ({ ...a, reviewer: rv.reviewer })));
    if (extra.length) {
      L.push("## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)", "");
      extra.forEach((a, i) => L.push(`### a${i + 1}: condition units ${a.conditionUnits.join(", ")} — from ${a.reviewer}: ${a.verdict}, claim ${a.claimUnits.join("+") || "-"} — condition "${a.conditionQuote ?? ""}" / claim "${a.claimQuote ?? ""}"${a.note ? ` — ${a.note}` : ""}`, ""));
    }
    writeFileSync(join(P3, "adjudication-packets", `${caseId}.md`), `${L.join("\n")}\n`);
  }
});
