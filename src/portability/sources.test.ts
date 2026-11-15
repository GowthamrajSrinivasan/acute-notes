/**
 * Export and import with sources (knowledge-notes plan §6.4, WP2.9): the bundle's optional `sources` section, the
 * reconciliation links kept only with it, new source ids on import, and older bundles still importing.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import type { ContentSource, ContentSourceVersion, DocumentRecord } from "@/domain/types";
import { reconciliationOf } from "@/domain/provenance";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { openWorkspace } from "@/persistence/workspaceBootstrap";
import { BUNDLE_SCHEMA_VERSION, BUNDLE_VERSION, parseBundle, type AcuteBundle } from "./bundle";
import { applyExportOptions, DEFAULT_EXPORT_OPTIONS, includesSources } from "./exportOptions";
import { canvasSourcesSize, exportCanvas, exportWorkspace, importCanvas, importWorkspace, inspectBundle } from "./workspaceBundle";

const WS = "default";

/** A complete reconciliation link, as Visualize stamps it. */
const link = (sourceId: string, version: number, key: string) => ({
  createdBy: "ai",
  operationId: "op_1",
  contentSourceId: sourceId,
  contentSourceVersion: version,
  stableNodeKey: key,
  contentFingerprint: `fp_${key}`,
});

const el = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, version: 1, index: `a${id}`, ...extra });

const TEXT_V1 = "# Auth\nTokens expire after 15 minutes.";
const TEXT_V2 = "# Auth\nTokens expire after 30 minutes.\nRefresh tokens rotate.";
const UNITS = { sourceId: "src_a", version: 2, units: [{ id: "u_1", text: "Tokens expire after 30 minutes." }] };
const LINEAGE = { from: 1, to: 2, entries: [{ state: "changed", unit: "u_1" }] };

async function addSource(services: PersistenceServices, canvasId: string, id: string, texts: string[], extra: (n: number) => Record<string, unknown> = () => ({})) {
  const source: ContentSource = { id, workspaceId: WS, canvasId, origin: "paste", tier: "ai", template: "concept_map", latestVersion: texts.length, createdAt: 10, updatedAt: 20 };
  for (const [i, text] of texts.entries()) {
    const version = { sourceId: id, version: i + 1, text, plan: { version: 1, template: "concept_map", nodes: [{ id: `n${i}` }] }, createdAt: 10 + i, ...extra(i + 1) };
    await services.contentSources.append(source, version as ContentSourceVersion);
  }
}

/**
 * A canvas whose block cites version 2 of `src_a`, a shape citing version 1 of it, a shape citing a source this device
 * doesn't have, and a hand-drawn shape; plus `src_b`, a source of the canvas no object cites.
 */
async function seed(services: PersistenceServices) {
  const { canvas } = await openWorkspace(services, WS);
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of [
      el("b1", "embeddable", { link: "acute://block/doc_1", customData: { acute: { kind: "rich-block", blockType: "text", documentId: "doc_1" } } }),
      el("s1", "rectangle", { customData: { acuteMeta: { ai: link("src_a", 1, "k_s1") } } }),
      el("s2", "rectangle", { customData: { acuteMeta: { ai: link("src_gone", 1, "k_s2") } } }),
      el("s3", "rectangle"),
    ]) {
      m.set(e.id, e);
    }
  });
  await services.yupdates.append(canvasDocId(canvas.id), Y.encodeStateAsUpdate(doc));
  const block: DocumentRecord = {
    id: "doc_1",
    workspaceId: WS,
    kind: "block",
    title: "Auth",
    snapshot: [{ type: "paragraph", content: "Tokens expire after 30 minutes." }],
    createdAt: 1,
    updatedAt: 2,
    metadata: { ai: link("src_a", 2, "k_b1") } as DocumentRecord["metadata"],
  };
  await services.documents.put(block);
  await addSource(services, canvas.id, "src_a", [TEXT_V1, TEXT_V2], (n) => (n === 2 ? { units: UNITS, lineage: LINEAGE } : {}));
  await addSource(services, canvas.id, "src_b", ["Unrelated notes."]);
  return canvas.id;
}

