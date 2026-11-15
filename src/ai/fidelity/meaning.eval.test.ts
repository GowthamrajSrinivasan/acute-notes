/**
 * The labelled paraphrase set (`.ai/docs/knowledge-notes-plan.md` §7.2, WP1.9): recall on distorted pairs and false
 * alarms on faithful ones, **per kind**, never as one aggregate. The table is printed on every run.
 *
 * The set's balance rules (≥ 200 pairs, ≥ 20 per kind with ≥ 8 faithful and ≥ 8 distorted) always hold. The §7.2
 * targets (recall ≥ 90% on qualifier, condition, negation and quantity; ≥ 75% on cause and trade-off; false alarms
 * ≤ 10% in each kind, G1) are asserted only once the labels are approved (G0, OD7): set `MEANING_TARGETS=on` to
 * enforce them. While any kept pair lacks a final human label, they are reported, not enforced.
 *
 * Labels: a pair's final label comes from people (`meaningLabels.ts`: agreed answers or a resolution); until then its
 * drafted `label` is used and the pair counts as a draft. Removed pairs are left out.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pairsFile from "./__fixtures__/meaning/pairs.json";
import type { MeaningKind, MeaningPair, ReviewCode, SourceUnit } from "./contracts";
import { MEANING_KINDS } from "./contracts";
import { checkMeaning } from "./meaning";
import type { LabellerFile, LabellingConfig, Resolution } from "./meaningLabels";
import { pairStates } from "./meaningLabels";

const allPairs = (pairsFile as { pairs: MeaningPair[] }).pairs;
const DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "meaning");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const states = new Map(
  pairStates(
    allPairs,
    readdirSync(join(DIR, "labels"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<LabellerFile>(join(DIR, "labels", f))),
    readJson<Record<string, Resolution>>(join(DIR, "resolutions.json")),
    readJson<LabellingConfig>(join(DIR, "labelling.json")),
  ).map((s) => [s.id, s]),
);
/** The kept pairs, each with its final human label when it has one, else its drafted label. */
const consensus = readJson<LabellingConfig>(join(DIR, "labelling.json")).policy?.mode === "model-consensus";
/**
 * The pairs measured, each with its final label. Under human labelling, a pair without one yet falls back to its
 * drafted label (and counts as a draft). Under model consensus only settled pairs are measured: excluded ones (the
 * labellers disagree) are left out, never guessed.
 */
const pairs: MeaningPair[] = allPairs
  .filter((p) => !["removed", "excluded"].includes(states.get(p.id)!.status) && (!consensus || states.get(p.id)!.final))
  .map((p) => ({ ...p, label: states.get(p.id)!.final ?? p.label }));
const isDraft = (p: MeaningPair) => !states.get(p.id)!.final;

const RECALL_TARGET: Partial<Record<MeaningKind, number>> = { qualifier: 0.9, condition: 0.9, negation: 0.9, quantity: 0.9, cause: 0.75, trade_off: 0.75 };
const FALSE_ALARM_TARGET = 0.1;
const ENFORCE = process.env.MEANING_TARGETS === "on";

function unitOf(text: string): SourceUnit {
  return { id: "u1", kind: "sentence", text, hash: "", topic: "", span: { start: 0, end: text.length } };
}

function flagsOf(pair: MeaningPair) {
  return checkMeaning({ id: pair.id, title: pair.card, body: "", cites: ["u1"] }, [unitOf(pair.source)]);
}

interface Row {
  kind: MeaningKind;
  pairs: number;
  faithful: number;
  distorted: number;
  caught: number;
  expectedCode: number;
  falseAlarms: number;
  missed: string[];
  alarms: string[];
}

/**
 * Held-out pairs, never tuned against: `h-…` (the first set; its misses were seen before the 2026-10-19 retune, so it
 * is no longer a clean test) and `h2-…` (the fresh set, written by an agent that never saw the rules or the other
 * pairs, and measured only after the retune: the estimate that counts for G1 and G2).
 */
const isHeldOut = (p: MeaningPair) => p.id.startsWith("h-") || p.id.startsWith("h2-");
const isFresh = (p: MeaningPair) => p.id.startsWith("h2-");
/** Worked examples in the rubric: labelled for calibration, never evidence of the rules' accuracy. */
const isAnchor = (p: MeaningPair) => states.get(p.id)!.anchor;

/**
 * The pair's expected code, or `caveat_dropped` where a trade-off or compound pair expects `qualifier_dropped`: those
 * pairs were labelled before the caveat got its own code (a cost joined to the claim, dropped or inverted).
 */
function rightCode(p: MeaningPair, code: ReviewCode): boolean {
  if (code === p.expect) return true;
  return code === "caveat_dropped" && p.expect === "qualifier_dropped" && (p.kind === "trade_off" || p.kind === "compound");
}

