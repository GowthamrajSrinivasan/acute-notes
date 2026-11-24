/**
 * ⋮ → "Note-taking mode" (note-taking-modes plan Step 2): the current mode is marked, picking the other one switches,
 * picking the current one does nothing, and the heading says the mode is a default only (P1).
 */
import { describe, expect, it, vi } from "vitest";
import { noteModeMenuItems } from "./TopHeader";

describe("note-taking mode menu", () => {
  it("marks the current mode and switches only to the other one", () => {
    const onSet = vi.fn();
    const items = noteModeMenuItems("manual", onSet);
    expect(items.map((i) => [i.label, i.hint ?? null, !!i.heading])).toEqual([
      ["Note-taking mode (default only)", null, true],
      ["✓ Manual notes", "Current", false],
      ["AI-managed notes", null, false],
    ]);
    items[1]!.onSelect?.();
    expect(onSet).not.toHaveBeenCalled();
    items[2]!.onSelect?.();
    expect(onSet).toHaveBeenCalledWith("ai");
  });

  it("works the other way round", () => {
    const onSet = vi.fn();
    const items = noteModeMenuItems("ai", onSet);
    expect(items[2]!.label).toBe("✓ AI-managed notes");
    items[1]!.onSelect?.();
    expect(onSet).toHaveBeenCalledWith("manual");
  });
});
