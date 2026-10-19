#!/usr/bin/env node
/**
 * Summarises the per-call evidence `e2e/ai/chatShare.spec.ts` writes when `STATS_FILE=<path>` is set (one JSON line per
 * model call, plus live start/end/failed lines and notes), as a per-stage table: calls, failures, estimated tokens and
 * cost, time. A result is judged by tokens and cost, never by call count alone.
 *
 *   node scripts/ai-stats-summary.mjs <stats.jsonl> [more.jsonl …] [--json] [--in-price=0.30] [--out-price=2.50]
 *
 * Tokens are estimated as characters / 4 (the evidence records characters, not provider token counts). Prices are USD per
 * million tokens; the defaults are google/gemini-2.5-flash's list prices and only make the numbers comparable between
 * runs of the same model. Provider-reported usage, when the spec records it, is preferred (`usage` field).
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: node scripts/ai-stats-summary.mjs <stats.jsonl> [more.jsonl …] [--json] [--in-price=0.30] [--out-price=2.50]");
  process.exit(2);
}
const IN_PRICE = flag("in-price", 0.3);
const OUT_PRICE = flag("out-price", 2.5);
/** Jev (typed decisions), USD per million input tokens (settled billing, 2026-10-10); output is free. */
const JEV_PRICE = flag("jev-price", 0.042);
const CHARS_PER_TOKEN = 4;

function summarise(file) {
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const calls = rows.filter((r) => !r.note && !r.live);
  const live = rows.filter((r) => r.live);
  const notes = Object.fromEntries(rows.filter((r) => r.note).map((r) => [r.note, r.description]));
  const stages = {};
  for (const c of calls) {
    const key = `${c.step} · ${c.task ?? c.path}`;
    const s = (stages[key] ??= { step: c.step, task: c.task ?? c.path, calls: 0, failed: 0, inChars: 0, outChars: 0, repIn: 0, repOut: 0, reported: 0 });
    s.calls++;
    if (c.status !== 200) s.failed++;
    s.inChars += c.promptChars ?? 0;
    s.outChars += c.replyChars ?? 0;
    if (c.promptTokens != null) {
      s.repIn += c.promptTokens;
      s.repOut += c.completionTokens ?? 0;
      s.reported++;
    }
  }
  // Durations come from the live lines (start → end); they carry the task, not the stage, so they are totalled per task for the
  // whole run (call-seconds: parallel calls add up, so this is not wall-clock time).
  const callSeconds = {};
  for (const e of live.filter((r) => r.live === "end" && r.took != null)) callSeconds[e.task] = (callSeconds[e.task] ?? 0) + e.took / 1000;
  const rowsOut = Object.values(stages).map((s) => {
    const isDecide = s.task === "decide" || String(s.task).includes("decisions");
    const useReported = s.reported === s.calls && s.calls > 0;
    const tokensIn = useReported ? s.repIn : Math.round(s.inChars / CHARS_PER_TOKEN);
    const tokensOut = useReported ? s.repOut : Math.round(s.outChars / CHARS_PER_TOKEN);
    const costUsd = isDecide ? (tokensIn * JEV_PRICE) / 1e6 : (tokensIn * IN_PRICE + tokensOut * OUT_PRICE) / 1e6;
    return { ...s, tokensIn, tokensOut, costUsd, source: useReported ? "reported" : "estimated (characters / 4)" };
  });
  const total = rowsOut.reduce(
    (t, r) => ({ calls: t.calls + r.calls, failed: t.failed + r.failed, tokensIn: t.tokensIn + r.tokensIn, tokensOut: t.tokensOut + r.tokensOut, costUsd: t.costUsd + r.costUsd }),
    { calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  );
  const unfinished = live.filter((r) => r.live === "start").length - live.filter((r) => r.live === "end" || r.live === "failed").length;
  return { file, stages: rowsOut, total, unfinishedCalls: live.length ? unfinished : null, callSeconds, notes };
}

const results = files.map(summarise);
if (args.includes("--json")) {
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
}
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
for (const r of results) {
  console.log(`\n${r.file}`);
  console.log("stage".padEnd(44), "calls".padStart(5), "fail".padStart(4), "tok in".padStart(8), "tok out".padStart(8), "cost $".padStart(7), " tokens from");
  for (const s of r.stages) {
    console.log(`${s.step} · ${s.task}`.padEnd(44), String(s.calls).padStart(5), String(s.failed).padStart(4), k(s.tokensIn).padStart(8), k(s.tokensOut).padStart(8), s.costUsd.toFixed(3).padStart(7), ` ${s.source}`);
  }
  const t = r.total;
  console.log("TOTAL".padEnd(44), String(t.calls).padStart(5), String(t.failed).padStart(4), k(t.tokensIn).padStart(8), k(t.tokensOut).padStart(8), t.costUsd.toFixed(3).padStart(7));
  const secs = Object.entries(r.callSeconds).map(([t, v]) => `${t} ${v.toFixed(0)}`).join(", ");
  if (secs) console.log(`call-seconds by task: ${secs}`);
  if (r.unfinishedCalls) console.log(`calls started but never finished: ${r.unfinishedCalls}`);
  for (const key of ["cost first chat (billed USD)", "cost merge step (billed USD)", "cost whole run (billed USD)", "credits start", "credits after merge", "first chat review", "merge review", "merge diagnostics", "frames after first chat", "frames after merge"]) if (r.notes[key]) console.log(`${key}: ${String(r.notes[key]).slice(0, 160)}`);
}
