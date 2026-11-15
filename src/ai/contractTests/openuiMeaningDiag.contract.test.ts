/**
 * Meaning-check diagnosis of the OpenUI v2 cards (`.ai/docs/openui-live-2026-11-13.md`, "Step 4"; user decision
 * 2026-11-13: one bounded run, ≤ $0.02, on the saved outputs).
 *
 * Question: can the model check catch what the deterministic rules miss? Specifically:
 *   1. a condition separated from the claim it qualifies,
 *   2. a missing exception or caveat,
 *   3. a missing critical fact in otherwise correct text,
 *   4. wording the cited units don't support.
 *
 * Items: 24 cards from the live v2 replies — every rule-flagged card that cites something among them, the cards the
 * golden assertions point at, and unflagged cards — each labelled by hand against the source (labels are
 * PROVISIONAL, by the session that built this; not golden-reviewed). Uncited cards are left out: they're a citation
 * failure the rules already flag, and the check can't judge a card without its source.
 *
 * Two variants, same items, same model:
 *   A. as shipped: SOURCE = the card's cited units only (`SEMANTIC_CHECK_SYSTEM`);
 *   B. with context: SOURCE also lists the section's other condition-bearing units as CONTEXT, plus one rule.
 *
 * Costs money: REFUSES unless `OPENUI_MEANING_APPROVED_BY` is set. Cap `RUN_CAP_USD` (default 0.02), at gemini-2.5-flash
 * list prices; B is skipped if A's measured cost says B would pass the cap.
 *
 *   OPENUI_MEANING_APPROVED_BY="<name>" ACUTE_TEST_OPENROUTER_MODEL=google/gemini-2.5-flash \
 *     npx vitest run --config vitest.contract.config.ts src/ai/contractTests/openuiMeaningDiag.contract.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { parseSemanticCheckReply, semanticCheckRequest, SEMANTIC_CHECK_SYSTEM, type SemanticCheckItem } from "@/ai/fidelity/semanticCheck";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { checkGeneratedCards } from "@/ai/openui/notesCheck";
import { annotateUnits, cardOf, splitCards, type GeneratedCard } from "@/ai/openui/notesTask";
import { directProvider, resolveConnection } from "./liveProvider";

const APPROVED_BY = (process.env.OPENUI_MEANING_APPROVED_BY ?? "").trim();
const CAP = Number(process.env.RUN_CAP_USD ?? 0.02);
const PRICE_IN = 0.3;
const PRICE_OUT = 2.5;
const EXP = join(process.cwd(), "evaluation", "knowledge-notes", "experiments", "openui-2026-11-13");

type Category = "condition_separated" | "caveat_missing" | "fact_missing" | "unsupported_wording";
/** Hand labels (provisional): the problem categories a card has; [] = clean. */
const LABELS: Record<string, Record<string, Category[]>> = {
  "kn-01-idempotency-keys": {
    g1: ["unsupported_wording"], // "prevent duplicate operations" — wider than u1; u9 says it's no general guarantee
    g2: ["condition_separated"], // stored result returned unconditionally; the window (u6/u7) and the different-request rule (u8) are elsewhere
    g3: [],
    g4: ["unsupported_wording", "condition_separated"], // "can safely retry": "safely" added, the window left out
    g5: [],
    g6: [],
    g7: [],
    g8: [], // keeps "must reject"; the rule flag (dropped "rather than return the old result") is a false alarm
    g9: [],
  },
  "kn-02-edge-cache-invalidation": {
    g7: [], // rule-flagged caveat; the card keeps it
    g9: ["caveat_missing"], // drops "nothing the origin does will shorten that wait" (u11)
    g10: [],
    g14: [], // rule-flagged caveat; the card keeps "not applied simultaneously"
    g23: [],
    g26: [],
    g27: [], // rule-flagged caveat; the card keeps it
    g31: ["condition_separated", "fact_missing"], // serves the expired copy with no bound: "at most 60 seconds" (u41) is on another card; drops max-age=300, stale-while-revalidate=60
    g33: [],
    g34: [],
    g35: [],
    g37: [],
    g41: ["caveat_missing"], // drops "they still need a TTL, a purge or both" (u50)
    g47: ["caveat_missing"], // drops "when the origin struggles" (u62)
    g48: [],
  },
};

const CONTEXT_RULE =
  "Some items also give CONTEXT: other statements from the same section of the source. Answer not_supported when the card states a claim as general or unconditional that the CONTEXT limits (a time window, a bound, an exception, a requirement, or a statement that something does not help or cannot be shortened) and the card leaves that limit out. Do not penalise a card for leaving out CONTEXT that does not limit its own claim.";

interface Item extends SemanticCheckItem {
  caseId: string;
  key: string;
  truth: Category[];
  ruleFlagged: boolean;
}

async function buildItems(withContext: boolean): Promise<Item[]> {
  const items: Item[] = [];
  for (const [caseId, labels] of Object.entries(LABELS)) {
    const units: SourceUnit[] = (await splitUnits(readFileSync(join(process.cwd(), "evaluation", "knowledge-notes", "cases", caseId, "source.md"), "utf8").replace(/\r\n?/g, "\n"))).units;
    const byId = new Map(units.map((u) => [u.id, u]));
    const critical = new Set(annotateUnits(units).filter((u) => u.critical).map((u) => u.id));
    const known = new Set(units.map((u) => u.id));
    const cards = splitCards(readFileSync(join(EXP, `${caseId}.openui-v2.txt`), "utf8")).flatMap((b, i) => cardOf(b, i, known) ?? []) as GeneratedCard[];
    const check = checkGeneratedCards(cards, units);
    for (const [key, truth] of Object.entries(labels)) {
      const card = cards.find((c) => c.key === key);
      if (!card || !card.cites.length) throw new Error(`${caseId} ${key}: missing or uncited`);
      const cited = card.cites.map((u) => byId.get(u)!).filter(Boolean);
      const topics = new Set(cited.map((u) => u.topic));
      const context = withContext ? units.filter((u) => critical.has(u.id) && topics.has(u.topic) && !card.cites.includes(u.id)) : [];
      const source = cited.map((u) => u.text).join(" ") + (context.length ? `\nCONTEXT: ${context.map((u) => u.text).join(" ")}` : "");
      items.push({
        ref: `c${items.length + 1}`,
        source,
        card: [card.title, card.body, card.detail].filter(Boolean).join(". "),
        caseId,
        key,
        truth,
        ruleFlagged: !!check.reviews[key]?.reasons.length,
      });
    }
  }
  return items;
}

