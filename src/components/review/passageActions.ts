/**
 * Add to canvas, Pin quote and Include (knowledge-notes-plan §5.1, §5.3, WP2.7; Lane H), as pure steps with no AI
 * call: a card draft from a passage (the integrator turns it into a canvas node with the local tier,
 * `ai/content/localPlanner.ts`), a card body with a passage pinned word for word, and the panel's outcome maps after
 * an Include.
 */
import type { SourcePanelData, SourceUnit, UnitId } from "@/ai/fidelity/contracts";

/** A card made from one passage: it cites that passage, so it is Represented and checkable like any other. */
export interface PassageCard {
  title: string;
  body: string;
  cites: UnitId[];
  /** Code arrives by reference, verbatim, as the pipeline places it (`REFERENCE_RULE`). */
  byReference?: boolean;
}

/** Longest title before it is cut at a word boundary. */
export const TITLE_MAX = 72;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** `text` cut at a word boundary to at most `max` characters, with "…"; a closing full stop is dropped. */
export function shortTitle(text: string, max = TITLE_MAX): string {
  const s = collapse(text).replace(/[.。]$/, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

/**
 * Add to canvas / Include: a card from the passage. The local tier can't restate an idea, so the title is the
 * passage's own opening and the body is the passage (only when the title didn't already say all of it).
 */
export function cardFromPassage(unit: SourceUnit): PassageCard {
  const text = unit.text.trim();
  if (unit.kind === "code") {
    const firstLine = text.split("\n").find((l) => l.trim() && !/^(```|~~~)/.test(l.trim())) ?? "";
    return { title: firstLine ? `Code: ${shortTitle(firstLine, TITLE_MAX - 6)}` : "Code", body: text, cites: [unit.id], byReference: true };
  }
  if (unit.kind === "table_row") {
    const cells = text.split(" | ").map(collapse).filter(Boolean);
    return { title: shortTitle(cells[0] ?? text), body: cells.length > 1 ? cells.join(" · ") : "", cites: [unit.id] };
  }
  const title = shortTitle(text);
  const said = collapse(text).replace(/[.。]$/, "") === title;
  return { title, body: said ? "" : collapse(text), cites: [unit.id] };
}

/** The passage as a quote block, one `> ` per line. */
export function quoteOf(unit: SourceUnit): string {
  return unit.text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`.trimEnd())
    .join("\n");
}

/**
 * Pin quote / Use source wording: the card's body with the passage, word for word, appended as a quote. Unchanged
 * when the body already carries it (pinning twice adds nothing). `cites` gains the passage if the card didn't cite it.
 */
export function pinQuote(card: { body: string; cites: readonly UnitId[] }, unit: SourceUnit): { body: string; cites: UnitId[]; changed: boolean } {
  const cites = card.cites.includes(unit.id) ? [...card.cites] : [...card.cites, unit.id];
  const plain = (s: string) => collapse(s.replace(/^>\s?/gm, ""));
  if (plain(card.body).includes(plain(unit.text))) return { body: card.body, cites, changed: cites.length !== card.cites.length };
  const body = card.body.trim() ? `${card.body.trimEnd()}\n\n${quoteOf(unit)}` : quoteOf(unit);
  return { body, cites, changed: true };
}

type PanelOutcomes = Pick<SourcePanelData, "outcome" | "reasons" | "onCanvas">;

/** Include is offered on a passage that is left out or needs review and isn't on the canvas yet. */
export function canInclude(data: PanelOutcomes, unit: UnitId): boolean {
  const o = data.outcome[unit];
  if (o === "omitted") return true;
  if (o !== "needs_review") return false;
  return data.onCanvas ? !data.onCanvas.includes(unit) : true;
}

/** The panel's maps after Include: the passage is Represented, on the canvas, its reasons cleared. New objects. */
export function includeUnit<T extends PanelOutcomes>(data: T, unit: UnitId): T {
  const reasons = { ...data.reasons };
  delete reasons[unit];
  return {
    ...data,
    outcome: { ...data.outcome, [unit]: "represented" },
    reasons,
    ...(data.onCanvas ? { onCanvas: data.onCanvas.includes(unit) ? data.onCanvas : [...data.onCanvas, unit] } : {}),
  };
}