async function sceneOf(services: PersistenceServices, canvasId: string) {
  const doc = new Y.Doc();
  for (const u of (await services.yupdates.load(canvasDocId(canvasId))).updates) Y.applyUpdate(doc, u);
  return doc.getMap<{ id: string; customData?: Record<string, unknown> }>("elements");
}

const aiOf = (customData: unknown) => (customData as { acuteMeta?: { ai?: Record<string, unknown> } } | undefined)?.acuteMeta?.ai;

/** Each linked object on the canvas, resolved through the device store: its source id and the cited version's text. */
async function resolveCitations(services: PersistenceServices, canvasId: string) {
  const scene = await sceneOf(services, canvasId);
  const docs = new Map((await services.documents.listByWorkspace(WS)).map((d) => [d.id, d]));
  const out: Record<string, { sourceId: string; text: string | undefined }> = {};
  for (const [id, element] of scene.entries()) {
    const found = reconciliationOf(element as never, (docId) => docs.get(docId));
    if (!found) continue;
    const version = await services.contentSources.getVersion(found.contentSourceId, found.contentSourceVersion);
    out[id] = { sourceId: found.contentSourceId, text: version?.text };
  }
  return out;
}

const roundTrip = (bundle: AcuteBundle) => JSON.parse(JSON.stringify(bundle)) as unknown;

describe("export with sources (default)", () => {
  it("carries the canvas's sources with every version, and the links of the objects that cite them", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const bundle = await exportCanvas(services, WS, canvasId);

    expect(bundle).toMatchObject({ version: BUNDLE_VERSION, schemaVersion: BUNDLE_SCHEMA_VERSION });
    expect(bundle.sources?.map((s) => s.id).sort()).toEqual(["src_a", "src_b"]);
    const a = bundle.sources!.find((s) => s.id === "src_a")!;
    expect(a).toMatchObject({ canvasId, origin: "paste", tier: "ai", template: "concept_map", latestVersion: 2 });
    expect(a.versions.map((v) => [v.version, v.text])).toEqual([
      [1, TEXT_V1],
      [2, TEXT_V2],
    ]);
    // units and lineage pass through untouched.
    expect(a.versions[1]).toMatchObject({ units: UNITS, lineage: LINEAGE });
    expect(a.versions[0]).not.toHaveProperty("units");

    const els = new Map(bundle.canvases[0]!.elements.map((e) => [e.id, aiOf(e.customData)]));
    expect(els.get("s1")).toEqual(link("src_a", 1, "k_s1"));
    // A link to a source the file doesn't carry is dropped, as every export did before.
    expect(els.get("s2")).toEqual({ createdBy: "ai", operationId: "op_1" });
    expect(bundle.documents.find((d) => d.id === "doc_1")?.metadata).toEqual({ ai: link("src_a", 2, "k_b1") });
    expect(() => parseBundle(roundTrip(bundle))).not.toThrow();
  });

  it("is on by default for a workspace backup and a canvas export, and needs Origin", async () => {
    expect(DEFAULT_EXPORT_OPTIONS.sources).toBe(true);
    expect(includesSources({ ...DEFAULT_EXPORT_OPTIONS, origin: false })).toBe(false);
    const services = createMemoryServices();
    const canvasId = await seed(services);
    expect((await exportWorkspace(services, WS)).sources).toHaveLength(2);
    const bundle = await exportCanvas(services, WS, canvasId);
    expect(applyExportOptions(bundle, DEFAULT_EXPORT_OPTIONS)).toEqual(bundle);
  });

  it("measures the sources' size for the dialog", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const size = await canvasSourcesSize(services, WS, canvasId);
    const bundle = await exportCanvas(services, WS, canvasId);
    expect(size).toEqual({ count: 2, bytes: new TextEncoder().encode(JSON.stringify(bundle.sources)).length });
    const empty = createMemoryServices();
    expect(await canvasSourcesSize(empty, WS, (await openWorkspace(empty, WS)).canvas.id)).toEqual({ count: 0, bytes: 0 });
  });
});

