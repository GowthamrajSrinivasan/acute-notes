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
import type { CanvasDocument, ContentSourceVersion, DocumentRecord, RichContent, Workspace } from "@/domain/types";
import type { PersistenceServices } from "@/persistence";
import { richDocKey } from "@/state/documentClone";
import { newId } from "@/domain/ids";
import { normalizeObjectMetadata } from "@/domain/provenance";
import { newContentSourceId } from "@/ai/content/sources";
import { BlockIdMap, reassignContentBlockIds } from "@/sync/blockIds";
import { SceneBinding } from "@/sync/sceneBinding";
import { markIntegrityUnchecked, refId, retarget } from "@/workspaces/integrity";
import { BUNDLE_FORMAT, BUNDLE_SCHEMA_VERSION, BUNDLE_VERSION, BundleError, parseBundle, type AcuteBundle, type BundleElement, type BundleSource } from "./bundle";
import { withoutSources } from "./exportOptions";
import { elementMetadataOf, linkedSourceOf, metadataLinkedTo, sanitizeContent, sanitizeElement, withSanitizedMetadata, type MetadataNormalizer } from "./sanitize";

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

/** What an export carries beyond the content. */
export interface BundleExportOptions {
  /**
   * The canvases' content sources with every version, and the links that tie objects to them (§6.4). Default on: a
   * backup or canvas export is the user's own file. Off: no `sources` section and no links, as before.
   */
  sources?: boolean;
}

/** Builds the `.acute.json` bundle of one workspace from persisted state. */
export async function exportWorkspace(services: PersistenceServices, workspaceId: string, options: BundleExportOptions = {}): Promise<AcuteBundle> {
  const bundle = await buildBundle(services, workspaceId);
  return options.sources === false ? withoutSources(bundle) : bundle;
}

/**
 * The same bundle for one canvas only (`scope: "canvas"`): that canvas, the
 * blocks it uses, and its pages (those it owns or previews). It imports as a
 * copy added to an existing workspace (`importCanvas`), never as a workspace.
 */
export async function exportCanvas(services: PersistenceServices, workspaceId: string, canvasId: string, options: BundleExportOptions = {}): Promise<AcuteBundle> {
  const bundle = await buildBundle(services, workspaceId, canvasId);
  return options.sources === false ? withoutSources(bundle) : bundle;
}

/** How much the canvas's sources add to its export (for the export dialog): their count and UTF-8 size in bytes. */
export async function canvasSourcesSize(services: PersistenceServices, workspaceId: string, canvasId: string): Promise<{ count: number; bytes: number }> {
  const { sources = [] } = await buildBundle(services, workspaceId, canvasId, { images: false });
  return { count: sources.length, bytes: sources.length ? new TextEncoder().encode(JSON.stringify(sources)).length : 0 };
}

