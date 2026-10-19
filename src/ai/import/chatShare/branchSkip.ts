/**
 * The branch-skip layer (chat-share plan §6.2). Pure and run before any AI call, so content two chats share is
 * analysed once. Rules, exact first:
 *   1. the same share id / conversation id is imported once (always on);
 *   2. a branch skips the turns it shares with its parent (same message id and hash) when the parent is imported;
 *   3. a long-enough turn whose hash an earlier chat already kept is skipped (any provider);
 *   4. a prefix of the same user turns with near-identical assistant turns is kept once.
 * With `enabled: false` only rule 1 runs. A skipped turn stays linked to the chat that keeps it (`alsoIn`).
 */
import { coverageOf, significant } from "@/ai/fidelity/information";
import type { ChatTranscript, ChatTurn } from "./types";

/** A turn shorter than this is too generic ("yes", "thanks") to treat as the same turn in an unrelated chat. */
const MIN_EXACT_CHARS = 40;
/** Both directions must reach this word coverage for two assistant turns to count as the same answer. */
const NEAR_THRESHOLD = 0.9;
/** A near-duplicate prefix needs at least this many turns to be trusted. */
const MIN_NEAR_PREFIX = 2;

export type SkipRule = "branch" | "exact" | "near";

export interface SkippedTurn {
  turn: ChatTurn;
  rule: SkipRule;
  /** The chat that keeps this turn's content. */
  keptIn: { shareId: string; title: string };
}

export interface ImportedChat {
  transcript: ChatTranscript;
  kept: ChatTurn[];
  skipped: SkippedTurn[];
  /** Titles from the oldest ancestor to this chat, when the lineage is known. */
  lineage?: string[];
  /** One-line facts for the preview ("4 of 8 turns already in 'X' — skipped"). */
  notes: string[];
}

export interface BranchSkipResult {
  chats: ImportedChat[];
  /** Links dropped because the same conversation was already in the list. */
  duplicates: { shareId: string; title: string }[];
  /** For a kept turn (`<shareId>:<turnId>`), the shareIds of other chats that contain it. */
  alsoIn: Record<string, string[]>;
}

const key = (shareId: string, turnId: string) => `${shareId}:${turnId}`;

