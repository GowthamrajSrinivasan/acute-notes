/**
 * The ChatGPT-update scenario (`chatUpdate.test.ts`) against the answers a REAL Jev gave, recorded once by the opt-in live capture
 * (`contractTests/chatUpdateJev.contract.test.ts`) into `.ai/docs/decision-spike/data/jev-chat-update-*.json`. Offline and free: the recorded answers
 * are replayed request for request. It asserts what the code must guarantee whatever the model says (nothing lost or removed, nothing duplicated,
 * new facts where they belong, questions with their answers, a second import adds nothing twice); whether the real model found every contradiction is
 * reported by the capture, not asserted here, because a model's judgement is not fixed.
 *
 * Skipped until a recording exists. When the questions the merge asks change, the recording no longer matches: a request that was not recorded is
 * listed and fails this test; record again.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkChatUpdate, replayDecisions, runChatUpdate, SIZES, type RecordedDecision } from "./__fixtures__/chatUpdateWorld";

const DIR = join(process.cwd(), ".ai", "docs", "decision-spike", "data");
interface Recording {
  recorded: string;
  model: string;
  sizes: Record<string, { log: RecordedDecision[] }>;
}
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^jev-chat-update-.*\.json$/.test(f)) : [];
const recordings = files.map((f) => ({ file: f, data: JSON.parse(readFileSync(join(DIR, f), "utf8")) as Recording }));

describe.skipIf(!recordings.length)("a real Jev's recorded answers, replayed", () => {
  for (const { file, data } of recordings) {
    for (const [name, recorded] of Object.entries(data.sizes)) {
      it(`${file}: ${name}: the guarantees hold with the answers the real model gave`, async () => {
        const plan = SIZES[name];
        expect(plan, `unknown size ${name}`).toBeDefined();
        const replay = replayDecisions(recorded.log);
        const run = await runChatUpdate(plan!, replay.provider);
        expect(replay.misses, "requests the recording does not have: record again").toEqual([]);
        checkChatUpdate(plan!, run, { guaranteesOnly: true });
      }, 240_000);
    }
  }
});
