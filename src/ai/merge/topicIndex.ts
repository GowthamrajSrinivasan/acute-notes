/**
 * The topic shortlist (`.ai/docs/topic-shortlist-plan.md`, phases 1-2): which topics a typed assignment request shows for a part, instead of
 * all of them. Retrieval only: similarity never decides where a part goes, and a low score is never evidence that a part is new. The typed
 * decision still decides, and anything the shortlist cannot support is asked again with the full list (`assign.ts`).
 *
 * Candidates, best evidence first:
 * - the plan's starting k (8) topics by lexical BM25 over the part (with the headings it sits under) against each topic's label and text
 *   (`bm25+ctx`, the best of the measured variants: `data/shortlist-recall-2026-10-10.txt`), plus every topic tied with the k-th;
 * - the topic with the part's own heading, the topic its parent heading names, and the topics of its siblings' own headings (the plan's
 *   parent/sibling context, from headings only: no sibling has been answered yet when a request is built).
 *
 * No score threshold: the shortlist is the full list (`null`) when there is no overlap evidence at all, when it would cover every topic, or
 * when the notes have no more topics than k. BM25's k1 and b are the conventional defaults, not tuned.
 */
import { significant } from "@/ai/fidelity/information";
import { labelOfUnit } from "@/ai/visual-plan/groups";

/** The plan's starting shortlist size. The saved recall measured @3, @5, @8, @12, @20: nothing supports another value yet. */
export const SHORTLIST_K = 8;
const K1 = 1.2;
const B = 0.75;
const SEP = " › ";

export interface IndexedTopic {
  key: string;
  label: string;
  text: string;
}
export interface QueriedPart {
  key: string;
  text: string;
  /** The headings the part sits under in its own document. */
  context?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const parentKeyOf = (key: string) => key.split(SEP).slice(0, -1).join(SEP);

/** Per-topic BM25 scores of a query, in topic order (0 = no overlap). */
export function bm25Scores(topics: readonly IndexedTopic[], query: string): number[] {
  const docs = topics.map((t) => significant(`${t.label} ${t.text}`));
  const lengths = docs.map((d) => d.length);
  const avg = lengths.reduce((n, l) => n + l, 0) / Math.max(1, docs.length) || 1;
  const tf = docs.map((d) => {
    const counts = new Map<string, number>();
    for (const w of d) counts.set(w, (counts.get(w) ?? 0) + 1);
    return counts;
  });
  const terms = [...new Set(significant(query))];
  const df = new Map(terms.map((w) => [w, tf.filter((c) => c.has(w)).length] as const));
  return docs.map((_, i) =>
    terms.reduce((score, w) => {
      const f = tf[i]!.get(w) ?? 0;
      if (!f) return score;
      const n = df.get(w)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      return score + (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * lengths[i]!) / avg));
    }, 0),
  );
}

export interface Shortlist {
  /** Topic indices to show, ascending (their original `t{n}` ids stay the same). */
  indices: number[];
  /** How many came from retrieval, and how many only from the heading/parent/sibling context. */
  retrieved: number;
  contextOnly: number;
}

/**
 * The topics to show for `parts[at]`, or null when the full list must be shown (see the module comment). `parts` are the other parts of the
 * same request: their own headings name the siblings' topics.
 */
export function shortlistFor(topics: readonly IndexedTopic[], parts: readonly QueriedPart[], at: number, k = SHORTLIST_K): Shortlist | null {
  if (topics.length <= k) return null;
  const part = parts[at]!;
  const leaf = norm(labelOfUnit(part.key));
  const query = [part.context ?? "", labelOfUnit(part.key), part.text].join("\n");
  const scores = bm25Scores(topics, query);
  const ranked = scores.flatMap((s, i) => (s > 0 ? [i] : [])).sort((a, b) => scores[b]! - scores[a]! || a - b);
  // Nothing in common with any topic: there is no evidence to shortlist by, so every topic stays a candidate.
  if (!ranked.length) return null;
  const chosen = new Set(ranked.slice(0, k));
  // A flat cut: every topic tied with the last one kept is as good a candidate as it.
  if (ranked.length > k) for (const i of ranked.slice(k)) if (scores[i] === scores[ranked[k - 1]!]) chosen.add(i);
  const retrieved = chosen.size;
  const parent = parentKeyOf(part.key);
  const parentLeaf = parent ? norm(labelOfUnit(parent)) : "";
  const siblings = new Set(parts.filter((p, i) => i !== at && parentKeyOf(p.key) === parent).map((p) => norm(labelOfUnit(p.key))));
  topics.forEach((t, i) => {
    const label = norm(t.label);
    if (label === leaf || t.key === parent || (parentLeaf && label === parentLeaf) || siblings.has(label)) chosen.add(i);
  });
  if (chosen.size >= topics.length) return null;
  return { indices: [...chosen].sort((a, b) => a - b), retrieved, contextOnly: chosen.size - retrieved };
}
