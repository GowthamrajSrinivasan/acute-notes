/**
 * OpenUI Notes vs distil Visualize — source fidelity, offline, $0 (`.ai/docs/openui-live-2026-11-13.md`, "Step 1").
 *
 * Path B: the cards `generate_openui_notes` streamed live on 2026-11-13 (gemini-2.5-flash), saved here verbatim.
 * Path A: distil Visualize of the same sources by the same model, recorded 2026-10-20 (`recordings/2026-10-20-distil-gemini-flash-od5b`).
 *
 * Both are scored the same two ways, with **no model check on either side**:
 *  1. the golden evaluator: the case's reviewed assertions (gate 1 knowledge, gate 2 organisation) on a plan + run evidence;
 *  2. the distil pipeline's own deterministic checks (`inspectSection`: exactness, accounting, representation, meaning hints).
 * A's recorded run also carries model-check verdicts; those are re-derived away by re-inspecting its plan.
 *
 * Reports only (no gate): set OPENUI_SCORE_OUT=<file> to write the JSON. Asserts just that every input loaded and parsed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardReviews, inspectSection, BY_REFERENCE, CITES, UNCITED } from "@/ai/fidelity/knowledgeCheck";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import type { Omission, SourceUnit } from "@/ai/fidelity/contracts";
import { cardOf, splitCards } from "@/ai/openui/notesTask";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { evaluate, verdict, type AssertionResult } from "../../tooling/evaluate";
import { loadDataset, DATASET_ROOT } from "../../tooling/load";
import type { RunEvidence } from "../../tooling/runOutput";

const HERE = join(DATASET_ROOT, "experiments", "openui-2026-11-13");
const RECORDING = join(DATASET_ROOT, "recordings", "2026-10-20-distil-gemini-flash-od5b");
const CASES = ["kn-01-idempotency-keys", "kn-02-edge-cache-invalidation"];
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as T;

type Raw = { nodes: Record<string, unknown>[] };

/** The pipeline's checks on `raw` (nodes carrying `__cites`), as run evidence the golden evaluator reads. */
function evidenceOf(raw: Raw, units: SourceUnit[], omitted: Omission[]): { run: RunEvidence; inspection: ReturnType<typeof inspectSection> } {
  const inspection = inspectSection(raw, units, omitted);
  const cites = Object.fromEntries(inspection.ideas.map((i) => [i.id, i.cites]));
  const run: RunEvidence = {
    noteModel: "distil",
    units: { units, nextId: units.length + 1 },
    cites,
    omitted,
    accounting: inspection.accounting,
    flags: inspection.flags,
  };
  return { run, inspection };
}

function count<T>(xs: readonly T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}

function summarise(results: AssertionResult[], inspection: ReturnType<typeof inspectSection>, cards: number) {
  const knowledge = results.filter((r) => r.gate === 1);
  const outcomes = Object.values(inspection.accounting.outcome);
  const reviews = cardReviews(inspection);
  return {
    cards,
    gate1: {
      pass: knowledge.filter((r) => r.status === "pass").length,
      fail: knowledge.filter((r) => r.status === "fail").map((r) => `${r.severity}:${r.id}`),
      undecided: knowledge.filter((r) => r.status !== "pass" && r.status !== "fail").length,
    },
    verdict: verdict(results).gates.map((g) => ({ gate: g.gate, pass: g.pass, failedCritical: g.failedCritical })),
    units: { total: outcomes.length, represented: outcomes.filter((o) => o === "represented").length, omitted: outcomes.filter((o) => o === "omitted").length, needsReview: outcomes.filter((o) => o === "needs_review").length },
    cardsNeedingReview: Object.values(reviews).filter((r) => r.reasons.length).length,
    flags: count([...inspection.flags, ...inspection.accounting.flags.filter((f) => !inspection.flags.includes(f))], (f) => f.code),
    hints: count(inspection.hints, (h) => h.code),
    exactMissing: inspection.exactMissing.map((i) => `${i.kind}: ${i.value}`),
  };
}