describe("import with sources", () => {
  it("canvas import: restores every source under the imported canvas with new ids, and every citation resolves to its version's text", async () => {
    const source = createMemoryServices();
    const original = await seed(source);
    const bundle = roundTrip(await exportCanvas(source, WS, original));

    const target = createMemoryServices();
    await openWorkspace(target, WS);
    const { canvasId, sources } = await importCanvas(target, bundle, WS);
    expect(sources).toBe(2);

    const restored = await target.contentSources.listByCanvas(canvasId);
    expect(restored).toHaveLength(2);
    expect(restored.map((s) => s.id)).not.toContain("src_a");
    expect(restored.every((s) => s.workspaceId === WS && s.canvasId === canvasId)).toBe(true);

    const cited = await resolveCitations(target, canvasId);
    expect(Object.keys(cited).sort()).toEqual(["b1", "s1"]);
    // One source, one new id, used consistently by every object citing it.
    expect(cited.b1!.sourceId).toBe(cited.s1!.sourceId);
    expect(cited.b1!.sourceId).not.toBe("src_a");
    expect(cited.s1!.text).toBe(TEXT_V1);
    expect(cited.b1!.text).toBe(TEXT_V2);
    const newA = cited.b1!.sourceId;
    expect(await target.contentSources.get(newA)).toMatchObject({ latestVersion: 2, template: "concept_map", tier: "ai", origin: "paste" });
    expect(await target.contentSources.getVersion(newA, 2)).toMatchObject({ sourceId: newA, units: UNITS, lineage: LINEAGE });

    // The object citing a source the file didn't carry has no link.
    expect(aiOf((await sceneOf(target, canvasId)).get("s2")?.customData)).toEqual({ createdBy: "ai", operationId: "op_1" });
  });

  it("importing the same file twice gives two independent sets of sources", async () => {
    const source = createMemoryServices();
    const bundle = roundTrip(await exportCanvas(source, WS, await seed(source)));
    const target = createMemoryServices();
    await openWorkspace(target, WS);
    const first = await importCanvas(target, bundle, WS);
    const second = await importCanvas(target, bundle, WS);
    const one = (await resolveCitations(target, first.canvasId)).b1!.sourceId;
    const two = (await resolveCitations(target, second.canvasId)).b1!.sourceId;
    expect(one).not.toBe(two);
  });

  it("workspace import: restores sources with new ids under their canvas, into a clean store", async () => {
    const source = createMemoryServices();
    const canvasId = await seed(source);
    const target = createMemoryServices();
    const summary = await importWorkspace(target, roundTrip(await exportWorkspace(source, WS)));
    expect(summary.sources).toBe(2);

    const restored = await target.contentSources.listByCanvas(canvasId);
    expect(restored.map((s) => s.id).sort()).not.toEqual(["src_a", "src_b"]);
    expect(restored).toHaveLength(2);
    const cited = await resolveCitations(target, canvasId);
    expect(cited.s1).toEqual({ sourceId: cited.b1!.sourceId, text: TEXT_V1 });
    expect(cited.b1!.text).toBe(TEXT_V2);

    // Exporting again carries the same sources (under their new ids).
    const again = await exportWorkspace(target, WS);
    expect(again.sources?.map((s) => s.versions.map((v) => v.text)).sort()).toEqual([[TEXT_V1, TEXT_V2], ["Unrelated notes."]]);
  });

  it("a hand-edited link to a source the file doesn't carry is dropped, never left dangling", async () => {
    const source = createMemoryServices();
    const bundle = roundTrip(await exportCanvas(source, WS, await seed(source))) as AcuteBundle;
    (bundle.canvases[0]!.elements.find((e) => e.id === "s1")!.customData as { acuteMeta: { ai: Record<string, unknown> } }).acuteMeta.ai.contentSourceId = "src_forged";
    const target = createMemoryServices();
    await openWorkspace(target, WS);
    const { canvasId } = await importCanvas(target, bundle, WS);
    expect(aiOf((await sceneOf(target, canvasId)).get("s1")?.customData)).toEqual({ createdBy: "ai", operationId: "op_1" });
  });
});

