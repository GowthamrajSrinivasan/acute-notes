/**
 * Claim-level planning (Stage 1c) and the Stage 1 gate end to end: an update from new content → a `patch_block` (or an
 * escalation) → accepted against the card as it is on the canvas. The five gate scenarios, from the planner's side:
 * 1. single claim · 2. several claims atomically · 3. rich formatting kept · 4. concurrent modification rejected ·
 * 5. EXTENDS told from SUPERSEDES (and a contradiction escalated, never applied).
 */
import { describe, expect, it } from "vitest";
import { acceptChangeSet, type ChangeSetCanvas } from "@/ai/changes/accept";
import { parseChangeSet, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { applyClaimEdits, type ClaimEdit } from "@/ai/changes/claimPatch";
import { fingerprintContent } from "@/ai/content/fingerprint";
import type { RichContent } from "@/domain/types";
import { accepted, firstRun, response, runtimeWith, update, type Accepted } from "@/testUtils/reconcileHarness";
import { claimLevelUpdate, editedCardUpdate, planClaimPatch } from "./claimPlanner";

const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: "text" as const, text, styles });
const para = (content: string | ReturnType<typeof t>[], id = "b1"): RichContent[number] => ({ id, type: "paragraph", props: { textColor: "default" }, content });
const edits = (plan: ReturnType<typeof planClaimPatch>): ClaimEdit[] => {
  if (plan.kind !== "patch") throw new Error(`expected a patch, got ${plan.kind}: ${"reason" in plan ? plan.reason : plan.detail}`);
  return plan.edits;
};
const shown = (e: ClaimEdit) => [("range" in e.match ? e.match.text : ""), e.replacement, e.intent];

describe("planClaimPatch", () => {
  it("gate 1: one changed fact is one edit of just that word", () => {
    const plan = planClaimPatch([para("Retries happen five times. The gateway may time out.")], [para("Retries happen three times. The gateway may time out.")]);
    expect(edits(plan).map(shown)).toEqual([["five", "three", "SUPERSEDES"]]);
  });

  it("gate 2: two changed facts in one card are two edits of one patch", () => {
    const plan = planClaimPatch(
      [para("Retries happen five times. Timeouts last ten seconds.", "a"), para("Owners: payments.", "b")],
      [para("Retries happen three times. Timeouts last thirty seconds.", "a"), para("Owners: payments.", "b")],
    );
    expect(edits(plan).map(shown)).toEqual([
      ["five", "three", "SUPERSEDES"],
      ["ten", "thirty", "SUPERSEDES"],
    ]);
    expect(edits(plan).every((e) => e.blockId === "a")).toBe(true);
  });

  it("gate 3: marks outside the edit are kept; the patch reproduces the proposed content exactly", () => {
    const current = [para([t("Retries happen "), t("five", { bold: true }), t(" times. See "), t("the policy", { italic: true }), t(".")])];
    const proposed = [para([t("Retries happen "), t("three", { bold: true }), t(" times. See "), t("the policy", { italic: true }), t(".")])];
    expect(edits(planClaimPatch(current, proposed)).map(shown)).toEqual([["five", "three", "SUPERSEDES"]]);
  });

  it("gate 5: an extension is EXTENDS, a replaced value is SUPERSEDES", () => {
    const ext = planClaimPatch([para("The gateway may time out.")], [para("The gateway may time out under heavy load.")]);
    expect(edits(ext).map(shown)).toEqual([["out", "out under heavy load", "EXTENDS"]]);
    const sup = planClaimPatch([para("The timeout is 30 seconds.")], [para("The timeout is 45 seconds.")]);
    expect(edits(sup).map(shown)).toEqual([["30", "45", "SUPERSEDES"]]);
  });

  it("gate 5: a contradiction is escalated, never patched", () => {
    const plan = planClaimPatch([para("The cache is shared across regions.")], [para("The cache is not shared across regions.")]);
    expect(plan).toMatchObject({ kind: "escalate", intent: "CONTRADICTS" });
  });

  it.each([
    ["a sentence added next to a changed one only", [para("Retries happen five times.")], [para("Retries happen three times. Timeouts last ten seconds.")]],
    ["most of a long block rewritten", [para("Retries happen five times. Timeouts last ten seconds. Backoff doubles each time. Logs are kept seven days.")], [para("Retries happen three times. Timeouts last thirty seconds. Backoff triples each time. Logs are kept seven days.")]],
    ["a block added", [para("Retries happen five times.")], [para("Retries happen five times."), para("More.", "b2")]],
    ["only formatting changed", [para([t("Retries happen five times.")])], [para([t("Retries happen five times.", { bold: true })])]],
    ["a new mark on the changed word", [para("Retries happen five times.")], [para([t("Retries happen "), t("three", { bold: true }), t(" times.")])]],
    ["a code block", [{ type: "codeBlock" as const, content: "retries = 5" }], [{ type: "codeBlock" as const, content: "retries = 3" }]],
  ])("falls back to the whole-block update: %s", (_why, current, proposed) => {
    expect(planClaimPatch(current as RichContent, proposed as RichContent).kind).toBe("rewrite");
  });

  it("a page whose title changed is rewritten; one whose title stayed is patched", () => {
    const [c, p] = [[para("Retries happen five times.")], [para("Retries happen three times.")]];
    expect(planClaimPatch(c, p, { current: "Limits", proposed: "Retry limits" }).kind).toBe("rewrite");
    expect(planClaimPatch(c, p, { current: "Limits", proposed: "Limits" }).kind).toBe("patch");
  });
});

