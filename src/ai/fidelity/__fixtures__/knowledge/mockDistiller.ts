/**
 * A scripted stand-in for a model in distil mode (knowledge-notes-plan WP1.12): reads the labelled section a
 * `generate_visual_plan` prompt carries and answers with one card per source unit, citing it, tables and code placed by
 * reference, filler omitted, plus a takeaway and an analysis card. Deterministic; no AI is called. Knobs plant the
 * failures the checks must catch (a caveat omitted, a number changed, a card citing nothing), on the first attempt only
 * or on every attempt, so a test can see the one retry fix them — or not.
 */
import type { AIRequest, AIResponse } from "@/ai/types";

export interface DistillerOptions {
  /** Omit, as "meta", the units whose text matches (a critical omission when the unit carries a caveat). */
  omitCritical?: RegExp;
  /** Write the first number of a unit whose text matches differently on its card (an exact detail lost). */
  changeNumberIn?: RegExp;
  /** Give the card of a unit whose text matches an absolute the source doesn't have ("always"): a meaning hint only. */
  addAbsoluteIn?: RegExp;
  /** Leave the card of a unit whose text matches without `cites`. */
  uncitedIn?: RegExp;
  /** Drop the condition ("when …", "if …", "unless …") from the card of a unit whose text matches (a critical clause lost). */
  dropConditionIn?: RegExp;
  /** Whether the planted failures stay on the retry too (default: the retry is faithful). */
  persistent?: boolean;
}

const FILLER = /^(thanks|thank you|great question|hope this helps|as discussed)\b/i;
const RETRY_MARK = "An earlier plan of this section had these problems";
const response = (text: string): AIResponse => ({ text, model: "mock-distil", finishReason: "stop", usage: { provider: "mock", model: "mock-distil", promptTokens: 100, completionTokens: 50 } });

/** The labelled units and the blocks to place by reference, from a distil prompt's content. */
export function labelledUnits(prompt: string): { units: { label: string; text: string }[]; refs: string[] } {
  const content = prompt.slice(prompt.lastIndexOf("Content to visualize:"));
  const units: { label: string; text: string }[] = [];
  const refs: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const ref = /^\[([TC]\d+)\]/.exec(line);
    if (ref) refs.push(ref[1]!);
    const m = /^((?:[PL]\d+\.\d+)) (.+)$/.exec(line);
    if (m) units.push({ label: m[1]!, text: m[2]!.trim() });
  }
  return { units, refs };
}

/** A section reply as a faithful distiller would write it, with the planted failures of `options`. */
export function distilReply(prompt: string, options: DistillerOptions = {}): string {
  const retry = prompt.includes(RETRY_MARK);
  const plant = !retry || options.persistent === true;
  const { units, refs } = labelledUnits(prompt);
  const nodes: Record<string, unknown>[] = [];
  const omitted: { unit: string; reason: string }[] = [];
  units.forEach((u, i) => {
    if (FILLER.test(u.text)) {
      omitted.push({ unit: u.label, reason: "filler" });
      return;
    }
    if (plant && options.omitCritical?.test(u.text)) {
      omitted.push({ unit: u.label, reason: "meta" });
      return;
    }
    let body = u.text;
    if (plant && options.changeNumberIn?.test(u.text)) body = body.replace(/\d+(?:[.,]\d+)?/, (n) => String(Number(n.replace(",", "")) + 7));
    if (plant && options.addAbsoluteIn?.test(u.text)) body = `This always holds: ${body}`;
    if (plant && options.dropConditionIn?.test(u.text)) body = body.replace(/\s+(?:only when|when|if|unless)\b[^.,;]*/i, "");
    const title = body.split(/\s+/).slice(0, 6).join(" ").replace(/[.,:;]$/, "");
    const uncited = plant && options.uncitedIn?.test(u.text);
    nodes.push({ id: `n${i + 1}`, type: "text", title, content: { markdown: body }, ...(uncited ? {} : { cites: [u.label] }) });
  });
  refs.forEach((ref, i) => nodes.push({ id: `r${i + 1}`, type: "source", ref }));
  const items = [...new Set(prompt.slice(prompt.lastIndexOf("Content to visualize:")).match(/\b(?:[A-Z]{1,4}-?\d{1,3}|#\d{1,4})\b/g) ?? [])];
  nodes.push({ id: "a1", type: "text", origin: "analysis", title: "What it means", content: { markdown: `The section's points, read together${items.length ? ` (${items.join(", ")})` : ""}.` } });
  return JSON.stringify({ version: 1, template: "sectioned", nodes, relationships: [], metadata: { takeaway: "The section's main point, in short", omitted } });
}

/** An outline that keeps every part as its own section (what `validateOutline` would do with an empty one). */
export function outlineReply(prompt: string): string {
  const parts = [...prompt.matchAll(/^\[(u\d+)\] \(/gm)].map((m) => m[1]!);
  return JSON.stringify({ summary: "The document in short", sections: parts.map((p, i) => ({ id: `s${i + 1}`, label: `Part ${i + 1}`, kind: "notes", prominence: "primary", parts: [p] })), links: [] });
}

/**
 * A mock provider's `respond` for a whole distil Visualize run. `check` answers the optional model check
 * (`check_card_meaning`) per item; by default every card is "supported".
 */
export function distiller(options: DistillerOptions = {}, check?: (item: { ref: string; card: string; source: string }) => { verdict: string; reason?: string }) {
  return (req: AIRequest): AIResponse => {
    if (req.task === "outline_document") return response(outlineReply(req.prompt));
    if (req.task === "generate_visual_plan") return response(distilReply(req.prompt, options));
    if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "The section's main point, in short", nodes: [], relationships: [] }));
    if (req.task === "check_card_meaning") {
      const items = [...req.prompt.matchAll(/ITEM (c\d+)\nSOURCE: ([^\n]*(?:\n(?!CARD: )[^\n]*)*)\nCARD: ([^\n]*(?:\n(?!ITEM )[^\n]*)*)/g)].map((m) => ({ ref: m[1]!, source: m[2]!, card: m[3]! }));
      return response(JSON.stringify({ results: items.map((i) => ({ ref: i.ref, ...(check ? check(i) : { verdict: "supported", reason: "" }) })) }));
    }
    if (req.task === "find_revisions") return response(JSON.stringify({ revisions: [] }));
    return response("{}");
  };
}
