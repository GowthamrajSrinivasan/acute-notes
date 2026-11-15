/**
 * The fifth unseen set (intelligent-update-engine-plan §12.30): the independent, sealed set for the Stage 4f semantic
 * gate. Its INPUTS are frozen (DATA-FREEZE.json) before any selector, rule, screen or model runs on them. This file checks
 * only shape and independence — it never runs the pipeline on unseen5 and never prints a statement. The reviewer's blind
 * labels and the code freeze (FREEZE.json) come next; until then nothing may route or score this set, and no
 * implementation may be tuned on it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const SET = join(DIR, "unseen5");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = <T,>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

/** Pinned here as well as in DATA-FREEZE.json, so a consistent edit to both still fails. */
const PINNED: Record<string, string> = {
  "pairs.json": "59bf2006c478bd3c9e20f9137a49e69a7c0bcf2f9f8c521cd8cd3d6ca1ea0546",
  "author-draft-key.json": "790072777b1882d112e7da57f4d2305dc95d1eadde7bd8956e2b32cde941c88f",
  "labelling-sheet.md": "698610d85e7fc87d4af0b13fd0995f348d23d639a52d65007f56ab7f28c9d4d1",
};

describe("unseen5 — frozen inputs (never routed or scored before the blind labels and the code freeze)", () => {
  it("the inputs and the freeze record are byte for byte what was frozen", () => {
    expect(sha(join(SET, "DATA-FREEZE.json"))).toBe("a57405e538e248e143e44f4ed71d39a5a53ea2e7e6a0fab95b366138bd10b579");
    expect(read<{ files: Record<string, string> }>(join(SET, "DATA-FREEZE.json")).files).toEqual(PINNED);
    for (const [file, hash] of Object.entries(PINNED)) expect(sha(join(SET, file)), file).toBe(hash);
  });

  it("shape: 90 pairs, y01–y90, 10 batches of 5 sharing their new statement, 40 single pairs, a draft for each", () => {
    const pairs = read<{ pairs: { id: string; a: string; b: string; batch?: string }[] }>(join(SET, "pairs.json")).pairs;
    expect(pairs.map((p) => p.id)).toEqual(Array.from({ length: 90 }, (_, i) => `y${String(i + 1).padStart(2, "0")}`));
    const batches = new Map<string, Set<string>>();
    for (const p of pairs) if (p.batch) batches.set(p.batch, (batches.get(p.batch) ?? new Set()).add(p.a));
    expect(batches.size).toBe(10);
    for (const [b, as] of batches) expect([b, as.size, pairs.filter((p) => p.batch === b).length]).toEqual([b, 1, 5]);
    expect(pairs.filter((p) => !p.batch).length).toBe(40);
    const drafts = read<{ drafts: Record<string, { label: string }> }>(join(SET, "author-draft-key.json")).drafts;
    expect(Object.keys(drafts).sort()).toEqual(pairs.map((p) => p.id).sort());
  });

  it("the labelling sheet is blind: every pair present, every label and reason cell empty", () => {
    const rows = readFileSync(join(SET, "labelling-sheet.md"), "utf8").split("\n").filter((l) => /^\|\s*y\d\d\s*\|/.test(l));
    expect(rows).toHaveLength(90);
    for (const r of rows) expect(r.split(/(?<!\\)\|/).map((c) => c.trim()).slice(-3, -1)).toEqual(["", ""]);
  });

  it("independence: no statement shares 60 % or more of its words with any earlier evaluation statement (ids only)", () => {
    const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const jaccard = (x: string, y: string) => {
      const a = words(x);
      const b = words(y);
      let n = 0;
      for (const w of a) if (b.has(w)) n++;
      return n / (a.size + b.size - n);
    };
    const mine = read<{ pairs: { id: string; a: string; b: string }[] }>(join(SET, "pairs.json")).pairs;
    const earlier = ["dev.json", "heldout.json", "regressions.json", "regressions-unseen1.json", "regressions-unseen3.json", "regressions-unseen4.json", "unseen/pairs.json", "unseen2/pairs.json", "unseen3/pairs.json", "unseen4/pairs.json"]
      .filter((f) => existsSync(join(DIR, f)))
      .flatMap((f) => read<{ pairs: { a: string; b: string }[] }>(join(DIR, f)).pairs.flatMap((p) => [p.a, p.b]));
    const near = mine.flatMap((p) => (["a", "b"] as const).filter((s) => earlier.some((e) => jaccard(p[s], e) >= 0.6)).map((s) => `${p.id}.${s}`));
    expect(near).toEqual([]);
  });

  it("the reference labels are frozen (2026-11-15, from the user, before the code freeze and the route step)", () => {
    expect(sha(join(SET, "labels.json"))).toBe("27ca948c741bac6ea332febd3213db4b3a7197d91adb2b13d0ba599a1a346841");
    const labels = read<{ blind: boolean; labels: Record<string, { label: string }> }>(join(SET, "labels.json"));
    expect(labels.blind).toBe(true);
    const counts: Record<string, number> = {};
    for (const { label } of Object.values(labels.labels)) counts[label] = (counts[label] ?? 0) + 1;
    expect(counts).toEqual({ contradiction: 40, compatible: 45, ambiguous: 5 });
  });

  it("the one approved recording (2026-11-16) and its route step are preserved byte for byte — never rerun, re-scored or overwritten (plan §12.33)", () => {
    const run = join(SET, "runs", "2026-11-15-unseen5");
    const outputs: [string, string][] = [
      ["calls.json", "4f6c1018aaecb81e18a1697a9ae786d97da2f22e8b6a4a840092a27dbc2f8d13"],
      ["envelope.json", "bee50e72fe76dcb78c920ffffcd0fe3451d6985ee0c3b30df02c4ddeee463ed0"],
      ["judgments.json", "5d4f9e0804e8fecf77bf23f97aab922844ffbd3524e98fba101e6598149b41b4"],
      ["pair-outcomes.json", "7ced4e142096f0ccad7490a0dc36b7ef7911d592cd2ed6ac5c169b188b3d3266"],
      ["report.md", "c32fae08e759e7f7100a33a9cb681e83619d0c6fda41088be7299f0f1af724a3"],
      ["routing.json", "3cb5a45e052b16cd90d3b912254e6c2cb07e3f630a90ff7219aa5530befafbd5"],
      ["routing.md", "9c41db8281b2d4188feaa4096815b443a1b5b4c785e1df6c5a90b3d0c8d20c1b"],
    ];
    for (const [f, h] of outputs) expect([f, sha(join(run, f))]).toEqual([f, h]);
  });

  it("the code freeze, its index and every byte copy are pinned (a consistent edit to FREEZE.json and a copy would otherwise pass)", () => {
    expect(sha(join(SET, "FREEZE.json"))).toBe("f22e11e983902f07e5434edb966d3c0fe723b98e313efe0fc89ea2d6db26ef77");
    expect(sha(join(SET, "frozen-code", "INDEX.json"))).toBe("85534519d0722f6b3b8b81dc20a71a2e5c340d5447008ef83734ea8ff62a2181");
    const freeze = read<{ files: Record<string, string> }>(join(SET, "FREEZE.json")).files;
    const index = read<{ files: Record<string, string> }>(join(SET, "frozen-code", "INDEX.json")).files;
    expect(Object.keys(freeze)).toHaveLength(22);
    for (const [f, h] of Object.entries(index)) {
      expect([f, h]).toEqual([f, freeze[f]]);
      expect([f, sha(join(SET, "frozen-code", `${f}.txt`))]).toEqual([f, h]);
    }
  });
});
