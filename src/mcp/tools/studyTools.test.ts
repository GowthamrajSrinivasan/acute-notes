/**
 * Study Mode Phase 4 (plan §6, §9): `get_weak_concepts` over the real MCP server and client, in memory. Read-only
 * enforcement, workspace isolation, bounds, and what is never returned (source and unit ids, concept keys, local and
 * retired concepts, passages). No AI, no network.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { conceptKey, localConceptKey, type Concept } from "@/ai/study/concept";
import { recordAttempt, studyIndexKey, studyShardKey } from "@/ai/study/store";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { MetaRepository, PersistenceServices } from "@/persistence/repositories/types";
import { canvasDocId } from "@/sync/docIds";
import type { CurrentContext } from "../context/currentContext";
import { createAcuteMcpServer, type AcuteMcpServerDeps } from "../server";
import { conceptHandle, STUDY_CAUTION, STUDY_LIMITS } from "./studyTools";

const WS = "ws_1";
const OTHER = "ws_2";
let z = 0;
const el = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "rectangle", version: 1, index: `a${String(z++).padStart(4, "0")}`, x: 0, y: 0, width: 100, height: 60, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", ...extra });

async function writeScene(services: PersistenceServices, canvasId: string, elements: Record<string, unknown>[]) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of elements) m.set(e.id as string, e);
  });
  await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
}

const concept = (sourceId: string, units: string[], version = 1): Concept => ({ key: conceptKey(sourceId, units), local: false, sourceId, units, sourceVersion: version });
async function miss(meta: MetaRepository, ws: string, c: Concept, canvasId: string, objectId: string, times = 2, extra: { unverified?: boolean; title?: string } = {}) {
  for (let i = 0; i < times; i++) await recordAttempt(meta, ws, { concept: c, canvasId, title: extra.title ?? objectId, kind: "quiz", correct: false, objectId, at: Date.now() - 1000 + i, ...(extra.unverified ? { unverified: true } : {}) });
}

async function seed() {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1", "cv_3"], createdAt: 1, updatedAt: 2 });
  await services.workspaces.put({ id: OTHER, name: "Private", canvasIds: ["cv_2"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Payments", createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_3", workspaceId: WS, title: "Caching", createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_2", workspaceId: OTHER, title: "Diary", createdAt: 1, updatedAt: 2 });
  await writeScene(services, "cv_1", [el("card_a"), el("card_b"), el("card_rev"), el("card_gone", { isDeleted: true })]);
  await writeScene(services, "cv_3", [el("card_c")]);
  await writeScene(services, "cv_2", [el("card_x")]);

  const m = services.meta;
  await miss(m, WS, concept("src_secret", ["u1", "u2"]), "cv_1", "card_a", 3, { title: "Retry budget" });
  await miss(m, WS, concept("src_secret", ["u7"]), "cv_1", "card_rev", 2, { unverified: true, title: "Under review" });
  await miss(m, WS, concept("src_other", ["u3"]), "cv_3", "card_c", 2, { title: "Cache size" });
  await miss(m, WS, concept("src_secret", ["u9"]), "cv_1", "card_gone", 2, { title: "Deleted card" });
  // A card ref pointing at another workspace's canvas (a hand-made or stale record).
  await miss(m, WS, concept("src_secret", ["u11"]), "cv_2", "card_x", 2, { title: "Foreign card" });
  // Local concept (no source): never returned.
  await recordAttempt(m, WS, { concept: { key: localConceptKey("cv_1", "card_b"), local: true }, canvasId: "cv_1", title: "Local", kind: "quiz", correct: false, objectId: "card_b", at: 1 });
  // Retired: never returned.
  const retiredKey = conceptKey("src_secret", ["u5"]);
  await miss(m, WS, concept("src_secret", ["u5"]), "cv_1", "card_b", 2, { title: "Retired one" });
  const shard = (await m.get<{ concepts: Record<string, { state?: string; reason?: string }> }>(studyShardKey(WS, "src_secret")))!;
  shard.concepts[retiredKey]!.state = "retired";
  shard.concepts[retiredKey]!.reason = "source_missing";
  await m.set(studyShardKey(WS, "src_secret"), shard);
  // Another workspace's study history: never read.
  await miss(m, OTHER, concept("src_private", ["u1"]), "cv_2", "card_x", 4, { title: "Private diary concept" });
  return services;
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function connect(services: PersistenceServices, extra: Partial<AcuteMcpServerDeps> = {}) {
  const server = createAcuteMcpServer({ services, workspaceId: WS, getCurrentContext: async () => null, ...extra });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return client;
}
type Payload = { scope: { workspaceId: string; canvasId?: string }; concepts: { handle: string; title: string; cards: { objectId: string; canvasUri: string }[]; reviewStatus: string; verified: boolean; band: string; weakBecause: string }[]; counts: Record<string, number>; truncated: boolean; caution: string };
async function call(client: Client, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name: "get_weak_concepts", arguments: args });
  const content = res.content as { text: string }[];
  return { res, text: content.map((c) => c.text).join("\n"), payload: res.isError ? null : (JSON.parse(content.at(-1)!.text) as Payload) };
}

describe("get_weak_concepts (Study Phase 4) — contract", () => {
  it("is listed as a read-only tool", async () => {
    const client = await connect(await seed());
    const tool = (await client.listTools()).tools.find((t) => t.name === "get_weak_concepts")!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(Object.keys((tool.inputSchema as { properties: object }).properties).sort()).toEqual(["allCanvases", "canvasId", "includeNeedsReview", "limit"]);
  });

  it("returns this workspace's weak concepts, weakest first, with live cards, opaque handles and verified:false", async () => {
    const client = await connect(await seed());
    const { payload } = await call(client, { allCanvases: true });
    expect(payload!.scope).toEqual({ workspaceId: WS });
    expect(payload!.concepts.map((c) => c.title).sort()).toEqual(["Cache size", "Deleted card", "Foreign card", "Retry budget", "Under review"]);
    const retry = payload!.concepts.find((c) => c.title === "Retry budget")!;
    expect(retry).toMatchObject({ handle: conceptHandle(conceptKey("src_secret", ["u1", "u2"])), cards: [{ objectId: "card_a", canvasUri: "acute://canvas/cv_1" }], weakBecause: "low_accuracy", band: "weak", reviewStatus: "no_open_review", verified: false });
    expect(payload!.concepts.find((c) => c.title === "Under review")!.reviewStatus).toBe("needs_review");
    expect(payload!.concepts.every((c) => c.verified === false)).toBe(true);
    expect(payload!.counts).toMatchObject({ weak: 5, studied: 5, retiredHidden: 1, localHidden: 1 });
    expect(payload!.caution).toBe(STUDY_CAUTION);
  });

  it("never returns source ids, unit ids, concept keys, local or retired concepts, or passages", async () => {
    const client = await connect(await seed());
    const { text } = await call(client, { allCanvases: true });
    expect(text).not.toMatch(/src_secret|src_other|src_private|\bu\d+\b|c:|l:cv_|Retired one|"Local"|passage/);
    expect(text).toContain("sc_");
  });

  it("drops cards that are deleted, and an unknown snapshot reads as unknown", async () => {
    const services = await seed();
    const key = conceptKey("src_secret", ["u1", "u2"]);
    const shard = (await services.meta.get<{ concepts: Record<string, { sourceVersion: number }> }>(studyShardKey(WS, "src_secret")))!;
    shard.concepts[key]!.sourceVersion = 2; // the source moved on since the card's review status was seen
    await services.meta.set(studyShardKey(WS, "src_secret"), shard);
    const { payload } = await call(await connect(services), { allCanvases: true });
    expect(payload!.concepts.find((c) => c.title === "Deleted card")!.cards).toEqual([]);
    expect(payload!.concepts.find((c) => c.title === "Retry budget")!.reviewStatus).toBe("unknown");
  });

  it("scopes to the open canvas by default, a given canvas, or the workspace; includeNeedsReview:false hides those", async () => {
    const services = await seed();
    const ctx = { uri: "acute://context/current", version: 1, workspace: { id: WS, name: "Team" }, canvas: { id: "cv_3", title: "Caching" }, selection: [] } as unknown as CurrentContext;
    const client = await connect(services, { getCurrentContext: async () => ctx });
    expect((await call(client)).payload!.concepts.map((c) => c.title)).toEqual(["Cache size"]);
    const cv1 = (await call(client, { canvasId: "cv_1" })).payload!;
    expect(cv1.scope).toEqual({ workspaceId: WS, canvasId: "cv_1" });
    expect(cv1.concepts.map((c) => c.title).sort()).toEqual(["Retry budget", "Under review"]);
    const hidden = (await call(client, { canvasId: "cv_1", includeNeedsReview: false })).payload!;
    expect(hidden.concepts.map((c) => c.title)).toEqual(["Retry budget"]);
    expect(hidden.counts.needsReviewHidden).toBe(1);
    expect((await call(client, { allCanvases: true })).payload!.concepts).toHaveLength(5);
  });

  it("is bounded: default 10, at most 25 with truncated, and a larger limit is refused", async () => {
    const services = await seed();
    for (let i = 0; i < 40; i++) await miss(services.meta, WS, concept("src_bulk", [`u${i + 1}`]), "cv_1", "card_a", 2, { title: `Bulk ${i}` });
    const client = await connect(services);
    const d = (await call(client, { allCanvases: true })).payload!;
    expect(d.concepts).toHaveLength(STUDY_LIMITS.defaultResults);
    expect(d.truncated).toBe(true);
    const max = (await call(client, { allCanvases: true, limit: 25 })).payload!;
    expect(max.concepts).toHaveLength(25);
    expect(max.counts.weak).toBe(45);
    expect((await call(client, { allCanvases: true, limit: 26 })).res.isError).toBe(true);
    expect(JSON.stringify(max).length).toBeLessThan(STUDY_LIMITS.payloadChars + 2_000);
  });
});

describe("get_weak_concepts — read-only enforcement", () => {
  it("never writes or deletes anything, whatever it is asked", async () => {
    const services = await seed();
    const writes: string[] = [];
    const meta: MetaRepository = {
      get: services.meta.get.bind(services.meta),
      set: async (k) => void writes.push(`set ${k}`),
      delete: async (k) => void writes.push(`delete ${k}`),
    };
    const before = JSON.stringify([await services.meta.get(studyIndexKey(WS)), await services.meta.get(studyShardKey(WS, "src_secret"))]);
    const client = await connect({ ...services, meta });
    writes.length = 0; // only the tool calls count
    for (const args of [{}, { allCanvases: true }, { canvasId: "cv_1", limit: 1 }, { includeNeedsReview: false }, { canvasId: "cv_2" }, { canvasId: "nope" }]) await call(client, args);
    expect(writes).toEqual([]);
    expect(JSON.stringify([await services.meta.get(studyIndexKey(WS)), await services.meta.get(studyShardKey(WS, "src_secret"))])).toBe(before);
  });

  it("offers no write input: unknown arguments are ignored, not acted on", async () => {
    const client = await connect(await seed());
    const { payload } = await call(client, { allCanvases: true, record: { correct: true }, clear: true });
    expect(payload!.counts.weak).toBe(5);
  });
});

describe("get_weak_concepts — workspace isolation", () => {
  it("never reads another workspace's study history, even when asked for its id", async () => {
    const client = await connect(await seed());
    const { text, payload } = await call(client, { allCanvases: true, workspaceId: OTHER });
    expect(payload!.scope.workspaceId).toBe(WS);
    expect(text).not.toMatch(/Private diary concept|ws_2/);
  });

  it("refuses another workspace's canvas as not found, and drops cards that live there", async () => {
    const client = await connect(await seed());
    const foreign = await call(client, { canvasId: "cv_2" });
    expect(foreign.res.isError).toBe(true);
    expect(foreign.text).toMatch(/Canvas not found: cv_2/);
    const { payload, text } = await call(client, { allCanvases: true });
    expect(payload!.concepts.find((c) => c.title === "Foreign card")!.cards).toEqual([]);
    expect(text).not.toMatch(/card_x|cv_2/);
  });

  it("a connection for the other workspace sees only its own history", async () => {
    const services = await seed();
    const server = createAcuteMcpServer({ services, workspaceId: OTHER, getCurrentContext: async () => null });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    closers.push(() => client.close(), () => server.close());
    const { payload } = await call(client, { allCanvases: true });
    expect(payload!.concepts.map((c) => c.title)).toEqual(["Private diary concept"]);
    expect(payload!.concepts[0]!.cards).toEqual([{ objectId: "card_x", canvasUri: "acute://canvas/cv_2" }]);
  });

  it("without the device's meta store, says study history isn't available", async () => {
    const services = await seed();
    const { meta: _meta, ...rest } = services;
    const res = await call(await connect(rest as unknown as PersistenceServices), { allCanvases: true });
    expect(res.res.isError).toBe(true);
    expect(res.text).toMatch(/Study history isn't available/);
  });
});
