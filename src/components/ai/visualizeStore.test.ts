import { afterEach, describe, expect, it } from "vitest";
import { visualizeDialog } from "./visualizeStore";

afterEach(() => visualizeDialog.close());

describe("visualizeDialog.open", () => {
  it("\"Update from ChatGPT chats\" opens on a source to merge into, with no text of its own", () => {
    visualizeDialog.open({ text: "", label: "Update from chats", mergeSourceId: "src_1" });
    expect(visualizeDialog.get()).toMatchObject({ open: true, text: "", label: "Update from chats", mergeSourceId: "src_1" });
    expect(visualizeDialog.get().updateSourceId).toBeUndefined();
  });

  it("each open request is its own: the merge target of one is not carried into the next", () => {
    visualizeDialog.open({ mergeSourceId: "src_1" });
    const first = visualizeDialog.get().seq;
    visualizeDialog.open({ text: "pasted" });
    expect(visualizeDialog.get().mergeSourceId).toBeUndefined();
    expect(visualizeDialog.get().seq).toBe(first + 1);
  });
});
