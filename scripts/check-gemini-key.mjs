#!/usr/bin/env node
/**
 * Quick standalone check that ACUTE_TEST_GEMINI_API_KEY in .env.local is a
 * working Gemini key. Hits Gemini's OpenAI-compatibility endpoint directly
 * (see src/ai/providers/registry.ts) — no app code involved.
 *
 *   node scripts/check-gemini-key.mjs
 *
 * Note: Gemini returns HTTP 400 (not 401) for a bad key, so a 400 here
 * almost always means the key/model is wrong, not a malformed request.
 */
import { readFileSync } from "node:fs";

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

loadEnvLocal();

const apiKey = process.env.ACUTE_TEST_GEMINI_API_KEY;
const model = process.env.ACUTE_TEST_GEMINI_MODEL || "gemini-3.5-flash";
const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

if (!apiKey || apiKey.includes("...")) {
  console.error("ACUTE_TEST_GEMINI_API_KEY is missing or looks like a placeholder in .env.local");
  process.exit(1);
}

console.log(`Checking Gemini key against model "${model}"...`);

try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly the single word: OK" }],
      max_tokens: 5,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`);
    console.error(bodyText);
    if (bodyText.includes("unexpected model name format")) {
      console.error(
        `\nHint: this usually means ACUTE_TEST_GEMINI_MODEL is malformed (currently "${model}") — ` +
          `check for spaces where there should be hyphens, e.g. "gemini-3.5-flash".`,
      );
    } else if (res.status === 400) {
      console.error("\nNote: Gemini returns HTTP 400 (not 401) for a bad API key too — check the key itself if the model name looks fine.");
    }
    process.exit(1);
  }

  const data = JSON.parse(bodyText);
  const reply = data.choices?.[0]?.message?.content ?? "(no content in response)";
  console.log(`Success — model replied: ${reply.trim()}`);
} catch (err) {
  console.error("Request errored:", err instanceof Error ? err.message : err);
  process.exit(1);
}
