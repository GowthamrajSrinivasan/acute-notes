/**
 * Standing invariant (PRD §21, tracker §1): no provider/vendor name, SDK
 * import, or `if (provider === ...)` branch may exist outside
 * `src/ai/providers/`, `src/ai/host/`, and `src/ai/contractTests/` (F36's
 * validation suite legitimately names every connection it tests — that's
 * its whole job, the same reason `providers/` is allowed). This guards
 * every future feature — it should still pass once a 7th connection is added.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const AI_DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(AI_DIR, "..");
// import/chatShare reads shared-chat links (whose hosts name the chat product); it is not an AI connection.
const ALLOWED_DIRS = [join(AI_DIR, "providers") + sep, join(AI_DIR, "host") + sep, join(AI_DIR, "contractTests") + sep, join(AI_DIR, "import", "chatShare") + sep];

const VENDOR_PATTERNS: readonly RegExp[] = [
  /@github\/copilot-sdk/,
  /@anthropic-ai\//,
  /@google\/genai/,
  /\bopenai\b/i,
  /\bollama\b/i,
  /provider\s*===\s*["'`]/,
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function isAllowed(file: string): boolean {
  return ALLOWED_DIRS.some((dir) => file.startsWith(dir));
}

describe("no vendor leakage outside src/ai/providers and src/ai/host", () => {
  it("finds no vendor SDK reference or provider-name branch elsewhere in src/", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      if (isAllowed(file)) continue;
      const content = readFileSync(file, "utf8");
      for (const pattern of VENDOR_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(`${relative(SRC_ROOT, file)} matches ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
