/**
 * WP1.12 with a mock AI (no model is called): fixtures 4–10 (`__fixtures__/knowledge/`, §7.3) run through the whole
 * distil Visualize pipeline 3 times each, as an approved live check would (Wave F1), and measured with report v2
 * (`e2e/fidelityScore.ts`: median and worst run). The three runs differ the way real runs do: a faithful one, one that
 * omits a critical unit on its first attempt (the one retry asks for it back), and one that keeps writing a protected
 * number wrong (it is put back from the source). The gates that must hold on every run (G3, G4) are checked on each;
 * G1's card share on the median. Fixture 10 adds the update's lineage (rename, move, edit, deletion, duplicate).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { gatesMet, knowledgeGates, knowledgeScore, knowledgeSummary, knowledgeSummaryMarkdown, type KnowledgeScore } from "../../../e2e/fidelityScore";
import { distiller, type DistillerOptions } from "./__fixtures__/knowledge/mockDistiller";
import { normalizeForCompare } from "./exactness";
import { knowledgeRunWithPlan } from "./knowledgeRun";
import { nodeBody } from "./knowledgeCheck";
import { buildKnowledgeReport, lineageCounts } from "./report";
import { matchVersions, splitUnits } from "./sourceUnits";
import { parseContent } from "@/ai/content/parser";
import { nextPathIds } from "@/ai/reconcile/topicIds";

interface Fixture {
  id: string;
  number: number;
  file: string;
  next?: string;
  title: string;
  critical: string[];
  protected: string[];
}

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__", "knowledge");
const MANIFEST = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as { fixtures: Fixture[] };
const read = (file: string) => readFileSync(join(DIR, file), "utf8");
const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The three runs of a fixture (§7.3), as a model's runs differ. */
const RUNS = (f: Fixture): DistillerOptions[] => [
  {},
  { omitCritical: new RegExp(escape(f.critical[0]!)) },
  { changeNumberIn: new RegExp(escape(f.protected.find((p) => /\d/.test(p)) ?? "\\d")), persistent: true },
];

async function runOnce(text: string, options: DistillerOptions, n: number) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  manager.registerProvider(createMockProvider({ id: "mock", respond: distiller(options) }));
  manager.setPrimary("mock");
  const { changeSet } = await visualizeContent({ text, operationId: `op_${n}`, title: "Visualize", context, forceAI: true }, createAIRuntime({ manager, registry }), { parseMarkdown: parse });
  const run = knowledgeRunWithPlan(changeSet.contentSource!.sourceId)!;
  const canvas = (run.plan as VisualPlan).nodes.map((node) => `${node.title ?? ""}\n${nodeBody(node as unknown as Record<string, unknown>)}`);
  return { run, canvas, changeSet };
}

