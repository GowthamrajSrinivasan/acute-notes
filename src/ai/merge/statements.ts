/**
 * Statements: the units a typed decision model points at when a part contradicts its topic (decision models plan §9.6). A typed model
 * can't write a quote, but it can choose one: the topic's text and the part's text are cut into numbered statements (a sentence, a list
 * item, a table row), the model picks the ids, and the exact statement text becomes the quote — so it is verbatim by construction.
 * Pure and deterministic: the same text always gives the same ids, so a request and the reading of its answers agree.
 */

export interface Statement {
  /** `<prefix>.s<n>`, n from 0, in text order (for example `t3.s2`, `p1.s0`). */
  id: string;
  /** Exactly as the text has it (a list marker or checkbox aside); line breaks inside a sentence become spaces. */
  text: string;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const CALLOUT = /^\s*>/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/;
const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** A sentence ends at . ! or ? followed by space and what starts a new one. */
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9"“(\[*_`])/;

export function statementsOf(text: string, prefix: string): Statement[] {
  const out: string[] = [];
  let paragraph: string[] = [];
  let fenced: string | null = null;
  const flush = () => {
    if (!paragraph.length) return;
    for (const s of paragraph.join(" ").split(SENTENCE_END)) if (s.trim()) out.push(s.trim());
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line)?.[1];
    if (fenced) {
      if (fence === fenced) fenced = null;
      continue;
    }
    if (fence) {
      flush();
      fenced = fence;
      continue;
    }
    if (!line.trim() || HEADING.test(line) || CALLOUT.test(line) || TABLE_RULE.test(line)) {
      flush();
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      out.push(item[1]!.trim());
    } else if (TABLE_ROW.test(line)) {
      flush();
      out.push(line.trim());
    } else paragraph.push(line.trim());
  }
  flush();
  return out.map((t, n) => ({ id: `${prefix}.s${n}`, text: t }));
}
