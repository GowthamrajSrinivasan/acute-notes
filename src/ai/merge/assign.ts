/**
 * Topic assignment (topic merge plan G2, `.ai/docs/chat-share-import-plan.md`): which existing topic of the notes
 * each part of new content belongs to, or none (a new topic).
 *
 * - `assign_to_topics` asks a model: grouping, not authoring, so a decision model answers it when configured.
 * - `assignLocally` is the deterministic answer, used when there is no AI (a local-tier source, no connection, a
 *   failed call) and for every part the model's reply leaves out: the same heading, else most of the part's
 *   significant words in one topic.
 *
 * A topic is an analysis unit of the notes' current text (`units.ts`); a part is an analysis unit of the new content.
 */
import { z } from "zod";
import type { DecisionAnswer, DecisionRequest, DecisionTask } from "@/ai/decisions/types";
import { keyTerms, significant } from "@/ai/fidelity/information";
import type { AnalysisUnit } from "@/ai/reconcile/units";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import { labelOfUnit } from "@/ai/visual-plan/groups";
import { withoutChoices } from "@/ai/history/choices";
import { statementsOf, type Statement } from "./statements";
import { shortlistFor, type Shortlist } from "./topicIndex";

/** An existing topic: its unit key in the notes' text, its label, and its text. */
export interface Topic {
  key: string;
  label: string;
  text: string;
}

/** Part key → topic key, or null for a new topic. */
export type Assignment = Map<string, string | null>;

const LEAD_UNIT = "(lead)";
/** A part shares at least this share of its significant words with a topic to belong to it (local answer). */
const SAME_TOPIC = 0.6;
const MIN_WORDS = 3;
/**
 * What of each topic the prompt shows: all of it when the notes are small (the model judges "nothing new" against it),
 * a share of the budget when there are many topics, never less than enough to recognise one.
 */
const TOPICS_BUDGET = 16_000;
const TOPIC_EXCERPT_MIN = 400;
const TOPIC_EXCERPT_MAX = 3_000;
/**
 * What of each new part the model is shown: all of it, within a budget the chat prompt's parts share (a typed request holds one part,
 * so it gets the most). A part cut shorter than its text is never judged "nothing new" — its unseen rest may be new — and a
 * contradiction in that rest can't be found: measured live (2026-10-09), a contradiction at the end of a 1,900-character part was cut
 * from an 800-character excerpt and filed as a fact.
 */
const PARTS_BUDGET = 24_000;
const PART_EXCERPT_MIN = 800;
const PART_EXCERPT_MAX = 12_000;
/** How much of each part the chat prompt shows, for `parts` parts. */
export const partExcerptLength = (parts: number): number => Math.min(PART_EXCERPT_MAX, Math.max(PART_EXCERPT_MIN, Math.floor(PARTS_BUDGET / Math.max(1, parts))));

export const topicLabel = (key: string): string => (key === LEAD_UNIT ? "Overview" : labelOfUnit(key));

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The deterministic assignment: the topic with the same heading, else the one holding most of the part's words. */
export function assignLocally(topics: readonly Topic[], parts: readonly AnalysisUnit[]): Assignment {
  const out: Assignment = new Map();
  const vocab = topics.map((t) => new Set(significant(t.text)));
  for (const part of parts) {
    const label = norm(topicLabel(part.key));
    const sameHeading = part.key !== LEAD_UNIT ? topics.find((t) => t.key !== LEAD_UNIT && norm(t.label) === label) : undefined;
    if (sameHeading) {
      out.set(part.key, sameHeading.key);
      continue;
    }
    const words = [...new Set(significant(part.text))];
    let best: { key: string; score: number } | null = null;
    if (words.length >= MIN_WORDS) {
      topics.forEach((t, i) => {
        const score = words.filter((w) => vocab[i]!.has(w)).length / words.length;
        if (score >= SAME_TOPIC && (!best || score > best.score)) best = { key: t.key, score };
      });
    }
    out.set(part.key, (best as { key: string } | null)?.key ?? null);
  }
  return out;
}

