import { describe, expect, it } from "vitest";
import { McpSearchIndex } from "@/mcp/tools/search";
import type { WorkspaceScan } from "@/mcp/resources/workspaceScan";
import { questionTerms } from "./ranking";
import { arrow, block, doc, label, lookup, note, pageDoc, pagePreview, para, shape } from "./testFixtures";
import { inferBlockKind, INDEX_LIMITS, WorkspaceIndex } from "./workspaceIndex";

const code = (text: string) => [{ type: "codeBlock" as const, props: { language: "ts" }, content: text }];
const todo = (...items: string[]) => items.map((t) => ({ type: "checkListItem" as const, props: { checked: false }, content: t }));

function sample() {
  const docs = [
    doc("d-retry", para("The payment retry loop backs off exponentially."), { title: "Retry policy" }),
    doc("d-code", code("function retryPayment() { return backoff(); }")),
    doc("d-todo", todo("Write payment tests", "Ship checkout")),
    pageDoc("p-pay", "Payments overview", para("How payment and checkout fit together."), { updatedAt: 5 }),
    pageDoc("p-old", "Old notes", para("payment payment"), { updatedAt: 1 }),
  ];
  const elements = [
    block("b-retry", "d-retry", { version: 1 } as never),
    block("b-code", "d-code", {}, "code"),
    block("b-todo", "d-todo", {}, "todo"),
    shape("s1"),
    label("s1-label", "s1", "Checkout service"),
    note("n1", "retry budget is 3 attempts"),
    pagePreview("pv", "p-pay"),
    arrow("a1", "s1", "b-retry", "depends_on"),
    arrow("a2", "n1", "b-code"),
  ];
  const index = new WorkspaceIndex("ws");
  index.syncDocuments(docs);
  index.syncScene("cv", elements, lookup(docs));
  return { index, docs, elements };
}

describe("WorkspaceIndex — coverage and references", () => {
  it("indexes pages, blocks by type, shape labels, free text and typed relations, with stable references", () => {
    const { index } = sample();
    expect(index.get("b-code")).toMatchObject({ kind: "code", ref: { workspaceId: "ws", canvasId: "cv", elementId: "b-code", documentId: "d-code", blockId: "d-code" } });
    expect(index.get("b-todo")?.kind).toBe("todo");
    expect(index.get("s1")).toMatchObject({ kind: "rectangle", text: "Checkout service" });
    expect(index.get("n1")?.kind).toBe("note");
    expect(index.get("p-pay")).toMatchObject({ kind: "page", title: "Payments overview", ref: { pageId: "p-pay" }, updatedAt: 5 });
    expect(index.get("a1")).toMatchObject({ kind: "relation", text: "depends on" });
    // A plain arrow is a relationship edge, not a searchable object.
    expect(index.get("a2")).toBeUndefined();
    expect(index.relations("cv").map((r) => [r.from, r.to, r.type])).toEqual([
      ["s1", "b-retry", "depends_on"],
      ["n1", "b-code", undefined],
    ]);
  });

  it("finds a block on the canvas once — as its element, not also as its document", () => {
    const { index } = sample();
    const ids = index.query({ text: "retry", limit: 50 }).hits.map((h) => h.id);
    expect(ids).toContain("b-retry");
    expect(ids).not.toContain("d-retry");
  });

  it("returns a page previewed on the canvas with the preview's element reference", () => {
    const { index } = sample();
    const hit = index.query({ text: "checkout", canvasId: "cv" }).hits.find((h) => h.id === "p-pay")!;
    expect(hit.ref).toMatchObject({ pageId: "p-pay", elementId: "pv", canvasId: "cv" });
  });

  it("relations are searched only when asked for", () => {
    const { index } = sample();
    expect(index.query({ text: "depends" }).hits).toEqual([]);
    expect(index.query({ text: "depends", kinds: ["relation"] }).hits.map((h) => h.id)).toEqual(["a1"]);
  });

  it("infers the block type of blocks with no canvas element", () => {
    expect(inferBlockKind(todo("a", "b"))).toBe("todo");
    expect(inferBlockKind(code("x"))).toBe("code");
    expect(inferBlockKind(para("x"))).toBe("text");
  });
});

