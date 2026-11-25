/**
 * The intelligent UI tools over MCP (note-taking-modes plan Step 5), through a real MCP client: which sessions get them,
 * the gate (D6) and the plan-limit hook (D49), the grammar, proposals that carry a checked layout, refusals that propose
 * nothing, citations only from a source on the open canvas, updates aimed at one card with stale-target protection, and
 * get_block's contentHash and layout. No model is involved anywhere.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as Y from "yjs";
import { afterEach, describe, expect, it } from "vitest";
import { AUTO_ACCEPT_TOOLS } from "@/ai/changes/autoAccept";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { cardContentHash, layoutFor } from "@/ai/openui/cardLayout";
import { checkLayout, layoutReviewLines } from "@/ai/openui/layoutCheck";
import { LAYOUT_EXAMPLES, layoutGrammar } from "@/ai/openui/layoutGrammar";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { canvasDocId } from "@/sync/docIds";
import { context, parse } from "@/testUtils/reconcileHarness";
import { createAcuteMcpServer, type AcuteMcpServerDeps } from "../server";
import type { ToolPolicy } from "./common";
import { availableToolNames } from "./index";
import { LAYOUT_MESSAGES, LAYOUT_TOOL_NAMES, layoutBoxHeight, type LayoutToolOptions } from "./layoutTools";
import type { LiveCanvasActions } from "./liveCanvas";
import { MESSAGES } from "./writeTools";

const WS = "ws_1";
const CV = "cv_1";
const p = (text: string) => ({ type: "paragraph" as const, content: text });
let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

const CARD_TEXT: RichContent = [p("Retry policy"), p("Jobs retry 5 times, then give up after 30 seconds.")];
const LANG = `root = IdeaCard("Retry policy", "Jobs retry 5 times, then give up.", "high")`;

function cardElement(id: string, documentId: string, blockType = "text"): SceneElement {
  return { id, type: "embeddable", x: 0, y: 0, width: 300, height: 200, isDeleted: false, groupIds: [], frameId: null, boundElements: null, customData: { acute: { kind: "rich-block", blockType, documentId } } } as unknown as SceneElement;
}

function fakeLive(docs: Map<string, DocumentRecord>, elements: SceneElement[] = []) {
  const proposed: ChangeSet[] = [];
  const live: LiveCanvasActions = {
    workspaceId: WS,
    canvasId: CV,
    elements: () => elements,
    renderContext: () => context,
    isReviewing: () => false,
    propose: (set) => void proposed.push(set),
    getDocument: (id) => docs.get(id) ?? null,
  };
  return { live, proposed };
}

const options = (services: ReturnType<typeof createMemoryServices>, allowed: () => boolean): LayoutToolOptions => ({
  allowed,
  contentSources: services.contentSources,
  check: async (input) => {
    const check = checkLayout(input);
    return { check, lines: layoutReviewLines(check) };
  },
  grammar: async () => ({ grammar: layoutGrammar(), examples: LAYOUT_EXAMPLES }),
});

async function connect(opts: { allowed?: boolean; policy?: ToolPolicy; extra?: Partial<AcuteMcpServerDeps>; docs?: Map<string, DocumentRecord>; elements?: SceneElement[]; layout?: false } = {}) {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: [CV], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: CV, workspaceId: WS, title: "Notes", createdAt: 1, updatedAt: 1 });
  const docs = opts.docs ?? new Map<string, DocumentRecord>();
  for (const d of docs.values()) await services.documents.put(d);
  const elements = opts.elements ?? [];
  // get_block reads the stored scene (the persisted canvas), so mirror the live elements into it.
  const ydoc = new Y.Doc();
  for (const el of elements) ydoc.getMap("elements").set(el.id, { ...el, version: 1 });
  await services.yupdates.append(canvasDocId(CV), Y.encodeStateAsUpdate(ydoc));
  ydoc.destroy();
  const { live, proposed } = fakeLive(docs, elements);
  const server = createAcuteMcpServer({
    services,
    workspaceId: WS,
    getCurrentContext: async () => null,
    getLiveCanvas: () => live,
    parseMarkdown: parse,
    ...(opts.policy ? { toolPolicy: opts.policy } : {}),
    ...(opts.layout === false ? {} : { layout: options(services, () => opts.allowed ?? true) }),
    ...opts.extra,
  });
  const client = new Client({ name: "Test Client", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return { client, proposed, services };
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const text = (r: CallToolResult) => (r.content as { text: string }[]).map((c) => c.text).join(" ");
const structured = (r: CallToolResult) => r.structuredContent as Record<string, unknown>;
const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);

describe("which sessions get the tools", () => {
  it("served with the app's check and grammar; never without them; availableTools lists the writes only while writes are allowed", async () => {
    expect(await names((await connect()).client)).toEqual(expect.arrayContaining([...LAYOUT_TOOL_NAMES]));
    expect(await names((await connect({ layout: false })).client)).not.toContain("create_layout_card");
    expect(availableToolNames(undefined, { layout: true })).toEqual(expect.arrayContaining([...LAYOUT_TOOL_NAMES]));
    const readOnlyNames = availableToolNames({ allowWrites: false }, { layout: true });
    expect(readOnlyNames).toContain("get_layout_grammar");
    expect(readOnlyNames).not.toContain("create_layout_card");
  });

  it("a read-only workspace refuses the writes at call time, as every write tool does (the grammar still works)", async () => {
    const { client, proposed } = await connect({ policy: { allowWrites: false } });
    const r = await call(client, "create_layout_card", { markdown: "Retry policy", lang: LANG });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(MESSAGES.writesDisabled);
    expect((await call(client, "get_layout_grammar")).isError).toBeFalsy();
    expect(proposed).toEqual([]);
  });

  it("a remote session on the restricted profile doesn't list them (the audited allowlist is unchanged)", async () => {
    const remote = await names((await connect({ extra: { remote: true, remoteProfile: "restricted" } })).client);
    for (const n of LAYOUT_TOOL_NAMES) expect(remote).not.toContain(n);
  });

  it("are never auto-accepted", () => {
    for (const n of LAYOUT_TOOL_NAMES) expect(AUTO_ACCEPT_TOOLS.has(n)).toBe(false);
  });
});

describe("the gate (D6) and the plan-limit hook (D49)", () => {
  it("off until the user allows it: a refusal that says where, and nothing proposed", async () => {
    const { client, proposed } = await connect({ allowed: false });
    for (const [tool, args] of [
      ["get_layout_grammar", {}],
      ["create_layout_card", { markdown: "Retry policy", lang: LANG }],
    ] as const) {
      const r = await call(client, tool, args);
      expect(r.isError).toBe(true);
      expect(text(r)).toBe(LAYOUT_MESSAGES.off);
    }
    expect(proposed).toEqual([]);
  });

  it("a policy's entitlement refusal comes back as entitlement_required (nothing gates it in this build)", async () => {
    const policy: ToolPolicy = { allowWrites: true, entitlement: (f) => ({ error: "entitlement_required", feature: f, upgrade: "Upgrade to use it." }) };
    const { client, proposed } = await connect({ policy });
    const r = await call(client, "create_layout_card", { markdown: "Retry policy", lang: LANG });
    expect(r.isError).toBe(true);
    expect(structured(r)).toMatchObject({ error: "entitlement_required", feature: "intelligent_ui" });
    expect(proposed).toEqual([]);
  });
});

describe("get_layout_grammar", () => {
  it("gives the library, the rules and one example per layout; every example passes the check", async () => {
    const r = await call((await connect()).client, "get_layout_grammar");
    const s = structured(r) as { grammar: string; examples: { layout: string; lang: string }[] };
    expect(s.grammar).toContain("IdeaCard(");
    expect(s.grammar).toContain("Static only");
    expect(s.grammar).toMatch(/not that the layout is right/);
    expect(s.examples.map((e) => e.layout)).toEqual(["IdeaCard", "Timeline", "FlowDiagram", "DecisionCard", "ComparisonTable"]);
    for (const e of s.examples) expect(checkLayout({ lang: e.lang }).errors, e.layout).toEqual([]);
  });
});

describe("create_layout_card", () => {
  it("proposes one text card carrying its text and its checked layout, sized for it; nothing written", async () => {
    const { client, proposed } = await connect();
    const r = await call(client, "create_layout_card", { markdown: "Retry policy\n\nJobs retry 5 times, then give up after 30 seconds.", lang: LANG });
    expect(r.isError, text(r)).toBeFalsy();
    expect(structured(r)).toMatchObject({ status: "proposed", changes: { create_block: 1 } });
    expect((structured(r).layoutCheck as { lines: string[] }).lines[0]).toMatch(/doesn't compare meaning/);
    expect(proposed).toHaveLength(1);
    const set = proposed[0]!;
    expect(set.metadata).toMatchObject({ createdBy: "mcp", task: "create_layout_card", provider: "Test Client" });
    expect(set.title).toBe("Test Client: Add layout card");
    const card = set.changes.find((c) => c.kind === "create_block")!;
    expect(card).toMatchObject({ blockType: "text", layout: { lang: LANG } });
    expect((card as { box: { height: number } }).box.height).toBeGreaterThanOrEqual(180);
  });

  it("a FlowDiagram or a Callout card is as tall as it is drawn, at the width it was placed with (not its text's height)", async () => {
    const { client, proposed } = await connect();
    const flowMd = "### Release\n\n1. **Build**\n\n   CI builds and tests\n\n2. **QA sign-off**\n\n   A QA engineer signs off\n\n3. **Deploy**\n\n   The release manager deploys";
    const flowLang = `root = FlowDiagram("Release", ["Build", "QA sign-off", "Deploy"], ["CI builds and tests", "A QA engineer signs off", "The release manager deploys"])`;
    const calloutLang = `root = Callout("warning", "Jobs retry 5 times, then give up after 30 seconds.")`;
    for (const [markdown, lang] of [
      [flowMd, flowLang],
      ["Retry policy\n\nJobs retry 5 times, then give up after 30 seconds.", calloutLang],
    ] as const) {
      const r = await call(client, "create_layout_card", { markdown, lang });
      expect(r.isError, text(r)).toBeFalsy();
    }
    const [flow, callout] = proposed.map((s) => s.changes.find((c) => c.kind === "create_block") as unknown as { box: { width: number; height: number } });
    expect(flow!.box.height).toBeLessThan(200);
    expect(callout!.box.height).toBeLessThan(110);
    expect(layoutBoxHeight(flowLang, 80, { width: flow!.box.width, height: 999 })).toBe(flow!.box.height);
    // Anything else keeps the text-based room.
    expect(layoutBoxHeight(LANG, 50, { width: 300, height: 100 })).toBeGreaterThanOrEqual(180);
  });

  it("refuses a layout that isn't static, invents a number, or cites without a source — and proposes nothing", async () => {
    const { client, proposed } = await connect();
    for (const lang of [`root = IdeaCard("Retry policy", "x")\nq = Query("list_users", {})`, LANG.replace("5 times", "7 times"), `root = IdeaCard("Retry policy", "Jobs retry 5 times.", null, [c1])\nc1 = CitationChip("u1")`]) {
      const r = await call(client, "create_layout_card", { markdown: "Retry policy\n\nJobs retry 5 times.", lang });
      expect(r.isError, lang).toBe(true);
      expect(text(r)).toContain(LAYOUT_MESSAGES.refused);
    }
    expect(proposed).toEqual([]);
  });

  it("cites only passages of a source on the open canvas", async () => {
    const { client, proposed, services } = await connect();
    const source = { id: "src_1", workspaceId: WS, canvasId: CV, origin: "paste" as const, tier: "local" as const, latestVersion: 1, createdAt: 1, updatedAt: 1 };
    await services.contentSources.append(source as never, { sourceId: "src_1", version: 1, text: "", createdAt: 1, units: { units: [{ id: "u1", text: "Jobs retry 5 times." }] } } as never);
    await services.contentSources.append({ ...source, id: "src_other", canvasId: "cv_other" } as never, { sourceId: "src_other", version: 1, text: "", createdAt: 1, units: { units: [{ id: "u1", text: "x" }] } } as never);
    const cited = `root = IdeaCard("Retry policy", "Jobs retry 5 times.", null, [c1])\nc1 = CitationChip("u1")`;

    const ok = await call(client, "create_layout_card", { markdown: "Retry policy\n\nJobs retry 5 times.", lang: cited, sourceId: "src_1" });
    expect(ok.isError, text(ok)).toBeFalsy();
    expect((structured(ok).layoutCheck as { cites: string[] }).cites).toEqual(["u1"]);

    const invented = await call(client, "create_layout_card", { markdown: "Retry policy\n\nJobs retry 5 times.", lang: cited.replace(`"u1"`, `"u9"`), sourceId: "src_1" });
    expect(text(invented)).toContain(`Cites "u9"`);
    const elsewhere = await call(client, "create_layout_card", { markdown: "Retry policy\n\nJobs retry 5 times.", lang: cited, sourceId: "src_other" });
    expect(text(elsewhere)).toContain("No content source src_other on the open canvas");
    expect(proposed).toHaveLength(1);
  });
});

describe("update_layout_card and get_block", () => {
  const setup = (layout?: boolean) => {
    const record: DocumentRecord = {
      id: "doc_1",
      workspaceId: WS,
      canvasId: CV,
      kind: "block",
      title: "Untitled",
      snapshot: CARD_TEXT,
      createdAt: 1,
      updatedAt: 1,
      ...(layout ? { layout: layoutFor({ title: "Untitled", snapshot: CARD_TEXT }, LANG) } : {}),
    };
    return { docs: new Map([["doc_1", record]]), elements: [cardElement("el_1", "doc_1"), cardElement("el_code", "doc_1", "code")] };
  };

  it("get_block gives a text card's contentHash and its layout, with whether it is current", async () => {
    const { client } = await connect(setup(true));
    const s = structured(await call(client, "get_block", { id: "el_1" }));
    expect(s.contentHash).toBe(cardContentHash({ title: "Untitled", snapshot: CARD_TEXT }));
    expect(s.layout).toEqual({ lang: LANG, current: true });
  });

  it("a new layout: one update_block aimed at the card, its text kept, the baseline carried", async () => {
    const { client, proposed } = await connect(setup(false));
    const next = `root = IdeaCard("Retry policy", "Five retries, then stop after 30 seconds.")`;
    const r = await call(client, "update_layout_card", { objectId: "el_1", lang: next, expectedContentHash: cardContentHash({ title: "Untitled", snapshot: CARD_TEXT }) });
    expect(r.isError, text(r)).toBeFalsy();
    const change = proposed[0]!.changes[0] as Record<string, unknown>;
    expect(change).toMatchObject({ kind: "update_block", target: "el_1", content: CARD_TEXT, layout: { lang: next } });
    expect(change.expectedFingerprint).toEqual(expect.any(String));
    expect(proposed[0]!.title).toBe("Test Client: Update card layout");
  });

  it("removeLayout proposes layout: null; text only warns that the old layout will show as out of date", async () => {
    const removed = await connect(setup(true));
    await call(removed.client, "update_layout_card", { objectId: "el_1", removeLayout: true });
    expect(removed.proposed[0]!.changes[0]).toMatchObject({ kind: "update_block", layout: null });

    const textOnly = await connect(setup(true));
    const r = await call(textOnly.client, "update_layout_card", { objectId: "el_1", markdown: "Retry policy\n\nJobs retry 3 times." });
    expect(r.isError, text(r)).toBeFalsy();
    expect(textOnly.proposed[0]!.changes[0]).not.toHaveProperty("layout");
    expect((structured(r).warnings as string[]).join(" ")).toMatch(/out of date/);
  });

  it("refuses a card changed since it was read, a non-text block, and an empty or contradictory request", async () => {
    const { client, proposed } = await connect(setup(true));
    expect(text(await call(client, "update_layout_card", { objectId: "el_1", lang: LANG, expectedContentHash: "0000000000000000" }))).toMatch(/changed since you read it/);
    expect(text(await call(client, "update_layout_card", { objectId: "el_code", lang: LANG }))).toMatch(/text cards only/);
    expect(text(await call(client, "update_layout_card", { objectId: "el_1" }))).toMatch(/Give `markdown`, `lang` or `removeLayout`/);
    expect(text(await call(client, "update_layout_card", { objectId: "el_1", lang: LANG, removeLayout: true }))).toMatch(/not both/);
    expect(proposed).toEqual([]);
  });
});