export const assignInput = z.object({
  topics: z.array(z.object({ key: z.string().min(1), label: z.string(), text: z.string() })).min(1),
  /** `context`: the headings a part sits under in its own document ("Phase 1 › Pricing"), so a short fragment ("Free") is read in context. */
  parts: z.array(z.object({ key: z.string().min(1), text: z.string().min(1), context: z.string().optional() })).min(1),
  /**
   * Typed requests show each part only a shortlist of the topics (`topicIndex.ts`), and ask again with the full list whenever the answer isn't a
   * confident existing topic. Off by default: the saved evidence doesn't support turning it on yet (`.ai/docs/topic-shortlist-plan.md`).
   */
  shortlist: z.boolean().optional(),
});
export type AssignInput = z.infer<typeof assignInput>;

/** Just enough to know the reply is assignment-shaped; `validateAssignment` reads it leniently. */
export const assignEnvelope = z.looseObject({ assignments: z.array(z.unknown()) });

const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const topicRef = (i: number) => `t${i + 1}`;
const partRef = (i: number) => `p${i + 1}`;

export const assignToTopicsTask: TaskDefinition<AssignInput, unknown> = {
  task: "assign_to_topics",
  inputSchema: assignInput,
  outputSchema: assignEnvelope,
  buildPrompt: ({ input, repairFeedback }) => {
    const per = Math.min(TOPIC_EXCERPT_MAX, Math.max(TOPIC_EXCERPT_MIN, Math.floor(TOPICS_BUDGET / input.topics.length)));
    const topics = input.topics.map((t, i) => `[${topicRef(i)}] ${t.label}\n${excerpt(t.text, per)}`).join("\n\n");
    const shown = partExcerptLength(input.parts.length);
    const parts = input.parts.map((p, i) => `[${partRef(i)}]${p.context ? ` (under “${p.context}”)` : ""}\n${excerpt(p.text, shown)}`).join("\n\n");
    const prompt =
      `A user's notes are organised by topic. New content arrives in parts. For each part, decide which existing topic it belongs to.\n\n` +
      `- A part belongs to a topic when it is about the same subject: it adds to it, details it, repeats it or changes it — even under a different heading.\n` +
      `- Answer "new" only when the part is about a subject none of the topics covers.\n` +
      `- "(under …)" names the headings a part sits under in its own document: read a short part in that context.\n` +
      `- Answer "unsure" when a part is too short or unclear to tell (a bare label such as "Free" or "Apps"): it is kept with the section around it. Never answer "new" just because you can't tell.\n` +
      `- Every part gets exactly one answer. Never invent topics or parts.\n` +
      `- Add "nothingNew": true only when a part filed under a topic says nothing that topic doesn't already say, in any words: no fact, number, name, decision, example or detail it lacks. If the part adds anything at all, or you are unsure, leave it out.\n` +
      `- Add "conflicts" when a part filed under a topic contradicts it: the two say different, incompatible things about the same matter (a different choice, decision, number, name or fact), so both can't be true. For each, quote the topic's sentence and the part's sentence exactly as written, and name the matter in a few words. Never list things that can both be true, or a part that only adds detail.\n\n` +
      `Reply with JSON only, exactly this shape:\n{"assignments":[{"part":"p1","topic":"t2"},{"part":"p2","topic":"t1","nothingNew":true},{"part":"p3","topic":"t3","conflicts":[{"about":"Database for v1","topicSays":"We use Firestore.","partSays":"We switched to Postgres."}]},{"part":"p4","topic":"new"},{"part":"p5","topic":"unsure"}]}\n\n` +
      `Existing topics:\n\n${topics}\n\nNew content parts:\n\n${parts}`;
    return {
      systemPrompt: "You are an information architect. You file new content under the topics of existing notes, by subject, and you never invent topics.",
      prompt: repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt,
    };
  },
  // Authoring-grade judgement, not routing: a small chat decision model dropped 46 % of the parts that added a fact, calling them
  // "nothing new" (spike, 2026-10-09), so this task goes to the typed decision model (below) or the primary, never the chat decision model.
  policy: {},
  timeoutMs: 120_000,
};