describe("WorkspaceIndex — ranking and determinism", () => {
  it("`all` mode needs every word and ranks title/phrase first; ties keep a stable order", () => {
    const { index } = sample();
    const res = index.query({ text: "payment retry" });
    expect(res.hits.map((h) => h.id)).toEqual(["b-retry", "b-code"]);
    expect(res.hits[0]!.snippet).toContain("payment retry");
    expect(res.hits[0]!.matchedTerms).toEqual(["payment", "retry"]);
  });

  it("`any` mode ranks objects matching more distinct terms first, rare terms above common ones", () => {
    const { index } = sample();
    const res = index.query({ text: "What is the retry budget for checkout?", mode: "any", limit: 50 });
    expect(res.words).toEqual(["retry", "budget", "checkout"]);
    // The note matches two terms; then single-term matches, "budget"/"checkout" (rarer) before "retry" (common).
    expect(res.hits[0]!.id).toBe("n1");
    expect(res.hits[0]!.matchedTerms).toEqual(["retry", "budget"]);
    for (let i = 1; i < res.hits.length; i++) expect(res.hits[i - 1]!.matchedTerms.length).toBeGreaterThanOrEqual(res.hits[i]!.matchedTerms.length);
    // Rarity: with "retry" in many objects and "ledger" in one, the "ledger" object outranks every "retry" one.
    const rare = new WorkspaceIndex("ws");
    rare.syncDocuments([
      ...Array.from({ length: 6 }, (_, i) => doc(`r${i}`, para("retry retry retry"), { canvasId: "o" })),
      doc("ledger", para("the ledger"), { canvasId: "o" }),
    ]);
    expect(rare.query({ text: "retry ledger", mode: "any" }).hits[0]!.id).toBe("ledger");
    // minMatched narrows to multi-term matches.
    expect(index.query({ text: "retry budget checkout", mode: "any", minMatched: 2 }).hits.map((h) => h.id)).toEqual(["n1"]);
  });

  it("gives identical results whatever order objects were indexed in", () => {
    const a = sample();
    const b = new WorkspaceIndex("ws");
    // Documents first this time, in reverse; the scene in two passes (half, then all).
    b.syncDocuments([...a.docs].reverse());
    b.syncScene("cv", a.elements.slice(0, 4), lookup(a.docs));
    b.syncScene("cv", a.elements, lookup(a.docs));
    for (const text of ["payment", "retry", "checkout payment", "payment retry"]) {
      for (const mode of ["all", "any"] as const) {
        expect(b.query({ text, mode }).hits, `${mode}:${text}`).toEqual(a.index.query({ text, mode }).hits);
      }
    }
  });

  it("is what MCP search_workspace serves: the same hits for the same persisted workspace", async () => {
    const { index, docs, elements } = sample();
    const canvases = [{ id: "cv", title: "Payments board" }];
    index.setCanvases(canvases);
    const get = lookup(docs);
    const scan = {
      workspaceId: "ws",
      pages: async () => docs.filter((d) => d.kind === "page"),
      canvases: async () => canvases,
      scene: async () => elements,
      documents: async (ids: Iterable<string>) => new Map([...ids].flatMap((id) => (get(id) ? [[id, get(id)!] as const] : []))),
    } as unknown as WorkspaceScan;
    const mcp = new McpSearchIndex(scan);
    for (const q of ["payment", "retry", "checkout", "payment retry", "PAYMENT checkout", "retry budget", "board", "nothing-here"]) {
      const served = await mcp.search(q, { limit: 50 });
      const ours = index.query({ text: q, limit: 50 });
      const view = (h: { id: string; kind: string; title?: string; score: number; matches: number; snippet?: string }) => [h.id, h.kind, h.title, h.score, h.matches, h.snippet];
      expect(served.hits.map(view), q).toEqual(ours.hits.map(view));
      expect(served.total, q).toBe(ours.total);
    }
  });

  it("bounds results and the text that is searched", () => {
    const index = new WorkspaceIndex("ws");
    index.syncDocuments(Array.from({ length: 80 }, (_, i) => doc(`d${i}`, para("retry"), { canvasId: `other${i}` })));
    const res = index.query({ text: "retry", limit: 500 });
    expect(res.hits).toHaveLength(INDEX_LIMITS.maxResults);
    expect(res.truncated).toBe(true);
    const late = new WorkspaceIndex("ws");
    late.syncDocuments([doc("late", para(`${"x".repeat(INDEX_LIMITS.textChars)} retry`), { canvasId: "o" })]);
    expect(late.query({ text: "retry" }).total).toBe(0);
  });

  it("filters by canvas, kind and exclusions", () => {
    const { index } = sample();
    index.syncDocuments([...sample().docs, doc("elsewhere", para("payment elsewhere"), { canvasId: "cv2" })]);
    expect(index.query({ text: "payment", limit: 50 }).hits.map((h) => h.id)).toContain("elsewhere");
    expect(index.query({ text: "payment", canvasId: "cv", limit: 50 }).hits.map((h) => h.id)).not.toContain("elsewhere");
    expect(index.query({ text: "payment", kinds: ["code"] }).hits.map((h) => h.id)).toEqual(["b-code"]);
    expect(index.query({ text: "payment", exclude: new Set(["d-retry"]), limit: 50 }).hits.map((h) => h.id)).not.toContain("b-retry");
  });
});

