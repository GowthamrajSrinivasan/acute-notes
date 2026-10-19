import { describe, expect, it } from "vitest";
import { findRelated, termsOf } from "./related";
import type { ContextItem, SelectionContext } from "./selectionContext";

const item = (id: string, text: string, extra: Partial<ContextItem> = {}): ContextItem => ({ id, kind: "text", text, onCanvas: true, ...extra });

function ctx(items: ContextItem[], selected: string[], relations: SelectionContext["relations"] = []): SelectionContext {
  return { scope: "canvas", workspaceId: "ws", canvasId: "cv", selectedObjectIds: selected, items, nearby: [], relations, truncated: false };
}

describe("findRelated", () => {
  it("ranks shared distinctive terms, ignores stop words and unrelated items", () => {
    const matches = findRelated(
      ctx(
        [
          item("sel", "Checkout payment retries with the payment gateway"),
          item("a", "Payment gateway timeout alerts"),
          item("b", "Checkout page redesign"),
          item("c", "Team offsite schedule"),
        ],
        ["sel"],
      ),
    );
    expect(matches.map((m) => m.item.id)).toEqual(["a", "b"]);
    expect(matches[0]!.terms).toEqual(expect.arrayContaining(["payment", "gateway"]));
  });

  it("boosts objects directly connected to the selection, even without shared words", () => {
    const matches = findRelated(ctx([item("sel", "Login"), item("x", "Session store")], ["sel"], [{ from: "sel", to: "x" }]));
    expect(matches).toEqual([expect.objectContaining({ connected: true, item: expect.objectContaining({ id: "x" }) })]);
  });

  it("returns nothing without a selection", () => {
    expect(findRelated(ctx([item("a", "payment"), item("b", "payment")], []))).toEqual([]);
  });

  it("extracts words of four or more characters, minus stop words", () => {
    expect([...termsOf("The API is down; retry-logic needs work")]).toEqual(["retry-logic", "needs", "work"]);
  });
});
