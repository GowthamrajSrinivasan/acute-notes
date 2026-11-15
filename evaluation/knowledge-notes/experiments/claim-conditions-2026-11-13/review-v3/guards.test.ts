// Keeps the experimental claim-condition code out of production (user decisions 2026-11-14).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const EXPERIMENT = join(import.meta.dirname, "..");

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(n)) out.push(p);
  }
  return out;
}

describe("claim-condition experiment isolation", () => {
  it("nothing under src/ imports from evaluation/knowledge-notes/experiments", () => {
    const offenders = files(join(ROOT, "src")).filter((f) => /from\s+["'][^"']*experiments\//.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
  it("remapRecord (known lineage defect) is imported only inside this experiment", () => {
    const outside = [...files(join(ROOT, "src")), ...files(join(ROOT, "evaluation"))]
      .filter((f) => !f.startsWith(EXPERIMENT + sep))
      // Imports or calls only; a comment or test title naming it (e.g. Study's "unlike remapRecord") is fine.
      .filter((f) => /import\s[^;]*\bremapRecord\b|\bremapRecord\s*\(/.test(readFileSync(f, "utf8")));
    expect(outside.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