describe("WorkspaceIndex — incremental updates", () => {
  it("re-indexes only what changed, and removes what was deleted", () => {
    const { index, docs, elements } = sample();
    expect(index.syncScene("cv", elements, lookup(docs))).toBe(0);

    // One element's version bumps: one unit of work.
    const edited = elements.map((e) => (e.id === "n1" ? { ...e, text: "retry budget is 5", originalText: "retry budget is 5", version: 2 } : e)) as typeof elements;
    expect(index.syncScene("cv", edited, lookup(docs))).toBe(1);
    expect(index.get("n1")?.text).toBe("retry budget is 5");

    // A document edit (new record object) re-stamps its element.
    const newer = docs.map((d) => (d.id === "d-code" ? { ...d, snapshot: code("function chargeCard() {}"), updatedAt: 9 } : d));
    expect(index.syncScene("cv", edited, lookup(newer))).toBe(1);
    expect(index.query({ text: "chargecard" }).hits.map((h) => h.id)).toEqual(["b-code"]);
    expect(index.query({ text: "retrypayment" }).hits).toEqual([]);

    // Deleted and removed elements leave the index; the vocabulary forgets their words.
    const removed = edited.filter((e) => e.id !== "s1" && e.id !== "s1-label").map((e) => (e.id === "n1" ? { ...e, isDeleted: true } : e));
    index.syncScene("cv", removed, lookup(newer));
    expect(index.get("s1")).toBeUndefined();
    expect(index.get("n1")).toBeUndefined();
    expect(index.frequency("service")).toBe(0);
  });

  it("drops documents that are gone and pages whose title changed are re-indexed", () => {
    const { index, docs } = sample();
    const renamed = docs.filter((d) => d.id !== "p-old").map((d) => (d.id === "p-pay" ? { ...d, title: "Billing overview" } : d));
    expect(index.syncDocuments(renamed)).toBe(1);
    expect(index.get("p-old")).toBeUndefined();
    expect(index.query({ text: "billing" }).hits.map((h) => h.id)).toEqual(["p-pay"]);
  });

  it("forgets a closed canvas's scene; its blocks remain findable as documents", () => {
    const { index } = sample();
    index.removeScene("cv");
    expect(index.get("b-retry")).toBeUndefined();
    expect(index.query({ text: "exponentially" }).hits.map((h) => h.id)).toEqual(["d-retry"]);
  });
});

describe("WorkspaceIndex — secrets", () => {
  it("never indexes or returns a pasted credential", () => {
    const secret = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";
    const docs = [doc("d1", para(`Deploy notes: ANTHROPIC key ${secret} and token ghp_abcdefghijklmnop1234`))];
    const index = new WorkspaceIndex("ws");
    index.syncScene("cv", [block("b1", "d1")], lookup(docs));
    expect(index.get("b1")!.text).not.toContain(secret);
    expect(index.get("b1")!.text).toContain("[redacted]");
    expect(index.query({ text: "abcdefghijklmnopqrstuvwxyz0123" }).hits).toEqual([]);
    const hit = index.query({ text: "deploy notes" }).hits[0]!;
    expect(JSON.stringify(hit)).not.toMatch(/sk-ant-api03-a|ghp_a/);
  });
});

describe("questionTerms", () => {
  it("keeps distinctive words of a question, drops stop words and short words, keeps capitalised acronyms", () => {
    expect(questionTerms("What does the Checkout API do when a payment fails?")).toEqual(["checkout", "api", "payment", "fails"]);
    expect(questionTerms("How is the UI tested?")).toEqual(["ui", "tested"]);
  });
});

describe("WorkspaceIndex — diagram and project node fields (C6)", () => {
  it("finds a decision by a word in its reason, a question by its answer, and a node by its sublabel or details", () => {
    const elements = [
      shape("dec", { customData: { acuteNode: { kind: "decision", status: "accepted", reason: "Webhooks must be idempotent" } } }),
      label("dec-label", "dec", "Dedup store"),
      shape("q", { customData: { acuteNode: { kind: "open_question", status: "answered", answer: "Rotate tokens monthly" } } }),
      label("q-label", "q", "Token rotation?"),
      shape("svc", { customData: { acuteNode: { kind: "backend", sublabel: "ledger.service.ts", details: ["Reconciles payouts"] } } }),
      label("svc-label", "svc", "Ledger"),
    ];
    const index = new WorkspaceIndex("ws");
    index.syncScene("cv", elements, lookup([]));
    const ids = (text: string) => index.query({ text, limit: 10 }).hits.map((h) => h.id);
    expect(ids("idempotent")).toEqual(["dec"]);
    expect(ids("monthly")).toEqual(["q"]);
    expect(ids("ledger.service.ts")).toContain("svc");
    expect(ids("payouts")).toEqual(["svc"]);
  });
});
