// Dataset v3.1-pre: documented migration of frozen snapshot v3 to the v3.1 record shape (EVAL-SPEC-v3.1-AMENDMENT.md).
// Deterministic and offline: no AI calls, no clock, no randomness. Refuses to run if FREEZE-v3 does not match.
// Never edits anything under phase4/ or review-v3/; never reads the sealed kn-13 folder (kn-13 stays sealed).
//
// The only label changes it makes come from the two human reviewers (review-v3/human-review/answers-A.json and
// answers-B.json): items where both humans agree with each other and differ from the model reference on the verdict.
// Everything else is carried over from v3 unchanged, or queued for two-human re-adjudication (not decided here).
//
// Run (from the repo root or this folder): node evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/dataset-v3.1/migrate.mjs
// `build()` returns the output files in memory; the test uses it to check the files on disk are reproducible.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
const EXP = join(HERE, "..");
const P4 = join(EXP, "phase4");
const RV3 = join(EXP, "review-v3");
const HR = join(RV3, "human-review");
const DATE = "2026-11-15"; // user decision date; fixed so the output is byte-reproducible
const NEEDS_EVIDENCE = "migrated: needs evidence";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const rel = (p) => p.slice(EXP.length + 1).replaceAll("\\", "/");

export function verifyFreezeV3() {
  const freeze = readJson(join(P4, "FREEZE-v3.json")).sha256;
  const bad = [];
  let ok = 0;
  for (const [f, h] of Object.entries(freeze)) (sha(readFileSync(join(P4, f))) === h ? ok++ : bad.push(f));
  return { ok, total: Object.keys(freeze).length, bad };
}

// Mechanical link level, identical to review-v3/attachment.mjs: "local" when the claim is the clause's own unit or
// the adjacent unit under the same heading path; "section" when it sits in the clause's section or an enclosing one;
// "elsewhere" otherwise.
function loadUnits() {
  const units = {};
  for (const f of readdirSync(join(P4, "annotation-packets")).sort()) {
    const c = f.replace(/\.md$/, "");
    units[c] = {};
    for (const line of readFileSync(join(P4, "annotation-packets", f), "utf8").split("\n")) {
      const m = /^u(\d+) \[([^\]]*)\] (.*)$/.exec(line.replace(/\r$/, ""));
      if (m) units[c]["u" + m[1]] = { id: "u" + m[1], idx: Number(m[1]), path: m[2].split(" › "), text: m[3] };
    }
  }
  return units;
}
const sameOrEnclosing = (claimPath, clausePath) =>
  claimPath.length <= clausePath.length && claimPath.every((p, i) => p === clausePath[i]);
function levelOf(units, caseId, recUnits, link) {
  if (!link?.length) return "none";
  const u = units[caseId];
  const own = recUnits.map((x) => u[x]).filter(Boolean);
  const lk = link.map((x) => u[x]).filter(Boolean);
  if (!own.length || !lk.length) return "unknown";
  if (lk.every((l) => own.some((o) => Math.abs(o.idx - l.idx) <= 1 && o.path.join() === l.path.join()))) return "local";
  if (lk.every((l) => own.some((o) => sameOrEnclosing(l.path, o.path)))) return "section";
  return "elsewhere";
}
// The v3.1 schema has two levels. "elsewhere"/"unknown" single links are carried as `section` (the non-local level)
// with `levelDerived` kept, so a human can confirm the level; they are counted in the log.
const schemaLevel = (lvl) => (lvl === "local" ? "local" : "section");

const disjoint = (a, b) => !a.some((x) => b.includes(x));
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const RANK = { claim: 3, ambiguous: 2, set: 1 };
const CONF = { low: 1, medium: 2, high: 3 };

