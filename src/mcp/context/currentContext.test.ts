import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { OperationLog } from "@/ai/changes/operations";
import { buildCurrentContext, CONTEXT_LIMITS, CURRENT_CONTEXT_URI, type CurrentContextInput } from "./currentContext";

const el = (id: string, type: string, x: number, y: number, extra: Partial<SceneElement> = {}): SceneElement => ({
  id,
  type,
  x,
  y,
  width: 100,
  height: 60,
  angle: 0,
  locked: false,
  opacity: 100,
  isDeleted: false,
  groupIds: [],
  strokeColor: "#000",
  backgroundColor: "transparent",
  strokeWidth: 1,
  strokeStyle: "solid",
  ...extra,
});

const block = (id: string, documentId: string, x: number, y: number, blockType = "text") =>
  el(id, "embeddable", x, y, { customData: { acute: { kind: "rich-block", blockType, documentId, style: {} } } });
const label = (id: string, containerId: string, text: string) => el(id, "text", 0, 0, { containerId, text, originalText: text });
const arrow = (id: string, from: string, to: string, extra: Partial<SceneElement> = {}) =>
  el(id, "arrow", 0, 0, { startBinding: { elementId: from }, endBinding: { elementId: to }, ...extra });

const content = (text: string): RichContent => [{ type: "paragraph", content: text }];
const doc = (id: string, text: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  workspaceId: "ws",
  kind: "block",
  title: "Untitled",
  snapshot: content(text),
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

function input(overrides: Partial<CurrentContextInput> = {}): CurrentContextInput {
  const docs = new Map<string, DocumentRecord>([
    ["d_sel", doc("d_sel", "Checkout retries fail 4% of the time.", { metadata: { ai: { createdBy: "ai", operationId: "op_1", task: "summarize", apiKey: "sk-secret" } as never } })],
    ["d_near", doc("d_near", "Nearby note")],
    ["d_far", doc("d_far", "Far away note")],
    ["d_todo", doc("d_todo", "Ship it")],
    ["page_1", doc("page_1", "Page body", { kind: "page", title: "Design doc" })],
    ["page_other", doc("page_other", "Other workspace page", { kind: "page", workspaceId: "ws_other", title: "Private" })],
  ]);
  return {
    workspace: { id: "ws", name: "My workspace" },
    canvas: { id: "cv", title: "Payments" },
    elements: [
      block("sel", "d_sel", 0, 0),
      block("near", "d_near", 300, 0),
      block("far", "d_far", 5000, 5000),
      block("todo", "d_todo", 5000, 0, "todo"),
      el("shape", "rectangle", 0, 300, { customData: { acuteMeta: { ai: { createdBy: "mcp" } }, token: "ghp_secret" } }),
      label("shape-label", "shape", "Gateway"),
      arrow("a1", "sel", "todo", { customData: { acuteRelation: "depends_on" } }),
      label("a1-label", "a1", "needs"),
      arrow("a2", "far", "todo"),
    ],
    selectedIds: ["sel"],
    viewport: { x: -100, y: -100, width: 800, height: 600 },
    openPageId: "page_1",
    getDocument: (id) => docs.get(id),
    recentChanges: ["Summary: 1 block"],
    now: 1,
    ...overrides,
  };
}

describe("buildCurrentContext", () => {
  it("describes the selection first, then connected objects, then the closest ones", () => {
    const ctx = buildCurrentContext(input());
    expect(ctx.uri).toBe(CURRENT_CONTEXT_URI);
    expect(ctx.workspace).toEqual({ id: "ws", name: "My workspace" });
    expect(ctx.canvas).toEqual({ id: "cv", title: "Payments" });
    expect(ctx.selection).toEqual([
      {
        id: "sel",
        kind: "text",
        excerpt: "Checkout retries fail 4% of the time.",
        bounds: { x: 0, y: 0, width: 100, height: 60 },
        provenance: { createdBy: "ai", operationId: "op_1", task: "summarize" },
      },
    ]);
    // Connected (even when far away) before merely close; far unconnected objects left out.
    expect(ctx.nearby.map((o) => o.id)).toEqual(["todo", "near", "shape"]);
    expect(ctx.nearby.find((o) => o.id === "todo")?.uri).toBe("acute://todo/todo");
    expect(ctx.nearby.find((o) => o.id === "shape")).toMatchObject({ kind: "rectangle", excerpt: "Gateway", provenance: { createdBy: "mcp" } });
    expect(ctx.relations).toEqual([{ from: "sel", to: "todo", arrowId: "a1", type: "depends_on", label: "needs" }]);
    expect(ctx.openPage).toEqual({ id: "page_1", title: "Design doc", excerpt: "Page body", uri: "acute://page/page_1" });
    expect(ctx.recentChanges).toEqual(["Summary: 1 block"]);
    expect(ctx.availableTools).toEqual([]);
    expect(ctx.truncated).toBe(false);
  });

  it("with nothing selected, describes what is in view, closest to the centre first", () => {
    const ctx = buildCurrentContext(input({ selectedIds: [] }));
    expect(ctx.selection).toEqual([]);
    expect(ctx.nearby.map((o) => o.id)).toEqual(["near", "shape", "sel"]);
  });

  it("never exposes secrets, element customData, or other workspaces' content", () => {
    const json = JSON.stringify(buildCurrentContext(input({ openPageId: "page_other" })));
    expect(json).not.toMatch(/sk-secret|ghp_secret|apiKey|token|customData|acuteMeta/);
    expect(json).not.toContain("Private");
    expect(json).not.toContain("Far away note");
  });

  it("is bounded: capped lists and excerpts, and says when it cut something", () => {
    const many = Array.from({ length: 40 }, (_, i) => el(`r${i}`, "rectangle", i * 10, 0));
    const long = "x".repeat(5000);
    const ctx = buildCurrentContext(
      input({
        elements: [...many, block("big", "d_big", 0, 0)],
        selectedIds: [...many.map((e) => e.id), "big"],
        getDocument: (id) => (id === "d_big" ? doc("d_big", long) : undefined),
        recentChanges: Array.from({ length: 9 }, (_, i) => `op ${i}`),
      }),
    );
    expect(ctx.selection).toHaveLength(CONTEXT_LIMITS.selected);
    expect(ctx.recentChanges).toHaveLength(CONTEXT_LIMITS.recentChanges);
    expect(ctx.truncated).toBe(true);
    const bigOnly = buildCurrentContext(input({ elements: [block("big", "d_big", 0, 0)], selectedIds: ["big"], getDocument: () => doc("d_big", long) }));
    expect(bigOnly.selection[0]!.excerpt!.length).toBe(CONTEXT_LIMITS.excerpt);
    expect(bigOnly.truncated).toBe(true);
  });

  it("treats a selected label as its container and ignores deleted objects", () => {
    const ctx = buildCurrentContext(
      input({ selectedIds: ["shape-label", "gone"], elements: [...input().elements, el("gone", "rectangle", 0, 0, { isDeleted: true })] }),
    );
    expect(ctx.selection).toEqual([]);
  });
});

describe("OperationLog", () => {
  it("keeps the latest acceptance per operation, newest first, per canvas", () => {
    const log = new OperationLog();
    log.record({ operationId: "op_1", canvasId: "cv", description: "A", stepId: 1, acceptedAt: 1 });
    log.record({ operationId: "op_2", canvasId: "cv", description: "B", stepId: 2, acceptedAt: 2 });
    log.record({ operationId: "op_1", canvasId: "cv", description: "A again", stepId: 3, acceptedAt: 3 });
    log.record({ operationId: "op_9", canvasId: "other", description: "C", stepId: 4, acceptedAt: 4 });
    expect(log.find("cv", "op_1")?.stepId).toBe(3);
    expect(log.recent("cv", 5).map((o) => o.description)).toEqual(["A again", "B", "A"]);
    expect(log.find("other", "op_1")).toBeUndefined();
  });
});
