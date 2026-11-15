#!/usr/bin/env node
/**
 * Phase 1 benchmark SCAFFOLD (`.ai/docs/open-intelligent-ui-audit.md` §7 step 5) — "benchmark the same imports
 * against existing JSON generation." This script makes **no model calls**: it has no API key wiring and no
 * provider import, by design, so it cannot be used to accidentally spend money.
 *
 * What it measures today, offline:
 *   1. The OpenUI system prompt's own size for `acuteCardLibrary` (real, measurable instruction overhead).
 *   2. A structural-size proxy for "today's path": the golden dataset's recorded `canvas.json` for the same
 *      case, as a stand-in for the JSON-shaped card output `generate_visual_plan` produces (§13.15.11: most
 *      providers have no native structured output, so this shape lives in the prompt/completion text today).
 *      This is NOT a live model trace — it's the hand-authored golden reference, used only for a size proxy.
 *
 * What it does NOT measure (needs a live run, needs explicit go-ahead first — see the audit, §7 step 5):
 *   - Actual completion tokens an LLM spends emitting OpenUI Lang for a real import, vs. today's JSON-shaped
 *     VisualPlan completion, for the *same* input. That is the real comparison the acceptance criterion asks
 *     for, and it requires calling a configured provider through the task runtime.
 *
 * Tokens are estimated as characters / 4, matching `scripts/ai-stats-summary.mjs`'s convention (provider-reported
 * usage is always preferred over this estimate when one exists).
 *
 * Imports a .tsx module, so it needs Vite's transform — run it with vite-node (already a vitest dependency), not
 * plain `node`:
 *
 *   npx vite-node scripts/openui-benchmark.mjs [case-dir] [--run]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHARS_PER_TOKEN = 4;
const DEFAULT_CASE = "evaluation/knowledge-notes/cases/kn-01-idempotency-keys";

const args = process.argv.slice(2);
if (args.includes("--run")) {
  console.error(
    "Not implemented. Measuring real generation tokens needs a live model call, which this repo's policy requires " +
      "explicit per-turn approval for (see .ai/docs/open-intelligent-ui-audit.md §7 step 5). Run it manually once " +
      "approved, through the existing eval harness, not this script.",
  );
  process.exit(1);
}

const caseDir = args.find((a) => !a.startsWith("--")) ?? DEFAULT_CASE;
const tokens = (text) => Math.round(text.length / CHARS_PER_TOKEN);

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const { acuteCardSystemPrompt } = await import("../src/ai/openui/library.tsx");

  const prompt = acuteCardSystemPrompt();
  console.log(`OpenUI system prompt (acuteCardLibrary): ${prompt.length} chars, ~${tokens(prompt)} tokens`);

  const canvasPath = join(caseDir, "canvas.json");
  const canvas = loadJson(canvasPath);
  if (!canvas) {
    console.log(`\nNo canvas.json at ${canvasPath} — skipping the structural-size proxy.`);
    return;
  }
  const canvasText = JSON.stringify(canvas);
  console.log(
    `\n"Today" structural proxy (${canvasPath}): ${canvasText.length} chars, ~${tokens(canvasText)} tokens ` +
      "(golden reference, not a live completion — size proxy only)",
  );
  console.log(
    "\nThis is instruction overhead + structural size only, not a cost comparison. The actual A/B — completion " +
      "tokens for the same import through today's path vs. an OpenUI Lang path — needs a live run (see header).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