const NEW_TOPIC = "new";
/** The third outcome: not enough to decide safely (typical of a tiny fragment). A failed classification is not a new topic. */
export const UNSURE = "unsure";
/**
 * **Round one → round two.** A part this likely to contradict its topic (P of "contradicts" in round one's relation question) is asked round
 * two: which topic statement each of its statements contradicts. It only decides whether round two is asked, never what is filed: a
 * contradiction is only shown once round two confirms it. Jev scored every real contradiction 0.87-0.98 and every non-contradiction at
 * most 0.14 (2026-10-09), so 0.5 is a wide, safe cut — and a false alarm costs one extra round, not a wrong result.
 */
const CONFLICT_MIN_PROBABILITY = 0.5;
/** A typed answer below this confidence is "unsure" (kept with the section around it, `settleUnsure`), never a new topic. */
const ASSIGN_MIN_CONFIDENCE = 0.5;
/**
 * "Adds nothing new" drops a part from the merge. Measured on Jev (2026-10-09, 20 statements against 3 topics): restatements score
 * 0.63-0.86, while additions and contradictions of the notes score at most 0.07 — so 0.5 keeps every addition and conflict with a
 * wide margin, where the earlier 0.8 let restatements through as duplicates (0.63, 0.75 and 0.78 were missed).
 */
const NOTHING_NEW_MIN_PROBABILITY = 0.5;
/** One request per part; more parts than this, or more topics than a choice holds, go to the chat task. */
const ASSIGN_MAX_PARTS = 30;
const ASSIGN_MAX_TOPICS = 254;

/**
 * One part's typed request. `shown` is the shortlist to show (topic indices, keeping their `t{n}` ids), or null for every topic. Each topic is
 * shown exactly as a full-list request would show it (the excerpt length comes from the full topic count), so the model judges it the same way.
 */
function partRequest(input: AssignInput, i: number, shown: Shortlist | null): DecisionRequest {
  const p = input.parts[i]!;
  const per = Math.min(TOPIC_EXCERPT_MAX, Math.max(TOPIC_EXCERPT_MIN, Math.floor(TOPICS_BUDGET / input.topics.length)));
  const indices = shown?.indices ?? input.topics.map((_, n) => n);
  const topics = indices.map((n) => ({ id: topicRef(n), label: input.topics[n]!.label, text: excerpt(input.topics[n]!.text, per) }));
  const choices = [...indices.map((n) => ({ value: topicRef(n), description: input.topics[n]!.label })), { value: NEW_TOPIC, description: "a subject none of the topics covers" }];
  return {
    state: { topics, new_content: excerpt(p.text, PART_EXCERPT_MAX), ...(p.context ? { new_content_under: p.context } : {}) },
    questions: {
      [`${partRef(i)}_topic`]: {
        type: "choice",
        instructions:
          "A user's notes are organised by topic (state.topics). New content (state.new_content) arrives. Which existing topic does it belong to? It belongs to a topic when it is about the same subject: it adds to it, details it, repeats it or changes it, even under a different heading. " +
          "state.new_content_under, when given, names the headings it sits under in its own document: read a short fragment in that context. Answer new only when it is about a subject none of the topics covers.",
        choices,
      },
      [`${partRef(i)}_relation`]: {
        type: "choice",
        instructions:
          "How does state.new_content relate to the topic it belongs to? Choose contradicts only when it states something incompatible with what the topic says about the same thing (a different choice, number, date, requirement or yes/no); a detail added, or a repeat, is not a contradiction.",
        choices: [
          { value: "repeats", description: "says the same thing the topic already says, in other words, adding nothing" },
          { value: "adds", description: "adds a detail the topic doesn't have, without contradicting anything it says" },
          { value: "contradicts", description: "states something incompatible with what the topic says about the same thing" },
        ],
      },
      [`${partRef(i)}_nothing_new`]: {
        type: "boolean",
        instructions:
          "Does state.new_content say nothing that the topic it belongs to doesn't already say, in any words: no fact, number, name, decision, example or detail the topic lacks? Answer yes only if it adds nothing at all; if it adds anything, or you are unsure, answer no.",
        whenTrue: "It repeats the topic and adds nothing new.",
        whenFalse: "It adds at least one fact, number, name, decision, example or detail the topic lacks.",
      },
    },
  };
}

