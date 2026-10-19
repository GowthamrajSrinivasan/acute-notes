/**
 * Spike: could a typed decision model (Jev) answer `assign_to_topics` (the merge feature: which existing topic does each part of new
 * content belong to, and does it add anything)? `.ai/docs/decision-models-plan.md`, section 3 and 8.
 *
 * Labelled set, built from the four sample documents (each document's units are the "existing notes' topics"):
 *   - restatement: a topic's content rewritten in other words, nothing added     -> truth: that topic, nothing new
 *   - extension:   a follow-up on a topic that adds one new concrete fact        -> truth: that topic, something new
 *   - unrelated:   hand-written notes on subjects no topic covers                -> truth: new topic
 * (restatements and extensions are written by `gpt-oss-120b` from the topic's own text; none carries the topic's heading.)
 *
 * Compared: the production chat prompt with `gpt-oss-120b` and with Gemini lite (the chat decision model), the local heuristic
 * (`assignLocally`), and Jev (one request per part: a choice over the topics + "new", and a yes/no "adds nothing new"), through the
 * app's own `hostDecide`. Real network calls with the keys in `.env.local`. Run explicitly:
 *   npx vitest run --config vitest.contract.config.ts assignSpike
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { assignLocally, assignToTopicsTask, topicLabel, validateAssignment, type AssignInput, type Topic } from "@/ai/merge/assign";
import { parseJsonReply } from "@/ai/runtime";
import type { AnalysisUnit } from "@/ai/reconcile/units";
import type { DecisionRequest } from "@/ai/decisions/types";
import { aicredits, avg, CHAT_DECISION_MODEL, chat, FIXTURES, JEV_MODEL, loadUnits, MAIN_MODEL, openrouter, pct } from "./spikeUtil";

const OUT = join(process.cwd(), ".ai", "docs", "decision-spike");
const UNRELATED = [
  "Team offsite planning: book the venue for the second week of March for 12 people, ask the caterer about vegetarian and nut-free options, and collect travel receipts by the 20th.",
  "Quarterly tax reminder: the estimated payment is due on the 15th, the accountant needs last quarter's expense export, and the new mileage rate applies from January.",
  "Garden notes: the tomatoes need staking before the first frost, the compost bin should be turned every two weeks, and the apple tree is due for pruning in late winter.",
  "Reading list for the book club: start with the short story collection, then the memoir the group voted for, and leave the 600-page novel for the summer break.",
];
const NEW = "new";

type Truth = "restatement" | "extension" | "unrelated";
interface Part {
  key: string;
  text: string;
  truth: Truth;
  /** The topic key it belongs to, or null (a new topic). */
  topic: string | null;
}

