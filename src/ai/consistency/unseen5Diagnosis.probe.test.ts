/**
 * Opt-in (UNSEEN5_PROBE=1), read-only diagnosis of the unseen5 recording (plan §16.2): for the contradictions the
 * pipeline did not show as definite conflicts, and the ambiguous pairs shown as conflicts, print both statements, the
 * reference label's reason, the AI's answer and reason, and which guard decided. unseen5 is development evidence from
 * now on (review 2026-11-16); nothing here is fresh-generalisation evidence. Writes nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { combine, type JudgeAnswer } from "./judge";
import { judgementForCombine, screenPair } from "./screen";

const DIR = join(process.cwd(), "evaluation/update-engine/consistency/unseen5");
const read = <T,>(f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as T;
const IDS = ["y12", "y31", "y61", "y86", "y05", "y24", "y49", "y65", "y83", "y20", "y45"];

describe.skipIf(process.env.UNSEEN5_PROBE !== "1")("unseen5 diagnosis probe", () => {
  it("prints the evidence for the misses, the downgrades and the ambiguous conflicts", () => {
    const pairs = new Map(read<{ pairs: { id: string; a: string; b: string }[] }>("pairs.json").pairs.map((p) => [p.id, p]));
    const labels = read<{ labels: Record<string, { label: string; note: string }> }>("labels.json").labels;
    const cats = read<{ drafts: Record<string, { category: string }> }>("author-draft-key.json").drafts;
    const ai = read<Record<string, { answer: JudgeAnswer; why?: string }>>("runs/2026-11-15-unseen5/judgments.json");
    for (const id of IDS) {
      const p = pairs.get(id)!;
      const s = screenPair(p.a, p.b);
      const j = judgementForCombine(s);
      const c = combine(j, ai[id]);
      console.log(JSON.stringify({
        id, category: cats[id]!.category, label: labels[id]!.label, labelWhy: labels[id]!.note, a: p.a, b: p.b,
        ai: ai[id], screen: { decision: s.decision, reason: s.reason, scoped: s.scoped, exclusive: s.exclusive, thin: s.thin, evidence: (s as { evidence?: unknown }).evidence },
        combineInput: { kind: j.kind, contextDiffers: !!j.contextDiffers, thin: !!j.thin, exclusive: !!j.exclusive }, shown: c.shown, note: c.note,
      }));
    }
  });
});
