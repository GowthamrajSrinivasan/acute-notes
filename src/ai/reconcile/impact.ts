/**
 * Impact discovery (intelligent-update-engine-plan Stage 3, "multi-location sync", Case A): when an update from new
 * content changes a fact on one card, find the *other* cards on the canvas that repeat the same fact, and offer the same
 * edit there — the router's third mode (§3), switched on now that the result is coordinated and reviewed.
 *
 * Source-anchored updates never fan out silently. What this adds to the update's change set:
 * - **restates** — a card from elsewhere (the user's own, an Ask AI answer, another source's) has a sentence that holds
 *   the changed claim (the router's own test: at least `CLAIM_OVERLAP` of its significant words) and the changed words
 *   exactly once: a claim-level `patch_block` with the same edit, offered as a `ConflictItem` with `impact`. Like every
 *   conflict it is never applied by "Accept all": each needs "Update this too" (or "Leave as is", which adds nothing). At
 *   accept it is checked against the card's live content like any patch.
 * - **related** — a card that holds the claim in other words (the changed words aren't there exactly once, or the same
 *   edit wouldn't read as the same change there), a shape whose label repeats it, or a card drawn linked to a changed one
 *   that shares its words: listed on the set (`ChangeSet.related`), never edited. The duplication-vs-reference flag.
 *
 * Which changes count: a sentence the source changed in place whose meaning is SUPERSEDES or EXTENDS (Stage 1a) — a
 * clean, applied change. A contradiction or an unclear rewrite is already escalated on its own card, and a sentence added
 * or removed is no claim another card can repeat in a changed form, so none of those propagate.
 *
 * Never touched: the source's own cards (each reconciles from its own text — if the source still says the old value in
 * another section, that card is right), cards the set already changes, cards opted out of AI updates, and locked cards
 * (counted into `skipped.locked` when they repeat the fact, unless "Preserve locked sections" is off).
 *
 * Note markers are not words: an annotated card's small numbered markers ("traffic.¹ Retries happen five times.²", "² <the
 * note>") are read as spaces, so sentences split where the card's do and a quoted claim carries none (U7 live run, §19.7).
 *
 * Lexical, deterministic, no model call: "same claim" is the router's word-overlap test plus exact placement of the changed
 * words. When the local embedding model is running (semantic placement, §18), `impactMeaning.ts` checks what this finds
 * for meaning and reads the sentences it skipped (#14): `scanImpact` → meaning pass → `assembleImpact`.
 */
import { applyClaimEdits, blockPlainText, describeClaimEdit, type ClaimEdit } from "@/ai/changes/claimPatch";
import type { ChangeSet, ConflictItem, ProposedChange, RelatedCard } from "@/ai/changes/changeSet";
import { canonicalContent } from "@/ai/content/fingerprint";
import { significant } from "@/ai/fidelity/information";
import { sentenceSpans, wordOverlap } from "@/ai/fidelity/sourceUnits";
import type { SceneElement } from "@/domain/canvas/adapter";
import { isLocked, optedOutBesidesLock } from "@/domain/canvas/lock";
import { reconciliationOf } from "@/domain/provenance";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { alignSentences, wordHunk } from "./claimPlanner";
import { classifyClaimChange, SUPERSEDE_OVERLAP } from "./intent";
import { fingerprintOf, labelsByContainer, objectContent, type ObjectContent } from "./objects";

/** One fact the update changes on one of its cards. */
export interface ChangedClaim {
  /** The card (element id) the source changed it on. */
  from: string;
  /** The sentence before and after. */
  before: string;
  after: string;
  /** The changed words of `before` (whole words) and what replaces them. */
  old: string;
  replacement: string;
  intent: "SUPERSEDES" | "EXTENDS";
}

export interface ImpactInput {
  /** The update's change set (its clean changes are what changed). */
  set: ChangeSet;
  /** The content source being updated: its own cards are never impact targets. */
  sourceId: string;
  elements: readonly SceneElement[];
  getDocument: (id: string) => DocumentRecord | null | undefined;
  /** AI settings → "Preserve locked sections" (default on): locked cards are left alone. */
  preserveLockedSections?: boolean;
  /** At most this many cards offered, and as many listed as related (default `MAX_IMPACT`). */
  limit?: number;
}

