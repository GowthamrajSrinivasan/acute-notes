/**
 * Note-taking mode per canvas (`.ai/docs/openui/note-taking-modes-plan-2026-11-23.md` Step 2): canvases without the field
 * are manual, creating and switching store only the canvas document, and switching never rewrites an object, a card,
 * provenance or study history (approval conditions 2 and 3).
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { recordAttempt } from "@/ai/study/store";
import { DEFAULT_NOTE_MODE, isNoteMode, noteModeOf } from "@/domain/noteMode";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { richDocKey } from "@/state/documentClone";
import { canvasDocId } from "@/sync/docIds";
import { createCanvas, createWorkspace, listHierarchy, renameCanvas, setCanvasNoteMode } from "./hierarchy";

/** Services whose every write is recorded as `<repository>.<method>`. */
function recording(): { s: PersistenceServices; writes: string[] } {
  const base = createMemoryServices();
  const keys = new Map<string, unknown>();
  const writes: string[] = [];
  const meta = { get: async <T,>(k: string) => keys.get(k) as T | undefined, set: async (k: string, v: unknown) => void keys.set(k, v), delete: async (k: string) => void keys.delete(k) };
  const s = { ...base, meta } as PersistenceServices;
  const READS = /^(get|list|load|has|count|find|query)/;
  for (const [name, repo] of Object.entries(s)) {
    if (!repo || typeof repo !== "object") continue;
    (s as unknown as Record<string, unknown>)[name] = new Proxy(repo, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function" || typeof prop !== "string" || READS.test(prop)) return value;
        return (...args: unknown[]) => {
          writes.push(`${name}.${prop}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }
  return { s, writes };
}

async function withScene(s: PersistenceServices, canvasId: string) {
  const doc = new Y.Doc();
  doc.getMap("elements").set("el1", { id: "el1", type: "embeddable", version: 1, customData: { acute: { kind: "rich-block", blockType: "text", documentId: "doc_1" } } });
  await s.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
  doc.destroy();
  await s.yupdates.append(richDocKey("doc_1"), new Uint8Array([1]));
}

describe("note-taking mode (Step 2)", () => {
  it("reads a canvas without the field as manual, and knows only the two modes", () => {
    expect(DEFAULT_NOTE_MODE).toBe("manual");
    expect(noteModeOf({})).toBe("manual");
    expect(noteModeOf(null)).toBe("manual");
    expect(noteModeOf({ noteMode: "ai" })).toBe("ai");
    expect(["manual", "ai", "AI", "", undefined, 1].map(isNoteMode)).toEqual([true, true, false, false, false, false]);
  });

  it("creates canvases in a mode; the default leaves the field off, as on canvases from before it", async () => {
    const s = createMemoryServices();
    const { workspace, canvas: first } = await createWorkspace(s, "Work");
    expect(first).not.toHaveProperty("noteMode");
    const manual = await createCanvas(s, workspace.id, "M", "manual");
    const ai = await createCanvas(s, workspace.id, "A", "ai");
    expect(manual).not.toHaveProperty("noteMode");
    expect((await s.canvases.get(ai.id))?.noteMode).toBe("ai");
    expect((await listHierarchy(s))[0]!.canvases.map((c) => noteModeOf(c))).toEqual(["manual", "manual", "ai"]);
  });

  it("switching writes only the canvas document: no scene, block, page, provenance or study history is touched", async () => {
    const { s, writes } = recording();
    const { workspace, canvas } = await createWorkspace(s, "Work");
    await withScene(s, canvas.id);
    await recordAttempt(s.meta, workspace.id, {
      concept: { key: "c:src_a:u1", local: false, sourceId: "src_a", units: ["u1"], sourceVersion: 1 },
      canvasId: canvas.id,
      title: "T",
      kind: "quiz",
      correct: false,
      at: 1,
    });
    const scene = (await s.yupdates.load(canvasDocId(canvas.id))).updates.length;
    const block = (await s.yupdates.load(richDocKey("doc_1"))).updates.length;

    writes.length = 0;
    const ai = await setCanvasNoteMode(s, canvas.id, "ai");
    expect(ai.noteMode).toBe("ai");
    expect(writes).toEqual(["canvases.put"]);

    writes.length = 0;
    const back = await setCanvasNoteMode(s, canvas.id, "manual");
    expect(back).not.toHaveProperty("noteMode");
    expect(writes).toEqual(["canvases.put"]);

    // Setting the mode it already has writes nothing at all.
    writes.length = 0;
    await setCanvasNoteMode(s, canvas.id, "manual");
    expect(writes).toEqual([]);

    expect((await s.yupdates.load(canvasDocId(canvas.id))).updates).toHaveLength(scene);
    expect((await s.yupdates.load(richDocKey("doc_1"))).updates).toHaveLength(block);
    expect(await s.meta.get(`study.${workspace.id}`)).toBeDefined();
  });

  it("keeps the title, viewport and creation time; a rename keeps the mode", async () => {
    const s = createMemoryServices();
    const { canvas } = await createWorkspace(s, "Work");
    await s.canvases.put({ ...canvas, title: "Notes", viewport: { x: 1, y: 2, zoom: 3 } });
    const ai = await setCanvasNoteMode(s, canvas.id, "ai");
    expect(ai).toMatchObject({ id: canvas.id, title: "Notes", viewport: { x: 1, y: 2, zoom: 3 }, createdAt: canvas.createdAt, noteMode: "ai" });
    expect((await renameCanvas(s, canvas.id, "Renamed")).noteMode).toBe("ai");
  });

  it("fails on a canvas that doesn't exist, writing nothing", async () => {
    const { s, writes } = recording();
    await expect(setCanvasNoteMode(s, "cv_missing", "ai")).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});