describe("planClaimPatch — sentences added or removed (Stage 1 gaps)", () => {
  /** Applies the plan and returns its edits: the patch must reproduce the proposed text exactly. */
  const via = (before: string, after: string) => {
    const plan = planClaimPatch([para(before)], [para(after)]);
    const out = applyClaimEdits([para(before)], edits(plan));
    if (!out.ok) throw new Error(out.detail);
    expect(out.content[0]!.content).toBe(after);
    return edits(plan);
  };

  it("a sentence added at the end is one NEW edit beside the sentence before it", () => {
    expect(via("Retries happen five times.", "Retries happen five times. Timeouts last ten seconds.").map(shown)).toEqual([["times.", "times. Timeouts last ten seconds.", "NEW"]]);
  });

  it("a sentence added at the start, or in the middle", () => {
    expect(via("Retries happen five times.", "Each call is logged. Retries happen five times.").map((e) => e.intent)).toEqual(["NEW"]);
    expect(via("Retries happen five times. Timeouts last ten seconds.", "Retries happen five times. Backoff doubles each time. Timeouts last ten seconds.")).toHaveLength(1);
  });

  it("several sentences added together are one edit", () => {
    expect(via("Retries happen five times.", "Retries happen five times. Backoff doubles each time. Jitter spreads the retries.")).toHaveLength(1);
  });

  it("a sentence removed is an edit that removes exactly it, in the middle or at the end", () => {
    expect(via("Retries happen five times. Backoff doubles each time. Timeouts last ten seconds.", "Retries happen five times. Timeouts last ten seconds.").map(shown)).toEqual([["Backoff doubles each time. ", "", undefined]]);
    expect(via("Retries happen five times. Timeouts last ten seconds.", "Retries happen five times.").map(shown)).toEqual([[" Timeouts last ten seconds.", "", undefined]]);
  });

  it("a changed sentence, a removed one and an added one in the same block", () => {
    const got = via(
      "Retries happen five times. Backoff doubles each time. Timeouts last ten seconds.",
      "Retries happen three times. Timeouts last ten seconds. Each call is logged.",
    );
    expect(got.map((e) => e.intent ?? "removal").sort()).toEqual(["NEW", "SUPERSEDES", "removal"]);
  });

  it("a contradiction among added and removed sentences still escalates", () => {
    expect(planClaimPatch([para("The cache is shared across regions. Keys expire hourly.")], [para("The cache is not shared across regions. Keys expire hourly. Writes are batched.")])).toMatchObject({
      kind: "escalate",
      intent: "CONTRADICTS",
    });
  });
});

