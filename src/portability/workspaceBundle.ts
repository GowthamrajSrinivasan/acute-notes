/**
 * Workspace export / import (F17), written purely against the repository
 * interfaces: export reads persisted state (callers flush live editors
 * first) and never touches live UI state; import validates everything before
 * writing anything, then replaces the workspace.
 */
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import { deriveRelations, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { collectAssetIds } from "@/domain/content/assetUrl";
import type { CanvasDocument, DocumentRecord, RichContent, Workspace } from "@/domain/types";
import type { PersistenceServices } from "@/persistence";
import { richDocKey } from "@/state/documentClone";
import { newId } from "@/domain/ids";
import { normalizeObjectMetadata } from "@/domain/provenance";
import { BlockIdMap, reassignContentBlockIds } from "@/sync/blockIds";
import { SceneBinding } from "@/sync/sceneBinding";
import { markIntegrityUnchecked, refId, retarget } from "@/workspaces/integrity";
import { BUNDLE_FORMAT, BUNDLE_VERSION, BundleError, parseBundle, type AcuteBundle, type BundleElement } from "./bundle";
import { sanitizeContent, sanitizeElement, withSanitizedMetadata } from "./sanitize";

const ELEMENTS = "elements";
const META = "meta";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function loadDoc(services: PersistenceServices, key: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const { updates } = await services.yupdates.load(key);
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
}

async function blobToDataURL(blob: Blob, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function dataURLToBlob(dataURL: string, mimeType: string): Blob {
  const comma = dataURL.indexOf(",");
  const meta = dataURL.slice(5, comma);
  const payload = dataURL.slice(comma + 1);
  if (!meta.endsWith(";base64")) return new Blob([decodeURIComponent(payload)], { type: mimeType });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Builds the `.acute.json` bundle of one workspace from persisted state. */
export function exportWorkspace(services: PersistenceServices, workspaceId: string): Promise<AcuteBundle> {
  return buildBundle(services, workspaceId);
}

/**
 * The same bundle for one canvas only (`scope: "canvas"`): that canvas, the
 * blocks it uses, and its pages (those it owns or previews). It imports as a
 * copy added to an existing workspace (`importCanvas`), never as a workspace.
 */
export function exportCanvas(services: PersistenceServices, workspaceId: string, canvasId: string): Promise<AcuteBundle> {
  return buildBundle(services, workspaceId, canvasId);
}

async function buildBundle(services: PersistenceServices, workspaceId: string, onlyCanvas?: string): Promise<AcuteBundle> {
  const workspace = await services.workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
  if (onlyCanvas && !workspace.canvasIds.includes(onlyCanvas)) throw new Error(`Canvas ${onlyCanvas} not found in workspace ${workspaceId}`);

  const canvases: AcuteBundle["canvases"] = [];
  const referencedBlocks = new Set<string>();
  const previewedPages = new Set<string>();
  const fileIds = new Set<string>();
  const allElements: BundleElement[] = [];

  for (const canvasId of onlyCanvas ? [onlyCanvas] : workspace.canvasIds) {
    const canvas = await services.canvases.get(canvasId);
    if (!canvas) continue;
    const doc = await loadDoc(services, canvasDocId(canvasId));
    const elements = new SceneBinding(doc.getMap<BundleElement>(ELEMENTS)).readScene().filter((el) => !el.isDeleted);
    const background = doc.getMap(META).get("viewBackgroundColor");
    doc.destroy();
    for (const el of elements) {
      const ref = el.type === "embeddable" ? getEmbedRef(el as unknown as SceneElement) : null;
      if (ref?.kind === "rich-block") referencedBlocks.add(ref.documentId);
      if (ref?.kind === "page-preview") previewedPages.add(ref.pageId);
      if (el.type === "image" && typeof el.fileId === "string") fileIds.add(el.fileId);
    }
    allElements.push(...elements);
    canvases.push({
      id: canvas.id,
      title: canvas.title,
      createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt,
      ...(canvas.viewport ? { viewport: canvas.viewport } : {}),
      ...(typeof background === "string" ? { viewBackgroundColor: background } : {}),
      elements: elements.map(withSanitizedMetadata),
    });
  }

  // Every page (they exist independently of the canvas) — or, for one canvas, its own and previewed pages — and the blocks in use.
  const [allPages, blocks] = await Promise.all([
    services.documents.listByWorkspace(workspaceId, "page"),
    services.documents.listByWorkspace(workspaceId, "block"),
  ]);
  const pages = onlyCanvas ? allPages.filter((p) => p.canvasId === onlyCanvas || previewedPages.has(p.id)) : allPages;
  const documents = [...pages, ...blocks.filter((b) => referencedBlocks.has(b.id))].map((d) => ({
    id: d.id,
    kind: d.kind,
    ...(d.canvasId ? { canvasId: d.canvasId } : {}),
    title: d.title,
    snapshot: d.snapshot as AcuteBundle["documents"][number]["snapshot"],
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...metadataOf(d.metadata),
  }));

  // …and the images pages and blocks show (stored in the same asset store).
  for (const d of documents) collectAssetIds(d.snapshot as RichContent, fileIds);

  const assets: AcuteBundle["assets"] = [];
  for (const id of fileIds) {
    const asset = await services.assets.get(id);
    if (asset) {
      assets.push({ id, mimeType: asset.mimeType, createdAt: asset.createdAt, dataURL: await blobToDataURL(asset.blob, asset.mimeType) });
    }
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    ...(onlyCanvas ? { scope: "canvas" as const } : {}),
    exportedAt: Date.now(),
    workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt },
    canvases,
    documents,
    relations: deriveRelations(allElements as unknown as SceneElement[]),
    assets,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportSummary {
  /** A workspace export replaces a workspace; a canvas export is added to the open one as a copy. */
  scope: "workspace" | "canvas";
  workspaceId: string;
  workspaceName: string;
  /** The canvas's title, for a canvas export. */
  canvasTitle?: string;
  canvases: number;
  pages: number;
  blocks: number;
  assets: number;
}

/** Validates without writing (for a confirmation step). Throws `BundleError`. */
export function inspectBundle(input: unknown): { bundle: AcuteBundle; summary: ImportSummary } {
  const bundle = parseBundle(input);
  const canvasScope = bundle.scope === "canvas";
  if (canvasScope && bundle.canvases.length !== 1) throw new BundleError("This canvas export doesn't contain exactly one canvas.");
  return {
    bundle,
    summary: {
      scope: canvasScope ? "canvas" : "workspace",
      ...(canvasScope ? { canvasTitle: bundle.canvases[0]!.title } : {}),
      workspaceId: bundle.workspace.id,
      workspaceName: bundle.workspace.name,
      canvases: bundle.canvases.length,
      pages: bundle.documents.filter((d) => d.kind === "page").length,
      blocks: bundle.documents.filter((d) => d.kind === "block").length,
      assets: bundle.assets.length,
    },
  };
}

/**
 * Ids in the bundle that already belong to *another* workspace on this device
 * (e.g. a canvas moved away after the export) get new ids, and those
 * documents fresh block ids, so importing never overwrites or shares content
 * of another workspace.
 */
async function withoutForeignIds(services: PersistenceServices, bundle: AcuteBundle): Promise<AcuteBundle> {
  const workspaceId = bundle.workspace.id;
  const remap = new Map<string, string>();
  for (const d of bundle.documents) {
    const existing = await services.documents.get(d.id);
    if (existing && existing.workspaceId !== workspaceId) remap.set(d.id, newId(d.kind === "page" ? "page" : "doc"));
  }
  for (const c of bundle.canvases) {
    const existing = await services.canvases.get(c.id);
    if (existing && existing.workspaceId !== workspaceId) remap.set(c.id, newId("cv"));
  }
  if (!remap.size) return bundle;

  const to = (id: string) => remap.get(id) ?? id;
  return {
    ...bundle,
    documents: bundle.documents.map((d) => ({
      ...d,
      id: to(d.id),
      ...(d.canvasId ? { canvasId: to(d.canvasId) } : {}),
      ...(remap.has(d.id)
        ? { snapshot: reassignContentBlockIds(d.snapshot as unknown as RichContent, new BlockIdMap()) as unknown as typeof d.snapshot }
        : {}),
    })),
    canvases: bundle.canvases.map((c) => ({
      ...c,
      id: to(c.id),
      elements: c.elements.map((el) => {
        const ref = el.type === "embeddable" ? getEmbedRef(el as unknown as SceneElement) : null;
        return ref && remap.has(refId(ref)) ? retarget(el, ref, to(refId(ref))) : el;
      }),
    })),
  };
}

/**
 * Replaces the bundle's workspace with the bundle's content, keeping every
 * id it can (see `withoutForeignIds`). The workspace must not be open
 * (callers unmount the canvas first).
 */
export async function importWorkspace(services: PersistenceServices, input: unknown): Promise<ImportSummary> {
  const inspected = inspectBundle(input);
  const { summary } = inspected;
  // Replacing a workspace with a one-canvas file would drop every other canvas.
  if (summary.scope === "canvas") throw new BundleError("This file is a single-canvas export. Import it into a workspace as a canvas instead.");
  const bundle = await withoutForeignIds(services, inspected.bundle);
  const workspaceId = bundle.workspace.id;
  const incomingDocs = new Set(bundle.documents.map((d) => d.id));
  const incomingCanvases = new Set(bundle.canvases.map((c) => c.id));

  // Content that the replaced workspace had but the bundle doesn't.
  const previous = await services.workspaces.get(workspaceId);
  for (const doc of await services.documents.listByWorkspace(workspaceId)) {
    if (incomingDocs.has(doc.id)) continue;
    await services.documents.delete(doc.id);
    await services.yupdates.clear(richDocKey(doc.id));
  }
  const previousCanvases = new Set([
    ...(previous?.canvasIds ?? []),
    ...(await services.canvases.listByWorkspace(workspaceId)).map((c) => c.id),
  ]);
  for (const canvasId of previousCanvases) {
    if (incomingCanvases.has(canvasId)) continue;
    await services.canvases.delete(canvasId);
    await services.yupdates.clear(canvasDocId(canvasId));
  }

  // Documents: record + snapshot. Their Y.Doc is rebuilt from the snapshot on first edit.
  for (const d of bundle.documents) {
    const record: DocumentRecord = {
      id: d.id,
      workspaceId,
      kind: d.kind,
      // Documents without a (known) canvas are assigned when the workspace opens.
      ...(d.canvasId && incomingCanvases.has(d.canvasId) ? { canvasId: d.canvasId } : {}),
      title: d.title,
      snapshot: sanitizeContent(d.snapshot as unknown as RichContent),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      ...(metadataOf(d.metadata) as Pick<DocumentRecord, "metadata">),
    };
    await services.yupdates.clear(richDocKey(d.id));
    await services.documents.put(record);
  }

  for (const a of bundle.assets) {
    await services.assets.put({ id: a.id, mimeType: a.mimeType, createdAt: a.createdAt, blob: dataURLToBlob(a.dataURL, a.mimeType) });
  }

  for (const c of bundle.canvases) {
    const doc = new Y.Doc();
    doc.transact(() => {
      const elements = doc.getMap(ELEMENTS);
      for (const el of c.elements) if (!el.isDeleted) elements.set(el.id, sanitizeElement(el));
      if (c.viewBackgroundColor) doc.getMap(META).set("viewBackgroundColor", c.viewBackgroundColor);
    });
    await services.yupdates.clear(canvasDocId(c.id));
    await services.yupdates.append(canvasDocId(c.id), Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const canvas: CanvasDocument = {
      id: c.id,
      workspaceId,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(c.viewport ? { viewport: c.viewport } : {}),
    };
    await services.canvases.put(canvas);
  }

  // The workspace last, so it only ever references content that is written.
  const workspace: Workspace = {
    id: workspaceId,
    name: bundle.workspace.name,
    canvasIds: bundle.canvases.map((c) => c.id),
    createdAt: bundle.workspace.createdAt,
    updatedAt: bundle.workspace.updatedAt,
  };
  await services.workspaces.put(workspace);
  // Re-check ownership and shared references of every canvas on next open.
  await markIntegrityUnchecked(services, workspaceId);
  return summary;
}

/**
 * Adds a one-canvas bundle to `workspaceId` as a copy: the canvas, its pages
 * and its blocks all get new ids (and documents fresh block ids), the canvas's
 * embeds point at the copies, and nothing already on this device is ever
 * overwritten — importing the same file twice gives two canvases. Images
 * keep their ids (an existing one is left as is). The title gets
 * " (imported)" when the workspace already has a canvas by that name.
 */
export async function importCanvas(services: PersistenceServices, input: unknown, workspaceId: string): Promise<ImportSummary & { canvasId: string }> {
  const { bundle, summary } = inspectBundle(input);
  if (summary.scope !== "canvas") throw new BundleError("This file is a workspace export. Import it as a workspace instead.");
  const workspace = await services.workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
  const source = bundle.canvases[0]!;

  const remap = new Map<string, string>([[source.id, newId("cv")]]);
  for (const d of bundle.documents) remap.set(d.id, newId(d.kind === "page" ? "page" : "doc"));
  const to = (id: string) => remap.get(id) ?? id;
  const canvasId = to(source.id);

  const titles = new Set((await services.canvases.listByWorkspace(workspaceId)).map((c) => c.title));
  const title = titles.has(source.title) ? `${source.title} (imported)` : source.title;
  const now = Date.now();

  for (const d of bundle.documents) {
    const record: DocumentRecord = {
      id: to(d.id),
      workspaceId,
      kind: d.kind,
      // A previewed page of another canvas comes along unowned; the workspace assigns it when it opens.
      ...(d.canvasId === source.id ? { canvasId } : {}),
      title: d.title,
      snapshot: sanitizeContent(reassignContentBlockIds(d.snapshot as unknown as RichContent, new BlockIdMap())),
      createdAt: d.createdAt,
      updatedAt: now,
      ...(metadataOf(d.metadata) as Pick<DocumentRecord, "metadata">),
    };
    await services.documents.put(record);
  }

  for (const a of bundle.assets) {
    if (await services.assets.has(a.id)) continue;
    await services.assets.put({ id: a.id, mimeType: a.mimeType, createdAt: a.createdAt, blob: dataURLToBlob(a.dataURL, a.mimeType) });
  }

  const doc = new Y.Doc();
  doc.transact(() => {
    const elements = doc.getMap(ELEMENTS);
    for (const el of source.elements) {
      if (el.isDeleted) continue;
      const ref = el.type === "embeddable" ? getEmbedRef(el as unknown as SceneElement) : null;
      const copy = ref && remap.has(refId(ref)) ? retarget(el, ref, to(refId(ref))) : el;
      elements.set(copy.id, sanitizeElement(copy));
    }
    if (source.viewBackgroundColor) doc.getMap(META).set("viewBackgroundColor", source.viewBackgroundColor);
  });
  await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
  doc.destroy();
  await services.canvases.put({ id: canvasId, workspaceId, title, createdAt: now, updatedAt: now, ...(source.viewport ? { viewport: source.viewport } : {}) });

  // The workspace last, so it only ever references content that is written.
  await services.workspaces.put({ ...workspace, canvasIds: [...workspace.canvasIds, canvasId], updatedAt: now });
  await markIntegrityUnchecked(services, workspaceId);
  return { ...summary, canvasTitle: title, canvasId };
}

/** `my-workspace-2026-09-25.acute.json`, or `my-canvas-2026-09-25.acute.json` for a one-canvas bundle (`extension` swaps the suffix, e.g. `.md`). */
export function bundleFileName(bundle: AcuteBundle, extension = ".acute.json"): string {
  const name = bundle.scope === "canvas" ? (bundle.canvases[0]?.title ?? "") : bundle.workspace.name;
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || (bundle.scope === "canvas" ? "canvas" : "workspace");
  const date = new Date(bundle.exportedAt).toISOString().slice(0, 10);
  return `${slug}-${date}${extension}`;
}

/** Document metadata for the bundle: known, bounded fields only (F25). */
function metadataOf(raw: unknown): { metadata?: Record<string, unknown> } {
  const metadata = normalizeObjectMetadata(raw);
  return metadata ? { metadata: metadata as Record<string, unknown> } : {};
}
