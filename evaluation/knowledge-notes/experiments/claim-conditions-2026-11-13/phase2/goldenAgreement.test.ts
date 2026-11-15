/**
 * Sanity check of the blind labels against the golden dataset's reviewed `limits` edges (knowledge.json). The golden
 * unit ids come from today's splitter; the recording's from 2026-10-19's: mapped by unit text. Report only.
 * GOLDEN_AGREE_OUT=<file> writes the result.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { DATASET_ROOT } from "../../../tooling/load";
import { DEV, FINAL, loadLabels, loadRecorded } from "./data";

const norm = (s: string) => s.replace(/[*`_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

it.skipIf(!process.env.GOLDEN_AGREE_OUT)("blind labels vs golden limits edges", { timeout: 60_000 }, async () => {
  const out: Record<string, unknown> = {};
  let edges = 0, found = 0, unmapped = 0;
  for (const caseId of [...DEV, ...FINAL]) {
    const dir = join(DATASET_ROOT, "cases", caseId);
    const k = JSON.parse(readFileSync(join(dir, "knowledge.json"), "utf8").replace(/^﻿/, "")) as { units: { id: string; sourceUnits?: string[]; limits?: string }[] };
    const file = caseId.startsWith("kn-12") ? "source.v1.md" : "source.md";
    const today = (await splitUnits(readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n"))).units;
    const rec = loadRecorded(caseId).units;
    const toRec = new Map(today.map((u) => [u.id, rec.find((r) => norm(r.text) === norm(u.text))?.id]));
    const by = new Map(k.units.map((u) => [u.id, u]));
    const labels = loadLabels(caseId).records;
    const rows = k.units.filter((u) => u.limits && by.get(u.limits)).map((u) => {
      const cond = (u.sourceUnits ?? []).map((x) => toRec.get(x)).filter(Boolean) as string[];
      const claim = (by.get(u.limits!)!.sourceUnits ?? []).map((x) => toRec.get(x)).filter(Boolean) as string[];
      const hit = labels.find((r) => r.conditionUnits.some((x) => cond.includes(x)) && r.claimUnits.some((x) => claim.includes(x)));
      const condOnly = labels.find((r) => r.conditionUnits.some((x) => cond.includes(x)));
      return { edge: `${u.id} → ${u.limits}`, cond, claim, mapped: cond.length > 0 && claim.length > 0, reviewer: hit?.id ?? null, conditionLabelledElsewhere: !hit && condOnly ? condOnly.id : null };
    });
    edges += rows.length;
    found += rows.filter((r) => r.reviewer).length;
    unmapped += rows.filter((r) => !r.mapped).length;
    out[caseId] = rows;
  }
  out.summary = { goldenLimitEdges: edges, unmapped, foundByBlindReviewers: found };
  writeFileSync(process.env.GOLDEN_AGREE_OUT!, `${JSON.stringify(out, null, 2)}\n`);
});
