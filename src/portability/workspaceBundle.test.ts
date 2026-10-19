import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import type { DocumentRecord } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { openWorkspace } from "@/persistence/workspaceBootstrap";
import { richDocKey } from "@/state/documentClone";
import { BUNDLE_VERSION, BundleError, parseBundle } from "./bundle";
import { exportWorkspace, importWorkspace } from "./workspaceBundle";

const WS = "default";

const record = (id: string, kind: DocumentRecord["kind"], snapshot: DocumentRecord["snapshot"] = []): DocumentRecord => ({
  id,
  workspaceId: WS,
  kind,
  title: id,
  snapshot,
  createdAt: 1,
  updatedAt: 2,
  metadata: { ai: { createdBy: "ai", operationId: "op_1" } },
});

const el = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, version: 1, index: `a${id}`, ...extra });

async function seed(services: PersistenceServices) {
  const { canvas } = await openWorkspace(services, WS);
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of [
      el("r1", "rectangle"),
      el("r2", "rectangle"),
      el("a1", "arrow", { startBinding: { elementId: "r1" }, endBinding: { elementId: "r2" }, customData: { acuteRelation: "depends_on" } }),
      el("b1", "embeddable", { link: "acute://block/doc_1", customData: { acute: { kind: "rich-block", blockType: "text", documentId: "doc_1" } } }),
      el("p1", "embeddable", { link: "acute://page/page_1", customData: { acute: { kind: "page-preview", pageId: "page_1", preview: true } } }),
      el("i1", "image", { fileId: "file_1" }),
      el("gone", "rectangle", { isDeleted: true }),
    ]) {
      m.set(e.id, e);
    }
    doc.getMap("meta").set("viewBackgroundColor", "#fdf6e3");
  });
  await services.yupdates.append(canvasDocId(canvas.id), Y.encodeStateAsUpdate(doc));
  await services.documents.put(record("page_1", "page", [{ type: "paragraph", content: "Page one" }]));
  await services.documents.put(record("page_2", "page"));
  await services.documents.put(record("doc_1", "block", [{ type: "heading", props: { level: 2 }, content: "Block" }]));
  await services.documents.put(record("doc_orphan", "block"));
  await services.assets.put({ id: "file_1", mimeType: "image/png", createdAt: 5, blob: new Blob([new Uint8Array([137, 80, 78, 71])]) });
  await services.canvases.put({ ...canvas, viewport: { x: 10, y: 20, zoom: 1.5 } });
  return canvas.id;
}

async function sceneOf(services: PersistenceServices, canvasId: string) {
  const doc = new Y.Doc();
  for (const u of (await services.yupdates.load(canvasDocId(canvasId))).updates) Y.applyUpdate(doc, u);
  return doc;
}