/** Each part's shortlist (null = the full list), computed once per input: `buildRequest` and `followUp` must agree on it. */
const shortlistCache = new WeakMap<AssignInput, (Shortlist | null)[]>();
function shortlists(input: AssignInput): (Shortlist | null)[] {
  let lists = shortlistCache.get(input);
  if (!lists) {
    lists = input.parts.map((_, i) => shortlistFor(input.topics, input.parts, i));
    shortlistCache.set(input, lists);
  }
  return lists;
}

/**
 * Parts answered from a shortlist whose answer is not a confident existing topic ("new", unsure, or no answer): a shortlist that may have left
 * out the right topic is never taken as a reason to call a part new or unsure, so these are asked again with the full list (round two).
 */
function widenedParts(answers: Record<string, DecisionAnswer>, input: AssignInput): number[] {
  if (!input.shortlist) return [];
  const lists = shortlists(input);
  return input.parts.flatMap((_, i) => {
    if (!lists[i]) return [];
    const topic = answers[`${partRef(i)}_topic`];
    return topic?.type === "choice" && topic.choice !== NEW_TOPIC && topic.confidence >= ASSIGN_MIN_CONFIDENCE ? [] : [i];
  });
}

/**
 * `assign_to_topics` as typed decisions (decision models, `ai/decisions`): per part, which topic it belongs to (or new), and whether it
 * adds nothing the topic doesn't already say. Answered by the user's typed decision model when they enabled one; the chat task above
 * answers otherwise, and whenever this can't (too many parts or topics) or no part is answered with confidence. The output is the chat
 * task's reply shape, so `validateAssignment` reads both the same way: a part left out keeps its local answer.
 */
