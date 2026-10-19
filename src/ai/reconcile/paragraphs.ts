/**
 * Expansions on the local tier (F38b, PRD §13.15.19a). With no model to judge
 * meaning, the local planner keeps each section's prose as one `text` node, so
 * a follow-up reply that adds a paragraph to an existing section would grow
 * that section's block into one merged wall of text. On an *update*, this
 * applies the structural reading of the F38b rule instead:
 *
 * - a paragraph that corresponds to one already on the canvas (the same
 *   words, or mostly the same — a correction) stays where it was: in the
 *   section's block, or in the explanation it was split into earlier;
 * - a paragraph with no counterpart is new detail about that section: its own
 *   `text` node, linked `explained_by` from the section's block, under a new
 *   key `<section key> › detail#n` (never renumbered, so later updates match it);
 * - a counterpart that's gone is simply absent (F38 proposes the removal).
 *
 * The split lives in the accepted plan (`ContentSourceVersion.plan`), so the
 * next update aligns against it again — paste after paste, the section block
 * and each explanation keep their own identity. First runs are untouched: a
 * section always starts as one block.
 */
import { fenceMask } from "@/ai/content/fences";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";

export { fenceMask };

const DETAIL = " › detail#";
/** Enough shared wording to be "the same paragraph, corrected" rather than a new one. */
const SAME_PARAGRAPH = 0.5;

type TextNode = Extract<VisualNode, { type: "text" }>;

/** The paragraphs of `markdown`: blocks separated by blank lines, except that a blank line inside a fenced code block never separates (the block stays whole). */
export function paragraphsOf(markdown: string): string[] {
  const lines = markdown.split("\n");
  const inFence = fenceMask(lines);
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const p = current.join("\n").trim();
    if (p) out.push(p);
    current = [];
  };
  lines.forEach((line, i) => {
    if (!inFence[i] && /^\s*$/.test(line)) flush();
    else current.push(line);
  });
  flush();
  return out;
}

