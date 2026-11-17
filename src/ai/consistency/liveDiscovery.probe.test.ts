/**
 * Opt-in (LIVE_DISCOVERY_PROBE=1), read-only: how the live canvas's candidate source compares with the evaluated
 * pipeline on unseen5 (development evidence since 2026-11-16). The live check (`check.ts` `detect`) keeps a pair only when
 * the tier-1 rules say conflict or possible; the evaluated pipeline (`screen.ts`) also forwards near-misses. Uses the
 * recorded answers only — no model call. Writes nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { combine, type JudgeAnswer } from "./judge";
import { judgePair } from "./rules";
import { judgementForCombine, screenPair } from "./screen";

const DIR = join(process.cwd(), "evaluation/update-engine/consistency/unseen5");
const read = <T,>(f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as T;

describe.skipIf(process.env.LIVE_DISCOVERY_PROBE !== "1")("live discovery vs evaluated pipeline (unseen5)", () => {
  it("prints recall for both candidate sources", () => {
    const pairs = read<{ pairs: { id: string; a: string; b: string }[] }>("pairs.json").pairs;
    const labels = read<{ labels: Record<string, { label: string }> }>("labels.json").labels;
    const ai = read<Record<string, { answer: JudgeAnswer; why?: string }>>("runs/2026-11-15-unseen5/judgments.json");
    const rows = pairs.map((p) => {
      const rule = judgePair(p.a, p.b);
      const s = screenPair(p.a, p.b);
      const pipeline = s.decision === "rule_conflict" ? "conflict" : s.decision === "excluded" ? "hidden" : ai[p.id] ? combine(judgementForCombine(s), ai[p.id]).shown : "pending";
      // Live: detect keeps rule conflict/possible; the AI then sees the same pair (screen's judgement if forwarded).
      const live = rule.verdict === "compatible" ? "hidden" : s.decision === "rule_conflict" ? "conflict" : rule.verdict === "conflict" ? "conflict" : s.decision === "forward" && ai[p.id] ? combine(judgementForCombine(s), ai[p.id]).shown : "possible";
      return { id: p.id, truth: labels[p.id]!.label, rule: rule.verdict, screen: s.decision, pipeline, live };
    });
    const contra = rows.filter((r) => r.truth === "contradiction");
    const shown = (x: string) => ["conflict", "likely", "possible"].includes(x);
    const strict = (x: string) => x === "conflict" || x === "likely";
    const pct = (n: number, d: number) => `${n}/${d} = ${((100 * n) / d).toFixed(1)}%`;
    const calls = (k: "pipeline" | "live") => rows.filter((r) => strict(r[k]) && r.truth !== "ambiguous");
    const ctx = rows.filter((r) => r.truth === "compatible");
    for (const k of ["pipeline", "live"] as const) {
      console.log(k, {
        recall: pct(contra.filter((r) => shown(r[k])).length, contra.length),
        strict: pct(contra.filter((r) => strict(r[k])).length, contra.length),
        precision: pct(calls(k).filter((r) => r.truth === "contradiction").length, calls(k).length),
        compatibleShownAsConflict: pct(ctx.filter((r) => strict(r[k])).length, ctx.length),
      });
    }
    console.log("contradictions the live source misses:", contra.filter((r) => !shown(r.live)).map((r) => `${r.id}(${r.rule}/${r.screen})`).join(" "));
  });
});
