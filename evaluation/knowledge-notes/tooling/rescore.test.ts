/**
 * Re-scores the recorded distil runs with today's checks (offline, no AI): the recorded plan and citations stay as the
 * model gave them, but the unit accounting is computed again (`representation.ts`, the cue changes of 2026-10-20), so a
 * report can say which golden assertions changed only because the scoring changed. Opt-in:
 *
 *   RESCORE_GOLDEN=1 RESCORE_OUT=<dir> npm run test:golden -- rescore
 *
 * writes `<dir>/rescore.md` (per case, gate 1–3 before and after, and the assertions whose status changed). The model
 * check can't be replayed (it didn't run then), so no card counts as "supported" here.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accountUnits } from "@/ai/fidelity/accounting";
import type { Idea, Omission, ReviewFlag, SourceUnit } from "@/ai/fidelity/contracts";
import { protectedItemsOf } from "@/ai/fidelity/exactness";
import { nodeBody } from "@/ai/fidelity/knowledgeCheck";
import { representationFlags } from "@/ai/fidelity/representation";
import { loadDataset, loadRecordings } from "./load";
import { replayRecording, type CaseReplay } from "./replay";

const ON = process.env.RESCORE_GOLDEN === "1";

/** Flags the recorded run had that rescoring keeps (not decided by accounting itself). */
const KEPT = new Set(["uncited_card", "exact_missing", "ai_check"]);

interface RecordedRun {
  noteModel: string;
  units?: { units: SourceUnit[]; nextId: number };
  cites?: Record<string, string[]>;
  omitted?: Omission[];
  accounting?: { state: Record<string, string> };
  flags?: ReviewFlag[];
}

export function rescoreRun(run: RecordedRun, plan: { nodes: Record<string, unknown>[] }): RecordedRun {
  if (!run.units || !run.cites) return run;
  const units = run.units.units;
  const ideas: Idea[] = plan.nodes.flatMap((n): Idea[] => {
    const id = String(n.id);
    const cites = run.cites![id];
    if (!cites?.length) return [];
    return [{ id, title: typeof n.title === "string" ? n.title : "", body: nodeBody(n), cites, ...(n.origin === "analysis" ? { origin: "analysis" as const } : {}), ...(n.type === "table" || n.type === "code" ? { byReference: true } : {}) }];
  });
  const kept = (run.flags ?? []).filter((f) => KEPT.has(f.code));
  const rep = representationFlags(ideas, units);
  const superseded = new Set((run.omitted ?? []).filter((o) => o.reason === "superseded").map((o) => o.unit));
  const protectedUnits = new Set(protectedItemsOf(units).filter((i) => i.tier === "exact" && !superseded.has(i.unit)).map((i) => i.unit));
  const pending = Object.entries(run.accounting?.state ?? {}).flatMap(([u, s]) => (s === "pending" ? [u] : []));
  const accounting = accountUnits({ units, ideas, omitted: run.omitted ?? [], protectedUnits, flags: [...kept, ...rep.flags], ...(pending.length ? { pending } : {}) });
  return { ...run, accounting, flags: accounting.flags };
}

const gateLine = (c: CaseReplay) => c.verdict.gates.map((g) => `G${g.gate} ${g.pass ? "PASS" : "FAIL"} ${g.passed}/${g.passed + g.failed.length}${g.failedCritical.length ? ` (${g.failedCritical.length})` : ""}`).join(" · ");

describe.runIf(ON)("re-score the recorded distil runs with today's checks", () => {
  it("writes rescore.md", async () => {
    const dataset = loadDataset();
    const byCase = new Map(dataset.cases.map((c) => [c.id, c]));
    const out: string[] = ["# Recorded runs re-scored with the 2026-10-20 checks (offline)", ""];
    for (const rec of loadRecordings().recordings) {
      if (rec.meta.pipeline.noteModel !== "distil") continue;
      const before = await replayRecording(rec, byCase);
      const dir = mkdtempSync(join(tmpdir(), "rescore-"));
      cpSync(rec.dir, dir, { recursive: true });
      const shift = new Map<string, string>();
      const details: string[] = [];
      const count = (r: RecordedRun) => {
        const o = Object.values((r.accounting as { outcome?: Record<string, string> } | undefined)?.outcome ?? {});
        return `${o.filter((x) => x === "represented").length} / ${o.filter((x) => x === "omitted").length} / ${o.filter((x) => x === "needs_review").length}`;
      };
      for (const entry of rec.meta.cases) {
        if (!entry.run || !entry.plan) continue;
        const run = JSON.parse(readFileSync(join(dir, entry.run), "utf8")) as RecordedRun;
        const plan = JSON.parse(readFileSync(join(dir, entry.plan), "utf8")) as { nodes: Record<string, unknown>[] };
        const next = rescoreRun(run, plan);
        const codes = (next.flags ?? []).filter((f) => f.code === "citation_unrelated" || f.code === "critical_dropped").reduce((m, f) => ({ ...m, [f.code]: (m[f.code] ?? 0) + 1 }), {} as Record<string, number>);
        shift.set(entry.caseId, `${count(run)} → ${count(next)} ${JSON.stringify(codes)}`);
        writeFileSync(join(dir, entry.run), JSON.stringify(next));
        const nodes = new Map(plan.nodes.map((n) => [String(n.id), n] as const));
        for (const fl of (next.flags ?? []).filter((x) => x.code === "citation_unrelated" || x.code === "critical_dropped"))
          details.push(`- ${entry.caseId} ${fl.code} ${fl.unit} on ${fl.card}: ${fl.detail} — card: "${((nodes.get(fl.card!)?.title as string | undefined) ?? "") + " " + nodeBody(nodes.get(fl.card!) ?? {}).replace(/\s+/g, " ").slice(0, 160)}"`);
      }
      const after = await replayRecording({ meta: rec.meta, dir }, byCase);
      expect(after.issues).toEqual([]);
      out.push(`## ${rec.meta.runId}`, "", "| Case | Units R / O / NR, before → after (new flags) | Before | After | Assertions that changed |", "|---|---|---|---|---|");
      for (const b of before.cases) {
        const a = after.cases.find((x) => x.caseId === b.caseId && x.attempt === b.attempt)!;
        const changed = b.results.flatMap((r) => {
          const n = a.results.find((x) => x.id === r.id);
          return n && n.status !== r.status ? [`\`${r.id}\` ${r.status}→${n.status}`] : [];
        });
        out.push(`| ${b.caseId} | ${shift.get(b.caseId) ?? ""} | ${gateLine(b)} | ${gateLine(a)} | ${changed.join(", ") || "—"} |`);
      }
      out.push("", "### New flags", "", ...details, "");
    }
    writeFileSync(join(process.env.RESCORE_OUT ?? tmpdir(), "rescore.md"), out.join("\n"));
  });
});