export const assignToTopicsDecision: DecisionTask<AssignInput, unknown> = {
  fallbackTask: "assign_to_topics",
  timeoutMs: 30_000,
  buildRequest: (input) => {
    if (!input.topics.length || input.topics.length > ASSIGN_MAX_TOPICS || input.parts.length > ASSIGN_MAX_PARTS) return null;
    const lists = input.shortlist ? shortlists(input) : null;
    return input.parts.map((_, i) => partRequest(input, i, lists?.[i] ?? null));
  },
  /**
   * Round two, only for parts that likely contradict their topic: for **each statement of the part**, which statement of the topic it
   * contradicts, or none. One question per statement, so a part that changes two things (a price and a date) gives two pairs, and none is
   * hidden behind the other. Choices over numbered statements, so the quotes are exact by construction.
   */
  followUp: (answers: Record<string, DecisionAnswer>, input) => {
    // A part answered from a shortlist without a confident topic is asked again with the full list. Its contradiction check, if its new
    // answers call for one, has no round left here: `interpret` then hands the merge to the chat task, as it does for any missing pair.
    const widened = widenedParts(answers, input);
    const reasks = widened.map((i) => partRequest(input, i, null));
    const requests = contradictingParts(answers, input).filter(({ i }) => !widened.includes(i)).flatMap(({ i, topic }): DecisionRequest[] => {
      const lists = statementLists(input, i, topic);
      if (!lists) return [];
      const choices = [...lists.topic.map((s) => ({ value: s.id, description: excerpt(s.text, 300) })), { value: NO_STATEMENT, description: "it contradicts none of these" }];
      return [
        {
          state: { topic: input.topics[topic]!.label },
          questions: Object.fromEntries(
            lists.part.map((s) => [
              statementQuestion(s),
              {
                type: "choice",
                instructions: `This statement of the new content: “${excerpt(s.text, 300)}”. Which statement of the topic does it contradict — say something incompatible with about the same thing (a different choice, number, date, requirement or yes/no)? Choose none if it contradicts none of them: a statement that only adds detail, or repeats the topic, contradicts none.`,
                choices,
              },
            ]),
          ),
        },
      ];
    });
    const all = [...reasks, ...requests];
    return all.length ? all : null;
  },
  interpret: (answers: Record<string, DecisionAnswer>, input) => {
    // A part that likely contradicts its topic carries the two statements the model picked, as the chat reply would. Anything uncertain or
    // unusable (no confident pick, an id that is not in the lists, too many statements) leaves the whole merge to the chat task.
    // Every pair is found or none is trusted: an unsure pick, an id outside the list, two statements contradicting the same one, or a part
    // round one called contradicting with no pair here all hand the merge to the chat task, which lists every conflict. A partial set is
    // never taken as the whole.
    const conflicts = new Map<string, Conflict[]>();
    for (const { i, topic, by } of contradictingParts(answers, input)) {
      const lists = statementLists(input, i, topic);
      if (!lists) return null;
      const pairs: Conflict[] = [];
      for (const s of lists.part) {
        const pick = answers[statementQuestion(s)];
        if (pick?.type !== "choice" || pick.confidence < STATEMENT_MIN_CONFIDENCE) return null;
        if (pick.choice === NO_STATEMENT) continue;
        const topicSays = lists.topic.find((t) => t.id === pick.choice)?.text;
        if (!topicSays || pairs.some((c) => c.topicSays === topicSays)) return null;
        pairs.push({ about: `${input.topics[topic]!.label}: ${excerpt(topicSays, 70)}`.slice(0, 80), topicSays, partSays: s.text });
      }
      if (!pairs.length) {
        // The model found none: for a part only a detail made suspect that is no conflict; for one the model called contradicting it is unusable.
        if (by === "model") return null;
        continue;
      }
      conflicts.set(partRef(i), pairs);
    }
    const assignments = input.parts.flatMap((_, i) => {
      const topic = answers[`${partRef(i)}_topic`];
      if (topic?.type !== "choice") return [];
      // Unsure is its own outcome, never "new": the merge keeps such a part with the section around it (`settleUnsure`).
      if (topic.confidence < ASSIGN_MIN_CONFIDENCE) return [{ part: partRef(i), topic: UNSURE }];
      const conflict = conflicts.get(partRef(i));
      const nothing = answers[`${partRef(i)}_nothing_new`];
      const whole = input.parts[i]!.text.length <= PART_EXCERPT_MAX;
      const nothingNew = whole && !conflict && topic.choice !== NEW_TOPIC && nothing?.type === "boolean" && nothing.probability >= NOTHING_NEW_MIN_PROBABILITY;
      return [{ part: partRef(i), topic: topic.choice, ...(nothingNew ? { nothingNew: true } : {}), ...(conflict ? { conflicts: conflict } : {}) }];
    });
    return assignments.length ? { assignments } : null;
  },
};

const NO_STATEMENT = "none";
/** A statement pick below this confidence is not used (the chat task answers instead). */
/**
 * **Round two's picks.** Each statement's pick (a topic statement, or none) must be at least this confident, or the whole merge goes to
 * the chat task. Separate from `CONFLICT_MIN_PROBABILITY`: that one gates whether to ask; this one whether to trust the answers, so it is
 * stricter — a wrong pick would put a wrong pair of options in front of the user.
 */
const STATEMENT_MIN_CONFIDENCE = 0.6;
/** Round two asks one question per statement of a part: a part with more goes to the chat task. */
const MAX_PART_STATEMENTS = 40;

