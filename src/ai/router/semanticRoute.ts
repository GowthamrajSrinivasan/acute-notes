/**
 * Stage 5c wiring (intelligent-update-engine-plan §13.4, §18): "Where should this go?" answered by the descent over the
 * item index (`descent.ts`, `semanticIndex.ts`) when a local embedding model is active — in the router's own result shape,
 * so the dialog, its picks and the placement are unchanged:
 *
 * - **Candidates** are the descent's best cards, in its order (the winner first), each with what it would do there:
 *   `update` (`replace_item`: the item's sentence or list item, a claim-level edit, escalated when it contradicts),
 *   `none` (`duplicate`), `anchor` (`after_item` / `append` / `table_row` / `cell`, the exact patch, `anchors.ts`), or
 *   `insert_near` (a prose card can't take new information, or the anchor can't be placed exactly).
 * - **Two confidences, never blended:** `routing` is the descent's destination score, `update` its edit confidence.
 * - **The decision:** `route` to the winner; `NEW` when no card is close (a new card in the best section, or a new
 *   section), with `semantic.nowhere` when the note belongs nowhere (§13.14) — the dialog then suggests a new card first
 *   and still lists the closest cards (#24); `NEEDS_CLARIFICATION` when the descent asks.
 * - **The user still picks:** `defaultPicks` preselects only a confident, non-escalated route, as before.
 * - **Locked cards** (or cards in a locked section) are never patched: such a card is offered as "a new card beside it".
 */
