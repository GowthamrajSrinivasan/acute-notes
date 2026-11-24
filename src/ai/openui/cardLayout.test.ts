/**
 * Stored card layouts (note-taking-modes plan Step 3): the content hash, current vs stale, the size cap, and the Cards
 * view's draw order per mode (D5: Manual keeps the "cites a source" rule for derived cards; a stored layout draws in
 * every mode).
 */
import { describe, expect, it } from "vitest";
import type { RichContent } from "@/domain/types";
import { cardContentHash, cardRenderPlan, LAYOUT_LANG_MAX, LayoutError, layoutFor, layoutStateOf } from "./cardLayout";
import { checkLayoutStructure } from "./layoutCheck";

const drawable = (lang: string) => checkLayoutStructure(lang).ok;

const p = (text: string, styles?: Record<string, boolean>) => ({ type: "paragraph" as const, content: styles ? [{ type: "text" as const, text, styles }] : text });
const CARD = { title: "Retries", snapshot: [p("Retries happen five times.")] as RichContent };
const STORED = `root = IdeaCard("Retries", "Five tries, then give up.")`;

describe("card layouts", () => {
  it("hashes the card's text, not its formatting", () => {
    const bold = { ...CARD, snapshot: [p("Retries happen five times.", { bold: true })] as RichContent };
    expect(cardContentHash(bold)).toBe(cardContentHash(CARD));
    expect(cardContentHash({ ...CARD, snapshot: [p("Retries happen three times.")] })).not.toBe(cardContentHash(CARD));
    expect(cardContentHash({ ...CARD, title: "Retry policy" })).not.toBe(cardContentHash(CARD));
    expect(cardContentHash(CARD)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a layout is current for the text it was made from and stale once the text changes", () => {
    const layout = layoutFor(CARD, `  ${STORED}\n`, 42);
    expect(layout).toEqual({ format: "openui-lang", version: 1, lang: STORED, contentHash: cardContentHash(CARD), writtenAt: 42 });
    expect(layoutStateOf(CARD)).toBe("none");
    expect(layoutStateOf({ ...CARD, layout })).toBe("current");
    expect(layoutStateOf({ ...CARD, snapshot: [p("Retries happen three times.")], layout })).toBe("stale");
  });

  it("refuses an empty or oversized layout", () => {
    expect(() => layoutFor(CARD, "   ")).toThrow(LayoutError);
    expect(() => layoutFor(CARD, "x".repeat(LAYOUT_LANG_MAX + 1))).toThrow(LayoutError);
    expect(() => layoutFor(CARD, "x".repeat(LAYOUT_LANG_MAX))).not.toThrow();
  });

  it("without a drawable check no stored layout is drawn (never unchecked)", () => {
    const plan = cardRenderPlan({ ...CARD, layout: layoutFor(CARD, STORED) }, { noteMode: "manual" })!;
    expect(plan.langs).not.toContain(STORED);
    expect(plan.langs).toHaveLength(1);
  });

  describe("draw order", () => {
    const layout = layoutFor(CARD, STORED);
    const changed = { ...CARD, snapshot: [p("Retries happen three times.")], layout };

    it("manual, no citations, no layout: stays Compact (D5)", () => {
      expect(cardRenderPlan(CARD, { noteMode: "manual" })).toBeNull();
      expect(cardRenderPlan(CARD, { noteMode: "manual", cites: [] })).toBeNull();
    });

    it("a source-citing card draws derived in either mode, with its chips", () => {
      for (const noteMode of ["manual", "ai"] as const) {
        const plan = cardRenderPlan(CARD, { noteMode, cites: ["u1"] })!;
        expect(plan.stale).toBe(false);
        expect(plan.langs).toHaveLength(1);
        expect(plan.langs[0]).toContain(`CitationChip("u1")`);
      }
    });

    it("AI-managed: any text block draws as a derived card", () => {
      const plan = cardRenderPlan(CARD, { noteMode: "ai" })!;
      expect(plan.langs).toHaveLength(1);
      expect(plan.langs[0]).toMatch(/^root = IdeaCard\("Retries"/);
    });

    it("a current stored layout draws first in every mode, the derived card behind it", () => {
      for (const noteMode of ["manual", "ai"] as const) {
        const plan = cardRenderPlan({ ...CARD, layout }, { noteMode, drawable })!;
        expect(plan.langs[0]).toBe(STORED);
        expect(plan.langs).toHaveLength(2);
        expect(plan.stale).toBe(false);
      }
    });

    it("a stale stored layout is never drawn: the card is drawn from its new text, flagged stale", () => {
      for (const noteMode of ["manual", "ai"] as const) {
        const plan = cardRenderPlan(changed, { noteMode, drawable })!;
        expect(plan.stale).toBe(true);
        expect(plan.langs).toHaveLength(1);
        expect(plan.langs[0]).not.toBe(STORED);
        expect(plan.langs[0]).toContain("three times");
      }
    });

    it("an empty card has nothing derived to draw", () => {
      expect(cardRenderPlan({ title: "", snapshot: [] }, { noteMode: "ai" })).toBeNull();
    });
  });
});
