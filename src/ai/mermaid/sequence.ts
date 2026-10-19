/**
 * A small, deterministic, hand-written parser for Mermaid sequence diagrams
 * (`sequenceDiagram`) — no Mermaid library. Unlike the other convertible
 * kinds, a sequence diagram's "graph" (participants, messages) doesn't fit
 * `MermaidGraph`/`GraphBuilder`: messages routinely repeat the same
 * `(from, to, label)` tuple, and what matters is their *order*, not their
 * connectivity — so this parser has its own result type, read by
 * `sequenceToPlan.ts` instead of the generic `toVisualPlan.ts`.
 *
 * Supported:
 * - `participant A` / `participant A as Alice`, `actor A` / `actor A as Alice`
 * - messages `A->B` `A-->B` `A->>B` `A-->>B` `A-xB` `A--xB` `A-)B` `A--)B`,
 *   each followed by `: text`; a `+`/`-` right before the target activates/
 *   deactivates it (read past, noted once)
 * - `activate A` / `deactivate A`
 * - `Note left of A: text` / `Note right of A: text` / `Note over A,B: text`,
 *   single-line or as a block closed by `end note`
 * - `loop text` … `end`, `opt text` … `end`, `alt text` (`else text`)… `end`,
 *   `par text` (`and text`)… `end`, `critical text` (`option text`)… `end`,
 *   `break text` … `end`, `rect <style>` … `end`, `box <title>` … `end`
 *   (`rect`/`box` are visual-only: no label prefix)
 * - `autonumber`, `title text`, `%%` comments/directives
 *
 * Anything else fails with a typed `syntax` error naming the line and column.
 */
import { cleanLabel, lineColumn, readFrontmatter, splitStatements, type Statement } from "./source";
import type { MermaidConversionError, SequenceGraph, SequenceMessage, SequenceNote, SequenceParticipant, Span } from "./types";

export type { SequenceGraph, SequenceMessage, SequenceNote, SequenceParticipant } from "./types";

export type SequenceParseResult = { ok: true; graph: SequenceGraph } | { ok: false; error: MermaidConversionError };

class ParseFailure {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** A participant id: letters/digits/`_`/`$`, with single inner hyphens or dots — never a bare trailing hyphen, so it can't absorb an arrow's `-`. */
const ID_SRC = String.raw`[\p{L}\p{N}_$]+(?:[-.][\p{L}\p{N}_$]+)*`;
const ID = new RegExp(`^${ID_SRC}$`, "u");

/** Longest arrow operators first so `-->>` isn't read as `-->` + `>`. */
const ARROW = /(-->>|-->|--x|--\)|->>|-x|-\)|->)/;

const BRANCH_KEYWORDS: Record<string, string> = { alt: "else", par: "and", critical: "option" };

interface Frame {
  /** The opening keyword (`loop`, `alt`, `rect`, `box`, …). */
  keyword: string;
  /** Formatted prefix for messages inside this frame, e.g. "loop: Retry up to 3x"; empty for `rect`/`box` (visual-only). */
  label: string;
}

