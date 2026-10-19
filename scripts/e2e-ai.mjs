#!/usr/bin/env node
/**
 * `npm run test:e2e:ai` — the AI end-to-end suite (`e2e/ai`) against a real
 * AI connection. Asks for explicit confirmation first, so you can sign in
 * (`copilot login`) or set a BYOK key before anything runs; then checks the
 * connection actually works (ai-preflight) and runs every AI spec in one go.
 *
 * Which connection: the first of these found real credentials for in
 * `.env.local` (same ACUTE_TEST_* variables the F36 contract suite reads) —
 * openai, anthropic, azure, gemini, openrouter, aicredits, neevcloud — else GitHub Copilot (the account signed
 * in to the Copilot CLI). This matches `e2e/aiProvider.ts`'s own resolution,
 * so the banner below always describes what will actually run.
 *
 *   npm run test:e2e:ai                       ask, then run all AI specs
 *   npm run test:e2e:ai -- --yes              skip the question (you've confirmed already)
 *   npm run test:e2e:ai -- -g "Summarize"     extra args go to Playwright
 *   npm run test:e2e:ai -- --provider=copilot force Copilot even if a BYOK key is configured
 *   npm run test:e2e:ai -- --provider=gemini  force one BYOK connection explicitly (openai, anthropic, azure, gemini, openrouter, aicredits, neevcloud)
 *   npm run test:e2e:ai -- --demo             watch it like a demo: headed, slowed actions, pauses and step captions
 *                                             (ACUTE_SLOWMO / ACUTE_SHOW_MS override the pace, in ms)
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";

const KNOWN_PROVIDERS = ["copilot", "openai", "anthropic", "azure", "gemini", "openrouter", "aicredits", "neevcloud"];
const BYOK_PRIORITY = ["openai", "anthropic", "azure", "gemini", "openrouter", "aicredits", "neevcloud"];
const PROVIDER_NAME = {
  copilot: "GitHub Copilot",
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Azure OpenAI / Foundry",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  aicredits: "AICredits",
  neevcloud: "NeevCloud",
};

/** Same tiny, dependency-free `.env.local` reader as `testEnv.ts` / `check-gemini-key.mjs`. */
function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const commentAt = value.indexOf(" #");
    if (commentAt >= 0) value = value.slice(0, commentAt);
    value = value.trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const PLACEHOLDER_PATTERN = /\.\.\.|<[^>]*>/;
const isReal = (value, minLen = 1) => Boolean(value) && value.length >= minLen && !PLACEHOLDER_PATTERN.test(value);

function hasByokCredentials(id) {
  const upper = id.toUpperCase();
  const apiKey = process.env[`ACUTE_TEST_${upper}_API_KEY`];
  const model = process.env[`ACUTE_TEST_${upper}_MODEL`];
  if (!isReal(apiKey, 15) || !isReal(model)) return false;
  if (id === "azure" && !isReal(process.env.ACUTE_TEST_AZURE_ENDPOINT)) return false;
  return true;
}

function autoDetectProvider() {
  loadEnvLocal();
  for (const id of BYOK_PRIORITY) if (hasByokCredentials(id)) return id;
  return "copilot";
}

const args = process.argv.slice(2);
const yes = args.includes("--yes") || args.includes("-y");
const providerArg = args.find((a) => a.startsWith("--provider="));
const requested = providerArg ? providerArg.slice("--provider=".length) : process.env.ACUTE_AI_PROVIDER;
const demo = args.includes("--demo");
const playwrightArgs = args.filter((a) => a !== "--yes" && a !== "-y" && a !== providerArg && a !== "--demo");
if (demo && !playwrightArgs.includes("--headed")) playwrightArgs.push("--headed");

if (requested && !KNOWN_PROVIDERS.includes(requested)) {
  console.error(`  Unknown --provider "${requested}" (use ${KNOWN_PROVIDERS.join(", ")}).\n`);
  process.exit(1);
}
const provider = requested ?? autoDetectProvider();
const byok = provider !== "copilot";

console.log(byok ? `
  Acute-Notes — AI end-to-end tests (e2e/ai) — ${PROVIDER_NAME[provider]}

  These tests send real requests to ${PROVIDER_NAME[provider]} with the key in
  .env.local (ACUTE_TEST_${provider.toUpperCase()}_API_KEY, model ACUTE_TEST_${provider.toUpperCase()}_MODEL).
  They are billed to that key and take a few minutes. The dev server is
  reused if it's running on :3000, otherwise started.
` : `
  Acute-Notes — AI end-to-end tests (e2e/ai)

  These tests send real requests to GitHub Copilot using the account signed in
  to the Copilot CLI on this machine. They use your Copilot subscription
  (premium requests) and take a few minutes.

  Before continuing:
    1. Sign in:  copilot login      (in another terminal, if you aren't already)
    2. The dev server is reused if it's running on :3000, otherwise started.
`);

if (!yes) {
  if (!process.stdin.isTTY) {
    console.error("  Not an interactive terminal — re-run with --yes to confirm.\n");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("  Signed in and ready to run the AI tests? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log("\n  Cancelled — no AI tests were run.\n");
    process.exit(1);
  }
}

console.log(`\n  Checking the ${byok ? `${PROVIDER_NAME[provider]} key` : "Copilot sign-in"}, then running the AI specs…\n`);
const child = spawn("npx", ["playwright", "test", "--project=ai", ...playwrightArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ACUTE_AI_E2E: "1", ACUTE_AI_PROVIDER: provider, ...(demo ? { ACUTE_DEMO: "1" } : {}) },
});
child.on("exit", (code) => process.exit(code ?? 1));