export interface ImpactResult {
  claims: ChangedClaim[];
  /** One per card that repeats a changed fact: its patch, as a decision. Best match first. */
  conflicts: ConflictItem[];
  related: RelatedCard[];
  /** Locked cards that repeat a changed fact and are left alone. */
  locked: number;
}

/** A sentence holding at least this share of a claim's significant words repeats it (the router's `CLAIM_OVERLAP`). */
export const IMPACT_OVERLAP = SUPERSEDE_OVERLAP;
export const MAX_IMPACT = 20;
/** A proposed card's text kept for the review's side-by-side, at most. */
const MAX_PROPOSED = 20_000;

const WORD = /[\p{L}\p{N}_]/u;

/** The small numbered markers an annotated card puts after a phrase (¹ ² ³ ⁰ ⁴–⁹): not words, and no sentence ends on one. */
const NOTE_MARK = /[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]/g;
/** `text` with each note marker read as a space: the same length, so a range found in it is the same range in the card. */
export const unmark = (text: string): string => text.replace(NOTE_MARK, " ");
/** A sentence as it is quoted and compared: no markers, single spaces. */
const tidy = (text: string): string => unmark(text).replace(/\s+/g, " ").trim();

/** Finds what the update changes and where else on the canvas it is said (see module doc). Pure. */
export function discoverImpact(input: ImpactInput): ImpactResult {
  const { claims, cards } = scanImpact(input);
  return assembleImpact(claims, cards, input.limit ?? MAX_IMPACT);
}

/** One other card that may repeat a changed fact, as the word-overlap scan found it (`matchesIn`). */
export interface CardScan {
  el: SceneElement;
  content: ObjectContent;
  name: string;
  /** Locked (or in a locked section) with "Preserve locked sections" on: never edited, only counted. */
  locked: boolean;
  restates: Restatement[];
  related: LexicalRelated[];
  /** Drawn linked to a card whose fact changed and sharing a word of it: listed only when nothing else is found. */
  linked: (RelatedCard & { score: number }) | null;
  /** Its sentences that share too few words with every claim to be compared: what the meaning pass (#14) reads. */
  unmatched: { sentence: string; overlap: number }[];
  /** Added by the meaning pass: the card says a changed fact in other words. */
  meaning?: (RelatedCard & { score: number }) | null;
}

/** The changed claims and every other card that may repeat one (see module doc). Pure. */
export function scanImpact(input: ImpactInput): { claims: ChangedClaim[]; cards: CardScan[] } {
  const { set, elements, getDocument } = input;
  const preserveLocked = input.preserveLockedSections !== false;
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e] as const));
  const labels = labelsByContainer(live);

  const claims = dedupe(set.changes.flatMap((c) => claimsOf(c, byId, labels, getDocument)));
  if (!claims.length) return { claims, cards: [] };

  const touched = new Set<string>([...set.changes.flatMap((c) => ("target" in c ? [c.target] : [])), ...(set.conflicts ?? []).map((c) => c.target)]);
  const lockedFrames = new Set(live.flatMap((el) => (el.type === "frame" && isLocked(el) ? [el.id] : [])));
  const from = new Set(claims.map((c) => c.from));
  const linked = new Map<string, Set<string>>();
  for (const el of live) {
    const a = el.type === "arrow" ? el.startBinding?.elementId : undefined;
    const b = el.type === "arrow" ? el.endBinding?.elementId : undefined;
    if (!a || !b) continue;
    if (from.has(b)) linked.set(a, (linked.get(a) ?? new Set()).add(b));
    if (from.has(a)) linked.set(b, (linked.get(b) ?? new Set()).add(a));
  }

  const cards: CardScan[] = [];
  for (const el of live) {
    if (touched.has(el.id) || el.type === "frame" || el.type === "arrow" || (el.type === "text" && el.containerId)) continue;
    const content = objectContent(el, labels, getDocument);
    if (!content) continue;
    const link = reconciliationOf(el, getDocument);
    if (link?.contentSourceId === input.sourceId) continue; // the source's own cards reconcile from its own text
    const lockedHere = isLocked(el) || (!!el.frameId && lockedFrames.has(el.frameId));
    if (link && optedOutBesidesLock(el, link.excludeFromReconciliation)) continue; // opted out of AI updates (a passage card, "Don't update")
    const name = nameOf(content);
    const found = matchesIn(content, claims);
    let linkedRef: CardScan["linked"] = null;
    // Drawn linked to a card whose fact changed, and about the same thing (shares a word of it): a reference, not a repeat.
    for (const f of linked.get(el.id) ?? []) {
      const claim = claims.find((c) => c.from === f);
      if (!claim || !shares(plainOf(content), claim.before)) continue;
      linkedRef = { target: el.id, name, reason: `linked to ${quote(nameOf(objectContent(byId.get(f)!, labels, getDocument)), 40)}, which this update changes — not edited`, score: 0 };
      break;
    }
    cards.push({ el, content, name, locked: lockedHere && preserveLocked, restates: found.restates, related: found.related, linked: linkedRef, unmatched: found.unmatched });
  }
  return { claims, cards };
}

