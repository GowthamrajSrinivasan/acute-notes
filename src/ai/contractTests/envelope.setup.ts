/**
 * Installs the external execution envelope (executionEnvelope.ts, §12.33) around global `fetch` for one paid recording,
 * via vitest.envelope.config.ts — the frozen recorder is not edited. Active only with ENVELOPE_RUN_DIR and every ceiling
 * set; otherwise it installs nothing. Writes every decision to `<ENVELOPE_RUN_DIR>/envelope.json` as it happens.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createExecutionEnvelope } from "./executionEnvelope";
import { getByokCredentials } from "./testEnv";

const RUN_DIR = process.env.ENVELOPE_RUN_DIR ?? "";
const MAX_REQUESTS = Number(process.env.ENVELOPE_MAX_REQUESTS) || 0;
const MAX_TOKENS = Number(process.env.ENVELOPE_MAX_TOKENS) || 0;
const MAX_USD = Number(process.env.ENVELOPE_MAX_USD) || 0;
const MODEL = process.env.ENVELOPE_MODEL ?? "openai/gpt-oss-120b";
const ENDPOINT = "https://api.aicredits.in/v1";
/** Above the largest chat-template excess measured on this prompt (39 tokens, reliability run). */
const TEMPLATE_MARGIN = 64;

if (RUN_DIR && MAX_REQUESTS && MAX_TOKENS && MAX_USD) {
  const creds = getByokCredentials("aicredits");
  if (!creds) throw new Error("execution envelope: no AICredits credentials");
  const base = globalThis.fetch;
  const catalogue = (await (await base(`${ENDPOINT}/models`, { headers: { authorization: `Bearer ${creds.apiKey}` } })).json()) as { data: { id: string; input_cost_per_token: number; output_cost_per_token: number }[] };
  const price = catalogue.data.find((m) => m.id === MODEL);
  if (!price) throw new Error(`execution envelope: no price for ${MODEL}`);
  const limits = { maxRequests: MAX_REQUESTS, maxTokens: MAX_TOKENS, maxUsd: MAX_USD, price: { input: price.input_cost_per_token, output: price.output_cost_per_token }, templateMargin: TEMPLATE_MARGIN };
  mkdirSync(RUN_DIR, { recursive: true });
  const file = join(RUN_DIR, "envelope.json");
  const env = createExecutionEnvelope(base, limits, () => writeFileSync(file, JSON.stringify({ limits, totals: env.totals(), log: env.log }, null, 2) + "\n"));
  writeFileSync(file, JSON.stringify({ limits, totals: env.totals(), log: [] }, null, 2) + "\n");
  globalThis.fetch = env.fetch;
}
