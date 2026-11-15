// Compares the human answers with the model reference labels. Run only after answers.json is complete.
// Never edits the snapshot or the key. Writes discrepancies.json: one row per item, a mechanical difference kind and an
// empty `cause` for the discussion to fill (rubric_gap | model_misapplied_rubric | human_misread | source_ambiguous |
// attachment_level | other). Refuses if the packet or key changed after SAMPLE-HASH.json.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fixed = JSON.parse(readFileSync(join(HERE, "SAMPLE-HASH.json"), "utf8")).sha256;
for (const f of ["PACKET.md", "SAMPLE-KEY.json", "answers.template.json"])
  if (sha(readFileSync(join(HERE, f))) !== fixed[f]) throw new Error(`${f} changed after the sample was fixed`);
const key = JSON.parse(readFileSync(join(HERE, "SAMPLE-KEY.json"), "utf8"));
const { answers } = JSON.parse(readFileSync(join(HERE, "answers.json"), "utf8"));
const byItem = Object.fromEntries(answers.map((a) => [a.item, a]));
const missing = key.filter((k) => !byItem[k.item]?.verdict).map((k) => k.item);
if (missing.length) throw new Error(`unanswered: ${missing.join(", ")}`);

const rows = key.map((k) => {
  const h = byItem[k.item];
  const ref = k.claimUnits ?? [];
  const hum = h.claimLinks ?? [];
  const anyShared = hum.some((u) => ref.includes(u));
  const kinds = [];
  if (h.verdict !== k.verdict) {
    if ([h.verdict, k.verdict].includes("not_a_condition")) kinds.push("condition_or_not");
    else if ([h.verdict, k.verdict].includes("ambiguous")) kinds.push("ambiguity");
    else kinds.push("binding");
  }
  if (h.verdict !== "not_a_condition" && k.verdict !== "not_a_condition" && !anyShared) kinds.push("claim_link_disjoint");
  if (hum.length === 2) kinds.push(anyShared ? "second_link_added" : "two_links_none_shared");
  return { item: k.item, stratum: k.stratum, ref: `${k.case}/${k.id}`, clause: k.clause, reference: { verdict: k.verdict, claimUnits: ref },
    human: { verdict: h.verdict, claimLinks: hum, confidence: h.confidence, note: h.note }, kinds, cause: "" };
});
const agree = (f) => rows.filter(f).length;
const summary = {
  items: rows.length,
  verdictAgreement: agree((r) => r.human.verdict === r.reference.verdict) / rows.length,
  claimSetAgreement: (() => {
    const cs = rows.filter((r) => ["claim", "set"].includes(r.human.verdict) && ["claim", "set"].includes(r.reference.verdict));
    return { n: cs.length, agree: cs.filter((r) => r.human.verdict === r.reference.verdict).length };
  })(),
  linkDisjoint: agree((r) => r.kinds.includes("claim_link_disjoint")),
  secondLinksAdded: agree((r) => r.human.claimLinks.length === 2),
  byStratum: Object.fromEntries([...new Set(rows.map((r) => r.stratum))].map((s) => {
    const rs = rows.filter((r) => r.stratum === s);
    return [s, { n: rs.length, verdictAgree: rs.filter((r) => r.human.verdict === r.reference.verdict).length, linkDisjoint: rs.filter((r) => r.kinds.includes("claim_link_disjoint")).length }];
  })),
};
writeFileSync(join(HERE, "discrepancies.json"), JSON.stringify({ summary, rows }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 1));
