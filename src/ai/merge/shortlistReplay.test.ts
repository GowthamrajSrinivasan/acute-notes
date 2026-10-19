/**
 * Offline replay of the topic shortlist on the saved layout D assignment (34 topics, 116 parts, Jev's saved full-list answers). The saved data
 * has headings and sizes only (no chat text: `__fixtures__/layoutDWorld.ts` fills the bodies with distinct words), so what this replays is the
 * shortlist built from HEADINGS, context and the parent/sibling rules; content retrieval can only be judged from the earlier measurement on the
 * 95-topic layout (`data/shortlist-recall-2026-10-10.txt`). It measures what the shortlist could contain, NOT what Jev would answer from it:
 * assignment agreement needs a live Jev replay, and is not claimed here. Numbers are printed (run with the reporter's console on) and recorded in
 * `.ai/docs/decision-spike/chat-import-live-2026-10-09.md`.
 */
import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "@/ai/decisions/types";
import placement from "./__fixtures__/layoutDPlacement.json";
import { recorded, sectionText } from "./__fixtures__/layoutDWorld";
import { assignToTopicsDecision, type AssignInput } from "./assign";
import { ASSIGN_BATCH_PARTS } from "./merge";
import { shortlistFor } from "./topicIndex";

const SEP = " › ";
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const topics = placement.topics.map((t, i) => ({ key: t.key, label: t.key.split(SEP).at(-1)!, text: i === 0 ? `Opening answer. ${"word ".repeat(Math.max(1, Math.floor(t.chars / 5)))}` : `${"word ".repeat(Math.max(1, Math.floor(t.chars / 5)))}` }));
const parts: AssignInput["parts"] = recorded.map((p) => {
  const under = p.key.split(SEP).slice(0, -1).join(SEP);
  return { key: p.key, text: sectionText(p), ...(under ? { context: under } : {}) };
});

describe("replay on the saved layout D assignment", () => {
  // As merge asks: batches of ASSIGN_BATCH_PARTS parts, whose own headings are each other's siblings.
  const batches = Array.from({ length: Math.ceil(parts.length / ASSIGN_BATCH_PARTS) }, (_, b) => parts.slice(b * ASSIGN_BATCH_PARTS, (b + 1) * ASSIGN_BATCH_PARTS));
  const lists = batches.flatMap((batch) => batch.map((_, i) => shortlistFor(topics, batch, i)));
  const confident = recorded.map((r, i) => ({ r, i })).filter(({ r }) => r.topic !== "" && r.confidence >= 0.5 && /^t\d+$/.test(r.topic));
  const topicIndexOf = (ref: string) => Number(ref.slice(1)) - 1;

  it("the saved topics are the world's topics (t{n} is the n-th topic)", () => {
    expect(topics).toHaveLength(34);
    expect(recorded).toHaveLength(116);
    for (const { r } of confident) expect(norm(topics[topicIndexOf(r.topic)]!.label)).toBe(norm((r as unknown as { topicLabel: string }).topicLabel));
  });

  it("reports recall, fallback and token estimates, and keeps the structural guarantees", () => {
    const shown = (i: number) => lists[i]?.indices ?? topics.map((_, n) => n);
    const hit = confident.filter(({ r, i }) => shown(i).includes(topicIndexOf(r.topic)));
    const fromShortlist = confident.filter(({ i }) => lists[i]);
    const hitFromShortlist = fromShortlist.filter(({ r, i }) => lists[i]!.indices.includes(topicIndexOf(r.topic)));
    const full = lists.filter((l) => !l).length;
    const unsure = recorded.map((r, i) => ({ r, i })).filter(({ r }) => r.confidence < 0.5);
    const unsureShortlisted = unsure.filter(({ i }) => lists[i]);
    const missed = fromShortlist.length - hitFromShortlist.length;

    // Tokens: each part's saved full-list request tokens, scaled by the share of the request's characters a shortlist request keeps.
    const chars = (r: DecisionRequest) => JSON.stringify(r).length;
    const fullAll = batches.flatMap((batch) => assignToTopicsDecision.buildRequest({ topics, parts: batch }) as DecisionRequest[]);
    const shortAll = batches.flatMap((batch) => assignToTopicsDecision.buildRequest({ topics, parts: batch, shortlist: true }) as DecisionRequest[]);
    const tokens = recorded.map((r) => (r as unknown as { tokens: number }).tokens);
    const share = shortAll.map((r, i) => chars(r) / chars(fullAll[i]!));
    const baseline = tokens.reduce((n, t) => n + t, 0);
    const shortCost = (widen: (i: number) => boolean) => tokens.reduce((n, t, i) => n + t * share[i]! + (lists[i] && widen(i) ? t : 0), 0);
    // Widening: certainly the parts the full list itself was unsure about; at most also the confident parts the shortlist missed.
    const certain = (i: number) => recorded[i]!.confidence < 0.5;
    const possible = (i: number) => certain(i) || (confident.some((c) => c.i === i) && !lists[i]!.indices.includes(topicIndexOf(recorded[i]!.topic)));
    const low = shortCost(certain);
    const high = shortCost(possible);
    const pct = (n: number, d: number) => `${n}/${d} (${((100 * n) / d).toFixed(0)}%)`;
    const report = [
      `layout D replay: 34 topics, ${recorded.length} parts, ${confident.length} confident existing answers, ${unsure.length} unsure (confidence < 0.5)`,
      `RECALL  Jev's confident topic is among the topics shown: ${pct(hit.length, confident.length)}; of those with a real shortlist: ${pct(hitFromShortlist.length, fromShortlist.length)} (${missed} missed)`,
      `FALLBACK  parts shown the full list at once (no retrieval evidence, or shortlist = all): ${pct(full, parts.length)}; shortlisted parts the full list called unsure (certain re-ask): ${pct(unsureShortlisted.length, parts.length - full)}`,
      `AGREEMENT  not measured offline (needs Jev on the shortlist requests); upper bound = recall above`,
      `TOKENS  baseline ${baseline}; shortlist with re-asks: ${Math.round(low)} (${(((low - baseline) / baseline) * 100).toFixed(0)}%) lower bound on re-asks, ${Math.round(high)} (${(((high - baseline) / baseline) * 100).toFixed(0)}%) upper bound`,
      `mean request chars kept by a shortlist request: ${((100 * share.reduce((n, s) => n + s, 0)) / share.length).toFixed(0)}%`,
    ].join("\n");
    console.log(report);

    // Structural guarantees (they hold whatever the model says): a part's same-heading topic is always shown, and a part with a real shortlist
    // never shows fewer topics than its context names.
    for (const { r, i } of confident) if (norm(topics[topicIndexOf(r.topic)]!.label) === norm(r.leaf)) expect(shown(i)).toContain(topicIndexOf(r.topic));
    expect(lists.every((l) => !l || l.indices.length < topics.length)).toBe(true);
    // Retrieval never produces an outcome of its own: the topic question still ends in "new", and no choice named "unsure" is added.
    const topicChoices = (r: DecisionRequest) => Object.entries(r.questions).flatMap(([name, q]) => (name.endsWith("_topic") && q.type === "choice" ? [q.choices.map((c) => c.value)] : []));
    expect(shortAll.every((r) => topicChoices(r).every((c) => c.at(-1) === "new" && !c.includes("unsure")))).toBe(true);
  });
});
