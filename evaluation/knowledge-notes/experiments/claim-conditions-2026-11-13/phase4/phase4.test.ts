/**
 * Phase 4: clause-level agreement between the two blind annotators (X, Y), adjudication packets, and the v3 snapshot's
 * dataset summary. $0; no model call; no checker, rule or detector is scored (phase 4 decision).
 *
 *   P4_AGREE_OUT=<file>   clause-level agreement (fixed before any annotation was read).
 *   P4_ADJ_PACKETS=1      writes adjudication-packets/.
 *   P4_SUMMARY_OUT=<file> the v3 snapshot's summary (refuses unless FREEZE-v3.json matches).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DATASET_ROOT } from "../../../tooling/load";

const P4 = join(DATASET_ROOT, "experiments", "claim-conditions-2026-11-13", "phase4");
const P3 = join(DATASET_ROOT, "experiments", "claim-conditions-2026-11-13", "phase3");
export const CASES = [
  "kn-01-idempotency-keys", "kn-02-edge-cache-invalidation", "kn-03-blue-green-deploy", "kn-04-queue-choice",
  "kn-05-incident-review-meeting", "kn-06-hybrid-search-reranking", "kn-07-photo-sharing-hld", "kn-08-helpdesk-answers-hld-lld",
  "kn-09-billing-codebase-map", "kn-10-inventory-architecture-frames", "kn-11-ambiguous-analytics-proposal", "kn-12-flag-rollout-update",
];
const OPENUI = new Set(CASES.slice(0, 2));
type Verdict = "claim" | "set" | "ambiguous" | "not_a_condition";
interface Rec { id: string; units: string[]; clause: string; verdict: Verdict; rule?: string; claimUnits: string[]; claimQuote?: string; readingA?: string; readingB?: string; decidingQuestion?: string; confidence?: string; additional?: boolean }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as T;
const ann = (caseId: string, who: "X" | "Y") => readJson<{ records: Rec[] }>(join(P4, "annotations", `${caseId}.${who}.json`)).records;
const tally = (xs: readonly string[]) => xs.reduce<Record<string, number>>((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});
const r2 = (n: number) => Number(n.toFixed(2));

const STOP = new Set("the a an and or of to in on for is are be it its that this with as by at from not no if when only than then so but".split(" "));
const words = (s: string) => new Set(s.toLowerCase().replace(/[`*_"“”'’.,;:()!?]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const norm = (s: string) => s.toLowerCase().replace(/[`*_"“”'’]/g, "").replace(/\s+/g, " ").trim();
/** Same clause: units overlap, and one quote contains the other or they share at least half the smaller one's significant words (EVAL-SPEC-v3 §4). */
export function sameClause(a: Pick<Rec, "units" | "clause">, b: Pick<Rec, "units" | "clause">): number {
  if (!a.units.some((u) => b.units.includes(u))) return 0;
  const na = norm(a.clause), nb = norm(b.clause);
  if (na && nb && (na.includes(nb) || nb.includes(na))) return 1;
  const wa = words(a.clause), wb = words(b.clause);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const share = Math.min(wa.size, wb.size) ? shared / Math.min(wa.size, wb.size) : 0;
  return share >= 0.5 ? share : 0;
}
export function matchClauses(xs: readonly Rec[], ys: readonly Rec[]) {
  const cand = xs.flatMap((x) => ys.map((y) => ({ x, y, s: sameClause(x, y) }))).filter((p) => p.s > 0).sort((a, b) => b.s - a.s);
  const ux = new Set<Rec>(), uy = new Set<Rec>(), pairs: { x: Rec; y: Rec }[] = [];
  for (const p of cand) if (!ux.has(p.x) && !uy.has(p.y)) { ux.add(p.x); uy.add(p.y); pairs.push({ x: p.x, y: p.y }); }
  return { pairs, onlyX: xs.filter((x) => !ux.has(x)), onlyY: ys.filter((y) => !uy.has(y)) };
}
export function kappa(pairs: readonly [string, string][]): number | null {
  if (!pairs.length) return null;
  const cats = [...new Set(pairs.flat())], n = pairs.length;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? null : r2((po - pe) / (1 - pe));
}
const link = (a: string[], b: string[]) => (!a.length || !b.length ? "n/a" : [...a].sort().join() === [...b].sort().join() ? "exact" : a.some((x) => b.includes(x)) ? "overlap" : "disjoint");

