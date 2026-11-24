/**
 * "Ask AI to change" / "Ask AI to refresh" on one layout card (note-taking-modes plan Step 7): the card's Markdown and
 * layout go to the canvas's AI in ONE request (`compose_card_layout`); the reply is checked against the card's text and
 * citations (`layoutCheck.ts`) and, when nothing mechanical is wrong, put up for review as one `update_block` — text and
 * layout together, so undo after Accept restores both. Nothing changes before the user accepts it. Every call is the
 * user's own click, after they were told it uses their AI.
 *
 * Passing the check is not proof the layout is faithful (D3): the review stays mandatory and nothing here says otherwise.
 */
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { keepFormatting } from "@/ai/changes/keepFormatting";
import { AIError } from "@/ai/errors";
import { cardContentHash } from "@/ai/openui/cardLayout";
import { checkLayout } from "@/ai/openui/layoutCheck";
import { composeLayout } from "@/ai/openui/layoutTask";
import type { AIRuntime } from "@/ai/runtime";
import { AI_PROVIDER_DESCRIPTORS } from "@/ai/providers/registry";
import { contentToMarkdown } from "@/domain/content/markdown";
import { newId } from "@/domain/ids";
import type { CardLayout, RichContent } from "@/domain/types";

export interface LayoutAskInput {
  canvasId: string;
  elementId: string;
  card: { snapshot: RichContent; layout?: CardLayout };
  instruction: string;
  /** The units the card cites and their passages (what its citations may name). */
  passages: ReadonlyMap<string, string>;
  /** "change" (the user's instruction) or "refresh" (the layout redone for the card's current text): the review title. */
  purpose: "change" | "refresh";
  /**
   * Layout only: the card's text is kept as it is, whatever the reply says; only the layout is proposed. Always on for a
   * refresh. (Live run 2026-11-24: asked for "a warning callout under a one-sentence summary", the model also wrote an
   * invented summary sentence into the card's text.)
   */
  layoutOnly?: boolean;
}

export type LayoutAskOutcome =
  | { outcome: "proposed"; notes: string[] }
  | { outcome: "refused"; problems: string[] }
  | { outcome: "failed"; message: string };

/** The instruction "Ask AI to refresh" sends. */
export const REFRESH_INSTRUCTION =
  "The card's text changed after its layout was made. Redo the layout so it shows the card's text as it is now, keeping the current layout's structure where it still fits. Do not change the Markdown.";

/** The note a layout-only proposal carries when the reply also rewrote the card's text. */
export const TEXT_LEFT_OUT_NOTE = "The AI also suggested changing the card's text; that was left out (layout only), so only the layout is proposed.";

export async function askAIForLayout(
  input: LayoutAskInput,
  deps: { runtime: AIRuntime; parseMarkdown: (md: string) => RichContent; signal?: AbortSignal },
): Promise<LayoutAskOutcome> {
  const layoutOnly = input.layoutOnly === true || input.purpose === "refresh";
  let reply: Awaited<ReturnType<typeof composeLayout>>;
  try {
    reply = await composeLayout(
      deps.runtime,
      {
        markdown: contentToMarkdown(input.card.snapshot),
        ...(input.card.layout ? { currentLang: input.card.layout.lang } : {}),
        instruction: input.instruction.trim(),
        cites: [...input.passages.keys()],
        ...(layoutOnly ? { keepText: true } : {}),
      },
      deps.signal ? { signal: deps.signal } : {},
    );
  } catch (err) {
    return { outcome: "failed", message: err instanceof AIError ? err.message : "The AI request failed." };
  }
  const suggested = reply.markdown ? keepFormatting(input.card.snapshot, deps.parseMarkdown(reply.markdown)) : input.card.snapshot;
  const textLeftOut = layoutOnly && cardContentHash({ title: "Untitled", snapshot: suggested }) !== cardContentHash({ title: "Untitled", snapshot: input.card.snapshot });
  const content = layoutOnly ? input.card.snapshot : suggested;
  const check = checkLayout({ lang: reply.lang, card: { title: "Untitled", snapshot: content }, passages: new Map(input.passages) });
  if (!check.ok) return { outcome: "refused", problems: check.errors.map((e) => e.message) };
  const operationId = newId("op");
  const authType = AI_PROVIDER_DESCRIPTORS.find((d) => d.id === reply.provenance.providerId)?.accessType;
  const textChanged = JSON.stringify(content) !== JSON.stringify(input.card.snapshot);
  getPendingChanges().propose(input.canvasId, {
    operationId,
    title: input.purpose === "refresh" ? "Ask AI: refresh card layout" : textChanged ? "Ask AI: change card and layout" : "Ask AI: change card layout",
    metadata: { createdBy: "ai", task: "compose_card_layout", operationId, provider: reply.provenance.providerId, model: reply.provenance.model, ...(authType ? { authType } : {}) },
    changes: [{ kind: "update_block", target: input.elementId, content, layout: { lang: reply.lang } }],
  });
  return { outcome: "proposed", notes: [...(textLeftOut ? [TEXT_LEFT_OUT_NOTE] : []), ...check.notes.map((n) => n.message)] };
}
