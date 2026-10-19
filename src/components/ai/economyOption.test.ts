import { describe, expect, it } from "vitest";
import type { MergeInput } from "@/ai/merge/merge";
import { ECONOMY_LABEL, ECONOMY_NOTICE, withEconomy } from "./economyOption";

const input = { text: "x", operationId: "op", title: "Merge" } as unknown as MergeInput;

describe("economy option", () => {
  it("off: the merge input is exactly what it was (no economy key at all)", () => {
    expect(withEconomy(input, false)).toBe(input);
    expect("economy" in withEconomy(input, false)).toBe(false);
  });
  it("on: only the flag is added", () => {
    expect(withEconomy(input, true)).toEqual({ ...input, economy: true });
  });
  it("the label and notice say the text is plain and not AI-organised", () => {
    expect(ECONOMY_LABEL).toBe("Add new text as plain cards, no AI");
    expect(ECONOMY_NOTICE).toMatch(/word for word as plain cards\. AI does not organise or link it/);
    expect(ECONOMY_NOTICE).toMatch(/New topics are still organised by AI/);
  });
});
