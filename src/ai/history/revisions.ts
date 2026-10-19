/**
 * A document that revises itself (topic merge plan G3.3, `.ai/docs/chat-share-import-plan.md` §5.3): within one text the order is
 * known, so where a later statement replaces an earlier one about the same thing ("…Firestore." … "Actually, we switched to
 * Postgres."), **the later one wins** — no choice to make. The earlier statement is left out of what the model draws from (and of the
 * safety net's coverage), and kept on the section's "Changed over time" page (`choiceNodes.ts`). The user's text is never edited:
 * the revisions found are stored beside the version (`ContentSourceVersion.revisions`).
 *
 * - **Gate (code, free):** only a section with a revision cue ("actually", "instead", "no longer", "update:", …) and at least two
 *   statements is asked about; most documents cost nothing.
 * - **Typed decision model (Jev), when configured:** per section, "does it change its mind?"; then, for a section that does, per
 *   statement, "which earlier statement does this replace, or none?" — a pick from the section's own statements, exact by
 *   construction. Anything unsure gives the question to the chat task.
 * - **Chat task (`find_revisions`) otherwise:** it quotes both statements; each quote must be in the section word for word, the
 *   replaced one first, or the pair is dropped.
 *
 * An unsure or failed answer means **no revision**: nothing is hidden on a guess.
 */
import { z } from "zod";
import type { DecisionAnswer, DecisionRequest, DecisionTask } from "@/ai/decisions/types";
import { AIError } from "@/ai/errors";
import { verbatim } from "@/ai/merge/assign";
import { statementsOf, type Statement } from "@/ai/merge/statements";
import type { AIRuntime } from "@/ai/runtime";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";

/** In section `unit`, `later` replaces `earlier` — both exactly as the text has them. */
export interface Revision {
  unit: string;
  earlier: string;
  later: string;
}

/**
 * Phrases that say a text changes its mind; a section without one is never asked about. Phrases, not bare words: "I've updated the
 * plan" or "the tracker changed" is ordinary prose, and each false alarm costs a model call (a chat call without a typed model).
 */
const CUE =
  /\b(?:actually|instead|no longer|not anymore|anymore|switch(?:ed|ing)? (?:to|over)|chang(?:ed|ing) (?:it |this |that )?to|changed (?:our|my) mind|change of plans?|correction|scratch that|on second thought|rather than|moved (?:it |this |that )?to|replac(?:e|ed|ing) (?:it|that|this|them) with|now (?:ships|costs|uses|is|are|will|has|have|lands|starts))\b|\b(?:update[ds]?|revised|correction|edit)\s*:|\bnot \d/i;
const MIN_STATEMENTS = 2;
/** One question per statement in round two: a section with more goes to the chat task. */
const MAX_STATEMENTS = 60;
/** Round one: a section this likely to revise itself is asked round two (a false alarm costs one round, never a result). */
const REVISES_MIN_PROBABILITY = 0.5;
/** Round two's picks must be at least this sure, or the chat task answers. */
const PICK_MIN_CONFIDENCE = 0.6;
const SECTION_EXCERPT = 12_000;
const NONE = "none";

export const revisionInput = z.object({ units: z.array(z.object({ key: z.string().min(1), text: z.string().min(1) })).min(1) });
export type RevisionInput = z.infer<typeof revisionInput>;
export const revisionEnvelope = z.looseObject({ revisions: z.array(z.unknown()) });

const unitRef = (i: number) => `u${i + 1}`;
const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The sections worth asking about: a revision cue, and enough statements to replace one with another. */
export function revisionCandidates<T extends { key: string; text: string }>(units: readonly T[]): T[] {
  return units.filter((u) => CUE.test(u.text) && statementsOf(u.text, "x").length >= MIN_STATEMENTS);
}

export const findRevisionsTask: TaskDefinition<RevisionInput, unknown> = {
  task: "find_revisions",
  inputSchema: revisionInput,
  outputSchema: revisionEnvelope,
  buildPrompt: ({ input, repairFeedback }) => {
    const sections = input.units.map((u, i) => `[${unitRef(i)}]\n${excerpt(u.text, SECTION_EXCERPT)}`).join("\n\n");
    const prompt =
      `Each section below is part of one document, in order. Find where a section changes its mind: a later statement that replaces an earlier statement of the SAME section about the same thing (a decision reversed, a number, date or name changed — "actually…", "instead…", "update: …").\n\n` +
      `- Quote both statements exactly as written: "earlier" (the one replaced) and "later" (the one that replaces it).\n` +
      `- Never list a later statement that only adds detail, or two statements that can both be true.\n` +
      `- When a section doesn't change its mind, list nothing for it.\n\n` +
      `Reply with JSON only, exactly this shape:\n{"revisions":[{"section":"u1","earlier":"We store data in Firestore.","later":"Actually, we switched to Postgres."}]}\n\n` +
      `Sections:\n\n${sections}`;
    return {
      systemPrompt: "You are a careful editor. You find where a document revises itself, quote exactly, and never invent a revision.",
      prompt: repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt,
    };
  },
  policy: {},
  timeoutMs: 120_000,
};

/** The question id round two asks about statement `s` of section `i` (`u1_s3_replaces`). */
const replacesQuestion = (i: number, s: Statement) => `${unitRef(i)}_${s.id.split(".")[1]}_replaces`;
const sectionStatements = (input: RevisionInput, i: number) => statementsOf(input.units[i]!.text, unitRef(i));

