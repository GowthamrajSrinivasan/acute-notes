/**
 * The unseen evaluation set (plan §12.16): frozen, and genuinely new. Text checks only — this file never runs the rules,
 * the selector or a model on the unseen pairs (the selector runs once, after the labels are frozen; the classifier once,
 * after approval: `src/ai/contractTests/consistencyUnseen.contract.test.ts`).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const DIR = join(ROOT, "evaluation/update-engine/consistency");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const freeze = JSON.parse(readFileSync(join(DIR, "unseen/FREEZE.json"), "utf8")) as { files: Record<string, string> };
const unseen = (JSON.parse(readFileSync(join(DIR, "unseen/pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string }[] }).pairs;

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const jaccard = (x: Set<string>, y: Set<string>) => [...x].filter((w) => y.has(w)).length / new Set([...x, ...y]).size;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

describe("§12.16 — the unseen set", () => {
  it("its data stays frozen: the pairs, the draft key and the reviewer's labels (the code hashes in FREEZE.json are a record of what the 2026-11-13 recording ran; the code has moved on since, §12.19)", () => {
    const data = Object.entries(freeze.files).filter(([file]) => file.startsWith("evaluation/"));
    expect(data.map(([f]) => f.split("/").pop()).sort()).toEqual(["author-draft-key.json", "labels.json", "pairs.json"]);
    for (const [file, hash] of data) expect(sha(join(ROOT, file)), file).toBe(hash);
  });

  it("36 pairs, no labels or categories in the file the selector and the model read", () => {
    expect(unseen.length).toBe(36);
    for (const p of unseen) expect(Object.keys(p).sort()).toEqual(["a", "b", "id"]);
  });

  it("no overlap with the fixtures that existed when it was written (dev, held-out, regressions): no shared sentence, no near-duplicate (word Jaccard ≥ 0.6). Test probes written later may draw on it: it is regression evidence now (§12.19)", () => {
    const old: string[] = [];
    for (const f of ["dev.json", "heldout.json", "regressions.json"]) for (const p of (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { pairs: { a: string; b: string }[] }).pairs) old.push(p.a, p.b);
    const oldNorm = new Set(old.map(norm));
    const oldWords = old.map(words);
    const clashes: string[] = [];
    for (const p of unseen)
      for (const s of [p.a, p.b]) {
        if (oldNorm.has(norm(s))) clashes.push(`${p.id}: same sentence "${s}"`);
        const w = words(s);
        const close = oldWords.findIndex((o) => jaccard(w, o) >= 0.6);
        if (close >= 0) clashes.push(`${p.id}: "${s}" ≈ "${old[close]}"`);
      }
    expect(clashes).toEqual([]);
  });
});
