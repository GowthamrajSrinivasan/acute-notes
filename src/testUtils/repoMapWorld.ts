/**
 * The F43 Repo Map test world: a fake open canvas (with the real PendingChanges and a writer that stamps like
 * changeSetWriter.ts) and a scripted MCP client over the real server. Shared by `repoMap.test.ts` and the live
 * agent-sync contract test.
 */
// @vitest-environment happy-dom
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChangeSet, ChangeTarget, ProposedChange } from "@/ai/changes/changeSet";
import { acceptParts, type PartDecision } from "@/ai/changes/parts";
import { PendingChanges } from "@/ai/changes/pendingChanges";
import { recordAcceptedSource } from "@/ai/content/sources";
import { fingerprintContent, fingerprintShape } from "@/ai/content/fingerprint";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { AIMetadata, DocumentRecord, RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { createAcuteMcpServer } from "@/mcp/server";
import type { LiveCanvasActions } from "@/mcp/tools/liveCanvas";


export const WS = "ws_1";
export const stubMarkdown = (md: string): RichContent => [{ type: "paragraph", content: md }];

// ---------------------------------------------------------------------------
// A fake open canvas: scene + documents + the real PendingChanges, a writer
// that stamps like changeSetWriter.ts, and a snapshot history.

export type El = SceneElement & { customData?: Record<string, unknown> };
let ids = 0;
export const nid = (p: string) => `${p}${++ids}`;

export class FakeCanvas {
  elements: El[] = [];
  docs = new Map<string, DocumentRecord>();
  pending = new PendingChanges();
  steps: { id: number; elements: El[]; docs: Map<string, DocumentRecord> }[] = [];
  stale = new Set<string>();
  affected = new Set<string>();
  private nextStep = 1;

  constructor(
    readonly canvasId: string,
    readonly services: PersistenceServices,
  ) {}

  live(): LiveCanvasActions {
    return {
      workspaceId: WS,
      canvasId: this.canvasId,
      elements: () => this.elements,
      renderContext: () => {
        const live = this.elements.filter((e) => !e.isDeleted);
        return {
          existing: live.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })),
          viewport: { x: 0, y: 0, width: 1600, height: 1000 },
          objects: live
            .filter((e) => !(e.type === "text" && e.containerId) && e.type !== "arrow")
            .map((e) => ({ id: e.id, box: { x: e.x, y: e.y, width: e.width, height: e.height }, unit: e.type === "frame" ? e.id : (e.frameId ?? e.id), locked: e.locked, placedByAcute: !(e as { userPlaced?: boolean }).userPlaced })),
        };
      },
      isReviewing: () => this.pending.get(this.canvasId) !== null,
      propose: (set) => void this.pending.propose(this.canvasId, set),
      getDocument: (id) => this.docs.get(id),
      pending: () => this.pending.get(this.canvasId),
      merge: (set) => void this.pending.merge(this.canvasId, set),
      dropParts: (key, keys) => this.pending.dropParts(this.canvasId, key, keys),
      acceptParts: (keys) => {
        const r = this.accept(keys);
        return r ? { stepId: r.stepId, applied: r.applied.length } : null;
      },
      setStale: (idList, ancestors) => {
        this.stale = new Set(idList);
        this.affected = new Set(ancestors ?? []);
      },
      clearStale: (idList) => idList.forEach((i) => this.stale.delete(i)),
    };
  }

  get set(): ChangeSet | null {
    return this.pending.get(this.canvasId);
  }

  /** "Accept all" / "Accept section": the same pure path the review bar takes (`acceptPendingParts`). */
  accept(keys: readonly string[] | null = null, decisions: ReadonlyMap<string, PartDecision> = new Map()) {
    const set = this.set;
    if (!set?.parts) return null;
    const result = acceptParts(set, keys ? new Set(keys) : null, decisions, () => this.writer(), { record: (m) => this.record(m) });
    this.pending.replace(this.canvasId, set.operationId, result.rest);
    for (const part of result.accepted) if (part.contentSource) void recordAcceptedSource(this.services.contentSources, { workspaceId: WS, canvasId: this.canvasId }, part.contentSource);
    return result;
  }

  reject(): void {
    const set = this.set;
    if (set) this.pending.settle(this.canvasId, set.operationId);
  }

  record(mutate: () => void): number | null {
    const before = { elements: structuredClone(this.elements), docs: structuredClone(this.docs) };
    mutate();
    if (JSON.stringify(before.elements) === JSON.stringify(this.elements)) return null;
    const id = this.nextStep++;
    this.steps.push({ id, ...before });
    return id;
  }

  undo(): void {
    const step = this.steps.pop();
    if (!step) return;
    this.elements = step.elements;
    this.docs = step.docs;
  }

  live_(): El[] {
    return this.elements.filter((e) => !e.isDeleted);
  }

  /** Objects (not labels, not arrows, not frames). */
  cards(): El[] {
    return this.live_().filter((e) => e.type !== "arrow" && e.type !== "frame" && !(e.type === "text" && e.containerId));
  }

  frames(): El[] {
    return this.live_().filter((e) => e.type === "frame");
  }

  arrows(): El[] {
    return this.live_().filter((e) => e.type === "arrow");
  }

  /** The card showing `key` (by its reconciliation link). */
  cardOf(key: string): El | undefined {
    return this.cards().find((e) => this.aiOf(e)?.stableNodeKey === key);
  }

  aiOf(e: El): AIMetadata | undefined {
    const ref = e.customData?.acute as { documentId?: string } | undefined;
    if (ref?.documentId) return this.docs.get(ref.documentId)?.metadata?.ai;
    return (e.customData?.acuteMeta as { ai?: AIMetadata } | undefined)?.ai;
  }

  /** The user edits a card's text. */
  edit(key: string, text: string): void {
    const el = this.cardOf(key)!;
    const ref = el.customData!.acute as { documentId: string };
    const doc = this.docs.get(ref.documentId)!;
    this.docs.set(doc.id, { ...doc, snapshot: [{ type: "paragraph", content: text }] });
  }

  /** The user deletes a card. */
  delete(key: string): void {
    this.cardOf(key)!.isDeleted = true;
  }

  private writer() {
    const byId = () => new Map(this.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e] as const));
    const live = byId();
    return {
      boxOf: (id: string) => {
        const e = live.get(id);
        return e ? { x: e.x, y: e.y, width: e.width, height: e.height } : undefined;
      },
      write: (set: ChangeSet, changes: readonly ProposedChange[]) => this.write(set, changes),
    };
  }

  private base(type: string, box: { x: number; y: number; width: number; height: number }, extra: Partial<El> = {}): El {
    return { id: nid("e"), type, ...box, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", ...extra };
  }

  /** Mirrors changeSetWriter.ts's stamping. */
  private write(set: ChangeSet, changes: readonly ProposedChange[]): Map<string, string> {
    const source = set.contentSource;
    const meta = (key: string | undefined, fingerprint: string, refs?: unknown, previous?: AIMetadata): AIMetadata => ({
      ...(previous ?? {}),
      ...set.metadata,
      ...(source && key ? { contentSourceId: source.sourceId, contentSourceVersion: source.version, stableNodeKey: key, contentFingerprint: fingerprint } : {}),
      ...(refs ? { sourceRefs: refs as AIMetadata["sourceRefs"] } : {}),
    });
    const created = new Map<string, string>();
    const get = (id: string) => this.elements.find((e) => e.id === id && !e.isDeleted);
    for (const c of changes) {
      if (c.kind === "create_block") {
        const docId = nid("d");
        this.docs.set(docId, { id: docId, workspaceId: WS, kind: "block", title: "", snapshot: c.content, createdAt: 1, updatedAt: 1, metadata: { ai: meta(c.stableNodeKey, fingerprintContent(c.content), c.sourceRefs) } });
        // As the real writer: a frameless block (a section's title) is styled so; a card's kind rides in its acuteNode.
        const el = this.base("embeddable", c.box, {
          customData: {
            acute: { kind: "rich-block", blockType: c.blockType, documentId: docId, ...(c.frame === "none" ? { style: { frame: "none" } } : {}) },
            ...(c.semantics?.kind ? { acuteNode: { kind: c.semantics.kind } } : {}),
          },
        });
        this.elements.push(el);
        created.set(c.key, el.id);
      } else if (c.kind === "create_shape") {
        const el = this.base(c.shape, c.box, { customData: { acuteMeta: { ai: meta(c.stableNodeKey, fingerprintShape(c.shape, c.label ?? ""), c.sourceRefs) }, ...(c.semantics?.kind ? { acuteNode: { kind: c.semantics.kind } } : {}) } });
        this.elements.push(el, this.base("text", c.box, { containerId: el.id, text: c.label ?? "", originalText: c.label ?? "" }));
        created.set(c.key, el.id);
      }
    }
    for (const c of changes) {
      if (c.kind !== "create_frame") continue;
      // As the real writer: a diagram section's frame is interactive, with its Lens level (Phase 2).
      const diagram = c.diagram ? { acuteDiagram: { type: "architecture", interactive: true, ...(c.level !== undefined ? { level: c.level } : {}) } } : {};
      const frame = this.base("frame", c.box, { name: c.title, customData: { acuteMeta: { ai: { ...set.metadata } }, ...diagram } } as never);
      for (const k of c.children) {
        const el = created.has(k) ? get(created.get(k)!) : undefined;
        if (el) el.frameId = frame.id;
      }
      this.elements.push(frame);
      created.set(c.key, frame.id);
    }
    for (const c of changes) {
      if (c.kind === "update_frame") {
        for (const k of c.add) if (created.has(k)) get(created.get(k)!)!.frameId = c.target;
        if (c.name !== undefined) (get(c.target) as { name?: string }).name = c.name;
      }
      if (c.kind === "move") Object.assign(get(c.target) ?? {}, c.to);
    }
    const resolve = (t: ChangeTarget) => ("existing" in t ? t.existing : created.get(t.created)!);
    for (const c of changes) {
      if (c.kind !== "connect") continue;
      const el = this.base("arrow", { x: 0, y: 0, width: 1, height: 1 }, {
        startBinding: { elementId: resolve(c.from) },
        endBinding: { elementId: resolve(c.to) },
        customData: { acuteMeta: { ai: { ...set.metadata, ...(source ? { contentSourceId: source.sourceId, contentSourceVersion: source.version } : {}) } }, ...(c.relation ? { acuteRelation: c.relation } : {}) },
      });
      this.elements.push(el);
      created.set(c.key, el.id);
    }
    for (const c of changes) {
      if (c.kind === "update_block") {
        const el = get(c.target)!;
        const ref = el.customData!.acute as { documentId: string };
        const previous = this.docs.get(ref.documentId)?.metadata?.ai;
        const docId = nid("d");
        this.docs.set(docId, { id: docId, workspaceId: WS, kind: "block", title: "", snapshot: c.content, createdAt: 1, updatedAt: 1, metadata: { ai: meta(c.stableNodeKey, fingerprintContent(c.content), c.sourceRefs, previous) } });
        el.customData = { ...el.customData, acute: { ...ref, documentId: docId } };
      } else if (c.kind === "remove") {
        const el = get(c.target);
        if (!el) continue;
        el.isDeleted = true;
        for (const a of this.elements) {
          if (a.type === "text" && a.containerId === el.id) a.isDeleted = true;
          const aSource = (a.customData?.acuteMeta as { ai?: AIMetadata } | undefined)?.ai?.contentSourceId;
          if (a.type === "arrow" && (a.startBinding?.elementId === el.id || a.endBinding?.elementId === el.id) && source && aSource === source.sourceId) a.isDeleted = true;
        }
        if (el.frameId && !this.elements.some((m) => m.frameId === el.frameId && !m.isDeleted)) get(el.frameId)!.isDeleted = true;
      } else if (c.kind === "update_connection") {
        const el = get(c.target);
        if (el && c.relation !== undefined) el.customData = { ...el.customData, ...(c.relation ? { acuteRelation: c.relation } : {}) };
      } else if (c.kind === "update_shape") {
        // As the real writer: the label is the shape's bound text; the link and sources are re-stamped on the shape.
        const el = get(c.target)!;
        const label = this.elements.find((t) => t.type === "text" && t.containerId === el.id && !t.isDeleted);
        if (label) Object.assign(label, { text: c.label, originalText: c.label });
        const previous = (el.customData?.acuteMeta as { ai?: AIMetadata } | undefined)?.ai;
        el.customData = { ...el.customData, acuteMeta: { ai: meta(c.stableNodeKey, fingerprintShape(el.type, c.label), c.sourceRefs, previous) } };
      } else if (c.kind === "rebaseline") {
        const el = get(c.target)!;
        const ref = el.customData!.acute as { documentId: string };
        const doc = this.docs.get(ref.documentId)!;
        this.docs.set(doc.id, { ...doc, metadata: { ai: { ...doc.metadata!.ai!, ...(source ? { contentSourceVersion: source.version } : {}), contentFingerprint: fingerprintContent(doc.snapshot) } } });
      }
    }
    return created;
  }
}

