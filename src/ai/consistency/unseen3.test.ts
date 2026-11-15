/**
 * The third unseen evaluation set (plan §12.21): code frozen before the set existed; pairs by a separate author who never
 * saw the rules; the reviewer labels them blind. Text checks only — this file never runs the rules, the selector or a model
 * on these pairs (the recorder does, once each step: `consistencyUnseen.contract.test.ts` with CONSISTENCY_UNSEEN_SET=unseen3).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DIR = join(ROOT, "evaluation/update-engine/consistency");
const SET = join(DIR, "unseen3");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const freeze = (existsSync(join(SET, "FREEZE.json")) ? JSON.parse(readFileSync(join(SET, "FREEZE.json"), "utf8")) : { files: {} }) as { files: Record<string, string> };
const hasPairs = existsSync(join(SET, "pairs.json"));

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const jaccard = (x: Set<string>, y: Set<string>) => [...x].filter((w) => y.has(w)).length / new Set([...x, ...y]).size;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

describe("§12.21 — the third unseen set", () => {
  it("its data stays frozen: pairs, draft key, labels (the recording is done, §12.22)", () => {
    const data = Object.entries(freeze.files).filter(([file]) => file.startsWith("evaluation/"));
    expect(data.map(([f]) => f.split("/").pop()).sort()).toEqual(["author-draft-key.json", "labels.json", "pairs.json"]);
    for (const [file, hash] of data) expect(sha(join(ROOT, file)), file).toBe(hash);
  });

  it("the code the recording ran is preserved byte for byte in frozen-code/ (the live code has moved on since, §12.23)", () => {
    const code = Object.entries(freeze.files).filter(([file]) => file.startsWith("src/"));
    expect(code.length).toBe(12);
    for (const [file, hash] of code) expect(sha(join(SET, "frozen-code", `${file}.txt`)), file).toBe(hash);
  });

  it("the freeze record itself, the frozen-code index and the routing report are pinned (§12.24 review: a consistent edit to FREEZE.json and a copy would otherwise pass)", () => {
    const pins: [string, string][] = [
      ["FREEZE.json", "05a0345ddaaf317a6175fe487d39c799beae21dc6e9b6fe71e788cf6b4f1abb8"],
      ["frozen-code/INDEX.json", "7bc31d62e7e059de3f11a29de925d5b024ed65ded408c0efe2929084a0867edd"],
      ["runs/2026-11-14-unseen3/routing.md", "86b247a34c7ea364c700298c04761c63a34f80c5bf3ac52d29ceb3e0925ac47e"],
    ];
    for (const [file, hash] of pins) expect(sha(join(SET, file)), file).toBe(hash);
  });

  it.skipIf(!hasPairs)("statements only in the file the selector and the model read", () => {
    const pairs = (JSON.parse(readFileSync(join(SET, "pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string; batch?: string }[] }).pairs;
    expect(pairs.length).toBeGreaterThanOrEqual(80);
    expect(pairs.length).toBeLessThanOrEqual(100);
    for (const p of pairs) expect(Object.keys(p).filter((k) => k !== "batch").sort()).toEqual(["a", "b", "id"]);
    // A batch: one new statement (the same `a`) against several existing ones.
    const batches = new Map<string, { a: string }[]>();
    for (const p of pairs) if (p.batch) batches.set(p.batch, [...(batches.get(p.batch) ?? []), p]);
    expect(batches.size).toBeGreaterThanOrEqual(6);
    for (const [, ps] of batches) {
      expect(ps.length).toBeGreaterThanOrEqual(4);
      expect(new Set(ps.map((p) => p.a)).size).toBe(1);
    }
  });

  it.skipIf(!hasPairs)("no overlap with the fixtures that existed when it was written (dev, held-out, regressions, both earlier unseen sets): no shared sentence, no near-duplicate (word Jaccard ≥ 0.6). Test probes were checked too at the time; later probes may draw on it — it is regression evidence now (§12.23)", () => {
    const pairs = (JSON.parse(readFileSync(join(SET, "pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string }[] }).pairs;
    const old: string[] = [];
    for (const f of ["dev.json", "heldout.json", "regressions.json", "regressions-unseen1.json", "unseen/pairs.json", "unseen2/pairs.json"]) for (const p of (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { pairs: { a: string; b: string }[] }).pairs) old.push(p.a, p.b);
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
