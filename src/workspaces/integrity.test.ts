import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { openWorkspace } from "@/persistence/workspaceBootstrap";
import { exportWorkspace, importWorkspace } from "@/portability/workspaceBundle";
import { cloneStoredDocument } from "@/state/documentClone";
import { createCanvas, createWorkspace, moveCanvas } from "./hierarchy";
import { ensureDocumentIntegrity, markIntegrityUnchecked } from "./integrity";

function doc(id: string, workspaceId: string, kind: DocumentRecord["kind"], canvasId?: string): DocumentRecord {
  return {
    id,
    workspaceId,
    kind,
    ...(canvasId ? { canvasId } : {}),
    title: id,
    snapshot: [{ id: `${id}-block`, type: "paragraph", content: id }],
    createdAt: 1,
    updatedAt: 1,
  };
}

type Ref = { el: string; block?: string; page?: string };

async function writeScene(s: PersistenceServices, canvasId: string, refs: Ref[]) {
  const ydoc = new Y.Doc();
  const elements = ydoc.getMap("elements");
  for (const r of refs) {
    const acute = r.block
      ? { kind: "rich-block", blockType: "text", documentId: r.block }
      : { kind: "page-preview", pageId: r.page, preview: true };
    elements.set(r.el, { id: r.el, type: "embeddable", version: 1, link: "", customData: { acute } });
  }
  await s.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
}

/** Element id → the document it shows. */
async function sceneRefs(s: PersistenceServices, canvasId: string): Promise<Record<string, string>> {
  const ydoc = new Y.Doc();
  for (const u of (await s.yupdates.load(canvasDocId(canvasId))).updates) Y.applyUpdate(ydoc, u);
  const out: Record<string, string> = {};
  for (const el of ydoc.getMap<SceneElement>("elements").values()) {
    const ref = getEmbedRef(el);
    if (ref) out[el.id] = ref.kind === "rich-block" ? ref.documentId : ref.pageId;
  }
  ydoc.destroy();
  return out;
}

describe("document integrity", () => {
  it("gives a document shown twice in one canvas a copy for the second element", async () => {
    const s = createMemoryServices();
    const { workspace, canvas } = await createWorkspace(s);
    await s.documents.put(doc("doc_a", workspace.id, "block"));
    await writeScene(s, canvas.id, [{ el: "e1", block: "doc_a" }, { el: "e2", block: "doc_a" }]);

    const report = await ensureDocumentIntegrity(s, workspace, canvas.id);
    expect(report.copied).toBe(1);
    const refs = await sceneRefs(s, canvas.id);
    expect(refs.e1).toBe("doc_a");
    expect(refs.e2).not.toBe("doc_a");

    const copy = await s.documents.get(refs.e2!);
    expect(copy).toMatchObject({ kind: "block", workspaceId: workspace.id, canvasId: canvas.id });
    expect(copy!.snapshot[0]!.id).not.toBe("doc_a-block");
    expect((await s.documents.get("doc_a"))?.canvasId).toBe(canvas.id);
  });

  it("separates documents shared by two canvases and pages owned by another canvas", async () => {
    const s = createMemoryServices();
    const { workspace, canvas: p1 } = await createWorkspace(s);
    const p2 = await createCanvas(s, workspace.id);
    const ws = (await s.workspaces.get(workspace.id))!;
    await s.documents.put(doc("doc_shared", ws.id, "block"));
    await s.documents.put(doc("page_p1", ws.id, "page", p1.id));
    await writeScene(s, p1.id, [{ el: "a", block: "doc_shared" }, { el: "b", page: "page_p1" }]);
    await writeScene(s, p2.id, [{ el: "c", block: "doc_shared" }, { el: "d", page: "page_p1" }]);

    await ensureDocumentIntegrity(s, ws, p1.id); // first open: checks every canvas
    const r1 = await sceneRefs(s, p1.id);
    const r2 = await sceneRefs(s, p2.id);
    expect(r1).toEqual({ a: "doc_shared", b: "page_p1" });
    expect(r2.c).not.toBe("doc_shared");
    expect(r2.d).not.toBe("page_p1");
    expect((await s.documents.get(r2.c!))?.canvasId).toBe(p2.id);
    expect((await s.documents.get(r2.d!))).toMatchObject({ kind: "page", canvasId: p2.id });

    // Idempotent: nothing left to repair.
    await markIntegrityUnchecked(s, ws.id);
    expect(await ensureDocumentIntegrity(s, ws, p1.id)).toMatchObject({ copied: 0, assigned: 0 });
  });

  it("copies a document that belongs to another workspace", async () => {
    const s = createMemoryServices();
    const a = await createWorkspace(s, "A");
    const b = await createWorkspace(s, "B");
    await s.documents.put(doc("doc_a", a.workspace.id, "block", a.canvas.id));
    await writeScene(s, b.canvas.id, [{ el: "x", block: "doc_a" }]);

    const opened = await openWorkspace(s, b.workspace.id);
    const refs = await sceneRefs(s, b.canvas.id);
    expect(refs.x).not.toBe("doc_a");
    expect(opened.repairedDocuments).toContain(refs.x);
    expect((await s.documents.get(refs.x!))?.workspaceId).toBe(b.workspace.id);
    expect((await s.documents.get("doc_a"))?.workspaceId).toBe(a.workspace.id);
  });

  it("clones stored documents with new ids and new block ids", async () => {
    const s = createMemoryServices();
    await s.documents.put(doc("page_src", "ws", "page", "cv_1"));
    const id = await cloneStoredDocument(s, "page_src", { canvasId: "cv_2" });
    expect(id).toMatch(/^page_/);
    const copy = await s.documents.get(id!);
    expect(copy).toMatchObject({ kind: "page", workspaceId: "ws", canvasId: "cv_2" });
    expect(copy!.snapshot[0]!.id).not.toBe("page_src-block");
    expect(await cloneStoredDocument(s, "missing")).toBeNull();
  });

  it("moving a canvas keeps its documents owned by it", async () => {
    const s = createMemoryServices();
    const { workspace, canvas: p1 } = await createWorkspace(s);
    const p2 = await createCanvas(s, workspace.id);
    const target = await createWorkspace(s, "Target");
    await s.documents.put(doc("doc_1", workspace.id, "block", p2.id));
    await writeScene(s, p2.id, [{ el: "e", block: "doc_1" }]);
    await moveCanvas(s, p2.id, target.workspace.id);

    await openWorkspace(s, target.workspace.id, p2.id);
    expect(await sceneRefs(s, p2.id)).toEqual({ e: "doc_1" });
    expect(await s.documents.get("doc_1")).toMatchObject({ workspaceId: target.workspace.id, canvasId: p2.id });
    expect(p1.workspaceId).toBe(workspace.id);
  });
});

