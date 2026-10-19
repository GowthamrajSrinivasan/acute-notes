/**
 * Shared helpers for the decision-model spikes (`decisionSpike*.contract.test.ts`, `assignSpike.contract.test.ts`): live chat calls
 * through AICredits, the sample documents as analysis units, and small formatting helpers. Real network use — only the contract
 * tests import this.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeContent } from "@/ai/content/analyze";
import { analysisUnits, type AnalysisUnit } from "@/ai/reconcile/units";
import { isHeadingOnly } from "@/ai/visualize/outlined";
import { getByokCredentials } from "./testEnv";

export const FIXTURE_DIR = join(process.cwd(), "src", "ai", "fidelity", "__fixtures__");
export const FIXTURES = ["cmg-verify-cheatsheet.txt", "handoff-status.md", "decision-table-reply.txt", "unit-checks-reply.md"] as const;
export const MAIN_MODEL = "openai/gpt-oss-120b";
export const CHAT_DECISION_MODEL = "google/gemini-2.5-flash-lite";
export const JEV_MODEL = "typesafe/jev-1.13";

export const aicredits = getByokCredentials("aicredits");
export const openrouter = getByokCredentials("openrouter");

export interface ChatReply {
  text: string;
  ms: number;
  tokens: number;
}

/** One chat completion through AICredits (the connection the app's own tests use). */
export async function chat(model: string, prompt: string, systemPrompt?: string): Promise<ChatReply> {
  const start = Date.now();
  let res: Response | undefined;
  // A rate-limited (429) or failed (5xx) call is retried after a pause, as the app's own runtime does.
  for (const pause of [0, 3_000, 8_000, 20_000]) {
    if (pause) await new Promise((r) => setTimeout(r, pause));
    res = await fetch("https://api.aicredits.in/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${aicredits!.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: prompt }] }),
    });
    if (res.status !== 429 && res.status < 500) break;
  }
  const ms = Date.now() - start;
  if (!res?.ok) throw new Error(`chat ${model}: HTTP ${res?.status}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { total_tokens?: number } };
  return { text: body.choices[0]!.message.content, ms, tokens: body.usage?.total_tokens ?? 0 };
}

/** A sample document's content units (heading-only titles dropped), as the outline sees them. */
export async function loadUnits(file: string): Promise<{ text: string; units: AnalysisUnit[] }> {
  const text = readFileSync(join(FIXTURE_DIR, file), "utf8");
  const { parsed } = await analyzeContent(text, {});
  return { text, units: analysisUnits(parsed, text).filter((u) => !isHeadingOnly(u)) };
}

export const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : "n/a");
export const avg = (xs: readonly number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length));