export function parseSequence(source: string): SequenceParseResult {
  try {
    const front = readFrontmatter(source);
    const statements = splitStatements(source, front.bodyStart);
    const header = statements[0];
    if (!header || !/^sequenceDiagram$/.test(header.text)) return fail(source, "expected a `sequenceDiagram` header", header?.span.start ?? 0);

    const participants = new Map<string, SequenceParticipant>();
    const messages: SequenceMessage[] = [];
    const notes: SequenceNote[] = [];
    const frames: Frame[] = [];
    let title = front.title;
    let autonumbered = 0;
    let activations = 0;
    let visualGroups = 0;
    let noteBlock: { text: string[] } | null = null;

    const mention = (id: string, span: Span, label?: string): void => {
      const existing = participants.get(id);
      if (!existing) participants.set(id, { id, label: label || id, span });
      else if (label) existing.label = label;
    };
    const prefix = (): string => frames.map((f) => f.label).filter(Boolean).join(" ");

    for (const st of statements.slice(1)) {
      const t = st.text;

      if (noteBlock) {
        if (/^end\s+note$/i.test(t)) {
          notes.push({ afterMessageIndex: messages.length - 1, text: noteBlock.text.join("\n") });
          noteBlock = null;
        } else {
          noteBlock.text.push(cleanLabel(t));
        }
        continue;
      }

      const participantMatch = /^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/.exec(t);
      if (participantMatch) {
        const id = participantMatch[2]!;
        if (!ID.test(id)) throw new ParseFailure(`"${id}" isn't a valid participant id`, st.span.start);
        mention(id, st.span, participantMatch[3] ? cleanLabel(participantMatch[3]) : undefined);
        continue;
      }

      const activateMatch = /^(activate|deactivate)\s+(\S+)$/.exec(t);
      if (activateMatch) {
        mention(activateMatch[2]!, st.span);
        activations++;
        continue;
      }

      const noteMatch = /^[Nn]ote\s+(left of|right of|over)\s+([^:]+?)(?:\s*:\s*(.*))?$/.exec(t);
      if (noteMatch) {
        for (const id of noteMatch[2]!.split(",").map((s) => s.trim())) mention(id, st.span);
        if (noteMatch[3] !== undefined) notes.push({ afterMessageIndex: messages.length - 1, text: cleanLabel(noteMatch[3]) });
        else noteBlock = { text: [] };
        continue;
      }

      if (/^autonumber(?:\s+\S+(?:\s+\S+)?)?$/.test(t)) {
        autonumbered++;
        continue;
      }
      const titleMatch = /^title\s+(.*)$/.exec(t);
      if (titleMatch) {
        if (!title) title = cleanLabel(titleMatch[1]!);
        continue;
      }

      if (t === "end") {
        if (!frames.pop()) throw new ParseFailure("`end` without an open block", st.span.start);
        continue;
      }
      const openMatch = /^(loop|opt|alt|par|critical|break|rect|box)\b(?:\s+(.*))?$/.exec(t);
      if (openMatch) {
        const keyword = openMatch[1]!;
        const rest = openMatch[2]?.trim() ?? "";
        if (keyword === "rect" || keyword === "box") {
          visualGroups++;
          frames.push({ keyword, label: "" });
        } else {
          frames.push({ keyword, label: `[${keyword}: ${cleanLabel(rest)}]` });
        }
        continue;
      }
      const branchMatch = /^(else|and|option)\b(?:\s+(.*))?$/.exec(t);
      if (branchMatch) {
        const top = frames[frames.length - 1];
        const expected = top && BRANCH_KEYWORDS[top.keyword];
        if (!top || expected !== branchMatch[1]) throw new ParseFailure(`\`${branchMatch[1]}\` outside a matching block`, st.span.start);
        top.label = `[${top.keyword}: ${cleanLabel(branchMatch[2]?.trim() ?? "")}]`;
        continue;
      }

      const message = parseMessage(t, st);
      if (message) {
        mention(message.from, st.span);
        mention(message.to, st.span);
        const text = [prefix(), message.text].filter(Boolean).join(" ");
        messages.push({ from: message.from, to: message.to, text, span: st.span });
        continue;
      }

      throw new ParseFailure(`can't read "${t.slice(0, 40)}"`, st.span.start);
    }

    if (noteBlock) return fail(source, "a `Note` block is never closed with `end note`", source.length);
    if (frames.length) return fail(source, `\`${frames[frames.length - 1]!.keyword}\` is never closed with \`end\``, source.length);
    if (!messages.length) return { ok: false, error: { code: "no_nodes", kind: "sequence", message: "the diagram has no messages to draw" } };

    const skipped: string[] = [];
    if (activations) skipped.push(`${activations} activate/deactivate call${activations === 1 ? "" : "s"} skipped — activation bars aren't drawn`);
    if (visualGroups) skipped.push(`${visualGroups} box/rect grouping block${visualGroups === 1 ? "" : "s"} skipped — shown without the visual grouping`);
    if (autonumbered) skipped.push("autonumber is skipped — messages are numbered by the flow layout instead");

    return {
      ok: true,
      graph: {
        kind: "sequence",
        ...(title ? { title } : {}),
        participants: [...participants.values()],
        messages,
        notes,
        skipped,
      },
    };
  } catch (e) {
    if (e instanceof ParseFailure) return fail(source, e.message, e.offset);
    return fail(source, `unexpected parser failure: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
}

const MESSAGE = new RegExp(`^(${ID_SRC})\\s*${ARROW.source}\\s*([+-])?\\s*(${ID_SRC})\\s*:\\s*(.*)$`, "u");

function parseMessage(t: string, st: Statement): { from: string; to: string; text: string } | null {
  const full = MESSAGE.exec(t);
  if (!full) return null;
  const [, fromRaw, arrow, , toRaw, textRaw] = full;
  if (!ID.test(fromRaw!) || !ID.test(toRaw!)) throw new ParseFailure(`can't read message "${t.slice(0, 40)}"`, st.span.start);
  const dotted = arrow!.startsWith("--");
  const text = cleanLabel(textRaw!) + (dotted ? " (async)" : "");
  return { from: fromRaw!, to: toRaw!, text };
}

function fail(source: string, message: string, offset: number): { ok: false; error: MermaidConversionError } {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "sequence", message: `line ${line}: ${message}`, line, column } };
}