export function applyBranchSkip(transcripts: readonly ChatTranscript[], options: { enabled: boolean }): BranchSkipResult {
  // Rule 1.
  const duplicates: BranchSkipResult["duplicates"] = [];
  const unique: ChatTranscript[] = [];
  const seenShare = new Set<string>();
  const seenConversation = new Set<string>();
  for (const t of transcripts) {
    if (seenShare.has(t.shareId) || (t.conversationId && seenConversation.has(t.conversationId))) {
      duplicates.push({ shareId: t.shareId, title: t.title });
      continue;
    }
    seenShare.add(t.shareId);
    if (t.conversationId) seenConversation.add(t.conversationId);
    unique.push(t);
  }

  if (!options.enabled) {
    return {
      chats: unique.map((transcript) => ({ transcript, kept: [...transcript.turns], skipped: [], notes: [] })),
      duplicates,
      alsoIn: {},
    };
  }

  // Parents are processed before their branches; otherwise the input order stands.
  const byConversation = new Map(unique.filter((t) => t.conversationId).map((t) => [t.conversationId!, t]));
  const depth = (t: ChatTranscript): number => {
    let d = 0;
    let cur: ChatTranscript | undefined = t;
    for (let guard = 0; cur?.branchedFrom && guard < 50; guard++) {
      cur = byConversation.get(cur.branchedFrom.conversationId);
      if (cur) d++;
    }
    return d;
  };
  const ordered = unique
    .map((t, i) => ({ t, i, d: depth(t) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.t);

  const done = new Map<string, ImportedChat>();
  const keptHash = new Map<string, { shareId: string; title: string; turnId: string }>();
  const links: [string, string][] = []; // skipped turn key → turn key that holds it
  const processed: ChatTranscript[] = [];

  for (const t of ordered) {
    const skippedAt = new Map<number, SkippedTurn>();
    const notes: string[] = [];
    let lineage: string[] | undefined;
    const parent = t.branchedFrom ? byConversation.get(t.branchedFrom.conversationId) : undefined;

    // Rule 2.
    if (parent) {
      const parentTurns = new Map(parent.turns.map((p) => [p.id, p.hash]));
      for (const turn of t.turns) {
        if (parentTurns.get(turn.id) === turn.hash) {
          skippedAt.set(turn.index, { turn, rule: "branch", keptIn: { shareId: parent.shareId, title: parent.title } });
          links.push([key(t.shareId, turn.id), key(parent.shareId, turn.id)]);
        }
      }
      lineage = [...(done.get(parent.shareId)?.lineage ?? [parent.title]), t.title];
    } else if (t.branchedFrom) {
      notes.push(`branched from "${t.branchedFrom.title ?? "another chat"}", which isn't in this import`);
    }

    // Rule 3.
    for (const turn of t.turns) {
      if (skippedAt.has(turn.index) || turn.markdown.length < MIN_EXACT_CHARS) continue;
      const holder = keptHash.get(turn.hash);
      if (holder) {
        skippedAt.set(turn.index, { turn, rule: "exact", keptIn: { shareId: holder.shareId, title: holder.title } });
        links.push([key(t.shareId, turn.id), key(holder.shareId, holder.turnId)]);
      }
    }

    // Rule 4: the longest near-identical prefix against any earlier chat.
    let best: { other: ChatTranscript; length: number } | undefined;
    for (const other of processed) {
      if (other === parent) continue;
      const length = nearPrefix(t.turns, other.turns);
      const substance = t.turns.slice(0, length).reduce((n, turn) => n + turn.markdown.length, 0);
      if (length >= MIN_NEAR_PREFIX && substance >= 2 * MIN_EXACT_CHARS && (!best || length > best.length)) best = { other, length };
    }
    if (best) {
      for (const turn of t.turns.slice(0, best.length)) {
        if (skippedAt.has(turn.index)) continue;
        const match = best.other.turns[turn.index]!;
        skippedAt.set(turn.index, { turn, rule: "near", keptIn: { shareId: best.other.shareId, title: best.other.title } });
        links.push([key(t.shareId, turn.id), key(best.other.shareId, match.id)]);
      }
      const a = best.other.turns[best.length]?.at;
      const b = t.turns[best.length]?.at;
      if (!lineage && a !== undefined && b !== undefined && b > a) lineage = [best.other.title, t.title];
    }

    const skipped = [...skippedAt.values()].sort((x, y) => x.turn.index - y.turn.index);
    for (const [title, count] of tally(skipped).reverse()) {
      notes.unshift(`${count} of ${t.turns.length} turns already in "${title}" — skipped`);
    }
    const kept = t.turns.filter((turn) => !skippedAt.has(turn.index));
    done.set(t.shareId, { transcript: t, kept, skipped, ...(lineage ? { lineage } : {}), notes });
    for (const turn of kept) keptHash.set(turn.hash, { shareId: t.shareId, title: t.title, turnId: turn.id });
    processed.push(t);
  }

  // A skipped turn may point at a turn that was itself skipped (a grandparent's); follow to the one that is kept.
  const holderOf = new Map(links);
  const keptKeys = new Set([...done.values()].flatMap((c) => c.kept.map((turn) => key(c.transcript.shareId, turn.id))));
  const alsoIn: Record<string, string[]> = {};
  for (const [from, first] of links) {
    let to = first;
    for (let guard = 0; !keptKeys.has(to) && holderOf.has(to) && guard < 20; guard++) to = holderOf.get(to)!;
    if (!keptKeys.has(to)) continue;
    const shareId = from.slice(0, from.indexOf(":"));
    const list = (alsoIn[to] ??= []);
    if (!list.includes(shareId)) list.push(shareId);
  }

  // The caller's order, not the processing order.
  return { chats: unique.map((t) => done.get(t.shareId)!), duplicates, alsoIn };
}

function tally(skipped: readonly SkippedTurn[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.keptIn.title, (counts.get(s.keptIn.title) ?? 0) + 1);
  return [...counts];
}

/** How many leading turns two chats share: same user turns, near-identical assistant turns. */
function nearPrefix(a: readonly ChatTurn[], b: readonly ChatTurn[]): number {
  let n = 0;
  while (n < a.length && n < b.length && sameTurn(a[n]!, b[n]!)) n++;
  return n;
}

function sameTurn(x: ChatTurn, y: ChatTurn): boolean {
  if (x.role !== y.role) return false;
  if (x.hash === y.hash) return true;
  if (x.role === "user") return false;
  return (
    significant(x.markdown).length >= 5 &&
    coverageOf(x.markdown, new Set(significant(y.markdown))) >= NEAR_THRESHOLD &&
    coverageOf(y.markdown, new Set(significant(x.markdown))) >= NEAR_THRESHOLD
  );
}
