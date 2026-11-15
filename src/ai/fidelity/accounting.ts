/**
 * Unit accounting (`.ai/docs/knowledge-notes-plan.md` §3.2, WP1.6): every source unit ends a run cited, omitted for
 * an allowed reason, restored, in review, or pending, and the reader sees one of three outcomes: Represented,
 * Intentionally omitted, Needs review. Deterministic and pure; replaces `coverageOf` / `COVERAGE_THRESHOLD` as the
 * coverage measure (those stay for the other rules and diagnostics).
 *
 * The omission rules, in the order they apply to a unit nobody cites:
 * 1. A unit of a failed or cut-off section is `pending` (never shown as complete), whatever else is said about it.
 * 2. A protected unit omitted is `restored` (§3.3): the app puts its protected content back. Two exceptions: a
 *    `duplicate` of a cited unit (its content is already on the canvas through that unit), and a `superseded` unit (a
 *    later statement revised it, G3.3: putting its value back would show the revised value as current).
 * 3. `duplicate` must name a unit that is itself cited; otherwise Needs review (`duplicate_of_uncited`).
 * 4. A critical unit omitted for any reason but `duplicate` (of a cited unit) or `superseded` is Needs review
 *    (`critical_omitted`), even if it is the only omission in the document.
 * 5. Any other allowed omission is `omitted`; a unit neither cited nor omitted is Needs review (`unaccounted`).
 *
 * A cited unit is Needs review when every card citing it carries a flag about it (or a flag names the unit with no
 * card). A cited unit with only some citing cards flagged stays `cited`: the flagged card shows as Needs review
 * through its flags (contract: "decided by the flags, not the state").
 *
 * A section with a high omitted share (OD4, `FIDELITY_CUES.highOmittedShare`) gets a note; it is a secondary signal
 * and never the only one.
 *
 * In a transcript, criticality is also read from the turns (`dialogueReasonsOf`): a question nobody answered is an
 * `open_question`, a short assent right after a proposal (and the proposal) a `decision`, so neither can be left out as
 * filler. A cited unit whose dropped clause the app put back as a "Limit:" line (`input.restored`) is `restored`.
 */
import type { AccountUnits, CriticalReason, CriticalReasonsOf, Omission, ReviewFlag, SourceUnit, UnitId, UnitState } from "./contracts";
import { OMISSION_REASONS, OUTCOME_OF_STATE } from "./contracts";
import { FIDELITY_CUES, findCues, hasCue, withoutFiller, type FidelityCues } from "@/config/fidelityCues";
import { plainText } from "./exactness";

/** Why a unit is critical (§3.2): cue words, protected content, the takeaway's source sentence. Empty when it isn't. */
export const criticalReasonsOf: CriticalReasonsOf = (unit, context) => {
  // A greeting, sign-off or meta line ("let me know if…", "hope this helps") is not critical for its "if" or "when".
  const text = withoutFiller(plainText(unit.text));
  const reasons: CriticalReason[] = [];
  const { limitation, requirement, condition, decision } = FIDELITY_CUES.critical;
  if (hasCue(text, limitation)) reasons.push("limitation");
  if (hasCue(text, requirement)) reasons.push("requirement");
  if (hasCue(text, condition)) reasons.push("condition");
  if (hasCue(text, decision)) reasons.push("decision");
  // A transcript's turns (`dialogueReasonsOf`): an unanswered question, an assent to a proposal and that proposal.
  for (const r of context.dialogue?.get(unit.id) ?? []) if (!reasons.includes(r)) reasons.push(r);
  if (context.takeawayCites?.includes(unit.id)) reasons.push("takeaway");
  if (context.protectedUnits?.has(unit.id)) reasons.push("protected");
  return reasons;
};

