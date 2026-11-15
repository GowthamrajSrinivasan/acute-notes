/**
 * Found at C1b (2026-10-19, local e2e U4): a 200k-character distil run whose cards left thousands of key terms out made a
 * coverage report past its schema's bound, and the whole change set was refused ("Something went wrong"). The report now
 * lists at most `MAX_LISTED_TERMS` missed terms (its counts stay exact), and a malformed diagnostic never refuses a set.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { buildReport, MAX_LISTED_TERMS } from "./report";

const terms = Array.from({ length: MAX_LISTED_TERMS + 500 }, (_, i) => `T-${i}`);
const section = { key: "s", label: "S", units: 10, placedByAI: 0, addedFromSource: 0, added: [], keyTerms: { total: terms.length, placedByAI: 0, missing: terms }, terms };

describe("coverage report bounds", () => {
  it("lists at most MAX_LISTED_TERMS missed terms, with exact counts", () => {
    const report = buildReport([section]);
    expect(report.keyTerms.missing).toHaveLength(MAX_LISTED_TERMS);
    expect(report.keyTerms).toMatchObject({ total: terms.length, placedByAI: 0 });
  });

  it("a coverage report past its bounds is dropped, never a reason to refuse the set", () => {
    const set = { operationId: "op", title: "Visualize", metadata: { createdBy: "ai" }, changes: [{ kind: "move", target: "el", to: { x: 1, y: 2 } }], fidelity: { units: 1, placedByAI: 0, addedFromSource: 0, keyTerms: { total: terms.length, placedByAI: 0, missing: terms }, sections: [] } };
    const parsed = parseChangeSet(set);
    expect(parsed.fidelity).toBeUndefined();
    expect(parsed.operationId).toBe("op");
  });
});
