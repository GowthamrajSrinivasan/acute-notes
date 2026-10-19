import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { block, doc, note, pageDoc, para, shape } from "@/search/testFixtures";
import type { WorkspaceScan } from "../resources/workspaceScan";
import { McpSearchIndex, queryWords, SEARCH_LIMITS } from "./search";

/** A fake persisted workspace; each read returns fresh objects, like IndexedDB does. */
function workspace(scenes: Record<string, SceneElement[]>, docs: DocumentRecord[] = []) {
  const state = { scenes, docs };
  const clone = <T,>(v: T): T => structuredClone(v);
  const scan = {
    workspaceId: "ws",
    pages: async () => state.docs.filter((d) => d.kind === "page").map(clone),
    canvases: async () => Object.keys(state.scenes).map((id) => ({ id, title: `Canvas ${id}` })),
    scene: async (id: string) => (state.scenes[id] ?? []).map(clone),
    documents: async (ids: Iterable<string>) => new Map([...ids].flatMap((id) => state.docs.filter((d) => d.id === id).map((d) => [id, clone(d)] as const))),
  } as unknown as WorkspaceScan;
  return { state, search: new McpSearchIndex(scan) };
}

const text = (id: string, t: string, version = 1) => note(id, t, { version } as never);

describe("search_workspace ranking (over the F22 index)", () => {
  it("splits the query into distinct lower-case words, capped", async () => {
    expect(queryWords("  Retry  retry PAYMENT ")).toEqual(["retry", "payment"]);
    expect(queryWords("a b c d e f g h i j")).toHaveLength(SEARCH_LIMITS.words);
    expect((await workspace({ cv: [text("a", "x")] }).search.search("   ")).hits).toEqual([]);
  });

  it("needs every word; ranks the phrase and title matches first; ties keep scan order", async () => {
    const { search } = workspace(
      {
        cv: [
          text("words", "payment happens, then a retry"),
          text("phrase", "the payment retry loop"),
          block("title", "d-title", { version: 1 } as never),
          text("one", "payment only"),
          text("tie", "payment happens, then a retry"),
        ],
      },
      [doc("d-title", para("retry of the payment"), { title: "Payment retry plan" })],
    );
    const res = await search.search("payment retry");
    expect(res.hits.map((h) => h.id)).toEqual(["title", "phrase", "words", "tie"]);
    expect(res.total).toBe(4);
    expect(res.hits.find((h) => h.id === "phrase")!.snippet).toContain("payment retry");
    expect(res.hits[0]).toMatchObject({ kind: "text", canvasId: "cv", canvasUri: "acute://canvas/cv" });
  });

  it("caps occurrences per word, the result count, and the text that is read", async () => {
    expect((await workspace({ cv: [text("spam", "retry ".repeat(1000))] }).search.search("retry")).hits[0]!.matches).toBe(SEARCH_LIMITS.occurrences);
    expect((await workspace({ cv: [text("late", `${"x".repeat(SEARCH_LIMITS.textChars)} retry`)] }).search.search("retry")).total).toBe(0);
    const many = workspace({ cv: Array.from({ length: 80 }, (_, i) => text(`n${i}`, "retry")) });
    const res = await many.search.search("retry", { limit: 500 });
    expect(res.hits).toHaveLength(SEARCH_LIMITS.maxResults);
    expect(res.truncated).toBe(true);
  });

  it("filters by kind, with 'shape' covering the shape kinds; pages and canvases carry their URIs", async () => {
    const { search } = workspace(
      {
        cv: [
          shape("r"),
          note("r-label", "retry", { containerId: "r" }),
          shape("d", { type: "diamond" }),
          note("d-label", "retry", { containerId: "d" }),
          text("t", "retry"),
        ],
      },
      [pageDoc("p", "Retry page", para("retry"), { canvasId: "cv" })],
    );
    expect((await search.search("retry", { kinds: ["shape"] })).hits.map((h) => h.id)).toEqual(["r", "d"]);
    expect((await search.search("retry", { kinds: ["page"] })).hits).toEqual([expect.objectContaining({ id: "p", uri: "acute://page/p", canvasId: "cv" })]);
    const canvas = (await search.search("canvas", { kinds: ["canvas"] })).hits[0]!;
    expect(canvas).toMatchObject({ id: "cv", uri: "acute://canvas/cv" });
    expect(canvas.canvasId).toBeUndefined();
  });
});

describe("search_workspace index across calls", () => {
  it("re-indexes only what changed since the last call, and drops what was removed", async () => {
    const { state, search } = workspace(
      { cv: [text("a", "alpha retry"), block("b", "d-b", { version: 1 } as never)], other: [text("o", "retry elsewhere")] },
      [doc("d-b", para("retry block"), { updatedAt: 1 })],
    );
    expect((await search.refresh()).reindexed).toBe(3);
    // Nothing changed (fresh objects from storage, same versions and updatedAt): no work.
    expect((await search.refresh()).reindexed).toBe(0);

    state.scenes.cv = [text("a", "alpha only", 2), block("b", "d-b", { version: 1 } as never)];
    expect((await search.refresh()).reindexed).toBe(1);
    state.docs = [doc("d-b", para("block without the word"), { updatedAt: 2 })];
    expect((await search.refresh()).reindexed).toBe(1);
    expect((await search.search("retry")).hits.map((h) => h.id)).toEqual(["o"]);

    delete state.scenes.other;
    expect((await search.search("retry")).total).toBe(0);
  });

  it("never finds or returns a pasted credential", async () => {
    const token = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const { search } = workspace({ cv: [text("s", `deploy key ${token} for retry`)] });
    const res = await search.search("retry");
    expect(res.hits.map((h) => h.id)).toEqual(["s"]);
    expect(JSON.stringify(res)).not.toContain(token);
    expect((await search.search(token)).total).toBe(0);
  });
});
