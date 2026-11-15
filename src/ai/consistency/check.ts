/**
 * The consistency check over cards (intelligent-update-engine-plan Stage 4d–4e, §12.3): what a commit newly says, and
 * where it disagrees with the relevant cards elsewhere on the canvas. Pure: the caller retrieves the candidates (from the
 * index, which must be fresh) and stores the result (`store.ts`).
 *
 * - `cardTextOf`: a card's sentences, name and fingerprint, read from the scene and the document cache;
 * - `newClaims`: the sentences a commit added or changed (created cards: all of theirs) — only these are checked, so an old
 *   disagreement on untouched sentences isn't raised by every unrelated commit;
 * - `detect`: each claim against each sentence of each candidate card (never its own card), judged by the tier-1 rules;
 *   `conflict` and `possible` are kept, one per pair of cards (the strongest).
 * - `fixFor`: for a confirmed value disagreement, the claim-level patch that makes one card say the other's value — a
 *   proposal for the normal review, never applied here.
 */
import { applyClaimEdits, blockPlainText, type ClaimEdit } from "@/ai/changes/claimPatch";
import type { ProposedChange } from "@/ai/changes/changeSet";
import { canonicalContent } from "@/ai/content/fingerprint";
import { quantitiesOf, sameQuantity } from "@/ai/fidelity/quantities";
import { sentenceSpans } from "@/ai/fidelity/sourceUnits";
import { fingerprintOf, labelsByContainer, objectContent, type ObjectContent } from "@/ai/reconcile/objects";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { judgePair } from "./rules";
import type { Detection } from "./store";

export interface CardText {
  elementId: string;
  name: string;
  sentences: string[];
  fingerprint: string;
}

export interface Claim {
  elementId: string;
  sentence: string;
}

/** At most this many claims per commit, and candidate cards per claim (§12.6 budget). */
export const MAX_CLAIMS = 50;
export const MAX_CANDIDATES = 20;
/** A stored claim's sentence, at most (the job keeps them for a resumed check). */
export const MAX_CLAIM_CHARS = 400;

type GetDocument = (id: string) => DocumentRecord | null | undefined;

export function sentencesOf(text: string): string[] {
  return sentenceSpans(text, { start: 0, end: text.length })
    .map((s) => text.slice(s.start, s.end).trim())
    .filter(Boolean);
}

function sentencesOfContent(content: ObjectContent): string[] {
  return content.kind === "shape" ? sentencesOf(content.label) : content.content.flatMap((b) => sentencesOf(blockPlainText(b) ?? ""));
}

function nameOf(content: ObjectContent): string {
  const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);
  if (content.kind === "shape") return clip(content.label.replace(/\s+/g, " ").trim()) || "Shape";
  if (content.kind === "page" && content.title) return clip(content.title);
  const first = canonicalContent(content.content).split("\n").find((l) => l.trim()) ?? "";
  return clip(first.replace(/^#+\s*/, "").replace(/^[-*]\s+(\[[ x]\]\s+)?/, "").trim()) || "Card";
}

/** Reads cards from a scene (once per call site: build it, then look cards up). */
export function cardReader(elements: readonly SceneElement[], getDocument: GetDocument) {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e] as const));
  const labels = labelsByContainer(live);
  const cache = new Map<string, CardText | null>();
  return (elementId: string): CardText | null => {
    if (cache.has(elementId)) return cache.get(elementId)!;
    const el = byId.get(elementId);
    const content = el && el.type !== "frame" && el.type !== "arrow" && !(el.type === "text" && el.containerId) ? objectContent(el, labels, getDocument) : null;
    const card = content ? { elementId, name: nameOf(content), sentences: sentencesOfContent(content), fingerprint: fingerprintOf(content) } : null;
    cache.set(elementId, card);
    return card;
  };
}

/** The sentences each touched card says now and didn't before the commit (`before`: its sentences then; absent = new card). */
export function newClaims(before: ReadonlyMap<string, readonly string[]>, after: readonly CardText[]): Claim[] {
  const out: Claim[] = [];
  for (const card of after) {
    const was = new Set(before.get(card.elementId) ?? []);
    for (const sentence of card.sentences) if (!was.has(sentence)) out.push({ elementId: card.elementId, sentence: sentence.slice(0, MAX_CLAIM_CHARS) });
  }
  return out.slice(0, MAX_CLAIMS);
}

/** Each claim against the candidate cards (see module doc): one detection per pair of cards, the strongest. */
export function detect(claims: readonly Claim[], cardOf: (id: string) => CardText | null, candidatesOf: (claim: Claim) => readonly string[]): Detection[] {
  const best = new Map<string, Detection>();
  const rank = (d: Detection) => (d.strength === "conflict" ? 2 : 1);
  for (const claim of claims) {
    const own = cardOf(claim.elementId);
    if (!own) continue;
    for (const id of candidatesOf(claim).slice(0, MAX_CANDIDATES)) {
      if (id === claim.elementId) continue;
      const other = cardOf(id);
      if (!other) continue;
      for (const sentence of other.sentences) {
        const j = judgePair(claim.sentence, sentence);
        if (j.verdict === "compatible" || !j.kind) continue;
        const d: Detection = {
          a: { elementId: own.elementId, sentence: claim.sentence, cardName: own.name },
          b: { elementId: other.elementId, sentence, cardName: other.name },
          kind: j.kind,
          strength: j.verdict,
          reason: j.reason,
        };
        const key = [own.elementId, other.elementId].sort().join("|");
        const prev = best.get(key);
        if (!prev || rank(d) > rank(prev)) best.set(key, d);
      }
    }
  }
  return [...best.values()];
}

/**
 * The patch that makes `target`'s sentence say `source`'s value (a confirmed `differs` conflict): the value as written
 * in the target's sentence replaced by the source's, located by the whole sentence as context. Null when the values
 * can't be paired, or the edit can't be placed exactly on the card as it is now.
 */
export function fixFor(target: { elementId: string; sentence: string }, source: { sentence: string }, content: ObjectContent | null): Extract<ProposedChange, { kind: "patch_block" }> | null {
  if (!content || content.kind === "shape") return null;
  const qt = quantitiesOf(target.sentence);
  const qs = quantitiesOf(source.sentence);
  const from = qt.find((t) => qs.some((s) => s.dimension === t.dimension && !sameQuantity(s, t)));
  const to = from && qs.find((s) => s.dimension === from.dimension && !sameQuantity(s, from));
  if (!from || !to) return null;
  const blockIndex = content.content.findIndex((b) => (blockPlainText(b) ?? "").includes(target.sentence));
  if (blockIndex < 0) return null;
  const block = content.content[blockIndex]!;
  const edit: ClaimEdit = {
    blockIndex,
    ...(block.id ? { blockId: block.id } : {}),
    match: { anchor: { before: target.sentence.slice(0, from.start), text: target.sentence.slice(from.start, from.end), after: target.sentence.slice(from.end) } },
    replacement: to.text,
    intent: "SUPERSEDES",
  };
  if (!applyClaimEdits(content.content, [edit]).ok) return null;
  return { kind: "patch_block", target: target.elementId, expectedFingerprint: fingerprintOf(content), edits: [edit] };
}