describe("importing next to other workspaces", () => {
  it("re-ids content that another workspace on this device already owns", async () => {
    const s = createMemoryServices();
    const { workspace, canvas } = await createWorkspace(s, "Source");
    const extra = await createCanvas(s, workspace.id);
    await s.documents.put(doc("doc_1", workspace.id, "block", extra.id));
    await s.documents.put(doc("page_1", workspace.id, "page", extra.id));
    await writeScene(s, extra.id, [{ el: "e1", block: "doc_1" }, { el: "e2", page: "page_1" }]);
    const bundle = await exportWorkspace(s, workspace.id);

    // After the export, the canvas moves to another workspace…
    const other = await createWorkspace(s, "Other");
    await moveCanvas(s, extra.id, other.workspace.id);
    // …and the old export is imported again.
    await importWorkspace(s, bundle);

    // The other workspace's content is untouched.
    expect(await s.canvases.get(extra.id)).toMatchObject({ workspaceId: other.workspace.id });
    expect(await s.documents.get("doc_1")).toMatchObject({ workspaceId: other.workspace.id, snapshot: [{ id: "doc_1-block" }] });
    expect(await sceneRefs(s, extra.id)).toEqual({ e1: "doc_1", e2: "page_1" });

    // The imported workspace got its own copies with new ids throughout.
    const imported = (await s.workspaces.get(workspace.id))!;
    expect(imported.canvasIds).toHaveLength(2);
    expect(imported.canvasIds[0]).toBe(canvas.id);
    const newCanvas = imported.canvasIds[1]!;
    expect(newCanvas).not.toBe(extra.id);
    const refs = await sceneRefs(s, newCanvas);
    expect(refs.e1).not.toBe("doc_1");
    expect(refs.e2).not.toBe("page_1");
    const block = await s.documents.get(refs.e1!);
    expect(block).toMatchObject({ workspaceId: workspace.id, canvasId: newCanvas });
    expect(block!.snapshot[0]!.id).not.toBe("doc_1-block");
    expect(await s.documents.get(refs.e2!)).toMatchObject({ kind: "page", canvasId: newCanvas });
  });
});