/** How a critical reason reads in a flag's detail ("omitted as filler, but it carries a decision"). */
export const CRITICAL_REASON_TEXT: Readonly<Record<CriticalReason, string>> = {
  limitation: "a limitation",
  requirement: "a requirement",
  condition: "a condition",
  decision: "a decision",
  open_question: "an open question nobody answered",
  takeaway: "a takeaway",
  protected: "a protected",
};

// ---------------------------------------------------------------- transcripts: turn-level signals (kn-05, 2026-10-20)

/** "Kenji: …", "Tomás Ruiz: …": a speaker label at a unit's start (one or two capitalised words and a colon). */
const LABEL = /^\s*([\p{Lu}][\p{L}'’.-]*(?:\s[\p{Lu}][\p{L}'’.-]*)?):\s+/u;

const wordsIn = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Whether `text` starts with one of the cues (leading punctuation and spaces aside). */
const startsWithCue = (text: string, cues: readonly string[]) => findCues(text, cues).some((m) => !/[\p{L}\p{N}]/u.test(text.slice(0, m.start)));

/** A unit that asks: it ends with "?" (closing quotes or brackets aside). */
const asks = (text: string) => /\?["'”’)\]]*\s*$/.test(text);

/**
 * Turn-level critical reasons in a transcript (§3.2; the golden case kn-05 of 2026-10-20 omitted "Dana: Should support be
 * allowed to post it directly?", "Kenji: I'd like that, yes." and "Marcus: Same." as filler, and no cue word reaches
 * them). Not cue words alone: what makes these units matter is where they sit among the turns.
 *
 * - **A transcript** has at least two speakers, each the label ("Name: …") of at least two units
 *   (`FIDELITY_CUES.dialogue.notSpeakers`, such as "Agreed:" or "Attendees:", are never speakers). Otherwise: no reasons.
 * - **A turn** starts at a unit with a speaker's label and goes on over the units after it with no label, in the same
 *   section, up to a paragraph break that starts no labelled turn (a gap of two characters or more between spans).
 * - **Open question** (`open_question`): a turn's last question (a unit ending with "?") when the next turn by another
 *   speaker in the section starts with a non-answer ("I don't know", "not sure"), or when no other speaker speaks after
 *   it. A question answered in the next turn ("Why did the alert take 22 minutes?") is not critical: it may be omitted.
 * - **Decision** (`decision`): a turn whose first sentence is a short assent (`assent` cues at its start, at most
 *   `maxAssentWords` words: "Same.", "I'd like that, yes.", "No objection from me.") right after a turn by another speaker
 *   whose **last** unit proposes (`proposal` cues: "Should support be allowed …?", "So the proposal is …"). The assent and
 *   the proposal are both decisions; further assent turns after it ("Tomás: I'm fine with that." "Marcus: Same.") are too.
 *   A proposal mid-turn ("Right, let's start." before more talk) is not one: an assent answers the end of a turn.
 */
export function dialogueReasonsOf(units: readonly SourceUnit[], cues: FidelityCues["dialogue"] = FIDELITY_CUES.dialogue): Map<UnitId, CriticalReason[]> {
  const out = new Map<UnitId, CriticalReason[]>();
  const texts = units.map((u) => plainText(u.text));
  const notSpeakers = new Set(cues.notSpeakers.map((s) => s.toLowerCase()));
  const labels = texts.map((t) => {
    const name = LABEL.exec(t)?.[1];
    return name && !notSpeakers.has(name.toLowerCase()) ? name : undefined;
  });
  const counts = new Map<string, number>();
  for (const l of labels) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  const speakers = new Set([...counts].filter(([, n]) => n >= 2).map(([name]) => name));
  if (speakers.size < 2) return out;

  const body = (i: number) => texts[i]!.replace(LABEL, "").trim();
  const turns: { speaker?: string; topic: string; at: number[] }[] = [];
  units.forEach((u, i) => {
    const speaker = labels[i] && speakers.has(labels[i]!) ? labels[i] : undefined;
    const prev = units[i - 1];
    const turn = turns.at(-1);
    const continues = !speaker && turn && prev && prev.topic === u.topic && u.span.start - prev.span.end < 2;
    if (continues) turn.at.push(i);
    else turns.push({ ...(speaker ? { speaker } : {}), topic: u.topic, at: [i] });
  });
  const add = (i: number, reason: CriticalReason) => {
    const id = units[i]!.id;
    const list = out.get(id) ?? [];
    if (!list.includes(reason)) out.set(id, [...list, reason]);
  };
  let proposal: { at: number; speaker: string } | undefined;
  turns.forEach((turn, t) => {
    if (!turn.speaker) {
      proposal = undefined;
      return;
    }
    const first = body(turn.at[0]!);
    const assent = wordsIn(first) <= cues.maxAssentWords && startsWithCue(first, cues.assent);
    if (assent && proposal && proposal.speaker !== turn.speaker) {
      add(turn.at[0]!, "decision");
      add(proposal.at, "decision");
    } else {
      const last = turn.at.at(-1)!;
      proposal = hasCue(body(last), cues.proposal) ? { at: last, speaker: turn.speaker } : undefined;
    }
    const question = [...turn.at].reverse().find((i) => asks(texts[i]!));
    if (question === undefined) return;
    const reply = turns.slice(t + 1).find((n) => n.topic === turn.topic && n.speaker && n.speaker !== turn.speaker);
    // No other speaker after it in the section, or a non-answer: nobody answered it.
    if (!reply || startsWithCue(body(reply.at[0]!), cues.nonAnswer)) add(question, "open_question");
  });
  return out;
}

function short(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

const ALLOWED = new Set<string>(OMISSION_REASONS);

/** Review codes that say a card does not represent the unit it cites (with both `card` and `unit` set). */
export const NOT_REPRESENTING: ReadonlySet<ReviewFlag["code"]> = new Set(["citation_unrelated", "critical_dropped"]);

export const accountUnits: AccountUnits = (input) => {
  const { units, ideas, omitted } = input;
  const known = new Set(units.map((u) => u.id));
  // A transcript's questions nobody answered and assent to a proposal are critical by where they sit (`dialogueReasonsOf`).
  const dialogue = dialogueReasonsOf(units);
  // Units whose dropped clause the app put back as a "Limit:" line (`restoreLimits`): `restored` where they'd be `cited`.
  const restoredLimits = new Set(input.restored ?? []);
  const pending = new Set(input.pending ?? []);
  const inputFlagsAll = input.flags ?? [];
  // A card whose citation of a unit is unrelated, or that drops the unit's condition, caveat or requirement, doesn't
  // represent that unit (`representation.ts`): it still cites it (the chip opens the passage), but it isn't counted.
  const notRepresenting = new Set(inputFlagsAll.flatMap((f) => (NOT_REPRESENTING.has(f.code) && f.card && f.unit ? [`${f.card}\u0000${f.unit}`] : [])));
  const citedBy = new Map<UnitId, string[]>();
  const citedAtAll = new Set<UnitId>();
  for (const idea of ideas)
    for (const u of new Set(idea.cites)) {
      if (!known.has(u)) continue;
      citedAtAll.add(u);
      if (!notRepresenting.has(`${idea.id}\u0000${u}`)) citedBy.set(u, [...(citedBy.get(u) ?? []), idea.id]);
    }
  // The first omission the model gave for a unit wins; a cited unit's omission is ignored (citing it says it's on the canvas).
  const omissionOf = new Map<UnitId, Omission>();
  for (const o of omitted) if (known.has(o.unit) && !omissionOf.has(o.unit)) omissionOf.set(o.unit, o);

  const inputFlags = inputFlagsAll;
  const state: Record<UnitId, UnitState> = {};
  const critical: Record<UnitId, CriticalReason[]> = {};
  const flags: ReviewFlag[] = [];

  for (const unit of units) {
    const reasons = criticalReasonsOf(unit, { protectedUnits: input.protectedUnits, takeawayCites: input.takeawayCites, dialogue });
    if (reasons.length) critical[unit.id] = reasons;
    const quote = short(unit.text);

    if (pending.has(unit.id)) {
      state[unit.id] = "pending";
      flags.push({ code: "pending", unit: unit.id, detail: `not processed: "${quote}"` });
      continue;
    }

    const cards = citedBy.get(unit.id);
    if (cards?.length) {
      const about = inputFlags.filter((f) => f.unit === unit.id || (f.unit === undefined && f.card !== undefined && cards.includes(f.card)));
      const unitWide = about.some((f) => f.card === undefined);
      const allCardsFlagged = cards.every((c) => about.some((f) => f.card === c));
      state[unit.id] = unitWide || allCardsFlagged ? "review" : restoredLimits.has(unit.id) ? "restored" : "cited";
      continue;
    }
    // Cited only by cards that don't represent it: Needs review, for the reasons those flags give (no second flag).
    if (citedAtAll.has(unit.id)) {
      state[unit.id] = "review";
      continue;
    }

    const omission = omissionOf.get(unit.id);
    if (!omission) {
      state[unit.id] = "review";
      flags.push({ code: "unaccounted", unit: unit.id, detail: `neither on a card nor omitted: "${quote}"` });
      continue;
    }
    if (!ALLOWED.has(omission.reason)) {
      state[unit.id] = "review";
      flags.push({ code: "unaccounted", unit: unit.id, detail: `omitted for a reason that isn't allowed ("${String(omission.reason)}"): "${quote}"` });
      continue;
    }
    const validDuplicate = omission.reason === "duplicate" && omission.of !== undefined && omission.of !== unit.id && (citedBy.get(omission.of)?.length ?? 0) > 0;
    if (input.protectedUnits?.has(unit.id) && !validDuplicate && omission.reason !== "superseded") {
      state[unit.id] = "restored";
      continue;
    }
    if (omission.reason === "duplicate" && !validDuplicate) {
      state[unit.id] = "review";
      flags.push({
        code: "duplicate_of_uncited",
        unit: unit.id,
        detail: omission.of ? `omitted as a repeat of a passage no card cites: "${quote}"` : `omitted as a repeat without naming what it repeats: "${quote}"`,
      });
      continue;
    }
    const exempt = validDuplicate || omission.reason === "superseded";
    if (reasons.length && !exempt) {
      state[unit.id] = "review";
      flags.push({ code: "critical_omitted", unit: unit.id, detail: `omitted as ${omission.reason}, but it carries ${CRITICAL_REASON_TEXT[reasons[0]!]}: "${quote}"`, evidence: { source: unit.text } });
      continue;
    }
    state[unit.id] = "omitted";
  }

  // Every input flag is a Needs review reason too (a flagged card is Needs review even when its unit stays cited).
  for (const f of inputFlags) if (!flags.includes(f)) flags.push(f);

  const outcome = Object.fromEntries(Object.entries(state).map(([u, s]) => [u, OUTCOME_OF_STATE[s]]));

  const sections: { topic: string; represented: number; omitted: number; needsReview: number; highOmittedShare: boolean }[] = [];
  const byTopic = new Map<string, (typeof sections)[number]>();
  for (const unit of units) {
    let row = byTopic.get(unit.topic);
    if (!row) {
      row = { topic: unit.topic, represented: 0, omitted: 0, needsReview: 0, highOmittedShare: false };
      byTopic.set(unit.topic, row);
      sections.push(row);
    }
    const o = outcome[unit.id];
    if (o === "represented") row.represented++;
    else if (o === "omitted") row.omitted++;
    else row.needsReview++;
  }
  for (const row of sections) {
    const total = row.represented + row.omitted + row.needsReview;
    row.highOmittedShare = total > 0 && row.omitted / total >= FIDELITY_CUES.highOmittedShare;
  }

  return { state, outcome, critical, flags, sections };
};
