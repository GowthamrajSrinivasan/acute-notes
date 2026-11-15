/**
 * The model check (`semanticCheck.ts`) measured against the labelled paraphrase set, offline, from recorded runs in
 * `__fixtures__/meaning/model-check/` (made by `meaning.model.record.test.ts`, approved runs only). Per kind, never
 * averaged (§7.2), for three ways of using it:
 *
 * - **model on every card**: a card is flagged unless the model says `supported` (partly stays in Needs review, OD5);
 * - **model, strict**: flagged only on `not_supported`;
 * - **rules, then model (OD5 as written)**: flagged when a deterministic rule fires and the model doesn't say supported.
 *
 * Final labels as in `meaning.eval.test.ts` (`meaningLabels.ts`; under model consensus, provisional). The fresh held-out
 * pairs (`h2-…`) are the estimate that counts. Targets asserted per kind with `MEANING_MODEL_TARGETS=on`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pairsFile from "./__fixtures__/meaning/pairs.json";
import type { MeaningKind, MeaningPair, SourceUnit } from "./contracts";
import { MEANING_KINDS } from "./contracts";
import { checkMeaning } from "./meaning";
import type { LabellerFile, LabellingConfig, Resolution } from "./meaningLabels";
import { pairStates } from "./meaningLabels";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "meaning");
const RUNS = join(DIR, "model-check");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const config = readJson<LabellingConfig>(join(DIR, "labelling.json"));
const allPairs = (pairsFile as { pairs: MeaningPair[] }).pairs;
const states = new Map(
  pairStates(
    allPairs,
    readdirSync(join(DIR, "labels"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<LabellerFile>(join(DIR, "labels", f))),
    readJson<Record<string, Resolution>>(join(DIR, "resolutions.json")),
    config,
  ).map((s) => [s.id, s]),
);
/** Pairs with a final label (excluded and removed pairs are left out), labelled with it. */
const pairs = allPairs.filter((p) => states.get(p.id)!.final).map((p) => ({ ...p, label: states.get(p.id)!.final! }));

const RECALL_TARGET: Partial<Record<MeaningKind, number>> = { qualifier: 0.9, condition: 0.9, negation: 0.9, quantity: 0.9, cause: 0.75, trade_off: 0.75 };
const FALSE_ALARM_TARGET = 0.1;

interface Run {
  meta: { run: string; model: string; promptVersion: string; costUsd: number; calls: number };
  answers: Record<string, { verdict: "supported" | "partly" | "not_supported"; reason: string }>;
}
const runs: Run[] = existsSync(RUNS)
  ? readdirSync(RUNS)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => readJson<Run>(join(RUNS, f)))
  : [];

const ruleFlags = (p: MeaningPair) =>
  checkMeaning({ id: p.id, title: p.card, body: "", cites: ["u1"] }, [{ id: "u1", kind: "sentence", text: p.source, hash: "", topic: "", span: { start: 0, end: p.source.length } } satisfies SourceUnit]).length > 0;

type Mode = "model" | "strict" | "rules_then_model";
function flagged(p: MeaningPair, run: Run, mode: Mode): boolean {
  const a = run.answers[p.id];
  // No answer: the card stays in Needs review, never treated as supported.
  const notSupported = !a || a.verdict !== "supported";
  if (mode === "model") return notSupported;
  if (mode === "strict") return !a || a.verdict === "not_supported";
  return ruleFlags(p) && notSupported;
}

interface Row {
  kind: MeaningKind;
  faithful: number;
  distorted: number;
  caught: number;
  alarms: number;
  missed: string[];
  falseAlarms: string[];
}
function measure(subset: readonly MeaningPair[], run: Run, mode: Mode): Row[] {
  return MEANING_KINDS.map((kind) => {
    const set = subset.filter((p) => p.kind === kind);
    const row: Row = { kind, faithful: 0, distorted: 0, caught: 0, alarms: 0, missed: [], falseAlarms: [] };
    for (const p of set) {
      const f = flagged(p, run, mode);
      if (p.label === "faithful") {
        row.faithful++;
        if (f) {
          row.alarms++;
          row.falseAlarms.push(p.id);
        }
      } else {
        row.distorted++;
        if (f) row.caught++;
        else row.missed.push(p.id);
      }
    }
    return row;
  });
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
const meets = (r: Row) => (RECALL_TARGET[r.kind] === undefined || r.caught / r.distorted >= RECALL_TARGET[r.kind]!) && r.alarms / r.faithful <= FALSE_ALARM_TARGET;

function table(title: string, rows: Row[]): string[] {
  return [
    title,
    "kind       | F/D   | recall        | false alarms | target (recall / FA) | meets",
    ...rows.map(
      (r) =>
        `${r.kind.padEnd(10)} | ${`${r.faithful}/${r.distorted}`.padEnd(5)} | ${`${pct(r.caught, r.distorted)} (${r.caught}/${r.distorted})`.padEnd(13)} | ${`${pct(r.alarms, r.faithful)} (${r.alarms}/${r.faithful})`.padEnd(12)} | ${(RECALL_TARGET[r.kind] !== undefined ? `≥ ${RECALL_TARGET[r.kind]! * 100}%` : "—").padEnd(6)} / ≤ ${FALSE_ALARM_TARGET * 100}%      | ${meets(r) ? "yes" : "NO"}`,
    ),
    ...rows.filter((r) => r.missed.length || r.falseAlarms.length).map((r) => `  ${r.kind}: missed ${r.missed.join(" ") || "none"}; false alarms ${r.falseAlarms.join(" ") || "none"}`),
  ];
}

const fresh = pairs.filter((p) => p.id.startsWith("h2-"));
const anchors = new Set(config.anchors);

describe("model check vs labelled set (§3.4, §7.2)", () => {
  it("every recorded run answers known pairs with known verdicts", () => {
    const ids = new Set(allPairs.map((p) => p.id));
    for (const run of runs) {
      for (const [id, a] of Object.entries(run.answers)) {
        expect(ids.has(id), `${run.meta.run}: ${id}`).toBe(true);
        expect(["supported", "partly", "not_supported"]).toContain(a.verdict);
      }
    }
  });

  it.each(runs.map((r) => [r.meta.run, r] as const))("reports recall and false alarms per kind: %s", (_name, run) => {
    const lines = [`Model check ${run.meta.run}: ${run.meta.model}, prompt v${run.meta.promptVersion}, ${run.meta.calls} calls, $${run.meta.costUsd} (labels: ${config.policy?.mode ?? "human"})`];
    for (const mode of ["model", "strict", "rules_then_model"] as const) {
      lines.push(...table(`[${mode}] fresh held-out (${fresh.length}; the estimate that counts)`, measure(fresh, run, mode)));
      lines.push(...table(`[${mode}] all pairs with a final label, not anchors (${pairs.filter((p) => !anchors.has(p.id)).length})`, measure(pairs.filter((p) => !anchors.has(p.id)), run, mode)));
    }
    console.log(lines.join("\n"));
    if (process.env.MEANING_MODEL_TARGETS === "on") for (const r of measure(fresh, run, "model")) expect(meets(r), `${r.kind}`).toBe(true);
  });
});
