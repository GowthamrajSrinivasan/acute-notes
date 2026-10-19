/**
 * Spike, second pass (`.ai/docs/decision-models-plan.md` section 8): the first spike asked Jev one unordered 9-way choice for a section's
 * kind and got 53 % agreement with the chat outline. Why it might have missed: the outline picks "the first kind, in this order, that fits",
 * which a single choice can't express, and the kind descriptions overlap. Two reworked questions, run on the SAME sections as the
 * original, so the numbers are comparable:
 *   V1  original: one choice over the 9 kinds (re-run, as the baseline);
 *   V2  cascade: one yes/no statement per kind in one request; the FIRST kind in the outline's order whose probability reaches the
 *       threshold wins (the ordered rule runs in code), else "notes". Threshold fixed at 0.5 beforehand, 0.3 / 0.7 reported;
 *   V3  two steps: a choice among 4 families of kinds, then a choice among that family's kinds (two requests per section).
 * Ground truth: chat outline by `gpt-oss-120b` (run A); run B measures the noise floor. Real network calls:
 *   npx vitest run --config vitest.contract.config.ts decisionSpikeTuned
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { parseJsonReply } from "@/ai/runtime";
import type { AnalysisUnit } from "@/ai/reconcile/units";
import { SECTION_KIND_REGISTRY, SECTION_KINDS, type SectionKind } from "@/ai/visual-plan/sectionKinds";
import { outlineDocumentTask, validateOutline, type OutlineSection } from "@/ai/visualize/outline";
import { sectionText } from "@/ai/visualize/outlined";
import type { DecisionAnswer, DecisionRequest } from "@/ai/decisions/types";
import { aicredits, avg, chat, FIXTURES, JEV_MODEL, loadUnits, MAIN_MODEL, openrouter, pct } from "./spikeUtil";

const OUT = join(process.cwd(), ".ai", "docs", "decision-spike");

// ---- V2: one statement per kind, evaluated in the outline's own order ------------------------------------------
const STATEMENTS: Record<Exclude<SectionKind, "notes">, string> = {
  comparison: "Several entities (options, plans, tiers, products, alternatives) are described by the same attributes, or several cases are compared before and after (old vs new).",
  hierarchy: "The section describes a hierarchy, branching or parent/child structure: a tree, or categories that contain other things.",
  flow: "The section describes steps or stages in a sequence, where each leads to the next and the order is the point.",
  cards: "The section lists two to six parallel, independent concepts of similar weight, each short, without shared attributes.",
  decision: "The section states a recommendation, decision, conclusion or chosen direction, including numbered sets of decisions or proposals.",
  metrics: "The section is mainly numbers, measurements, metrics, costs or things to track.",
  annotated: "The section is running prose in which specific phrases or claims each need their own explanation, caveat or source.",
  supporting: "The section is reasoning, evidence, examples, caveats or background that supports another section instead of being a main idea.",
};
const ORDER = SECTION_KINDS.filter((k): k is Exclude<SectionKind, "notes"> => k !== "notes");
const PROMINENT = "The section carries a main idea of the document (its structure, the comparison, the decision), rather than being reasoning, evidence, examples or detail.";

// ---- V3: families, then a kind within the family ---------------------------------------------------------------
const FAMILIES: Record<string, { description: string; kinds: SectionKind[] }> = {
  relationships: { description: "its point is how things relate: compared by attributes, nested in a hierarchy, or happening in order", kinds: ["comparison", "hierarchy", "flow"] },
  items: { description: "it is a set of items or figures: a few parallel concepts, or numbers and metrics to track", kinds: ["cards", "metrics"] },
  statements: { description: "it states or argues something: a decision or conclusion, prose with claims that need annotation, or supporting reasoning and evidence", kinds: ["decision", "annotated", "supporting"] },
  other: { description: "none of the above; general notes", kinds: ["notes"] },
};

const input = (s: OutlineSection, units: readonly AnalysisUnit[]) => ({ section_title: s.label, section_text: sectionText(s, units).slice(0, 12_000) });
const choiceOf = (a: DecisionAnswer | undefined) => (a?.type === "choice" ? a : null);
const probOf = (a: DecisionAnswer | undefined) => (a?.type === "boolean" ? a.probability : 0);
const call = (request: DecisionRequest) => hostDecide({ vendor: "jev", model: JEV_MODEL, apiKey: openrouter!.apiKey, request, timeoutMs: 60_000 });

async function v1(s: OutlineSection, units: readonly AnalysisUnit[]) {
  const t0 = Date.now();
  const r = await call({
    state: input(s, units),
    questions: {
      kind: { type: "choice", instructions: "What kind of section is this? Take the first kind, in this order, that fits.", choices: SECTION_KINDS.map((k) => ({ value: k, description: SECTION_KIND_REGISTRY[k].when })) },
      prominence: {
        type: "choice",
        instructions: "Is this section primary or supporting?",
        choices: [
          { value: "primary", description: "carries a main idea of the document (its structure, the comparison, the decision)" },
          { value: "supporting", description: "reasoning, evidence, examples or detail that backs up another section" },
        ],
      },
    },
  });
  const k = choiceOf(r.answers.kind);
  const p = choiceOf(r.answers.prominence);
  return { kind: k?.choice ?? "?", conf: k?.confidence ?? 0, prominence: p?.choice ?? "?", ms: Date.now() - t0, tokens: r.usage.promptTokens ?? 0, requests: 1 };
}

async function v2(s: OutlineSection, units: readonly AnalysisUnit[]) {
  const t0 = Date.now();
  const r = await call({
    state: input(s, units),
    questions: {
      ...Object.fromEntries(ORDER.map((k) => [k, { type: "boolean" as const, instructions: STATEMENTS[k], whenTrue: "The statement is true of this section.", whenFalse: "The statement is not true of this section." }])),
      prominent: { type: "boolean", instructions: PROMINENT, whenTrue: "The section carries a main idea.", whenFalse: "The section is supporting detail." },
    },
  });
  const p = Object.fromEntries(ORDER.map((k) => [k, probOf(r.answers[k])])) as Record<string, number>;
  const pick = (tau: number) => ORDER.find((k) => p[k]! >= tau) ?? "notes";
  const top = Math.max(0, ...Object.values(p));
  return { byTau: { 0.3: pick(0.3), 0.5: pick(0.5), 0.7: pick(0.7) } as Record<number, string>, probs: p, conf: top, prominence: probOf(r.answers.prominent) >= 0.5 ? "primary" : "supporting", ms: Date.now() - t0, tokens: r.usage.promptTokens ?? 0, requests: 1 };
}

async function v3(s: OutlineSection, units: readonly AnalysisUnit[]) {
  const t0 = Date.now();
  const first = await call({
    state: input(s, units),
    questions: {
      family: { type: "choice", instructions: "Which description fits this section best?", choices: Object.entries(FAMILIES).map(([value, f]) => ({ value, description: f.description })) },
      prominent: { type: "boolean", instructions: PROMINENT, whenTrue: "The section carries a main idea.", whenFalse: "The section is supporting detail." },
    },
  });
  const fam = choiceOf(first.answers.family);
  const members = FAMILIES[fam?.choice ?? "other"]?.kinds ?? ["notes"];
  if (members.length === 1) {
    return { kind: members[0]!, conf: fam?.confidence ?? 0, prominence: probOf(first.answers.prominent) >= 0.5 ? "primary" : "supporting", ms: Date.now() - t0, tokens: first.usage.promptTokens ?? 0, requests: 1 };
  }
  const second = await call({
    state: input(s, units),
    questions: { kind: { type: "choice", instructions: "Which kind of section is this? Take the first that fits, in this order.", choices: members.map((k) => ({ value: k, description: SECTION_KIND_REGISTRY[k].when })) } },
  });
  const k = choiceOf(second.answers.kind);
  return { kind: k?.choice ?? "?", conf: Math.min(fam?.confidence ?? 0, k?.confidence ?? 0), prominence: probOf(first.answers.prominent) >= 0.5 ? "primary" : "supporting", ms: Date.now() - t0, tokens: (first.usage.promptTokens ?? 0) + (second.usage.promptTokens ?? 0), requests: 2 };
}

async function chatOutline(units: readonly AnalysisUnit[]): Promise<OutlineSection[]> {
  const { systemPrompt, prompt } = outlineDocumentTask.buildPrompt({ input: { units: units.map((u) => ({ key: u.key, text: u.text })) } });
  return validateOutline(parseJsonReply((await chat(MAIN_MODEL, prompt, systemPrompt)).text), units).outline.sections;
}

interface Row {
  doc: string;
  label: string;
  truthKind: string;
  truthProm: string;
  mateKind?: string;
  v1: Awaited<ReturnType<typeof v1>>;
  v2: Awaited<ReturnType<typeof v2>>;
  v3: Awaited<ReturnType<typeof v3>>;
}

describe.skipIf(!aicredits || !openrouter)("spike (tuned questions): typed decision model for section kind", () => {
  it("compares the original choice, the ordered yes/no cascade and the two-step question on the same sections", async () => {
    mkdirSync(OUT, { recursive: true });
    const rows: Row[] = [];
    for (const file of FIXTURES) {
      const { units } = await loadUnits(file);
      const a = await chatOutline(units);
      const b = await chatOutline(units);
      const done = await Promise.all(
        a.map(async (s): Promise<Row> => {
          const [r1, r2, r3] = await Promise.all([v1(s, units), v2(s, units), v3(s, units)]);
          const mate = b.find((x) => x.key === s.key);
          return { doc: file, label: s.label, truthKind: s.kind, truthProm: s.prominence, ...(mate ? { mateKind: mate.kind } : {}), v1: r1, v2: r2, v3: r3 };
        }),
      );
      rows.push(...done);
    }
    const n = rows.length;
    const withMate = rows.filter((r) => r.mateKind);
    const kindOf = (r: Row, v: "v1" | "v3" | 0.3 | 0.5 | 0.7) => (v === "v1" ? r.v1.kind : v === "v3" ? r.v3.kind : r.v2.byTau[v]!);
    const kindAgree = (v: "v1" | "v3" | 0.3 | 0.5 | 0.7) => rows.filter((r) => kindOf(r, v) === r.truthKind).length;
    const promAgree = (v: "v1" | "v2" | "v3") => rows.filter((r) => r[v].prominence === r.truthProm).length;
    const strict = (v: "v1" | "v3" | 0.5) => rows.filter((r) => (v === 0.5 ? r.v2.conf : r[v].conf) >= 0.6);
    const strictAgree = (v: "v1" | "v3" | 0.5) => strict(v).filter((r) => kindOf(r, v) === r.truthKind).length;
    const report = [
      `# Spike, second pass — tuned questions for section kind (2026-10-09)`,
      "",
      `${n} sections from ${FIXTURES.length} documents; ground truth = chat outline by \`${MAIN_MODEL}\` (run A). Same sections for every variant. Jev: \`${JEV_MODEL}\`.`,
      "",
      "| variant | kind agreement | …only where confident (≥ 0.6) | prominence agreement | requests per section | latency per section (avg) | input tokens (total) |",
      "|---|---|---|---|---|---|---|",
      `| V1 one unordered choice (original) | ${pct(kindAgree("v1"), n)} | ${pct(strictAgree("v1"), strict("v1").length)} of ${strict("v1").length} | ${pct(promAgree("v1"), n)} | 1 | ${avg(rows.map((r) => r.v1.ms))} ms | ${rows.reduce((s, r) => s + r.v1.tokens, 0)} |`,
      `| V2 ordered yes/no cascade, threshold 0.5 | **${pct(kindAgree(0.5), n)}** | ${pct(strictAgree(0.5), strict(0.5).length)} of ${strict(0.5).length} | ${pct(promAgree("v2"), n)} | 1 (9 questions) | ${avg(rows.map((r) => r.v2.ms))} ms | ${rows.reduce((s, r) => s + r.v2.tokens, 0)} |`,
      `| V2 threshold 0.3 / 0.7 (sensitivity) | ${pct(kindAgree(0.3), n)} / ${pct(kindAgree(0.7), n)} | | | | | |`,
      `| V3 two steps (family, then kind) | ${pct(kindAgree("v3"), n)} | ${pct(strictAgree("v3"), strict("v3").length)} of ${strict("v3").length} | ${pct(promAgree("v3"), n)} | ${(rows.reduce((s, r) => s + r.v3.requests, 0) / n).toFixed(1)} | ${avg(rows.map((r) => r.v3.ms))} ms | ${rows.reduce((s, r) => s + r.v3.tokens, 0)} |`,
      `| Noise floor: chat vs itself (${withMate.length}/${n} sections grouped identically) | ${pct(withMate.filter((r) => r.mateKind === r.truthKind).length, withMate.length)} | | | | | |`,
      "",
      "## Per section (✗ = differs from the chat outline)",
      "",
      "| doc | section | chat A | chat B | V1 | V2 @0.5 | V3 | prom. A / V1 / V2 / V3 |",
      "|---|---|---|---|---|---|---|---|",
      ...rows.map((r) => {
        const m = (k: string) => (k === r.truthKind ? k : `${k} ✗`);
        return `| ${r.doc.slice(0, 12)} | ${r.label.slice(0, 36)} | ${r.truthKind} | ${r.mateKind ?? "—"} | ${m(r.v1.kind)} | ${m(r.v2.byTau[0.5]!)} | ${m(r.v3.kind)} | ${r.truthProm.slice(0, 4)} / ${r.v1.prominence.slice(0, 4)} / ${r.v2.prominence.slice(0, 4)} / ${r.v3.prominence.slice(0, 4)} |`;
      }),
    ];
    writeFileSync(join(OUT, "kind-tuned-2026-10-09.md"), report.join("\n"));
    writeFileSync(join(OUT, "kind-tuned-2026-10-09.json"), JSON.stringify(rows, null, 1));
    console.log(report.slice(0, 14).join("\n"));
    expect(n).toBeGreaterThan(0);
  }, 900_000);
});