async function buildBundle(services: PersistenceServices, workspaceId: string, onlyCanvas?: string, { images = true } = {}): Promise<AcuteBundle> {
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
      elements,
    });
  }

  // Every page (they exist independently of the canvas) — or, for one canvas, its own and previewed pages — and the blocks in use.
  const [allPages, blocks] = await Promise.all([
    services.documents.listByWorkspace(workspaceId, "page"),
    services.documents.listByWorkspace(workspaceId, "block"),
  ]);
  const pages = onlyCanvas ? allPages.filter((p) => p.canvasId === onlyCanvas || previewedPages.has(p.id)) : allPages;
  const exportedDocs = [...pages, ...blocks.filter((b) => referencedBlocks.has(b.id))];

  // The content sources: the canvases' own, and any other one an object cites (e.g. an object moved from another canvas).
  const cited = new Set<string>();
  for (const canvas of canvases) for (const source of await services.contentSources.listByCanvas(canvas.id)) cited.add(source.id);
  for (const raw of [...allElements.map(elementMetadataOf), ...exportedDocs.map((d) => d.metadata)]) {
    const id = linkedSourceOf(raw);
    if (id) cited.add(id);
  }
  const sources = await bundledSources(services, cited);
  const carried = new Set(sources.map((s) => s.id));
  // Objects keep their link only to a source the file carries.
  const normalize = metadataLinkedTo((id) => (carried.has(id) ? id : undefined));
  for (const canvas of canvases) canvas.elements = canvas.elements.map((el) => withSanitizedMetadata(el, normalize));

  const documents = exportedDocs.map((d) => ({
    id: d.id,
    kind: d.kind,
    ...(d.canvasId ? { canvasId: d.canvasId } : {}),
    title: d.title,
    snapshot: d.snapshot as AcuteBundle["documents"][number]["snapshot"],
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...metadataOf(d.metadata, normalize),
  }));

  // …and the images pages and blocks show (stored in the same asset store).
  for (const d of documents) collectAssetIds(d.snapshot as RichContent, fileIds);

  const assets: AcuteBundle["assets"] = [];
  for (const id of images ? fileIds : []) {
    const asset = await services.assets.get(id);
    if (asset) {
      assets.push({ id, mimeType: asset.mimeType, createdAt: asset.createdAt, dataURL: await blobToDataURL(asset.blob, asset.mimeType) });
    }
  }

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    ...(onlyCanvas ? { scope: "canvas" as const } : {}),
    exportedAt: Date.now(),
    workspace: { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt },
    canvases,
    documents,
    relations: deriveRelations(allElements as unknown as SceneElement[]),
    assets,
    ...(sources.length ? { sources } : {}),
  };
}

/** The given content sources with every stored version, oldest first; a source this device doesn't have is skipped. */
async function bundledSources(services: PersistenceServices, ids: Iterable<string>): Promise<BundleSource[]> {
  const out: BundleSource[] = [];
  for (const id of ids) {
    const source = await services.contentSources.get(id);
    if (!source) continue;
    const versions: BundleSource["versions"] = [];
    for (let n = 1; n <= source.latestVersion; n++) {
      const v = await services.contentSources.getVersion(id, n);
      if (v) versions.push(bundledVersion(v));
    }
    if (!versions.length) continue;
    out.push({
      id: source.id,
      canvasId: source.canvasId,
      origin: source.origin,
      tier: source.tier,
      template: source.template,
      latestVersion: source.latestVersion,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      versions,
    });
  }
  return out;
}

/** A stored version; `units` and `lineage` (WP1.3) are read defensively until the domain type has them. */
type StoredVersion = ContentSourceVersion & { units?: unknown; lineage?: unknown };

/** `units` and `lineage` pass through untouched when present. */
function bundledVersion(stored: ContentSourceVersion): BundleSource["versions"][number] {
  const v = stored as StoredVersion;
  return {
    version: v.version,
    text: v.text,
    plan: v.plan,
    ...(v.pathIds ? { pathIds: v.pathIds } : {}),
    ...(v.revisions?.length ? { revisions: v.revisions } : {}),
    ...(v.units !== undefined ? { units: v.units } : {}),
    ...(v.lineage !== undefined ? { lineage: v.lineage } : {}),
    createdAt: v.createdAt,
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
  /** Content sources the file carries (§6.4); 0 for a file without them. */
  sources: number;
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
      sources: bundle.sources?.length ?? 0,
    },
  };
}

/**
 * New ids for the bundle's content sources. An import never reuses a source id, so it can't overwrite or append to a
 * source already on this device, and importing the same file twice gives two independent sets.
 */
function newSourceIds(bundle: AcuteBundle): Map<string, string> {
  return new Map((bundle.sources ?? []).map((s) => [s.id, newContentSourceId()]));
}

/**
 * Writes the bundle's sources to the device store under their new ids (`ids`), every version oldest first, owned by
 * `canvasFor(source.canvasId)`. Objects' links are rewritten to the same ids (`metadataLinkedTo`), so citations resolve.
 */
