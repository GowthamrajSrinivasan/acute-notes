/**
 * Live capture of what the REAL Jev answers in the ChatGPT-update scenario (`ingest/__fixtures__/chatUpdateWorld.ts`), so the guarantees can be
 * re-checked offline with its real answers (`ingest/chatUpdateReplay.test.ts`) and what the mock stand-in cannot tell us can be seen: does it find the
 * contradictions, how sure is it, does it ever hand the merge to the chat task.
 *
 * Only the decision model is live: the outline, plan and analysis calls are the test's mock chat model, so the cost is Jev's alone (about $0.042 per
 * million input tokens; a per-part request is roughly 3 to 10 thousand tokens). Synthetic text only: no real notes or chats leave the machine.
 * Hard spend cap, zero retries, stops at the first failed request. The merge's own requests are replayed byte for byte, so the recording matches.
 *
 * Approval-gated and never part of `npm test`:
 *   CHAT_UPDATE_JEV_APPROVED=1 [CHAT_UPDATE_JEV_SIZES=small,medium] [CHAT_UPDATE_JEV_CAP_USD=0.03] npx vitest run --config vitest.contract.config.ts chatUpdateJev
 * Default sizes are small and medium; `large` (about 40 parts, a few cents) only when asked for.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionProvider } from "@/ai/decisions/types";
import { DECISION_ENDPOINTS, jevRequestBody, parseDecisionResponse } from "@/ai/host/decisions/wire";
import { checkChatUpdate, recordDecisions, runChatUpdate, SIZES, type RecordedDecision } from "../ingest/__fixtures__/chatUpdateWorld";
import { JEV_MODEL, openrouter } from "./spikeUtil";

const CAP_USD = Number(process.env.CHAT_UPDATE_JEV_CAP_USD ?? 0.03);
/** Assumed worst case for one request before it is sent (about 16k tokens at $0.042/M), used by the spend guard until real costs are known. */
const PER_REQUEST_GUARD_USD = 0.0007;
const SIZE_NAMES = (process.env.CHAT_UPDATE_JEV_SIZES ?? "small,medium").split(",").map((s) => s.trim()).filter((s) => s in SIZES);
const OUT = join(process.cwd(), ".ai", "docs", "decision-spike", "data", `jev-chat-update-${new Date().toISOString().slice(0, 10)}.json`);

describe.skipIf(process.env.CHAT_UPDATE_JEV_APPROVED !== "1" || !openrouter)("ChatGPT update with the real Jev (live)", () => {
  it("records Jev's answers at each approved size and reports what it found", async () => {
    let spent = 0;
    let requests = 0;
    const live: DecisionProvider = {
      id: "openrouter",
      name: "Jev",
      model: JEV_MODEL,
      decide: async (request) => {
        if (spent + PER_REQUEST_GUARD_USD > CAP_USD) throw new Error(`Spend guard: $${spent.toFixed(5)} spent, one more request would approach the $${CAP_USD} cap. Stopping.`);
        requests++;
        // No retries: a failure is thrown, the runtime falls back to the chat task for it, and the size is reported as failed.
        const res = await fetch(DECISION_ENDPOINTS.jev!, {
          method: "POST",
          headers: { authorization: `Bearer ${openrouter!.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(jevRequestBody(JEV_MODEL, request)),
          signal: AbortSignal.timeout(60_000),
        });
        const json = (await res.json().catch(() => null)) as { usage?: { cost?: number } } | null;
        spent += typeof json?.usage?.cost === "number" ? json.usage.cost : PER_REQUEST_GUARD_USD;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseDecisionResponse("jev", JEV_MODEL, json);
      },
    };

    const sizes: Record<string, { requests: number; spentUsd: number; log: RecordedDecision[]; report: Record<string, unknown>; failure?: string }> = {};
    try {
      for (const name of SIZE_NAMES) {
        const plan = SIZES[name]!;
        const before = { spent, requests };
        const recorder = recordDecisions(live);
        const run = await runChatUpdate(plan, recorder.provider);
        let failure: string | undefined;
        try {
          checkChatUpdate(plan, run); // everything, including the model-dependent checks: a failure is what we want to see, not hide
        } catch (err) {
          failure = err instanceof Error ? err.message.split("\n")[0] : String(err);
        }
        sizes[name] = {
          requests: requests - before.requests,
          spentUsd: Number((spent - before.spent).toFixed(5)),
          log: recorder.log,
          failure,
          report: {
            conflictsFound: run.merged.choices.length,
            conflictsExpected: plan.contradict.length,
            chatTaskAsked: run.chatTasks.filter((c) => c.task === "assign_to_topics").length,
            notices: run.merged.notices,
            secondImportChanges: run.again.changeSet ? run.again.changeSet.changes.length : 0,
          },
        };
        console.log(`${name}: ${requests - before.requests} requests, $${(spent - before.spent).toFixed(5)}, conflicts ${run.merged.choices.length}/${plan.contradict.length}, ${failure ? `CHECK FAILED: ${failure}` : "all checks passed"}`);
      }
    } finally {
      mkdirSync(join(OUT, ".."), { recursive: true });
      writeFileSync(OUT, `${JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), model: JEV_MODEL, capUsd: CAP_USD, spentUsdReported: Number(spent.toFixed(5)), requests, sizes }, null, 2)}\n`);
    }
    expect(Object.keys(sizes)).toEqual(SIZE_NAMES);
  }, 900_000);
});
