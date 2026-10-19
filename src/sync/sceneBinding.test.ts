import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { SceneBinding, type VersionedElement } from "./sceneBinding";

type El = VersionedElement & { x: number };

describe("SceneBinding", () => {
  it("writes only elements whose version changed", () => {
    const doc = new Y.Doc();
    const binding = new SceneBinding(doc.getMap<El>("elements"));
    const a = { id: "a", version: 1, index: "a0", x: 0 };
    const b = { id: "b", version: 1, index: "a1", x: 0 };

    expect(binding.commit([a, b])).toBe(2);
    expect(binding.commit([a, b])).toBe(0);
    expect(binding.hasChanges([a, b])).toBe(false);

    const movedB = { ...b, version: 2, x: 50 };
    expect(binding.hasChanges([a, movedB])).toBe(true);
    expect(binding.commit([a, movedB])).toBe(1);
  });

  it("round-trips through a Yjs update in z-order", () => {
    const doc = new Y.Doc();
    const binding = new SceneBinding(doc.getMap<El>("elements"));
    doc.transact(() =>
      binding.commit([
        { id: "top", version: 3, index: "a2", x: 1 },
        { id: "bottom", version: 1, index: "a0", x: 2 },
        { id: "mid", version: 1, index: "a1", x: 3 },
      ]),
    );

    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc));
    const restoredBinding = new SceneBinding(restored.getMap<El>("elements"));
    const scene = restoredBinding.readScene();
    expect(scene.map((e) => e.id)).toEqual(["bottom", "mid", "top"]);
    // Reading seeds the version cache so unchanged elements are not rewritten.
    expect(restoredBinding.commit(scene)).toBe(0);
  });

  it("emits one Yjs update per committed batch", () => {
    const doc = new Y.Doc();
    const binding = new SceneBinding(doc.getMap<El>("elements"));
    let updates = 0;
    doc.on("update", () => updates++);
    doc.transact(() =>
      binding.commit(Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, version: 1, index: `a${i}`, x: i }))),
    );
    expect(updates).toBe(1);
  });
});
