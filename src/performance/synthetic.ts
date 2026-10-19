/**
 * Dev-only synthetic workloads and measurements for performance checks
 * (PRD §17.3). Exposed as `window.__acuteDev` in development builds, or in
 * production with `?acuteDev`; see `scripts/perf/README.md` for the suite.
 */
import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { BLOCK_STYLE } from "@/components/canvas/richBlocks";
import { blockLink, pageLink } from "@/domain/canvas/adapter";
import { CARD_STYLE, TEXT_ITEM_STYLE } from "@/domain/content/blockStyle";
import { BLOCK_SIZE, PAGE_PREVIEW_SIZE } from "@/domain/content/richContent";
import { newId, randomId } from "@/domain/ids";
import type { DocumentHome, RichBlockType, RichContent } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";

const SAMPLE: RichContent = [
  { type: "paragraph", content: "Synthetic note" },
  { type: "checkListItem", props: { checked: false }, content: "Follow up" },
  { type: "bulletListItem", content: "Detail" },
];

/** Card content per block type: enough structure to exercise every preview path. */
const CARD_CONTENT: Record<RichBlockType, RichContent> = {
  text: [
    { type: "heading", props: { level: 2 }, content: "Synthetic heading" },
    { type: "paragraph", content: [{ type: "text", text: "Bold", styles: { bold: true } }, { type: "text", text: " and plain text.", styles: {} }] },
    { type: "numberedListItem", content: "First" },
    { type: "numberedListItem", content: "Second" },
  ],
  todo: [
    { type: "checkListItem", props: { checked: true }, content: "Done task" },
    { type: "checkListItem", props: { checked: false }, content: "Open task" },
    { type: "checkListItem", props: { checked: false }, content: "Another task" },
  ],
  table: [
    {
      type: "table",
      content: {
        type: "tableContent",
        headerRows: 1,
        rows: [
          { cells: [[{ type: "text", text: "Key" }], [{ type: "text", text: "Value" }]] },
          { cells: [[{ type: "text", text: "Alpha" }], [{ type: "text", text: "1" }]] },
          { cells: [[{ type: "text", text: "Beta" }], [{ type: "text", text: "2" }]] },
        ],
      },
    } as never,
  ],
  code: [{ type: "codeBlock", props: { language: "typescript" }, content: "const answer = 42;\nconsole.log(answer);" }],
};

const PAGE_CONTENT: RichContent = [
  { type: "heading", props: { level: 1 }, content: "Synthetic page" },
  { type: "paragraph", content: "A page with a few blocks so previews render real content." },
  { type: "bulletListItem", content: "Point one" },
  { type: "bulletListItem", content: "Point two" },
  { type: "checkListItem", props: { checked: false }, content: "A task" },
];

/** What `seed` places on the canvas, laid out on one grid. */
export interface SeedSpec {
  /** Native Excalidraw shapes (rectangles, ellipses, diamonds, arrows, lines). */
  shapes?: number;
  /** Native Excalidraw text elements. */
  nativeText?: number;
  /** Frameless Acute text items. */
  textItems?: number;
  /** Framed rich blocks, cycling text / todo / table / code. */
  blocks?: number;
  /** Page previews (every other one shows content, the rest are cards). */
  pages?: number;
  /** Image elements (each with its own generated PNG). */
  images?: number;
}

const CELL = { width: 480, height: 560 };