function measure(subset: readonly MeaningPair[]): Row[] {
  return MEANING_KINDS.map((kind) => {
    const set = subset.filter((p) => p.kind === kind);
    const row: Row = { kind, pairs: set.length, faithful: 0, distorted: 0, caught: 0, expectedCode: 0, falseAlarms: 0, missed: [], alarms: [] };
    for (const p of set) {
      const flags = flagsOf(p);
      if (p.label === "faithful") {
        row.faithful++;
        if (flags.length) {
          row.falseAlarms++;
          row.alarms.push(`${p.id} (${flags.map((f) => f.code).join(", ")})`);
        }
      } else {
        row.distorted++;
        if (flags.length) row.caught++;
        else row.missed.push(p.id);
        if (p.expect && flags.some((f) => rightCode(p, f.code))) row.expectedCode++;
      }
    }
    return row;
  });
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");

describe("labelled paraphrase set (§7.2)", () => {
  it("keeps the balance rules as drafted (final labels: G0, meaningLabels.test.ts): ≥ 200 pairs, ≥ 20 per kind with ≥ 8 faithful and ≥ 8 distorted", () => {
    expect(allPairs.length).toBeGreaterThanOrEqual(200);
    for (const kind of MEANING_KINDS) {
      const set = allPairs.filter((p) => p.kind === kind);
      expect(set.length, kind).toBeGreaterThanOrEqual(20);
      expect(set.filter((p) => p.label === "faithful").length, kind).toBeGreaterThanOrEqual(8);
      expect(set.filter((p) => p.label === "distorted").length, kind).toBeGreaterThanOrEqual(8);
    }
  });

  it("has well-formed pairs: unique ids, known kinds and labels, an expected code on each distortion", () => {
    expect(new Set(allPairs.map((p) => p.id)).size).toBe(allPairs.length);
    for (const p of allPairs) {
      expect(MEANING_KINDS).toContain(p.kind);
      expect(["faithful", "distorted"]).toContain(p.label);
      expect(p.source.trim() && p.card.trim()).toBeTruthy();
      expect(typeof p.labelledBy).toBe("string");
      if (p.label === "distorted") expect(p.expect, p.id).toBeTruthy();
      else expect(p.source === p.card, p.id).toBe(false);
    }
  });

  it("reports recall and false alarms per kind (targets enforced only for approved labels)", () => {
    const rows = measure(pairs);
    const drafts = pairs.filter(isDraft).length;
    const table = (title: string, rs: Row[]) => [
      title,
      "kind       | pairs | F/D   | recall        | right code | false alarms | target (recall / FA)",
      ...rs.map(
        (r) =>
          `${r.kind.padEnd(10)} | ${String(r.pairs).padStart(5)} | ${`${r.faithful}/${r.distorted}`.padEnd(5)} | ${`${pct(r.caught, r.distorted)} (${r.caught}/${r.distorted})`.padEnd(13)} | ${pct(r.expectedCode, r.distorted).padEnd(10)} | ${`${pct(r.falseAlarms, r.faithful)} (${r.falseAlarms}/${r.faithful})`.padEnd(12)} | ${RECALL_TARGET[r.kind] !== undefined ? `≥ ${RECALL_TARGET[r.kind]! * 100}%` : "—"} / ≤ ${FALSE_ALARM_TARGET * 100}%`,
      ),
      ...rs.filter((r) => r.missed.length || r.alarms.length).map((r) => `  ${r.kind}: missed ${r.missed.join(" ") || "none"}; false alarms ${r.alarms.join(" ") || "none"}`),
    ];
    // The honest estimate: held-out and not a rubric example. Anchors are reported on their own, as calibration only.
    const heldOut = pairs.filter((p) => isHeldOut(p) && !isAnchor(p));
    const anchors = pairs.filter(isAnchor);
    const lines = [
      `Meaning rules vs labelled set (${pairs.length} pairs, ${drafts} still draft labels, ${pairs.filter((p) => states.get(p.id)!.provisional).length} provisional (model consensus, not human-validated); targets ${ENFORCE ? "ENFORCED" : "reported only"})`,
      ...table("All pairs", rows),
      ...table(`Tuned-on pairs, not anchors (${pairs.filter((p) => !isHeldOut(p) && !isAnchor(p)).length}; optimistic: the rules were tuned against these)`, measure(pairs.filter((p) => !isHeldOut(p) && !isAnchor(p)))),
      ...table(`Fresh held-out pairs (${heldOut.filter(isFresh).length}; never seen by the rules' author: the estimate that counts)`, measure(heldOut.filter(isFresh))),
      ...table(`First held-out pairs, not anchors (${heldOut.filter((p) => !isFresh(p)).length}; their misses were known before the retune)`, measure(heldOut.filter((p) => !isFresh(p)))),
      ...table(`Anchor pairs (${anchors.length}; rubric examples, calibration only, not evidence)`, measure(anchors)),
      ...(drafts < pairs.length ? table(`Human-labelled pairs only (${pairs.length - drafts})`, measure(pairs.filter((p) => !isDraft(p)))) : []),
    ];
    // MEANING_DEBUG=ql-16,ng-03 prints the flags of those pairs, for tuning.
    for (const id of (process.env.MEANING_DEBUG ?? "").split(",").filter(Boolean)) {
      const p = pairs.find((x) => x.id === id);
      if (p) lines.push(`  ${id} [${p.label}] ${p.source} → ${p.card}\n    ${JSON.stringify(flagsOf(p).map((f) => `${f.code}: ${f.detail}`))}`);
    }
    console.log(lines.join("\n"));

    if (!ENFORCE || drafts > 0) return;
    for (const r of rows) {
      const target = RECALL_TARGET[r.kind];
      if (target !== undefined) expect(r.caught / r.distorted, `${r.kind} recall`).toBeGreaterThanOrEqual(target);
      expect(r.falseAlarms / r.faithful, `${r.kind} false alarms`).toBeLessThanOrEqual(FALSE_ALARM_TARGET);
    }
  });
});
