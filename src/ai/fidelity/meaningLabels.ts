/**
 * Human labels for the paraphrase set (`.ai/docs/knowledge-notes-plan.md` §7.2, OD7, gate G0;
 * `.ai/docs/meaning-labelling-rubric.md`). The drafted `label` in `pairs.json` is never the answer: people label each
 * pair blind (`tools/meaning-labelling/index.html`), every *partly*, *unsure* and disagreement is resolved, and only
 * then does a pair have a final label the meaning rules are measured against.
 *
 * Files, all in `src/ai/fidelity/__fixtures__/meaning/`:
 * - `labels/<name>.json`: one labeller's answers (`LabellerFile`), exported by the labelling page.
 * - `resolutions.json`: how each disputed pair was settled (`Resolution`). Rewriting a pair is done in `pairs.json`
 *   itself; its old answers then no longer match its text and count as stale, so it is labelled again.
 * - `labelling.json`: the rubric version, the 50-pair sample a second person labels, and the anchors (pairs that are
 *   worked examples in the rubric, so nobody labels them blind).
 *
 * Pure: data in, statuses and agreement out.
 */
import type { MeaningKind, MeaningPair } from "./contracts";
import { MEANING_KINDS } from "./contracts";

export type LabelAnswer = "faithful" | "partly" | "distorted" | "unsure";

export interface LabelRecord {
  answer: LabelAnswer;
  /** Required for partly and unsure; for distorted, the false belief in one sentence (rubric "Test"). */
  note?: string;
  /** The pair's text when it was labelled. A pair rewritten since then makes this answer stale. */
  source: string;
  card: string;
  /** ISO time. */
  at: string;
}

export interface LabellerFile {
  labeller: string;
  /**
   * `human` (the default): a person judged every answer; it counts for G0. `model`: an AI filled it in
   * (`scripts/meaning-sheet.mjs`); it is reported beside the human answers and never decides a final label, because
   * OD7 makes the labels people's and a model's view is the offline judge of §7.2 step 2, not evidence.
   */
  type?: "human" | "model";
  model?: string;
  rubricVersion: number;
  labels: Record<string, LabelRecord>;
}

export interface Resolution {
  outcome: "faithful" | "distorted" | "remove";
  /** Why, in a sentence; and what changed in the rubric, if it did. */
  note: string;
  by: string;
  /** The pair's text when it was resolved; a later rewrite makes the resolution stale too. */
  source: string;
  card: string;
}

export interface LabellingConfig {
  rubricVersion: number;
  /** Pairs a second person labels too (plan §7.2: a 50-pair sample, at least 5 per kind). */
  sample: string[];
  /** Pairs shown with their answer in the rubric: labelled for calibration, never part of the sample. */
  anchors: string[];
  /**
   * Who may settle a pair. `human` (OD7 as approved): people only. `model-consensus` (the user's decision, recorded
   * here and in the plan's §12): two independent labellers, models included, must give the same definite answer; a
   * pair they disagree on is excluded, never guessed. Labels settled that way are `provisional`: never described as
   * human-validated. A person's resolution always wins.
   */
  policy?: { mode: "human" | "model-consensus"; decidedBy: string; note: string };
}

export type PairStatus =
  /** No current answer yet. */
  | "unlabelled"
  /** In the sample and labelled by one person so far. */
  | "needs_second"
  /** An answer is partly or unsure, or two answers differ: needs a resolution. */
  | "disputed"
  /** Every answer is the same definite label (and the sample has two). */
  | "agreed"
  | "resolved"
  | "removed"
  /** `model-consensus` only: two labellers disagree (or one is partly / unsure), so the pair is left out. */
  | "excluded";

export interface PairLabelState {
  id: string;
  kind: MeaningKind;
  heldOut: boolean;
  anchor: boolean;
  inSample: boolean;
  status: PairStatus;
  /** The label the rules are measured against; absent until agreed or resolved. */
  final?: "faithful" | "distorted";
  /** Current human answers, by labeller. */
  answers: { labeller: string; answer: LabelAnswer; note?: string }[];
  /** Current model answers: reported, never final. */
  modelAnswers: { labeller: string; answer: LabelAnswer; note?: string }[];
  /** Labellers whose answer predates a rewrite of the pair. */
  stale: string[];
  /** The final label differs from the drafted one: the pair's `expect` needs a look. */
  changedFromDraft: boolean;
  /** Final by model consensus, not by a person (`policy.mode` `model-consensus`). */
  provisional?: boolean;
}

const consensusOf = (config: LabellingConfig) => config.policy?.mode === "model-consensus";

/** The answers that may settle a pair: people's, plus models' under `model-consensus`. */
export const countedAnswers = (s: PairLabelState, config: LabellingConfig) => (consensusOf(config) ? [...s.answers, ...s.modelAnswers] : s.answers);

const isCurrent = (r: { source: string; card: string }, p: MeaningPair) => r.source === p.source && r.card === p.card;