/** The offers, related cards and locked count from scanned cards (after the meaning pass, when it ran). Pure. */
export function assembleImpact(claims: ChangedClaim[], cards: readonly CardScan[], limit: number = MAX_IMPACT): ImpactResult {
  const offers: { item: ConflictItem; score: number }[] = [];
  const related: (RelatedCard & { score: number })[] = [];
  let locked = 0;
  for (const card of cards) {
    const { el, content, name } = card;
    if (card.locked) {
      if (card.restates.length) locked++;
      continue;
    }
    if (card.restates.length) {
      const edits = card.restates.map((r) => r.edit);
      const applied = content.kind === "shape" ? null : applyClaimEdits(content.content, edits);
      if (applied?.ok && content.kind !== "shape") {
        const top = best(card.restates);
        const body = canonicalContent(applied.content);
        const proposed = content.kind === "page" ? `# ${content.title}\n\n${body}`.trim() : body;
        offers.push({
          score: top.overlap,
          item: {
            target: el.id,
            name,
            apply: { kind: "patch_block", target: el.id, expectedFingerprint: fingerprintOf(content), edits },
            impact: {
              from: top.claim.from,
              claim: clip(top.claim.before, 500),
              detail: clip(edits.map(describeClaimEdit).join("; "), 500),
              proposed: clip(proposed, MAX_PROPOSED),
            },
          },
        });
        continue;
      }
      // The edits can't all be made at once (two of them overlap): the card is pointed out, not edited.
      related.push({ target: el.id, name, reason: `repeats ${quote(best(card.restates).claim.before)} — the edit couldn't be placed exactly; check it`, score: best(card.restates).overlap });
      continue;
    }
    if (card.related.length) {
      const top = card.related.reduce((a, b) => (b.score > a.score ? b : a));
      related.push({ target: el.id, name, reason: top.reason, score: top.score });
      continue;
    }
    if (card.linked) related.push(card.linked);
    else if (card.meaning) related.push(card.meaning);
  }
  offers.sort((a, b) => b.score - a.score || (a.item.target < b.item.target ? -1 : 1));
  related.sort((a, b) => b.score - a.score || (a.target < b.target ? -1 : 1));
  return {
    claims,
    conflicts: offers.slice(0, limit).map((o) => o.item),
    related: related.slice(0, limit).map(({ score: _score, ...r }) => r),
    locked,
  };
}

/** The set with its impact added: the offers as conflicts (each a decision), the related cards listed, locked ones counted. */
export function withImpact(set: ChangeSet, impact: Pick<ImpactResult, "conflicts" | "related" | "locked">): ChangeSet {
  if (!impact.conflicts.length && !impact.related.length && !impact.locked) return set;
  return {
    ...set,
    ...(impact.conflicts.length ? { conflicts: [...(set.conflicts ?? []), ...impact.conflicts] } : {}),
    ...(impact.related.length ? { related: [...(set.related ?? []), ...impact.related].slice(0, MAX_IMPACT) } : {}),
    ...(impact.locked ? { skipped: { locked: (set.skipped?.locked ?? 0) + impact.locked } } : {}),
  };
}

