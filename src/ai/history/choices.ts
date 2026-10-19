/**
 * Choices in a content source's text (topic merge plan G3, `.ai/docs/chat-share-import-plan.md` §5.4): where sources
 * disagree and nothing says which one is current, the notes hold the options until the user picks one. A choice is a
 * Markdown callout in the source text itself — readable as is, kept in every version, exported like any text:
 *
 *   > [!choice] Database for v1
 *   > - Firestore for documents and assets. _(in your notes)_
 *   > - Postgres via Supabase. _(from “Merged content”, 2026-10-09)_
 *
 * Once the user has chosen, the same callout records it — the chosen option in bold, the others struck through:
 *
 *   > [!choice] Database for v1 — chosen
 *   > - **Postgres via Supabase.** _(from “Merged content”, 2026-10-09)_
 *   > - ~~Firestore for documents and assets.~~ _(in your notes)_
 *
 * Callouts are drawn by code (`choiceNodes.ts`), never by a model: they are taken out of the text a model, the change
 * check and the content safety net see (`withoutChoices`).
 *
 * Pure: strings in, strings out.
 */

export type OptionState = "open" | "chosen" | "not_chosen";

export interface ChoiceOption {
  statement: string;
  /** Where the option came from, as shown: "in your notes", or `from “…”, date`. */
  from: string;
  /** The option the notes' own text says (the one a choice of another option replaces there). */
  inNotes: boolean;
  state: OptionState;
}

export interface Choice {
  /** Stable within a text: the title's slug, with an ordinal when two choices share one. */
  id: string;
  title: string;
  resolved: boolean;
  options: ChoiceOption[];
  /** The callout's lines in the text, `text.slice(start, end)`. */
  span: { start: number; end: number };
}

export const IN_NOTES = "in your notes";
const HEAD = /^>\s*\[!choice\]\s*(.*?)\s*$/i;
const CHOSEN_SUFFIX = /\s+—\s+chosen$/i;
const ITEM = /^>\s*-\s+(.*)$/;
const FROM = /\s*_\((.*)\)_\s*$/;

/** Every choice callout in `text`, in order. */
export function findChoices(text: string): Choice[] {
  const lines = text.split("\n");
  const out: Choice[] = [];
  const seen = new Map<string, number>();
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const head = HEAD.exec(lines[i]!);
    if (!head) {
      offset += lines[i]!.length + 1;
      continue;
    }
    const start = offset;
    const rawTitle = head[1]!;
    const resolved = CHOSEN_SUFFIX.test(rawTitle);
    const title = rawTitle.replace(CHOSEN_SUFFIX, "").trim() || "Choice";
    const options: ChoiceOption[] = [];
    let end = offset + lines[i]!.length;
    offset += lines[i]!.length + 1;
    while (i + 1 < lines.length && /^>/.test(lines[i + 1]!)) {
      i++;
      const item = ITEM.exec(lines[i]!);
      if (item) options.push(parseOption(item[1]!));
      end = offset + lines[i]!.length;
      offset += lines[i]!.length + 1;
    }
    const slug = slugOf(title);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    out.push({ id: n > 1 ? `${slug}-${n}` : slug, title, resolved, options, span: { start, end } });
  }
  return out;
}

function parseOption(raw: string): ChoiceOption {
  const from = FROM.exec(raw)?.[1]?.trim() ?? "";
  let body = raw.replace(FROM, "").trim();
  let state: OptionState = "open";
  if (/^\*\*.*\*\*$/.test(body)) {
    state = "chosen";
    body = body.slice(2, -2);
  } else if (/^~~.*~~$/.test(body)) {
    state = "not_chosen";
    body = body.slice(2, -2);
  }
  // "in your notes", or "in your notes · your choice" for a choice reopened by new content.
  return { statement: body.trim(), from, inNotes: from.toLowerCase().startsWith(IN_NOTES), state };
}

/** The callout for a choice, in the format `findChoices` reads. */
export function formatChoice(c: Pick<Choice, "title" | "resolved" | "options">): string {
  const item = (o: ChoiceOption) => {
    const body = o.state === "chosen" ? `**${o.statement}**` : o.state === "not_chosen" ? `~~${o.statement}~~` : o.statement;
    return `> - ${body}${o.from ? ` _(${o.from})_` : ""}`;
  };
  // Resolved: the chosen option first, so the callout reads as the decision it records.
  const options = c.resolved ? [...c.options.filter((o) => o.state === "chosen"), ...c.options.filter((o) => o.state !== "chosen")] : c.options;
  return [`> [!choice] ${c.title}${c.resolved ? " — chosen" : ""}`, ...options.map(item)].join("\n");
}

/** `text` without its choice callouts (and the blank lines they leave): what a model, the change check and the safety net see. */
export function withoutChoices(text: string): string {
  const choices = findChoices(text);
  if (!choices.length) return text;
  let out = text;
  for (const c of [...choices].reverse()) out = out.slice(0, c.span.start) + out.slice(c.span.end);
  return out.replace(/\n{3,}/g, "\n\n");
}

/**
 * The text with choice `id` resolved to option `index`: the callout records the choice, and — when the chosen option
 * isn't the one the notes say — the notes' statement is replaced by the chosen one wherever the text (outside the
 * callouts) still says it word for word. Returns the text unchanged for an unknown choice or option.
 */
export function resolveChoice(text: string, id: string, index: number): string {
  const choice = findChoices(text).find((c) => c.id === id);
  const chosen = choice?.options[index];
  if (!choice || !chosen) return text;
  const options = choice.options.map((o, i): ChoiceOption => ({ ...o, state: i === index ? "chosen" : "not_chosen" }));
  let out = text.slice(0, choice.span.start) + formatChoice({ title: choice.title, resolved: true, options }) + text.slice(choice.span.end);
  const inNotes = choice.options.find((o) => o.inNotes);
  if (inNotes && !chosen.inNotes) out = replaceOutsideChoices(out, inNotes.statement, chosen.statement);
  return out;
}

/** Replaces the first occurrence of `from` that isn't inside a choice callout. */
function replaceOutsideChoices(text: string, from: string, to: string): string {
  const spans = findChoices(text).map((c) => c.span);
  let at = text.indexOf(from);
  while (at >= 0 && spans.some((s) => at >= s.start && at < s.end)) at = text.indexOf(from, at + 1);
  return at < 0 ? text : text.slice(0, at) + to + text.slice(at + from.length);
}

function slugOf(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "choice"
  );
}