import { ESCALATED_INTENTS, classifyClaimChange } from "@/ai/reconcile/intent";
import { labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import type { SceneElement } from "@/domain/canvas/adapter";
import { isLocked } from "@/domain/canvas/lock";
import type { DocumentRecord } from "@/domain/types";
import { planAnchor } from "./anchors";
import type { CardOption, Placement } from "./descent";
import type { CardDescriptor, SectionInfo } from "./descriptors";
import { INSERT_CONFIDENCE, type RouteCandidate, type RouteResult } from "./router";
import type { ItemIndex } from "./itemIndex";
import type { PlacementContext } from "./placementContext";

const round = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
const quote = (s: string, n = 60) => `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”`;

export interface SemanticRouteInput {
  text: string;
  placement: Placement;
  index: ItemIndex;
  embedder: string;
  scene: readonly SceneElement[];
  getDocument: (id: string) => DocumentRecord | null | undefined;
  /** A card's descriptor (title, summary, section) for the dialog; null when the card isn't known. */
  describe: (id: string) => CardDescriptor | null;
  sections: readonly SectionInfo[];
  /** Where the user was (`placementContext.ts`): the descent gave it a prior, and its cards say so. */
  context?: PlacementContext | null;
  limit?: number;
}

/** The evidence line for a card the context points at, if any. */
function contextEvidence(id: string, section: string | null | undefined, context: PlacementContext | null | undefined): string | null {
  if (!context) return null;
  if (context.card === id) return "the card you selected";
  if (context.section && section === context.section) return context.source === "selection" ? "in the section you selected" : "in the section you're viewing";
  return null;
}

/** See module doc. */
export function semanticRoute(input: SemanticRouteInput): RouteResult {
  const { placement: p, text } = input;
  const limit = input.limit ?? 5;
  const live = new Map(input.scene.filter((e) => !e.isDeleted).map((e) => [e.id, e] as const));
  const labels = labelsByContainer(input.scene);
  const lockedFrames = new Set(input.scene.flatMap((e) => (!e.isDeleted && e.type === "frame" && isLocked(e) ? [e.id] : [])));
  const optionOf = new Map(p.options.map((o) => [o.card, o] as const));
  const scoreOf = new Map(p.scores.map((s) => [s.card, s.routing] as const));
  const sectionName = new Map(input.sections.map((s) => [s.id, s.name] as const));

  // The winner first, then the rest in the descent's order.
  const order = [...new Set([...(p.card ? [p.card] : []), ...p.ranked])].filter((id) => live.has(id));
  const candidates: RouteCandidate[] = [];
  for (const id of order) {
    if (candidates.length >= limit) break;
    const descriptor = input.describe(id);
    if (!descriptor) continue;
    const el = live.get(id)!;
    const items = input.index.card(id);
    const routing = round(scoreOf.get(id) ?? 0);
    const evidence = [`similar in meaning (${routing}, local model)`];
    if (items?.section && sectionName.has(items.section)) evidence.push(`in section “${sectionName.get(items.section)}”`);
    const near = contextEvidence(id, items?.section ?? el.frameId, input.context);
    if (near) evidence.push(near);
    const base: RouteCandidate = { id, descriptor, action: "insert_near", routing, update: INSERT_CONFIDENCE, scores: { semantic: routing, lexical: 0, section: 0, graph: 0, signal: 0 }, evidence };
    const option = optionOf.get(id);
    const locked = isLocked(el) || (!!el.frameId && lockedFrames.has(el.frameId));
    candidates.push(option && items && !locked ? withOption(base, option, items, objectContent(el, labels, input.getDocument), text) : locked ? { ...base, evidence: [...evidence, "locked: a new card goes beside it"] } : base);
  }

  const nowhere = p.action === "new_section" && p.steps.some((s) => s.startsWith("belongs nowhere"));
  const semantic = { embedder: input.embedder, nowhere, section: p.section };
  const sections = input.sections.map((section) => ({ section, score: 0 }));
  if (p.action === "new_section" || p.action === "new_block")
    return {
      mode: "unanchored",
      decision: "NEW",
      reason: nowhere
        ? "belongs nowhere on this canvas: a new card is suggested"
        : p.action === "new_block" && p.section
          ? `a new card in “${sectionName.get(p.section) ?? "its section"}” — no card there can take it inside`
          : "no card is close enough: it becomes a new card",
      candidates,
      sections,
      semantic,
    };
  if (p.action === "clarify") return { mode: "unanchored", decision: "NEEDS_CLARIFICATION", reason: "more than one place fits about equally well", candidates, sections, semantic };
  const top = candidates[0];
  return { mode: "unanchored", decision: top ? "route" : "NEW", reason: top ? `best fit: ${quote(top.descriptor.title, 40)} (${top.routing})` : "no card is close enough: it becomes a new card", candidates, sections, semantic };
}

/** A candidate with the descent's action for its card (see module doc). */
function withOption(base: RouteCandidate, o: CardOption, items: NonNullable<ReturnType<ItemIndex["card"]>>, live: Parameters<typeof planAnchor>[2], text: string): RouteCandidate {
  const item = o.item !== null ? items.items[o.item] : undefined;
  if (o.action === "duplicate" && item) {
    return { ...base, action: "none", update: 1, claim: { sentence: item.text, newSentence: text, intent: "DUPLICATE", detail: "already says it", escalate: false }, evidence: [...base.evidence, `already says it: ${quote(item.text)}`] };
  }
  if (o.action === "replace_item" && item && items.kind !== "table") {
    const v = classifyClaimChange(item.text, text);
    const intent = v.intent === "NEW" || v.intent === "DUPLICATE" ? (o.relation === "CONTRADICTS" ? "CONTRADICTS" : "SUPERSEDES") : v.intent;
    return {
      ...base,
      action: "update",
      update: round(o.update),
      claim: { sentence: item.text, newSentence: text.replace(/\s+/g, " ").trim(), intent, detail: v.detail, escalate: ESCALATED_INTENTS.has(intent) },
      evidence: [...base.evidence, `holds the claim ${quote(item.text)} — the new content ${intent === "CONTRADICTS" ? "contradicts" : "replaces"} it`],
    };
  }
  const plan = planAnchor(o, items, live, text);
  if (plan) return { ...base, action: "anchor", update: round(o.update), anchor: plan, evidence: [...base.evidence, ...(item ? [`closest item: ${quote(item.text)}`] : [])] };
  return base;
}
