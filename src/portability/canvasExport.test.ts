import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import type { DocumentRecord } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { openWorkspace } from "@/persistence/workspaceBootstrap";
import { BundleError, parseBundle } from "./bundle";
import { canvasToMarkdown, DEFAULT_MARKDOWN_OPTIONS, MARKDOWN_OPTION_KEYS, type MarkdownOptions } from "./canvasMarkdown";
import { applyExportOptions, DEFAULT_EXPORT_OPTIONS } from "./exportOptions";
import { bundleFileName, exportCanvas, exportWorkspace, importCanvas, importWorkspace, inspectBundle } from "./workspaceBundle";

const WS = "default";

const record = (id: string, kind: DocumentRecord["kind"], snapshot: DocumentRecord["snapshot"], extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  workspaceId: WS,
  kind,
  title: id,
  snapshot,
  createdAt: 1,
  updatedAt: 2,
  metadata: { ai: { createdBy: "ai", operationId: "op_1" } },
  ...extra,
});

const el = (id: string, type: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, type, version: 1, index: `a${id}`, x, y, width: 100, height: 50, ...extra });

/** A canvas: a heading block, a row of two labelled shapes linked by a typed, labelled arrow, a page preview, an image and free text. */
async function seed(services: PersistenceServices) {
  const { canvas } = await openWorkspace(services, WS);
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of [
      el("b1", "embeddable", 0, 0, { link: "acute://block/doc_1", customData: { acute: { kind: "rich-block", blockType: "text", documentId: "doc_1", style: { frame: "card" } }, acuteLayout: { x: 0, y: 0 } } }),
      el("s2", "rectangle", 300, 210, { customData: { acuteMeta: { ai: { createdBy: "ai", operationId: "op_1" } } } }),
      el("s1", "rectangle", 0, 200),
      el("t1", "text", 10, 210, { containerId: "s1", text: "Validate token" }),
      el("t2", "text", 310, 220, { containerId: "s2", text: "Create session" }),
      el("a1", "arrow", 100, 225, { startBinding: { elementId: "s1" }, endBinding: { elementId: "s2" }, customData: { acuteRelation: "depends_on" } }),
      el("t3", "text", 150, 225, { containerId: "a1", text: "then" }),
      el("p1", "embeddable", 0, 400, { link: "acute://page/page_1", customData: { acute: { kind: "page-preview", pageId: "page_1", preview: true } } }),
      el("i1", "image", 0, 600, { fileId: "file_1" }),
      el("n1", "text", 0, 700, { text: "Loose note" }),
      el("gone", "rectangle", 0, 900, { isDeleted: true }),
    ]) {
      m.set(e.id, e);
    }
    doc.getMap("meta").set("viewBackgroundColor", "#fdf6e3");
  });
  await services.yupdates.append(canvasDocId(canvas.id), Y.encodeStateAsUpdate(doc));
  await services.documents.put(record("doc_1", "block", [{ type: "heading", props: { level: 2 }, content: "Login flow" }]));
  await services.documents.put(record("page_1", "page", [{ type: "paragraph", content: "Runbook body" }], { title: "Runbook" }));
  await services.documents.put(record("page_mine", "page", [], { canvasId: canvas.id }));
  await services.documents.put(record("page_elsewhere", "page", [], { canvasId: "cv_other" }));
  await services.assets.put({ id: "file_1", mimeType: "image/png", createdAt: 5, blob: new Blob([new Uint8Array([137, 80, 78, 71])]) });
  await services.canvases.put({ ...canvas, title: "Auth notes", viewport: { x: 10, y: 20, zoom: 1.5 } });
  return canvas.id;
}

describe("canvas export (JSON)", () => {
  it("is a valid bundle of that canvas only: its elements, the blocks it uses, and its own and previewed pages", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const bundle = await exportCanvas(services, WS, canvasId);
    expect(bundle.scope).toBe("canvas");
    expect(bundle.canvases.map((c) => c.id)).toEqual([canvasId]);
    expect(bundle.documents.map((d) => d.id).sort()).toEqual(["doc_1", "page_1", "page_mine"]);
    expect(bundle.assets.map((a) => a.id)).toEqual(["file_1"]);
    expect(() => parseBundle(JSON.parse(JSON.stringify(bundle)))).not.toThrow();
    expect(bundleFileName(bundle)).toMatch(/^auth-notes-\d{4}-\d{2}-\d{2}\.acute\.json$/);
    expect(bundleFileName(bundle, ".md")).toMatch(/^auth-notes-.*\.md$/);
  });

  it("is refused by workspace import (it would replace the whole workspace with one canvas), writing nothing", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const bundle = await exportCanvas(services, WS, canvasId);
    await expect(importWorkspace(services, JSON.parse(JSON.stringify(bundle)))).rejects.toThrow(BundleError);
    expect(await services.documents.get("page_elsewhere")).not.toBeNull();
  });
});

