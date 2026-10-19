import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { arrow, block, doc, lookup, note, pageDoc, pagePreview, para } from "@/search/testFixtures";
import { WorkspaceIndex } from "@/search/workspaceIndex";
import { ASK_BUDGET, buildAskContext, type AskContextSource } from "./contextBuilder";
import { serializeContext } from "./selectionContext";

function source(elements: SceneElement[], selectedIds: string[], docs: DocumentRecord[], extra: Partial<AskContextSource> = {}): AskContextSource {
  return {
    workspaceId: "ws",
    canvasId: "cv",
    elements,
    selectedIds,
    getDocument: lookup(docs),
    listWorkspaceDocuments: () => docs,
    ...extra,
  };
}

/**
 * A canvas: the selected "Checkout" block; a note right next to it; a code
 * block far away but linked by a depends_on arrow; a far-away note that
 * shares distinctive terms with the selection; a far-away unrelated note; a
 * page on another canvas about refunds.
 */
function fixture() {
  const docs = [
    doc("d-sel", para("Checkout flow: card authorisation, then idempotency keys guard the capture."), { title: "Checkout" }),
    doc("d-api", [{ type: "codeBlock", props: { language: "ts" }, content: "export async function capture() {}" }]),
    pageDoc("p-refund", "Refund handling", para("Refunds reverse a capture after settlement."), { canvasId: "cv2" }),
    doc("d-other", para("Refund queue backlog is reviewed weekly."), { canvasId: "cv2" }),
  ];
  const elements = [
    block("sel", "d-sel", { x: 0, y: 0, width: 300, height: 200 }),
    note("near", "Remember the 3DS challenge", { x: 350, y: 0 }),
    block("api", "d-api", { x: 5_000, y: 5_000 }, "code"),
    arrow("a1", "sel", "api", "depends_on"),
    note("terms", "Idempotency keys expire after authorisation timeout", { x: 9_000, y: 0 }),
    note("far", "Team offsite agenda", { x: 20_000, y: 20_000 }),
  ];
  return { docs, elements };
}

