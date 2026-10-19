import { describe, expect, it } from "vitest";
import { chooseMergeTarget, type MergeTarget } from "./targets";

const found: MergeTarget[] = [
  { sourceId: "src_new", label: "Newest notes", updatedAt: 9 },
  { sourceId: "src_old", label: "Older notes", updatedAt: 1 },
];

describe("chooseMergeTarget", () => {
  it("is nothing when the canvas has no notes: there is nothing to merge into", () => {
    expect(chooseMergeTarget([], undefined, undefined)).toBeNull();
    expect(chooseMergeTarget([], "src_old", undefined)).toBeNull();
  });

  it("is the newest notes, merging, by default", () => {
    expect(chooseMergeTarget(found, undefined, undefined)).toEqual({ targetId: "src_new", mode: "merge" });
    expect(chooseMergeTarget(found, undefined, "Pasted text")).toEqual({ targetId: "src_new", mode: "merge" });
  });

  it("a selection's own content is added as new notes unless a target was asked for", () => {
    expect(chooseMergeTarget(found, undefined, "Selection")).toEqual({ targetId: "src_new", mode: "new" });
  });

  it("the notes the caller asked for (Update from ChatGPT chats) are the target, and it merges whatever the content is", () => {
    expect(chooseMergeTarget(found, "src_old", undefined)).toEqual({ targetId: "src_old", mode: "merge" });
    expect(chooseMergeTarget(found, "src_old", "Selection")).toEqual({ targetId: "src_old", mode: "merge" });
  });

  it("notes that are no longer on this canvas fall back to the default, never to a source that cannot be merged into", () => {
    expect(chooseMergeTarget(found, "src_gone", undefined)).toEqual({ targetId: "src_new", mode: "merge" });
  });
});
