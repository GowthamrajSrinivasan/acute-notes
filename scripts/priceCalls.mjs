#!/usr/bin/env node
/**
 * Offline cost check for the chat-import benchmark (no network, no model): prices a saved call log with the benchmark spec's constants
 * (e2e/ai/chatShare.spec.ts: chat $0.30 in / $2.50 out per million tokens, Jev $0.042 per million input tokens, scale 0.8), so any
 * estimate can be checked before a run.
 *
 *   node scripts/priceCalls.mjs <stats.jsonl>                      price a saved run, by step and task
 *   node scripts/priceCalls.mjs <stats.jsonl> --what-if plan=0.75   scale one task's output tokens (e.g. plan replies 25 % smaller)
 *   node scripts/priceCalls.mjs --calls plan:27:4400:2600 --calls analysis:9:3000:640 --calls decide:116:6900:390
 *                                                                   price a hypothetical call table, task:count:inputTokens:outputTokens
 *
 * Everything printed is an ESTIMATE from provider-reported tokens at list prices (and list x scale). BILLED cost is only what the credits
 * balance showed (the log's "cost ... (billed USD)" notes, which lag by minutes); the script prints the billed-to-list ratio next to them.
 * Ratios seen so far: 0.786 in run 2 (incomplete: $0.3837 billed, $0.4882 at list), about 0.99 in run 3 ($0.4616 settled, about $0.466 at list).
 */
import { readFileSync } from "node:fs";

const PRICE = {
  chatIn: Number(process.env.CHAT_PRICE_IN ?? 0.3) / 1e6,
  chatOut: Number(process.env.CHAT_PRICE_OUT ?? 2.5) / 1e6,
  jevIn: Number(process.env.JEV_PRICE_IN ?? 0.042) / 1e6,
};
const SCALE = Number(process.env.COST_SCALE ?? 0.8);

const args = process.argv.slice(2);
const flag = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name) out.push(args[i + 1]);
  return out;
};
const file = args.find((a) => !a.startsWith("--") && a.endsWith(".jsonl"));
const whatIf = Object.fromEntries(flag("--what-if").map((w) => w.split("=")).map(([k, v]) => [k, Number(v)]));
const SHORT = { generate_visual_plan: "plan", generate_section_analysis: "analysis", outline_document: "outline", find_revisions: "revisions", decide: "decide" };

/** @type {{ step: string, task: string, n: number, input: number, output: number }[]} */
const rows = [];
const add = (step, task, n, input, output) => {
  const row = rows.find((r) => r.step === step && r.task === task) ?? rows[rows.push({ step, task, n: 0, input: 0, output: 0 }) - 1];
  row.n += n;
  row.input += input;
  row.output += output;
};

const notes = [];
if (file) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.note) notes.push(r);
    // One `step` record per finished call, with the provider-reported tokens.
    else if (r.step && typeof r.promptTokens === "number") add(r.step, SHORT[r.task] ?? r.task, 1, r.promptTokens, r.completionTokens ?? 0);
  }
}
for (const spec of flag("--calls")) {
  const [task, n, input, output] = spec.split(":");
  add("hypothetical", task, Number(n), Number(n) * Number(input), Number(n) * Number(output));
}
if (!rows.length) {
  console.error("Nothing to price: give a stats .jsonl file or --calls task:count:inputTokens:outputTokens");
  process.exit(1);
}

const list = (r) => (r.task === "decide" ? r.input * PRICE.jevIn : r.input * PRICE.chatIn + r.output * (whatIf[r.task] ?? 1) * PRICE.chatOut);
const usd = (x) => `$${x.toFixed(4)}`;
const total = { n: 0, input: 0, output: 0, list: 0 };
const byStep = new Map();
console.log(`ESTIMATE at list prices (chat ${PRICE.chatIn * 1e6}/${PRICE.chatOut * 1e6} per M, Jev ${PRICE.jevIn * 1e6} per M in), scale ${SCALE}${Object.keys(whatIf).length ? `, what-if output x ${JSON.stringify(whatIf)}` : ""}\n`);
console.log("step".padEnd(14) + "task".padEnd(11) + "calls".padStart(6) + "in tok".padStart(10) + "out tok".padStart(10) + "out/call".padStart(9) + "list".padStart(10) + `x${SCALE}`.padStart(10));
for (const r of rows) {
  const l = list(r);
  total.n += r.n;
  total.input += r.input;
  total.output += r.output;
  total.list += l;
  byStep.set(r.step, (byStep.get(r.step) ?? 0) + l);
  console.log(r.step.padEnd(14) + r.task.padEnd(11) + String(r.n).padStart(6) + String(r.input).padStart(10) + String(r.output).padStart(10) + String(Math.round(r.output / r.n)).padStart(9) + usd(l).padStart(10) + usd(l * SCALE).padStart(10));
}
console.log("-".repeat(70));
console.log("total".padEnd(25) + String(total.n).padStart(6) + String(total.input).padStart(10) + String(total.output).padStart(10) + "".padStart(9) + usd(total.list).padStart(10) + usd(total.list * SCALE).padStart(10));
for (const [step, l] of byStep) console.log(`  ${step}: list ${usd(l)}, x${SCALE} ${usd(l * SCALE)}`);

// Billed cost (credits balance), where the log has it, against the list price of the same step: a ratio, not a price.
const billed = notes.filter((n) => /billed USD/.test(n.note));
if (billed.length) {
  console.log("\nBILLED (credits delta, lags by minutes; per-step splits are unreliable, the whole-run figure is the one to trust):");
  for (const n of billed) console.log(`  ${n.note}: ${String(n.description)}`);
  const whole = billed.find((n) => /whole run/.test(n.note));
  if (whole && byStep.size) console.log(`  billed / list for the whole run: ${(Number(whole.description) / total.list).toFixed(2)}  (list ${usd(total.list)}; seen before: 0.786 in run 2, about 0.99 in run 3)`);
}
const settled = flag("--settled")[0];
if (settled) console.log(`  billed (settled balance, you gave it) / list: ${(Number(settled) / total.list).toFixed(2)}  (list ${usd(total.list)})`);
