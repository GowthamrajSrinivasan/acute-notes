import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { canvasDocId } from "@/sync/docIds";
import type { AgentChangeRecord, AgentSessionRecord } from "@/ai/changes/agentState";
import type { DocumentRecord } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { openWorkspace } from "@/persistence/workspaceBootstrap";
import { richDocKey } from "@/state/documentClone";
import {
  createCanvas,
  createWorkspace,
  deleteCanvas,
  deleteWorkspace,
  DEFAULT_CANVAS_TITLE,
  HierarchyError,
  listHierarchy,
  moveCanvas,
  renameCanvas,
  renameWorkspace,
} from "./hierarchy";

function doc(id: string, workspaceId: string, kind: DocumentRecord["kind"], canvasId?: string): DocumentRecord {
  return { id, workspaceId, kind, ...(canvasId ? { canvasId } : {}), title: id, snapshot: [], createdAt: 1, updatedAt: 1 };
}

/** Writes a scene embedding the given rich-block documents into a canvas. */
async function embedBlocks(s: PersistenceServices, canvasId: string, blockIds: string[]) {
  const ydoc = new Y.Doc();
  const elements = ydoc.getMap("elements");
  blockIds.forEach((documentId, i) =>
    elements.set(`el${i}`, {
      id: `el${i}`,
      type: "embeddable",
      version: 1,
      customData: { acute: { kind: "rich-block", blockType: "text", documentId } },
    }),
  );
  await s.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
}

/** A workspace with two canvases, each with a page and a block; returns their ids. */
async function seed(s: PersistenceServices) {
  const { workspace, canvas: p1 } = await createWorkspace(s, "Work");
  const p2 = await createCanvas(s, workspace.id, "Second");
  for (const [p, n] of [[p1, 1], [p2, 2]] as const) {
    await s.documents.put(doc(`page_${n}`, workspace.id, "page", p.id));
    await s.documents.put(doc(`doc_${n}`, workspace.id, "block"));
    await s.yupdates.append(richDocKey(`doc_${n}`), new Uint8Array([n]));
    await embedBlocks(s, p.id, [`doc_${n}`]);
  }
  return { ws: workspace.id, p1: p1.id, p2: p2.id };
}

