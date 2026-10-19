/**
 * Topic merge, G0 (`.ai/docs/chat-share-import-plan.md` §5.2): the gaps the core merge closes, written down before
 * the fix.
 *
 * - G1 (topic identity, `topicIds.ts`) is done: its cases run as plain tests.
 * - `it.todo` — needs an API that doesn't exist yet (merge mode, contributing sources, history rules); written as the
 *   acceptance criterion the step must meet.
 *
 * A renamed section with genuinely different content must still be remove + add: that guard is
 * "a deleted section is a proposed removal …" in `update.test.ts`, and must keep passing through G1.
 */
import { describe, expect, it } from "vitest";
import { accepted, acceptUpdate, firstRun, modelReply, response, runtimeWith, update } from "@/testUtils/reconcileHarness";

const LOCAL = "# Launch\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out.\n\n## Owners\n\nPayments team.\n";
const TEN = `Intro prose, no structure.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nBody of part ${i}.`).join("\n\n")}`;

describe("G1 — topic identity is not tied to heading text", () => {
  it("local tier: renaming a heading over unchanged content updates in place, never remove + add", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await update(a, LOCAL.replace("## Owners", "## Team"), runtime);
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds).not.toContain("remove");
    expect(kinds).not.toContain("create_block");
    // The body ("Payments team.") is the same object; only the heading changes.
    expect(kinds).toEqual(["update_block"]);
    expect(JSON.stringify(r.changeSet!.changes[0])).toContain("Team");
    expect(r.changeSet!.contentSource!.pathIds).toEqual({ "Launch › Team": "Launch › Owners" });
  });

  it("AI tier: renaming a section heading over unchanged content keeps its objects and its frame", async () => {
    const { runtime } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await update(a, TEN.replace("## Part 6", "## Section six"), runtime);
    const kinds = r.changeSet!.changes.map((c) => c.kind);
    expect(kinds).not.toContain("remove");
    expect(kinds).not.toContain("create_frame");
    expect(r.reanalyzedUnits).toEqual(["Part 6"]); // re-analysed under its id, with its current representation
  });

  it("local tier: the identity survives later versions — rename, accept, then edit the renamed section", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const renamed = LOCAL.replace("## Owners", "## Team");
    const a2 = acceptUpdate(a, (await update(a, renamed, runtime)).changeSet!);
    const r = await update(a2, renamed.replace("Payments team.", "Payments and Risk teams."), runtime);
    expect(r.changeSet!.changes.map((c) => c.kind)).toEqual(["update_block"]);
    expect(JSON.stringify(r.changeSet!.changes[0])).toContain("Risk teams");
    expect(r.changeSet!.contentSource!.pathIds).toEqual({ "Launch › Team": "Launch › Owners" });
  });

  it("local tier: an unchanged re-send after a rename proposes nothing", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const renamed = LOCAL.replace("## Owners", "## Team");
    const a2 = acceptUpdate(a, (await update(a, renamed, runtime)).changeSet!);
    expect((await update(a2, renamed, runtime)).changeSet).toBeNull();
  });

  it("AI tier: rename, accept, then edit — still one section re-analysed, nothing removed", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const renamed = TEN.replace("## Part 6", "## Section six");
    const a2 = acceptUpdate(a, (await update(a, renamed, runtime)).changeSet!);
    spy.mockClear();
    const r = await update(a2, renamed.replace("Body of part 6.", "Body of part 6, now rewritten."), runtime);
    expect(r.reanalyzedUnits).toEqual(["Part 6"]);
    expect(r.reusedUnits).toHaveLength(10);
    expect(r.changeSet!.changes.map((c) => c.kind)).not.toContain("remove");
    expect(spy.mock.calls.filter((c) => c[0]!.task === "generate_visual_plan")).toHaveLength(1);
  });

  it("a renamed heading over different content is still a different section (remove + add)", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await update(a, LOCAL.replace("## Owners\n\nPayments team.", "## Rollout\n\nOne region first."), runtime);
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toHaveLength(2);
    expect(r.changeSet!.contentSource!.pathIds).toBeUndefined();
  });
});

/**
 * G2.1 is done in `merge/merge.test.ts`: content filed under existing topics (local and AI assignment) with no new
 * frame, repeats left out, new topics framed as new sections, and no false conflict after a merge (one source by
 * design, so "contributing sources" aren't needed). G2.2 (the Visualize option) is checked in the real app by
 * `e2e/local/topicMerge.local.spec.ts`; G2.3 (new parts of an outlined source generated on their own) by `visualize/outlined.test.ts`; and against a live model by `e2e/ai/topicMerge.spec.ts` (filed by topic, repeats with no call, a rewording changes nothing, a new topic outlined alone, a passage another topic already says left out). Cross-topic repeats: `merge/compose.test.ts`. G2 is done.
 */
describe("G2b — merge into notes written by hand", () => {
  it.todo("frames and objects without a source are loaded as topics and items in the ledger");
  it.todo("a merge into an object written by hand is always a conflict ('Apply update' / 'Keep mine'), never a clean update");
});

/**
 * G3.1 + G3.2 are done: choices are `[!choice]` callouts in the source text, drawn by code (`history/choiceNodes.ts`):
 * box + option cards + dotted `option_of` links, the box turning into the chosen option and a "Changed over time" page
 * (`history/choiceNodes.test.ts`, `e2e/local/choices.local.spec.ts`); a merge whose content contradicts a topic opens
 * one (`merge/merge.test.ts`; live: `e2e/ai/choices.spec.ts`), or adds an option to the open box about that statement, or reopens a
 * choice the user made (`merge/compose.test.ts`). Callouts never reach the model or the safety net.
 * G3.3 is done: a document that changes its mind keeps the later statement; the earlier one is left out of what is drawn and kept on
 * its section's "Changed over time" page (`history/revisions.ts`, `revisionsFlow.test.ts`; live: `e2e/ai/revisions.spec.ts`, with
 * and without Jev). Still open:
 */
describe("G3 — sources with history", () => {
  it.todo("C1 (chats): an assistant suggestion the user never confirmed is 'proposed'; across conversations 'agreed' beats 'proposed' without a box, the proposed side shown as 'Also considered'");
  it.todo("C1 (chats): within one conversation or along a branch, the later statement wins by time; only different conversations or sibling branches open a choice");
});
