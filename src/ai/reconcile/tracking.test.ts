/**
 * Promotion contract P0 (`.ai/docs/promotion-contract-proposal-2026-11-15.md`): the pinned-note key is unique per
 * generation run (R3), user-owned cards are told by their exact key forms only (Q14), a live key is found for
 * de-duplication, and a pinned or passage card is never split with a link (N4).
 */
import { describe, expect, it } from "vitest";
import type { DocumentRecord } from "@/domain/types";
import { splitLinkOf } from "./split";
import { isUserOwnedCard, isUserOwnedKey, liveObjectWithKey, promotionKey } from "./tracking";

const linked = (id: string, stableNodeKey: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "rectangle",
  isDeleted: false,
  customData: { acuteMeta: { ai: { createdBy: "ai", contentSourceId: "src_1", contentSourceVersion: 2, stableNodeKey, contentFingerprint: "f1", ...extra } } },
});
const noDocs = (): DocumentRecord | undefined => undefined;

describe("pinned-note keys (R3)", () => {
  it("two generation runs pinning their own g1 get distinct keys", () => {
    expect(promotionKey("gen_aaa", "g1")).toBe("promoted § gen_aaa § g1");
    expect(promotionKey("gen_aaa", "g1")).not.toBe(promotionKey("gen_bbb", "g1"));
  });

  it("user-owned keys: only the exact forms the producers write (legacy pin, P0 pin, passage)", () => {
    expect(isUserOwnedKey("openui § g1")).toBe(true);
    expect(isUserOwnedKey("openui § g12")).toBe(true);
    expect(isUserOwnedKey(promotionKey("gen_4fQabc", "g3"))).toBe(true);
    expect(isUserOwnedKey("passage § u7")).toBe(true);
    // A Visualize key is `<unit> § <key>`: a section titled "openui" or "passage" never produces these forms (Q14).
    expect(isUserOwnedKey("openui § text#0")).toBe(false);
    expect(isUserOwnedKey("passage § text#0")).toBe(false);
    expect(isUserOwnedKey("Notes › passage § u7")).toBe(false);
    expect(isUserOwnedKey("promoted § g1")).toBe(false);
    expect(isUserOwnedKey("Service › Limits#text0")).toBe(false);
    expect(isUserOwnedKey(undefined)).toBe(false);
    expect(isUserOwnedKey("")).toBe(false);
  });

  it("isUserOwnedCard reads the card's link; an unlinked card is not one", () => {
    expect(isUserOwnedCard(linked("a", "passage § u2", { excludeFromReconciliation: true }), noDocs)).toBe(true);
    expect(isUserOwnedCard(linked("b", "Service › Limits#text0"), noDocs)).toBe(false);
    expect(isUserOwnedCard({ customData: { acuteMeta: { ai: { createdBy: "user" } } } }, noDocs)).toBe(false);
  });

  it("finds the live card carrying a key (never a deleted one, never a bound label)", () => {
    const key = promotionKey("gen_aaa", "g1");
    const scene = [linked("gone", key), linked("other", promotionKey("gen_bbb", "g1")), linked("live", key)];
    scene[0]!.isDeleted = true;
    expect(liveObjectWithKey(scene, noDocs, key)).toBe("live");
    expect(liveObjectWithKey(scene, noDocs, promotionKey("gen_ccc", "g1"))).toBeNull();
  });
});

describe("Visualize better never links a pinned or passage card's pieces (N4)", () => {
  it("splitLinkOf: null for a pinned note (legacy or P0) and an added passage; a Visualize card keeps its link", () => {
    for (const key of ["openui § g1", promotionKey("gen_aaa", "g2"), "passage § u3"]) {
      expect(splitLinkOf(linked("p", key, { excludeFromReconciliation: true }), noDocs), key).toBeNull();
    }
    expect(splitLinkOf(linked("v", "Service › Limits#text0"), noDocs)?.record.of).toBe("Service › Limits#text0");
  });
});