describe("canvas import (a copy added to a workspace)", () => {
  async function exported() {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const bundle = JSON.parse(JSON.stringify(await exportCanvas(services, WS, canvasId))) as unknown;
    return { services, canvasId, bundle };
  }

  async function scene(services: PersistenceServices, canvasId: string) {
    const doc = new Y.Doc();
    for (const u of (await services.yupdates.load(canvasDocId(canvasId))).updates) Y.applyUpdate(doc, u);
    return doc.getMap<Record<string, unknown>>("elements");
  }

  it("inspects as a canvas import", async () => {
    const { bundle } = await exported();
    expect(inspectBundle(bundle).summary).toMatchObject({ scope: "canvas", canvasTitle: "Auth notes", canvases: 1, pages: 2, blocks: 1, assets: 1 });
  });

  it("adds the canvas with new ids everywhere, its embeds pointing at the copies, leaving the original untouched", async () => {
    const { services, canvasId, bundle } = await exported();
    const result = await importCanvas(services, bundle, WS);

    expect(result.canvasId).not.toBe(canvasId);
    const workspace = await services.workspaces.get(WS);
    expect(workspace!.canvasIds).toEqual([canvasId, result.canvasId]);
    expect(await services.canvases.get(result.canvasId)).toMatchObject({ workspaceId: WS, title: "Auth notes (imported)", viewport: { x: 10, y: 20, zoom: 1.5 } });

    const copy = await scene(services, result.canvasId);
    const block = copy.get("b1") as { customData: { acute: { documentId: string } }; link: string };
    const preview = copy.get("p1") as { customData: { acute: { pageId: string } } };
    expect(block.customData.acute.documentId).not.toBe("doc_1");
    expect(preview.customData.acute.pageId).not.toBe("page_1");
    expect(copy.has("gone")).toBe(false);
    expect((copy.get("a1") as { customData: { acuteRelation: string } }).customData.acuteRelation).toBe("depends_on");

    const copiedBlock = await services.documents.get(block.customData.acute.documentId);
    expect(copiedBlock).toMatchObject({ workspaceId: WS, kind: "block", snapshot: [{ type: "heading", content: "Login flow" }] });
    const original = await services.documents.get("doc_1");
    expect(original!.snapshot).toEqual([{ type: "heading", props: { level: 2 }, content: "Login flow" }]);
    const ownPages = (await services.documents.listByWorkspace(WS, "page")).filter((p) => p.canvasId === result.canvasId);
    expect(ownPages).toHaveLength(1);
    // The original canvas's scene is unchanged.
    expect(((await scene(services, canvasId)).get("b1") as { customData: { acute: { documentId: string } } }).customData.acute.documentId).toBe("doc_1");
  });

  it("imports the same file twice as two canvases", async () => {
    const { services, bundle } = await exported();
    const first = await importCanvas(services, bundle, WS);
    const second = await importCanvas(services, bundle, WS);
    expect(first.canvasId).not.toBe(second.canvasId);
    expect((await services.workspaces.get(WS))!.canvasIds).toHaveLength(3);
  });

  it("keeps the title when no canvas in the workspace has it", async () => {
    const { bundle } = await exported();
    const target = createMemoryServices();
    await openWorkspace(target, WS);
    const result = await importCanvas(target, bundle, WS);
    expect(result.canvasTitle).toBe("Auth notes");
    expect(await target.assets.has("file_1")).toBe(true);
  });

  it("refuses a workspace export, and an unknown workspace, writing nothing", async () => {
    const services = createMemoryServices();
    await seed(services);
    const workspaceBundle = JSON.parse(JSON.stringify(await exportWorkspace(services, WS))) as unknown;
    await expect(importCanvas(services, workspaceBundle, WS)).rejects.toThrow(BundleError);
    const { bundle } = await exported();
    await expect(importCanvas(services, bundle, "nope")).rejects.toThrow(/not found/);
    expect((await services.workspaces.get(WS))!.canvasIds).toHaveLength(1);
  });
});