export function pairStates(
  pairs: readonly MeaningPair[],
  files: readonly LabellerFile[],
  resolutions: Readonly<Record<string, Resolution>>,
  config: LabellingConfig,
): PairLabelState[] {
  const sample = new Set(config.sample);
  const anchors = new Set(config.anchors);
  return pairs.map((p) => {
    const answers: PairLabelState["answers"] = [];
    const modelAnswers: PairLabelState["modelAnswers"] = [];
    const stale: string[] = [];
    for (const f of files) {
      const r = f.labels[p.id];
      if (!r) continue;
      if (isCurrent(r, p)) (f.type === "model" ? modelAnswers : answers).push({ labeller: f.labeller, answer: r.answer, ...(r.note ? { note: r.note } : {}) });
      else stale.push(f.labeller);
    }
    const inSample = sample.has(p.id);
    const base = { id: p.id, kind: p.kind, heldOut: p.id.startsWith("h-"), anchor: anchors.has(p.id), inSample, answers, modelAnswers, stale };
    const resolution = resolutions[p.id];
    if (resolution && isCurrent(resolution, p)) {
      if (resolution.outcome === "remove") return { ...base, status: "removed", changedFromDraft: false };
      return { ...base, status: "resolved", final: resolution.outcome, changedFromDraft: resolution.outcome !== p.label };
    }
    const consensus = consensusOf(config);
    const counted = consensus ? [...answers, ...modelAnswers] : answers;
    if (!counted.length) return { ...base, status: "unlabelled", changedFromDraft: false };
    const distinct = new Set(counted.map((a) => a.answer));
    const definite = distinct.size === 1 && (distinct.has("faithful") || distinct.has("distorted"));
    // Under consensus every pair needs two labellers, and a split is left out rather than resolved by anyone.
    if (!definite) return { ...base, status: consensus && counted.length >= 2 ? "excluded" : "disputed", changedFromDraft: false };
    if ((consensus || inSample) && counted.length < 2) return { ...base, status: "needs_second", changedFromDraft: false };
    const final = counted[0]!.answer as "faithful" | "distorted";
    return { ...base, status: "agreed", final, changedFromDraft: final !== p.label, ...(consensus && answers.length < 2 ? { provisional: true } : {}) };
  });
}

/** Cohen's kappa over pairs two people labelled (the first two answers), partly and unsure as their own categories. */
export function agreement(states: readonly PairLabelState[], config?: LabellingConfig): { pairs: number; agreed: number; kappa: number | null } {
  const doubled = states
    .map((s) => (config ? countedAnswers(s, config) : s.answers))
    .filter((a) => a.length >= 2)
    .map((a) => [a[0]!.answer, a[1]!.answer] as const);
  const n = doubled.length;
  if (!n) return { pairs: 0, agreed: 0, kappa: null };
  const agreed = doubled.filter(([a, b]) => a === b).length;
  const cats: LabelAnswer[] = ["faithful", "partly", "distorted", "unsure"];
  const expected = cats.reduce((sum, c) => sum + (doubled.filter(([a]) => a === c).length / n) * (doubled.filter(([, b]) => b === c).length / n), 0);
  const observed = agreed / n;
  return { pairs: n, agreed, kappa: expected === 1 ? 1 : (observed - expected) / (1 - expected) };
}

export interface G0Check {
  label: string;
  ok: boolean;
  detail: string;
}

/** Gate G0 (plan §9): what is still missing before the labelled set can gate a release. */
export function g0Checks(states: readonly PairLabelState[], config: LabellingConfig): G0Check[] {
  const consensus = consensusOf(config);
  const kept = states.filter((s) => s.status !== "removed" && s.status !== "excluded");
  const final = kept.filter((s) => s.final);
  const twice = (s: PairLabelState) => countedAnswers(s, config).length >= 2 || s.status === "resolved";
  const sampleDone = consensus ? kept.filter(twice).length : states.filter((s) => s.inSample && s.answers.length >= 2).length;
  const open = states.filter((s) => s.status === "disputed").length;
  const perKind = MEANING_KINDS.map((k) => {
    const set = final.filter((s) => s.kind === k);
    return { k, n: set.length, f: set.filter((s) => s.final === "faithful").length, d: set.filter((s) => s.final === "distorted").length };
  });
  const weak = perKind.filter((x) => x.n < 20 || x.f < 8 || x.d < 8);
  return [
    { label: "Every kept pair has a final label", ok: final.length === kept.length, detail: `${final.length} of ${kept.length}` },
    consensus
      ? { label: "Every kept pair has two independent labellers (or a person's resolution)", ok: sampleDone >= kept.length, detail: `${sampleDone} of ${kept.length}` }
      : { label: "The sample is labelled twice", ok: sampleDone >= config.sample.length, detail: `${sampleDone} of ${config.sample.length}` },
    { label: "No dispute left open", ok: open === 0, detail: `${open} open` },
    {
      label: "At least 20 pairs per kind, 8 of each label (final labels)",
      ok: weak.length === 0,
      detail: weak.length ? weak.map((x) => `${x.k} ${x.n} (${x.f}/${x.d})`).join(", ") : "all kinds",
    },
  ];
}