/** The question id round two asks about a part statement (`p1.s0` → `p1_s0_contradicts`). */
const statementQuestion = (s: Statement) => `${s.id.replace(".", "_")}_contradicts`;
/** A choice holds at most 255 options: a topic or part with more statements than this goes to the chat task. */
const MAX_STATEMENTS = 120;

/**
 * A statement of the part and one of the topic about the same thing (most of their significant words shared) that differ in a number, version
 * or identifier: "costs 12 dollars" against "costs 15 dollars". The relation question sees only an excerpt of each topic (a statement deep in a
 * long topic is not in it), so a likely change of a detail is asked about in round two whatever it answered; the model still decides each pair.
 */
function changedDetail(part: readonly Statement[], topic: readonly Statement[]): boolean {
  const words = (text: string) => new Set(significant(text).filter((w) => !/\d/.test(w)));
  const details = (text: string) => keyTerms(text).map((t) => t.toLowerCase());
  return part.some((p) => {
    const pd = details(p.text);
    const pw = words(p.text);
    if (!pd.length || pw.size < CHANGED_DETAIL_MIN_WORDS) return false;
    // The topic's statements about the same thing; the part says the same if any of them carries all its details (a repeat), else it changes one.
    const alike = topic.filter((t) => {
      const tw = words(t.text);
      return [...pw].filter((w) => tw.has(w)).length / Math.min(pw.size, tw.size) >= CHANGED_DETAIL_SHARED;
    });
    if (alike.some((t) => pd.every((d) => details(t.text).includes(d)))) return false;
    return alike.some((t) => details(t.text).length > 0);
  });
}
const CHANGED_DETAIL_MIN_WORDS = 3;
const CHANGED_DETAIL_SHARED = 0.7;

/**
 * Parts filed under a topic that likely contradict it (`i`: the part, `topic`: the topic's index): the typed model says so (`by: "model"`), or a
 * statement of the part changes a detail of one of the topic's (`by: "detail"`, only for a confident topic). A part found only by detail that the
 * model then finds no contradiction in is simply not in conflict: it never hands the merge to the chat task, as a model-found one does.
 */
function contradictingParts(answers: Record<string, DecisionAnswer>, input: AssignInput): { i: number; topic: number; by: "model" | "detail" }[] {
  return input.parts.flatMap((_, i): { i: number; topic: number; by: "model" | "detail" }[] => {
    const topic = answers[`${partRef(i)}_topic`];
    const relation = answers[`${partRef(i)}_relation`];
    if (topic?.type !== "choice" || topic.choice === NEW_TOPIC) return [];
    const index = Number(topic.choice.slice(1)) - 1;
    if (!input.topics[index]) return [];
    if (relation?.type === "choice" && (relation.probabilities.contradicts ?? 0) >= CONFLICT_MIN_PROBABILITY) return [{ i, topic: index, by: "model" }];
    if (topic.confidence < ASSIGN_MIN_CONFIDENCE) return [];
    const lists = statementLists(input, i, index);
    return lists && changedDetail(lists.part, lists.topic) ? [{ i, topic: index, by: "detail" }] : [];
  });
}

/** The numbered statements of a topic (as it is now, choice callouts aside) and of a part; null when either is empty or too long to choose from. */
function statementLists(input: AssignInput, part: number, topic: number): { topic: Statement[]; part: Statement[] } | null {
  const t = statementsOf(withoutChoices(input.topics[topic]!.text), topicRef(topic));
  const p = statementsOf(input.parts[part]!.text, partRef(part));
  return t.length && p.length && t.length <= MAX_STATEMENTS && p.length <= MAX_PART_STATEMENTS ? { topic: t, part: p } : null;
}

/** A part saying something its topic contradicts: both sentences exactly as their texts have them. */
export interface Conflict {
  about: string;
  topicSays: string;
  partSays: string;
}

