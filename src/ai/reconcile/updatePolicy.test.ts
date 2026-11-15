/**
 * Stage 1e (intelligent-update-engine-plan): the update policy end to end over the pure pipeline — locks, edited cards,
 * the two settings, contradictions under every setting, and the baseline after a patch onto an edited card (R5). Mock
 * AI only (the local tier never calls a model).
 */
import { describe, expect, it } from "vitest";
import { acceptChangeSet, type ChangeSetCanvas } from "@/ai/changes/accept";
import { parseChangeSet, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { fingerprintContent } from "@/ai/content/fingerprint";
import type { SceneElement } from "@/domain/canvas/adapter";
import { withLock } from "@/domain/canvas/lock";
import type { RichContent } from "@/domain/types";
import { accepted, context, firstRun, parse, response, runtimeWith, type Accepted } from "@/testUtils/reconcileHarness";
import type { ExistingObject } from "./classify";
import { existingObjects } from "./existing";
import { updateFromNewContent, type UpdateOptions } from "./update";
import { lockedNotice, skippedNote } from "./updatePolicy";

const LIMITS_TEXT = "Retries happen five times. Timeouts last ten seconds.";
const DOC = `# Service\n\n## Limits\n\n${LIMITS_TEXT}\n\n## Owners\n\nPayments team.\n`;
const LIMITS = "Service › Limits#text0";
const OWNERS = "Service › Owners#text0";
/** The Limits card as the user reworded it: a clause of their own, the facts left as they were. */
const USER_WORDING = "Retries happen five times, per the SRE runbook. Timeouts last ten seconds.";

const para = (content: string): RichContent => [{ id: "blk_limits", type: "paragraph", props: { textColor: "blue" }, content }];
const { runtime } = runtimeWith(() => response("never"));

async function setup(): Promise<Accepted> {
  const a = accepted(await firstRun(DOC, runtime));
  const limits = a.existing.find((o) => o.stableNodeKey === LIMITS)!;
  expect(fingerprintContent(para(LIMITS_TEXT))).toBe(limits.baseline); // the card shows exactly what AI wrote
  limits.rich = { content: para(LIMITS_TEXT) };
  return a;
}

const card = (a: Accepted, key = LIMITS) => a.existing.find((o) => o.stableNodeKey === key)!;
/** The user reworded the Limits card: its content no longer matches the baseline. */
function edit(a: Accepted, wording = USER_WORDING): Accepted {
  const c = card(a);
  c.rich = { content: para(wording) };
  c.current = fingerprintContent(para(wording));
  return a;
}
const lock = (a: Accepted, how: ExistingObject["locked"], keys = [LIMITS]) => {
  for (const k of keys) card(a, k).locked = how;
  return a;
};
const run = (a: Accepted, text: string, options: UpdateOptions = {}) =>
  updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, runtime, { parseMarkdown: parse, ...options });

/** Accepts on a canvas whose Limits card holds `live`; returns what was written. */
function accept(a: Accepted, set: ChangeSet, live: RichContent) {
  const written: ProposedChange[] = [];
  const target = card(a).objectId;
  const canvas: ChangeSetCanvas = {
    boxOf: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    contentOf: (id) => (id === target ? { content: live, fingerprint: fingerprintContent(live) } : null),
    write: (_s, changes) => (written.push(...changes), new Map()),
  };
  const result = acceptChangeSet(parseChangeSet(set), canvas, { record: (f: () => void) => (f(), 1) });
  return { written, result };
}
const patchOf = (set: ChangeSet | null) => set?.changes.find((c): c is Extract<ProposedChange, { kind: "patch_block" }> => c.kind === "patch_block");