// ---------------------------------------------------------------------------
// The client

export interface World {
  services: PersistenceServices;
  canvas: FakeCanvas;
  client: Client;
  opened: string | null;
  writes: boolean;
}

let closers: (() => Promise<void>)[] = [];
/** Closes every client/server `world()` opened; call from `afterEach`. */
export async function closeWorlds(): Promise<void> {
  await Promise.all(closers.map((c) => c()));
  closers = [];
}

export async function world(opts: { open?: boolean; clientName?: string; parseMarkdown?: (md: string) => RichContent } = {}): Promise<World> {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 1 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Notes", createdAt: 1, updatedAt: 1 });
  const canvas = new FakeCanvas("cv_map", services);
  const w: World = { services, canvas, client: null as unknown as Client, opened: opts.open === false ? null : "cv_1", writes: true };
  const other = new FakeCanvas("cv_1", services);
  // Registered once per canvas, like the real canvas's actions.
  const mapLive = canvas.live();
  const otherLive = other.live();
  const server = createAcuteMcpServer({
    services,
    workspaceId: WS,
    getCurrentContext: async () => null,
    getLiveCanvas: () => (w.opened === "cv_map" ? mapLive : w.opened === "cv_1" ? otherLive : null),
    parseMarkdown: opts.parseMarkdown ?? stubMarkdown,
    toolPolicy: () => ({ allowWrites: w.writes }),
    repoMap: {
      services: { store: services.repoMaps, contentSources: services.contentSources },
      host: () => ({
        createCanvas: async (title) => {
          await services.canvases.put({ id: "cv_map", workspaceId: WS, title, createdAt: 1, updatedAt: 1 });
          return "cv_map";
        },
        openCanvas: (id) => {
          if (opts.open !== false) w.opened = id;
        },
      }),
      openTimeoutMs: 200,
    },
  });
  const client = new Client({ name: opts.clientName ?? "Claude Code", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  w.client = client;
  return w;
}

export async function call(w: World, name: string, args: Record<string, unknown>) {
  return (await w.client.callTool({ name, arguments: args })) as CallToolResult;
}

// Tool payloads are asserted field by field; typing each one would only restate the tools.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ok<T = Record<string, any>>(w: World, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await call(w, name, args);
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
  return res.structuredContent as T;
}

export async function rejected(w: World, name: string, args: Record<string, unknown>) {
  const res = await call(w, name, args);
  expect(res.isError).toBe(true);
  const [text, json] = res.content as { text: string }[];
  return { text: text!.text, payload: JSON.parse(json!.text) as { status: string; reason: string; message: string; keys?: string[] } };
}

export async function begin(w: World, commit = "c1") {
  return ok(w, "begin_repo_map", { repo: "org/app", commit });
}

export const COMMIT = "9c1e2ab";
export const PRIMARY = 12;

export function section(mod: string, n: number, opts: { commit?: string; text?: (i: number) => string; rels?: unknown[]; extra?: unknown[] } = {}) {
  return {
    commit: opts.commit ?? COMMIT,
    section: { key: `mod:${mod}`, label: `Module ${mod}`, arrangement: "grid" },
    nodes: [
      ...Array.from({ length: n }, (_, i) => ({
        key: `file:${mod}/f${i}.ts`,
        type: "text",
        title: `f${i}.ts`,
        markdown: opts.text?.(i) ?? `What ${mod}/f${i}.ts does.`,
        source: { path: `${mod}/f${i}.ts`, lines: [1, 40 + i] },
      })),
      ...(opts.extra ?? []),
    ],
    relationships: [
      ...(opts.rels ?? (n > 1 ? [{ from: `file:${mod}/f0.ts`, to: `file:${mod}/f1.ts`, type: "depends_on" }] : [])),
      // Past the per-call budget of primary cards (Wave 1b), the rest are detail cards under the first twelve.
      ...Array.from({ length: Math.max(0, n - PRIMARY) }, (_, d) => ({ from: `file:${mod}/f${d % PRIMARY}.ts`, to: `file:${mod}/f${PRIMARY + d}.ts`, type: "explained_by" })),
    ],
  };
}

export async function upsert(w: World, mapId: string, s: ReturnType<typeof section>) {
  return ok(w, "upsert_map_section", { mapId, ...s });
}

/** Lets the async content-source writes of an accept land. */
export const settle = () => new Promise((r) => setTimeout(r, 0));

export const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
