/**
 * Live comparison for the topic merge's AI questions (G2/G3): Jev (typed decision model, OpenRouter) vs the chat model
 * (`gpt-oss-120b`, AICredits), on 36 labelled statements against three topics — the 16 of `mergeConflictSpike` plus 20
 * harder ones: contradictions phrased softly, additions that sound like changes ("Pro now also…"), and repeats that slip
 * in one new detail (dropping those as "nothing new" loses content). It measures what decides whether Jev should answer:
 *
 * - relation (repeats / adds / contradicts): accuracy, contradictions caught, false alarms;
 * - "nothing new": additions wrongly judged to add nothing (content that would be dropped), at P ≥ 0.5 and ≥ 0.8;
 * - the contradicted sentence: Jev *picks* it from the topic's own sentences (exact by construction); the chat model
 *   *quotes* it, and the quote must be in the topic word for word (`verbatim`), as the merge requires today;
 * - time per statement.
 *
 * Real network calls with the keys in `.env.local`:  npx vitest run --config vitest.contract.config.ts mergeJevCompare
 * Writes `.ai/docs/decision-spike/merge-jev-vs-chat-2026-10-09.md`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { verbatim } from "@/ai/merge/assign";
import { parseJsonReply } from "@/ai/runtime";
import { aicredits, avg, chat, JEV_MODEL, MAIN_MODEL, openrouter, pct } from "./spikeUtil";

const OUT = join(process.cwd(), ".ai", "docs", "decision-spike");

type Relation = "repeats" | "adds" | "contradicts";
/** Each topic as its sentences: the choices Jev picks from, and what a chat quote must match. */
const TOPICS: Record<string, string[]> = {
  Pricing: ["The Free plan includes 10 AI actions per month.", "The Pro plan costs 12 dollars per month and includes 200 AI actions.", "Annual billing gives two months free."],
  Security: ["API keys are stored encrypted in the browser and are never sent to our servers.", "Exports do not include keys."],
  Roadmap: ["Version 2 ships in March.", "The team of four is focused on the canvas editor first, and the mobile app starts after launch."],
};
/** `target`: the index of the topic sentence a contradiction contradicts. */
const ITEMS: { topic: string; text: string; truth: Relation; target?: number; hard?: true }[] = [
  // From mergeConflictSpike.
  { topic: "Pricing", text: "Pro costs 15 dollars per month.", truth: "contradicts", target: 1 },
  { topic: "Pricing", text: "The Free plan now includes 25 AI actions per month.", truth: "contradicts", target: 0 },
  { topic: "Pricing", text: "Annual billing no longer gives any free months.", truth: "contradicts", target: 2 },
  { topic: "Security", text: "API keys are stored on our servers so they can sync across devices.", truth: "contradicts", target: 0 },
  { topic: "Security", text: "Exports include the user's keys for convenience.", truth: "contradicts", target: 1 },
  { topic: "Roadmap", text: "Version 2 ships in April.", truth: "contradicts", target: 0 },
  { topic: "Roadmap", text: "The mobile app will be built first, before the canvas editor.", truth: "contradicts", target: 1 },
  { topic: "Roadmap", text: "The team is now six people.", truth: "contradicts", target: 1 },
  { topic: "Pricing", text: "Pro also includes priority email support.", truth: "adds" },
  { topic: "Security", text: "Keys are encrypted with AES-256 before they are stored.", truth: "adds" },
  { topic: "Roadmap", text: "Version 2 will include a dark mode.", truth: "adds" },
  { topic: "Pricing", text: "Annual billing is charged once, in January.", truth: "adds" },
  { topic: "Pricing", text: "The Pro plan is twelve dollars a month and has 200 AI actions.", truth: "repeats" },
  { topic: "Security", text: "Our servers never see API keys; they stay encrypted in the browser.", truth: "repeats" },
  { topic: "Roadmap", text: "V2 is planned for March.", truth: "repeats" },
  { topic: "Pricing", text: "Free users get ten AI actions each month.", truth: "repeats" },
  // Harder: contradictions phrased softly.
  { topic: "Roadmap", text: "We had to push version 2 back to late April.", truth: "contradicts", target: 0, hard: true },
  { topic: "Pricing", text: "Pro now comes with 500 AI actions a month.", truth: "contradicts", target: 1, hard: true },
  { topic: "Security", text: "For backup, keys are uploaded to our cloud.", truth: "contradicts", target: 0, hard: true },
  { topic: "Pricing", text: "Yearly plans are billed at the full monthly rate, with no discount.", truth: "contradicts", target: 2, hard: true },
  { topic: "Roadmap", text: "Mobile app development starts now, in parallel with the editor.", truth: "contradicts", target: 1, hard: true },
  { topic: "Pricing", text: "The Free plan is being discontinued; every account will need Pro.", truth: "contradicts", target: 0, hard: true },
  // Harder: additions that sound like changes.
  { topic: "Pricing", text: "Pro now also includes a shared team workspace.", truth: "adds", hard: true },
  { topic: "Roadmap", text: "Version 2 also adds offline mode.", truth: "adds", hard: true },
  { topic: "Pricing", text: "A new Team plan costs 30 dollars per user per month.", truth: "adds", hard: true },
  { topic: "Roadmap", text: "After version 2, a version 3 is planned for September.", truth: "adds", hard: true },
  { topic: "Security", text: "Exports can be password-protected.", truth: "adds", hard: true },
  // Harder: a repeat that slips in one new detail (still "adds": dropping it loses that detail).
  { topic: "Pricing", text: "Pro costs 12 dollars per month, billed through Stripe.", truth: "adds", hard: true },
  { topic: "Roadmap", text: "Version 2 ships in March, with a public beta in February.", truth: "adds", hard: true },
  { topic: "Security", text: "Keys are never sent to our servers, and they are wiped on sign-out.", truth: "adds", hard: true },
  { topic: "Pricing", text: "The Free plan has 10 AI actions a month, and unused actions don't roll over.", truth: "adds", hard: true },
  // Harder: repeats in quite different words.
  { topic: "Roadmap", text: "The four-person team works on the canvas editor before anything else.", truth: "repeats", hard: true },
  { topic: "Security", text: "Exported files leave the keys out.", truth: "repeats", hard: true },
  { topic: "Pricing", text: "Paying yearly gets you two free months.", truth: "repeats", hard: true },
  { topic: "Roadmap", text: "Mobile work begins once version 2 is out.", truth: "repeats", hard: true },
  { topic: "Security", text: "The browser keeps API keys encrypted, and nothing about them reaches our servers.", truth: "repeats", hard: true },
];

