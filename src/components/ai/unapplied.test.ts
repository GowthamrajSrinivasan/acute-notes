/**
 * Stage 1 gate 4 follow-up (2026-11-15): an accept that skips a stale claim-level patch must not lose its fact. The
 * pure pipeline end to end — plan, accept on a canvas where one card changed since planning, record the version as
 * Accept does (`unappliedKeys` → `recordPartlyAppliedSource`), read it back as an update after a reload would
 * (`loadLatest`), retry, accept, and update again. Local tier only: no model is ever called.
 */
import { describe, expect, it } from "vitest";
import { acceptChangeSet, type ChangeSetCanvas } from "@/ai/changes/accept";
import { parseChangeSet, type ChangeSet, type DroppedChange, type ProposedChange } from "@/ai/changes/changeSet";
import { fingerprintContent } from "@/ai/content/fingerprint";
import { loadLatest, recordAcceptedSource, recordPartlyAppliedSource } from "@/ai/content/sources";
import type { ExistingObject } from "@/ai/reconcile/classify";
import { updateFromNewContent } from "@/ai/reconcile/update";
import type { RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { accepted, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { nothingAppliedMessage, unappliedKeys } from "./unapplied";

const home = { workspaceId: "ws", canvasId: "cv" };
const LIMITS = "Service › Limits#text0";
const RETRIES = "Service › Retries#text0";
const LIMITS_TEXT = "A client can connect to four servers at once.";
const RETRIES_TEXT = "Retries happen three times with a fixed delay.";
const DOC = `# Service\n\n## Limits\n\n${LIMITS_TEXT}\n\n## Retries\n\n${RETRIES_TEXT}\n`;
const NEXT = DOC.replace("four servers", "six servers").replace("three times", "five times");
/** The user's edit to the Retries card, made after the update was planned and before Accept. */
const USER_RETRIES = "Retries happen three times with a fixed delay (my note: per region).";

const para = (content: string): RichContent => [{ id: "blk", type: "paragraph", props: {}, content }];
const { runtime, spy } = runtimeWith(() => response("never"));
type Patch = Extract<ProposedChange, { kind: "patch_block" }>;
const patches = (set: ChangeSet | null) => (set?.changes ?? []).filter((c): c is Patch => c.kind === "patch_block");

/** The canvas as Accept sees it: each card's live content. */
function acceptOn(set: ChangeSet, live: Record<string, RichContent>) {
  const canvas: ChangeSetCanvas = {
    boxOf: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    contentOf: (id) => (live[id] ? { content: live[id], fingerprint: fingerprintContent(live[id]) } : null),
    write: () => new Map(),
  };
  return acceptChangeSet(parseChangeSet(set), canvas, { record: (f: () => void) => (f(), 1) });
}

/** A card as the writer leaves it: written content as baseline, the version it was written at. */
const written = (o: ExistingObject, content: RichContent, version: number, extra: Partial<ExistingObject> = {}): ExistingObject => ({
  ...o,
  rich: { content },
  baseline: fingerprintContent(content),
  current: fingerprintContent(content),
  version,
  ...extra,
});

async function updateFromStore(repo: ReturnType<typeof createMemoryServices>["contentSources"], sourceId: string, existing: ExistingObject[], text: string) {
  // What "Update from new content" reads — after a reload too: the latest recorded version, from the store.
  const latest = (await loadLatest(repo, sourceId))!;
  return updateFromNewContent({ source: latest.source, previous: latest.version, existing, text, operationId: "op_n", title: "Update from new content", context }, runtime, { parseMarkdown: parse });
}

describe("a skipped stale patch keeps its fact for “Update again” (Stage 1 gate 4)", () => {
  it("stale rejection → version recorded with the skipped card's node unapplied → retry offers just that fact → accepted → nothing changed", async () => {
    const { contentSources: repo } = createMemoryServices();
    const first = (await firstRun(DOC, runtime))!;
    await recordAcceptedSource(repo, home, first.contentSource!);
    const sourceId = first.contentSource!.sourceId;
    const a = accepted(first);
    const byKey = (objects: ExistingObject[], key: string) => objects.find((o) => o.stableNodeKey === key)!;
    const limits = byKey(a.existing, LIMITS);
    const retries = byKey(a.existing, RETRIES);
    let existing = a.existing.map((o) => (o === limits ? written(o, para(LIMITS_TEXT), 1) : o === retries ? written(o, para(RETRIES_TEXT), 1) : { ...o, version: 1 }));

    // 1. The update proposes two claim-level patches.
    const planned = (await updateFromStore(repo, sourceId, existing, NEXT)).changeSet!;
    expect(patches(planned).map((p) => p.target).sort()).toEqual([limits.objectId, retries.objectId].sort());

    // 2. Stale rejection: the user edits the Retries card before Accept; its patch is skipped, the Limits one applies.
    const live = { [limits.objectId]: para(LIMITS_TEXT), [retries.objectId]: para(USER_RETRIES) };
    const result = acceptOn(planned, live);
    expect(result.dropped).toMatchObject([{ reason: "patch_rejected", change: { target: retries.objectId } }]);
    expect(result.applied).toHaveLength(1);
    const unapplied = unappliedKeys(result.dropped);
    expect(unapplied).toEqual([RETRIES]);
    await recordPartlyAppliedSource(repo, home, planned.contentSource!, unapplied);

    // The recorded version is what the canvas now reflects: the applied fact is in, the skipped one is not.
    const v2 = (await loadLatest(repo, sourceId))!.version;
    expect(v2.version).toBe(2);
    expect(v2.text).toBe(DOC.replace("four servers", "six servers"));

    // 3. Reload: nothing in memory survives but the store; the canvas holds the written Limits card and the user's Retries card.
    const limitsAfter = (result.applied[0] as Extract<ProposedChange, { kind: "update_block" }>).content;
    existing = existing.map((o) => (o.objectId === limits.objectId ? written(o, limitsAfter, 2) : o.objectId === retries.objectId ? { ...o, rich: { content: para(USER_RETRIES) }, current: fingerprintContent(para(USER_RETRIES)) } : o));

    // 4. Retry ("Update again" with the same content): exactly the skipped fact, merged into the user's edit; the applied one is not proposed.
    const retry = (await updateFromStore(repo, sourceId, existing, NEXT)).changeSet!;
    expect(retry.conflicts ?? []).toEqual([]);
    expect(retry.changes).toHaveLength(1);
    expect(retry.changes[0]).toMatchObject({ kind: "patch_block", target: retries.objectId, onEditedCard: true, edits: [{ replacement: "five" }] });
    const again = acceptOn(retry, live);
    expect(again.dropped).toEqual([]);
    const retriesAfter = (again.applied[0] as Extract<ProposedChange, { kind: "update_block" }>).content;
    expect(retriesAfter).toEqual(para("Retries happen five times with a fixed delay (my note: per region)."));
    await recordPartlyAppliedSource(repo, home, retry.contentSource!, unappliedKeys(again.dropped));
    expect((await loadLatest(repo, sourceId))!.version).toMatchObject({ version: 3, text: NEXT });

    // 5. Subsequent reconciliation: the same content again changes nothing.
    existing = existing.map((o) => (o.objectId === retries.objectId ? written(o, retriesAfter, 3, { userWording: true }) : o));
    expect((await updateFromStore(repo, sourceId, existing, NEXT)).changeSet).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("why: recording the proposed version as is (the old Accept) loses the skipped fact — what gate 4 found", async () => {
    const { contentSources: repo } = createMemoryServices();
    const first = (await firstRun(DOC, runtime))!;
    await recordAcceptedSource(repo, home, first.contentSource!);
    const a = accepted(first);
    const existing = a.existing.map((o) => (o.stableNodeKey === RETRIES ? { ...written(o, para(RETRIES_TEXT), 1), rich: { content: para(USER_RETRIES) }, current: fingerprintContent(para(USER_RETRIES)) } : { ...o, version: 1 }));
    const planned = (await updateFromStore(repo, first.contentSource!.sourceId, existing, NEXT)).changeSet!;
    await recordAcceptedSource(repo, home, planned.contentSource!);
    const retriesId = existing.find((o) => o.stableNodeKey === RETRIES)!.objectId;
    const rerun = (await updateFromStore(repo, first.contentSource!.sourceId, existing, NEXT)).changeSet;
    expect([...(rerun?.changes ?? []), ...(rerun?.conflicts ?? [])].filter((c) => "target" in c && c.target === retriesId)).toEqual([]);
  });
});

describe("unappliedKeys", () => {
  const patch = (key?: string): Patch => ({ kind: "patch_block", target: "el", expectedFingerprint: "f", edits: [], ...(key ? { stableNodeKey: key } : {}) }) as unknown as Patch;
  it("a patch skipped as stale and an undecided source conflict; never a deleted object or an impact offer", () => {
    const dropped: DroppedChange[] = [
      { change: patch("k#a"), reason: "patch_rejected", rejection: { code: "fingerprint_mismatch" as never, detail: "" } },
      { change: patch("k#a"), reason: "patch_rejected" },
      { change: patch(), reason: "patch_rejected" },
      { change: { kind: "remove", target: "el_x" }, reason: "object_deleted" },
    ];
    const conflicts = [
      { target: "el_b", stableNodeKey: "k#b", apply: { kind: "update_block", target: "el_b", content: [] } },
      { target: "el_c", stableNodeKey: "k#c", apply: patch("k#c"), impact: { from: "el_a", claim: "", detail: "", proposed: "" } },
    ] as never;
    expect(unappliedKeys(dropped, conflicts)).toEqual(["k#a", "k#b"]);
    expect(unappliedKeys([])).toEqual([]);
  });
});

describe("nothingAppliedMessage", () => {
  const stale: DroppedChange = { change: { kind: "remove", target: "a" }, reason: "patch_rejected" };
  const deleted: DroppedChange = { change: { kind: "remove", target: "b" }, reason: "object_deleted" };
  it("a stale card is not a deleted object", () => {
    expect(nothingAppliedMessage([stale])).toBe("Nothing was applied: the card changed since this update was planned. Update again to redo it.");
    expect(nothingAppliedMessage([stale, stale])).toBe("Nothing was applied: the cards changed since this update was planned. Update again to redo them.");
    expect(nothingAppliedMessage([deleted])).toBe("Nothing was added: every change referred to a deleted object.");
    expect(nothingAppliedMessage([stale, deleted])).toMatch(/^Nothing was applied\. 1 change was skipped: .* 1 precise edit was skipped: /);
    expect(nothingAppliedMessage([])).toBe("Nothing was applied.");
  });
});

describe("stale-target protection (2026-11-15)", () => {
  it("an update withheld because its block was edited since the proposal keeps its card's previous node, like a stale patch", () => {
    const changed: DroppedChange = { change: { kind: "update_block", target: "el_a", content: [], stableNodeKey: "k#a" }, reason: "target_changed" };
    expect(unappliedKeys([changed])).toEqual(["k#a"]);
    const decision = { target: "el_b", stableNodeKey: "k#b", apply: { kind: "update_block", target: "el_b", content: [] }, changedSinceProposal: true } as never;
    expect(unappliedKeys([], [decision])).toEqual(["k#b"]);
    expect(nothingAppliedMessage([changed])).toBe("Nothing was applied: the card changed since this update was planned. Update again to redo it.");
  });
});