describe("Stage 1e — Lock", () => {
  it("a locked card is skipped: no update, no conflict, and the update says so", async () => {
    const r = await run(lock(await setup(), "card"), DOC.replace("five times", "three times"));
    expect(r.changeSet).toBeNull();
    expect(r.notices).toContain("1 locked card not updated");
  });

  it("a locked section is skipped whole — its cards and any new card for it — while other sections still update", async () => {
    // Everything in the Limits frame (its title and its text) reads as section-locked, as `existingObjects` reports it.
    const a = lock(await setup(), "section", ["Service › Limits#heading0", LIMITS]);
    const todo = "- [ ] check the retry budget";
    const text = DOC.replace("five times", "three times").replace("## Owners", `${todo}\n\n## Owners`).replace("Payments team.", "Payments and Risk teams.");
    // Unlocked, the to-do is a new card of the Limits section: the lock is what keeps it out.
    expect((await run(await setup(), text)).changeSet!.changes.some((c) => c.kind === "create_block")).toBe(true);
    const r = await run(a, text);
    const touched = r.changeSet!.changes.flatMap((c) => ("target" in c ? [c.target] : []));
    expect(touched).not.toContain(card(a).objectId);
    expect(touched).toContain(card(a, OWNERS).objectId);
    expect(r.changeSet!.changes.some((c) => c.kind === "create_block")).toBe(false); // the new Limits paragraph isn't added
    expect(r.changeSet!.skipped).toEqual({ locked: 2 });
    expect(r.changeSet!.conflicts ?? []).toEqual([]);
  });

  it("with Preserve locked sections off, a locked card is updated like any other", async () => {
    const r = await run(lock(await setup(), "card"), DOC.replace("five times", "three times"), { preserveLockedSections: false });
    expect(patchOf(r.changeSet)?.target).toBe(card(await setup()).objectId);
    expect(r.changeSet!.skipped).toBeUndefined();
  });

  it("a lock read from the scene: the card's own flag, or its frame's; a passage card's opt-out is never a lock", () => {
    const meta = (key: string, extra: Record<string, unknown> = {}) => ({ acuteMeta: { ai: { createdBy: "ai", contentSourceId: "src", contentSourceVersion: 1, stableNodeKey: key, contentFingerprint: "x", ...extra } } });
    const shape = (id: string, key: string, customData: Record<string, unknown>, frameId?: string) =>
      ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false, customData, ...(frameId ? { frameId } : {}) }) as unknown as SceneElement;
    const elements = [
      { id: "f1", type: "frame", x: 0, y: 0, width: 100, height: 100, isDeleted: false, customData: withLock({}, true) } as unknown as SceneElement,
      shape("a", "k#a", withLock(meta("k#a", { excludeFromReconciliation: true }), true)),
      shape("b", "k#b", meta("k#b"), "f1"),
      shape("c", "k#c", meta("k#c", { excludeFromReconciliation: true })),
      shape("d", "k#d", meta("k#d")),
    ];
    const got = Object.fromEntries(existingObjects(elements, () => null, "src").map((o) => [o.objectId, { locked: o.locked, excluded: o.excluded }]));
    expect(got).toEqual({
      a: { locked: "card", excluded: false },
      b: { locked: "section", excluded: false },
      c: { locked: undefined, excluded: true },
      d: { locked: undefined, excluded: false },
    });
  });
});

describe("Stage 1e — edited cards", () => {
  it("an edited card gets the new fact as a reviewed patch, and keeps the user's other edits", async () => {
    const a = edit(await setup());
    const r = await run(a, DOC.replace("five times", "three times"));
    const patch = patchOf(r.changeSet)!;
    expect(patch).toMatchObject({ target: card(a).objectId, onEditedCard: true, edits: [{ replacement: "three", intent: "SUPERSEDES" }] });
    expect(r.changeSet!.conflicts ?? []).toEqual([]);
    const { written } = accept(a, r.changeSet!, para(USER_WORDING));
    expect(written).toEqual([expect.objectContaining({ kind: "update_block", content: para("Retries happen three times, per the SRE runbook. Timeouts last ten seconds.") })]);
  });

  it("an edited card where the patch can't be placed gets today's conflict card", async () => {
    const a = edit(await setup(), "Retries happen several times. Timeouts last ten seconds.");
    const r = await run(a, DOC.replace("five times", "three times"));
    expect(patchOf(r.changeSet)).toBeUndefined();
    expect(r.changeSet!.conflicts).toMatchObject([{ target: card(a).objectId, apply: { kind: "update_block" }, keep: { kind: "rebaseline" } }]);
    expect(r.changeSet!.conflicts![0]!.escalation).toBeUndefined();
  });

  it("Preserve edited cards restores the conflict card for every edited card", async () => {
    const r = await run(edit(await setup()), DOC.replace("five times", "three times"), { preserveEditedCards: true });
    expect(patchOf(r.changeSet)).toBeUndefined();
    expect(r.changeSet!.conflicts).toMatchObject([{ apply: { kind: "update_block" }, keep: { kind: "rebaseline" } }]);
  });

  it.each([
    ["clean card, defaults", false, {}],
    ["edited card, defaults", true, {}],
    ["edited card, Preserve edited cards", true, { preserveEditedCards: true }],
    ["clean card, locks ignored", false, { preserveLockedSections: false }],
    ["edited card, claim patches off", true, { claimPatches: false }],
    ["clean card, claim patches off", false, { claimPatches: false }],
  ] as const)("a contradiction escalates — %s", async (_name, edited, options) => {
    const a = edited ? edit(await setup()) : await setup();
    const r = await run(a, DOC.replace("Timeouts last ten seconds.", "Timeouts never last ten seconds."), options);
    expect(r.changeSet!.changes.filter((c) => "target" in c && c.target === card(a).objectId)).toEqual([]);
    expect(r.changeSet!.conflicts).toMatchObject([{ target: card(a).objectId, escalation: { intent: "CONTRADICTS" } }]);
  });
});

