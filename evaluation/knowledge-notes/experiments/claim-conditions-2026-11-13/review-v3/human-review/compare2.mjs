// Two-reviewer comparison (user decision 2026-11-15): human-to-human and human-to-model agreement.
// Inputs: answers-A.json and answers-B.json (each a copy of answers.template.json, filled in independently).
// Writes discrepancies-2.json. Never edits the snapshot, the key or the answers. Refuses if the packet, key or
// template changed after SAMPLE-HASH.json, or if either reviewer left an item blank.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fixed = JSON.parse(readFileSync(join(HERE, "SAMPLE-HASH.json"), "utf8")).sha256;
for (const f of ["PACKET.md", "SAMPLE-KEY.json", "answers.template.json"])
  if (sha(readFileSync(join(HERE, f))) !== fixed[f]) throw new Error(`${f} changed after the sample was fixed`);

const key = JSON.parse(readFileSync(join(HERE, "SAMPLE-KEY.json"), "utf8"));
const load = (who) => {
  const d = JSON.parse(readFileSync(join(HERE, `answers-${who}.json`), "utf8"));
  const by = Object.fromEntries(d.answers.map((a) => [a.item, a]));
  const blank = key.filter((k) => !by[k.item]?.verdict).map((k) => k.item);
  if (blank.length) throw new Error(`reviewer ${who} left blank: ${blank.join(", ")}`);
  return { reviewer: d.reviewer, by };
};
const A = load("A");
const B = load("B");
if (A.reviewer && A.reviewer === B.reviewer) throw new Error("A and B name the same reviewer");

const VERDICTS = ["claim", "set", "ambiguous", "not_a_condition"];
function kappa(pairs, cats) {
  const n = pairs.length;
  if (!n) return null;
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([x]) => x === c).length / n) * (pairs.filter(([, y]) => y === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
const linkRel = (x = [], y = []) => {
  if (!x.length || !y.length) return "n/a";
  const sx = [...x].sort().join(), sy = [...y].sort().join();
  return sx === sy ? "exact" : x.some((u) => y.includes(u)) ? "overlap" : "disjoint";
};
function pairStats(get1, get2) {
  const v = key.map((k) => [get1(k).verdict, get2(k).verdict]);
  const cs = v.filter(([x, y]) => ["claim", "set"].includes(x) && ["claim", "set"].includes(y));
  const links = key.map((k) => linkRel(get1(k).links, get2(k).links)).filter((r) => r !== "n/a");
  return {
    n: v.length,
    verdictAgreement: v.filter(([x, y]) => x === y).length / v.length,
    verdictKappa: kappa(v, VERDICTS),
    claimSet: { n: cs.length, agree: cs.filter(([x, y]) => x === y).length, kappa: kappa(cs, ["claim", "set"]) },
    links: { exact: links.filter((r) => r === "exact").length, overlap: links.filter((r) => r === "overlap").length, disjoint: links.filter((r) => r === "disjoint").length },
  };
}
const model = (k) => ({ verdict: k.verdict, links: k.claimUnits ?? [] });
const human = (H) => (k) => ({ verdict: H.by[k.item].verdict, links: H.by[k.item].claimLinks ?? [] });

const rows = key.map((k) => {
  const a = A.by[k.item], b = B.by[k.item];
  const humansAgree = a.verdict === b.verdict;
  let pattern;
  if (humansAgree && a.verdict === k.verdict) pattern = "all_agree";
  else if (humansAgree) pattern = "humans_agree_model_differs"; // strongest signal of a reference-label problem
  else if (a.verdict === k.verdict || b.verdict === k.verdict) pattern = "humans_split_one_with_model";
  else pattern = "three_way_split";
  return {
    item: k.item, stratum: k.stratum, ref: `${k.case}/${k.id}`, clause: k.clause,
    model: { verdict: k.verdict, claimUnits: k.claimUnits }, A: { verdict: a.verdict, claimLinks: a.claimLinks, confidence: a.confidence, note: a.note },
    B: { verdict: b.verdict, claimLinks: b.claimLinks, confidence: b.confidence, note: b.note },
    pattern, linkAB: linkRel(a.claimLinks, b.claimLinks), cause: "",
  };
});
const count = (f) => rows.filter(f).length;
const summary = {
  items: rows.length,
  humanHuman: pairStats(human(A), human(B)),
  humanAModel: pairStats(human(A), model),
  humanBModel: pairStats(human(B), model),
  patterns: Object.fromEntries(["all_agree", "humans_agree_model_differs", "humans_split_one_with_model", "three_way_split"].map((p) => [p, count((r) => r.pattern === p)])),
  byStratum: Object.fromEntries([...new Set(rows.map((r) => r.stratum))].map((s) => [s, Object.fromEntries(
    ["all_agree", "humans_agree_model_differs", "humans_split_one_with_model", "three_way_split"].map((p) => [p, count((r) => r.stratum === s && r.pattern === p)]))])),
  note: "36 items: an indicative discrepancy check, not a population estimate. Causes are filled in by discussion (rubric_gap | model_misapplied_rubric | human_misread | source_ambiguous | attachment_level | other). Snapshot v3 is never edited to match.",
};
writeFileSync(join(HERE, "discrepancies-2.json"), JSON.stringify({ summary, rows }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 1));