const RELATION_CHOICES = [
  { value: "repeats", description: "says the same thing the topic already says, in other words, adding nothing" },
  { value: "adds", description: "adds a detail the topic doesn't have, without contradicting anything it says" },
  { value: "contradicts", description: "states something incompatible with what the topic says about the same thing" },
];
// The same wording the merge's own questions use (`assignToTopicsDecision`, the chat `assign_to_topics` prompt).
const RELATION = "How does state.new_content relate to the topic? Choose contradicts only when it states something incompatible with what the topic says about the same thing (a different choice, number, date, requirement or yes/no); a detail added, or a repeat, is not a contradiction.";
const NOTHING_NEW =
  "Does state.new_content say nothing that the topic doesn't already say, in any words: no fact, number, name, decision, example or detail the topic lacks? Answer yes only if it adds nothing at all; if it adds anything, or you are unsure, answer no.";
const WHICH = "If state.new_content contradicts the topic, which of the topic's sentences does it contradict? Answer none if it contradicts none of them.";

const chatPrompt = (topic: string, text: string) =>
  `A user's notes have this topic:\n\n${TOPICS[topic]!.join(" ")}\n\nNew content:\n\n${text}\n\n` +
  `Answer three things about the new content:\n` +
  `- "relation": "repeats" (says the same thing, adding nothing), "adds" (adds a detail without contradicting anything) or "contradicts" (states something incompatible with the topic about the same thing: a different choice, number, date, requirement or yes/no).\n` +
  `- "nothingNew": true only when it says nothing the topic doesn't already say, in any words: no fact, number, name, decision, example or detail it lacks. If it adds anything at all, or you are unsure, false.\n` +
  `- "topicSays": when it contradicts the topic, the topic's sentence it contradicts, quoted exactly as written; otherwise null.\n\n` +
  `Reply with JSON only: {"relation":"…","nothingNew":false,"topicSays":null}`;

