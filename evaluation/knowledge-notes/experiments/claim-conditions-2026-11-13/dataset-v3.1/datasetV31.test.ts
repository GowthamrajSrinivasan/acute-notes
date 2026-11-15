// Offline checks for dataset v3.1-pre (migrate.mjs). No AI calls. Never reads phase4/sealed/ beyond MANIFEST.json.
// Run: npx vitest run --config vitest.evaluation.config.ts evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/dataset-v3.1
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { validateClauseRecordV31, type ClauseRecordV31 } from "../review-v3/attachmentSchema";
// @ts-expect-error untyped .mjs helper
import { build, verifyFreezeV3 } from "./migrate.mjs";

const HERE = import.meta.dirname;
const EXP = join(HERE, "..");
const P4 = join(EXP, "phase4");
const HR = join(EXP, "review-v3", "human-review");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

type Rec = ClauseRecordV31 & {
  case: string; status: string; flags: string[];
  links: (ClauseRecordV31["links"][number] & { linkStatus?: string })[];
  provenance: { v3: { id: string }[]; human?: { item: string } };
};
type V3 = { case: string; id: string; verdict: string; claimUnits: string[]; units: string[]; clause: string };

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) filesUnder(p, out);
    else out.push(p);
  }
  return out;
}

const v3: V3[] = readdirSync(join(P4, "adjudicated")).sort().flatMap((f) => {
  const d = readJson(join(P4, "adjudicated", f));
  return d.records.map((r: V3) => ({ ...r, case: d.caseId }));
});
const recs: Rec[] = readdirSync(join(HERE, "records")).sort().flatMap((f) => readJson(join(HERE, "records", f)).records);
const log = readJson(join(HERE, "MIGRATION-LOG.json"));
const key: { item: string; case: string; id: string; verdict: string }[] = readJson(join(HR, "SAMPLE-KEY.json"));
const answers = (f: string) => Object.fromEntries(readJson(join(HR, f)).answers.map((a: { item: string }) => [a.item, a]));
const A = answers("answers-A.json");
const B = answers("answers-B.json");

describe("dataset v3.1-pre", () => {
  it("frozen snapshot v3 is intact (41 files)", () => {
    expect(verifyFreezeV3()).toEqual({ ok: 41, total: 41, bad: [] });
  });

  it("migration is deterministic and reproduces the files on disk", async () => {
    const one = await build();
    const two = await build();
    expect(JSON.stringify(one.files)).toBe(JSON.stringify(two.files));
    for (const [f, body] of Object.entries(one.files as Record<string, string>)) expect(readFileSync(join(HERE, f), "utf8"), f).toBe(body);
  });

  it("every v3.1 record passes validateClauseRecordV31", () => {
    const bad = recs.map((r) => [`${r.case}/${r.id}`, validateClauseRecordV31(r)] as const).filter(([, e]) => e.length);
    expect(bad).toEqual([]);
  });

  it("counts reconcile: each of the 270 v3 records lands in exactly one v3.1 record", () => {
    expect(v3.length).toBe(270);
    const refs = recs.flatMap((r) => r.provenance.v3.map((p) => `${r.case}/${p.id}`)).sort();
    expect(refs).toEqual(v3.map((r) => `${r.case}/${r.id}`).sort());
    const mergedParts = log.merges.reduce((n: number, m: { ids: string[] }) => n + m.ids.length, 0);
    expect(recs.length).toBe(v3.length - mergedParts + log.merges.length);
    expect(recs.filter((r) => r.status === "migrated_merged").length).toBe(log.merges.length);
  });

  it("the only label changes are the human corrections (both humans agree, model differs)", () => {
    // Recompute the correction set from the raw answer files, independent of discrepancies-2.json.
    const expected = key.filter((k) => A[k.item].verdict === B[k.item].verdict && A[k.item].verdict !== k.verdict);
    const human = recs.filter((r) => r.status === "human_adjudicated");
    expect(human.map((r) => `${r.case}/${r.id}`).sort()).toEqual(expected.map((k) => `${k.case}/${k.id}`).sort());
    for (const r of human) {
      const item = r.provenance.human!.item;
      expect(r.verdict).toBe(A[item].verdict);
      expect(r.verdict).toBe(B[item].verdict);
      const hA: string[] = A[item].claimLinks, hB: string[] = B[item].claimLinks;
      const v = v3.find((x) => x.case === r.case && x.id === r.id)!;
      for (const l of r.links) {
        if (same(hA, hB)) expect(l.units).toEqual(hA); // both humans gave this link
        else { expect(l.linkStatus).toBe("needs_human_readjudication"); expect(l.units).toEqual(v.claimUnits); }
      }
      if (r.verdict === "not_a_condition") expect(r.links).toEqual([]);
    }
    for (const r of recs.filter((x) => x.status !== "human_adjudicated")) {
      const parts = r.provenance.v3.map((p) => v3.find((x) => x.case === r.case && x.id === p.id)!);
      const [only] = parts;
      if (parts.length === 1 && only) {
        expect(r.verdict, `${r.case}/${r.id}`).toBe(only.verdict);
        expect(r.links.map((l) => l.units)).toEqual(only.verdict === "not_a_condition" ? [] : [only.claimUnits]);
      } else {
        expect(parts.every((p) => p.verdict === r.verdict && p.clause === r.clause)).toBe(true);
        expect(r.links.map((l) => l.units).sort()).toEqual(parts.map((p) => p.claimUnits).sort());
      }
      for (const l of r.links) expect(l.binding).toBe(r.verdict);
    }
  });

  it("evidence is never invented: every link carries the migration marker until a human supplies a span", () => {
    for (const r of recs) for (const l of r.links) expect(l.evidence).toBe("migrated: needs evidence");
    expect(log.summary.evidenceMarkers).toBe(recs.reduce((n, r) => n + r.links.length, 0));
  });

  it("kn-13 stays sealed: no kn-13 records, text or hashes in the dataset", () => {
    expect(recs.some((r) => /kn-13/.test(r.case))).toBe(false);
    const sealedHashes = Object.values(readJson(join(P4, "sealed", "MANIFEST.json")).sha256 as Record<string, string>);
    for (const f of filesUnder(HERE)) {
      const body = readFileSync(f, "utf8");
      const name = relative(HERE, f);
      if (/\.json$/.test(name)) expect(body.includes("kn-13"), name).toBe(false);
      for (const h of sealedHashes) expect(body.includes(h), name).toBe(false);
    }
    expect(readFileSync(join(HERE, "migrate.mjs"), "utf8")).not.toMatch(/["'`/]sealed/);
  });

  it("FREEZE-v3.1 (provisional) hashes every other file in dataset-v3.1/", () => {
    const fz = readJson(join(HERE, "FREEZE-v3.1.json"));
    expect(fz.status).toMatch(/provisional/);
    const files = filesUnder(HERE).map((f) => relative(HERE, f).replaceAll("\\", "/")).filter((f) => f !== "FREEZE-v3.1.json").sort();
    expect(Object.keys(fz.sha256).sort()).toEqual(files);
    for (const f of files) expect(sha(readFileSync(join(HERE, f))), f).toBe(fz.sha256[f]);
  });
});