/** `markdown` without its heading lines (`## …`); a `#` line inside a fenced code block (a shell comment) is code, not a heading, and stays. */
function withoutHeadingLines(markdown: string): string {
  const lines = markdown.split("\n");
  const inFence = fenceMask(lines);
  return lines.filter((l, i) => inFence[i] || !/^#{1,6}\s/.test(l.trim())).join("\n");
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** Share of the smaller paragraph's words the two have in common (1 = identical wording, 0 = nothing shared). */
export function paragraphSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

const isText = (n: VisualNode | undefined): n is TextNode => n?.type === "text";

/** `next` with each existing section's new paragraphs split out as linked explanations (see the module comment). */
export function splitExpansions(next: VisualPlan, previous: VisualPlan): VisualPlan {
  const before = new Map(previous.nodes.flatMap((n) => (n.stableKey ? [[n.stableKey, n] as const] : [])));
  const nodes: VisualNode[] = [];
  const relationships: VisualRelationship[] = [...next.relationships];

  for (const node of next.nodes) {
    const key = node.stableKey;
    const prior = key ? before.get(key) : undefined;
    // Only prose of a section that was already there, and never inside code (blank lines there aren't paragraph breaks).
    if (!key || !isText(node) || !isText(prior) || node.content.markdown.includes("```")) {
      nodes.push(node);
      continue;
    }
    const details = previous.nodes.filter((n): n is TextNode => isText(n) && !!n.stableKey?.startsWith(`${key}${DETAIL}`));
    // Previous paragraphs, each with the node that shows it: the section block itself, or one of its explanations.
    const slots = [...paragraphsOf(prior.content.markdown).map((text) => ({ text, owner: key })), ...details.flatMap((d) => paragraphsOf(d.content.markdown).map((text) => ({ text, owner: d.stableKey! })))];
    const used = new Set<number>();
    const owned = paragraphsOf(node.content.markdown).map((text) => {
      let best = -1;
      let score = SAME_PARAGRAPH;
      slots.forEach((s, i) => {
        const sim = used.has(i) ? -1 : paragraphSimilarity(text, s.text);
        if (sim >= score && (best < 0 || sim > score)) {
          best = i;
          score = sim;
        }
      });
      if (best >= 0) used.add(best);
      return { text, owner: best >= 0 ? slots[best]!.owner : null };
    });
    // The section keeps at least one paragraph: if none still resembles its old one, the first unmatched one replaced it.
    if (!owned.some((p) => p.owner === key)) {
      const first = owned.find((p) => p.owner === null);
      if (first) first.owner = key;
    }
    if (!owned.some((p) => p.owner !== key)) {
      nodes.push(node); // nothing to split out: exactly F38's behaviour
      continue;
    }

    const section: TextNode = { ...node, content: { markdown: owned.filter((p) => p.owner === key).map((p) => p.text).join("\n\n") } };
    delete section.sourceSpan; // its span no longer maps to one node's content
    nodes.push(section);
    // Explanations kept from earlier versions, then new ones under the next unused number.
    for (const d of details) {
      const texts = owned.filter((p) => p.owner === d.stableKey).map((p) => p.text);
      if (!texts.length) continue; // gone from the content → F38 proposes removing it
      const kept: TextNode = { ...d, id: `${node.id}__${d.stableKey!.slice(key.length + DETAIL.length)}`, content: { markdown: texts.join("\n\n") } };
      nodes.push(kept);
      relationships.push({ from: section.id, to: kept.id, type: "explained_by" });
    }
    let n = Math.max(-1, ...details.map((d) => Number(d.stableKey!.slice(key.length + DETAIL.length)) || 0)) + 1;
    for (const p of owned.filter((o) => o.owner === null)) {
      const detail: TextNode = { id: `${node.id}__${n}`, type: "text", stableKey: `${key}${DETAIL}${n}`, content: { markdown: p.text } };
      n++;
      nodes.push(detail);
      relationships.push({ from: section.id, to: detail.id, type: "explained_by" });
    }
  }
  return { ...next, nodes, relationships };
}

export interface ParagraphChanges {
  /** New paragraphs that correct one that was there (same point, different facts or wording). */
  edited: string[];
  /** Paragraphs with no counterpart before: new detail or a new concept. */
  added: string[];
}

/**
 * How a section's prose changed, paragraph by paragraph (heading lines
 * ignored), with the same alignment `splitExpansions` uses. Given to the model
 * on an update (F38b) as facts about the text, so "a corrected sentence" and
 * "a new paragraph" never have to be guessed.
 */
export function paragraphChanges(before: string, after: string): ParagraphChanges {
  const prose = (t: string) => paragraphsOf(withoutHeadingLines(t));
  const old = prose(before);
  const used = new Set<number>();
  const edited: string[] = [];
  const added: string[] = [];
  for (const p of prose(after)) {
    const same = old.findIndex((o, i) => !used.has(i) && o === p);
    if (same >= 0) {
      used.add(same);
      continue;
    }
    let best = -1;
    let score = SAME_PARAGRAPH;
    old.forEach((o, i) => {
      const sim = used.has(i) ? -1 : paragraphSimilarity(p, o);
      if (sim >= score && (best < 0 || sim > score)) {
        best = i;
        score = sim;
      }
    });
    if (best >= 0) {
      used.add(best);
      edited.push(p);
    } else added.push(p);
  }
  return { edited, added };
}

/**
 * The paragraphs appended to a section whose earlier paragraphs are all still there, word for word (heading lines ignored);
 * null when any was edited or removed, or nothing was added. Such a section needs only its new paragraphs generated.
 */
export function appendedParagraphs(before: string, after: string): string[] | null {
  const { edited, added } = paragraphChanges(before, after);
  if (edited.length || !added.length) return null;
  // Nothing of before is missing from after: the same comparison the other way finds no edited or added paragraph.
  const back = paragraphChanges(after, before);
  return back.edited.length || back.added.length ? null : added;
}
