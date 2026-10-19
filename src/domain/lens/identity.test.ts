import { describe, expect, it } from "vitest";
import { lensCopyData, lensKeyOf, mapIdentityOf, nodeKeyFor } from "./identity";

describe("nodeKeyFor", () => {
  it("slugifies the label under the frame's key", () => {
    expect(nodeKeyFor("payments", "Webhook Handler")).toBe("payments.webhook-handler");
  });

  it("falls back to a placeholder for an empty or symbol-only label", () => {
    expect(nodeKeyFor("payments", "   ")).toBe("payments.node");
    expect(nodeKeyFor("payments", "!!!")).toBe("payments.node");
  });

  it("collapses runs of punctuation and trims leading/trailing hyphens", () => {
    expect(nodeKeyFor("f1", "  Stripe / Razorpay  ")).toBe("f1.stripe-razorpay");
  });
});

/** A map shape: its reconciliation link (with the stable key) on the element, as the change-set writer stamps it. */
const mapShape = (extra: Record<string, unknown> = {}) => ({
  type: "rectangle",
  customData: { acuteMeta: { ai: { createdBy: "mcp", contentSourceId: "src_1", contentSourceVersion: 1, stableNodeKey: "mod:payments", contentFingerprint: "f" } }, ...extra },
});
/** A map card (rich block): its link on its document. */
const mapCard = { type: "embeddable", customData: { acute: { kind: "rich-block", blockType: "text", documentId: "d1" } } };
const docs = (id: string) => (id === "d1" ? ({ id, metadata: { ai: { createdBy: "mcp", contentSourceId: "s", contentSourceVersion: 1, stableNodeKey: "file:a.ts", contentFingerprint: "f" } } } as never) : undefined);

describe("the Lens identity rule (D21)", () => {
  it("acuteNode.key first, then the map identity, else none (the id is the caller's last resort)", () => {
    expect(lensKeyOf({ customData: { acuteNode: { key: "pay.webhook" } } })).toBe("pay.webhook");
    expect(lensKeyOf(mapShape())).toBe("mod:payments");
    expect(lensKeyOf(mapShape({ acuteNode: { key: "hand.key" } }))).toBe("hand.key");
    expect(lensKeyOf({ customData: {} })).toBeUndefined();
  });

  it("a card's map identity is read from its document", () => {
    expect(mapIdentityOf(mapCard, docs)).toBe("file:a.ts");
    expect(mapIdentityOf(mapCard)).toBeUndefined();
  });

  it("the copy rule: a copy is marked ownIdentity and loses the map identity; its other fields stay", () => {
    const copy = { ...mapShape(), customData: lensCopyData(mapShape())! };
    expect(copy.customData.acuteNode).toEqual({ ownIdentity: true });
    expect(lensKeyOf(copy)).toBeUndefined();
    expect((copy.customData.acuteMeta as { ai: { stableNodeKey: string } }).ai.stableNodeKey).toBe("mod:payments"); // reconciliation data untouched
    const cardCopy = { ...mapCard, customData: lensCopyData(mapCard, docs)! };
    expect(lensKeyOf(cardCopy, docs)).toBeUndefined();
    // A hand-drawn node's copy just loses its key (Phase 1A-ii's rule), with no ownIdentity.
    expect(lensCopyData({ type: "rectangle", customData: { acuteNode: { key: "k", kind: "backend" } } })).toEqual({ acuteNode: { kind: "backend" } });
    expect(lensCopyData({ type: "rectangle", customData: {} })).toBeNull();
  });
});