// ---------------------------------------------------------------------------
// What changed

/** The facts one change of the set changes: sentences changed in place, SUPERSEDES or EXTENDS only. */
function claimsOf(
  change: ProposedChange,
  byId: ReadonlyMap<string, SceneElement>,
  labels: ReadonlyMap<string, string>,
  getDocument: ImpactInput["getDocument"],
): ChangedClaim[] {
  if (change.kind !== "patch_block" && change.kind !== "update_block" && change.kind !== "update_shape") return [];
  const el = byId.get(change.target);
  const current = el ? objectContent(el, labels, getDocument) : null;
  if (!current) return [];
  if (change.kind === "update_shape") return current.kind === "shape" ? sentenceClaims(change.target, current.label, change.label) : [];
  if (current.kind === "shape") return [];
  let after: RichContent;
  if (change.kind === "patch_block") {
    const applied = applyClaimEdits(current.content, change.edits);
    if (!applied.ok) return [];
    after = applied.content;
  } else after = change.content;
  // Blocks lined up as sentences are: identical ones anchor, changed ones pair (a block that isn't prose never matches).
  const was = current.content.map((b, i) => blockPlainText(b) ?? `\u0000${i}`);
  const now = after.map((b, i) => blockPlainText(b) ?? `\u0001${i}`);
  return alignSentences(was, now).flatMap((op) => (op.kind === "change" ? sentenceClaims(change.target, was[op.o]!, now[op.n]!) : []));
}

function sentenceClaims(from: string, was: string, now: string): ChangedClaim[] {
  if (was.startsWith("\u0000") || now.startsWith("\u0001")) return [];
  const os = sentencesOf(unmark(was)).map(tidy).filter(Boolean);
  const ns = sentencesOf(unmark(now)).map(tidy).filter(Boolean);
  return alignSentences(os, ns).flatMap((op) => {
    if (op.kind !== "change") return [];
    const before = os[op.o]!;
    const after = ns[op.n]!;
    const { intent } = classifyClaimChange(before, after);
    if (intent !== "SUPERSEDES" && intent !== "EXTENDS") return [];
    const hunk = wordHunk(before, after);
    const old = before.slice(hunk.start, hunk.end);
    if (!old.trim()) return [];
    return [{ from, before, after, old, replacement: hunk.replacement, intent }];
  });
}