async function variants(unit: AnalysisUnit): Promise<{ restatement: string; extension: string }> {
  const body = unit.text.replace(/^#{1,6}\s.*\n+/, "").slice(0, 1_500);
  const [restatement, extension] = await Promise.all([
    chat(MAIN_MODEL, `Rewrite the note below in completely different words, as a short message of 2-4 sentences with no heading. Keep every fact exactly and add nothing new. Reply with the message only.\n\nNote:\n${body}`),
    chat(MAIN_MODEL, `Write a short follow-up message (2-4 sentences, no heading) about the same subject as the note below, in different words. It must add one new concrete fact the note does not contain (a specific number, name or condition). Reply with the message only.\n\nNote:\n${body}`),
  ]);
  return { restatement: restatement.text.trim(), extension: extension.text.trim() };
}

const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const toUnit = (p: Part): AnalysisUnit => ({ key: p.key, text: p.text, span: { start: 0, end: 0 } });

interface Answer {
  topic: string | null | undefined;
  nothingNew: boolean;
  confidence?: number;
}

async function chatAssign(model: string, topics: Topic[], parts: Part[]): Promise<{ answers: Map<string, Answer>; ms: number; tokens: number }> {
  const input: AssignInput = { topics, parts: parts.map((p) => ({ key: p.key, text: p.text })) };
  const { systemPrompt, prompt } = assignToTopicsTask.buildPrompt({ input });
  const reply = await chat(model, prompt, systemPrompt);
  const unanswered = new Map<string, string | null>(parts.map((p) => [p.key, "__unanswered__"]));
  const { assignment, nothingNew } = validateAssignment(parseJsonReply(reply.text), input, unanswered);
  return { answers: new Map(parts.map((p) => [p.key, { topic: assignment.get(p.key), nothingNew: nothingNew.has(p.key) }])), ms: reply.ms, tokens: reply.tokens };
}

/** One part, one request: which topic (or new), and does it add nothing the topic doesn't already say? */
function jevRequest(topics: Topic[], part: Part): DecisionRequest {
  const per = Math.min(3_000, Math.max(400, Math.floor(16_000 / topics.length)));
  return {
    state: { topics: topics.map((t, i) => ({ id: `t${i + 1}`, label: t.label, text: excerpt(t.text, per) })), new_content: excerpt(part.text, 800) },
    questions: {
      topic: {
        type: "choice",
        instructions:
          "A user's notes are organised by topic (state.topics). New content (state.new_content) arrives. Which existing topic does it belong to? It belongs to a topic when it is about the same subject: it adds to it, details it, repeats it or changes it, even under a different heading. Answer new only when it is about a subject none of the topics covers.",
        choices: [...topics.map((t, i) => ({ value: `t${i + 1}`, description: t.label })), { value: NEW, description: "a subject none of the topics covers" }],
      },
      nothing_new: {
        type: "boolean",
        instructions:
          "Does state.new_content say nothing that the topic it belongs to doesn't already say, in any words: no fact, number, name, decision, example or detail the topic lacks? Answer yes only if it adds nothing at all; if it adds anything, or you are unsure, answer no.",
        whenTrue: "It repeats the topic and adds nothing new.",
        whenFalse: "It adds at least one fact, number, name, decision, example or detail the topic lacks.",
      },
    },
  };
}

async function jevAssign(topics: Topic[], parts: Part[]): Promise<{ answers: Map<string, Answer>; wallMs: number; avgMs: number; tokens: number }> {
  const start = Date.now();
  const rows = await Promise.all(
    parts.map(async (p) => {
      const t0 = Date.now();
      const r = await hostDecide({ vendor: "jev", model: JEV_MODEL, apiKey: openrouter!.apiKey, request: jevRequest(topics, p), timeoutMs: 60_000 });
      const topic = r.answers.topic?.type === "choice" ? r.answers.topic : null;
      const nn = r.answers.nothing_new?.type === "boolean" ? r.answers.nothing_new.probability : 0;
      const key = topic ? (topic.choice === NEW ? null : (topics[Number(topic.choice.slice(1)) - 1]?.key ?? undefined)) : undefined;
      return { key: p.key, ans: { topic: key, nothingNew: nn >= 0.5, confidence: topic?.confidence ?? 0 } as Answer, ms: Date.now() - t0, tokens: r.usage.promptTokens ?? 0 };
    }),
  );
  return { answers: new Map(rows.map((r) => [r.key, r.ans])), wallMs: Date.now() - start, avgMs: avg(rows.map((r) => r.ms)), tokens: rows.reduce((s, r) => s + r.tokens, 0) };
}

interface Score {
  name: string;
  topicRight: number;
  parts: number;
  newRight: number;
  newTotal: number;
  nnCorrect: number;
  nnTotal: number;
  contentLoss: number;
  extensions: number;
  ms: number[];
  tokens: number;
}
const emptyScore = (name: string): Score => ({ name, topicRight: 0, parts: 0, newRight: 0, newTotal: 0, nnCorrect: 0, nnTotal: 0, contentLoss: 0, extensions: 0, ms: [], tokens: 0 });

function score(s: Score, parts: Part[], answers: Map<string, Answer>): void {
  for (const p of parts) {
    const a = answers.get(p.key);
    s.parts++;
    const right = a !== undefined && a.topic === p.topic;
    if (right) s.topicRight++;
    if (p.truth === "unrelated") {
      s.newTotal++;
      if (right) s.newRight++;
    } else {
      // "nothing new" only counts for a part filed under its topic: restatement = yes, extension = no.
      s.nnTotal++;
      if (a?.nothingNew === (p.truth === "restatement")) s.nnCorrect++;
      if (p.truth === "extension") {
        s.extensions++;
        if (a?.nothingNew) s.contentLoss++;
      }
    }
  }
}

describe.skipIf(!aicredits || !openrouter)("spike: typed decision model for assign_to_topics", () => {
  it("compares chat, local and Jev on a labelled set built from the sample documents", async () => {
    mkdirSync(OUT, { recursive: true });
    const scores = new Map<string, Score>(["gpt-oss-120b (chat)", "Gemini lite (chat)", "local heuristic", "Jev (typed)"].map((n) => [n, emptyScore(n)]));
    const rows: string[] = [];
    let unrelatedIndex = 0;

    for (const file of FIXTURES) {
      const { units } = await loadUnits(file);
      const topics: Topic[] = units.map((u) => ({ key: u.key, label: topicLabel(u.key), text: u.text }));
      // Up to four topics with enough text to be written about; their generated parts are the labelled set.
      const chosen = units.filter((u) => u.text.length >= 250 && u.text.length <= 4_000).slice(0, 4);
      const generated: Awaited<ReturnType<typeof variants>>[] = [];
      for (const u of chosen) generated.push(await variants(u));
      const parts: Part[] = [];
      chosen.forEach((u, i) => {
        parts.push({ key: `rest-${i + 1}`, text: generated[i]!.restatement, truth: "restatement", topic: u.key });
        parts.push({ key: `ext-${i + 1}`, text: generated[i]!.extension, truth: "extension", topic: u.key });
      });
      for (let i = 0; i < 2; i++) parts.push({ key: `new-${i + 1}`, text: UNRELATED[unrelatedIndex++ % UNRELATED.length]!, truth: "unrelated", topic: null });

      const [gpt, lite] = [await chatAssign(MAIN_MODEL, topics, parts), await chatAssign(CHAT_DECISION_MODEL, topics, parts)];
      const jev = await jevAssign(topics, parts);
      const local: Map<string, Answer> = new Map([...assignLocally(topics, parts.map(toUnit))].map(([k, v]) => [k, { topic: v, nothingNew: false }]));
      score(scores.get("gpt-oss-120b (chat)")!, parts, gpt.answers);
      score(scores.get("Gemini lite (chat)")!, parts, lite.answers);
      score(scores.get("local heuristic")!, parts, local);
      score(scores.get("Jev (typed)")!, parts, jev.answers);
      scores.get("gpt-oss-120b (chat)")!.ms.push(gpt.ms);
      scores.get("gpt-oss-120b (chat)")!.tokens += gpt.tokens;
      scores.get("Gemini lite (chat)")!.ms.push(lite.ms);
      scores.get("Gemini lite (chat)")!.tokens += lite.tokens;
      scores.get("Jev (typed)")!.ms.push(jev.wallMs);
      scores.get("Jev (typed)")!.tokens += jev.tokens;

      rows.push(`### ${file} — ${topics.length} topics, ${parts.length} parts (chat gpt-oss ${gpt.ms} ms, Gemini lite ${lite.ms} ms, Jev ${jev.wallMs} ms for all parts in parallel, avg ${jev.avgMs} ms per request)`, "", "| part | truth | gpt-oss | Gemini lite | local | Jev (conf) | Jev says nothing-new |", "|---|---|---|---|---|---|---|");
      const label = (k: string | null | undefined) => (k === undefined ? "—" : k === null ? "NEW" : topicLabel(k).slice(0, 22));
      for (const p of parts) {
        const g = gpt.answers.get(p.key)!;
        const l = lite.answers.get(p.key)!;
        const j = jev.answers.get(p.key)!;
        const mark = (a: Answer) => (a.topic === p.topic ? "" : " ✗");
        rows.push(`| ${p.key} | ${p.truth}: ${label(p.topic)} | ${label(g.topic)}${mark(g)}${g.nothingNew ? " (nn)" : ""} | ${label(l.topic)}${mark(l)}${l.nothingNew ? " (nn)" : ""} | ${label(local.get(p.key)!.topic)}${mark(local.get(p.key)!)} | ${label(j.topic)}${mark(j)} (${(j.confidence ?? 0).toFixed(2)}) | ${j.nothingNew ? "yes" : "no"} |`);
      }
      rows.push("");
    }

    const table = [...scores.values()].map(
      (s) =>
        `| ${s.name} | ${pct(s.topicRight, s.parts)} | ${pct(s.newRight, s.newTotal)} | ${s.name === "local heuristic" ? "n/a" : pct(s.nnCorrect, s.nnTotal)} | ${s.name === "local heuristic" ? "n/a" : pct(s.contentLoss, s.extensions)} | ${s.ms.length ? `${avg(s.ms)} ms` : "~0"} | ${s.tokens || "—"} |`,
    );
    const report = [
      `# Spike — typed decision model for assign_to_topics (2026-10-09)`,
      "",
      `Labelled set from the 4 sample documents: restatements, extensions (one new fact) and unrelated notes, ${[...scores.values()][0]!.parts} parts. Typed model: \`${JEV_MODEL}\` via \`hostDecide\`.`,
      "",
      "| answerer | right topic (or NEW) | …of unrelated parts → NEW | \"adds nothing new\" right | content lost (extension called nothing-new) | time per document | tokens |",
      "|---|---|---|---|---|---|---|",
      ...table,
      "",
      "Content lost matters most: a part wrongly judged to add nothing is dropped from the merge.",
      "",
      "## Per part",
      "",
      ...rows,
    ];
    writeFileSync(join(OUT, "assign-spike-2026-10-09.md"), report.join("\n"));
    console.log(report.slice(0, 14).join("\n"));
    expect(scores.get("Jev (typed)")!.parts).toBeGreaterThan(0);
  }, 900_000);
});
