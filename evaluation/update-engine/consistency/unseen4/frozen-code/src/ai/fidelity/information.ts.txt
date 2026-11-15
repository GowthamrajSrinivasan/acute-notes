/**
 * The information a plan's nodes carry, as a bag of words (content fidelity plan §1: "validation never decreases
 * information"). Deterministic and wording-level: it measures *what text survives*, not meaning, so it is the
 * right tool for checking the validator's repairs (which never paraphrase) — not for judging a model's plan.
 */

/** Every human-readable string a raw or validated node carries: title, labels, text, cells, items, code. */
export function nodeStrings(node: unknown): string[] {
  if (!isObject(node)) return [];
  const out: string[] = [];
  if (typeof node.title === "string") out.push(node.title);
  collect(node.content, out);
  return out;
}

function collect(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      // Presentation choices, not information.
      if (key === "shape" || key === "arrangement" || key === "checked") continue;
      collect(v, out);
    }
  }
}

/** Lower-cased word tokens (letters/digits, keeping in-word `.`, `_`, `-`, `/`), so "18.78" and "wl5_inj" stay whole. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:[._\-/][\p{L}\p{N}]+)*/gu) ?? []);
}

const STOP = new Set(
  (
    "the a an and or but if of to in on at by for with from as is are was were be been being it its this that these those there here " +
    "not no nor so than then too very can will just do does did done has have had having i you he she we they them his her our your their " +
    "which who whom what when where why how all any both each few more most other some such only own same also into over under again once " +
    "about above below between through during before after up down out off one per via vs etc may might must should would could"
  ).split(" "),
);

/** The words that carry a text's information: not stop words, and 3+ characters or with a digit. */
export const significant = (text: string): string[] => words(text).filter((w) => !STOP.has(w) && (w.length >= 3 || /\d/.test(w)));

/** A source unit is covered when at least this share of its significant words appears in the plan. */
export const COVERAGE_THRESHOLD = 0.7;

/** The share (0–1) of `text`'s distinct significant words found in `vocabulary`; 1 for a text with none. */
export function coverageOf(text: string, vocabulary: ReadonlySet<string>): number {
  const sig = [...new Set(significant(text))];
  return sig.length ? sig.filter((w) => vocabulary.has(w)).length / sig.length : 1;
}

/**
 * Key terms: the details a condensed summary drops first — numbers, versions, paths and identifiers (`18.7786`,
 * `0.5`, `tolerances.aggregate_gap_pct`, `wl5_inj`): tokens with a digit or an inner `.`, `_` or `/`, or a long
 * hyphenated one. Each must survive verbatim.
 */
export function keyTerms(text: string): string[] {
  return [...new Set(words(text.replace(/\*\*|`/g, "")).filter((w) => /\d/.test(w) || /[._/]/.test(w) || (/-/.test(w) && w.length > 6)))];
}

/** The word multiset of a list of nodes. */
export function informationOf(nodes: readonly unknown[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const node of nodes) for (const s of nodeStrings(node)) for (const w of words(s)) bag.set(w, (bag.get(w) ?? 0) + 1);
  return bag;
}

/** Words of `before` that `after` no longer carries (by count), for "information out ≥ information in" checks. */
export function missingWords(before: readonly unknown[], after: readonly unknown[]): string[] {
  const kept = informationOf(after);
  const missing: string[] = [];
  for (const [w, n] of informationOf(before)) if ((kept.get(w) ?? 0) < n) missing.push(w);
  return missing;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
