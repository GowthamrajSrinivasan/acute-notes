/**
 * Updating canvas notes that came from a ChatGPT conversation, end to end, at three sizes (small, medium, large): the first chat becomes notes;
 * then the chat and a branch of it are imported again and merged into those notes. The real share-link service (branch skip included), the
 * real merge pipeline and the typed decision model's request shapes; only the models are mocks (a chat model for outline and plans, a
 * deterministic decision model standing in for Jev). What must hold at every size (`checkChatUpdate` in `__fixtures__/chatUpdateWorld.ts`):
 *
 *  - nothing the notes already had is lost: every earlier passage is still there, and nothing is proposed for removal;
 *  - nothing is duplicated: a passage the chat repeats is left out, a new one is added once;
 *  - new facts about a topic join that topic, and stay with their question; a new subject is a new section;
 *  - a statement that contradicts the notes is NOT applied: it waits as a "Needs your call" choice for the user (both versions, once each);
 *  - the same import again changes nothing;
 *  - the decision model answered the assignments (the chat fallback was never needed).
 *
 * The same scenario runs against the answers a real Jev gave when they have been recorded (`chatUpdateReplay.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { checkChatUpdate, mockJev, recordDecisions, replayDecisions, runChatUpdate, SIZES } from "./__fixtures__/chatUpdateWorld";

describe.each(Object.entries(SIZES))("a ChatGPT conversation on the canvas, updated from the chat and its branch: %s", (_name, plan) => {
  it("keeps everything that was there, adds what is new once, leaves repeats out, asks about conflicts, and a second import changes nothing", async () => {
    checkChatUpdate(plan, await runChatUpdate(plan, mockJev()));
  }, 240_000);
});

describe("recording the decision model's answers and replaying them (how a real Jev's answers are kept and re-checked offline)", () => {
  it("what was recorded answers the same scenario again, request for request, with the same result", async () => {
    const plan = SIZES.small!;
    const recorder = recordDecisions(mockJev());
    const live = await runChatUpdate(plan, recorder.provider);
    expect(recorder.log.length).toBeGreaterThan(0);
    const replay = replayDecisions(recorder.log);
    const replayed = await runChatUpdate(plan, replay.provider);
    expect(replay.misses).toEqual([]);
    checkChatUpdate(plan, replayed);
    expect(replayed.merged.changeSet!.contentSource!.text).toBe(live.merged.changeSet!.contentSource!.text);
    expect(replayed.merged.choices).toEqual(live.merged.choices);
  }, 120_000);

  it("a request that was not recorded is listed and fails the checks, never a silent guess", async () => {
    const recorder = recordDecisions(mockJev());
    await runChatUpdate(SIZES.small!, recorder.provider);
    // The medium scenario asks questions the small recording never saw.
    const replay = replayDecisions(recorder.log);
    const run = await runChatUpdate(SIZES.medium!, replay.provider);
    expect(replay.misses.length).toBeGreaterThan(0);
    expect(() => checkChatUpdate(SIZES.medium!, run)).toThrow();
  }, 120_000);
});
