import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageStart, queryHash, sceneVersion } from "./paging";

describe("paging (G2)", () => {
  const scene = [
    { id: "a", version: 1 },
    { id: "b", version: 3 },
  ];

  it("gives a scene a version that changes with any edit, add or delete, and not with canvas order", () => {
    const v = sceneVersion([{ canvasId: "c1", elements: scene }]);
    expect(v).toMatch(/^[0-9a-f]{16}$/);
    expect(sceneVersion([{ canvasId: "c1", elements: scene }])).toBe(v);
    expect(sceneVersion([{ canvasId: "c1", elements: [scene[0]!, { id: "b", version: 4 }] }])).not.toBe(v);
    expect(sceneVersion([{ canvasId: "c1", elements: [...scene, { id: "c", version: 1 }] }])).not.toBe(v);
    expect(sceneVersion([{ canvasId: "c1", elements: [scene[0]!, { id: "b", version: 3, isDeleted: true }] }])).not.toBe(v);
    const two = [
      { canvasId: "c1", elements: scene },
      { canvasId: "c2", elements: [{ id: "x", version: 1 }] },
    ];
    expect(sceneVersion(two)).toBe(sceneVersion([...two].reverse()));
  });

  it("round-trips a cursor and rejects garbage", () => {
    const c = { k: "lens", v: "0123456789abcdef", o: 200, q: "deadbeef" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(encodeCursor(c)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor("not a cursor")).toBeNull();
    expect(decodeCursor(encodeCursor({ ...c, o: -1 }))).toBeNull();
  });

  it("continues only the same listing, query and version", () => {
    const q = queryHash({ root: "f1", limit: 2, cursor: "ignored" });
    expect(q).toBe(queryHash({ limit: 2, root: "f1" }));
    const cursor = encodeCursor({ k: "lens", v: "v1", o: 2, q });
    expect(pageStart(undefined, "lens", "v1", q)).toEqual({ ok: true, offset: 0 });
    expect(pageStart(cursor, "lens", "v1", q)).toEqual({ ok: true, offset: 2 });
    expect(pageStart(cursor, "lens", "v2", q)).toMatchObject({ ok: false, message: expect.stringMatching(/changed since the first page/) });
    expect(pageStart(cursor, "lens", "v1", queryHash({ root: "f2", limit: 2 }))).toMatchObject({ ok: false, message: expect.stringMatching(/different query/) });
    expect(pageStart(cursor, "canvas", "v1", q)).toMatchObject({ ok: false, message: expect.stringMatching(/isn't from this tool/) });
  });
});
