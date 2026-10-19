/**
 * The local tier's Mermaid path (F33): content that is one Mermaid diagram —
 * a ```mermaid fence (optionally under a heading that titles it) or bare
 * Mermaid source — is converted deterministically into native shapes and
 * arrows, with no model call. Anything else, including a Mermaid block inside
 * a larger document, is left to the normal local plan, where it stays a code
 * block (previewed as its diagram) that can be visualized on its own.
 */
import { convertMermaid, detectMermaid, isMermaidLanguage, KIND_WORDS } from "@/ai/mermaid";
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { LocalPlanResult } from "./localPlanner";
import type { ParsedBlock, ParsedContent } from "./types";

/** At most this many of the converter's notes are listed as reasons. */
const MAX_NOTES = 3;

/** A local plan for content that is a single convertible Mermaid diagram, else null. */
export function planMermaid(parsed: ParsedContent, input: string): LocalPlanResult | null {
  const blocks = parsed.blocks.filter((b) => b.type !== "divider");
  const code = blocks.find((b): b is Extract<ParsedBlock, { type: "code" }> => b.type === "code");
  const heading = blocks[0]?.type === "heading" ? blocks[0] : null;

  let source: string;
  let offset: number;
  let language: string | undefined;
  let title: string | undefined;
  if (code && blocks.length === (heading ? 2 : 1) && (isMermaidLanguage(code.language) || detectMermaid(code.source)?.supported)) {
    source = code.source;
    language = code.language;
    offset = codeBodyStart(input, code);
    title = heading?.text;
  } else {
    // Bare Mermaid source: the parser saw paragraphs, but the text starts with a diagram header.
    const start = input.search(/\S/);
    if (start < 0 || !detectMermaid(input.slice(start))?.supported) return null;
    source = input.slice(start);
    offset = start;
  }

  const converted = convertMermaid(source, { ...(language ? { language } : {}), sourceOffset: offset });
  if (!converted.ok) return null;
  const plan = title && !converted.plan.metadata?.title ? { ...converted.plan, metadata: { ...converted.plan.metadata, title: title.slice(0, TEXT_LIMITS.planTitle) } } : converted.plan;
  const kind = KIND_WORDS[converted.kind];
  return {
    sufficient: true,
    confidence: 1,
    reasons: [`a Mermaid ${kind}: converted to shapes and arrows`, ...converted.warnings.slice(0, MAX_NOTES)],
    plan,
  };
}

/** Where a fenced block's body starts in `input` (the line after the opening fence); its span start for an unfenced one. */
export function codeBodyStart(input: string, block: Extract<ParsedBlock, { type: "code" }>): number {
  const { start, end } = block.span;
  const opening = /^[ \t]*(`{3,}|~{3,})/.exec(input.slice(start, end));
  if (!opening) return start;
  const newline = input.indexOf("\n", start);
  return newline < 0 || newline >= end ? start : newline + 1;
}