describe("editedCardUpdate: sentences added to or removed from an edited card", () => {
  const object = (wording: string) => ({ objectId: "el_1", stableNodeKey: "k", current: "c_user", rich: { content: [para(wording)] } });
  const update = (text: string): Extract<ProposedChange, { kind: "update_block" }> => ({ kind: "update_block", target: "el_1", content: [para(text)], stableNodeKey: "k" });
  const base = { content: [para("Retries happen five times. Backoff doubles each time.")] };
  const USER = "Retries happen five times, per the SRE runbook. Backoff doubles each time.";
  const merged = (r: ReturnType<typeof editedCardUpdate>) => {
    const patch = (r as { change: Extract<ProposedChange, { kind: "patch_block" }> }).change;
    expect(patch).toMatchObject({ kind: "patch_block", onEditedCard: true });
    const out = applyClaimEdits([para(USER)], patch.edits);
    return out.ok ? out.content[0]!.content : out.detail;
  };

  it("a sentence the source adds is merged into the user's wording", () => {
    expect(merged(editedCardUpdate(update("Retries happen five times. Backoff doubles each time. Jitter spreads the retries."), object(USER), base))).toBe(`${USER} Jitter spreads the retries.`);
  });

  it("a sentence the source removes is removed from the user's wording, their own clause kept", () => {
    expect(merged(editedCardUpdate(update("Retries happen five times."), object(USER), base))).toBe("Retries happen five times, per the SRE runbook.");
  });

  it("a removed sentence the user reworded can't be placed exactly: the conflict card", () => {
    const r = editedCardUpdate(update("Retries happen five times."), object("Retries happen five times. Backoff grows each time."), base);
    expect(r).toMatchObject({ conflict: { target: "el_1" } });
  });
});

describe("claimLevelUpdate", () => {
  const object = { objectId: "el_1", stableNodeKey: "k", current: "c_now", rich: { content: [para("Retries happen five times.")] } };
  const update = (text: string): Extract<ProposedChange, { kind: "update_block" }> => ({ kind: "update_block", target: "el_1", content: [para(text)], stableNodeKey: "k" });

  it("a localisable update becomes a patch against the card's current fingerprint", () => {
    expect(claimLevelUpdate(update("Retries happen three times."), object)).toMatchObject({ change: { kind: "patch_block", target: "el_1", expectedFingerprint: "c_now", stableNodeKey: "k" } });
  });

  it("a contradiction is a conflict with its escalation and a Keep mine", () => {
    const r = claimLevelUpdate(update("Retries never happen five times."), object);
    expect(r).toMatchObject({ conflict: { target: "el_1", escalation: { intent: "CONTRADICTS" }, keep: { kind: "rebaseline" } } });
  });

  it("without the card's content the update stays as it was", () => {
    const u = update("Retries happen three times.");
    expect(claimLevelUpdate(u, { ...object, rich: undefined })).toEqual({ change: u });
  });
});

// ---------------------------------------------------------------------------
// End to end: update from new content → accept on a canvas

const DOC = "# Service\n\n## Limits\n\nRetries happen five times. Timeouts last ten seconds.\n\n## Owners\n\nPayments team.\n";
const LIMITS = "Service › Limits#text0";

/** The card for Limits as the user sees it: rich runs, a mounted block id and a colour none of which change its fingerprint. */
const LIMITS_CARD: RichContent = [
  { id: "blk_limits", type: "paragraph", props: { textColor: "blue" }, content: [t("Retries happen "), t("five", { textColor: "red" }), t(" times. Timeouts last ten seconds.")] },
];

async function acceptedWithCard(): Promise<{ a: Accepted; runtime: ReturnType<typeof runtimeWith>["runtime"] }> {
  const { runtime } = runtimeWith(() => response("never"));
  const a = accepted(await firstRun(DOC, runtime));
  const limits = a.existing.find((o) => o.stableNodeKey === LIMITS)!;
  // The card's live content: same canonical text as AI wrote, so it's still untouched (current = baseline).
  expect(fingerprintContent(LIMITS_CARD)).toBe(limits.baseline);
  limits.rich = { content: LIMITS_CARD };
  return { a, runtime };
}