export const findRevisionsDecision: DecisionTask<RevisionInput, unknown> = {
  fallbackTask: "find_revisions",
  timeoutMs: 30_000,
  buildRequest: (input) => {
    if (input.units.some((_, i) => sectionStatements(input, i).length > MAX_STATEMENTS)) return null;
    return input.units.map(
      (u, i): DecisionRequest => ({
        state: { section: excerpt(u.text, SECTION_EXCERPT) },
        questions: {
          [`${unitRef(i)}_revises`]: {
            type: "boolean",
            instructions:
              "Does state.section change its mind: does a later statement replace an earlier statement of the same section about the same thing (a decision reversed, a number, date or name changed)? Answer no if later statements only add detail.",
            whenTrue: "A later statement replaces an earlier one.",
            whenFalse: "No statement replaces an earlier one.",
          },
        },
      }),
    );
  },
  followUp: (answers, input) => {
    const requests = input.units.flatMap((u, i): DecisionRequest[] => {
      const flag = answers[`${unitRef(i)}_revises`];
      if (flag?.type !== "boolean" || flag.probability < REVISES_MIN_PROBABILITY) return [];
      const statements = sectionStatements(input, i);
      const questions = Object.fromEntries(
        statements.slice(1).map((s, k) => [
          replacesQuestion(i, s),
          {
            type: "choice" as const,
            instructions: `This statement: “${excerpt(s.text, 300)}”. Which EARLIER statement of the section does it replace — say something different about the same thing, so the earlier one no longer holds? Choose none if it replaces none (it adds detail, or is about something else).`,
            choices: [...statements.slice(0, k + 1).map((e) => ({ value: e.id, description: excerpt(e.text, 300) })), { value: NONE, description: "it replaces none of them" }],
          },
        ]),
      );
      return [{ state: { section: excerpt(u.text, SECTION_EXCERPT) }, questions }];
    });
    return requests.length ? requests : null;
  },
  interpret: (answers: Record<string, DecisionAnswer>, input) => {
    const revisions: { section: string; earlier: string; later: string }[] = [];
    for (let i = 0; i < input.units.length; i++) {
      const flag = answers[`${unitRef(i)}_revises`];
      if (flag?.type !== "boolean") return null;
      if (flag.probability < REVISES_MIN_PROBABILITY) continue;
      const statements = sectionStatements(input, i);
      let found = 0;
      for (const s of statements.slice(1)) {
        const pick = answers[replacesQuestion(i, s)];
        if (pick?.type !== "choice" || pick.confidence < PICK_MIN_CONFIDENCE) return null;
        if (pick.choice === NONE) continue;
        const earlier = statements.find((e) => e.id === pick.choice);
        if (!earlier || statements.indexOf(earlier) >= statements.indexOf(s)) return null;
        revisions.push({ section: unitRef(i), earlier: earlier.text, later: s.text });
        found++;
      }
      // Round one said it revises itself, round two found nothing: unsure — the chat task answers.
      if (!found) return null;
    }
    return { revisions };
  },
};

/**
 * The revisions in a reply (the chat task's, or the typed model's in the same shape): each quote must be in its section word for
 * word (`verbatim`), the replaced statement before the one replacing it, and the two different. Anything else is dropped.
 */
export function validateRevisions(raw: unknown, input: RevisionInput): Revision[] {
  const rows = typeof raw === "object" && raw !== null && Array.isArray((raw as { revisions?: unknown }).revisions) ? (raw as { revisions: unknown[] }).revisions : [];
  const byRef = new Map(input.units.map((u, i) => [unitRef(i), u] as const));
  const out: Revision[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { section, earlier, later } = row as { section?: unknown; earlier?: unknown; later?: unknown };
    const unit = typeof section === "string" ? byRef.get(section) : undefined;
    if (!unit || typeof earlier !== "string" || typeof later !== "string") continue;
    const e = verbatim(unit.text, earlier);
    const l = verbatim(unit.text, later);
    if (!e || !l || e === l || unit.text.indexOf(e) >= unit.text.indexOf(l)) continue;
    if (!out.some((r) => r.unit === unit.key && r.earlier === e)) out.push({ unit: unit.key, earlier: e, later: l });
  }
  return out;
}

/** The revisions in `units` (only the gated ones are asked about); [] when none, or when AI is unavailable or unsure. */
export async function detectRevisions(runtime: AIRuntime, units: readonly { key: string; text: string }[], signal?: AbortSignal): Promise<Revision[]> {
  const candidates = revisionCandidates(units);
  if (!candidates.length) return [];
  const input: RevisionInput = { units: candidates.map((u) => ({ key: u.key, text: u.text })) };
  try {
    const reply = await runtime.decide<RevisionInput, unknown>(findRevisionsDecision, input, { signal });
    return validateRevisions(reply.data, input);
  } catch (err) {
    if (signal?.aborted || (err instanceof AIError && err.kind === "cancelled")) throw err;
    return [];
  }
}

/**
 * `text` without the statements later ones replaced: each found where its section has it (spacing aside), and removed with the
 * list marker or blank line it leaves. What the model, the change check and the safety net see; the user's text is unchanged.
 */
export function withoutRevised(text: string, revisions: readonly Pick<Revision, "earlier">[]): string {
  let out = text;
  for (const r of revisions) {
    const found = verbatim(out, r.earlier);
    if (!found) continue;
    const at = out.indexOf(found);
    let end = at + found.length;
    // The space it leaves: at the start of a line, or beside another space.
    while (out[end] === " " && (at === 0 || out[at - 1] === "\n" || out[at - 1] === " ")) end++;
    out = out.slice(0, at) + out.slice(end);
  }
  return out
    .split("\n")
    .filter((l) => !/^\s*(?:[-*+]|\d+[.)])\s*$/.test(l))
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function registerRevisionTasks(registry: TaskRegistry): void {
  if (!registry.has(findRevisionsTask.task)) registry.register(findRevisionsTask as TaskDefinition<never, unknown>);
}

registerRevisionTasks(getTaskRegistry());
