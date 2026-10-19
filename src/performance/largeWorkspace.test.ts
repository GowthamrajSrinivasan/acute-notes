/**
 * Synthetic large-workspace checks (PRD §17.3, §8.1). Timings belong to the
 * browser suite (`scripts/perf/`); these tests pin the *shape* of the work at
 * scale — what is written, read and recorded per interaction — so a
 * regression to full-scene serialization or per-document round trips fails
 * here, deterministically.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import type { DocumentRecord } from "@/domain/types";
import { CanvasHistory } from "@/history/canvasHistory";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { DocumentStore } from "@/state/documentStore";
import { DocumentProvider } from "@/sync/DocumentProvider";
import { SceneBinding } from "@/sync/sceneBinding";
import { createWorkspace } from "@/workspaces/hierarchy";
import { ensureDocumentIntegrity } from "@/workspaces/integrity";

interface El {
  id: string;
  version: number;
  index: string;
  isDeleted: boolean;
  x: number;
  y: number;
  text: string;
}

const scene = (n: number): El[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `el${i}`,
    version: 1,
    index: `a${String(i).padStart(4, "0")}`,
    isDeleted: false,
    x: i * 10,
    y: 0,
    text: `Synthetic element ${i} with some text so each element has a realistic size`,
  }));

const move = (els: El[], id: string, dx: number) =>
  els.map((e) => (e.id === id ? { ...e, x: e.x + dx, version: e.version + 1 } : e));

function doc(id: string, workspaceId: string, kind: DocumentRecord["kind"]): DocumentRecord {
  return { id, workspaceId, kind, title: id, snapshot: [{ id: `${id}-b`, type: "paragraph", content: id }], createdAt: 1, updatedAt: 1 };
}

/** Wraps the document repository to count storage round trips. */
function countDocumentReads(s: PersistenceServices) {
  const calls = { get: 0, getMany: 0 };
  const { get, getMany } = s.documents;
  s.documents.get = (id) => (calls.get++, get(id));
  s.documents.getMany = (ids) => (calls.getMany++, getMany(ids));
  return calls;
}

describe("1,000-element canvas persistence", () => {
  it("moving one element writes one element, not the scene", () => {
    const ydoc = new Y.Doc();
    const binding = new SceneBinding(ydoc.getMap<El>("elements"));
    let els = scene(1000);
    ydoc.transact(() => binding.commit(els));
    const full = Y.encodeStateAsUpdate(ydoc).byteLength;

    const updates: Uint8Array[] = [];
    ydoc.on("update", (u: Uint8Array) => updates.push(u));
    els = move(els, "el500", 40);
    let written = 0;
    ydoc.transact(() => (written = binding.commit(els)));

    expect(written).toBe(1);
    expect(updates).toHaveLength(1);
    // The incremental update is a tiny fraction of the scene.
    expect(updates[0]!.byteLength).toBeLessThan(full / 200);
  });

  it("buffers a burst of changes into one storage write", async () => {
    const s = createMemoryServices();
    let appends = 0;
    const append = s.yupdates.append;
    s.yupdates.append = (id, u) => (appends++, append(id, u));
    const provider = new DocumentProvider("canvas/perf", s.yupdates, { flushDelay: 10_000 });
    await provider.load();
    const binding = new SceneBinding(provider.doc.getMap<El>("elements"));
    let els = scene(1000);
    provider.applyLocalChange(() => binding.commit(els));
    for (let i = 0; i < 50; i++) {
      els = move(els, `el${i}`, 5);
      provider.applyLocalChange(() => binding.commit(els));
    }
    await provider.flush();
    expect(appends).toBe(1);

    // Reopening replays it; a long log is compacted to one entry.
    for (let i = 0; i < 60; i++) await s.yupdates.append("canvas/perf", Y.encodeStateAsUpdate(new Y.Doc()));
    const reopened = new DocumentProvider("canvas/perf", s.yupdates);
    await reopened.load();
    expect(reopened.doc.getMap("elements").size).toBe(1000);
    expect((await s.yupdates.load("canvas/perf")).keys).toHaveLength(1);
    await provider.dispose();
    await reopened.dispose();
  });
});

describe("1,000-element canvas history", () => {
  it("a long drag of one element is one step with one change", () => {
    let els = scene(1000);
    let diffs = 0;
    const history = new CanvasHistory<El>({
      getElements: () => (diffs++, els),
      apply: (next) => (els = next),
      bump: (t, above) => ({ ...t, version: above + 1 }),
      markDeleted: (el) => ({ ...el, isDeleted: true }),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    history.init(els);
    history.noteUserInput();
    // Excalidraw mutates the dragged element in place: the scene array stays the same.
    const dragged = els[500]!;
    for (let i = 0; i < 300; i++) {
      (dragged as { x: number }).x += 1;
      (dragged as { version: number }).version += 1;
      history.observe(els, { interacting: true, editing: false });
    }
    // Pointer events never read the scene back.
    expect(diffs).toBe(0);
    els = [...els];
    history.observe(els, { interacting: false, editing: false });
    history.commit();
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(els.find((e) => e.id === "el500")!.x).toBe(5000);
    expect(els.filter((e, i) => e.x !== i * 10)).toHaveLength(0);
  });
});

describe("opening a canvas with many blocks and pages", () => {
  async function seededCanvas(blocks: number, pages: number) {
    const s = createMemoryServices();
    const { workspace, canvas } = await createWorkspace(s);
    const ydoc = new Y.Doc();
    const elements = ydoc.getMap("elements");
    for (let i = 0; i < blocks + pages; i++) {
      const page = i >= blocks;
      const id = page ? `page_${i}` : `doc_${i}`;
      await s.documents.put({ ...doc(id, workspace.id, page ? "page" : "block"), canvasId: canvas.id });
      const acute = page ? { kind: "page-preview", pageId: id, preview: false } : { kind: "rich-block", blockType: "text", documentId: id };
      elements.set(`e${i}`, { id: `e${i}`, type: "embeddable", version: 1, link: "", customData: { acute } });
    }
    await s.yupdates.append(canvasDocId(canvas.id), Y.encodeStateAsUpdate(ydoc));
    return { s, workspace, canvas };
  }

  it("reads every referenced document in one batch and returns them for the cache", async () => {
    const { s, workspace, canvas } = await seededCanvas(200, 50);
    const calls = countDocumentReads(s);
    const report = await ensureDocumentIntegrity(s, workspace, canvas.id);
    expect(calls).toEqual({ get: 0, getMany: 1 });
    expect(report.documents).toHaveLength(250);
    expect(report).toMatchObject({ copied: 0, assigned: 0 });
  });

  it("previews of primed documents need no storage reads", async () => {
    const { s, workspace, canvas } = await seededCanvas(100, 0);
    const { documents } = await ensureDocumentIntegrity(s, workspace, canvas.id);
    const calls = countDocumentReads(s);
    const store = new DocumentStore(s.documents);
    store.prime(documents);
    let notified = 0;
    for (const d of documents) store.subscribe(d.id, () => notified++);
    expect(calls.get).toBe(0);
    expect(documents.every((d) => store.get(d.id)?.id === d.id)).toBe(true);
    expect(notified).toBe(0);
  });

  it("priming keeps newer cached edits", () => {
    const s = createMemoryServices();
    const store = new DocumentStore(s.documents);
    void store.put({ ...doc("doc_x", "ws", "block"), title: "edited" });
    store.prime([doc("doc_x", "ws", "block")]);
    expect(store.get("doc_x")?.title).toBe("edited");
  });
});