// Finding 1 of DISCREPANCY-REPORT-2 (contrast / consequence / usage-or-scope exclusion read as `claim`).
// Transparent, mechanical criteria over unsampled records; each is reported separately.
const F1_RULES = ["R3", "R4", "general"];
const CUES = {
  contrast: /\bbut\b|\brather than\b|\binstead\b|\bwhereas\b|\bhowever\b/i,
  consequence: /^so\b|[,;:] so\b|\bso (that )?(they|it|the|a|an|we|you|these|this)\b|\bwhich means\b|\bmeans that\b/i,
  weakness: /\b(weakness|drawback|downside|limitation)\b/i,
  // Negated usage/scope exclusions ("not on live election results", "not a way to ..."). Clauses that open as an
  // if/when/unless/until condition are applicability conditions, which finding 1 explicitly did not confirm.
  exclusion: /\bnot\b|n't\b|\bnever\b|\bnothing\b|\bnone\b|\bno\b/i,
};
const CONDITIONAL_OPENER = /^(if|when|whenever|unless|until|once|after|before|while)\b/i;
function f1Cues(clause) {
  const out = [];
  for (const [k, re] of Object.entries(CUES)) {
    if (k === "exclusion" && CONDITIONAL_OPENER.test(clause.trim())) continue;
    if (re.test(clause)) out.push(k);
  }
  return out;
}

