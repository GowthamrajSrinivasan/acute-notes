/**
 * The Origin section's reconciliation controls on a block (`reconcileActions.ts`), offline: the scene is a plain array and
 * the document store a map. Promotion contract P0 (`.ai/docs/promotion-contract-proposal-2026-11-15.md`):
 *
 * - N1: "Allow AI updates" never hands a pinned note or an added passage card to reconciliation (its key is in no plan,
 *   so the next update would propose removing it); a "Don't update" Visualize card still can.
 * - N5 (deferred to P4, pinned here as a known failure): Undo of a Lock on a block leaves the card opted out, because the
 *   document's flag is written in place, outside the canvas history.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY", EVENTUALLY: "EVENTUALLY" },
  newElementWith: (el: object, patch: object) => ({ ...el, ...patch }),
}));

const s = vi.hoisted(() => ({ scene: [] as Record<string, unknown>[], docs: new Map<string, Record<string, unknown>>() }));
vi.mock("@/state/documents", () => ({
  getDocumentStore: () => ({
    get: (id: string) => s.docs.get(id),
    update: (id: string, patch: Record<string, unknown>) => void s.docs.set(id, { ...s.docs.get(id), ...patch }),
  }),
}));

const { reconcileStatus, reconcileToggleOf, setCardLocked, setExcludedFromReconciliation } = await import("./reconcileActions");
const { promotionKey } = await import("@/ai/reconcile/tracking");

const api = {
  getSceneElements: () => s.scene.filter((e) => !e.isDeleted),
  getSceneElementsIncludingDeleted: () => s.scene,
  getAppState: () => ({ activeEmbeddable: null }),
  updateScene: ({ elements }: { elements: Record<string, unknown>[] }) => void (s.scene = elements),
} as never;

/** A block card linked to source `src_1`, its metadata on its document (as the writer stores a block's). */
function block(id: string, stableNodeKey: string, excluded: boolean): void {
  const documentId = `doc_${id}`;
  s.docs.set(documentId, {
    id: documentId,
    kind: "block",
    metadata: { ai: { createdBy: "ai", contentSourceId: "src_1", contentSourceVersion: 2, stableNodeKey, contentFingerprint: "f1", ...(excluded ? { excludeFromReconciliation: true } : {}) } },
  });
  s.scene.push({ id, type: "embeddable", isDeleted: false, customData: { acute: { kind: "rich-block", blockType: "text", documentId } } });
}
const flagOf = (id: string) => (s.docs.get(`doc_${id}`)!.metadata as { ai: { excludeFromReconciliation?: boolean } }).ai.excludeFromReconciliation;

beforeEach(() => {
  s.scene = [];
  s.docs = new Map();
});

describe('"Allow AI updates" never hands a pinned or passage card to reconciliation (N1)', () => {
  it.each([
    ["a legacy pin", "openui § g1"],
    ["a pin since P0", promotionKey("gen_run1", "g1")],
    ["an added passage", "passage § u3"],
  ])("%s: refused, the card keeps its opt-out, and the Origin section is told it's the user's own", (_name, key) => {
    block("c", key, true);
    expect(reconcileStatus(api, "c")).toEqual({ excluded: true, locked: false, userOwned: true });
    expect(setExcludedFromReconciliation(api, "c", false)).toBe(false);
    expect(flagOf("c")).toBe(true);
    expect(reconcileStatus(api, "c")?.excluded).toBe(true);
  });

  it("the Origin section offers Lock, never Allow AI updates, on a pinned or passage card; Unlock when locked", () => {
    block("p", "openui § g1", true);
    block("v", "Service › Limits#text0", true);
    block("m", "Service › Owners#text0", false);
    const toggle = (id: string) => reconcileToggleOf(reconcileStatus(api, id)!);
    expect(toggle("p")).toBe("lock");
    expect(toggle("v")).toBe("allow");
    expect(toggle("m")).toBe("lock");
    setCardLocked(api, "p", true);
    expect(toggle("p")).toBe("unlock");
    setCardLocked(api, "p", false);
    expect(toggle("p")).toBe("lock");
  });

  it('a "Don\'t update" Visualize card can still allow updates again', () => {
    block("v", "Service › Limits#text0", true);
    expect(reconcileStatus(api, "v")).toEqual({ excluded: true, locked: false, userOwned: false });
    expect(setExcludedFromReconciliation(api, "v", false)).toBe(true);
    expect(flagOf("v")).toBeUndefined();
  });

  it("a pinned card can be locked and unlocked, and stays opted out after Unlock (the lock fix, unchanged)", () => {
    block("c", promotionKey("gen_run1", "g2"), true);
    setCardLocked(api, "c", true);
    expect(reconcileStatus(api, "c")).toMatchObject({ excluded: true, locked: true, userOwned: true });
    setCardLocked(api, "c", false);
    expect(reconcileStatus(api, "c")).toEqual({ excluded: true, locked: false, userOwned: true });
  });
});

describe("Undo of a Lock on a block (N5, deferred to P4: needs the document re-pointed inside the history step)", () => {
  it.fails("restores the card's opt-out as it was before the lock", () => {
    block("v", "Service › Limits#text0", false);
    const before = { ...s.scene[0]! };
    setCardLocked(api, "v", true);
    // The canvas history's Undo restores the element only.
    s.scene = [before];
    expect(reconcileStatus(api, "v")).toEqual({ excluded: false, locked: false, userOwned: false });
  });
});
