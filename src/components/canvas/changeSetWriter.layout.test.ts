/**
 * Card layouts through the change-set writer (note-taking-modes plan Step 5): a created text card stores its layout
 * stamped with its content's hash; an update sets, removes or carries the layout to the new document (copy-on-write, so
 * undo — pointing the block back at the old document — restores the old layout with no extra step).
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
  newElementWith: (el: object, patch: object) => ({ ...el, ...patch }),
  // As the real one does for a new element: the fields a scene element always has.
  restoreElements: (els: object[]) => els.map((e) => ({ groupIds: [], boundElements: null, isDeleted: false, frameId: null, version: 1, versionNonce: 1, ...e })),
  convertToExcalidrawElements: (els: unknown[]) => els,
}));
const docs = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@/state/documents", () => ({
  getDocumentStore: () => ({
    get: (id: string) => docs.get(id) ?? null,
    put: async (rec: Record<string, unknown>) => void docs.set(rec.id as string, rec),
  }),
}));
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { cardContentHash, layoutFor, layoutStateOf } from "@/ai/openui/cardLayout";
import type { CardLayout, DocumentRecord, RichContent } from "@/domain/types";
import { changeSetCanvas } from "./changeSetWriter";

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const LANG = `root = IdeaCard("Retry policy", "Jobs retry 5 times.")`;
const NEXT_LANG = `root = IdeaCard("Retry policy", "Jobs retry 3 times.")`;

function run(elements: Record<string, unknown>[], change: ProposedChange) {
  let scene = elements;
  const api = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    updateScene: (u: { elements: Record<string, unknown>[] }) => {
      scene = u.elements;
    },
  };
  const set = { operationId: "op", title: "t", metadata: { createdBy: "mcp" }, changes: [change] } as unknown as ChangeSet;
  changeSetCanvas(api as never, { workspaceId: "w", canvasId: "c" } as never).write(set, [change]);
  return scene;
}
const docOf = (scene: Record<string, unknown>[], id?: string) => {
  const el = id ? scene.find((e) => e.id === id) : scene[scene.length - 1];
  const documentId = ((el!.customData as { acute: { documentId: string } }).acute).documentId;
  return docs.get(documentId) as unknown as DocumentRecord;
};

function existingCard(content: RichContent, layout?: CardLayout) {
  docs.set("doc_old", { id: "doc_old", workspaceId: "w", canvasId: "c", kind: "block", title: "Untitled", snapshot: content, createdAt: 1, updatedAt: 1, ...(layout ? { layout } : {}) });
  return {
    id: "card",
    type: "embeddable",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    isDeleted: false,
    boundElements: null,
    groupIds: [],
    frameId: null,
    link: "acute://block/doc_old",
    customData: { acute: { kind: "rich-block", blockType: "text", documentId: "doc_old" } },
    version: 1,
    versionNonce: 1,
  };
}

describe("card layouts in the writer", () => {
  it("a created text card stores its layout, current for exactly the content written", () => {
    docs.clear();
    const content = [p("Retry policy"), p("Jobs retry 5 times.")];
    const scene = run([], { kind: "create_block", key: "k", blockType: "text", content, box: { x: 0, y: 0, width: 300, height: 220 }, layout: { lang: LANG } });
    const rec = docOf(scene);
    expect(rec.layout).toMatchObject({ format: "openui-lang", version: 1, lang: LANG, contentHash: cardContentHash({ title: "Untitled", snapshot: content }) });
    expect(layoutStateOf(rec)).toBe("current");
    expect(scene[0]!.height).toBe(220);
  });

  it("a layout on a non-text block is ignored", () => {
    docs.clear();
    const scene = run([], { kind: "create_block", key: "k", blockType: "code", content: [p("x")], box: { x: 0, y: 0, width: 300, height: 200 }, layout: { lang: LANG } });
    expect(docOf(scene).layout).toBeUndefined();
  });

  it("an update with a new layout stamps it for the new content; the old document keeps its own (undo restores it)", () => {
    docs.clear();
    const old = [p("Retry policy"), p("Jobs retry 5 times.")];
    const oldLayout = layoutFor({ title: "Untitled", snapshot: old }, LANG);
    const next = [p("Retry policy"), p("Jobs retry 3 times.")];
    const scene = run([existingCard(old, oldLayout)], { kind: "update_block", target: "card", content: next, layout: { lang: NEXT_LANG } });
    const rec = docOf(scene, "card");
    expect(rec.id).not.toBe("doc_old");
    expect(rec.layout?.lang).toBe(NEXT_LANG);
    expect(layoutStateOf(rec)).toBe("current");
    expect((docs.get("doc_old") as unknown as DocumentRecord).layout).toEqual(oldLayout);
  });

  it("an update without a layout carries the old one over: stale once the text differs, still current when it doesn't", () => {
    docs.clear();
    const old = [p("Retry policy"), p("Jobs retry 5 times.")];
    const oldLayout = layoutFor({ title: "Untitled", snapshot: old }, LANG);
    const changed = docOf(run([existingCard(old, oldLayout)], { kind: "update_block", target: "card", content: [p("Retry policy"), p("Jobs retry 3 times.")] }), "card");
    expect(changed.layout).toEqual(oldLayout);
    expect(layoutStateOf(changed)).toBe("stale");

    const same = docOf(run([existingCard(old, oldLayout)], { kind: "update_block", target: "card", content: old }), "card");
    expect(layoutStateOf(same)).toBe("current");
  });

  it("layout: null removes it (the text is written as given)", () => {
    docs.clear();
    const old = [p("Retry policy"), p("Jobs retry 5 times.")];
    const rec = docOf(run([existingCard(old, layoutFor({ title: "Untitled", snapshot: old }, LANG))], { kind: "update_block", target: "card", content: old, layout: null }), "card");
    expect(rec.layout).toBeUndefined();
    expect(rec.snapshot).toEqual(old);
  });
});
