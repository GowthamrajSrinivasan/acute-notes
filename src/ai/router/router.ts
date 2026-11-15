/**
 * The Node Router (intelligent-update-engine-plan Stage 2c): where content with no source belongs — a line pasted in,
 * an Ask AI answer, an MCP agent's note. It never runs for source-anchored updates: those reconcile version N → N+1 of
 * their own source; "impact discovery" (other cards a source change may affect, Stage 3) is `discoverImpact`.
 *
 * Ranks the cards on a canvas by four signals, each kept as evidence:
 * - **semantic** — cosine similarity of the content to the card (`VectorTier`, Stage 2a);
 * - **lexical** — the index's own retrieval score for the content's words, relative to the best hit;
 * - **section** — how well the card's whole section (its cards and summary) matches: the hierarchical route;
 * - **graph** — a link to a strong candidate (the cards drawn connected to it), which also pulls such neighbours in.
 * Past choices for similar content add a small boost (`signals.ts`).
 *
 * Then, for each candidate, what to do there: `update` when the card already holds the claim (one of its sentences says
 * the same thing about the same matter — its intent classified as in Stage 1a), `none` when it says it already, else
 * `insert_near` (a new card beside it, in its section).
 *
 * Two confidences, never blended (reviewer refinement C): `routing` — is this the right place? — and `update` — does the
 * proposed edit correctly take the new information in? A certain destination with a contradictory edit is exactly the
 * case that must reach a person. The decision uses routing alone: `route`, `NEEDS_CLARIFICATION` (two places too close
 * to call), or `NEW` (no card is close enough: a new card).
 */
import { classifyClaimChange, ESCALATED_INTENTS, SUPERSEDE_OVERLAP } from "@/ai/reconcile/intent";
import type { UpdateIntent } from "@/ai/changes/claimPatch";
import { sentenceSpans, wordOverlap } from "@/ai/fidelity/sourceUnits";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { IndexKindFilter } from "@/search/workspaceIndex";
import { DescriptorCache, sectionsOf, type CardDescriptor, type SectionInfo } from "./descriptors";
import { centroid, cosine, embeddedText, type SparseVector, type VectorTier } from "./embedding";
import type { RoutingSignals } from "./signals";

/**
 * The router's three modes (plan §3). `routeContent` runs `unanchored`; `impact_discovery` (Stage 3) runs on an update's
 * change set as `discoverImpact` (`ai/reconcile/impact.ts`), offering other cards that repeat a changed fact as reviewed
 * decisions; `source_reconciliation` is the update itself.
 */
export type RouterMode = "source_reconciliation" | "unanchored" | "impact_discovery";

export class RouterModeUnavailableError extends Error {
  constructor(readonly mode: RouterMode) {
    super(
      mode === "source_reconciliation"
        ? "Source-anchored content is reconciled with its own source (Update from new content), never routed."
        : "Impact discovery runs on an update's change set (`discoverImpact`, ai/reconcile/impact.ts), not on loose content.",
    );
    this.name = "RouterModeUnavailableError";
  }
}

export type RouteAction = "update" | "insert_near" | "none";
export type RouteDecision = "route" | "NEEDS_CLARIFICATION" | "NEW";

export interface RouteCandidate {
  /** The card's element id. */
  id: string;
  descriptor: CardDescriptor;
  action: RouteAction;
  /** Is this the right place? 0–1. */
  routing: number;
  /** Does the proposed edit take the new information in correctly? 0–1. Separate from `routing`, never combined with it. */
  update: number;
  scores: { semantic: number; lexical: number; section: number; graph: number; signal: number };
  /** `update` / `none`: the card's sentence that holds the claim, and what the new content means for it. */
  claim?: { sentence: string; newSentence: string; intent: UpdateIntent; detail: string; escalate: boolean };
  /** Why, in short lines a person can check. */
  evidence: string[];
}

export interface RouteResult {
  mode: "unanchored";
  decision: RouteDecision;
  /** Best first; at most `limit`. */
  candidates: RouteCandidate[];
  /** The sections, best first, by how well they match as a whole. */
  sections: { section: SectionInfo; score: number }[];
  /** Why the decision, in a line. */
  reason: string;
}

export interface RouteInput {
  text: string;
  canvasId: string;
  tier: VectorTier;
  /** The canvas's elements (sections and which card is in which). */
  scene: readonly SceneElement[];
  signals?: RoutingSignals;
  descriptors?: DescriptorCache;
  mode?: RouterMode;
  limit?: number;
}

/** What can be a destination: content cards and shapes (never canvases or relations). */
export const CARD_KINDS: readonly IndexKindFilter[] = ["text", "todo", "table", "code", "page", "note", "shape"];

export const WEIGHTS = { semantic: 0.5, lexical: 0.25, section: 0.15, graph: 0.1 } as const;
/** Below this routing score no card is a destination: the content becomes a new card. */
export const ROUTE_FLOOR = 0.2;
/** Two destinations closer than this (in different sections, or both an update) need the user to choose. */
export const CLARIFY_MARGIN = 0.08;
/** A card sentence sharing at least this share of significant words with the content holds the same claim. */
export const CLAIM_OVERLAP = SUPERSEDE_OVERLAP;
const POOL = 30;

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const quote = (s: string, n = 60) => `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”`;

