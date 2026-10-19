/**
 * Plain cards: content shown as it is, with no model call (topic merge: parts AI couldn't place, `merge/unsure.ts` rule 6).
 *
 * Each unit becomes one section holding one card with the unit's text verbatim — a text card, or a page card when it is long — framed
 * and keyed like any generated section (so a later update recognises and keeps it), but never outlined, planned or analysed.
 * A visible card is a rendering state, not a decision about where the content belongs.
 *
 * Pure: units in, a raw `sectioned` plan and the sections out.
 */
import { mergeUnitPlans } from "@/ai/reconcile/keys";
import { labelOfUnit, wrapSections } from "@/ai/visual-plan/groups";
import { sectionKind } from "@/ai/visual-plan/sectionKinds";
import { sectionKeyOf, type OutlineSection } from "@/ai/visualize/outline";
import { normalizeUnitText, type AnalysisUnit } from "./units";

/** Longer than this a card is a page (the same cut the section fallback uses). */
const PAGE_CHARS = 2_000;

/** The card's node: the unit's text verbatim; a page keeps its heading as its title and the rest as its body. */
function cardOf(unit: AnalysisUnit, label: string) {
  if (unit.text.length <= PAGE_CHARS) return { id: "n1", type: "text", origin: "plain", content: { markdown: unit.text } };
  const body = unit.text.replace(/^#{1,6}\s[^\n]*\n+/, "");
  return { id: "n1", type: "page", origin: "plain", content: { title: label, markdown: body } };
}

/** A unit's raw plan reply as a plain card, in the shape a model's reply has (so it merges and frames like one). */
export const plainReply = (unit: AnalysisUnit, template: string) => ({ version: 1, template, nodes: [cardOf(unit, labelOfUnit(unit.key))], relationships: [] });

/**
 * The runs of consecutive units whose text, joined as the document has it, is exactly one of `texts` (a section as the merge wrote it,
 * normalised): a section with bold-line titles inside is several units, but one card. In document order; a unit is in at most one run.
 */
export function plainRuns(units: readonly AnalysisUnit[], texts: ReadonlySet<string>): AnalysisUnit[][] {
  const runs: AnalysisUnit[][] = [];
  const norm = units.map((u) => normalizeUnitText(u.text));
  let i = 0;
  while (i < units.length) {
    let acc = "";
    let end = -1;
    for (let j = i; j < units.length; j++) {
      acc = j === i ? norm[j]! : `${acc}\n\n${norm[j]!}`;
      if (texts.has(acc)) {
        end = j;
        break;
      }
      if (![...texts].some((t) => t.startsWith(acc))) break;
    }
    if (end < 0) i++;
    else {
      runs.push(units.slice(i, end + 1) as AnalysisUnit[]);
      i = end + 1;
    }
  }
  return runs;
}

/** The units lying inside each span (an unplaced section's place in the merged text), one run per span that holds any. */
export function plainRunsBySpans(units: readonly AnalysisUnit[], spans: readonly { start: number; end: number }[]): AnalysisUnit[][] {
  return spans.flatMap((s) => {
    const run = units.filter((u) => u.span.start >= s.start && u.span.start < s.end); // a unit belongs to the section it starts in (its span runs on to the next heading)
    return run.length ? [run] : [];
  });
}

/** One card per run: a section of its own holding the run's text verbatim (its units joined as the document has them). */
export function plainCards(runs: readonly (readonly AnalysisUnit[])[], idPrefix: string): { raw: { nodes: unknown[]; relationships: unknown[] }; sections: OutlineSection[] } {
  const cards = runs.map((run) => ({ unit: { key: sectionKeyOf(run.map((u) => u.key)), text: run.map((u) => u.text).join("\n\n"), span: { start: run[0]!.span.start, end: run.at(-1)!.span.end } } satisfies AnalysisUnit, units: run.map((u) => u.key) }));
  const sections = cards.map(({ unit, units }): OutlineSection => {
    const kind = "notes" as const;
    return { key: unit.key, units, label: labelOfUnit(units[0]!), kind, prominence: "primary", arrangement: sectionKind(kind).arrangement };
  });
  const merged = mergeUnitPlans(
    "sectioned",
    cards.map(({ unit }, i) => ({ unitKey: unit.key, raw: { version: 1, template: "sectioned", nodes: [cardOf(unit, sections[i]!.label)], relationships: [] } })),
    idPrefix,
  );
  const raw = wrapSections(merged, sections, { idPrefix, flat: true, titleKey: null }) as { nodes?: unknown[]; relationships?: unknown[] };
  // Every node of a plain section, its title heading included, is marked: none of them is ever folded into an overflow page.
  const nodes = (raw.nodes ?? []).map((n) => ({ ...(n as object), origin: "plain" }));
  return { raw: { nodes, relationships: raw.relationships ?? [] }, sections };
}

/** A short stable hash of a card's text: its key, so the same passage is the same object on every later update. */
const textKey = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])\s/;
const listKind = (block: string) => (/^\d/.test(block) ? "ordered" : "bullet");

/**
 * The cards' blocks: the paragraphs, except that a list kept apart by blank lines (a loose list: each item its own paragraph) is one block, items
 * separated as they were. A fenced code block is already one paragraph (`paragraphsOf`), a table has no blank lines; both stay whole.
 */
export function economyBlocks(paragraphs: readonly string[]): string[] {
  const blocks: string[] = [];
  let listOpen = false;
  for (const p of paragraphs) {
    const item = LIST_ITEM.test(p);
    if (item && listOpen && listKind(blocks.at(-1)!) === listKind(p)) blocks[blocks.length - 1] = `${blocks.at(-1)}\n\n${p}`;
    else blocks.push(p);
    listOpen = item;
  }
  return blocks;
}

/**
 * Economy mode: the paragraphs appended to an existing section as a reply the update reads like a model's (`appended`: every node the
 * section has is kept as it is): one verbatim `text` card per block (`economyBlocks`), no links, no analysis, no model call.
 */
export function economyCards(paragraphs: readonly string[]): { version: 1; template: "sectioned"; nodes: { id: string; type: "text"; stableKey: string; content: { markdown: string } }[]; relationships: never[] } {
  return {
    version: 1,
    template: "sectioned",
    nodes: economyBlocks(paragraphs).map((markdown, i) => ({ id: `e${i + 1}`, type: "text" as const, stableKey: `added#${textKey(markdown)}`, content: { markdown } })),
    relationships: [],
  };
}
