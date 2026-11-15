// Attachment-rule impact analysis (review of snapshot v3, 2026-11-14).
// Read-only over the frozen phase 4 snapshot; development records only (kn-01..kn-12). Never reads phase4/sealed.
// Writes review-v3/attachment-impact.json. Run: node attachment.mjs (from this folder).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const P4 = join(import.meta.dirname, "..", "phase4");

// 1. The snapshot must be the frozen one.
const freeze = JSON.parse(readFileSync(join(P4, "FREEZE-v3.json"), "utf8"));
const entries = freeze.sha256;
if (!entries || !Object.keys(entries).length) throw new Error("FREEZE-v3 has no sha256 map");
let checked = 0;
for (const [rel, hash] of Object.entries(entries)) {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) continue;
  const got = createHash("sha256").update(readFileSync(join(P4, rel))).digest("hex");
  if (got !== hash) throw new Error(`FREEZE-v3 mismatch: ${rel}`);
  checked++;
}

// 2. Unit heading paths from the annotation packets.
const units = {}; // case -> uid -> { idx, path }
for (const f of readdirSync(join(P4, "annotation-packets"))) {
  const c = f.replace(/\.md$/, "");
  units[c] = {};
  for (const line of readFileSync(join(P4, "annotation-packets", f), "utf8").split("\n")) {
    const m = /^u(\d+) \[([^\]]*)\]/.exec(line);
    if (m) units[c]["u" + m[1]] = { idx: Number(m[1]), path: m[2].split(" › ") };
  }
}

// A link is "local" when it is the clause's own unit or the adjacent unit in the same section (the immediate passage);
// "section" when it is elsewhere in the clause's section or in an enclosing section (a section-level claim);
// "elsewhere" otherwise.
const sameOrEnclosing = (claimPath, clausePath) =>
  claimPath.length <= clausePath.length && claimPath.every((p, i) => p === clausePath[i]);
function level(caseId, recUnits, link) {
  if (!link?.length) return "none";
  const u = units[caseId];
  const own = recUnits.map((x) => u[x]).filter(Boolean);
  const lk = link.map((x) => u[x]).filter(Boolean);
  if (!own.length || !lk.length) return "unknown";
  const local = lk.every((l) => own.some((o) => Math.abs(o.idx - l.idx) <= 1 && o.path.join() === l.path.join()));
  if (local) return "local";
  if (lk.every((l) => own.some((o) => sameOrEnclosing(l.path, o.path)))) return "section";
  return "elsewhere";
}
const key = (l) => [...(l ?? [])].sort().join(",");
const relation = (a, b) =>
  key(a) === key(b) ? "exact" : a.some((x) => b.includes(x)) ? "overlap" : "disjoint";

const out = { snapshotFilesVerified: checked, records: 0, linked: 0, xyBoth: 0, xy: {}, disjointKinds: {}, candidates: [], unresolved: [] };
for (const f of readdirSync(join(P4, "adjudicated")).sort()) {
  const d = JSON.parse(readFileSync(join(P4, "adjudicated", f), "utf8"));
  const c = d.caseId ?? f.replace(/\.json$/, "");
  for (const r of d.records) {
    out.records++;
    if (r.verdict === "not_a_condition") continue;
    out.linked++;
    const by = Object.fromEntries((r.readings ?? []).map((x) => [x.who, x]));
    const X = by.X?.claimUnits?.length ? by.X.claimUnits : null;
    const Y = by.Y?.claimUnits?.length ? by.Y.claimUnits : null;
    let pairKind = null;
    if (X && Y) {
      out.xyBoth++;
      const rel = relation(X, Y);
      out.xy[rel] = (out.xy[rel] ?? 0) + 1;
      if (rel === "disjoint") {
        pairKind = [level(c, r.units, X), level(c, r.units, Y)].sort().join("+");
        out.disjointKinds[pairKind] = (out.disjointKinds[pairKind] ?? 0) + 1;
      }
    }
    // Candidate second link: some reading's link is disjoint from the adjudicated link, and the two are one local
    // and one section-level. Structural only: the rule also needs positive source evidence, which this cannot see.
    const adj = r.claimUnits ?? [];
    const others = ["X", "Y", "phase3"]
      .map((w) => ({ who: w, link: by[w]?.claimUnits }))
      .filter((o) => o.link?.length && adj.length && relation(adj, o.link) === "disjoint");
    const seen = new Set();
    for (const o of others) {
      if (seen.has(key(o.link))) continue;
      seen.add(key(o.link));
      const pair = [level(c, r.units, adj), level(c, r.units, o.link)].sort().join("+");
      if (pair === "local+section") {
        out.candidates.push({
          case: c, id: r.id, units: r.units, clause: r.clause, verdict: r.verdict, status: r.status, rule: r.rule,
          adjudicatedLink: adj, adjudicatedLevel: level(c, r.units, adj), secondLink: o.link, proposedBy: o.who,
        });
      }
    }
    if (r.status === "unresolved") {
      const q = r.decidingQuestion ?? "";
      out.unresolved.push({
        case: c, id: r.id, units: r.units, decidingQuestion: q,
        readings: (r.readings ?? []).map((x) => `${x.who}:${x.verdict}:${key(x.claimUnits)}`),
        isAttachmentQuestion: /claim link|R4|attach/i.test(q),
      });
    }
  }
}
out.candidateRecords = new Set(out.candidates.map((c) => c.case + "/" + c.id)).size;
out.candidatesByStatus = out.candidates.reduce((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
out.candidatesByProposer = out.candidates.reduce((a, c) => ((a[c.proposedBy] = (a[c.proposedBy] ?? 0) + 1), a), {});
out.candidatesR4 = out.candidates.filter((c) => c.rule === "R4").length;
out.unresolvedAttachment = out.unresolved.filter((u) => u.isAttachmentQuestion).length;
writeFileSync(join(import.meta.dirname, "attachment-impact.json"), JSON.stringify(out, null, 2) + "\n");
const { candidates: _candidates, unresolved, ...head } = out;
console.log(JSON.stringify(head, null, 1));
for (const u of unresolved) console.log(u.case.slice(0, 5), u.id, u.isAttachmentQuestion, u.readings.join(" "));
