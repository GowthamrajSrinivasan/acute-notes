/**
 * Flow cards (note-taking-modes plan Step 6, D4): a flow section drawn as ONE OpenUI `FlowDiagram` card instead of native
 * step shapes, on an AI-managed canvas. Pure, no OpenUI import (the canvas writer and `cardLayout.ts` use it).
 *
 * The card's text is the source of truth (P2): a title, then one numbered item per step, its label in bold, with what the
 * content says about the step under it. The `FlowDiagram` Lang is built from that text in code — never by a model — so it
 * shows the same steps, in the same order, and can be rebuilt from the text after any edit (`flowOfContent`).
 */
import { inlineText, isTableContent, toPlainText } from "@/domain/content/richContent";
import type { ContentBlock, RichContent } from "@/domain/types";

/** A flow card has 2–12 steps; fewer is not a flow, more no longer reads as one row of steps. */
export const FLOW_STEPS_MIN = 2;
export const FLOW_STEPS_MAX = 12;

export interface FlowStep {
  label: string;
  /** What the card's text says about the step, as plain text (empty when it says nothing). */
  detail: string;
}

export interface Flow {
  title: string;
  steps: FlowStep[];
}

const lit = (s: string) => JSON.stringify(s);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A flow as `FlowDiagram` Lang; `cites` are the card's source units (shown as chips). */
export function flowLang(flow: Flow, cites: readonly string[] = []): string {
  const args = [lit(flow.title), `[${flow.steps.map((s) => lit(s.label)).join(", ")}]`];
  const details = flow.steps.map((s) => s.detail);
  if (details.some(Boolean) || cites.length) args.push(`[${details.map(lit).join(", ")}]`);
  if (cites.length) args.push(`[${cites.map(lit).join(", ")}]`);
  return `root = FlowDiagram(${args.join(", ")})`;
}

/** Whether a stored layout is a `FlowDiagram` (a flow card's). */
export function isFlowLang(lang: string): boolean {
  return /^root\s*=\s*FlowDiagram\(/.test(lang.trim());
}

/** A step's detail Markdown indented under its numbered item. */
const indent = (markdown: string) =>
  markdown
    .trim()
    .split("\n")
    .map((l) => (l.trim() ? `   ${l}` : ""))
    .join("\n");

/** The card's body Markdown: one numbered item per step, its label in bold, its detail under it. */
export function flowMarkdown(steps: readonly { label: string; markdown?: string }[]): string {
  return steps
    .map((s, i) => {
      const head = `${i + 1}. **${s.label.replace(/\*/g, "")}**`;
      return s.markdown?.trim() ? `${head}\n\n${indent(s.markdown)}` : head;
    })
    .join("\n\n");
}

const isEmpty = (b: ContentBlock) => !isTableContent(b.content) && !inlineText(b.content).trim() && !b.children?.length;

/**
 * The flow a card's text holds, or null when it isn't one: an optional title heading, then numbered items (2–12), each
 * with what follows it up to the next item as its detail (the Markdown parser lifts a step's bullets out of its item, so
 * they are read back from the blocks after it). A table anywhere, or text before the first step, means it isn't a flow.
 */
export function flowOfContent(rec: { title: string; snapshot: RichContent }): Flow | null {
  const blocks = rec.snapshot.filter((b) => !isEmpty(b));
  if (blocks.some((b) => isTableContent(b.content))) return null;
  let at = 0;
  let title = rec.title && rec.title !== "Untitled" ? rec.title : "";
  if (blocks[0]?.type === "heading") {
    title ||= inlineText(blocks[0].content).trim();
    at = 1;
  }
  if (!title || blocks[at]?.type !== "numberedListItem") return null;
  const steps: { label: string; detail: string[] }[] = [];
  for (const b of blocks.slice(at)) {
    if (b.type === "numberedListItem") {
      steps.push({ label: squash(inlineText(b.content)), detail: b.children?.length ? [toPlainText(b.children)] : [] });
    } else {
      steps.at(-1)!.detail.push(toPlainText([b]));
    }
  }
  if (steps.length < FLOW_STEPS_MIN || steps.length > FLOW_STEPS_MAX || steps.some((s) => !s.label)) return null;
  return { title: squash(title), steps: steps.map((s) => ({ label: s.label, detail: squash(s.detail.join(" ")) })) };
}