/** A canvas holding the Limits card with `live` content; records what the writer is given. */
function canvasWith(a: Accepted, live: RichContent) {
  const written: ProposedChange[] = [];
  const limits = a.existing.find((o) => o.stableNodeKey === LIMITS)!;
  const canvas: ChangeSetCanvas = {
    boxOf: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    contentOf: (id) => (id === limits.objectId ? { content: live, fingerprint: fingerprintContent(live) } : null),
    write: (_set, changes) => {
      written.push(...changes);
      return new Map();
    },
  };
  return { canvas, written, history: { record: (f: () => void) => (f(), 1) } };
}

describe("Stage 1 gate — end to end", () => {
  it("1 + 3: one changed fact is proposed as a patch; accepted, only that word changes and the card's id, colours and runs stay", async () => {
    const { a, runtime } = await acceptedWithCard();
    const r = await update(a, DOC.replace("five times", "three times"), runtime);
    const set = parseChangeSet(r.changeSet) as ChangeSet;
    expect(set.changes.map((c) => c.kind)).toEqual(["patch_block"]);
    const { canvas, written, history } = canvasWith(a, LIMITS_CARD);
    const result = acceptChangeSet(set, canvas, history);
    expect(result.dropped).toEqual([]);
    expect(written).toEqual([
      {
        kind: "update_block",
        target: a.existing.find((o) => o.stableNodeKey === LIMITS)!.objectId,
        stableNodeKey: LIMITS,
        content: [{ ...LIMITS_CARD[0], content: [t("Retries happen "), t("three", { textColor: "red" }), t(" times. Timeouts last ten seconds.")] }],
      },
    ]);
  });

  it("2: two changed facts in the card are one atomic patch", async () => {
    const { a, runtime } = await acceptedWithCard();
    const r = await update(a, DOC.replace("five times", "three times").replace("ten seconds", "thirty seconds"), runtime);
    const patch = r.changeSet!.changes[0] as Extract<ProposedChange, { kind: "patch_block" }>;
    expect(patch.edits.map((e) => e.replacement)).toEqual(["three", "thirty"]);
    const { canvas, written, history } = canvasWith(a, LIMITS_CARD);
    acceptChangeSet(r.changeSet!, canvas, history);
    expect(JSON.stringify(written)).toContain("Timeouts last thirty seconds.");
  });

  it("4: the card changed after the update was planned — the patch is rejected whole and reported, nothing is written", async () => {
    const { a, runtime } = await acceptedWithCard();
    const r = await update(a, DOC.replace("five times", "three times"), runtime);
    const edited: RichContent = [{ ...LIMITS_CARD[0]!, content: [t("Retries happen "), t("five", { textColor: "red" }), t(" times. Timeouts last ten seconds, then fail.")] }];
    const { canvas, written, history } = canvasWith(a, edited);
    const result = acceptChangeSet(r.changeSet!, canvas, history);
    expect(written).toEqual([]);
    expect(result.stepId).toBeNull();
    expect(result.dropped).toMatchObject([{ reason: "patch_rejected", rejection: { code: "stale" } }]);
  });

  it("5: a contradiction from the source is escalated for a decision, never applied by Accept all", async () => {
    const { a, runtime } = await acceptedWithCard();
    const r = await update(a, DOC.replace("Timeouts last ten seconds.", "Timeouts never last ten seconds."), runtime);
    expect(r.changeSet!.changes).toEqual([]);
    expect(r.changeSet!.conflicts).toMatchObject([{ stableNodeKey: LIMITS, escalation: { intent: "CONTRADICTS" }, apply: { kind: "update_block" } }]);
    expect(() => parseChangeSet(r.changeSet)).not.toThrow();
  });

  it("claimPatches: false keeps the whole-block update", async () => {
    const { a, runtime } = await acceptedWithCard();
    const { updateFromNewContent } = await import("./update");
    const { context, parse } = await import("@/testUtils/reconcileHarness");
    const r = await updateFromNewContent({ ...a, text: DOC.replace("five times", "three times"), operationId: "op_2", title: "Update", context }, runtime, { parseMarkdown: parse, claimPatches: false });
    expect(r.changeSet!.changes.map((c) => c.kind)).toEqual(["update_block"]);
  });

  it("no-op: unchanged content proposes nothing (no duplicate patch)", async () => {
    const { a, runtime } = await acceptedWithCard();
    expect((await update(a, DOC, runtime)).changeSet).toBeNull();
  });
});