export function routeContent(input: RouteInput): RouteResult {
  const mode = input.mode ?? "unanchored";
  if (mode !== "unanchored") throw new RouterModeUnavailableError(mode);
  const { tier, canvasId, text } = input;
  const limit = input.limit ?? 5;
  const descriptors = input.descriptors ?? new DescriptorCache();
  const v = tier.embed(text);
  const { frames, frameOf } = sectionsOf(input.scene);

  // The pool: the nearest cards by meaning and the best by words.
  const semantic = new Map(tier.nearest(v, { canvasId, kinds: CARD_KINDS, limit: POOL }).map((h) => [h.id, h.score] as const));
  const hits = tier.query({ text, mode: "any", canvasId, kinds: CARD_KINDS, limit: POOL }).hits;
  const best = hits[0]?.score ?? 0;
  const lexical = new Map(hits.map((h) => [h.id, best ? h.score / best : 0] as const));
  const terms = new Map(hits.map((h) => [h.id, h.matchedTerms] as const));

  // Sections as wholes: each frame's cards and its own name and summary.
  const members = new Map<string, string[]>();
  for (const o of tier.base.objects({ canvasId, kinds: CARD_KINDS })) {
    const f = frameOf.get(o.id);
    if (f && frames.has(f)) members.set(f, [...(members.get(f) ?? []), o.id]);
  }
  const sectionScore = new Map<string, number>();
  for (const [id, info] of frames) {
    const vectors = (members.get(id) ?? []).map((m) => tier.vectorOf(m)).filter((x): x is SparseVector => !!x);
    vectors.push(tier.embed(`${info.name}\n${info.takeaway ?? ""}`));
    sectionScore.set(id, cosine(v, centroid(vectors)));
  }
  const sections = [...frames.values()].map((section) => ({ section, score: round(sectionScore.get(section.id) ?? 0) })).sort((a, b) => b.score - a.score);
  const bestSection = sections[0]?.score ? sections[0].section.id : undefined;

  // Only objects on this canvas can be a destination (an element of its scene): never a document the index holds off it —
  // an older version of a card kept for undo, a block of another canvas (found live, 2026-11-13).
  const onCanvas = new Set(input.scene.flatMap((e) => (e.isDeleted ? [] : [e.id])));
  const pooled = [...semantic.keys(), ...lexical.keys()].filter((id) => onCanvas.has(id));
  // Base scores, then the graph: links to strong candidates count, and their linked cards join the pool.
  const ids = new Set(pooled);
  const base = (id: string) => WEIGHTS.semantic * (semantic.get(id) ?? cosineOf(tier, id, v)) + WEIGHTS.lexical * (lexical.get(id) ?? 0) + WEIGHTS.section * (sectionScore.get(frameOf.get(id) ?? "") ?? 0);
  const strong = [...ids].sort((a, b) => base(b) - base(a)).slice(0, 3);
  const edges = tier.relations(canvasId);
  const linkedTo = new Map<string, string[]>();
  for (const e of edges) {
    linkedTo.set(e.from, [...(linkedTo.get(e.from) ?? []), e.to]);
    linkedTo.set(e.to, [...(linkedTo.get(e.to) ?? []), e.from]);
  }
  for (const s of strong) for (const n of linkedTo.get(s) ?? []) if (onCanvas.has(n) && tier.get(n) && isCard(tier, n)) ids.add(n);
  const boosts = input.signals?.boosts(text) ?? new Map<string, number>();

  const textSentences = sentencesOf(text);
  const candidates: RouteCandidate[] = [];
  for (const id of ids) {
    const o = tier.get(id);
    if (!o) continue;
    const sem = semantic.get(id) ?? cosineOf(tier, id, v);
    const lex = lexical.get(id) ?? 0;
    const frame = frameOf.get(id);
    const sec = sectionScore.get(frame ?? "") ?? 0;
    const neighbours = (linkedTo.get(id) ?? []).filter((n) => strong.includes(n) && n !== id);
    const graph = neighbours.length ? Math.max(...neighbours.map(base)) : 0;
    const signal = boosts.get(id) ?? 0;
    const routing = clamp(WEIGHTS.semantic * sem + WEIGHTS.lexical * lex + WEIGHTS.section * sec + WEIGHTS.graph * graph + signal);
    const descriptor = descriptors.describe(o, frame ? frames.get(frame) : undefined, (t) => tier.frequency(t), tier.size);

    const evidence: string[] = [];
    if (sem > 0) evidence.push(`similar in meaning (${round(sem)})`);
    const shared = terms.get(id) ?? [];
    if (shared.length) evidence.push(`shares ${shared.slice(0, 4).map((w) => `“${w}”`).join(", ")}`);
    if (frame && frame === bestSection) evidence.push(`in the best-matching section “${frames.get(frame)!.name}”`);
    else if (frame && sec > 0) evidence.push(`in section “${frames.get(frame)!.name}” (${round(sec)})`);
    for (const n of neighbours.slice(0, 2)) evidence.push(`linked to ${quote(tier.get(n)?.title ?? summaryText(tier, n), 40)}`);
    if (signal) evidence.push("you placed similar content here before");

    // What to do there: does the card already hold the claim?
    const claim = claimIn(embeddedText(o), textSentences);
    let action: RouteAction = "insert_near";
    let update = INSERT_CONFIDENCE;
    if (claim) {
      action = claim.intent === "DUPLICATE" ? "none" : "update";
      update = updateConfidence(claim.intent, claim.overlap);
      evidence.push(
        claim.intent === "DUPLICATE"
          ? `already says it: ${quote(claim.sentence)}`
          : `holds the claim ${quote(claim.sentence)} — the new content ${VERB[claim.intent]} it`,
      );
    }
    candidates.push({
      id,
      descriptor,
      action,
      routing: round(routing),
      update: round(update),
      scores: { semantic: round(sem), lexical: round(lex), section: round(sec), graph: round(graph), signal: round(signal) },
      ...(claim
        ? { claim: { sentence: claim.sentence, newSentence: claim.newSentence, intent: claim.intent, detail: claim.detail, escalate: ESCALATED_INTENTS.has(claim.intent) } }
        : {}),
      evidence,
    });
  }
  candidates.sort((a, b) => b.routing - a.routing || (a.id < b.id ? -1 : 1));
  // Decide on the full ranking, then cut it to `limit`: a close second must still make it ask even when only the
  // top candidate is shown (D1, stage2-routing-acceptance-2026-11-15.md).
  return { mode: "unanchored", ...decide(candidates), candidates: candidates.slice(0, limit), sections };
}

