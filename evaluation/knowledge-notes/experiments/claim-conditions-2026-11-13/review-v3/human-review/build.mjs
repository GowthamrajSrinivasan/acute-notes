// Builds the blind human spot-check packet over frozen snapshot v3 (development records kn-01..kn-12 only).
// Writes PACKET.md (what the reviewer sees: no reference labels), answers.template.json, SAMPLE-KEY.json (reference
// labels: the reviewer must not open it) and SAMPLE-HASH.json. Deterministic: rerunning gives the same sample.
// Refuses if FREEZE-v3 does not match. Never reads phase4/sealed.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const P4 = join(HERE, "..", "..", "phase4");
const sha = (b) => createHash("sha256").update(b).digest("hex");

const freeze = JSON.parse(readFileSync(join(P4, "FREEZE-v3.json"), "utf8")).sha256;
for (const [rel, h] of Object.entries(freeze)) if (sha(readFileSync(join(P4, rel))) !== h) throw new Error(`FREEZE-v3 mismatch: ${rel}`);
if (existsSync(join(HERE, "answers.json"))) throw new Error("answers.json exists: the sample is fixed; do not rebuild");

// Units with heading paths.
const units = {};
for (const f of readdirSync(join(P4, "annotation-packets"))) {
  const c = f.replace(/\.md$/, "");
  units[c] = [];
  for (const line of readFileSync(join(P4, "annotation-packets", f), "utf8").split("\n")) {
    const m = /^u(\d+) \[([^\]]*)\] (.*)$/.exec(line);
    if (m) units[c].push({ id: "u" + m[1], idx: Number(m[1]), path: m[2], text: m[3] });
  }
}

const all = [];
for (const f of readdirSync(join(P4, "adjudicated")).sort()) {
  const d = JSON.parse(readFileSync(join(P4, "adjudicated", f), "utf8"));
  for (const r of d.records) all.push({ case: d.caseId ?? f.replace(/\.json$/, ""), ...r });
}
const impact = JSON.parse(readFileSync(join(HERE, "..", "attachment-impact.json"), "utf8"));
const ref = (r) => `${r.case}/${r.id}`;
// Deterministic order: hash of the record ref with a fixed salt.
const rank = (r) => sha("review-v3-human-2026-11-14|" + ref(r));
const pick = (pool, n, taken) =>
  pool.filter((r) => !taken.has(ref(r)) && !taken.has(r.case + "|" + r.clause)).sort((a, b) => (rank(a) < rank(b) ? -1 : 1))
    .filter((r, i, a) => a.findIndex((s) => s.case === r.case && s.clause === r.clause) === i).slice(0, n);

const STRATA = [
  ["unresolved", 6, (r) => r.status === "unresolved"],
  ["source-contradiction", 1, (r) => r.case.startsWith("kn-11") && r.units.includes("u33")],
  ["two-attachments", 5, (r) => impact.candidates.some((c) => c.case === r.case && c.id === r.id && c.proposedBy !== "phase3")],
  ["changed-from-phase3", 5, (r) => {
    const p = (r.readings ?? []).find((x) => x.who === "phase3");
    return p && p.verdict && p.verdict !== r.verdict && r.status !== "unresolved";
  }],
  ["R1-instruction", 3, (r) => r.rule === "R1"],
  ["R2-hedge", 3, (r) => r.rule === "R2"],
  ["R3-cost", 3, (r) => r.rule === "R3"],
  ["clear-claim", 4, (r) => r.verdict === "claim" && r.status === "agreed" && r.confidence === "high"],
  ["clear-set", 4, (r) => r.verdict === "set" && r.status === "agreed"],
  ["not-a-condition", 2, (r) => r.verdict === "not_a_condition"],
];
const taken = new Set();
const sample = [];
for (const [stratum, n, pred] of STRATA) {
  const got = pick(all.filter(pred), n, taken);
  for (const r of got) { taken.add(ref(r)); taken.add(r.case + "|" + r.clause); sample.push({ stratum, r }); }
}
// Present in a shuffled order so strata are not guessable from position.
sample.sort((a, b) => (sha("order|" + ref(a.r)) < sha("order|" + ref(b.r)) ? -1 : 1));

