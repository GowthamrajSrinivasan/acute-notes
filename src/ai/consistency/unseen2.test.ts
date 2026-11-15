/**
 * The second unseen evaluation set (plan §12.19): code frozen before the set existed; pairs by a separate author who never
 * saw the rules; the reviewer labels them blind. Text checks only — this file never runs the rules, the selector or a model
 * on these pairs (the recorder does, once each step: `consistencyUnseen.contract.test.ts` with CONSISTENCY_UNSEEN_SET=unseen2).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DIR = join(ROOT, "evaluation/update-engine/consistency");
const SET = join(DIR, "unseen2");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const freeze = JSON.parse(readFileSync(join(SET, "FREEZE.json"), "utf8")) as { files: Record<string, string> };
const hasPairs = existsSync(join(SET, "pairs.json"));

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const jaccard = (x: Set<string>, y: Set<string>) => [...x].filter((w) => y.has(w)).length / new Set([...x, ...y]).size;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

describe("§12.19 — the second unseen set", () => {
  it("its data stays frozen: pairs, draft key, labels (the code hashes in FREEZE.json record what the 2026-11-13 recording ran; the code has moved on since, §12.21)", () => {
    const data = Object.entries(freeze.files).filter(([file]) => file.startsWith("evaluation/"));
    expect(data.map(([f]) => f.split("/").pop()).sort()).toEqual(["author-draft-key.json", "labels.json", "pairs.json"]);
    for (const [file, hash] of data) expect(sha(join(ROOT, file)), file).toBe(hash);
  });

  it.skipIf(!hasPairs)("statements only in the file the selector and the model read", () => {
    const pairs = (JSON.parse(readFileSync(join(SET, "pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string }[] }).pairs;
    expect(pairs.length).toBeGreaterThanOrEqual(50);
    for (const p of pairs) expect(Object.keys(p).sort()).toEqual(["a", "b", "id"]);
  });

  it.skipIf(!hasPairs)("no overlap with the fixtures that existed when it was written (earlier sets, the first unseen set, its regressions, the probes of that time); later probes may draw on it — it is regression evidence now (§12.21)", () => {
    const pairs = (JSON.parse(readFileSync(join(SET, "pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string }[] }).pairs;
    const old: string[] = [];
    for (const f of ["dev.json", "heldout.json", "regressions.json", "regressions-unseen1.json", "unseen/pairs.json"]) for (const p of (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { pairs: { a: string; b: string }[] }).pairs) old.push(p.a, p.b);
    for (const f of ["candidates.test.ts", "judge.test.ts", "check.test.ts", "store.test.ts", "regressionsUnseen1.test.ts"]) old.push(...(readFileSync(join(ROOT, "src/ai/consistency", f), "utf8").match(/"[A-Z][^"]{12,}\."/g) ?? []).map((s) => s.slice(1, -1)));
    old.push(...(readFileSync(join(ROOT, "e2e/local/consistency.local.spec.ts"), "utf8").match(/"[A-Z][^"]{12,}\."/g) ?? []).map((s) => s.slice(1, -1)));
    const oldNorm = new Set(old.map(norm));
    const oldWords = old.map(words);
    const clashes: string[] = [];
    for (const p of pairs)
      for (const s of [p.a, p.b]) {
        if (oldNorm.has(norm(s))) clashes.push(`${p.id}: same sentence "${s}"`);
        const close = oldWords.findIndex((o) => jaccard(words(s), o) >= 0.6);
        if (close >= 0) clashes.push(`${p.id}: "${s}" ≈ "${old[close]}"`);
      }
    expect(clashes).toEqual([]);
  });

  it.skipIf(!existsSync(join(SET, "labels.json")))("the reviewer's labels: blind, every pair, ≥ 20 contradiction and ≥ 20 compatible", () => {
    const pairs = (JSON.parse(readFileSync(join(SET, "pairs.json"), "utf8")) as { pairs: { id: string }[] }).pairs;
    const labels = JSON.parse(readFileSync(join(SET, "labels.json"), "utf8")) as { blind: boolean; labels: Record<string, { label: string }> };
    expect(labels.blind).toBe(true);
    expect(Object.keys(labels.labels).sort()).toEqual(pairs.map((p) => p.id).sort());
    const n = (l: string) => Object.values(labels.labels).filter((x) => x.label === l).length;
    expect(n("contradiction")).toBeGreaterThanOrEqual(20);
    expect(n("compatible")).toBeGreaterThanOrEqual(20);
  });
});