function agreement() {
  const rows: Record<string, unknown> = {};
  const all = { pairs: [] as { x: Rec; y: Rec; caseId: string }[], onlyX: 0, onlyY: 0, condX: 0, condY: 0, unitPairs: [] as [string, string][] };
  for (const caseId of CASES) {
    const X = ann(caseId, "X"), Y = ann(caseId, "Y");
    const cx = X.filter((r) => r.verdict !== "not_a_condition"), cy = Y.filter((r) => r.verdict !== "not_a_condition");
    const m = matchClauses(cx, cy);
    all.pairs.push(...m.pairs.map((p) => ({ ...p, caseId })));
    all.onlyX += m.onlyX.length; all.onlyY += m.onlyY.length; all.condX += cx.length; all.condY += cy.length;
    // Unit level: does the unit carry at least one condition, per annotator?
    const units = readJson<Record<string, string[]>>(join(P4, "units-to-examine.json"))[caseId]!;
    for (const u of units) all.unitPairs.push([cx.some((r) => r.units.includes(u)) ? "condition" : "none", cy.some((r) => r.units.includes(u)) ? "condition" : "none"]);
    rows[caseId] = { X: tally(X.map((r) => r.verdict)), Y: tally(Y.map((r) => r.verdict)), matched: m.pairs.length, onlyX: m.onlyX.length, onlyY: m.onlyY.length, verdictSame: m.pairs.filter((p) => p.x.verdict === p.y.verdict).length };
  }
  const vp = all.pairs.map((p) => [p.x.verdict, p.y.verdict] as [string, string]);
  const cs = all.pairs.filter((p) => ["claim", "set"].includes(p.x.verdict) && ["claim", "set"].includes(p.y.verdict));
  const byRule = (rule: string) => {
    const ps = all.pairs.filter((p) => p.x.rule === rule || p.y.rule === rule);
    return { pairs: ps.length, verdictAgreement: ps.length ? r2(ps.filter((p) => p.x.verdict === p.y.verdict).length / ps.length) : null, ambiguousEither: ps.filter((p) => p.x.verdict === "ambiguous" || p.y.verdict === "ambiguous").length };
  };
  return {
    clauseIdentification: { conditionRecordsX: all.condX, conditionRecordsY: all.condY, matched: all.pairs.length, onlyX: all.onlyX, onlyY: all.onlyY, f1: r2((2 * all.pairs.length) / (all.condX + all.condY)) },
    unitLevel: { units: all.unitPairs.length, agreement: r2(all.unitPairs.filter(([a, b]) => a === b).length / all.unitPairs.length), kappa: kappa(all.unitPairs) },
    verdictOnMatched: { pairs: vp.length, agreement4way: r2(vp.filter(([a, b]) => a === b).length / vp.length), kappa4way: kappa(vp), confusionXtoY: tally(vp.map(([a, b]) => `${a}→${b}`)), claimSetOnly: { pairs: cs.length, agreement: cs.length ? r2(cs.filter((p) => p.x.verdict === p.y.verdict).length / cs.length) : null, kappa: kappa(cs.map((p) => [p.x.verdict, p.y.verdict])) } },
    ambiguousRate: { X: r2(all.pairs.filter((p) => p.x.verdict === "ambiguous").length / vp.length), Y: r2(all.pairs.filter((p) => p.y.verdict === "ambiguous").length / vp.length) },
    claimLinkOnMatched: tally(all.pairs.map((p) => link(p.x.claimUnits, p.y.claimUnits))),
    byRule: Object.fromEntries(["general", "R1", "R2", "R3", "R4", "R5"].map((r) => [r, byRule(r)])),
    perCase: rows,
  };
}

it.skipIf(!process.env.P4_AGREE_OUT)("phase 4 clause agreement", () => {
  writeFileSync(process.env.P4_AGREE_OUT!, `${JSON.stringify(agreement(), null, 2)}\n`);
});