/** An insert copies the content in as it is: nothing existing is reworded or overwritten. */
export const INSERT_CONFIDENCE = 0.9;

const VERB: Record<UpdateIntent, string> = { NEW: "adds to", SUPERSEDES: "replaces", EXTENDS: "extends", CONTRADICTS: "contradicts", DUPLICATE: "repeats", UNCLEAR: "rewrites" };

/** How sure an edit of the claim is to take the new information in correctly (never the routing score). */
export function updateConfidence(intent: UpdateIntent, overlap: number): number {
  switch (intent) {
    case "DUPLICATE":
      return 1;
    case "SUPERSEDES":
    case "EXTENDS":
      return clamp(0.5 + 0.5 * overlap);
    case "CONTRADICTS":
      return 0.15;
    default:
      return 0.1;
  }
}

function decide(candidates: readonly RouteCandidate[]): Pick<RouteResult, "decision" | "reason"> {
  const [top, second] = candidates;
  if (!top || top.routing < ROUTE_FLOOR) return { decision: "NEW", reason: "no card is close enough: it becomes a new card" };
  const rival =
    second &&
    second.routing >= ROUTE_FLOOR &&
    top.routing - second.routing < CLARIFY_MARGIN &&
    // Two cards of one section, both getting a card beside them, lead to the same place: not a real choice.
    (top.descriptor.section?.id !== second.descriptor.section?.id || (top.action === "update" && second.action === "update"));
  if (rival) return { decision: "NEEDS_CLARIFICATION", reason: `${quote(top.descriptor.title, 40)} and ${quote(second.descriptor.title, 40)} fit about equally well` };
  return { decision: "route", reason: `best fit: ${quote(top.descriptor.title, 40)} (${top.routing})` };
}

function cosineOf(tier: VectorTier, id: string, v: SparseVector): number {
  const vec = tier.vectorOf(id);
  return vec ? cosine(v, vec) : 0;
}

function isCard(tier: VectorTier, id: string): boolean {
  const kind = tier.get(id)?.kind;
  return !!kind && kind !== "canvas" && kind !== "relation";
}

function summaryText(tier: VectorTier, id: string): string {
  return (tier.get(id)?.text ?? "").split("\n")[0] ?? "";
}

function sentencesOf(text: string): string[] {
  return sentenceSpans(text, { start: 0, end: text.length }).map((s) => text.slice(s.start, s.end));
}

/** The card sentence that holds one of the content's claims (most shared words, at least `CLAIM_OVERLAP`), classified. */
function claimIn(cardText: string, newSentences: readonly string[]): { sentence: string; newSentence: string; intent: UpdateIntent; detail: string; overlap: number } | null {
  let best: { sentence: string; newSentence: string; overlap: number } | null = null;
  for (const sentence of sentencesOf(cardText)) {
    for (const n of newSentences) {
      const overlap = wordOverlap(sentence, n);
      if (overlap >= CLAIM_OVERLAP && (!best || overlap > best.overlap)) best = { sentence, newSentence: n, overlap };
    }
  }
  if (!best) return null;
  const verdict = classifyClaimChange(best.sentence, best.newSentence);
  return { ...best, intent: verdict.intent, detail: verdict.detail };
}
