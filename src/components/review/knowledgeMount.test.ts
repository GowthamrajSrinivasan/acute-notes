/**
 * The mounted review UI's pure parts (knowledge-notes-plan §5.3, WP2.5–2.6): outcome words only for distil sets, and the
 * canvas queue built from what is stored (cards' reviews, the source version's passage flags and resolutions).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" }, newElementWith: (el: object, p: object) => ({ ...el, ...p }) }));
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { canvasQueue } from "./KnowledgeReviewBar";
import type { KnowledgeObject } from "./knowledgeObjects";
import { outcomeChipsOfSet, outcomeTotalsOfSet } from "./setOutcomes";

const unit = (id: string, text: string): SourceUnit => ({ id, kind: "sentence", text, hash: id, topic: "Doc › A", span: { start: 0, end: 1 } });
const units = [unit("u1", "Retries stop after 3 attempts."), unit("u2", "Only when the cache holds a valid result."), unit("u3", "As discussed.")];
const obj = (id: string, cites: string[], review?: KnowledgeObject["review"]): KnowledgeObject => ({
  objectId: id,
  sourceId: "src",
  version: 1,
  stableNodeKey: `k_${id}`,
  cites,
  ...(review ? { review } : {}),
  box: { x: 0, y: 0, width: 100, height: 50 },
  shape: "block",
});
const text = () => ({ title: "Card", body: "Body" });

describe("outcome words for a distil set only (WP2.5)", () => {
  it("null for a preserve set, so its chips and totals stay as they were", () => {
    expect(outcomeChipsOfSet({})).toBeNull();
    expect(outcomeTotalsOfSet({})).toBeNull();
  });

  it("a distil set's sections and totals in outcome words, by section label", () => {
    const set = {
      knowledge: {
        cards: {},
        report: {
          units: 5,
          outcomes: { represented: 3, omitted: 1, needsReview: 1 },
          cards: { total: 3, needsReview: 1, checkedByAI: 0, hinted: 0 },
          flags: [],
          sections: [
            { key: "A", label: "Retries", represented: 2, omitted: 1, needsReview: 1, highOmittedShare: false, problems: 0 },
            { key: "B", label: "Limits", represented: 1, omitted: 0, needsReview: 0, highOmittedShare: false, problems: 0 },
          ],
          restored: { items: 0, units: 0 },
          lostCitations: 0,
        },
      },
    } as unknown as Pick<ChangeSet, "knowledge">;
    const chips = outcomeChipsOfSet(set)!;
    expect(chips.get("Retries")!.text).toBe("2 represented · 1 omitted · 1 needs review");
    expect(chips.get("Retries")!.tone).toBe("warning");
    expect(chips.get("Limits")!.text).toBe("1 represented");
    expect(outcomeTotalsOfSet(set, { weakModel: true })).toMatchObject({ text: "3 represented · 1 omitted · 1 needs review", warning: "This model may drop conditions; check the items that need review." });
  });
});

describe("the canvas queue from what is stored (U3, U8)", () => {
  const source = (review: Parameters<typeof canvasQueue>[1][number]["review"]) => [{ sourceId: "src", version: 1, units, review }];

  it("a card with an open stored review is an item; a resolved one isn't", () => {
    const objects = [obj("a", ["u1"], { reasons: ["condition changed: source limits it"] }), obj("b", ["u2"], { reasons: ["x"], resolved: "kept" })];
    const { items } = canvasQueue(objects, source(null), text);
    expect(items.map((i) => i.key)).toEqual(["card:a"]);
    expect(items[0]!.actions).toEqual(["keep", "edit", "use_source_wording"]);
  });

  it("a flagged passage no card carries is an item until resolved; once a card cites it, its passage flag is dropped", () => {
    const flags = [{ code: "critical_omitted" as const, unit: "u2", detail: "important point left out" }];
    let q = canvasQueue([obj("a", ["u1"])], source({ outcome: {}, reasons: {}, flags, resolutions: {} }), text);
    expect(q.items.map((i) => [i.key, i.actions])).toEqual([["unit:u2", ["include", "dismiss"]]]);
    expect(q.sourceOf.get("unit:u2")!.sourceId).toBe("src");
    q = canvasQueue([obj("a", ["u1"])], source({ outcome: {}, reasons: {}, flags, resolutions: { u2: "dismissed" } }), text);
    expect(q.items).toEqual([]);
    q = canvasQueue([obj("a", ["u1"]), obj("p", ["u2"])], source({ outcome: {}, reasons: {}, flags, resolutions: {} }), text);
    expect(q.items).toEqual([]);
  });
});