describe("knowledge fixtures 4–10, distil mode, mock AI, 3 runs each (WP1.12)", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  beforeAll(() => {
    FIDELITY_CONFIG.noteModel = "distil";
  });
  afterAll(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("the manifest lists fixtures 4–10, each file present and its critical and protected fragments in its text", () => {
    expect(MANIFEST.fixtures.map((f) => f.number)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    for (const f of MANIFEST.fixtures) {
      const text = read(f.file);
      for (const fragment of [...f.critical, ...f.protected]) expect(text, `${f.id}: ${fragment}`).toContain(fragment);
    }
  });

  for (const f of MANIFEST.fixtures) {
    it(`${f.number}. ${f.title}: every run accounts for every unit, never omits a critical one silently, loses no protected detail`, { timeout: 60_000 }, async () => {
      const text = read(f.file);
      const scores: KnowledgeScore[] = [];
      for (const [i, options] of RUNS(f).entries()) {
        const { run, canvas, changeSet } = await runOnce(text, options, i);
        const where = `${f.id} run ${i + 1}`;
        // Every unit of the version has an outcome, and the cards cite the version's own units.
        expect(Object.keys(run.accounting!.outcome).sort(), where).toEqual(run.units!.units.map((u) => u.id).sort());
        expect(changeSet.contentSource!.units, where).toEqual(run.units);
        // G3: a unit holding a critical fragment is Represented or in Needs review, never omitted.
        for (const fragment of f.critical) {
          const units = run.units!.units.filter((u) => u.text.includes(fragment));
          expect(units.length, `${where}: ${fragment}`).toBeGreaterThan(0);
          for (const u of units) expect(run.accounting!.outcome[u.id], `${where}: ${fragment}`).not.toBe("omitted");
        }
        // G4: every protected detail is on the canvas (on its card, or put back from the source), whatever the run did.
        const onCanvas = normalizeForCompare(canvas.join("\n"));
        for (const value of f.protected) expect(onCanvas, `${where}: ${value}`).toContain(normalizeForCompare(value));
        // The safety net attaches nothing in distil mode.
        expect(JSON.stringify(run.plan), where).not.toMatch(/Also in the source|Source details/);
        scores.push(knowledgeScore(run, { source: text, canvas }));
      }
      const gates = gatesMet(scores);
      expect(gates, knowledgeSummaryMarkdown(f.title, scores)).toEqual({ g1CardsInReview: true, g3NoSilentCriticalOmission: true, g4NoExactMissing: true });
      const { median, worst } = knowledgeSummary(scores);
      expect(worst.represented).toBeLessThanOrEqual(median.represented);
      expect(worst.cardsNeedsReviewPct).toBeGreaterThanOrEqual(median.cardsNeedsReviewPct);
    });
  }

  it("10. the update series: lineage of v1 → v2 (rename, move, edit, deletion, duplicate) in report v2", async () => {
    const f = MANIFEST.fixtures.find((x) => x.number === 10)!;
    const [t1, t2] = [read(f.file), read(f.next!)];
    const v1 = await splitUnits(t1);
    // As `recordAcceptedSource` does: the new version's topic ids follow the renamed heading, so a rename is no move.
    const pathIds = nextPathIds(undefined, await parseContent(t1), t1, await parseContent(t2), t2);
    const { units: v2, lineage } = await matchVersions({ ...v1, version: 1 }, { text: t2, version: 2, ...(pathIds ? { pathIds } : {}) });
    const counts = lineageCounts(lineage);
    // "5% of customers" → "10%": changed; the ownership sentence moved to Monitoring: moved, same id; the "Old process"
    // section and one of two identical sentences deleted: removed. The renamed section's units stay where they were.
    expect(counts).toMatchObject({ changed: 1, moved: 1, removed: 2, added: 0, ambiguous: 0 });
    const moved = lineage.entries.find((e) => e.moved)!;
    expect(v2.units.find((u) => u.id === moved.to)!.text).toBe("The owning team removes the flag within 30 days of full rollout.");
    const report = buildKnowledgeReport({ sections: [], accounting: { state: {}, outcome: {}, critical: {}, flags: [], sections: [] }, lineage });
    expect(report.lineage).toEqual(counts);
  });

  it("report v2's summary reads median and worst of 3 runs", () => {
    const base: KnowledgeScore = { units: 10, represented: 9, omitted: 1, needsReview: 0, pending: 0, cards: 9, cardsNeedsReview: 0, cardsNeedsReviewPct: 0, checkedByAI: 0, aiChecked: 0, aiPartly: 0, aiNotSupported: 0, aiUnanswered: 0, hinted: 1, criticalSilentlyOmitted: 0, exactMissing: 0 };
    const runs = [base, { ...base, represented: 7, needsReview: 2, cardsNeedsReview: 2, cardsNeedsReviewPct: 22.2 }, { ...base, represented: 8, needsReview: 1, cardsNeedsReview: 1, cardsNeedsReviewPct: 11.1 }];
    const s = knowledgeSummary(runs);
    expect(s.median).toMatchObject({ represented: 8, needsReview: 1, cardsNeedsReviewPct: 11.1 });
    expect(s.worst).toMatchObject({ represented: 7, needsReview: 2, cardsNeedsReviewPct: 22.2 });
    expect(gatesMet(runs)).toEqual({ g1CardsInReview: true, g3NoSilentCriticalOmission: true, g4NoExactMissing: true });
    expect(knowledgeGates([...runs, { ...base, exactMissing: 1 }]).g4NoExactMissing).toBe(false);
    expect(knowledgeSummaryMarkdown("Fixture", runs)).toContain("| median | 8 | 1 | 1 | 0 | 1/9 (11.1%) |");
  });

  it("knowledgeGates counts the model check's verdicts (OD5b) and the report lists Needs review reasons by code", () => {
    const base: KnowledgeScore = { units: 10, represented: 9, omitted: 1, needsReview: 0, pending: 0, cards: 9, cardsNeedsReview: 1, cardsNeedsReviewPct: 11.1, checkedByAI: 7, aiChecked: 9, aiPartly: 1, aiNotSupported: 1, aiUnanswered: 0, hinted: 1, criticalSilentlyOmitted: 0, exactMissing: 0, reasonsByCode: { ai_check: 2, critical_dropped: 1 } };
    const runs = [base, { ...base, checkedByAI: 8, aiPartly: 0, aiUnanswered: 0, reasonsByCode: { ai_check: 1 } }, { ...base, aiChecked: 0, checkedByAI: 0, aiPartly: 0, aiNotSupported: 0, reasonsByCode: {} }];
    expect(knowledgeGates(runs).modelCheck).toEqual({ ranEveryRun: false, cards: 18, supported: 15, partly: 1, notSupported: 2, unanswered: 0 });
    expect(knowledgeGates(runs.slice(0, 2)).modelCheck.ranEveryRun).toBe(true);
    const md = knowledgeSummaryMarkdown("Fixture", runs);
    expect(md).toContain("18 cards checked: 15 supported, 1 partly, 2 not supported, 0 unanswered (**did not run on every run**)");
    expect(md).toContain("Needs review reasons by code, all runs: ai_check 3, critical_dropped 1");
    // The breakdown is not a measure: the median and worst leave it out.
    expect(knowledgeSummary(runs).median).not.toHaveProperty("reasonsByCode");
    // From a run's output: verdicts from the card reviews, reasons from the flags.
    const score = knowledgeScore({
      noteModel: "distil",
      reviews: {
        a: { reasons: [], checked: { by: "ai", verdict: "supported" } },
        b: { reasons: ["checked by AI: partly supported: x"], checked: { by: "ai", verdict: "partly" } },
        c: { reasons: ["checked by AI: no answer for this card"] },
      },
      flags: [{ code: "ai_check", card: "b", detail: "x" }, { code: "ai_check", card: "c", detail: "y" }, { code: "critical_dropped", card: "b", unit: "u1", detail: "z" }],
    });
    expect(score).toMatchObject({ aiChecked: 3, checkedByAI: 1, aiPartly: 1, aiNotSupported: 0, aiUnanswered: 1, reasonsByCode: { ai_check: 2, critical_dropped: 1 } });
  });
});
