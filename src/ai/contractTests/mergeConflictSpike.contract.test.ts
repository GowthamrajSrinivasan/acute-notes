/**
 * Live check: how does the topic merge (`src/ai/merge/`) treat duplicates and conflicts with Jev as the typed decision model?
 *
 * Part 1 — the merge's front half, exactly as `mergeIntoSource` runs it (parse, repeats left out before any model call, assignment through
 *   `runtime.decide(assignToTopicsDecision)` answered by Jev on OpenRouter, then `composeMerged`) on a small set of notes and new content that
 *   holds: a word-for-word repeat, a restatement, a cross-topic repeat, an addition, an unrelated note, and two CONTRADICTIONS of the notes
 *   (a price and a date). It prints what is filed where, what is left out, and what text the merge would write.
 * Part 2 — can a typed decision model recognise a contradiction (plan §5.3 rule 7: "only real contradictions are flagged")? 16 labelled
 *   statements against the notes' topics (8 contradictions, 4 additions, 4 restatements): Jev (a yes/no and a 3-way choice) vs `gpt-oss-120b`
 *   and Gemini lite. Contradiction detection is NOT part of the merge today; this measures whether it could be.
 * Real network calls with the keys in `.env.local`:  npx vitest run --config vitest.contract.config.ts mergeConflictSpike
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import { AIError } from "@/ai/errors";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { assignLocally, assignToTopicsDecision, registerMergeTasks, topicLabel, validateAssignment, type AssignInput, type Topic } from "@/ai/merge/assign";
import { composeMerged } from "@/ai/merge/compose";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { analysisUnits, headingOnlyReply, type AnalysisUnit } from "@/ai/reconcile/units";
import { createAIRuntime, parseJsonReply } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { DecisionProvider, DecisionRequest, DecisionResult } from "@/ai/decisions/types";
import { aicredits, avg, CHAT_DECISION_MODEL, chat, JEV_MODEL, MAIN_MODEL, openrouter, pct } from "./spikeUtil";

const OUT = join(process.cwd(), ".ai", "docs", "decision-spike");

const NOTES = `# Product notes

## Pricing

The Free plan includes 10 AI actions per month. The Pro plan costs 12 dollars per month and includes 200 AI actions. Annual billing gives two months free.

## Security

API keys are stored encrypted in the browser and are never sent to our servers. Exports do not include keys.

## Roadmap

Version 2 ships in March. The team of four is focused on the canvas editor first, and the mobile app starts after launch.
`;

const INCOMING = `## Pricing recap

The Free plan includes 10 AI actions per month.

The Pro plan is twelve dollars monthly with 200 AI actions included.

## Keys and storage

Keys live encrypted inside the browser, and our servers never receive them.

## Support

Pro subscribers also get priority email support within one business day.

## Price change

Pro is now 15 dollars per month, not 12.

## Schedule

Version 2 now ships in April, not March.

## Team offsite

Book the venue for the second week of June for 12 people.
`;

/** The same new content without the two contradictions: Jev answers all of it. */
const INCOMING_CLEAN = INCOMING.replace(/## Price change[\s\S]*?## Team offsite/, "## Team offsite").replace(/## Schedule[\s\S]*?## Team offsite/, "## Team offsite");

const headingOf = (p: AnalysisUnit): string[] => (/^#{1,6}\s/.test(p.text.split("\n", 1)[0] ?? "") ? [p.text.split("\n", 1)[0]!] : []);

function runtimeWithJev(): { runtime: ReturnType<typeof createAIRuntime>; decided: DecisionRequest[]; results: DecisionResult[] } {
  const decided: DecisionRequest[] = [];
  const results: DecisionResult[] = [];
  const jev: DecisionProvider = {
    id: "openrouter",
    name: "Jev",
    model: JEV_MODEL,
    decide: async (request, options) => {
      decided.push(request);
      const result = await hostDecide({ vendor: "jev", model: JEV_MODEL, apiKey: openrouter!.apiKey, request, timeoutMs: options?.timeoutMs, signal: options?.signal });
      results.push(result);
      return result;
    },
  };
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerMergeTasks(registry);
  // A primary that always fails: if the typed decision model didn't answer, the run says so instead of quietly succeeding.
  manager.registerProvider(createMockProvider({ id: "primary", respond: async () => Promise.reject(new AIError("model_unavailable", "fallback was used")) }));
  manager.setPrimary("primary");
  manager.setTypedDecisionProvider(jev);
  return { runtime: createAIRuntime({ manager, registry }), decided, results };
}

// ---- Part 2 data ----------------------------------------------------------------------------------------------
type Relation = "repeats" | "adds" | "contradicts";
const TOPICS: Record<string, string> = {
  Pricing: "The Free plan includes 10 AI actions per month. The Pro plan costs 12 dollars per month and includes 200 AI actions. Annual billing gives two months free.",
  Security: "API keys are stored encrypted in the browser and are never sent to our servers. Exports do not include keys.",
  Roadmap: "Version 2 ships in March. The team of four is focused on the canvas editor first, and the mobile app starts after launch.",
};
const ITEMS: { topic: string; text: string; truth: Relation }[] = [
  { topic: "Pricing", text: "Pro costs 15 dollars per month.", truth: "contradicts" },
  { topic: "Pricing", text: "The Free plan now includes 25 AI actions per month.", truth: "contradicts" },
  { topic: "Pricing", text: "Annual billing no longer gives any free months.", truth: "contradicts" },
  { topic: "Security", text: "API keys are stored on our servers so they can sync across devices.", truth: "contradicts" },
  { topic: "Security", text: "Exports include the user's keys for convenience.", truth: "contradicts" },
  { topic: "Roadmap", text: "Version 2 ships in April.", truth: "contradicts" },
  { topic: "Roadmap", text: "The mobile app will be built first, before the canvas editor.", truth: "contradicts" },
  { topic: "Roadmap", text: "The team is now six people.", truth: "contradicts" },
  { topic: "Pricing", text: "Pro also includes priority email support.", truth: "adds" },
  { topic: "Security", text: "Keys are encrypted with AES-256 before they are stored.", truth: "adds" },
  { topic: "Roadmap", text: "Version 2 will include a dark mode.", truth: "adds" },
  { topic: "Pricing", text: "Annual billing is charged once, in January.", truth: "adds" },
  { topic: "Pricing", text: "The Pro plan is twelve dollars a month and has 200 AI actions.", truth: "repeats" },
  { topic: "Security", text: "Our servers never see API keys; they stay encrypted in the browser.", truth: "repeats" },
  { topic: "Roadmap", text: "V2 is planned for March.", truth: "repeats" },
  { topic: "Pricing", text: "Free users get ten AI actions each month.", truth: "repeats" },
];

const RELATION_CHOICES = [
  { value: "repeats", description: "says the same thing the topic already says, in other words, adding nothing" },
  { value: "adds", description: "adds a detail the topic doesn't have, without contradicting anything it says" },
  { value: "contradicts", description: "states something incompatible with what the topic says about the same thing: a different choice, number, date, requirement or yes/no" },
];
const CONTRADICTS =
  "Does new_statement say something incompatible with what the topic says about the same thing (a different choice, number, date, requirement or yes/no)? Statements that only add detail, or repeat the topic, are NOT contradictions. If it is not clearly incompatible, answer no.";

const chatPrompt = (topic: string, text: string) =>
  `Notes topic:\n${TOPICS[topic]}\n\nNew statement:\n${text}\n\nHow does the new statement relate to the topic?\n- "repeats": says the same thing, adding nothing\n- "adds": adds a detail without contradicting anything\n- "contradicts": states something incompatible with the topic about the same thing (a different choice, number, date, requirement or yes/no)\n\nReply with JSON only: {"relation":"repeats"|"adds"|"contradicts"}`;

async function chatRelation(model: string, topic: string, text: string): Promise<{ relation: string; ms: number }> {
  const r = await chat(model, chatPrompt(topic, text));
  const raw = parseJsonReply(r.text) as { relation?: unknown };
  return { relation: typeof raw?.relation === "string" ? raw.relation : "?", ms: r.ms };
}

describe.skipIf(!aicredits || !openrouter)("live check: topic merge duplicates and conflicts with Jev", () => {
  it("part 1 (the merge as it runs) and part 2 (could a typed model flag contradictions)", async () => {
    mkdirSync(OUT, { recursive: true });
    const md: string[] = [`# Live check — topic merge, duplicates and conflicts, with Jev (2026-10-09)`, ""];

    // ---------------- Part 1: the merge's front half, as mergeIntoSource runs it ----------------
    const [{ parsed }, { parsed: incomingParsed }] = await Promise.all([analyzeContent(NOTES, {}), analyzeContent(INCOMING_CLEAN, {})]);
    const units = analysisUnits(parsed, NOTES);
    const topics: Topic[] = units.filter((u) => !headingOnlyReply(u, "sectioned")).map((u) => ({ key: u.key, label: topicLabel(u.key), text: u.text }));
    const allParts = analysisUnits(incomingParsed, INCOMING_CLEAN).filter((u) => !headingOnlyReply(u, "sectioned"));
    const unfiled = composeMerged({ text: NOTES, parsed, units, incoming: INCOMING_CLEAN, incomingParsed, parts: allParts, assignment: new Map() });
    const repeated = new Set(unfiled.report.skippedParts);
    let parts = allParts.filter((p) => !repeated.has(p.key));
    let assignment = assignLocally(topics, parts);
    const request: AssignInput = {
      topics,
      parts: parts.map((p) => ({ key: p.key, text: [...headingOf(p), ...(unfiled.kept[p.key] ?? [])].join("\n\n") || p.text })),
    };
    const { runtime, decided } = runtimeWithJev();
    const t0 = Date.now();
    const reply = await runtime.decide<AssignInput, unknown>(assignToTopicsDecision, request);
    const assignMs = Date.now() - t0;
    const checked = validateAssignment(reply.data, request, assignment);
    assignment = checked.assignment;
    parts = parts.filter((p) => !checked.nothingNew.has(p.key));
    const composed = composeMerged({ text: NOTES, parsed, units, incoming: INCOMING_CLEAN, incomingParsed, parts, assignment });
    const label = (k: string | null | undefined) => (k ? topicLabel(k) : "NEW topic");

    md.push(
      "## Part 1 — the merge as it runs",
      "",
      `Answered by: **${reply.providerId}** (role ${reply.role}; the fallback primary was set to always fail, so this was the typed model). ${decided.length} Jev requests in ${assignMs} ms.`,
      "",
      "| new part | handled by | result |",
      "|---|---|---|",
      ...allParts.map((p) => {
        if (repeated.has(p.key)) return `| ${topicLabel(p.key)} | code, before any model call | every block already in the notes (word for word / nearly all words) → left out |`;
        if (checked.nothingNew.has(p.key)) return `| ${topicLabel(p.key)} | Jev | filed under **${label(assignment.get(p.key))}** and judged to add nothing new → left out, named in the review |`;
        return `| ${topicLabel(p.key)} | Jev | filed under **${label(assignment.get(p.key))}** |`;
      }),
      "",
      `Report: merged into ${JSON.stringify(Object.fromEntries(Object.entries(composed.report.mergedInto).map(([k, v]) => [topicLabel(k), v.map(topicLabel)])))}; new topics ${JSON.stringify(composed.report.newTopics.map(topicLabel))}; blocks left out as repeats ${unfiled.report.skippedBlocks + composed.report.skippedBlocks} (${composed.report.repeatedElsewhere} under another topic); notes' own overlapping topics ${composed.report.overlaps.length}.`,
      "",
      "### The merged text the merge would write (what then goes through Update)",
      "",
      "```markdown",
      composed.text.trim(),
      "```",
      "",
    );

    // ---------------- Part 1b: the same notes with the two contradicting parts: Jev answers round two with the conflicting statements ----------------
    const { parsed: fullParsed } = await analyzeContent(INCOMING, {});
    const fullParts = analysisUnits(fullParsed, INCOMING).filter((u) => !headingOnlyReply(u, "sectioned"));
    const aside = runtimeWithJev();
    const fullRequest: AssignInput = { topics, parts: fullParts.map((p) => ({ key: p.key, text: p.text })) };
    // The test's primary refuses on purpose: an answer from "openrouter" means Jev (both rounds) answered, "fallback was used" means it stepped aside.
    const roundTwo = await aside.runtime.decide<AssignInput, unknown>(assignToTopicsDecision, fullRequest).then(
      (r) => r,
      (e: unknown) => (e instanceof AIError && e.message === "fallback was used" ? null : Promise.reject(e)),
    );
    const found = roundTwo ? validateAssignment(roundTwo.data, fullRequest, new Map()).conflicts : new Map<string, { about: string; topicSays: string; partSays: string }[]>();
    const outcome = roundTwo
      ? `Jev answered (${roundTwo.providerId}) and found ${[...found.values()].reduce((n, c) => n + c.length, 0)} conflict(s) in ${found.size} part(s)`
      : "stepped aside: the chat task was asked (the test's primary refuses on purpose)";
    const relations = aside.results.flatMap((r) => Object.entries(r.answers).filter(([k]) => k.endsWith("_relation")));
    md.push(
      "## Part 1b — the same notes with the two contradicting parts",
      "",
      `Outcome: **${outcome}**.`,
      "",
      "| part | Jev relation to its topic (P contradicts) | conflict found (topic says / part says) |",
      "|---|---|---|",
      ...fullParts.map((p, i) => {
        const a = relations.find(([k]) => k === `p${i + 1}_relation`)?.[1];
        const c = found.get(p.key)?.map((x) => `“${x.topicSays}” / “${x.partSays}”`).join("; ") ?? "—";
        return `| ${topicLabel(p.key)} | ${a?.type === "choice" ? `${a.choice} (${(a.probabilities.contradicts ?? 0).toFixed(2)})` : "—"} | ${c} |`;
      }),
      "",
    );
    // Jev answers the contradictions itself (round two) and finds the price change and the date change; nothing else is flagged.
    expect(roundTwo?.providerId).toBe("openrouter");
    expect([...found.keys()].map(topicLabel).sort()).toEqual(["Price change", "Schedule"]);
    for (const list of found.values()) for (const c of list) expect(INCOMING).toContain(c.partSays.replace(/[.!?]+$/, ""));

    // ---------------- Part 2: could a typed decision model flag contradictions? ----------------
    const rows = await Promise.all(
      ITEMS.map(async (it) => {
        const t = Date.now();
        const jev = await hostDecide({
          vendor: "jev",
          model: JEV_MODEL,
          apiKey: openrouter!.apiKey,
          timeoutMs: 60_000,
          request: {
            state: { topic: `${it.topic}: ${TOPICS[it.topic]}`, new_statement: it.text },
            questions: {
              contradicts: { type: "boolean", instructions: CONTRADICTS, whenTrue: "It is incompatible with the topic.", whenFalse: "It is not incompatible with the topic." },
              relation: { type: "choice", instructions: "How does new_statement relate to the topic?", choices: RELATION_CHOICES },
            },
          },
        });
        const jevMs = Date.now() - t;
        const rel = jev.answers.relation?.type === "choice" ? jev.answers.relation : null;
        const p = jev.answers.contradicts?.type === "boolean" ? jev.answers.contradicts.probability : 0;
        return { it, jevBool: p, jevRel: rel?.choice ?? "?", jevRelConf: rel?.confidence ?? 0, jevMs };
      }),
    );
    const chatRows: { gpt: { relation: string; ms: number }; lite: { relation: string; ms: number } }[] = [];
    for (const it of ITEMS) chatRows.push({ gpt: await chatRelation(MAIN_MODEL, it.topic, it.text), lite: await chatRelation(CHAT_DECISION_MODEL, it.topic, it.text) });

    const contradictions = ITEMS.filter((i) => i.truth === "contradicts").length;
    const others = ITEMS.length - contradictions;
    const score = (flag: (i: number) => string) => {
      let right = 0;
      let caught = 0;
      let alarms = 0;
      ITEMS.forEach((it, i) => {
        const g = flag(i);
        if (g === it.truth) right++;
        if (it.truth === "contradicts" && g === "contradicts") caught++;
        if (it.truth !== "contradicts" && g === "contradicts") alarms++;
      });
      return { right, caught, alarms };
    };
    const variants: [string, (i: number) => string, number][] = [
      ["Jev: 3-way choice (repeats / adds / contradicts)", (i) => rows[i]!.jevRel, avg(rows.map((r) => r.jevMs))],
      ["Jev: yes/no 'contradicts' (P ≥ 0.5)", (i) => (rows[i]!.jevBool >= 0.5 ? "contradicts" : "other"), avg(rows.map((r) => r.jevMs))],
      ["gpt-oss-120b (chat, 3-way)", (i) => chatRows[i]!.gpt.relation, avg(chatRows.map((r) => r.gpt.ms))],
      ["Gemini lite (chat, 3-way)", (i) => chatRows[i]!.lite.relation, avg(chatRows.map((r) => r.lite.ms))],
    ];
    md.push(
      "## Part 2 — could a typed decision model flag contradictions?",
      "",
      `16 labelled statements against the notes' topics (${contradictions} contradictions, 4 additions, 4 restatements). This is **not** part of the merge today (plan G3).`,
      "",
      "| answerer | 3-way right | contradictions caught | false alarms (additions/repeats called contradictions) | time per statement |",
      "|---|---|---|---|---|",
      ...variants.map(([name, f, ms]) => {
        const s = score(f);
        const threeWay = name.includes("yes/no") ? "n/a" : pct(s.right, ITEMS.length);
        return `| ${name} | ${threeWay} | ${pct(s.caught, contradictions)} | ${pct(s.alarms, others)} | ${ms} ms |`;
      }),
      "",
      "| statement | truth | Jev 3-way (conf) | Jev P(contradicts) | gpt-oss | Gemini lite |",
      "|---|---|---|---|---|---|",
      ...ITEMS.map((it, i) => `| ${it.topic}: ${it.text.slice(0, 54)} | ${it.truth} | ${rows[i]!.jevRel}${rows[i]!.jevRel === it.truth ? "" : " ✗"} (${rows[i]!.jevRelConf.toFixed(2)}) | ${rows[i]!.jevBool.toFixed(2)} | ${chatRows[i]!.gpt.relation}${chatRows[i]!.gpt.relation === it.truth ? "" : " ✗"} | ${chatRows[i]!.lite.relation}${chatRows[i]!.lite.relation === it.truth ? "" : " ✗"} |`),
    );

    writeFileSync(join(OUT, "merge-conflicts-2026-10-09.md"), md.join("\n"));
    console.log(md.join("\n").slice(0, 6_000));
    expect(reply.providerId).toBe("openrouter");
  }, 600_000);
});
