import { describe, expect, it } from "vitest";
import type { DocumentRecord } from "@/domain/types";
import { confirmMessage, orphanedPages } from "./pageDeletion";

const preview = (id: string, pageId: string, extra: { frameId?: string; isDeleted?: boolean } = {}) => ({
  id,
  type: "embeddable" as const,
  isDeleted: extra.isDeleted ?? false,
  frameId: extra.frameId ?? null,
  customData: { acute: { kind: "page-preview", pageId, preview: false } },
});
const shape = (id: string, type: "rectangle" | "frame" = "rectangle") => ({ id, type, isDeleted: false, frameId: null, customData: undefined });

const page = (id: string, title: string, canvasId = "c1"): DocumentRecord => ({
  id,
  workspaceId: "w",
  canvasId,
  kind: "page",
  title,
  snapshot: [],
  createdAt: 0,
  updatedAt: 0,
});
const records = new Map([
  ["p1", page("p1", "Plan")],
  ["p2", page("p2", "")],
  ["p3", page("p3", "Other canvas", "c2")],
]);
const get = (id: string) => records.get(id);

describe("orphanedPages", () => {
  it("returns pages whose only preview is being deleted", () => {
    const els = [preview("e1", "p1"), preview("e2", "p2"), shape("s")];
    expect(orphanedPages(els, { e1: true, s: true }, "c1", get).map((p) => p.id)).toEqual(["p1"]);
  });

  it("keeps a page that still has a preview elsewhere", () => {
    const els = [preview("e1", "p1"), preview("e2", "p1")];
    expect(orphanedPages(els, { e1: true }, "c1", get)).toEqual([]);
    expect(orphanedPages(els, { e1: true, e2: true }, "c1", get).map((p) => p.id)).toEqual(["p1"]);
  });

  it("counts previews inside a selected frame and ignores already-deleted ones", () => {
    const els = [shape("f", "frame"), preview("e1", "p1", { frameId: "f" }), preview("e2", "p1", { isDeleted: true })];
    expect(orphanedPages(els, { f: true }, "c1", get).map((p) => p.id)).toEqual(["p1"]);
  });

  it("never deletes pages of another canvas or unknown pages", () => {
    const els = [preview("e1", "p3"), preview("e2", "missing")];
    expect(orphanedPages(els, { e1: true, e2: true }, "c1", get)).toEqual([]);
  });
});

describe("confirmMessage", () => {
  it("names the pages", () => {
    expect(confirmMessage([records.get("p1")!])).toContain('the page "Plan"');
    expect(confirmMessage([records.get("p1")!, records.get("p2")!])).toContain('2 pages ("Plan", "Untitled")');
  });
});