describe("buildAskContext — preference order and labels", () => {
  it("selection first, then nearby, related (arrows before shared terms), each with why it was included", () => {
    const { docs, elements } = fixture();
    const ctx = buildAskContext(source(elements, ["sel"], docs), "selection");
    expect(ctx.items.map((i) => [i.id, i.reason])).toEqual([["sel", "selected"]]);
    expect(ctx.nearby.map((i) => [i.id, i.reason])).toEqual([
      ["near", "nearby"],
      ["api", "connected"],
      ["terms", "shared_terms"],
    ]);
    expect(ctx.nearby[1]!.why).toBe("linked to the selection: depends on");
    expect(ctx.nearby[2]!.why).toMatch(/^shares “(idempotency|authorisation)”/);
    expect(ctx.relations).toEqual([{ from: "sel", to: "api", type: "depends_on" }]);
    // Unrelated content never comes along in selection scope.
    expect([...ctx.items, ...ctx.nearby].map((i) => i.id)).not.toContain("far");
  });

  it("includes objects from the same content source when the caller knows them", () => {
    const { docs, elements } = fixture();
    const ctx = buildAskContext(source(elements, ["sel"], docs, { sameSourceAs: () => ["far"] }), "selection");
    expect(ctx.nearby.find((i) => i.id === "far")).toMatchObject({ reason: "same_source", why: "derived from the same content source as the selection" });
  });

  it("adds search hits for the question's terms after the selection's own neighbourhood", () => {
    const { docs, elements } = fixture();
    const ctx = buildAskContext(source(elements, ["sel"], docs, { question: "What does the offsite agenda say?" }), "selection");
    const reasons = ctx.nearby.map((i) => i.reason);
    expect(reasons.indexOf("search")).toBeGreaterThan(reasons.lastIndexOf("connected"));
    expect(ctx.nearby.find((i) => i.id === "far")).toMatchObject({ reason: "search", why: "matches the question: “offsite”, “agenda”" });
  });

  it("searches other canvases only in workspace scope", () => {
    const { docs, elements } = fixture();
    const q = { question: "How are refunds handled?" };
    const canvas = buildAskContext(source(elements, [], docs, q), "canvas");
    expect(canvas.items.some((i) => i.id === "p-refund")).toBe(false);
    const ws = buildAskContext(source(elements, [], docs, q), "workspace");
    const hit = ws.items.find((i) => i.id === "p-refund")!;
    expect(hit).toMatchObject({ reason: "search", onCanvas: false, kind: "page", title: "Refund handling" });
    // The search hit comes before the rest of the canvas.
    expect(ws.items.indexOf(hit)).toBeLessThan(ws.items.findIndex((i) => i.reason === "scope"));
  });

  it("with nothing selected, prefers what is in view (nearest the centre first), then fills the rest of the canvas", () => {
    const { docs, elements } = fixture();
    const ctx = buildAskContext(source(elements, [], docs, { viewport: { x: 8_000, y: -500, width: 2_000, height: 1_000 } }), "canvas");
    expect(ctx.items[0]).toMatchObject({ id: "terms", reason: "in_view", why: "in view" });
    expect(ctx.items.slice(1).every((i) => i.reason === "scope")).toBe(true);
    expect(ctx.items.map((i) => i.id).sort()).toEqual(["api", "far", "near", "sel", "terms"]);
  });

  it("uses a live index when given one, and resolves a previewed page to its canvas element", () => {
    const docs = [pageDoc("p1", "Launch plan", para("Launch checklist for the beta")), doc("d1", para("unrelated"))];
    const elements = [block("b1", "d1"), pagePreview("pv", "p1", { x: 9_000 })];
    const index = new WorkspaceIndex("ws");
    index.syncDocuments(docs);
    index.syncScene("cv", elements, lookup(docs));
    const ctx = buildAskContext(source(elements, ["b1"], docs, { index, question: "what is in the launch checklist" }), "selection");
    expect(ctx.nearby.map((i) => [i.id, i.reason, i.kind])).toEqual([["pv", "search", "page"]]);
  });

  it("is deterministic", () => {
    const { docs, elements } = fixture();
    const make = () => serializeContext(buildAskContext(source(elements, ["sel"], docs, { question: "refunds and idempotency" }), "workspace"));
    expect(make()).toBe(make());
  });
});

describe("buildAskContext — budget", () => {
  it("caps supporting objects harder than the selection and stops at the total, saying so", () => {
    const long = "x".repeat(10_000);
    const docs = [doc("d-sel", para(long)), ...Array.from({ length: 30 }, (_, i) => doc(`d${i}`, para(`${long} ${i}`)))];
    const elements = [block("sel", "d-sel"), ...Array.from({ length: 30 }, (_, i) => block(`b${i}`, `d${i}`, { x: 20 * i }))];
    const ctx = buildAskContext(source(elements, ["sel"], docs), "canvas");
    const [first, ...rest] = ctx.items;
    expect(first!.text.length).toBeLessThanOrEqual(ASK_BUDGET.perItem + 2);
    for (const i of rest) expect(i.text.length).toBeLessThanOrEqual(ASK_BUDGET.perSupporting + 2);
    const total = ctx.items.reduce((n, i) => n + i.text.replace(/\n…$/, "").length, 0);
    expect(total).toBeLessThanOrEqual(ASK_BUDGET.total);
    expect(ctx.truncated).toBe(true);
    expect(serializeContext(ctx)).toContain("Some content was left out");
  });

  it("caps the number of objects and of nearby objects", () => {
    const elements = Array.from({ length: 100 }, (_, i) => note(`n${i}`, `note ${i}`, { x: 10 * i }));
    const ctx = buildAskContext(source(elements, ["n0"], []), "canvas", { ...ASK_BUDGET, maxItems: 10 });
    expect(ctx.items).toHaveLength(10);
    expect(ctx.items.filter((i) => i.reason === "nearby")).toHaveLength(ASK_BUDGET.maxNearby);
    expect(ctx.truncated).toBe(true);
  });
});