describe("workspace hierarchy", () => {
  it("creates workspaces with a first canvas and lists them in order", async () => {
    const s = createMemoryServices();
    const { ws, p1, p2 } = await seed(s);
    const tree = await listHierarchy(s);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.workspace.id).toBe(ws);
    expect(tree[0]!.canvases.map((p) => p.id)).toEqual([p1, p2]);
    expect(tree[0]!.canvases[0]!.title).toBe(DEFAULT_CANVAS_TITLE);
  });

  it("renames workspaces and canvases, falling back to a default for blank names", async () => {
    const s = createMemoryServices();
    const { ws, p1 } = await seed(s);
    expect((await renameWorkspace(s, ws, "  Research  ")).name).toBe("Research");
    expect((await renameCanvas(s, p1, "Roadmap")).title).toBe("Roadmap");
    expect((await renameCanvas(s, p1, "   ")).title).toBe(DEFAULT_CANVAS_TITLE);
  });

  it("deletes a canvas with its scene, pages and blocks only", async () => {
    const s = createMemoryServices();
    const { ws, p1, p2 } = await seed(s);
    expect((await deleteCanvas(s, p1)).sort()).toEqual(["doc_1", "page_1"]);

    expect(await s.canvases.get(p1)).toBeNull();
    expect((await s.workspaces.get(ws))?.canvasIds).toEqual([p2]);
    expect((await s.yupdates.load(canvasDocId(p1))).updates).toHaveLength(0);
    expect((await s.yupdates.load(richDocKey("doc_1"))).updates).toHaveLength(0);
    expect((await s.documents.listByWorkspace(ws)).map((d) => d.id).sort()).toEqual(["doc_2", "page_2"]);
  });

  it("never deletes or moves away a workspace's last canvas", async () => {
    const s = createMemoryServices();
    const { workspace, canvas } = await createWorkspace(s);
    const other = await createWorkspace(s, "Other");
    await expect(deleteCanvas(s, canvas.id)).rejects.toBeInstanceOf(HierarchyError);
    await expect(moveCanvas(s, canvas.id, other.workspace.id)).rejects.toBeInstanceOf(HierarchyError);
    expect((await s.workspaces.get(workspace.id))?.canvasIds).toEqual([canvas.id]);
  });

  it("moves a canvas with its pages and blocks to another workspace", async () => {
    const s = createMemoryServices();
    const { ws, p1, p2 } = await seed(s);
    const { workspace: target, canvas: t1 } = await createWorkspace(s, "Target");

    expect((await moveCanvas(s, p1, target.id)).sort()).toEqual(["doc_1", "page_1"]);
    expect((await s.canvases.get(p1))?.workspaceId).toBe(target.id);
    expect((await s.workspaces.get(ws))?.canvasIds).toEqual([p2]);
    expect((await s.workspaces.get(target.id))?.canvasIds).toEqual([t1.id, p1]);
    expect((await s.documents.get("page_1"))).toMatchObject({ workspaceId: target.id, canvasId: p1 });
    expect((await s.documents.get("doc_1"))?.workspaceId).toBe(target.id);
    expect((await s.documents.get("doc_2"))?.workspaceId).toBe(ws);
  });

  it("deletes a workspace with everything in it", async () => {
    const s = createMemoryServices();
    const { ws, p1, p2 } = await seed(s);
    const keep = await createWorkspace(s, "Keep");
    await s.documents.put(doc("orphan", ws, "block"));

    expect((await deleteWorkspace(s, ws)).sort()).toEqual(["doc_1", "doc_2", "orphan", "page_1", "page_2"]);
    expect(await s.workspaces.get(ws)).toBeNull();
    expect(await s.canvases.get(p1)).toBeNull();
    expect(await s.canvases.get(p2)).toBeNull();
    expect(await s.documents.listByWorkspace(ws)).toHaveLength(0);
    expect((await listHierarchy(s)).map((n) => n.workspace.id)).toEqual([keep.workspace.id]);
  });

  it("deletes the workspace's agent change log and sessions, and no other workspace's", async () => {
    const s = createMemoryServices();
    const { ws, p1 } = await seed(s);
    const keep = await createWorkspace(s, "Keep");
    const change = (id: string, workspaceId: string, canvasId: string): AgentChangeRecord => ({
      id, workspaceId, canvasId, operationId: `op_${id}`, tool: "create_shape", at: 1, outcome: "accepted", title: id, touched: [], inverse: [], revertible: false,
    });
    const session = (id: string, workspaceId: string): AgentSessionRecord => ({ id, workspaceId, startedAt: 1, changeIds: [] });
    await s.agentState.putChange(change("chg_gone", ws, p1));
    await s.agentState.putSession(session("mcp_gone", ws));
    await s.agentState.putChange(change("chg_kept", keep.workspace.id, keep.canvas.id));
    await s.agentState.putSession(session("mcp_kept", keep.workspace.id));

    await deleteWorkspace(s, ws);
    expect(await s.agentState.listChanges(ws)).toEqual([]);
    expect(await s.agentState.listSessions(ws)).toEqual([]);
    expect((await s.agentState.listChanges(keep.workspace.id)).map((r) => r.id)).toEqual(["chg_kept"]);
    expect((await s.agentState.listSessions(keep.workspace.id)).map((r) => r.id)).toEqual(["mcp_kept"]);
  });
});

describe("opening a workspace", () => {
  it("opens the requested canvas, else the last opened, else the first", async () => {
    const s = createMemoryServices();
    const { ws, p1, p2 } = await seed(s);
    expect((await openWorkspace(s, ws, p2)).canvas.id).toBe(p2);
    expect((await openWorkspace(s, ws)).canvas.id).toBe(p1);
    await s.meta.set(`ui.lastCanvas/${ws}`, p2);
    expect((await openWorkspace(s, ws)).canvas.id).toBe(p2);
    // A canvas of another workspace (or a deleted one) is not opened here.
    expect((await openWorkspace(s, ws, "cv_missing")).canvas.id).toBe(p1);
  });

  it("sees canvases created after an earlier open", async () => {
    const s = createMemoryServices();
    const { workspace } = await createWorkspace(s);
    await openWorkspace(s, workspace.id);
    const added = await createCanvas(s, workspace.id);
    expect((await openWorkspace(s, workspace.id, added.id)).canvas.id).toBe(added.id);
  });

  it("assigns pages without a canvas to the first canvas", async () => {
    const s = createMemoryServices();
    const { ws, p1, p2 } = await seed(s);
    await s.documents.put(doc("legacy", ws, "page"));
    await s.documents.put(doc("stale", ws, "page", "cv_deleted"));
    await openWorkspace(s, ws, p2);
    expect((await s.documents.get("legacy"))?.canvasId).toBe(p1);
    expect((await s.documents.get("stale"))?.canvasId).toBe(p1);
    expect((await s.documents.get("page_2"))?.canvasId).toBe(p2);
  });
});