describe("export without sources", () => {
  it("has no sources section and no links (as before), and imports with nothing to resolve", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const full = await exportCanvas(services, WS, canvasId);
    for (const bundle of [applyExportOptions(full, { ...DEFAULT_EXPORT_OPTIONS, sources: false }), await exportCanvas(services, WS, canvasId, { sources: false })]) {
      expect(bundle).not.toHaveProperty("sources");
      const json = JSON.stringify(bundle);
      expect(json).not.toMatch(/src_a|src_b|contentSourceId|stableNodeKey|contentFingerprint|Tokens expire after 15/);
      expect(bundle.documents.find((d) => d.id === "doc_1")?.metadata).toEqual({ ai: { createdBy: "ai", operationId: "op_1" } });
      expect(aiOf(bundle.canvases[0]!.elements.find((e) => e.id === "s1")?.customData)).toEqual({ createdBy: "ai", operationId: "op_1" });

      const target = createMemoryServices();
      await openWorkspace(target, WS);
      const imported = await importCanvas(target, JSON.parse(json), WS);
      expect(imported.sources).toBe(0);
      expect(await target.contentSources.listByCanvas(imported.canvasId)).toEqual([]);
      expect(await resolveCitations(target, imported.canvasId)).toEqual({});
    }
    // The full bundle is untouched.
    expect(full.sources).toHaveLength(2);
  });

  it("a workspace backup without sources has no section either", async () => {
    const services = createMemoryServices();
    await seed(services);
    const bundle = await exportWorkspace(services, WS, { sources: false });
    expect(bundle).not.toHaveProperty("sources");
    expect(JSON.stringify(bundle)).not.toContain("contentSourceId");
  });
});

describe("older and newer bundles", () => {
  it("a version 1 bundle from before sources (no schemaVersion, no section) still imports, dropping any stray link", async () => {
    const services = createMemoryServices();
    const canvasId = await seed(services);
    const old = roundTrip(await exportCanvas(services, WS, canvasId, { sources: false })) as Record<string, unknown>;
    delete old.schemaVersion;
    // A link an older file might carry (hand-edited): there is no source to point at, so it is dropped.
    const s1 = (old.canvases as AcuteBundle["canvases"])[0]!.elements.find((e) => e.id === "s1")!;
    (s1.customData as { acuteMeta: { ai: Record<string, unknown> } }).acuteMeta.ai = link("src_a", 1, "k_s1");

    expect(inspectBundle(old).summary.sources).toBe(0);
    const target = createMemoryServices();
    await openWorkspace(target, WS);
    const { canvasId: copy } = await importCanvas(target, old, WS);
    expect(aiOf((await sceneOf(target, copy)).get("s1")?.customData)).toEqual({ createdBy: "ai", operationId: "op_1" });

    const workspaceTarget = createMemoryServices();
    const oldWorkspace = roundTrip(await exportWorkspace(services, WS, { sources: false })) as Record<string, unknown>;
    delete oldWorkspace.schemaVersion;
    await expect(importWorkspace(workspaceTarget, oldWorkspace)).resolves.toMatchObject({ sources: 0, canvases: 1 });
  });

  it("a newer additive schema still imports; what this reader doesn't know is ignored", async () => {
    const services = createMemoryServices();
    const bundle = roundTrip(await exportCanvas(services, WS, await seed(services))) as Record<string, unknown>;
    const newer = { ...bundle, schemaVersion: BUNDLE_SCHEMA_VERSION + 1, somethingNew: [{ x: 1 }] };
    expect(parseBundle(newer)).not.toHaveProperty("somethingNew");
    const target = createMemoryServices();
    await openWorkspace(target, WS);
    await expect(importCanvas(target, newer, WS)).resolves.toMatchObject({ sources: 2 });
  });

  it("a reader from before sources (the version 1 schema without the section) would import the file without them", async () => {
    // Older readers validate `version: 1` and strip keys they don't know; the bump is additive, so `version` stays 1.
    const services = createMemoryServices();
    const bundle = await exportCanvas(services, WS, await seed(services));
    expect(bundle.version).toBe(1);
  });

  it("rejects a damaged sources section without writing", async () => {
    const services = createMemoryServices();
    const bundle = roundTrip(await exportCanvas(services, WS, await seed(services))) as AcuteBundle;
    const target = createMemoryServices();
    await openWorkspace(target, WS);
    await expect(importCanvas(target, { ...bundle, sources: [{ ...bundle.sources![0]!, versions: [] }] }, WS)).rejects.toThrow(/damaged or incomplete \(at sources\.0\.versions\)/);
    await expect(importCanvas(target, { ...bundle, sources: [bundle.sources![0], bundle.sources![0]] }, WS)).rejects.toThrow("twice");
    expect((await target.workspaces.get(WS))?.canvasIds).toHaveLength(1);
  });
});