async function restoreSources(
  services: PersistenceServices,
  bundle: AcuteBundle,
  ids: Map<string, string>,
  workspaceId: string,
  canvasFor: (canvasId: string) => string,
): Promise<void> {
  for (const s of bundle.sources ?? []) {
    const id = ids.get(s.id)!;
    const versions = [...s.versions].sort((a, b) => a.version - b.version);
    const latestVersion = Math.max(s.latestVersion, ...versions.map((v) => v.version));
    const header = { id, workspaceId, canvasId: canvasFor(s.canvasId), origin: s.origin, tier: s.tier, template: s.template, latestVersion, createdAt: s.createdAt, updatedAt: s.updatedAt };
    for (const v of versions) {
      const version: StoredVersion = {
        sourceId: id,
        version: v.version,
        text: v.text,
        plan: v.plan,
        ...(v.pathIds ? { pathIds: v.pathIds } : {}),
        ...(v.revisions?.length ? { revisions: v.revisions } : {}),
        // Passed through as the export wrote them (WP1.3 types); a later recording ignores units it can't read (`recordAcceptedSource`).
        ...(v.units !== undefined ? { units: v.units as ContentSourceVersion["units"] } : {}),
        ...(v.lineage !== undefined ? { lineage: v.lineage as ContentSourceVersion["lineage"] } : {}),
        createdAt: v.createdAt,
      };
      await services.contentSources.append(header, version);
    }
  }
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
    ...(bundle.sources ? { sources: bundle.sources.map((s) => ({ ...s, canvasId: to(s.canvasId) })) } : {}),
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
  // Sources get new ids; objects' links follow them, and a link to a source the file doesn't carry is dropped.
  const sourceIds = newSourceIds(bundle);
  const normalize = metadataLinkedTo((id) => sourceIds.get(id));

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
      ...(metadataOf(d.metadata, normalize) as Pick<DocumentRecord, "metadata">),
    };
    await services.yupdates.clear(richDocKey(d.id));
    await services.documents.put(record);
  }

  for (const a of bundle.assets) {
    await services.assets.put({ id: a.id, mimeType: a.mimeType, createdAt: a.createdAt, blob: dataURLToBlob(a.dataURL, a.mimeType) });
  }

  // A source of a canvas the file doesn't carry goes with the first canvas (any canvas may cite it).
  const firstCanvas = bundle.canvases[0]?.id;
  if (firstCanvas) await restoreSources(services, bundle, sourceIds, workspaceId, (id) => (incomingCanvases.has(id) ? id : firstCanvas));

  for (const c of bundle.canvases) {
    const doc = new Y.Doc();
    doc.transact(() => {
      const elements = doc.getMap(ELEMENTS);
      for (const el of c.elements) if (!el.isDeleted) elements.set(el.id, sanitizeElement(el, normalize));
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
  const sourceIds = newSourceIds(bundle);
  const normalize = metadataLinkedTo((id) => sourceIds.get(id));

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
      ...(metadataOf(d.metadata, normalize) as Pick<DocumentRecord, "metadata">),
    };
    await services.documents.put(record);
  }

  for (const a of bundle.assets) {
    if (await services.assets.has(a.id)) continue;
    await services.assets.put({ id: a.id, mimeType: a.mimeType, createdAt: a.createdAt, blob: dataURLToBlob(a.dataURL, a.mimeType) });
  }

  // Every source the file carries belongs to the imported canvas.
  await restoreSources(services, bundle, sourceIds, workspaceId, () => canvasId);

  const doc = new Y.Doc();
  doc.transact(() => {
    const elements = doc.getMap(ELEMENTS);
    for (const el of source.elements) {
      if (el.isDeleted) continue;
      const ref = el.type === "embeddable" ? getEmbedRef(el as unknown as SceneElement) : null;
      const copy = ref && remap.has(refId(ref)) ? retarget(el, ref, to(refId(ref))) : el;
      elements.set(copy.id, sanitizeElement(copy, normalize));
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

/** Document metadata for the bundle: known, bounded fields only (F25); `normalize` may keep the reconciliation link. */
function metadataOf(raw: unknown, normalize: MetadataNormalizer = normalizeObjectMetadata): { metadata?: Record<string, unknown> } {
  const metadata = normalize(raw);
  return metadata ? { metadata: metadata as Record<string, unknown> } : {};
}
