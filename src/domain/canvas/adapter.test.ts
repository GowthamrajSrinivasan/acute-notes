import { describe, expect, it } from "vitest";
import {
  blockLink,
  deriveRelations,
  getEmbedRef,
  isAcuteLink,
  pageLink,
  sceneToAcuteObjects,
  toAcuteObject,
  keepsRelationOnCopy,
  withRelation,
  type SceneElement,
} from "./adapter";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return {
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: 2,
    strokeStyle: "solid",
    ...partial,
  };
}

describe("canvas adapter", () => {
  it("maps shapes with bound labels", () => {
    const scene = [
      el({ id: "r1", type: "rectangle" }),
      el({ id: "t1", type: "text", text: "IN PROGRESS", containerId: "r1" }),
    ];
    const objs = sceneToAcuteObjects(scene);
    expect(objs[0]).toMatchObject({ id: "r1", type: "shape", shape: "rectangle", label: "IN PROGRESS", zIndex: 0 });
    expect(objs[1]).toMatchObject({ id: "t1", type: "text", containerId: "r1", zIndex: 1 });
  });

  it("maps arrows with endpoint bindings", () => {
    const obj = toAcuteObject(
      el({
        id: "a1",
        type: "arrow",
        points: [[0, 0], [50, 10]],
        startBinding: { elementId: "r1" },
        endBinding: { elementId: "r2" },
        endArrowhead: "arrow",
      }),
      3,
    );
    expect(obj).toMatchObject({ type: "arrow", startObjectId: "r1", endObjectId: "r2", endMarker: "arrow", startMarker: null });
  });

  it("skips deleted and renderer-only elements", () => {
    expect(toAcuteObject(el({ id: "x", type: "rectangle", isDeleted: true }), 0)).toBeNull();
    expect(toAcuteObject(el({ id: "f", type: "frame" }), 0)).toBeNull();
    expect(toAcuteObject(el({ id: "e", type: "embeddable", link: "https://example.com" }), 0)).toBeNull();
  });

  it("maps Acute embeddables to rich blocks and page previews", () => {
    const block = el({
      id: "b1",
      type: "embeddable",
      link: blockLink("doc_1"),
      customData: { acute: { kind: "rich-block", blockType: "todo", documentId: "doc_1" } },
    });
    const page = el({
      id: "p1",
      type: "embeddable",
      link: pageLink("page_1"),
      customData: {
        acute: { kind: "page-preview", pageId: "page_1" },
        acuteMeta: { ai: { createdBy: "ai", operationId: "op_1" } },
      },
    });
    expect(toAcuteObject(block, 0)).toMatchObject({ type: "rich-block", blockType: "todo", documentId: "doc_1" });
    expect(toAcuteObject(page, 1)).toMatchObject({
      type: "page-preview",
      pageId: "page_1",
      metadata: { ai: { createdBy: "ai", operationId: "op_1" } },
    });
  });

  it("defaults page previews to the compact card and keeps a valid remembered size", () => {
    expect(getEmbedRef({ customData: { acute: { kind: "page-preview", pageId: "page_1" } } })).toEqual({
      kind: "page-preview",
      pageId: "page_1",
      preview: false,
    });
    expect(
      getEmbedRef({
        customData: { acute: { kind: "page-preview", pageId: "p", preview: true, otherSize: { width: 280, height: 132 } } },
      }),
    ).toEqual({ kind: "page-preview", pageId: "p", preview: true, otherSize: { width: 280, height: 132 } });
    expect(
      getEmbedRef({ customData: { acute: { kind: "page-preview", pageId: "p", otherSize: { width: "big" } } } }),
    ).toEqual({ kind: "page-preview", pageId: "p", preview: false });
  });

  it("rejects malformed embed refs", () => {
    expect(getEmbedRef({ customData: { acute: { kind: "rich-block", blockType: "kanban", documentId: "d" } } })).toBeNull();
    expect(getEmbedRef({ customData: { acute: "nope" } })).toBeNull();
    expect(getEmbedRef({})).toBeNull();
  });

  it("recognises acute links", () => {
    expect(isAcuteLink(blockLink("d"))).toBe(true);
    expect(isAcuteLink("https://acute.example")).toBe(false);
    expect(isAcuteLink(null)).toBe(false);
  });

  it("maps images to asset references (never binary)", () => {
    const obj = toAcuteObject(el({ id: "i1", type: "image", fileId: "file_abc" }), 0);
    expect(obj).toMatchObject({ type: "image", assetId: "file_abc" });
    expect(JSON.stringify(obj)).not.toContain("data:");
  });

  describe("relations (F23)", () => {
    const arrow = (partial: Partial<SceneElement> = {}) =>
      el({
        id: "a1",
        type: "arrow",
        startBinding: { elementId: "r1" },
        endBinding: { elementId: "r2" },
        customData: { acuteRelation: "caused_by" },
        ...partial,
      });
    const shapes = [el({ id: "r1", type: "rectangle" }), el({ id: "r2", type: "rectangle" })];

    it("derives a typed relation from an arrow bound at both ends", () => {
      expect(deriveRelations([...shapes, arrow()])).toEqual([
        { id: "rel_a1", from: "r1", to: "r2", type: "caused_by", arrowId: "a1" },
      ]);
      expect(toAcuteObject(arrow(), 0)).toMatchObject({ type: "arrow", relation: "caused_by", startObjectId: "r1" });
    });

    it("keeps the relation when endpoints move (geometry is irrelevant)", () => {
      const moved = [el({ id: "r1", type: "rectangle", x: 900 }), el({ id: "r2", type: "rectangle", y: -400 })];
      expect(deriveRelations([...moved, arrow({ x: 500 })])).toHaveLength(1);
    });

    it("drops the relation when an endpoint is deleted or unbound, or the arrow is deleted", () => {
      expect(deriveRelations([shapes[0]!, { ...shapes[1]!, isDeleted: true }, arrow()])).toEqual([]);
      expect(deriveRelations([...shapes, arrow({ endBinding: null })])).toEqual([]);
      expect(deriveRelations([...shapes, arrow({ isDeleted: true })])).toEqual([]);
    });

    it("sets and clears the type without touching other metadata", () => {
      expect(withRelation({ acute: 1 }, "blocks")).toEqual({ acute: 1, acuteRelation: "blocks" });
      expect(withRelation({ acute: 1, acuteRelation: "blocks" }, undefined)).toEqual({ acute: 1 });
    });

    it("a copied arrow keeps its type only when both its ends were copied with it", () => {
      const copy = arrow({ id: "a1c", startBinding: { elementId: "r1c" }, endBinding: { elementId: "r2c" } });
      expect(keepsRelationOnCopy(copy, new Set(["r1c", "r2c", "a1c"]))).toBe(true);
      // Copied alone, or with one end: still bound to an original, or unbound.
      expect(keepsRelationOnCopy(arrow({ id: "a1c" }), new Set(["a1c"]))).toBe(false);
      expect(keepsRelationOnCopy(arrow({ id: "a1c", endBinding: { elementId: "r2c" } }), new Set(["a1c", "r2c"]))).toBe(false);
      expect(keepsRelationOnCopy(arrow({ id: "a1c", startBinding: null, endBinding: null }), new Set(["a1c"]))).toBe(false);
    });

    it("a duplicated endpoint leaves the original relation as it was; the copy has none of its own", () => {
      const withCopy = [...shapes, el({ id: "r2c", type: "rectangle" }), arrow()];
      expect(deriveRelations(withCopy)).toEqual([{ id: "rel_a1", from: "r1", to: "r2", type: "caused_by", arrowId: "a1" }]);
    });

    it("ignores untyped arrows and unknown types", () => {
      expect(deriveRelations([...shapes, arrow({ customData: {} })])).toEqual([]);
      expect(deriveRelations([...shapes, arrow({ customData: { acuteRelation: "loves" } })])).toEqual([]);
    });
  });
});
