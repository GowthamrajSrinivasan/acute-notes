/**
 * "Visualize better" and "Split locally" refuse a pinned note or an added passage card (promotion contract P0, N4 / Q12):
 * split pieces would carry a link to a node no plan has, and the next update would propose removing them. Offline: the
 * scene is a plain array, the document store a map, and nothing reaches a model or the review queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ scene: [] as Record<string, unknown>[], docs: new Map<string, Record<string, unknown>>(), proposed: [] as unknown[], ran: 0 }));
vi.mock("@/state/documents", () => ({ getDocumentStore: () => ({ get: (id: string) => s.docs.get(id) }) }));
vi.mock("@/ai/changes/pendingChanges", () => ({ getPendingChanges: () => ({ propose: (_c: string, set: unknown) => void s.proposed.push(set) }) }));
vi.mock("@/components/canvas/renderPlanContext", () => ({ gatherRenderContext: () => ({ existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } }) }));
vi.mock("@/ai/runtime", () => ({
  AIRuntime: {
    run: async () => {
      s.ran++;
      throw new Error("no model in this test");
    },
  },
}));

const { OWN_CARD_NOT_SPLIT, proposeSplitLocally, proposeVisualizeBetter } = await import("./visualizeBetterAction");
const { NothingToSplitError } = await import("@/ai/density/visualizeBetter");
const { promotionKey } = await import("@/ai/reconcile/tracking");

const api = { getSceneElements: () => s.scene } as never;
const TABLE = [
  {
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: ["Name", "Value"] }, { cells: ["Retries", "5"] }, { cells: ["Timeout", "10s"] }, { cells: ["Owner", "Payments"] }],
    },
  },
];

function block(id: string, stableNodeKey: string): void {
  const documentId = `doc_${id}`;
  s.docs.set(documentId, {
    id: documentId,
    kind: "block",
    title: "Limits",
    snapshot: TABLE,
    metadata: { ai: { createdBy: "ai", contentSourceId: "src_1", contentSourceVersion: 2, stableNodeKey, contentFingerprint: "f1", excludeFromReconciliation: true } },
  });
  s.scene.push({ id, type: "embeddable", isDeleted: false, x: 0, y: 0, width: 300, height: 200, customData: { acute: { kind: "rich-block", blockType: "table", documentId } } });
}

beforeEach(() => {
  s.scene = [];
  s.docs = new Map();
  s.proposed = [];
  s.ran = 0;
});

describe("a pinned or passage card is never split (N4, Q12)", () => {
  it.each([
    ["a legacy pin", "openui § g1"],
    ["a pin since P0", promotionKey("gen_run1", "g1")],
    ["an added passage", "passage § u3"],
  ])("%s: both actions refuse with a message, no model call, nothing proposed", async (_name, key) => {
    block("c", key);
    const refused = (p: Promise<unknown>) => expect(p).rejects.toSatisfy((e) => e instanceof NothingToSplitError && (e as Error).message === OWN_CARD_NOT_SPLIT);
    await refused(proposeSplitLocally(api, "cv", "c"));
    await refused(proposeVisualizeBetter(api, "cv", "c", "a long table", new AbortController().signal));
    expect(s.ran).toBe(0);
    expect(s.proposed).toEqual([]);
  });
});