it.skipIf(!process.env.P4_ADJ_PACKETS)("phase 4 adjudication packets", () => {
  for (const caseId of CASES) {
    const X = ann(caseId, "X"), Y = ann(caseId, "Y");
    const m = matchClauses(X, Y);
    const prior = readJson<{ records: { id: string; conditionUnits: string[]; verdict: string; status: string; claimUnits: string[]; conditionQuote?: string; notes?: Record<string, { perClaimCard: Record<string, string>; carriers: string[] }> }[] }>(join(P3, "adjudicated", `${caseId}.json`)).records;
    const units = readFileSync(join(P4, "annotation-packets", `${caseId}.md`), "utf8").split("## Units to examine")[0]!.replace(/^# .*\n/, "").trim();
    const fmt = (r: Rec) => `${r.id} [${r.units.join(",")}] ${r.verdict} (${r.rule ?? "?"}, ${r.confidence ?? "?"}) clause "${r.clause}" → claim ${r.claimUnits.join("+") || "-"} "${r.claimQuote ?? ""}"${r.verdict === "ambiguous" ? ` | A: ${r.readingA} | B: ${r.readingB} | Q: ${r.decidingQuestion}` : ""}`;
    const priorFor = (us: string[]) => prior.filter((p) => p.conditionUnits.some((u) => us.includes(u))).map((p) => `phase3 ${p.id} [${p.conditionUnits.join(",")}] ${p.verdict}/${p.status} claim ${p.claimUnits.join("+") || "-"}${p.notes ? ` outcomes ${JSON.stringify(Object.fromEntries(Object.entries(p.notes).map(([k, v]) => [k, v.perClaimCard])))} carriers ${JSON.stringify(Object.fromEntries(Object.entries(p.notes).map(([k, v]) => [k, v.carriers])))}` : ""}`);
    const L = [`# Phase 4 adjudication packet: ${caseId}`, "", units, "", `Note set(s): ${OPENUI.has(caseId) ? "../phase3/openui-packets/" + caseId + ".md (openui-v1, openui-v2)" : "../phase2/packets/" + caseId + ".md (distil)"}`, "", "## Matched pairs (X and Y found the same clause)", ""];
    for (const p of m.pairs) L.push(`- X: ${fmt(p.x)}`, `  Y: ${fmt(p.y)}`, ...priorFor([...p.x.units, ...p.y.units]).map((s) => `  context: ${s}`), "");
    L.push("## Found by X only", "");
    for (const r of m.onlyX) L.push(`- ${fmt(r)}`, ...priorFor(r.units).map((s) => `  context: ${s}`), "");
    L.push("## Found by Y only", "");
    for (const r of m.onlyY) L.push(`- ${fmt(r)}`, ...priorFor(r.units).map((s) => `  context: ${s}`), "");
    writeFileSync(join(P4, "adjudication-packets", `${caseId}.md`), `${L.join("\n")}\n`);
  }
});

interface AdjV3 { records: (Rec & { status: string; notes?: Record<string, { claimCards: string[]; carriers: string[]; perClaimCard: Record<string, string> }> })[]; rejected?: unknown[] }
it.skipIf(!process.env.P4_SUMMARY_OUT)("v3 snapshot summary", () => {
  const freeze = readJson<{ sha256: Record<string, string> }>(join(P4, "FREEZE-v3.json"));
  for (const [f, h] of Object.entries(freeze.sha256)) expect(createHash("sha256").update(readFileSync(join(P4, f))).digest("hex"), `${f} changed since FREEZE-v3`).toBe(h);
  const out: Record<string, unknown> = {};
  const tot = { verdicts: [] as string[], status: [] as string[], vs: [] as string[], rules: [] as string[], rejected: 0, claimPairs: [] as string[], ambPairs: [] as string[], gaps: [] as string[], unitsMultiClause: 0 };
  for (const caseId of CASES) {
    if (!existsSync(join(P4, "adjudicated", `${caseId}.json`))) continue;
    const a = readJson<AdjV3>(join(P4, "adjudicated", `${caseId}.json`));
    tot.rejected += a.rejected?.length ?? 0;
    const perUnit = tally(a.records.filter((r) => r.verdict !== "not_a_condition").flatMap((r) => r.units));
    tot.unitsMultiClause += Object.values(perUnit).filter((n) => n > 1).length;
    const sets: Record<string, unknown> = {};
    for (const r of a.records) { tot.verdicts.push(r.verdict); tot.status.push(r.status); tot.vs.push(`${r.status}:${r.verdict}`); tot.rules.push(`${r.rule ?? "?"}:${r.verdict}`); }
    for (const key of OPENUI.has(caseId) ? ["openui-v1", "openui-v2"] : ["distil"]) {
      const scoped = a.records.filter((r) => r.notes?.[key]);
      const claimPairs = scoped.filter((r) => r.verdict === "claim").flatMap((r) => Object.values(r.notes![key]!.perClaimCard));
      const ambPairs = scoped.filter((r) => r.verdict === "ambiguous").flatMap((r) => Object.values(r.notes![key]!.perClaimCard));
      const gaps = scoped.filter((r) => (r.verdict === "claim" || r.verdict === "set") && !r.notes![key]!.carriers.length).map((r) => `${r.id} "${r.clause.slice(0, 60)}"`);
      if (key !== "openui-v1") { tot.claimPairs.push(...claimPairs); tot.ambPairs.push(...ambPairs); tot.gaps.push(...gaps.map((g) => `${caseId.slice(0, 5)} ${g}`)); }
      sets[key] = { claimPairs: tally(claimPairs), ambiguousPairs: tally(ambPairs), coverageGaps: gaps };
    }
    out[caseId] = { records: a.records.length, verdicts: tally(a.records.map((r) => r.verdict)), status: tally(a.records.map((r) => r.status)), rejected: a.rejected?.length ?? 0, noteSets: sets };
  }
  out.total = { records: tot.verdicts.length, verdicts: tally(tot.verdicts), status: tally(tot.status), byStatus: tally(tot.vs), byRule: tally(tot.rules), rejected: tot.rejected, unitsWithSeveralClauses: tot.unitsMultiClause, note: "integrity/coverage totals use distil (kn-03–kn-12) and OpenUI v2 (kn-01/kn-02)", claimPairs: tally(tot.claimPairs), ambiguousPairs: tally(tot.ambPairs), coverageGaps: tot.gaps };
  writeFileSync(process.env.P4_SUMMARY_OUT!, `${JSON.stringify(out, null, 2)}\n`);
});
