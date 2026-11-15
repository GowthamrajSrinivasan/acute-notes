/**
 * Stage 4a (intelligent-update-engine-plan §12.10 checkpoint 1): every accepted-content path uses the shared commit.
 * Writing an accepted change set means calling `acceptChangeSet` or `acceptParts`; only `commit.ts` may — everything else
 * goes through `commitChangeSet` / `commitParts` (on the live canvas, `components/ai/commitOnCanvas.ts`), so every write
 * is journalled, idempotent and followed by the index sync.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const rel = (p: string) => p.split("/").join(sep);
/** Files allowed to call them, and why. */
const ALLOWED: Record<string, string> = {
  [rel("ai/changes/commit.ts")]: "the shared commit itself",
  [rel("testUtils/repoMapWorld.ts")]: "test-only: the Repo Map test world's fake canvas writes accepted parts as the app's canvas would",
};
// A call, not a method of a port (`live.acceptParts(…)` is the canvas port, implemented with the shared commit).
const WRITE_CALL = /(?<![.\w])(acceptChangeSet|acceptParts)\s*\(/;
const DEFINITION = /export function (acceptChangeSet|acceptParts)\s*\(/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(DEFINITION, "");

describe("every accepted-content path uses the shared commit (Stage 4a)", () => {
  const files = sources(SRC).map((f) => ({ path: relative(SRC, f), code: code(f) }));

  it("only commit.ts writes an accepted change set", () => {
    expect(files.filter((f) => !(f.path in ALLOWED) && WRITE_CALL.test(f.code)).map((f) => f.path)).toEqual([]);
  });

  it("the live canvas's accept paths call the shared commit", () => {
    const callers = files.filter((f) => /\bcommit(SetOnCanvas|PartsOnCanvas)\s*\(/.test(f.code)).map((f) => f.path).sort();
    expect(callers).toEqual(
      [rel("components/ai/acceptPending.ts"), rel("components/ai/commitOnCanvas.ts"), rel("components/openui/notes/promote.ts"), rel("components/review/knowledgeActions.ts")].sort(),
    );
  });
});
