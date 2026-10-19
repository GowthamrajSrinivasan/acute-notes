/**
 * Phase 1 spike (`.ai/docs/decision-models-plan.md`): could a typed decision model (Jev on OpenRouter) take over the CLASSIFICATION
 * half of the outline — each section's kind and prominence — and how does it compare to the chat outline we run today?
 *
 * For each of the four sample documents:
 *   1. a chat outline twice with the main model (`gpt-oss-120b`): run A is the ground truth, run B measures the noise floor
 *      (how often the chat model agrees with itself), and once with the chat decision model (Gemini lite) for its time;
 *   2. every section of run A is classified by Jev (kind + prominence, one request per section, in parallel).
 * Reports agreement, confidence, latency and token use to `.ai/docs/decision-spike/`.
 *
 * Real network calls with the keys in `.env.local`. Run explicitly:
 *   npx vitest run --config vitest.contract.config.ts decisionSpike
 * OpenAI's Decisions API is skipped unless ACUTE_TEST_OPENAI_API_KEY is a real key.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { parseJsonReply } from "@/ai/runtime";
import { analysisUnits, type AnalysisUnit } from "@/ai/reconcile/units";
import { SECTION_KIND_REGISTRY, SECTION_KINDS } from "@/ai/visual-plan/sectionKinds";
import { outlineDocumentTask, validateOutline, type OutlineSection } from "@/ai/visualize/outline";
import { isHeadingOnly, sectionText } from "@/ai/visualize/outlined";
import type { DecisionRequest } from "@/ai/decisions/types";
import { getByokCredentials } from "./testEnv";

const FIXTURE_DIR = join(process.cwd(), "src", "ai", "fidelity", "__fixtures__");
const FIXTURES = ["cmg-verify-cheatsheet.txt", "handoff-status.md", "decision-table-reply.txt", "unit-checks-reply.md"];
const MAIN_MODEL = "openai/gpt-oss-120b";
const CHAT_DECISION_MODEL = "google/gemini-2.5-flash-lite";
const JEV_MODEL = "typesafe/jev-1.13";
const CONFIDENT = 0.6;
const OUT = join(process.cwd(), ".ai", "docs", "decision-spike");

const aicredits = getByokCredentials("aicredits");
const openrouter = getByokCredentials("openrouter");
const openai = getByokCredentials("openai");

interface ChatOutline {
  sections: OutlineSection[];
  ms: number;
  tokens: number;
  warnings: string[];
}

async function chatOutline(model: string, units: { key: string; text: string }[]): Promise<ChatOutline> {
  const { systemPrompt, prompt } = outlineDocumentTask.buildPrompt({ input: { units } });
  const start = Date.now();
  const res = await fetch("https://api.aicredits.in/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${aicredits!.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: prompt }] }),
  });
  const ms = Date.now() - start;
  if (!res.ok) throw new Error(`chat outline ${model}: HTTP ${res.status}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { total_tokens?: number } };
  const { outline, warnings } = validateOutline(parseJsonReply(body.choices[0]!.message.content), units);
  return { sections: outline.sections, ms, tokens: body.usage?.total_tokens ?? 0, warnings };
}

const KIND_CHOICES = SECTION_KINDS.map((k) => ({ value: k, description: SECTION_KIND_REGISTRY[k].when }));
const PROMINENCE_CHOICES = [
  { value: "primary", description: "carries a main idea of the document (its structure, the comparison, the decision)" },
  { value: "supporting", description: "reasoning, evidence, examples or detail that backs up another section" },
];

function classifyRequest(label: string, text: string): DecisionRequest {
  return {
    state: { section_title: label, section_text: text.slice(0, 12_000) },
    questions: {
      kind: { type: "choice", instructions: "What kind of section is this? Take the first kind, in this order, that fits.", choices: KIND_CHOICES },
      prominence: { type: "choice", instructions: "Is this section primary or supporting?", choices: PROMINENCE_CHOICES },
    },
  };
}

interface Classified {
  key: string;
  label: string;
  chars: number;
  truthKind: string;
  truthProminence: string;
  kind: string;
  kindConfidence: number;
  prominence: string;
  prominenceConfidence: number;
  ms: number;
  promptTokens: number;
  chatKindB?: string;
}

async function classifyWithJev(sections: OutlineSection[], units: readonly AnalysisUnit[]): Promise<{ rows: Classified[]; wallMs: number }> {
  const start = Date.now();
  const rows = await Promise.all(
    sections.map(async (s): Promise<Classified> => {
      const text = sectionText(s, units);
      const t0 = Date.now();
      const r = await hostDecide({ vendor: "jev", model: JEV_MODEL, apiKey: openrouter!.apiKey, request: classifyRequest(s.label, text), timeoutMs: 60_000 });
      const kind = r.answers.kind?.type === "choice" ? r.answers.kind : null;
      const prominence = r.answers.prominence?.type === "choice" ? r.answers.prominence : null;
      return {
        key: s.key,
        label: s.label,
        chars: text.length,
        truthKind: s.kind,
        truthProminence: s.prominence,
        kind: kind?.choice ?? "?",
        kindConfidence: kind?.confidence ?? 0,
        prominence: prominence?.choice ?? "?",
        prominenceConfidence: prominence?.confidence ?? 0,
        ms: Date.now() - t0,
        promptTokens: r.usage.promptTokens ?? 0,
      };
    }),
  );
  return { rows, wallMs: Date.now() - start };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : "n/a");
const sameUnits = (a: OutlineSection, b: OutlineSection) => a.units.length === b.units.length && a.units.every((u, i) => u === b.units[i]);

describe.skipIf(!aicredits || !openrouter)("Phase 1 spike: typed decision model for section classification", () => {
  it("compares Jev's kind/prominence with the chat outline on the sample documents", async () => {
    mkdirSync(OUT, { recursive: true });
    const lines: string[] = [];
    const all: Classified[] = [];
    const doc: { name: string; sections: number; chatMs: number; liteMs: number; jevWallMs: number; groupingSame: string }[] = [];
    let noiseSame = 0;
    let noiseKindAgree = 0;
    let noiseProminenceAgree = 0;

    for (const file of FIXTURES) {
      const text = readFileSync(join(FIXTURE_DIR, file), "utf8");
      const { parsed } = await analyzeContent(text, {});
      const units = analysisUnits(parsed, text).filter((u) => !isHeadingOnly(u));
      const [a, b, lite] = await Promise.all([chatOutline(MAIN_MODEL, units), chatOutline(MAIN_MODEL, units), chatOutline(CHAT_DECISION_MODEL, units)]);
      const { rows, wallMs } = await classifyWithJev(a.sections, units);
      let same = 0;
      for (const row of rows) {
        const mate = b.sections.find((s) => s.key === row.key) ?? b.sections.find((s) => sameUnits(s, a.sections.find((x) => x.key === row.key)!));
        if (mate) {
          same++;
          row.chatKindB = mate.kind;
          noiseSame++;
          if (mate.kind === row.truthKind) noiseKindAgree++;
          const aSection = a.sections.find((x) => x.key === row.key)!;
          if (mate.prominence === aSection.prominence) noiseProminenceAgree++;
        }
      }
      all.push(...rows);
      doc.push({ name: file, sections: rows.length, chatMs: Math.max(a.ms, b.ms), liteMs: lite.ms, jevWallMs: wallMs, groupingSame: `${same}/${rows.length}` });
      lines.push(`### ${file} — ${rows.length} sections (chat outline ${a.ms} ms, Gemini lite ${lite.ms} ms, Jev for all sections in parallel ${wallMs} ms)`, "", "| section | chars | chat A kind | chat B kind | Jev kind (conf) | chat A prom. | Jev prom. (conf) | Jev ms |", "|---|---|---|---|---|---|---|---|");
      for (const r of rows) {
        const mark = r.kind === r.truthKind ? "" : " ✗";
        lines.push(`| ${r.label.slice(0, 44)} | ${r.chars} | ${r.truthKind} | ${r.chatKindB ?? "—"} | ${r.kind}${mark} (${r.kindConfidence.toFixed(2)}) | ${r.truthProminence} | ${r.prominence}${r.prominence === r.truthProminence ? "" : " ✗"} (${r.prominenceConfidence.toFixed(2)}) | ${r.ms} |`);
      }
      lines.push("");
    }

    const n = all.length;
    const kindAgree = all.filter((r) => r.kind === r.truthKind).length;
    const proAgree = all.filter((r) => r.prominence === r.truthProminence).length;
    const confident = all.filter((r) => r.kindConfidence >= CONFIDENT);
    const confidentAgree = confident.filter((r) => r.kind === r.truthKind).length;
    const avg = (f: (r: Classified) => number) => Math.round(all.reduce((s, r) => s + f(r), 0) / Math.max(1, n));
    const totalTokens = all.reduce((s, r) => s + r.promptTokens, 0);
    const summary = [
      `# Phase 1 spike — typed decision model for section classification (${new Date().toISOString().slice(0, 10)})`,
      "",
      `Ground truth: chat outline by \`${MAIN_MODEL}\` (run A) on ${FIXTURES.length} documents, ${n} sections. Typed model: \`${JEV_MODEL}\` via the app's own \`hostDecide\` (the real adapter).`,
      `OpenAI Decisions API: ${openai ? "key present but not exercised in this spike" : "skipped (no real key in .env.local)"}.`,
      "",
      "## Result",
      "",
      `| | |`,
      `|---|---|`,
      `| Jev agrees with chat outline on **kind** | **${pct(kindAgree, n)}** |`,
      `| …only where Jev's confidence ≥ ${CONFIDENT} | ${pct(confidentAgree, confident.length)} (covers ${pct(confident.length, n)} of sections) |`,
      `| Jev agrees on **prominence** | ${pct(proAgree, n)} |`,
      `| Noise floor: the chat model vs. itself (sections grouped identically in both runs: ${noiseSame}/${n}) — kind | ${pct(noiseKindAgree, noiseSame)} |`,
      `| Noise floor — prominence | ${pct(noiseProminenceAgree, noiseSame)} |`,
      `| Jev latency per request (avg) | ${avg((r) => r.ms)} ms |`,
      `| Jev input tokens per section (avg) / total | ${avg((r) => r.promptTokens)} / ${totalTokens} (≈ $${((totalTokens * 0.042) / 1e6).toFixed(5)} at Jev's ~$0.042/M) |`,
      "",
      "## Timing per document",
      "",
      "| document | sections | chat outline (gpt-oss, slower of 2 runs) | chat outline (Gemini lite) | Jev, all sections in parallel | chat groupings identical A vs B |",
      "|---|---|---|---|---|---|",
      ...doc.map((d) => `| ${d.name} | ${d.sections} | ${d.chatMs} ms | ${d.liteMs} ms | ${d.jevWallMs} ms | ${d.groupingSame} |`),
      "",
      "## Per section",
      "",
      ...lines,
    ];
    writeFileSync(join(OUT, "spike-2026-10-08.md"), summary.join("\n"));
    writeFileSync(join(OUT, "spike-2026-10-08.json"), JSON.stringify({ all, doc }, null, 1));
    console.log(summary.slice(0, 22).join("\n"));
    expect(n).toBeGreaterThan(0);
  }, 900_000);
});
