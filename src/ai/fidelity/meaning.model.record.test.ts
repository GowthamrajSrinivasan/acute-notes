/**
 * Records one live run of the model check (`semanticCheck.ts`) over the labelled paraphrase set, so it can be
 * measured offline (`meaning.model.eval.test.ts`). **Costs money: skipped unless `MEANING_MODEL_RECORD` names the run**
 * and `MEANING_MODEL_APPROVED_BY` says who approved it (knowledge-notes-plan §7.2 step 2; never part of CI).
 *
 *   MEANING_MODEL_RECORD=2026-10-19-gemini-flash MEANING_MODEL_APPROVED_BY="<name>" \
 *     npx vitest run src/ai/fidelity/meaning.model.record.test.ts
 *
 * Connection: OpenRouter, key `ACUTE_TEST_OPENROUTER_API_KEY` from `.env.local`; model `MEANING_MODEL` (default
 * `google/gemini-2.5-flash`). `MEANING_MODEL_CAP_USD` (default 0.25) stops the run once the provider-reported cost
 * passes it. Writes `__fixtures__/meaning/model-check/<run>.json`; never overwrites an existing run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pairsFile from "./__fixtures__/meaning/pairs.json";
import type { MeaningPair } from "./contracts";
import { SEMANTIC_CHECK_PROMPT_VERSION, SEMANTIC_CHECK_SYSTEM, parseSemanticCheckReply, semanticCheckRequest } from "./semanticCheck";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "meaning", "model-check");
const RUN = process.env.MEANING_MODEL_RECORD;
const BATCH = 24;

function envLocal(name: string): string | undefined {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === name) return m[2]!.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").trim();
  }
  return undefined;
}

describe("model check: record a live run (costs money; opt-in)", () => {
  it.skipIf(!RUN)("asks the model about every pair and saves the answers", { timeout: 600_000 }, async () => {
    const approvedBy = process.env.MEANING_MODEL_APPROVED_BY;
    expect(approvedBy, "MEANING_MODEL_APPROVED_BY: who approved this paid run").toBeTruthy();
    expect(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(RUN!), "MEANING_MODEL_RECORD: YYYY-MM-DD-name").toBe(true);
    const out = join(OUT_DIR, `${RUN}.json`);
    expect(existsSync(out), `${out} exists: a new run gets a new name`).toBe(false);
    const key = process.env.ACUTE_TEST_OPENROUTER_API_KEY ?? envLocal("ACUTE_TEST_OPENROUTER_API_KEY");
    expect(key, "ACUTE_TEST_OPENROUTER_API_KEY").toBeTruthy();
    const model = process.env.MEANING_MODEL ?? "google/gemini-2.5-flash";
    const cap = Number(process.env.MEANING_MODEL_CAP_USD ?? "0.25");

    const pairs = (pairsFile as { pairs: MeaningPair[] }).pairs;
    const answers: Record<string, { verdict: string; reason: string }> = {};
    const missing: string[] = [];
    let cost = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let calls = 0;
    for (let i = 0; i < pairs.length; i += BATCH) {
      if (cost > cap) throw new Error(`cost cap reached: $${cost.toFixed(4)} > $${cap}`);
      const batch = pairs.slice(i, i + BATCH);
      const items = batch.map((p, j) => ({ ref: `c${j + 1}`, source: p.source, card: p.card }));
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          usage: { include: true },
          messages: [
            { role: "system", content: SEMANTIC_CHECK_SYSTEM },
            { role: "user", content: semanticCheckRequest(items) },
          ],
        }),
      });
      expect(res.ok, `HTTP ${res.status}: ${res.ok ? "" : await res.text()}`).toBe(true);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
      calls++;
      cost += body.usage?.cost ?? 0;
      tokensIn += body.usage?.prompt_tokens ?? 0;
      tokensOut += body.usage?.completion_tokens ?? 0;
      const parsed = parseSemanticCheckReply(body.choices?.[0]?.message?.content ?? "", items.map((x) => x.ref));
      for (const a of parsed.answers) answers[batch[Number(a.ref.slice(1)) - 1]!.id] = { verdict: a.verdict, reason: a.reason };
      for (const ref of parsed.missing) missing.push(batch[Number(ref.slice(1)) - 1]!.id);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    const meta = { run: RUN, approvedBy, recordedAt: new Date().toISOString(), provider: "openrouter", model, promptVersion: SEMANTIC_CHECK_PROMPT_VERSION, temperature: 0, batch: BATCH, calls, tokensIn, tokensOut, costUsd: Number(cost.toFixed(6)), pairs: pairs.length, missing };
    writeFileSync(out, JSON.stringify({ meta, answers }, null, 2) + "\n");
    console.log(JSON.stringify(meta));
  });
});