describe("buildAskContext — serialization and secrets", () => {
  it("labels every section and object with why it is there", () => {
    const { docs, elements } = fixture();
    const text = serializeContext(buildAskContext(source(elements, ["sel"], docs, { question: "offsite agenda" }), "selection"));
    expect(text).toContain("## Selected objects");
    expect(text).toContain("## Nearby on the canvas");
    expect(text).toContain("(next to the selection)");
    expect(text).toContain("## Related to the selection");
    expect(text).toContain("(linked to the selection: depends on)");
    expect(text).toContain("## Found by searching for the question");
    expect(text).toContain("## Relationships");
  });

  it("never sends a credential pasted into a note, a title or an arrow label", () => {
    const key = "sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZ";
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUV123456";
    const docs = [doc("d1", para(`Use key ${key} for staging`), { title: `Token ${token}` })];
    const elements = [block("b1", "d1"), note("n1", `password = hunter2hunter2 nearby`, { x: 150 }), arrow("a", "b1", "n1")];
    const text = serializeContext(buildAskContext(source(elements, ["b1"], docs, { question: "staging key password" }), "workspace"));
    expect(text).not.toContain(key.slice(10));
    expect(text).not.toContain(token.slice(4));
    expect(text).not.toContain("hunter2hunter2");
    expect(text).toContain("[redacted]");
  });

  it("the context builder and index never import credential or connection modules", () => {
    for (const f of ["./contextBuilder.ts", "../../search/workspaceIndex.ts", "../../search/ranking.ts", "../../search/liveIndex.ts"]) {
      const code = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      expect(code, f).not.toMatch(/credentials|connections|aiSettings|providers\//);
    }
  });
});

describe("buildAskContext — coverage (what was and wasn't sent)", () => {
  it("reports everything fitting as nothing trimmed or left out", () => {
    const { docs, elements } = fixture();
    const ctx = buildAskContext(source(elements, ["sel"], docs), "selection");
    expect(ctx.coverage).toMatchObject({ budget: ASK_BUDGET.total, trimmed: [], omitted: [], omittedMore: 0 });
    expect(ctx.coverage!.chars).toBeGreaterThan(0);
  });

  it("names trimmed objects and the candidates left out once the budget is spent, in preference order", () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(`n${i}`, `Note ${i} ${"x".repeat(900)}`, { x: 0, y: i * 200 }));
    const ctx = buildAskContext(source(notes, [], []), "canvas", { ...ASK_BUDGET, total: 5_000, perSupporting: 1_500 });
    const included = ctx.items.map((i) => i.id);
    expect(included.length).toBeGreaterThan(0);
    const { coverage } = ctx;
    expect(coverage!.chars).toBe(5_000);
    expect(coverage!.trimmed.map((t) => t.id)).toEqual([included.at(-1)]);
    const left = [...coverage!.omitted.map((o) => o.id)];
    expect(left.length + coverage!.omittedMore).toBe(30 - included.length);
    expect(left.some((id) => included.includes(id))).toBe(false);
    expect(coverage!.omitted[0]!.label).toMatch(/^Note \d+ x+…$/);
  });

  it("names at most MAX_OMITTED_NOTES and counts the rest", () => {
    const notes = Array.from({ length: 80 }, (_, i) => note(`n${i}`, `Note ${i} ${"y".repeat(500)}`, { x: 0, y: i * 200 }));
    const ctx = buildAskContext(source(notes, [], []), "canvas", { ...ASK_BUDGET, total: 2_000 });
    expect(ctx.coverage!.omitted).toHaveLength(20);
    expect(ctx.coverage!.omitted.length + ctx.coverage!.omittedMore + ctx.items.length).toBe(80);
  });

  it("left-out labels are redacted like the content", () => {
    const secret = "sk-" + "a".repeat(40);
    const notes = [note("big", "z".repeat(3_000), { x: 0, y: 0 }), note("key", `token ${secret}`, { x: 0, y: 500 })];
    const ctx = buildAskContext(source(notes, [], []), "canvas", { ...ASK_BUDGET, total: 1_500, perSupporting: 1_500 });
    expect(ctx.coverage!.omitted.map((o) => o.id)).toContain("key");
    expect(JSON.stringify(ctx.coverage)).not.toContain(secret);
  });
});
