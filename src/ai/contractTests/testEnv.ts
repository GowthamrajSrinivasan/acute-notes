/**
 * Loads `.env.local` (once) so the F36 contract-test suite can see real
 * provider credentials — Next.js already does this for the app itself, but
 * vitest does not. Deliberately minimal (no `dotenv` dependency): this repo
 * has no other need for a general `.env` parser, just `KEY=value` lines
 * with an optional trailing ` #comment`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

function loadEnvLocal(): void {
  if (loaded) return;
  loaded = true;
  let content: string;
  try {
    content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
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

export type ByokConnectionId = "openai" | "anthropic" | "azure" | "gemini" | "openrouter" | "aicredits" | "neevcloud";

export interface ByokTestCredentials {
  apiKey: string;
  model: string;
  endpoint?: string;
}

interface EnvKeys {
  apiKey: string;
  model: string;
  endpoint?: string;
}

const ENV_KEYS: Record<ByokConnectionId, EnvKeys> = {
  openai: { apiKey: "ACUTE_TEST_OPENAI_API_KEY", model: "ACUTE_TEST_OPENAI_MODEL" },
  anthropic: { apiKey: "ACUTE_TEST_ANTHROPIC_API_KEY", model: "ACUTE_TEST_ANTHROPIC_MODEL" },
  azure: { apiKey: "ACUTE_TEST_AZURE_API_KEY", model: "ACUTE_TEST_AZURE_MODEL", endpoint: "ACUTE_TEST_AZURE_ENDPOINT" },
  gemini: { apiKey: "ACUTE_TEST_GEMINI_API_KEY", model: "ACUTE_TEST_GEMINI_MODEL" },
  // Any model, any vendor, through one OpenAI-compatible endpoint (https://openrouter.ai/api/v1) — the model
  // string picks the underlying provider (e.g. "anthropic/claude-sonnet-4.5", "openai/gpt-5").
  openrouter: { apiKey: "ACUTE_TEST_OPENROUTER_API_KEY", model: "ACUTE_TEST_OPENROUTER_MODEL" },
  aicredits: { apiKey: "ACUTE_TEST_AICREDITS_API_KEY", model: "ACUTE_TEST_AICREDITS_MODEL" },
  // The model id is an account-specific deployment, not a universal name (see registry.ts) — still just a plain
  // env var, same mechanism as every other BYOK connection.
  neevcloud: { apiKey: "ACUTE_TEST_NEEVCLOUD_API_KEY", model: "ACUTE_TEST_NEEVCLOUD_MODEL" },
};

const PLACEHOLDER_PATTERN = /\.\.\.|<[^>]*>/;

/** Real API keys are always long; a placeholder ("sk-...", "...") is not. */
function isRealApiKey(value: string | undefined): boolean {
  return Boolean(value) && value!.length >= 15 && !PLACEHOLDER_PATTERN.test(value!);
}

/** Model/endpoint values can legitimately be short (e.g. a deployment name) — only filter obvious placeholder markers. */
function isRealText(value: string | undefined): boolean {
  return Boolean(value) && !PLACEHOLDER_PATTERN.test(value!);
}

/** `null` when this connection has no real (non-placeholder) test credentials — the caller should skip it, never fail it. */
export function getByokCredentials(id: ByokConnectionId): ByokTestCredentials | null {
  loadEnvLocal();
  const keys = ENV_KEYS[id];
  const apiKey = process.env[keys.apiKey];
  const model = process.env[keys.model];
  const endpoint = keys.endpoint ? process.env[keys.endpoint] : undefined;

  if (!isRealApiKey(apiKey)) return null;
  if (!isRealText(model)) return null;
  if (keys.endpoint && !isRealText(endpoint)) return null;

  return { apiKey: apiKey!, model: model!, endpoint };
}