describe("export options", () => {
  it("everything is on by default and changes nothing", async () => {
    const services = createMemoryServices();
    const bundle = await exportCanvas(services, WS, await seed(services));
    expect(applyExportOptions(bundle, DEFAULT_EXPORT_OPTIONS)).toEqual(bundle);
  });

  it("each option off strips only its detail; the content stays, and the file stays valid", async () => {
    const services = createMemoryServices();
    const bundle = await exportCanvas(services, WS, await seed(services));
    const off = applyExportOptions(bundle, { origin: false, blockStyles: false, connectionTypes: false, images: false, viewSettings: false, layoutHints: false });
    const els = new Map(off.canvases[0]!.elements.map((e) => [e.id, e.customData as Record<string, unknown> | undefined]));
    expect(els.get("b1")).toEqual({ acute: { kind: "rich-block", blockType: "text", documentId: "doc_1" } }); // no style, no layout hint
    expect(els.get("s2")).toEqual({}); // no origin
    expect(els.get("a1")).toEqual({}); // no relation type
    expect(off.documents.every((d) => d.metadata === undefined)).toBe(true);
    expect(off.relations).toEqual([]);
    expect(off.assets).toEqual([]);
    expect(off.canvases[0]).not.toHaveProperty("viewport");
    expect(off.canvases[0]).not.toHaveProperty("viewBackgroundColor");
    expect(off.canvases[0]!.elements).toHaveLength(bundle.canvases[0]!.elements.length);
    expect(off.documents.map((d) => d.snapshot)).toEqual(bundle.documents.map((d) => d.snapshot));
    expect(() => parseBundle(JSON.parse(JSON.stringify(off)))).not.toThrow();
    // The original is untouched.
    expect(bundle.assets).toHaveLength(1);
  });
});

describe("canvas as Markdown (from the JSON)", () => {
  it("title, then objects in reading order, then the connections with their types and labels", async () => {
    const services = createMemoryServices();
    const bundle = await exportCanvas(services, WS, await seed(services));
    expect(canvasToMarkdown(bundle)).toBe(
      [
        "# Auth notes",
        "## Login flow",
        "Validate token", // same row as "Create session" (tops within 24 px), so left to right
        "Create session",
        "## Runbook\n\nRunbook body",
        "*(image)*",
        "Loose note",
        '## Connections\n\n- Validate token → Create session (Depends on) — "then"',
      ].join("\n\n") + "\n",
    );
  });

  it("the defaults change nothing", async () => {
    const services = createMemoryServices();
    const bundle = await exportCanvas(services, WS, await seed(services));
    expect(canvasToMarkdown(bundle, undefined, DEFAULT_MARKDOWN_OPTIONS)).toBe(canvasToMarkdown(bundle));
  });

  it("each option off leaves out only its detail", async () => {
    const services = createMemoryServices();
    const bundle = await exportCanvas(services, WS, await seed(services));
    const without = (key: keyof MarkdownOptions) => canvasToMarkdown(bundle, undefined, { ...DEFAULT_MARKDOWN_OPTIONS, [key]: false });

    expect(without("pageContent")).toContain("## Runbook\n\n*(image)*");
    expect(without("pageContent")).not.toContain("Runbook body");
    expect(without("imagePlaceholders")).not.toContain("*(image)*");
    expect(without("connections")).not.toContain("## Connections");
    expect(without("connectionTypes")).toContain('- Validate token → Create session — "then"');
    for (const key of MARKDOWN_OPTION_KEYS) expect(without(key)).toContain("Validate token\n\nCreate session");
  });

  it("frame headings off drops the heading but not the frame's contents, and connections still name the frame", () => {
    const bundle = {
      format: "acute-notes",
      version: 1,
      exportedAt: 0,
      workspace: { id: WS, name: "w", createdAt: 0, updatedAt: 0 },
      canvases: [
        {
          id: "cv",
          title: "Framed",
          createdAt: 0,
          updatedAt: 0,
          elements: [
            el("f1", "frame", 0, 0, { name: "Backend" }),
            el("n1", "text", 10, 40, { text: "API" }),
            el("n2", "text", 10, 200, { text: "Client" }),
            el("a1", "arrow", 10, 100, { startBinding: { elementId: "n2" }, endBinding: { elementId: "f1" } }),
          ],
        },
      ],
      documents: [],
      relations: [],
      assets: [],
    } as unknown as Parameters<typeof canvasToMarkdown>[0];
    const off = canvasToMarkdown(bundle, undefined, { ...DEFAULT_MARKDOWN_OPTIONS, frameHeadings: false });
    expect(off).not.toContain("## Backend");
    expect(off).toContain("API");
    expect(off).toContain("- Client → Backend");
  });
});
