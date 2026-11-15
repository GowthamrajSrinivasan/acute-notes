/**
 * The fourth unseen set (intelligent-update-engine-plan §12.25). Its INPUTS are frozen (DATA-FREEZE.json) before any
 * selector, rule, screen or model runs on them. This file checks only shape and independence — it never runs the
 * pipeline on unseen4 and never prints a statement. The code freeze (FREEZE.json) and the reviewer's blind labels come
 * later; until then nothing may score this set.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const SET = join(DIR, "unseen4");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const read = <T,>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

/** Pinned here as well as in DATA-FREEZE.json, so a consistent edit to both still fails. */
const PINNED: Record<string, string> = {
  "pairs.json": "74c67f86190e1b863c865a70a1fec018667f1647a11c8ec8ba34113a9c05be7c",
  "author-draft-key.json": "c515545b25e4ab57093c68b5ec650a5c13ea89ffc3dae4e1d7ad7b9747e969c1",
  "labelling-sheet.md": "ad3ac71ccc4bc4db9e8d7b99cfc9d94ce4126f7c62b558b04460132bf23eb93f",
};

describe("unseen4 — frozen inputs (never scored before the code freeze and the blind labels)", () => {
  it("the inputs are byte for byte what was frozen", () => {
    const freeze = read<{ files: Record<string, string> }>(join(SET, "DATA-FREEZE.json"));
    expect(freeze.files).toEqual(PINNED);
    for (const [file, hash] of Object.entries(PINNED)) expect(sha(join(SET, file)), file).toBe(hash);
  });

  it("shape: 90 pairs, x01–x90, 10 batches of 5 sharing their new statement, 40 single pairs, a draft for each", () => {
    const pairs = read<{ pairs: { id: string; a: string; b: string; batch?: string }[] }>(join(SET, "pairs.json")).pairs;
    expect(pairs.map((p) => p.id).sort()).toEqual(Array.from({ length: 90 }, (_, i) => `x${String(i + 1).padStart(2, "0")}`));
    const batches = new Map<string, Set<string>>();
    for (const p of pairs) if (p.batch) batches.set(p.batch, (batches.get(p.batch) ?? new Set()).add(p.a));
    expect(batches.size).toBe(10);
    for (const [b, as] of batches) expect([b, as.size, pairs.filter((p) => p.batch === b).length]).toEqual([b, 1, 5]);
    expect(pairs.filter((p) => !p.batch).length).toBe(40);
    const drafts = read<{ drafts: Record<string, { label: string; category: string }> }>(join(SET, "author-draft-key.json")).drafts;
    expect(Object.keys(drafts).sort()).toEqual(pairs.map((p) => p.id).sort());
  });

  it("independence: no statement shares 60 % or more of its words with any earlier evaluation statement", () => {
    const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const jaccard = (x: string, y: string) => {
      const a = words(x);
      const b = words(y);
      let n = 0;
      for (const w of a) if (b.has(w)) n++;
      return n / (a.size + b.size - n);
    };
    const mine = read<{ pairs: { id: string; a: string; b: string }[] }>(join(SET, "pairs.json")).pairs;
    const earlier = ["dev.json", "heldout.json", "regressions.json", "regressions-unseen1.json", "regressions-unseen3.json", "unseen/pairs.json", "unseen2/pairs.json", "unseen3/pairs.json"]
      .filter((f) => existsSync(join(DIR, f)))
      .flatMap((f) => read<{ pairs: { a: string; b: string }[] }>(join(DIR, f)).pairs.flatMap((p) => [p.a, p.b]));
    const near = mine.flatMap((p) => (["a", "b"] as const).filter((s) => earlier.some((e) => jaccard(p[s], e) >= 0.6)).map((s) => `${p.id}.${s}`));
    expect(near).toEqual([]); // ids only — statements are never printed
  });

  it("the code the recording ran is preserved byte for byte in frozen-code/; the frozen inputs and labels are unchanged (the live code has moved on since, §12.27)", () => {
    const root = join(DIR, "../../..");
    const freeze = read<{ files: Record<string, string> }>(join(SET, "FREEZE.json"));
    expect(sha(join(SET, "FREEZE.json"))).toBe("d5bfb18601c5e9553e0159c624a78001ba7ca91d811799bac0994abefaafcd36");
    const code = Object.entries(freeze.files).filter(([f]) => f.startsWith("src/"));
    expect(code.length).toBe(18);
    // After the recording (2026-11-15) the live code may change; the history is the byte copies.
    for (const [f, h] of code) expect([f, sha(join(SET, "frozen-code", `${f}.txt`))]).toEqual([f, h]);
    for (const [f, h] of Object.entries(freeze.files).filter(([g]) => !g.startsWith("src/"))) expect([f, sha(join(root, f))]).toEqual([f, h]);
    const index = read<{ files: Record<string, string> }>(join(SET, "frozen-code", "INDEX.json")).files;
    expect(Object.keys(index).sort()).toEqual(code.map(([f]) => f).sort());
  });

  it("the reviewer's blind labels are frozen: 90, given blind, in FREEZE.json (2026-11-15, before the route step)", () => {
    const labels = read<{ blind: boolean; labels: Record<string, { label: string }> }>(join(SET, "labels.json"));
    expect(labels.blind).toBe(true);
    expect(Object.keys(labels.labels).length).toBe(90);
    const counts: Record<string, number> = {};
    for (const v of Object.values(labels.labels)) counts[v.label] = (counts[v.label] ?? 0) + 1;
    expect(counts).toEqual({ contradiction: 38, compatible: 44, ambiguous: 8 });
    const freeze = read<{ files: Record<string, string> }>(join(SET, "FREEZE.json"));
    expect(freeze.files["evaluation/update-engine/consistency/unseen4/labels.json"]).toBe(sha(join(SET, "labels.json")));
  });

  it("the one approved recording (2026-11-15) is preserved byte for byte — never rerun, re-scored or overwritten (plan §12.26)", () => {
    expect(readdirSync(join(SET, "runs"))).toEqual(["2026-11-15-unseen4"]);
    const pins: Record<string, string> = {
      "calls.json": "aa54cab3859722737278ec4a4892632bddcc53ab031c6c1b1ca658e6ccd8b76f",
      "judgments.json": "f65a735c4404dcd9c6a0f1d328b0853237a5742c6cb2e60be395e33a765ef7e2",
      "pair-outcomes.json": "8742e70bc7b8a4854851fcf5865f75071a0ae6e4857013391d5a4d4e18f6e123",
      "report.md": "83907261ccd88996f6e0f77127bffbfdcbfbd889fd718c2da85cf474cac6a172",
      "routing.json": "b2b5ba4b1ad7b799d5cf74d20c766f69a25b9d4072d876696218db7871f76ac2",
      "routing.md": "ebff57d86d4e641ac11ad4a6ea5ab61f8cd47e3fecf0008b6d8384bac35dc362",
    };
    const dir = join(SET, "runs", "2026-11-15-unseen4");
    expect(readdirSync(dir).sort()).toEqual(Object.keys(pins).sort());
    for (const [f, h] of Object.entries(pins)) expect(sha(join(dir, f)), f).toBe(h);
  });
});