describe("workspace bundle", () => {
  it("exports persisted state with stable ids, pages, used blocks, relations and assets", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const bundle = await exportWorkspace(services, WS);

    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.canvases[0]!.id).toBe(canvasId);
    expect(bundle.canvases[0]!.elements.map((e) => e.id)).toEqual(["a1", "b1", "i1", "p1", "r1", "r2"]);
    expect(bundle.canvases[0]).toMatchObject({ viewport: { x: 10, y: 20, zoom: 1.5 }, viewBackgroundColor: "#fdf6e3" });
    expect(bundle.documents.map((d) => d.id).sort()).toEqual(["doc_1", "page_1", "page_2"]);
    expect(bundle.documents.find((d) => d.id === "page_1")?.metadata).toEqual({ ai: { createdBy: "ai", operationId: "op_1" } });
    expect(bundle.relations).toEqual([{ id: "rel_a1", from: "r1", to: "r2", type: "depends_on", arrowId: "a1" }]);
    expect(bundle.assets).toEqual([{ id: "file_1", mimeType: "image/png", createdAt: 5, dataURL: "data:image/png;base64,iVBORw==" }]);
    expect(() => parseBundle(JSON.parse(JSON.stringify(bundle)))).not.toThrow();
  });

  it("exports the images pages show, and imports them back", async () => {
    const services = createMemoryServices();
    await seed(services);
    await services.documents.put(record("page_2", "page", [{ type: "image", props: { url: "acute-asset://page_img", name: "shot.png" } }]));
    await services.assets.put({ id: "page_img", mimeType: "image/png", createdAt: 6, blob: new Blob([new Uint8Array([137, 80, 78, 71])]) });
    const bundle = await exportWorkspace(services, WS);
    expect(bundle.assets.map((a) => a.id).sort()).toEqual(["file_1", "page_img"]);

    const target = createMemoryServices();
    await importWorkspace(target, parseBundle(JSON.parse(JSON.stringify(bundle))));
    expect(await target.assets.has("page_img")).toBe(true);
    expect((await target.documents.get("page_2"))?.snapshot).toEqual([{ type: "image", props: { url: "acute-asset://page_img", name: "shot.png" } }]);
  });

  it("carries only known, bounded provenance on export and import (F25)", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    await services.documents.put({ ...record("page_1", "page"), metadata: { ai: { createdBy: "ai", operationId: "op_1", apiKey: "sk-live" }, secret: "x" } as never });
    const doc = await sceneOf(services, canvasId);
    doc.getMap("elements").set("r1", el("r1", "rectangle", { version: 2, customData: { acuteMeta: { ai: { createdBy: "mcp", token: "ghp_1" } } } }));
    await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));

    const bundle = await exportWorkspace(services, WS);
    expect(bundle.documents.find((d) => d.id === "page_1")?.metadata).toEqual({ ai: { createdBy: "ai", operationId: "op_1" } });
    expect(bundle.canvases[0]!.elements.find((e) => e.id === "r1")?.customData).toEqual({ acuteMeta: { ai: { createdBy: "mcp" } } });
    expect(JSON.stringify(bundle)).not.toMatch(/sk-live|ghp_1|secret/);

    // Import sanitizes too: a hand-edited bundle can't smuggle fields in.
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.documents.find((d: { id: string }) => d.id === "page_1").metadata.ai.password = "hunter2";
    tampered.canvases[0].elements.find((e: { id: string }) => e.id === "r1").customData.acuteMeta.ai.createdBy = "robot";
    const target = createMemoryServices();
    await importWorkspace(target, tampered);
    const pages = await target.documents.listByWorkspace(WS, "page");
    expect(JSON.stringify(pages)).not.toContain("hunter2");
    const scene = await target.canvases.listByWorkspace(WS);
    const imported = await sceneOf(target, scene[0]!.id);
    expect((imported.getMap("elements").get("r1") as { customData?: unknown } | undefined)?.customData).toEqual({});
  });

  it("never includes AI conversations (they are device-local)", async () => {
    const services = createMemoryServices();
    await seed(services);
    await services.aiConversations.append(
      { id: "conv_secret", schemaVersion: 1, workspaceId: WS, canvasId: "cv", anchorIds: ["b1"], anchorLabel: "x", title: "Private chat", scope: "selection", turnCount: 1, createdAt: 0, updatedAt: 0 },
      [{ conversationId: "conv_secret", seq: 0, role: "user", createdAt: 0, text: "confidential question", scope: "selection", sourceIds: [] }],
    );
    const json = JSON.stringify(await exportWorkspace(services, WS));
    expect(json).not.toContain("conv_secret");
    expect(json).not.toContain("confidential question");
  });

  it("round-trips through JSON into empty storage", async () => {
    const source = createMemoryServices();
    const canvasId = await seed(source);
    const json = JSON.stringify(await exportWorkspace(source, WS));

    const target = createMemoryServices();
    const summary = await importWorkspace(target, JSON.parse(json));
    expect(summary).toMatchObject({ workspaceId: WS, canvases: 1, pages: 2, blocks: 1, assets: 1 });

    expect((await target.workspaces.get(WS))?.canvasIds).toEqual([canvasId]);
    expect((await target.canvases.get(canvasId))?.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
    const scene = await sceneOf(target, canvasId);
    expect([...scene.getMap("elements").keys()].sort()).toEqual(["a1", "b1", "i1", "p1", "r1", "r2"]);
    expect(scene.getMap("meta").get("viewBackgroundColor")).toBe("#fdf6e3");
    expect((await target.documents.get("page_1"))?.snapshot).toEqual([{ type: "paragraph", content: "Page one" }]);
    const asset = await target.assets.get("file_1");
    expect([...new Uint8Array(await asset!.blob.arrayBuffer())]).toEqual([137, 80, 78, 71]);

    // Exporting the imported workspace gives the same content.
    const again = await exportWorkspace(target, WS);
    const original = JSON.parse(json);
    expect({ ...again, exportedAt: 0 }).toEqual({ ...original, exportedAt: 0 });
  });

  it("replaces the existing workspace: stale documents and their content are removed", async () => {
    const source = createMemoryServices();
    await seed(source);
    const bundle = JSON.parse(JSON.stringify(await exportWorkspace(source, WS)));

    const target = createMemoryServices();
    await openWorkspace(target, WS);
    await target.documents.put(record("page_local", "page"));
    await target.yupdates.append(richDocKey("page_local"), new Uint8Array([1]));
    await target.yupdates.append(richDocKey("page_1"), new Uint8Array([9])); // stale edit history
    await importWorkspace(target, bundle);

    expect(await target.documents.get("page_local")).toBeNull();
    expect((await target.yupdates.load(richDocKey("page_local"))).updates).toHaveLength(0);
    // Imported documents start from their snapshot, not an old history.
    expect((await target.yupdates.load(richDocKey("page_1"))).updates).toHaveLength(0);
  });

  it("rejects other files, newer versions, malformed content and duplicate ids without writing", async () => {
    const source = createMemoryServices();
    await seed(source);
    const bundle = JSON.parse(JSON.stringify(await exportWorkspace(source, WS)));
    const target = createMemoryServices();

    await expect(importWorkspace(target, { hello: "world" })).rejects.toThrow("isn't an Acute-Notes workspace");
    await expect(importWorkspace(target, { ...bundle, version: BUNDLE_VERSION + 1 })).rejects.toThrow("newer version");
    await expect(importWorkspace(target, { ...bundle, canvases: [{ ...bundle.canvases[0], elements: [{ type: "rectangle" }] }] })).rejects.toThrow(
      /damaged or incomplete \(at canvases\.0\.elements\.0\.id\)/,
    );
    await expect(importWorkspace(target, { ...bundle, documents: [...bundle.documents, bundle.documents[0]] })).rejects.toThrow("twice");
    await expect(importWorkspace(target, "not json")).rejects.toBeInstanceOf(BundleError);
    expect(await target.workspaces.get(WS)).toBeNull();
  });

  it("drops unsafe links from imported content and elements", async () => {
    const source = createMemoryServices();
    await seed(source);
    const bundle = JSON.parse(JSON.stringify(await exportWorkspace(source, WS)));
    bundle.documents[0].snapshot = [
      {
        type: "paragraph",
        content: [
          { type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "bad", styles: {} }] },
          { type: "link", href: "https://ok.example", content: [{ type: "text", text: "good", styles: {} }] },
        ],
      },
    ];
    bundle.canvases[0].elements.push({ id: "r3", type: "rectangle", version: 1, link: "javascript:alert(1)" });
    const target = createMemoryServices();
    await importWorkspace(target, bundle);

    const snapshot = (await target.documents.get(bundle.documents[0].id))!.snapshot;
    expect(snapshot[0]!.content).toEqual([
      { type: "text", text: "bad", styles: {} },
      { type: "link", href: "https://ok.example", content: [{ type: "text", text: "good", styles: {} }] },
    ]);
    const scene = await sceneOf(target, bundle.canvases[0].id);
    expect((scene.getMap("elements").get("r3") as { link: unknown }).link).toBeNull();
    expect((scene.getMap("elements").get("p1") as { link: unknown }).link).toBe("acute://page/page_1");
  });
});