function score(items: Item[], verdicts: Map<string, string>) {
  const flagged = (i: Item) => {
    const v = verdicts.get(i.ref);
    return v === "partly" || v === "not_supported";
  };
  const problem = (i: Item) => i.truth.length > 0;
  const tp = items.filter((i) => problem(i) && flagged(i)).length;
  const fn = items.filter((i) => problem(i) && !flagged(i)).length;
  const fp = items.filter((i) => !problem(i) && flagged(i)).length;
  const tn = items.filter((i) => !problem(i) && !flagged(i)).length;
  const byCategory: Record<string, { caught: number; of: number }> = {};
  for (const i of items) for (const c of i.truth) {
    const e = (byCategory[c] ??= { caught: 0, of: 0 });
    e.of++;
    if (flagged(i)) e.caught++;
  }
  return { tp, fn, fp, tn, unanswered: items.filter((i) => !verdicts.has(i.ref)).length, byCategory };
}

describe.skipIf(!APPROVED_BY)("OpenUI v2 meaning-check diagnosis (live, approved)", () => {
  it("runs A (cited only) and B (with section context) within the cap", { timeout: 300_000 }, async () => {
    const connection = resolveConnection("openrouter");
    expect(connection, "OpenRouter credentials in .env.local").toBeTruthy();
    const provider = directProvider("openrouter", connection!);
    let spent = 0;
    const report: Record<string, unknown> = { approvedBy: APPROVED_BY, at: new Date().toISOString(), model: connection!.model, cap: CAP, labels: "provisional, hand-labelled 2026-11-13" };

    const run = async (variant: "A" | "B") => {
      const items = await buildItems(variant === "B");
      const system = variant === "B" ? `${SEMANTIC_CHECK_SYSTEM}\n${CONTEXT_RULE}` : SEMANTIC_CHECK_SYSTEM;
      const prompt = semanticCheckRequest(items);
      // Estimate before calling (≈2 chars per input token, as path A measured on this content; ≈60 output tokens per item)
      // and stop if it would pass the cap. The approval marker is an audit label, never a way around the cap.
      const estimate = (((system.length + prompt.length) / 2) * PRICE_IN + items.length * 60 * PRICE_OUT) / 1e6;
      if (spent + estimate > CAP) throw new Error(`variant ${variant}: estimated $${estimate.toFixed(4)} would pass the cap ($${spent.toFixed(4)} spent, cap $${CAP})`);
      const started = Date.now();
      const res = await provider.generate({ task: "check_card_meaning", systemPrompt: system, prompt, temperature: 0 });
      const latencyMs = Date.now() - started;
      const usd = ((res.usage.promptTokens ?? (system.length + prompt.length) / 3) * PRICE_IN + (res.usage.completionTokens ?? res.text.length / 3) * PRICE_OUT) / 1e6;
      spent += usd;
      const { answers, missing } = parseSemanticCheckReply(res.text, items.map((i) => i.ref));
      const verdicts = new Map(answers.map((a) => [a.ref, a.verdict] as const));
      const reasons = new Map(answers.map((a) => [a.ref, a.reason] as const));
      return {
        estimateUsd: Number(estimate.toFixed(5)),
        latencyMs,
        promptChars: system.length + prompt.length,
        usage: res.usage,
        usd: Number(usd.toFixed(5)),
        missing,
        score: score(items, verdicts),
        rules: score(items, new Map(items.filter((i) => i.ruleFlagged).map((i) => [i.ref, "not_supported"] as const))),
        items: items.map((i) => ({ case: i.caseId.slice(0, 5), key: i.key, truth: i.truth, rule: i.ruleFlagged, verdict: verdicts.get(i.ref) ?? null, reason: reasons.get(i.ref) ?? "" })),
      };
    };

    // Partial results are kept: the report is written after each variant, and on failure. No automatic re-runs.
    const save = () => writeFileSync(join(EXP, "meaning-check-2026-11-13.json"), `${JSON.stringify({ ...report, spentUsd: Number(spent.toFixed(5)) }, null, 2)}\n`);
    let a: Awaited<ReturnType<typeof run>>;
    try {
      a = await run("A");
    } catch (e) {
      report.A = `failed: ${String(e)}`;
      save();
      throw e;
    }
    report.A = a;
    save();
    // B's prompt is longer (context): don't start it if its estimate would pass the cap (run() checks again).
    const bEstimate = a.usd * 1.8;
    if (spent + bEstimate <= CAP) {
      try {
        report.B = await run("B");
      } catch (e) {
        report.B = `failed: ${String(e)}`;
      }
    } else report.B = `skipped: spent ${spent.toFixed(4)}, B estimated ${bEstimate.toFixed(4)}, cap ${CAP}`;
    save();
    expect(spent).toBeLessThanOrEqual(CAP + 0.005);
  });
});