describe("Stage 1e — R5: the baseline after a patch onto an edited card", () => {
  it("is the patched content at the new version: the next update proposes nothing again, and a later change still merges into the user's words", async () => {
    const a = edit(await setup());
    const v2 = DOC.replace("five times", "three times");
    const r = await run(a, v2);
    const { written } = accept(a, r.changeSet!, para(USER_WORDING));
    const merged = (written[0] as Extract<ProposedChange, { kind: "update_block" }>).content;

    // As the writer stamps it (changeSetWriter `updatedMetadata`): baseline = the written content's fingerprint, version = the set's.
    const cs = r.changeSet!.contentSource!;
    const c = card(a);
    c.rich = { content: merged };
    c.baseline = c.current = fingerprintContent(merged);
    c.version = cs.version;
    c.userWording = true; // the writer stamps a merge onto an edited card as the user's wording
    const after: Accepted = { ...a, previous: { sourceId: cs.sourceId, version: cs.version, text: cs.text, plan: cs.plan, ...(cs.pathIds ? { pathIds: cs.pathIds } : {}), createdAt: 2 } };

    expect((await run(after, v2)).changeSet).toBeNull();
    const later = await run(after, v2.replace("ten seconds", "thirty seconds"));
    expect(patchOf(later.changeSet)).toMatchObject({ onEditedCard: true, edits: [{ replacement: "thirty" }] });
    const again = accept(after, later.changeSet!, merged);
    expect(again.written).toEqual([expect.objectContaining({ content: para("Retries happen three times, per the SRE runbook. Timeouts last thirty seconds.") })]);
  });
});

describe("Stage 1 gaps — sentences added or removed, end to end", () => {
  it("a sentence the source adds to an edited card is merged into the user's wording", async () => {
    const a = edit(await setup());
    const r = await run(a, DOC.replace(LIMITS_TEXT, `${LIMITS_TEXT} Backoff doubles each time.`));
    expect(patchOf(r.changeSet)).toMatchObject({ onEditedCard: true, edits: [{ intent: "NEW" }] });
    const { written } = accept(a, r.changeSet!, para(USER_WORDING));
    expect(written).toEqual([expect.objectContaining({ content: para(`${USER_WORDING} Backoff doubles each time.`) })]);
  });

  it("a sentence the source drops from an untouched card is removed in place, the rest kept", async () => {
    const a = await setup();
    const r = await run(a, DOC.replace(LIMITS_TEXT, "Retries happen five times."));
    expect(patchOf(r.changeSet)).toMatchObject({ edits: [{ replacement: "" }] });
    expect(patchOf(r.changeSet)!.onEditedCard).toBeUndefined();
    const { written } = accept(a, r.changeSet!, para(LIMITS_TEXT));
    expect(written).toEqual([expect.objectContaining({ content: para("Retries happen five times.") })]);
  });
});

describe("Stage 1e — which cards read in the user's wording", () => {
  it("an untouched card at an older version (an accepted update, then Undo) is a clean update, not an edited card", async () => {
    const a = await setup();
    const v2 = DOC.replace("five times", "three times");
    const r = await run(a, v2);
    const cs = r.changeSet!.contentSource!;
    // Undo put the card back as AI wrote it at version 1; the source stays at version 2.
    const undone: Accepted = { ...a, previous: { sourceId: cs.sourceId, version: cs.version, text: cs.text, plan: cs.plan, ...(cs.pathIds ? { pathIds: cs.pathIds } : {}), createdAt: 2 } };
    card(undone).version = 1;
    const again = await run(undone, v2);
    expect(again.changeSet!.conflicts ?? []).toEqual([]);
    expect(patchOf(again.changeSet)).toMatchObject({ target: card(a).objectId });
    expect(patchOf(again.changeSet)!.onEditedCard).toBeUndefined();
  });

  it("a card kept with Keep mine (stamped as the user's wording) has the next change merged into it", async () => {
    const a = edit(await setup());
    const c = card(a);
    c.baseline = c.current!;
    c.userWording = true;
    const r = await run(a, DOC.replace("five times", "three times"));
    expect(patchOf(r.changeSet)).toMatchObject({ onEditedCard: true, edits: [{ replacement: "three" }] });
  });
});

describe("Stage 1e — the review bar counts skipped cards", () => {
  it("a set that leaves locked cards alone carries the count, shown as one line", async () => {
    const r = await run(lock(await setup(), "card"), DOC.replace("five times", "three times").replace("Payments team.", "Payments and Risk teams."));
    expect(r.changeSet!.skipped).toEqual({ locked: 1 });
    expect(skippedNote(r.changeSet!)).toBe("🔒 1 locked card not updated");
    expect(skippedNote({})).toBeNull();
    expect(lockedNotice(2)).toBe("2 locked cards not updated");
    expect(parseChangeSet(r.changeSet).skipped).toEqual({ locked: 1 });
  });

  it("an unchanged locked card is not counted (no noise)", async () => {
    const r = await run(lock(await setup(), "card"), DOC.replace("Payments team.", "Payments and Risk teams."));
    expect(r.changeSet!.skipped).toBeUndefined();
  });
});