function dedupe(claims: ChangedClaim[]): ChangedClaim[] {
  const seen = new Set<string>();
  return claims.filter((c) => {
    const key = `${c.before}\u0000${c.after}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Where else it is said

export interface Restatement {
  claim: ChangedClaim;
  edit: ClaimEdit;
  overlap: number;
  /** The card's sentence that repeats the claim. */
  sentence: string;
}

/** A sentence that holds a claim but can't take the same edit: listed, never edited. */
export interface LexicalRelated {
  reason: string;
  score: number;
  claim: ChangedClaim;
  sentence: string;
}

/** A card's sentences against the changed claims: the ones that repeat a claim (with their edit), and why others relate. */
function matchesIn(content: ObjectContent, claims: readonly ChangedClaim[]): { restates: Restatement[]; related: LexicalRelated[]; unmatched: CardScan["unmatched"] } {
  const restates: Restatement[] = [];
  const related: LexicalRelated[] = [];
  const unmatched: CardScan["unmatched"] = [];
  const blocks = content.kind === "shape" ? [content.label] : content.content.map((b) => blockPlainText(b));
  blocks.forEach((marked, blockIndex) => {
    if (!marked) return;
    // Markers read as spaces: the same offsets, so an edit's range is the card's own.
    const text = unmark(marked);
    for (const span of sentenceSpans(text, { start: 0, end: text.length })) {
      const sentence = text.slice(span.start, span.end);
      const said = tidy(sentence);
      let closest = 0;
      for (const claim of claims) {
        const overlap = wordOverlap(sentence, claim.before);
        closest = Math.max(closest, overlap);
        if (overlap < IMPACT_OVERLAP) continue;
        const at = wholeWordIndexes(sentence, claim.old);
        if (at.length === 0) {
          // Says it already the new way: nothing to do. Otherwise it holds the claim in other words.
          if (wholeWordIndexes(sentence, claim.replacement).length || wordOverlap(sentence, claim.after) > overlap) continue;
          related.push({ reason: `holds ${quote(claim.before)} in other words — not edited; check it`, score: overlap, claim, sentence: said });
          continue;
        }
        if (at.length > 1) {
          related.push({ reason: `repeats ${quote(claim.before)}, but the changed words appear more than once — not edited; check it`, score: overlap, claim, sentence: said });
          continue;
        }
        const i = at[0]!;
        const edited = sentence.slice(0, i) + claim.replacement + sentence.slice(i + claim.old.length);
        const verdict = classifyClaimChange(sentence, edited).intent;
        if (content.kind === "shape" || (verdict !== "SUPERSEDES" && verdict !== "EXTENDS")) {
          related.push({ reason: content.kind === "shape" ? `its label repeats ${quote(claim.before)} — a shape's label isn't edited here` : `repeats ${quote(claim.before)}, but the same edit wouldn't read as the same change here — not edited`, score: overlap, claim, sentence: said });
          continue;
        }
        const start = span.start + i;
        const block = content.content[blockIndex]!;
        restates.push({
          claim,
          overlap,
          sentence: said,
          edit: { blockIndex, ...(block.id ? { blockId: block.id } : {}), match: { range: { start, end: start + claim.old.length }, text: claim.old }, replacement: claim.replacement, intent: verdict },
        });
      }
      if (closest < IMPACT_OVERLAP && said) unmatched.push({ sentence: said, overlap: closest });
    }
  });
  // One edit per place: two claims with the same words in one sentence would overlap.
  const unique = restates.filter((r, k) => restates.findIndex((o) => o.edit.blockIndex === r.edit.blockIndex && rangeOf(o.edit).start === rangeOf(r.edit).start) === k);
  return { restates: unique, related, unmatched };
}

const rangeOf = (e: ClaimEdit) => ("range" in e.match ? e.match.range : { start: -1, end: -1 });
const best = (rs: readonly Restatement[]) => rs.reduce((a, b) => (b.overlap > a.overlap ? b : a));

/** Where `needle` starts in `text` as whole words (no letter or digit glued on either side). */
export function wholeWordIndexes(text: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    const left = i > 0 && WORD.test(text[i - 1]!) && WORD.test(needle[0]!);
    const end = i + needle.length;
    const right = end < text.length && WORD.test(text[end]!) && WORD.test(needle[needle.length - 1]!);
    if (!left && !right) out.push(i);
  }
  return out;
}

function sentencesOf(text: string): string[] {
  return sentenceSpans(text, { start: 0, end: text.length }).map((s) => text.slice(s.start, s.end));
}

function plainOf(content: ObjectContent): string {
  return unmark(content.kind === "shape" ? content.label : content.content.map((b) => blockPlainText(b) ?? "").join("\n"));
}

function shares(a: string, b: string): boolean {
  const words = new Set(significant(b));
  return significant(a).some((w) => words.has(w));
}

/** A card's name for the review: a page's title, else its first line (a shape's label). */
function nameOf(content: ObjectContent | null): string {
  if (!content) return "a card";
  if (content.kind === "shape") return clip(tidy(content.label), 60) || "Shape";
  if (content.kind === "page" && content.title) return clip(tidy(content.title), 60);
  const first = canonicalContent(content.content).split("\n").find((l) => tidy(l)) ?? "";
  return clip(tidy(first.replace(/^#+\s*/, "").replace(/^[-*]\s+(\[[ x]\]\s+)?/, "")), 60) || "Card";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const quote = (s: string, n = 60) => `“${clip(s, n)}”`;