/**
 * The model's assignment, read leniently: unknown parts and topics are ignored, and a part the reply leaves out (or
 * assigns twice) keeps its `fallback` answer.
 *
 * - `nothingNew`: parts the model filed under a topic and judged to add nothing to it (only ever with a topic — a new
 *   topic is new by definition — and never a part with a conflict, which says something the topic doesn't).
 * - `unsure`: parts the model said it can't place (a failed classification is not a new topic); they keep their `fallback` answer here.
 * - `conflicts`: per part, what it says that its topic contradicts. Each quote must be in its text word for word
 *   (spacing and a final full stop aside; the topic's outside any choice callout) — the exact text found is kept, so
 *   choosing an option later replaces it precisely. A misquote is dropped.
 */
export function validateAssignment(
  raw: unknown,
  input: AssignInput,
  fallback: Assignment,
): { assignment: Assignment; fromModel: number; nothingNew: Set<string>; conflicts: Map<string, Conflict[]>; unsure: Set<string>; answered: Set<string> } {
  const out: Assignment = new Map(fallback);
  const byPart = new Map(input.parts.map((p, i) => [partRef(i), p] as const));
  const byTopic = new Map(input.topics.map((t, i) => [topicRef(i), t] as const));
  const seen = new Set<string>();
  const nothingNew = new Set<string>();
  const unsure = new Set<string>();
  const conflicts = new Map<string, Conflict[]>();
  let fromModel = 0;
  const rows = typeof raw === "object" && raw !== null && Array.isArray((raw as { assignments?: unknown }).assignments) ? (raw as { assignments: unknown[] }).assignments : [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { part, topic, nothingNew: same, conflicts: claimed } = row as { part?: unknown; topic?: unknown; nothingNew?: unknown; conflicts?: unknown };
    const p = typeof part === "string" ? byPart.get(part) : undefined;
    if (!p || seen.has(p.key)) continue;
    if (topic === UNSURE) {
      seen.add(p.key);
      unsure.add(p.key);
      continue;
    }
    const t = topic === "new" ? null : typeof topic === "string" ? byTopic.get(topic) : undefined;
    if (t === undefined) continue;
    seen.add(p.key);
    out.set(p.key, t?.key ?? null);
    fromModel++;
    if (!t) continue;
    const found = (Array.isArray(claimed) ? claimed : []).flatMap((c): Conflict[] => {
      if (typeof c !== "object" || c === null) return [];
      const { about, topicSays, partSays } = c as { about?: unknown; topicSays?: unknown; partSays?: unknown };
      if (typeof topicSays !== "string" || typeof partSays !== "string") return [];
      const inTopic = verbatim(withoutChoices(t.text), topicSays);
      const inPart = verbatim(p.text, partSays);
      if (!inTopic || !inPart || inTopic === inPart) return [];
      return [{ about: typeof about === "string" && about.trim() ? about.trim().slice(0, 80) : "Which is current", topicSays: inTopic, partSays: inPart }];
    });
    if (found.length) conflicts.set(p.key, found);
    // Only for a part shown whole: a part cut short may say something new in the part the model didn't see.
    else if (same === true && p.text.length <= partExcerptLength(input.parts.length)) nothingNew.add(p.key);
  }
  return { assignment: out, fromModel, nothingNew, conflicts, unsure, answered: new Set([...seen].filter((k) => !unsure.has(k))) };
}

/** `quote` as `text` has it — the same words in order, spacing and a final full stop aside — or null. */
export function verbatim(text: string, quote: string): string | null {
  const words = quote.trim().replace(/[.!?]+$/, "").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") + "[.!?]?");
  return pattern.exec(text)?.[0] ?? null;
}

export function registerMergeTasks(registry: TaskRegistry): void {
  if (!registry.has(assignToTopicsTask.task)) registry.register(assignToTopicsTask as TaskDefinition<never, unknown>);
}

registerMergeTasks(getTaskRegistry());