let md = `# Human spot check: claim–condition snapshot v3

Rubric: read \`phase4/EVAL-SPEC-v3.md\` §2 (verdicts, R1–R5) before starting. **Do not open \`SAMPLE-KEY.json\`** or the
\`phase4/adjudicated/\` files until you have finished: they hold the model reference labels.

For each item: the highlighted clause sits in the source passage shown (its section). Record in \`answers.json\`
(copy \`answers.template.json\`):
- \`verdict\`: \`claim\` (restating the claim without the clause becomes false or misleading, or leads a reader to act
  wrongly), \`set\` (the takeaway is unchanged but the condition belongs somewhere in the notes), \`ambiguous\` (the
  source does not settle it: write both readings), or \`not_a_condition\`.
- \`claimLinks\`: the unit id(s) of the claim the clause limits, **up to two** links when it genuinely limits both
  its own sentence's claim and a broader section claim; one link otherwise. Empty for \`not_a_condition\`.
- \`confidence\`: high, medium or low; \`note\`: a sentence on why, especially when you hesitated.

${sample.length} items. Roughly 1–2 minutes each.

`;
const template = [];
sample.forEach(({ r }, i) => {
  const item = `H${String(i + 1).padStart(2, "0")}`;
  const us = units[r.case];
  const own = us.filter((u) => r.units.includes(u.id));
  const path = own[0]?.path ?? "";
  const top = path.split(" › ").slice(0, 2).join(" › ");
  const ctx = us.filter((u) => u.path.startsWith(top) || own.some((o) => Math.abs(o.idx - u.idx) <= 2));
  md += `## ${item} (${r.case})\n\nClause: **"${r.clause}"** (in ${r.units.join(", ")})\n\n`;
  for (const u of ctx.slice(0, 30)) md += `- ${r.units.includes(u.id) ? "**→** " : ""}\`${u.id}\` [${u.path}] ${u.text}\n`;
  if (ctx.length > 30) md += `- … (${ctx.length - 30} more units in this section; see \`phase4/annotation-packets/${r.case}.md\`)\n`;
  md += "\n";
  template.push({ item, verdict: "", claimLinks: [], confidence: "", note: "" });
});
const key = sample.map(({ stratum, r }, i) => ({
  item: `H${String(i + 1).padStart(2, "0")}`, stratum, case: r.case, id: r.id, units: r.units, clause: r.clause,
  verdict: r.verdict, claimUnits: r.claimUnits, rule: r.rule, status: r.status, confidence: r.confidence,
  readings: r.readings, decidingQuestion: r.decidingQuestion,
  secondLinkCandidate: impact.candidates.filter((c) => c.case === r.case && c.id === r.id).map((c) => c.secondLink),
}));
writeFileSync(join(HERE, "PACKET.md"), md);
writeFileSync(join(HERE, "answers.template.json"), JSON.stringify({ reviewer: "", date: "", answers: template }, null, 2) + "\n");
writeFileSync(join(HERE, "SAMPLE-KEY.json"), JSON.stringify(key, null, 2) + "\n");
const hashes = Object.fromEntries(["PACKET.md", "answers.template.json", "SAMPLE-KEY.json", "build.mjs", "compare.mjs"]
  .filter((f) => existsSync(join(HERE, f))).map((f) => [f, sha(readFileSync(join(HERE, f)))]));
writeFileSync(join(HERE, "SAMPLE-HASH.json"), JSON.stringify({ builtAt: new Date().toISOString(), snapshot: "phase4/FREEZE-v3.json", sha256: hashes }, null, 2) + "\n");
const counts = key.reduce((a, k) => ((a[k.stratum] = (a[k.stratum] ?? 0) + 1), a), {});
console.log(sample.length, JSON.stringify(counts));
