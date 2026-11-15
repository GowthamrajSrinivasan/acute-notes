/**
 * Stage 4f evaluation recording (intelligent-update-engine-plan §12.14; authorized 2026-11-13 as ONE bounded campaign):
 *
 * 1. **Classifier** — `judge_consistency` (the app's own prompt, `judge.ts`) with the app's model on the pairs the rules
 *    leave `possible`: the dev split, the held-out split (**once**), and the two known misses (diagnostic: the rules
 *    never route them to the AI, but the answer shows whether it would help).
 * 2. **Labellers** — two independent models, neither the classifier, label every pair of dev, held-out and regressions
 *    without seeing the provisional labels. Disagreements are kept for human review; agreement is never ground truth.
 *
 * Limits (§12.6 and the authorization): ≤ 10 pairs a call, ≈ 1,800 tokens a call (input estimated before sending;
 * `max_tokens` set to the rest), at most 50 calls in the campaign (the daily cap), no repair retries, no reruns. A
 * provider error (429 / 5xx) is retried after a pause, as the app does; a 400 about `reasoning_effort` is retried once
 * without it (a 400 isn't billed). A truncated or unreadable reply is recorded as no answer. If a model's first call
 * fails that way, its remaining calls are not sent.
 *
 * Only the synthetic fixture sentences are sent — no canvas content. It REFUSES to run unless the run is named and
 * approved, and never re-records over an existing run:
 *
 *   CONSISTENCY_RECORD_RUN=2026-11-13-judge-baseline CONSISTENCY_RECORD_APPROVED_BY="<name>" \
 *     npx vitest run --config vitest.contract.config.ts consistencyJudge
 *
 * Writes `evaluation/update-engine/consistency/recordings/<run>/` (meta, calls with prompts, raw replies, usage, cost
 * and latency, judgments, labels, report). `src/ai/consistency/judgeEvaluation.test.ts` replays it offline.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildJudgePrompt, estimateTokens, judgeConsistencyTask, JUDGE_LIMITS, JUDGE_SYSTEM_PROMPT, outputBudget, planCalls, type JudgeOutput } from "@/ai/consistency/judge";
import { evaluateCombined, formatCombined, labelAgreement, type RecordedJudgment, type TruthLabel } from "@/ai/consistency/judgeEvaluation";
import { evaluate, formatReport, type EvalPair } from "@/ai/consistency/evaluation";
import { judgePair } from "@/ai/consistency/rules";
import { parseJsonReply } from "@/ai/runtime";
import { getByokCredentials } from "./testEnv";

const RUN_ID = process.env.CONSISTENCY_RECORD_RUN ?? "";
const APPROVED_BY = (process.env.CONSISTENCY_RECORD_APPROVED_BY ?? "").trim();
const DIR = join(process.cwd(), "evaluation", "update-engine", "consistency");
const RUN_DIR = join(DIR, "recordings", RUN_ID);
const HELDOUT_SHA256 = "9114c001350a2da346bbb7522fd6b540ee68eea194b2ae9684240d8958fe9488";
const ENDPOINT = "https://api.aicredits.in/v1";
const CLASSIFIER = "openai/gpt-oss-120b";
const LABELLERS = ["anthropic/claude-haiku-4.5", "deepseek/deepseek-v3.2"] as const;
const MAX_CALLS = 50;
const creds = getByokCredentials("aicredits");

function refusal(): string {
  if (!creds) return "no AICredits credentials in .env.local";
  if (!RUN_ID) return "CONSISTENCY_RECORD_RUN is not set: recording costs money and needs an approved, named run";
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(RUN_ID)) return `CONSISTENCY_RECORD_RUN "${RUN_ID}" must look like 2026-11-13-judge-baseline`;
  if (!APPROVED_BY) return "CONSISTENCY_RECORD_APPROVED_BY is not set: say who approved this run";
  if (existsSync(join(RUN_DIR, "meta.json"))) return `recordings/${RUN_ID} already exists: no reruns`;
  return "";
}

const load = (file: string) => (JSON.parse(readFileSync(join(DIR, file), "utf8")) as { pairs: EvalPair[] }).pairs;

interface CallRecord {
  n: number;
  purpose: "classify" | "label";
  model: string;
  split: string;
  pairIds: string[];
  systemPrompt: string;
  prompt: string;
  estimatedInputTokens: number;
  maxTokens: number;
  reasoningEffort?: string;
  status: "ok" | "unreadable" | "truncated" | "http_error" | "skipped";
  httpStatus?: number;
  finishReason?: string;
  raw?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; reasoning_tokens?: number; provider_cost?: number };
  costUsd?: number;
  ms: number;
}

const LABEL_SYSTEM_PROMPT = "You label pairs of statements for a test set. Judge only what the two statements say.";
function labelPrompt(pairs: { ref: string; a: string; b: string }[]): string {
  return (
    `Label each pair of statements, taken from two cards of the same notes:\n` +
    `- "contradiction": they cannot both be true about the same thing in the same context.\n` +
    `- "compatible": both can be true — they agree, add to each other, are about different things, or about different contexts (environment, time, version, region, scope).\n` +
    `- "ambiguous": you cannot tell without more information.\n` +
    `"why" is one short line.\n\n` +
    `Reply with JSON only: {"labels":[{"ref":"p1","label":"contradiction","why":"…"}]}\n\n` +
    pairs.map((p) => `${p.ref}\n  A: "${p.a}"\n  B: "${p.b}"`).join("\n\n")
  );
}

describe.skipIf(!!refusal())("Stage 4f — bounded evaluation recording (live, paid)", () => {
  it("records the classifier on possible pairs and two independent labellers on every pair", async () => {
    // The held-out split must be the one fixed before any rule.
    expect(createHash("sha256").update(readFileSync(join(DIR, "heldout.json"))).digest("hex")).toBe(HELDOUT_SHA256);
    const splits = { dev: load("dev.json"), heldout: load("heldout.json"), regressions: load("regressions.json") };
    mkdirSync(RUN_DIR, { recursive: true });

    // Prices from the provider's catalogue (a free GET), kept with the run.
    const catalogue = (await (await fetch(`${ENDPOINT}/models`, { headers: { authorization: `Bearer ${creds!.apiKey}` } })).json()) as { data: { id: string; input_cost_per_token?: number; output_cost_per_token?: number }[] };
    const prices = Object.fromEntries([CLASSIFIER, ...LABELLERS].map((m) => {
      const e = catalogue.data.find((x) => x.id === m);
      return [m, { input: e?.input_cost_per_token ?? null, output: e?.output_cost_per_token ?? null }];
    }));

    const calls: CallRecord[] = [];
    const deadModels = new Set<string>();
    async function send(purpose: CallRecord["purpose"], model: string, split: string, pairIds: string[], systemPrompt: string, prompt: string, maxTokens: number, effort?: string): Promise<CallRecord> {
      const base = { n: calls.length + 1, purpose, model, split, pairIds, systemPrompt, prompt, estimatedInputTokens: estimateTokens(systemPrompt + prompt), maxTokens };
      if (deadModels.has(model) || calls.filter((c) => c.status !== "skipped").length >= MAX_CALLS) {
        const rec: CallRecord = { ...base, status: "skipped", ms: 0 };
        calls.push(rec);
        return rec;
      }
      expect(pairIds.length).toBeLessThanOrEqual(JUDGE_LIMITS.pairs);
      expect(base.estimatedInputTokens + maxTokens).toBeLessThanOrEqual(JUDGE_LIMITS.totalTokens);
      const started = Date.now();
      let res: Response | undefined;
      let reasoning = effort;
      let text = "";
      for (const pause of [0, 3_000, 8_000]) {
        if (pause) await new Promise((r) => setTimeout(r, pause));
        const body = { model, temperature: 0, max_tokens: maxTokens, ...(reasoning ? { reasoning_effort: reasoning } : {}), messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }] };
        res = await fetch(`${ENDPOINT}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${creds!.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
        if (res.status === 400 && reasoning) {
          text = await res.text();
          if (/reasoning/i.test(text)) {
            reasoning = undefined;
            continue;
          }
          break;
        }
        if (res.status !== 429 && res.status < 500) break;
      }
      const ms = Date.now() - started;
      if (!res?.ok) {
        const rec: CallRecord = { ...base, ...(reasoning ? { reasoningEffort: reasoning } : {}), status: "http_error", httpStatus: res?.status, raw: (text || (await res?.text().catch(() => "")) || "").slice(0, 2_000), ms };
        calls.push(rec);
        if (!calls.some((c) => c.model === model && c.status === "ok")) deadModels.add(model);
        return rec;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
      const u = json.usage ?? {};
      const usage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.total_tokens, ...(u.completion_tokens_details?.reasoning_tokens !== undefined ? { reasoning_tokens: u.completion_tokens_details.reasoning_tokens } : {}), ...(typeof u.cost === "number" ? { provider_cost: u.cost } : {}) };
      const p = prices[model]!;
      const costUsd = p.input !== null && p.output !== null ? (u.prompt_tokens ?? 0) * p.input + (u.completion_tokens ?? 0) * p.output : undefined;
      const choice = json.choices?.[0];
      const rec: CallRecord = { ...base, ...(reasoning ? { reasoningEffort: reasoning } : {}), status: choice?.finish_reason === "length" ? "truncated" : "ok", finishReason: choice?.finish_reason, raw: choice?.message?.content ?? "", usage, ...(costUsd !== undefined ? { costUsd } : {}), ms };
      calls.push(rec);
      return rec;
    }

    // 1. Classifier: the possible pairs of each split (regressions: every pair, as a diagnostic).
    const judgments: Record<string, Record<string, RecordedJudgment & { call: number }>> = { dev: {}, heldout: {}, regressions: {} };
    for (const split of ["dev", "regressions", "heldout"] as const) {
      const items = splits[split].filter((p) => split === "regressions" || judgePair(p.a, p.b).verdict === "possible").map((p) => ({ key: p.id, a: { sentence: p.a }, b: { sentence: p.b } }));
      const { calls: planned, skipped } = planCalls(items, Number.POSITIVE_INFINITY);
      expect(skipped).toEqual([]);
      for (const c of planned) {
        const { systemPrompt, prompt } = judgeConsistencyTask.buildPrompt({ input: c.input });
        expect(prompt).toBe(buildJudgePrompt(c.input));
        const rec = await send("classify", CLASSIFIER, split, c.keys, systemPrompt ?? JUDGE_SYSTEM_PROMPT, prompt, outputBudget(c.input), "low");
        if (rec.status !== "ok") {
          if (rec.status === "truncated" && !calls.some((x) => x.model === CLASSIFIER && x.status === "ok")) deadModels.add(CLASSIFIER);
          continue;
        }
        const parsed = judgeConsistencyTask.outputSchema.safeParse(parseJsonReply(rec.raw ?? ""));
        if (!parsed.success) {
          rec.status = "unreadable";
          continue;
        }
        for (const r of (parsed.data as JudgeOutput).results) {
          const i = Number(r.ref.replace(/^p/, "")) - 1;
          const key = c.keys[i];
          if (key && !judgments[split]![key]) judgments[split]![key] = { answer: r.answer, ...(r.why ? { why: r.why } : {}), ...(r.suggestion ? { suggestion: r.suggestion } : {}), call: rec.n };
        }
      }
    }

    // 2. Labellers: every pair, ten a call, without the provisional labels.
    const everyPair = [...splits.dev.map((p) => ({ split: "dev", p })), ...splits.heldout.map((p) => ({ split: "heldout", p })), ...splits.regressions.map((p) => ({ split: "regressions", p }))];
    const labels: Record<string, Record<string, { label: TruthLabel; why?: string; call: number }>> = Object.fromEntries(LABELLERS.map((m) => [m, {}]));
    const labelSchema = { parse: (v: unknown) => (v && typeof v === "object" && Array.isArray((v as { labels?: unknown }).labels) ? ((v as { labels: { ref?: unknown; label?: unknown; why?: unknown }[] }).labels) : null) };
    for (const model of LABELLERS) {
      for (let at = 0; at < everyPair.length; at += JUDGE_LIMITS.pairs) {
        const chunk = everyPair.slice(at, at + JUDGE_LIMITS.pairs);
        const prompt = labelPrompt(chunk.map((x, i) => ({ ref: `p${i + 1}`, a: x.p.a, b: x.p.b })));
        const est = estimateTokens(LABEL_SYSTEM_PROMPT + prompt);
        expect(est).toBeLessThanOrEqual(JUDGE_LIMITS.inputTokens);
        const rec = await send("label", model, [...new Set(chunk.map((x) => x.split))].join("+"), chunk.map((x) => x.p.id), LABEL_SYSTEM_PROMPT, prompt, Math.max(200, JUDGE_LIMITS.totalTokens - est));
        if (rec.status !== "ok") {
          if (rec.status === "truncated" && !calls.some((x) => x.model === model && x.status === "ok")) deadModels.add(model);
          continue;
        }
        const rows = labelSchema.parse(parseJsonReply(rec.raw ?? ""));
        if (!rows) {
          rec.status = "unreadable";
          continue;
        }
        for (const r of rows) {
          const i = Number(String(r.ref ?? "").replace(/^p/, "")) - 1;
          const id = chunk[i]?.p.id;
          if (id && (r.label === "contradiction" || r.label === "compatible" || r.label === "ambiguous") && !labels[model]![id]) labels[model]![id] = { label: r.label, ...(typeof r.why === "string" ? { why: r.why } : {}), call: rec.n };
        }
      }
    }

    // 3. Save, then the report from the saved data (the same functions the offline replay uses).
    const sent = calls.filter((c) => c.status !== "skipped");
    const sum = (f: (c: CallRecord) => number | undefined) => sent.reduce((s, c) => s + (f(c) ?? 0), 0);
    const byModel = Object.fromEntries([CLASSIFIER, ...LABELLERS].map((m) => {
      const cs = sent.filter((c) => c.model === m);
      const ms = cs.map((c) => c.ms).sort((a, b) => a - b);
      return [m, { calls: cs.length, ok: cs.filter((c) => c.status === "ok").length, promptTokens: cs.reduce((s, c) => s + (c.usage?.prompt_tokens ?? 0), 0), completionTokens: cs.reduce((s, c) => s + (c.usage?.completion_tokens ?? 0), 0), maxCallTokens: Math.max(0, ...cs.map((c) => c.usage?.total_tokens ?? 0)), costUsd: cs.reduce((s, c) => s + (c.costUsd ?? 0), 0), latencyMs: { p50: ms[Math.floor((ms.length - 1) / 2)] ?? null, max: ms.at(-1) ?? null } }];
    }));
    const meta = {
      run: RUN_ID,
      approvedBy: APPROVED_BY,
      date: new Date().toISOString(),
      provider: "aicredits",
      endpoint: ENDPOINT,
      classifier: CLASSIFIER,
      labellers: LABELLERS,
      prices,
      limits: { ...JUDGE_LIMITS, maxCampaignCalls: MAX_CALLS },
      promptSha256: createHash("sha256").update(JUDGE_SYSTEM_PROMPT + buildJudgePrompt({ pairs: [] })).digest("hex"),
      heldoutSha256: HELDOUT_SHA256,
      heldoutExposure: `held-out pairs: classified once by ${CLASSIFIER} (its possible pairs only); every held-out pair also sent once to each labeller (${LABELLERS.join(", ")})`,
      totals: { calls: sent.length, skipped: calls.length - sent.length, promptTokens: sum((c) => c.usage?.prompt_tokens), completionTokens: sum((c) => c.usage?.completion_tokens), costUsd: sum((c) => c.costUsd) },
      byModel,
    };
    writeFileSync(join(RUN_DIR, "calls.json"), JSON.stringify(calls, null, 2) + "\n");
    writeFileSync(join(RUN_DIR, "judgments.json"), JSON.stringify(judgments, null, 2) + "\n");
    writeFileSync(join(RUN_DIR, "labels.json"), JSON.stringify(labels, null, 2) + "\n");
    writeFileSync(join(RUN_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

    const asMap = (o: Record<string, RecordedJudgment>) => new Map(Object.entries(o));
    const labelMap = (m: string) => new Map(Object.entries(labels[m]!).map(([k, v]) => [k, v.label] as const));
    const report = [
      `# Stage 4f recording ${RUN_ID}`,
      "",
      "```json",
      JSON.stringify(meta.totals, null, 2),
      JSON.stringify(byModel, null, 2),
      "```",
      "",
      ...(["dev", "heldout", "regressions"] as const).flatMap((s) => [formatReport(`${s} rules only`, evaluate(splits[s])), "", formatCombined(s, evaluateCombined(splits[s], asMap(judgments[s]!))), ""]),
      "## Label agreement",
      "```json",
      JSON.stringify(labelAgreement([...splits.dev, ...splits.heldout, ...splits.regressions], labelMap(LABELLERS[0]), labelMap(LABELLERS[1])), null, 2),
      "```",
    ].join("\n");
    writeFileSync(join(RUN_DIR, "report.md"), report + "\n");
    console.log(report);
    expect(sent.length).toBeLessThanOrEqual(MAX_CALLS);
  }, 900_000);
});

describe("Stage 4f recording — refusal", () => {
  it("says why it did not run", () => {
    const why = refusal();
    if (why) console.log(`consistencyJudge recording not run: ${why}`);
    expect(true).toBe(true);
  });
});