export async function build() {
  const freeze = verifyFreezeV3();
  if (freeze.bad.length || freeze.ok !== 41) throw new Error(`FREEZE-v3 mismatch: ${freeze.bad.join(", ") || freeze.ok}`);

  // Human answers must be the hashed, user-supplied files.
  const ansHash = readJson(join(HR, "ANSWERS-HASH.json")).sha256;
  for (const f of ["answers-A.json", "answers-B.json"])
    if (sha(readFileSync(join(HR, f))) !== ansHash[f]) throw new Error(`${f} does not match ANSWERS-HASH.json`);
  const sampleHash = readJson(join(HR, "SAMPLE-HASH.json")).sha256;
  if (sha(readFileSync(join(HR, "SAMPLE-KEY.json"))) !== sampleHash["SAMPLE-KEY.json"]) throw new Error("SAMPLE-KEY mismatch");

  const { validateClauseRecordV31 } = await import(pathToFileURL(join(RV3, "attachmentSchema.ts")).href);
  const units = loadUnits();
  const key = readJson(join(HR, "SAMPLE-KEY.json"));
  const disc = readJson(join(HR, "discrepancies-2.json")).rows;
  const A = Object.fromEntries(readJson(join(HR, "answers-A.json")).answers.map((a) => [a.item, a]));
  const B = Object.fromEntries(readJson(join(HR, "answers-B.json")).answers.map((a) => [a.item, a]));
  const impact = readJson(join(RV3, "attachment-impact.json"));

  const inputs = {};
  const hashIn = (p) => (inputs[rel(p)] = sha(readFileSync(p)));
  hashIn(join(P4, "FREEZE-v3.json"));
  for (const f of readdirSync(join(P4, "annotation-packets")).sort()) hashIn(join(P4, "annotation-packets", f));
  for (const p of [join(RV3, "EVAL-SPEC-v3.1-AMENDMENT.md"), join(RV3, "attachmentSchema.ts"), join(RV3, "attachment-impact.json"),
    join(HR, "SAMPLE-KEY.json"), join(HR, "discrepancies-2.json"), join(HR, "answers-A.json"), join(HR, "answers-B.json"),
    join(HR, "DISCREPANCY-REPORT-2.md")]) hashIn(p);

  // ---- 1. v3 records ------------------------------------------------------------------------------------------
  const cases = [];
  const v3 = [];
  for (const f of readdirSync(join(P4, "adjudicated")).sort()) {
    const d = readJson(join(P4, "adjudicated", f));
    const caseId = d.caseId ?? f.replace(/\.json$/, "");
    if (/kn-13/.test(caseId)) throw new Error("kn-13 must stay sealed");
    cases.push(caseId);
    d.records.forEach((r, i) => v3.push({ case: caseId, order: i, ...r }));
  }
  const ref = (r) => `${r.case}/${r.id}`;
  const sampled = new Map(key.map((k) => [`${k.case}/${k.id}`, k.item]));
  const phase3 = (r) => (r.readings ?? []).find((x) => x.who === "phase3")?.verdict ?? null;

  // ---- 1b. Records the v3 adjudicators split by claim: same case, same units, same clause, disjoint claim links ----
  const groups = new Map();
  for (const r of v3) {
    const g = `${r.case}|${r.units.join(",")}|${r.clause.trim().toLowerCase()}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const merges = [];
  const splitsKept = [];
  const mergedInto = new Map(); // v3 ref -> merged id
  for (const rs of groups.values()) {
    if (rs.length < 2) continue;
    const linked = rs.filter((r) => r.claimUnits?.length);
    const pairwiseDisjoint = linked.length === rs.length && linked.every((a, i) => linked.slice(i + 1).every((b) => disjoint(a.claimUnits, b.claimUnits)));
    if (!pairwiseDisjoint) continue;
    const lv = rs.map((r) => levelOf(units, r.case, r.units, r.claimUnits));
    const entry = { case: rs[0].case, ids: rs.map((r) => r.id), clause: rs[0].clause, links: rs.map((r, i) => ({ id: r.id, claimUnits: r.claimUnits, level: lv[i] })) };
    if (rs.length === 2 && [...lv].sort().join("+") === "local+section") {
      const id = rs.map((r) => r.id).join("+");
      merges.push({ ...entry, mergedId: id });
      for (const r of rs) mergedInto.set(ref(r), id);
    } else splitsKept.push({ ...entry, reason: `levels ${lv.join("+")}: not one local and one section-level link, so kept as separate records` });
  }

  // ---- 2. Human corrections ------------------------------------------------------------------------------------
  const corrections = new Map(); // v3 ref -> correction
  const humanSplits = [];
  for (const row of disc) {
    const a = A[row.item], b = B[row.item];
    const k = key.find((x) => x.item === row.item);
    if (!a || !b || !k || `${k.case}/${k.id}` !== row.ref) throw new Error(`item ${row.item} does not reconcile`);
    const humansAgree = a.verdict === b.verdict;
    if (row.pattern === "humans_agree_model_differs") {
      // Cross-check the pattern against the raw answer files, not only the comparison output.
      if (!humansAgree || a.verdict === k.verdict) throw new Error(`${row.item}: pattern does not match the answer files`);
      const linksAgree = sameSet(a.claimLinks, b.claimLinks);
      corrections.set(row.ref, {
        item: row.item, from: k.verdict, to: a.verdict, linksAgree,
        humanLinks: { A: a.claimLinks, B: b.claimLinks }, referenceLinks: k.claimUnits,
        notes: { A: a.note, B: b.note }, confidence: { A: a.confidence, B: b.confidence },
      });
    } else if (!humansAgree) {
      humanSplits.push({ item: row.item, ref: row.ref, pattern: row.pattern, reference: k.verdict, A: a.verdict, B: b.verdict, change: "none" });
    }
  }
  const humanProvenance = {
    answersA: { file: "review-v3/human-review/answers-A.json", sha256: ansHash["answers-A.json"] },
    answersB: { file: "review-v3/human-review/answers-B.json", sha256: ansHash["answers-B.json"] },
    sampleKey: { file: "review-v3/human-review/SAMPLE-KEY.json", sha256: sampleHash["SAMPLE-KEY.json"] },
    selector: "review-v3/human-review/discrepancies-2.json rows with pattern humans_agree_model_differs, re-checked against both answer files",
  };

  // ---- Record conversion ---------------------------------------------------------------------------------------
  const v3Summary = (r) => ({ id: r.id, verdict: r.verdict, rule: r.rule, status: r.status, claimUnits: r.claimUnits, confidence: r.confidence,
    ...(r.verdict === "ambiguous" ? { readingA: r.readingA, readingB: r.readingB, decidingQuestion: r.decidingQuestion } : {}) });
  const migratedLink = (r) => {
    const lvl = levelOf(units, r.case, r.units, r.claimUnits);
    return {
      level: schemaLevel(lvl), units: [...r.claimUnits], claimQuote: r.claimQuote,
      evidence: NEEDS_EVIDENCE,
      justification: r.rationale?.trim() ? r.rationale : NEEDS_EVIDENCE,
      binding: r.verdict,
      levelDerived: lvl, source: `v3 ${r.id} (claimQuote and rationale copied)`,
    };
  };
  const out = new Map(cases.map((c) => [c, []]));
  const seenMerged = new Set();
  for (const r of v3) {
    const mid = mergedInto.get(ref(r));
    if (mid) {
      if (seenMerged.has(`${r.case}/${mid}`)) continue;
      seenMerged.add(`${r.case}/${mid}`);
      const m = merges.find((x) => x.case === r.case && x.mergedId === mid);
      const parts = m.ids.map((id) => v3.find((x) => x.case === r.case && x.id === id));
      if (parts.some((p) => corrections.has(ref(p)))) throw new Error(`human correction on merged record ${mid} not handled`);
      const links = parts.map(migratedLink).sort((a, b) => (a.level === "local" ? -1 : 1) - (b.level === "local" ? -1 : 1));
      const verdict = links.reduce((best, l) => (RANK[l.binding] > RANK[best] ? l.binding : best), "set");
      out.get(r.case).push({
        id: mid, case: r.case, units: [...r.units], clause: r.clause, verdict, links, presentation: "one_carrier",
        confidence: parts.map((p) => p.confidence).sort((a, b) => CONF[a] - CONF[b])[0],
        rule: [...new Set(parts.map((p) => p.rule))].join("+"),
        status: "migrated_merged",
        flags: [],
        provenance: { v3: parts.map(v3Summary), migration: "A3: v3 split by claim into one record per link; merged into one record with a local and a section link (levels derived mechanically); confidence is the lower of the two" },
      });
      continue;
    }
    const c = corrections.get(ref(r));
    if (!c) {
      const rec = {
        id: r.id, case: r.case, units: [...r.units], clause: r.clause, verdict: r.verdict,
        links: r.verdict === "not_a_condition" ? [] : [migratedLink(r)],
        presentation: "one_carrier",
        ...(r.verdict === "ambiguous" ? { readingA: r.readingA, readingB: r.readingB, decidingQuestion: r.decidingQuestion } : {}),
        confidence: r.confidence, rule: r.rule, status: "migrated", flags: [],
        provenance: { v3: [v3Summary(r)] },
      };
      out.get(r.case).push(rec);
      continue;
    }
    // Human-adjudicated verdict change.
    const flags = [];
    let links = [];
    const justification = `Human reviewers (item ${c.item}) both gave ${c.to}. A: ${c.notes.A} | B: ${c.notes.B}`;
    if (c.to !== "not_a_condition") {
      if (c.linksAgree && c.humanLinks.A.length === 1) {
        const lu = c.humanLinks.A;
        const lvl = levelOf(units, r.case, r.units, lu);
        const sameAsRef = sameSet(lu, r.claimUnits);
        links = [{
          level: schemaLevel(lvl), units: [...lu],
          claimQuote: sameAsRef ? r.claimQuote : lu.map((u) => units[r.case][u].text).join(" "),
          evidence: NEEDS_EVIDENCE, justification, binding: c.to, levelDerived: lvl,
          source: sameAsRef ? `v3 ${r.id} link (both humans gave the same link); claimQuote copied from v3`
            : `both humans gave link ${lu.join(",")} (v3 reference ${r.claimUnits.join(",")}); claimQuote is the full text of ${lu.join(",")}`,
        }];
      } else {
        const l = migratedLink(r);
        links = [{ ...l, binding: c.to, justification, linkStatus: "needs_human_readjudication",
          source: `v3 ${r.id} link kept as a placeholder: humans agree on the verdict but their links differ (A ${c.humanLinks.A.join(",") || "-"}, B ${c.humanLinks.B.join(",") || "-"}; reference ${r.claimUnits.join(",")})` }];
        flags.push("link_needs_human_readjudication");
      }
    }
    out.get(r.case).push({
      id: r.id, case: r.case, units: [...r.units], clause: r.clause, verdict: c.to, links, presentation: "one_carrier",
      confidence: [c.confidence.A, c.confidence.B].sort((a, b) => CONF[a] - CONF[b])[0],
      rule: r.rule, status: "human_adjudicated", flags,
      provenance: {
        v3: [v3Summary(r)],
        human: { item: c.item, verdictA: c.to, verdictB: c.to, linksA: c.humanLinks.A, linksB: c.humanLinks.B, ...humanProvenance },
        migration: "Verdict set to the two humans' shared verdict; confidence is the lower of theirs. v3 readings kept above only as provenance.",
      },
    });
  }

  // ---- 3. Re-adjudication queue (two humans; nothing here is decided) -------------------------------------------
  const all = [...out.values()].flat();
  const findV31 = (caseId, v3id) => all.find((x) => x.case === caseId && x.provenance.v3.some((p) => p.id === v3id));
  const queue = new Map();
  const enqueue = (rec, reason, detail) => {
    const k = `${rec.case}/${rec.id}`;
    if (!queue.has(k)) queue.set(k, { record: k, case: rec.case, id: rec.id, units: rec.units, clause: rec.clause, reasons: [], details: {} });
    const q = queue.get(k);
    if (!q.reasons.includes(reason)) q.reasons.push(reason);
    if (detail) (q.details[reason] ??= []).push(detail);
  };
  const criteria = { base: 0, phase3Set: 0, cue: {}, cueAny: 0, both: 0, selected: 0, r1Phase3SetExcluded: 0 };
  for (const r of v3) {
    if (sampled.has(ref(r)) || r.verdict !== "claim") continue;
    if (r.rule === "R1" && phase3(r) === "set") criteria.r1Phase3SetExcluded++;
    if (!F1_RULES.includes(r.rule)) continue;
    criteria.base++;
    const p3 = phase3(r) === "set";
    const cues = f1Cues(r.clause);
    if (p3) criteria.phase3Set++;
    for (const c of cues) criteria.cue[c] = (criteria.cue[c] ?? 0) + 1;
    if (cues.length) criteria.cueAny++;
    if (p3 && cues.length) criteria.both++;
    if (p3 || cues.length) {
      criteria.selected++;
      enqueue(findV31(r.case, r.id), "finding1_pattern", { v3id: r.id, rule: r.rule, phase3Set: p3, cues });
    }
  }
  const ambiguousOpen = [];
  for (const r of v3.filter((x) => x.verdict === "ambiguous")) {
    if (corrections.has(ref(r))) continue;
    const item = sampled.get(ref(r)) ?? null;
    ambiguousOpen.push({ ref: ref(r), sampledItem: item });
    enqueue(findV31(r.case, r.id), "reference_ambiguous_unsettled", { v3id: r.id, sampledItem: item, humans: item ? `${A[item].verdict} / ${B[item].verdict}` : "not sampled" });
  }
  for (const rec of all.filter((x) => x.flags.includes("link_needs_human_readjudication")))
    enqueue(rec, "link_needs_human_readjudication", { item: rec.provenance.human.item, linksA: rec.provenance.human.linksA, linksB: rec.provenance.human.linksB });
  const annotatorCandidates = impact.candidates.filter((c) => c.proposedBy === "X" || c.proposedBy === "Y");
  for (const c of annotatorCandidates) {
    const rec = findV31(c.case, c.id);
    const present = rec.links.flatMap((l) => l.units);
    const pair = [c.adjudicatedLink, c.secondLink];
    // The candidate is the link of the pair the v3.1 record does not already carry; if it carries both (merged
    // record), the question is the evidence for the section-level one.
    const missing = pair.filter((l) => !l.every((u) => present.includes(u)));
    const ask = missing.length ? missing[0] : pair.find((l) => levelOf(units, c.case, c.units, l) === "section") ?? c.secondLink;
    enqueue(rec, "second_link_evidence", {
      v3id: c.id, candidateLink: ask, candidateLevel: levelOf(units, c.case, c.units, ask),
      alreadyALink: !missing.length, proposedBy: c.proposedBy,
    });
  }
  const queueList = [...queue.values()].sort((a, b) => (a.record < b.record ? -1 : 1));
  queueList.forEach((q) => {
    const order = sha("v3.1-readjudication|" + q.record);
    q.item = order; // replaced below by a stable item id
  });
  queueList.sort((a, b) => (a.item < b.item ? -1 : 1)).forEach((q, i) => (q.item = `R${String(i + 1).padStart(2, "0")}`));
  queueList.sort((a, b) => (a.item < b.item ? -1 : 1));
  const byReason = {};
  for (const q of queueList) for (const r of q.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
  const secondLinkEntries = queueList.reduce((n, q) => n + (q.details.second_link_evidence?.length ?? 0), 0);

  // ---- Packet (blind: no verdicts, links or readings from the reference, the annotators or the earlier humans) ----
  let md = `# Re-adjudication packet: claim–condition dataset v3.1-pre

Two humans answer **independently**, without discussing items until both have handed in. Rubric:
\`phase4/EVAL-SPEC-v3.md\` §2 as amended by \`review-v3/EVAL-SPEC-v3.1-AMENDMENT.md\` A1 (at most two links: a
\`local\` link first, a \`section\` link only with a positive evidence span). **Don't open** \`READJUDICATION-QUEUE.json\`,
\`records/\`, \`phase4/adjudicated/\`, \`review-v3/human-review/\` or the other reviewer's answers until both have finished:
they hold earlier labels.

For each item, record in a copy of \`READJUDICATION-ANSWERS.template.json\`:
- \`verdict\`: \`claim\`, \`set\`, \`ambiguous\` (write both readings and the deciding question in \`note\`) or \`not_a_condition\`;
- \`links\`: up to two, each \`{ "level": "local" | "section", "units": [...], "evidence": "<exact source words>", "binding": "claim" | "set" | "ambiguous" }\`; empty for \`not_a_condition\`;
- \`secondLink\` (only where the item asks a second-link question): \`"add"\` with an exact evidence span in that link, or \`"reject"\`;
- \`confidence\` and a one-sentence \`note\`.

${queueList.length} items.

`;
  const template = [];
  for (const q of queueList) {
    const us = Object.values(units[q.case]).sort((a, b) => a.idx - b.idx);
    const own = us.filter((u) => q.units.includes(u.id));
    const top = (own[0]?.path ?? []).slice(0, 2).join(" › ");
    const asks = (q.details.second_link_evidence ?? []).map((d) => d.candidateLink);
    const ctx = us.filter((u) => u.path.join(" › ").startsWith(top) || own.some((o) => Math.abs(o.idx - u.idx) <= 2) || asks.some((l) => l.includes(u.id)));
    md += `## ${q.item} (${q.case})\n\nClause: **"${q.clause}"** (in ${q.units.join(", ")})\n\n`;
    for (const u of ctx.slice(0, 30)) md += `- ${q.units.includes(u.id) ? "**→** " : ""}\`${u.id}\` [${u.path.join(" › ")}] ${u.text}\n`;
    if (ctx.length > 30) md += `- … (${ctx.length - 30} more units in this section; see \`phase4/annotation-packets/${q.case}.md\`)\n`;
    const uniq = [...new Set(asks.map((l) => l.join(", ")))];
    for (const l of uniq) md += `\n**Second-link question:** does this clause materially limit the claim in ${l}, so that a reader of that claim without this clause would act wrongly or be misled? Answer \`add\` with the exact evidence span, or \`reject\`.\n`;
    md += "\n";
    template.push({ item: q.item, verdict: "", links: [], ...(uniq.length ? { secondLink: "" } : {}), confidence: "", note: "" });
  }

  // ---- 4. Validation and counts --------------------------------------------------------------------------------
  const invalid = [];
  for (const rec of all) {
    const errs = validateClauseRecordV31(rec);
    if (errs.length) invalid.push({ record: `${rec.case}/${rec.id}`, errs });
  }
  const tally = (f) => all.reduce((a, r) => { for (const k of [].concat(f(r))) a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const links = all.flatMap((r) => r.links);
  const summary = {
    records: all.length,
    v3Records: v3.length,
    reconciliation: `${v3.length} v3 records - ${merges.reduce((n, m) => n + m.ids.length, 0)} merged + ${merges.length} merged records = ${all.length}`,
    byVerdict: tally((r) => r.verdict),
    byStatus: tally((r) => r.status),
    byVerdictV3: v3.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {}),
    links: links.length,
    linksByLevel: links.reduce((a, l) => ((a[l.level] = (a[l.level] ?? 0) + 1), a), {}),
    linksByDerivedLevel: links.reduce((a, l) => ((a[l.levelDerived] = (a[l.levelDerived] ?? 0) + 1), a), {}),
    recordsWithTwoLinks: all.filter((r) => r.links.length === 2).length,
    evidenceMarkers: links.filter((l) => l.evidence === NEEDS_EVIDENCE).length,
    justificationMarkers: links.filter((l) => l.justification === NEEDS_EVIDENCE).length,
    linksNeedingReadjudication: links.filter((l) => l.linkStatus === "needs_human_readjudication").length,
    validation: { validated: all.length, invalid: invalid.length, errors: invalid },
    queue: { items: queueList.length, byReason, secondLinkCandidateEntries: secondLinkEntries, finding1Criteria: criteria },
  };
  const log = {
    dataset: "claim-conditions v3.1-pre",
    date: DATE,
    status: "provisional: pending two-human re-adjudication of READJUDICATION-QUEUE.json; not yet the reference",
    spec: "review-v3/EVAL-SPEC-v3.1-AMENDMENT.md (approved as the evaluation protocol by the user, 2026-11-15)",
    freezeV3: { file: "phase4/FREEZE-v3.json", filesVerified: freeze.ok, mismatches: freeze.bad },
    inputs,
    summary,
    merges,
    splitsKept,
    humanCorrections: [...corrections.entries()].map(([r, c]) => ({ ref: r, item: c.item, from: c.from, to: c.to, linksAgree: c.linksAgree, linksA: c.humanLinks.A, linksB: c.humanLinks.B, referenceLinks: c.referenceLinks })),
    humanSplitsUnchanged: humanSplits,
    referenceAmbiguousStillOpen: ambiguousOpen,
    finding1Rules: { rules: F1_RULES, verdict: "claim", unsampledOnly: true, phase3Set: "phase 3 reading verdict was set", cues: Object.fromEntries(Object.entries(CUES).map(([k, v]) => [k, v.source])), conditionalOpenerExcludedFromExclusionCue: CONDITIONAL_OPENER.source, selection: "phase3Set OR any cue" },
    secondLinkCandidates: annotatorCandidates.map((c) => ({ case: c.case, id: c.id, adjudicatedLink: c.adjudicatedLink, secondLink: c.secondLink, proposedBy: c.proposedBy })),
  };

  const files = {};
  for (const [c, recs] of out) files[`records/${c}.json`] = JSON.stringify({ caseId: c, schema: "ClauseRecordV31 (review-v3/attachmentSchema.ts)", dataset: "v3.1-pre", records: recs }, null, 2) + "\n";
  files["MIGRATION-LOG.json"] = JSON.stringify(log, null, 2) + "\n";
  files["READJUDICATION-QUEUE.json"] = JSON.stringify({ dataset: "v3.1-pre", note: "Queued for two independent humans; nothing here is decided. Item order is a fixed hash, so reasons are not guessable from position.", byReason, items: queueList }, null, 2) + "\n";
  files["READJUDICATION-PACKET.md"] = md;
  files["READJUDICATION-ANSWERS.template.json"] = JSON.stringify({ reviewer: "", date: "", answers: template }, null, 2) + "\n";
  return { files, summary, log };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, summary } = await build();
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(HERE, f)), { recursive: true });
    writeFileSync(join(HERE, f), body);
  }
  const after = verifyFreezeV3();
  console.log(JSON.stringify({ ...summary, validation: { ...summary.validation, errors: summary.validation.errors.length }, freezeV3After: `${after.ok}/${after.total}` }, null, 1));
}