/** Places a whole synthetic workload in one scene update and returns the number of elements added. */
export async function seed(api: ExcalidrawImperativeAPI, home: DocumentHome, spec: SeedSpec): Promise<number> {
  const store = getDocumentStore();
  const now = Date.now();
  const total = Object.values(spec).reduce((a: number, b) => a + (b ?? 0), 0);
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  let slot = 0;
  const next = () => {
    const i = slot++;
    return { x: (i % cols) * CELL.width, y: Math.floor(i / cols) * CELL.height };
  };
  const skeletons: Record<string, unknown>[] = [];
  const writes: Promise<void>[] = [];

  const shapeTypes = ["rectangle", "ellipse", "diamond", "arrow", "line"] as const;
  for (let i = 0; i < (spec.shapes ?? 0); i++) {
    const { x, y } = next();
    const type = shapeTypes[i % shapeTypes.length]!;
    const linear = type === "arrow" || type === "line";
    skeletons.push({
      type,
      id: randomId(),
      x,
      y,
      width: 320,
      height: linear ? 0 : 200,
      strokeColor: "#1e1e1e",
      backgroundColor: i % 2 ? "#a5d8ff" : "transparent",
      fillStyle: i % 3 === 0 ? "hachure" : "solid",
      roughness: 1,
      ...(linear ? { points: [[0, 0], [320, 120]] } : {}),
    });
  }

  for (let i = 0; i < (spec.nativeText ?? 0); i++) {
    const { x, y } = next();
    skeletons.push({ type: "text", id: randomId(), x, y, text: "Synthetic note\n[ ] Follow up\n• Detail", fontSize: 20, fontFamily: 5 });
  }

  for (let i = 0; i < (spec.textItems ?? 0); i++) {
    const { x, y } = next();
    const documentId = newId("doc");
    writes.push(store.put({ id: documentId, ...home, kind: "block", title: "Synthetic note", snapshot: SAMPLE, createdAt: now, updatedAt: now }));
    skeletons.push({
      type: "embeddable",
      id: randomId(),
      x,
      y,
      width: 160,
      height: 96,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      roughness: 0,
      roundness: null,
      link: blockLink(documentId),
      customData: { acute: { kind: "rich-block", blockType: "text", documentId, style: TEXT_ITEM_STYLE } },
    });
  }

  const blockTypes: RichBlockType[] = ["text", "todo", "table", "code"];
  for (let i = 0; i < (spec.blocks ?? 0); i++) {
    const { x, y } = next();
    const blockType = blockTypes[i % blockTypes.length]!;
    const documentId = newId("doc");
    writes.push(
      store.put({ id: documentId, ...home, kind: "block", title: "Synthetic block", snapshot: CARD_CONTENT[blockType], createdAt: now, updatedAt: now }),
    );
    skeletons.push({
      ...BLOCK_STYLE,
      type: "embeddable",
      id: randomId(),
      x,
      y,
      ...BLOCK_SIZE[blockType],
      link: blockLink(documentId),
      customData: { acute: { kind: "rich-block", blockType, documentId, style: CARD_STYLE } },
    });
  }

  for (let i = 0; i < (spec.pages ?? 0); i++) {
    const { x, y } = next();
    const pageId = newId("page");
    const preview = i % 2 === 0;
    writes.push(
      store.put({ id: pageId, ...home, kind: "page", title: `Synthetic page ${i + 1}`, snapshot: PAGE_CONTENT, createdAt: now, updatedAt: now }),
    );
    skeletons.push({
      ...BLOCK_STYLE,
      type: "embeddable",
      id: randomId(),
      x,
      y,
      ...(preview ? PAGE_PREVIEW_SIZE.content : PAGE_PREVIEW_SIZE.card),
      link: pageLink(pageId),
      customData: { acute: { kind: "page-preview", pageId, preview } },
    });
  }

  const files: BinaryFileData[] = [];
  for (let i = 0; i < (spec.images ?? 0); i++) {
    const { x, y } = next();
    const fileId = randomId() as FileId;
    files.push({ id: fileId, mimeType: "image/png", dataURL: await syntheticImage(i), created: now, lastRetrieved: now });
    skeletons.push({ type: "image", id: randomId(), x, y, width: 400, height: 300, fileId, status: "saved" });
  }

  await Promise.all(writes);
  if (files.length) api.addFiles(files);
  api.updateScene({
    elements: [
      ...api.getSceneElementsIncludingDeleted(),
      ...restoreElements(skeletons as unknown as ExcalidrawElement[], null, { refreshDimensions: true }),
    ],
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return skeletons.length;
}

/** A distinct 800×600 PNG (gradient + label), roughly photo-sized as a data URL. */
async function syntheticImage(i: number): Promise<DataURL> {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 800, 600);
  g.addColorStop(0, `hsl(${(i * 47) % 360} 70% 60%)`);
  g.addColorStop(1, `hsl(${(i * 47 + 120) % 360} 70% 40%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 600);
  // Noise keeps the PNG from compressing to nothing.
  const noise = ctx.getImageData(0, 0, 800, 600);
  for (let p = 0; p < noise.data.length; p += 4) noise.data[p + 3] = 200 + ((p * 7919 + i) % 55);
  ctx.putImageData(noise, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 64px sans-serif";
  ctx.fillText(`Image ${i + 1}`, 40, 100);
  return canvas.toDataURL("image/png") as DataURL;
}

/** Adds `count` frameless text items on a grid in one scene update. */
export function addSyntheticTextItems(api: ExcalidrawImperativeAPI, home: DocumentHome, count: number): Promise<number> {
  return seed(api, home, { textItems: count });
}

/** Baseline: `count` native Excalidraw text elements (3 lines each) on the same grid. */
export function addSyntheticNativeText(api: ExcalidrawImperativeAPI, home: DocumentHome, count: number): Promise<number> {
  return seed(api, home, { nativeText: count });
}

// ---------------------------------------------------------------------------
// Measurements

export interface FrameStats {
  frames: number;
  fps: number;
  /** Frame interval percentiles (ms). */
  p50: number;
  p95: number;
  max: number;
  /** Frames over 50 ms (visible jank). */
  long: number;
}

function stats(intervals: number[]): FrameStats {
  const sorted = intervals.slice().sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);
  const at = (q: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0) * 10) / 10;
  return {
    frames: sorted.length,
    fps: Math.round(1000 / (avg || 1)),
    p50: at(0.5),
    p95: at(0.95),
    max: Math.round(sorted.at(-1) ?? 0),
    long: sorted.filter((t) => t > 50).length,
  };
}

/** Records frame intervals until `stop()` (for gestures driven from outside, e.g. Playwright's mouse). */
export function recordFrames(): { stop(): FrameStats } {
  const intervals: number[] = [];
  let last = performance.now();
  let raf = requestAnimationFrame(function tick(t) {
    intervals.push(t - last);
    last = t;
    raf = requestAnimationFrame(tick);
  });
  return {
    stop() {
      cancelAnimationFrame(raf);
      return stats(intervals.slice(1));
    },
  };
}

/** Drives `step(progress 0..1)` once per frame for `ms` and reports frame timings. */
function drive(ms: number, step: (phase: number) => void): Promise<FrameStats> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    const start = performance.now();
    let last = start;
    requestAnimationFrame(function tick(t) {
      intervals.push(t - last);
      last = t;
      step((t - start) / 1000);
      if (t - start < ms) requestAnimationFrame(tick);
      else resolve(stats(intervals.slice(1)));
    });
  });
}

/** Pans the viewport programmatically for `ms` (oscillating, so the same content stays on screen). */
export function measurePan(api: ExcalidrawImperativeAPI, ms = 3000): Promise<FrameStats> {
  const origin = api.getAppState();
  return drive(ms, (s) => {
    const phase = s * Math.PI * 2;
    api.updateScene({
      appState: { scrollX: origin.scrollX + Math.sin(phase) * 120, scrollY: origin.scrollY + Math.cos(phase) * 60 },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
}

/** Zooms in and out around the viewport centre for `ms`. */
export function measureZoom(api: ExcalidrawImperativeAPI, ms = 3000): Promise<FrameStats> {
  const origin = api.getAppState();
  const z0 = origin.zoom.value;
  const cx = origin.width / 2 / z0 - origin.scrollX;
  const cy = origin.height / 2 / z0 - origin.scrollY;
  return drive(ms, (s) => {
    const zoom = z0 * (1 + 0.35 * Math.sin(s * Math.PI * 2));
    api.updateScene({
      appState: {
        zoom: { value: zoom as never },
        scrollX: origin.width / 2 / zoom - cx,
        scrollY: origin.height / 2 / zoom - cy,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
}

/** Zooms to fit everything, then pans across the whole scene once (mounts every embed Excalidraw has seen). */
export async function sweep(api: ExcalidrawImperativeAPI, ms = 3000): Promise<FrameStats> {
  const elements = api.getSceneElements();
  if (!elements.length) return stats([]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  const { width, height } = api.getAppState();
  api.updateScene({ appState: { zoom: { value: 1 as never } }, captureUpdate: CaptureUpdateAction.NEVER });
  const rows = Math.max(1, Math.ceil((maxY - minY) / height));
  return drive(ms, (s) => {
    const p = Math.min(1, (s * 1000) / ms) * rows;
    const row = Math.min(rows - 1, Math.floor(p));
    const t = p - row;
    const x = minX + (row % 2 ? 1 - t : t) * Math.max(0, maxX - minX - width);
    api.updateScene({
      appState: { scrollX: -x, scrollY: -(minY + row * height) },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
}

/** Chrome-only heap snapshot (MB). */
export function memory(): { usedMB: number; totalMB: number } | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return m ? { usedMB: Math.round(m.usedJSHeapSize / 1048576), totalMB: Math.round(m.totalJSHeapSize / 1048576) } : null;
}

/** Counts of what is currently in the DOM (mounted embeds and rich-block editors). */
export function domCounts(): { embeds: number; visibleEmbeds: number; editors: number; nodes: number } {
  const embeds = [...document.querySelectorAll<HTMLElement>(".excalidraw__embeddable-container")];
  return {
    embeds: embeds.length,
    visibleEmbeds: embeds.filter((e) => e.style.display !== "none").length,
    editors: document.querySelectorAll(".acute-block .bn-editor[contenteditable='true']").length,
    nodes: document.getElementsByTagName("*").length,
  };
}

/** Moves every element by (dx, dy) as one change and times commit + write to IndexedDB. */
export async function measurePersistence(
  api: ExcalidrawImperativeAPI,
  flush: () => Promise<void>,
  dx = 1,
): Promise<{ elements: number; updateMs: number; flushMs: number }> {
  await flush();
  const elements = api.getSceneElementsIncludingDeleted();
  const t0 = performance.now();
  api.updateScene({
    elements: elements.map((el) => ({ ...el, x: el.x + dx, version: el.version + 1, versionNonce: randomNonce() })),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  const t1 = performance.now();
  // Let Excalidraw deliver the change (onChange) before committing it.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t2 = performance.now();
  await flush();
  const t3 = performance.now();
  return { elements: elements.length, updateMs: round(t1 - t0), flushMs: round(t3 - t2) };
}

const randomNonce = () => Math.floor(Math.random() * 2 ** 31);
const round = (ms: number) => Math.round(ms * 10) / 10;

/** `acute:*` performance marks/measures recorded so far (canvas open milestones). */
export function timings(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of performance.getEntriesByType("mark")) if (e.name.startsWith("acute:")) out[e.name] = round(e.startTime);
  for (const e of performance.getEntriesByType("measure")) if (e.name.startsWith("acute:")) out[e.name] = round(e.duration);
  return out;
}

// ---------------------------------------------------------------------------
// Edit-cost measurements: does one change stay local?

let storageWrites: { store: string; at: number }[] | null = null;

/** Counts IndexedDB writes (put/add/delete) from now on. Idempotent. */
function trackStorageWrites(): { store: string; at: number }[] {
  if (storageWrites) return storageWrites;
  const log: { store: string; at: number }[] = [];
  const proto = IDBObjectStore.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ["put", "add", "delete"]) {
    const original = proto[method]!;
    proto[method] = function (this: IDBObjectStore, ...args: unknown[]) {
      log.push({ store: this.name, at: performance.now() });
      return original.apply(this, args);
    };
  }
  return (storageWrites = log);
}

export interface WorkReport {
  /** Embeds whose content DOM changed (element ids). */
  contentChanged: string[];
  /** Embeds only repositioned/restyled by the canvas (their container attributes changed). */
  containerChanged: number;
  /** Embeds unmounted (deleted, or scrolled out of view). */
  removed: number;
  domMutations: number;
  /** Writes per IndexedDB store, and when the last one happened (ms after start). */
  storageWrites: Record<string, number>;
  settledMs: number;
  /** Visible result: first frame after the first content/container change (ms after start). */
  firstPaintMs: number | null;
  frames: FrameStats;
}

/**
 * Watches the work caused by `action` until storage has been quiet for
 * `quietMs`: which embeds re-rendered, DOM mutations, storage writes, frames.
 */
export async function watchWork(action: () => unknown, quietMs = 700): Promise<WorkReport> {
  const writes = trackStorageWrites();
  const layer = document.querySelector(".excalidraw__embeddable-container")?.parentElement ?? document.querySelector(".excalidraw")!;
  const content = new Set<string>();
  const containers = new Set<Element>();
  let mutations = 0;
  let removed = 0;
  let firstChange: number | null = null;
  let firstPaint: number | null = null;
  const changed = () => {
    if (firstChange !== null) return;
    firstChange = performance.now();
    requestAnimationFrame(() => (firstPaint = performance.now()));
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target === layer) {
        for (const n of r.removedNodes) if (n instanceof Element && n.classList.contains("excalidraw__embeddable-container")) removed++;
        mutations++;
        changed();
        continue;
      }
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      const container = target?.closest(".excalidraw__embeddable-container");
      if (!container) continue;
      mutations++;
      if (target === container && r.type === "attributes") containers.add(container);
      else {
        const id = container.querySelector("[data-element-id]")?.getAttribute("data-element-id");
        if (id) content.add(id);
      }
      changed();
    }
  });
  observer.observe(layer, { subtree: true, childList: true, attributes: true, characterData: true });
  const frames = recordFrames();
  const writesBefore = writes.length;
  const start = performance.now();
  await action();
  // Settle: wait until no storage write for `quietMs` (debounced saves included).
  let last = start;
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    const latest = writes.at(-1)?.at ?? 0;
    if (latest > last) last = latest;
    if (performance.now() - Math.max(last, start) > quietMs) break;
  }
  observer.disconnect();
  const byStore: Record<string, number> = {};
  for (const w of writes.slice(writesBefore)) byStore[w.store] = (byStore[w.store] ?? 0) + 1;
  return {
    contentChanged: [...content],
    containerChanged: containers.size,
    removed,
    domMutations: mutations,
    storageWrites: byStore,
    settledMs: round(last - start),
    firstPaintMs: firstPaint === null ? null : round((firstPaint as number) - start),
    frames: frames.stop(),
  };
}

/** Keystroke → painted-frame latency while typing into the focused editor. */
export function recordKeyLatency(): { stop(): { keys: number; p50: number; p95: number; max: number } } {
  const pending: number[] = [];
  const latencies: number[] = [];
  const onKey = () => pending.push(performance.now());
  const observer = new MutationObserver(() => {
    const t = pending.shift();
    if (t === undefined) return;
    pending.length = 0;
    requestAnimationFrame(() => latencies.push(performance.now() - t));
  });
  const root = document.querySelector(".acute-block[data-active]") ?? document.body;
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  document.addEventListener("keydown", onKey, true);
  return {
    stop() {
      observer.disconnect();
      document.removeEventListener("keydown", onKey, true);
      const s = latencies.slice().sort((a, b) => a - b);
      const at = (q: number) => round(s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0);
      return { keys: s.length, p50: at(0.5), p95: at(0.95), max: round(s.at(-1) ?? 0) };
    },
  };
}