/** Runs `fn` over `items` with at most `n` at once. */
async function pool<T, R>(items: readonly T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

interface Answer {
  relation: string;
  /** P(nothing new) for Jev; 1 or 0 for the chat model. */
  nothingNew: number;
  /** The contradicted sentence's index, as picked (Jev) or as its quote matches (chat); -1 none; null for a misquote. */
  target: number | null;
  ms: number;
  quote?: string | null;
}

async function askJev(it: (typeof ITEMS)[number]): Promise<Answer> {
  const start = Date.now();
  const sentences = TOPICS[it.topic]!;
  const r = await hostDecide({
    vendor: "jev",
    model: JEV_MODEL,
    apiKey: openrouter!.apiKey,
    timeoutMs: 60_000,
    request: {
      state: { topic: `${it.topic}: ${sentences.join(" ")}`, new_content: it.text },
      questions: {
        relation: { type: "choice", instructions: RELATION, choices: RELATION_CHOICES },
        nothing_new: { type: "boolean", instructions: NOTHING_NEW, whenTrue: "It repeats the topic and adds nothing new.", whenFalse: "It adds at least one fact, number, name, decision, example or detail the topic lacks." },
        which: { type: "choice", instructions: WHICH, choices: [...sentences.map((s, i) => ({ value: `s${i}`, description: s })), { value: "none", description: "it contradicts none of the topic's sentences" }] },
      },
    },
  });
  const rel = r.answers.relation?.type === "choice" ? r.answers.relation.choice : "?";
  const nothing = r.answers.nothing_new?.type === "boolean" ? r.answers.nothing_new.probability : 0;
  const which = r.answers.which?.type === "choice" ? r.answers.which.choice : "none";
  return { relation: rel, nothingNew: nothing, target: which === "none" ? -1 : Number(which.slice(1)), ms: Date.now() - start };
}

async function askChat(it: (typeof ITEMS)[number]): Promise<Answer> {
  const r = await chat(MAIN_MODEL, chatPrompt(it.topic, it.text));
  const raw = (parseJsonReply(r.text) ?? {}) as { relation?: unknown; nothingNew?: unknown; topicSays?: unknown };
  const quote = typeof raw.topicSays === "string" && raw.topicSays.trim() ? raw.topicSays : null;
  const sentences = TOPICS[it.topic]!;
  // As the merge checks it: the quote must be in the topic word for word; then which sentence it is.
  const found = quote ? verbatim(sentences.join(" "), quote) : null;
  const target = !quote ? -1 : found ? sentences.findIndex((s) => s.includes(found.replace(/[.!?]$/, "")) || found.includes(s.replace(/[.!?]$/, ""))) : null;
  return { relation: typeof raw.relation === "string" ? raw.relation : "?", nothingNew: raw.nothingNew === true ? 1 : 0, target, ms: r.ms, quote };
}

describe.skipIf(!aicredits || !openrouter)("live comparison: Jev vs the chat model on the merge's questions", () => {
  it("relation, 'nothing new' and the contradicted sentence, on 36 labelled statements", async () => {
    mkdirSync(OUT, { recursive: true });
    const jev = await pool(ITEMS, 6, askJev);
    const gpt = await pool(ITEMS, 3, askChat);

    const contradictions = ITEMS.filter((i) => i.truth === "contradicts");
    const additions = ITEMS.filter((i) => i.truth === "adds");
    const repeats = ITEMS.filter((i) => i.truth === "repeats");
    const count = (a: Answer[], f: (x: Answer, it: (typeof ITEMS)[number]) => boolean, set = ITEMS) => set.filter((it) => f(a[ITEMS.indexOf(it)]!, it)).length;

    const summary = (name: string, a: Answer[], dropAt: number) => ({
      name,
      right: count(a, (x, it) => x.relation === it.truth),
      rightHard: count(a, (x, it) => x.relation === it.truth, ITEMS.filter((i) => i.hard)),
      caught: count(a, (x) => x.relation === "contradicts", contradictions),
      alarms: count(a, (x) => x.relation === "contradicts", [...additions, ...repeats]),
      dropped: count(a, (x) => x.nothingNew >= dropAt, additions),
      dedup: count(a, (x) => x.nothingNew >= dropAt, repeats),
      targetRight: count(a, (x, it) => x.relation === "contradicts" && x.target === it.target, contradictions),
      misquotes: count(a, (x) => x.relation === "contradicts" && x.target === null, contradictions),
      ms: avg(a.map((x) => x.ms)),
    });
    const rows = [summary("Jev (P ≥ 0.5 for 'nothing new')", jev, 0.5), summary("Jev (P ≥ 0.8 for 'nothing new')", jev, 0.8), summary("gpt-oss-120b (chat)", gpt, 0.5)];
    const hard = ITEMS.filter((i) => i.hard).length;

    const md = [
      "# Live comparison — Jev vs the chat model on the merge's questions (2026-10-09)",
      "",
      `${ITEMS.length} labelled statements against three topics: ${contradictions.length} contradictions, ${additions.length} additions, ${repeats.length} repeats (${hard} of them hard: soft contradictions, additions that sound like changes, repeats with one new detail, repeats in other words). Jev: \`${JEV_MODEL}\` (OpenRouter, typed). Chat: \`${MAIN_MODEL}\` (AICredits).`,
      "",
      "| answerer | relation right | on the hard ones | contradictions caught | false alarms (additions/repeats called contradictions) | **additions dropped as 'nothing new'** | repeats left out as 'nothing new' | contradicted sentence right | misquotes (quote not in the notes) | time / statement |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.name} | ${pct(r.right, ITEMS.length)} | ${pct(r.rightHard, hard)} | ${pct(r.caught, contradictions.length)} | ${pct(r.alarms, additions.length + repeats.length)} | ${pct(r.dropped, additions.length)} | ${pct(r.dedup, repeats.length)} | ${pct(r.targetRight, contradictions.length)} | ${r.name.startsWith("Jev") ? "n/a (picked)" : pct(r.misquotes, contradictions.length)} | ${r.ms} ms |`),
      "",
      "| # | topic: statement | truth | Jev relation | Jev P(nothing new) | Jev picked | chat relation | chat nothing new | chat quote |",
      "|---|---|---|---|---|---|---|---|---|",
      ...ITEMS.map((it, i) => {
        const j = jev[i]!;
        const g = gpt[i]!;
        const mark = (ok: boolean) => (ok ? "" : " ✗");
        const pick = (t: number | null) => (t === null ? "misquote" : t < 0 ? "none" : `s${t}`);
        return `| ${i + 1}${it.hard ? "*" : ""} | ${it.topic}: ${it.text} | ${it.truth}${it.target !== undefined ? ` (s${it.target})` : ""} | ${j.relation}${mark(j.relation === it.truth)} | ${j.nothingNew.toFixed(2)}${mark(it.truth === "adds" ? j.nothingNew < 0.5 : true)} | ${pick(j.target)}${mark(it.truth !== "contradicts" || j.target === it.target)} | ${g.relation}${mark(g.relation === it.truth)} | ${g.nothingNew ? "yes" : "no"}${mark(it.truth === "adds" ? !g.nothingNew : true)} | ${g.quote ? `“${g.quote.slice(0, 50)}” → ${pick(g.target)}` : "—"}${mark(it.truth !== "contradicts" || g.target === it.target)} |`;
      }),
      "",
      "\\* hard case. ✗ marks a wrong answer (for 'nothing new', only additions count: saying yes to one drops content).",
    ];
    writeFileSync(join(OUT, "merge-jev-vs-chat-2026-10-09.md"), md.join("\n"));
    console.log(md.slice(0, 9).join("\n"));
    expect(jev.length).toBe(ITEMS.length);
  }, 1_200_000);
});