describe("OpenUI vs distil Visualize: source fidelity (offline)", () => {
  const dataset = loadDataset();
  const report: Record<string, unknown> = {};

  for (const caseId of CASES) {
    it(caseId, async () => {
      const c = dataset.cases.find((x) => x.id === caseId)!;
      expect(c, caseId).toBeTruthy();
      const units = (await splitUnits(c.texts.get(1)!)).units;

      // B: the live OpenUI cards, as text nodes citing their units.
      const scoreOpenUi = (file: string) => {
      const text = readFileSync(join(HERE, file), "utf8");
      const known = new Set(units.map((u) => u.id));
      const blocks = splitCards(text);
      const cards = blocks.map((b, i) => cardOf(b, i, known)).filter((x) => x !== null);
      expect(cards.length, "most OpenUI blocks parse into cards").toBeGreaterThanOrEqual(blocks.length - 2);
      const bRaw: Raw = {
        nodes: cards.map((card) => ({
          id: card.key,
          type: "text",
          title: card.title,
          content: { markdown: [card.body, card.detail].filter(Boolean).join("\n\n") },
          ...(card.cites.length ? { [CITES]: card.cites } : { [UNCITED]: true }),
        })),
      };
      const bPlan = validateVisualPlan({ version: 1, template: "sectioned", nodes: bRaw.nodes.map(({ [CITES]: _c, [UNCITED]: _u, ...n }) => n), relationships: [] }).plan;
      const b = evidenceOf(bRaw, units, []);
      const bResults = evaluate(c.evaluation.assertions, c, { plan: bPlan, run: b.run });
      return { b, bResults, cards };
      };
      // v1: the first live prompt; v2: with ⟨keep exactly⟩ / ⟨condition⟩ annotations (same day, same model).
      const { b, bResults, cards } = scoreOpenUi(`${caseId}.openui.txt`);
      const v2 = scoreOpenUi(`${caseId}.openui-v2.txt`);

      // A: the recorded distil run, re-inspected without its model-check verdicts.
      const aPlanRaw = readJson<{ nodes: Record<string, unknown>[] }>(join(RECORDING, caseId, "plan.json"));
      const aRun = readJson<RunEvidence & { cites: Record<string, string[]>; omitted: Omission[]; units: { units: SourceUnit[] } }>(join(RECORDING, caseId, "run.json"));
      const aRaw: Raw = { nodes: aPlanRaw.nodes.map((n) => ({ ...n, ...(aRun.cites[n.id as string]?.length ? { [CITES]: aRun.cites[n.id as string] } : {}), ...(n.type === "source" ? { [BY_REFERENCE]: true } : {}) })) };
      const a = evidenceOf(aRaw, aRun.units.units, aRun.omitted ?? []);
      const aPlan = validateVisualPlan(aPlanRaw).plan;
      const aResults = evaluate(c.evaluation.assertions, c, { plan: aPlan, run: a.run });

      const aCards = a.inspection.views.length;
      report[caseId] = {
        sourceUnits: units.length,
        distilVisualize: summarise(aResults, a.inspection, aCards),
        openui: summarise(bResults, b.inspection, cards.length),
        openuiV2: summarise(v2.bResults, v2.b.inspection, v2.cards.length),
        gate1Assertions: aResults.filter((r) => r.gate === 1).length,
        perAssertion: Object.fromEntries(
          aResults.filter((r) => r.gate === 1).map((r, i) => [r.id, { severity: r.severity, distil: r.status, openui: bResults.filter((x) => x.gate === 1)[i]?.status, openuiV2: v2.bResults.filter((x) => x.gate === 1)[i]?.status, openuiDetail: bResults.filter((x) => x.gate === 1)[i]?.detail.slice(0, 160), openuiV2Detail: v2.bResults.filter((x) => x.gate === 1)[i]?.detail.slice(0, 160) }]),
        ),
      };
    });
  }

  it("writes the report when asked", () => {
    const out = process.env.OPENUI_SCORE_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    expect(Object.keys(report)).toEqual(CASES);
  });
});
