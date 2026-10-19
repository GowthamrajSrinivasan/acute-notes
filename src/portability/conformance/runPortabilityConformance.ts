/**
 * Portability contract: a workspace exported from any backend imports losslessly into any other (the canonical
 * `.acute.json` bundle is the safety net for changing storage engines). Pass every backend factory; each ordered
 * pair (source → target) is exercised, including a backend with itself.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DocumentRecord } from "@/domain/types";
import type { ServicesFactory } from "@/persistence/conformance/runPersistenceConformance";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { openWorkspace } from "@/persistence/workspaceBootstrap";
import { canvasDocId } from "@/sync/docIds";
import { parseBundle } from "../bundle";
import { exportWorkspace, importWorkspace } from "../workspaceBundle";

const WS = "default";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

const record = (id: string, kind: DocumentRecord["kind"], snapshot: DocumentRecord["snapshot"] = []): DocumentRecord => ({
  id,
  workspaceId: WS,
  kind,
  title: `Title ${id} ✓`,
  snapshot,
  createdAt: 1,
  updatedAt: 2,
  metadata: { ai: { createdBy: "mcp", operationId: "op_1" } },
});

const el = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, version: 1, index: `a${id}`, ...extra });

/** A workspace with a canvas scene (shapes, a relation, a block, a page card, a canvas image), pages, a block, and a page image. */
async function seed(services: PersistenceServices): Promise<string> {
  const { canvas } = await openWorkspace(services, WS);
  const scene = new Y.Doc();
  scene.transact(() => {
    const m = scene.getMap("elements");
    for (const e of [
      el("r1", "rectangle"),
      el("r2", "rectangle"),
      el("a1", "arrow", { startBinding: { elementId: "r1" }, endBinding: { elementId: "r2" }, customData: { acuteRelation: "depends_on" } }),
      el("b1", "embeddable", { link: "acute://block/doc_1", customData: { acute: { kind: "rich-block", blockType: "text", documentId: "doc_1" } } }),
      el("p1", "embeddable", { link: "acute://page/page_1", customData: { acute: { kind: "page-preview", pageId: "page_1", preview: true } } }),
      el("i1", "image", { fileId: "file_1" }),
    ]) {
      m.set(e.id, e);
    }
    scene.getMap("meta").set("viewBackgroundColor", "#fdf6e3");
  });
  await services.yupdates.append(canvasDocId(canvas.id), Y.encodeStateAsUpdate(scene));
  await services.documents.put(record("page_1", "page", [{ type: "paragraph", content: "Page one" }]));
  await services.documents.put(record("page_2", "page", [{ type: "image", props: { url: "acute-asset://page_img", name: "shot.png" } }]));
  await services.documents.put(record("doc_1", "block", [{ type: "heading", props: { level: 2 }, content: "Block" }]));
  await services.assets.put({ id: "file_1", mimeType: "image/png", createdAt: 5, blob: new Blob([PNG], { type: "image/png" }) });
  await services.assets.put({ id: "page_img", mimeType: "image/png", createdAt: 6, blob: new Blob([PNG], { type: "image/png" }) });
  await services.canvases.put({ ...canvas, viewport: { x: 10, y: 20, zoom: 1.5 } });
  // Device-local state that must never travel in a bundle.
  await services.aiConversations.append(
    { id: "conv_secret", schemaVersion: 1, workspaceId: WS, canvasId: canvas.id, anchorIds: [], anchorLabel: "x", title: "private chat", scope: "selection", turnCount: 1, createdAt: 0, updatedAt: 0 },
    [{ conversationId: "conv_secret", seq: 0, role: "user", createdAt: 0, text: "private text", scope: "selection", sourceIds: [] }],
  );
  return canvas.id;
}

export function runPortabilityConformance(backends: Record<string, ServicesFactory>): void {
  const names = Object.keys(backends);
  const pairs = names.flatMap((from) => names.map((to) => [from, to] as const));

  describe.each(pairs)("workspace bundle: %s → %s", (from, to) => {
    it("round-trips content, relations and image bytes losslessly, and leaves device-local state behind", async () => {
      const source = await backends[from]!();
      const canvasId = await seed(source);
      const exported = await exportWorkspace(source, WS);
      const json = JSON.stringify(exported);
      expect(json).not.toContain("private text");
      expect(json).not.toContain("conv_secret");

      const target = await backends[to]!();
      const summary = await importWorkspace(target, parseBundle(JSON.parse(json)));
      expect(summary).toMatchObject({ workspaceId: WS, canvases: 1, pages: 2, blocks: 1, assets: 2 });

      // Structure and content.
      expect((await target.workspaces.get(WS))?.canvasIds).toEqual([canvasId]);
      expect((await target.canvases.get(canvasId))?.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
      const scene = new Y.Doc();
      (await target.yupdates.load(canvasDocId(canvasId))).updates.forEach((u) => Y.applyUpdate(scene, u));
      expect([...scene.getMap("elements").keys()].sort()).toEqual(["a1", "b1", "i1", "p1", "r1", "r2"]);
      expect((await target.documents.get("page_2"))?.snapshot).toEqual([{ type: "image", props: { url: "acute-asset://page_img", name: "shot.png" } }]);

      // Images: byte-exact on both the canvas and the page.
      for (const id of ["file_1", "page_img"]) {
        const asset = await target.assets.get(id);
        expect(asset?.mimeType).toBe("image/png");
        expect(new Uint8Array(await asset!.blob.arrayBuffer())).toEqual(PNG);
      }

      // Device-local state did not travel.
      expect(await target.aiConversations.listByWorkspace(WS)).toEqual([]);

      // Exporting the import gives the same bundle.
      const again = await exportWorkspace(target, WS);
      expect({ ...again, exportedAt: 0 }).toEqual({ ...JSON.parse(json), exportedAt: 0 });
    });

    it("replaces an existing workspace in the target instead of merging stale content into it", async () => {
      const source = await backends[from]!();
      await seed(source);
      const target = await backends[to]!();
      await seed(target);
      await target.documents.put(record("stale_page", "page"));
      await importWorkspace(target, parseBundle(JSON.parse(JSON.stringify(await exportWorkspace(source, WS)))));
      expect(await target.documents.get("stale_page")).toBeNull();
      expect((await target.documents.listByWorkspace(WS)).map((d) => d.id).sort()).toEqual(["doc_1", "page_1", "page_2"]);
    });
  });
}
