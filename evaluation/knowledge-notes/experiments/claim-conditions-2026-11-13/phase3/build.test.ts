/**
 * Phase 3 builder: candidate conditions per case and the second reviewers' blind packets. Run once with
 * P3_BUILD=1. Candidates = the first reviewers' records (phase 2 labels; kn-01/kn-02: the phase 1 records) ∪ the golden
 * `limits` edges, merged when their condition units overlap. The packet shows units and condition spans only: not
 * who proposed a candidate, its claim link or its binding.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { DATASET_ROOT } from "../../../tooling/load";
import { RECORDS as PHASE1 } from "../records";
import { DEV, FINAL, loadLabels, loadRecorded } from "../phase2/data";

const HERE = join(DATASET_ROOT, "experiments", "claim-conditions-2026-11-13", "phase3");
const norm = (s: string) => s.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export interface Candidate {
  id: string;
  conditionUnits: string[];
  sources: { kind: "r1" | "golden"; ref: string; claimUnits: string[]; binding?: string; summary?: string }[];
}

it.skipIf(!process.env.P3_BUILD)("build candidates and blind packets", { timeout: 60_000 }, async () => {
  const all: Record<string, { units: SourceUnit[]; candidates: Candidate[] }> = {};
  for (const caseId of ["kn-01-idempotency-keys", "kn-02-edge-cache-invalidation", ...DEV, ...FINAL]) {
    const dir = join(DATASET_ROOT, "cases", caseId);
    const today = (await splitUnits(readFileSync(join(dir, caseId.startsWith("kn-12") ? "source.v1.md" : "source.md"), "utf8").replace(/\r\n?/g, "\n"))).units;
    const openui = caseId === "kn-01-idempotency-keys" || caseId === "kn-02-edge-cache-invalidation";
    // Unit space: OpenUI cases use today's splitter (as the saved OpenUI replies do); others the 2026-10-19 recording's.
    const units = openui ? today : loadRecorded(caseId).units;
    const toUnits = new Map(today.map((u) => [u.id, units.find((r) => norm(r.text) === norm(u.text))?.id]));
    const k = JSON.parse(readFileSync(join(dir, "knowledge.json"), "utf8").replace(/^﻿/, "")) as { units: { id: string; claim: string; sourceUnits?: string[]; limits?: string }[] };
    const by = new Map(k.units.map((u) => [u.id, u]));
    const raw: { conditionUnits: string[]; source: Candidate["sources"][number] }[] = [];
    for (const u of k.units.filter((x) => x.limits && by.get(x.limits))) {
      const cond = (u.sourceUnits ?? []).map((x) => toUnits.get(x)).filter(Boolean) as string[];
      const claim = (by.get(u.limits!)!.sourceUnits ?? []).map((x) => toUnits.get(x)).filter(Boolean) as string[];
      if (cond.length) raw.push({ conditionUnits: cond, source: { kind: "golden", ref: `${u.id} → ${u.limits}`, claimUnits: claim, summary: u.claim } });
    }
    if (openui) for (const r of PHASE1[caseId]!) raw.push({ conditionUnits: r.condition.units, source: { kind: "r1", ref: r.id, claimUnits: r.claim.units, binding: r.binding, summary: r.condition.summary } });
    else for (const r of loadLabels(caseId).records) raw.push({ conditionUnits: r.conditionUnits, source: { kind: "r1", ref: r.id, claimUnits: r.claimUnits, binding: r.binding, summary: r.conditionSummary } });
    const cands: Candidate[] = [];
    for (const x of raw) {
      const hit = cands.find((c) => c.conditionUnits.some((u) => x.conditionUnits.includes(u)));
      if (hit) {
        hit.conditionUnits = [...new Set([...hit.conditionUnits, ...x.conditionUnits])];
        hit.sources.push(x.source);
      } else cands.push({ id: "", conditionUnits: [...x.conditionUnits], sources: [x.source] });
    }
    const order = (u: string) => Number(u.slice(1));
    cands.forEach((c) => c.conditionUnits.sort((a, b) => order(a) - order(b)));
    cands.sort((a, b) => order(a.conditionUnits[0]!) - order(b.conditionUnits[0]!));
    cands.forEach((c, i) => (c.id = `c${i + 1}`));
    all[caseId] = { units, candidates: cands };
    const L = [`# Second review packet: ${caseId}`, "", "## Source units (id [heading path] text)", ...units.map((u) => `${u.id} [${u.topic ?? ""}] ${u.text.replace(/\s+/g, " ")}`), "", "## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)"];
    for (const c of cands) L.push(`${c.id}: units ${c.conditionUnits.join(", ")} :: ${c.conditionUnits.map((u) => units.find((x) => x.id === u)?.text.replace(/\s+/g, " ")).join(" ")}`);
    writeFileSync(join(HERE, "review-packets", `${caseId}.md`), `${L.join("\n")}\n`);
  }
  writeFileSync(join(HERE, "candidates.json"), `${JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.candidates])), null, 2)}\n`);
});
