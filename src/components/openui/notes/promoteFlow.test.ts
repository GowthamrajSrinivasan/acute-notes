/**
 * Pin to canvas end to end, offline (`.ai/docs/openui-integration-plan.md` Phase 2): `promoteNote` → the shared commit
 * (`commitOnCanvas` → `ai/changes/commit.ts`, real) → one step in the real unified undo history (`CanvasHistory`).
 * Only the renderer edges are stubbed, as `afterCommit.test.ts` does: the scene writer, the live index, persistence,
 * the Markdown parser (BlockNote) and the camera/knowledge-store side effects.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { CanvasHistory } from "@/history/canvasHistory";

interface El {
  id: string;
  version: number;
  index: string;
  isDeleted: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

const w = vi.hoisted(() => ({
  scene: [] as El[],
  writes: [] as { set: ChangeSet; changes: ProposedChange[] }[],
  /** When false, the writer reports creating nothing (a write that produced no object). */
  creates: true,
  shown: [] as string[][],
  changed: [] as string[],
}));

vi.mock("@/components/blocks/editor/markdown", () => ({ markdownToContent: (md: string) => [{ type: "paragraph", content: md }] }));
vi.mock("@/components/canvas/changeSetWriter", () => ({
  changeSetCanvas: () => ({
    boxOf: (id: string) => w.scene.find((e) => e.id === id && !e.isDeleted),
    write: (set: ChangeSet, changes: readonly ProposedChange[]) => {
      w.writes.push({ set, changes: [...changes] });
      const created = new Map<string, string>();
      for (const c of changes) {
        if (c.kind !== "create_block") continue;
        const id = `el_${w.scene.length}`;
        w.scene = [...w.scene, { id, version: 1, index: `a${w.scene.length}`, isDeleted: false, ...c.box }];
        if (w.creates) created.set(c.key, id);
      }
      return created;
    },
  }),
}));
vi.mock("@/search/liveIndex", () => ({ syncCommitted: () => ({ state: "fresh", verifiedAt: 1 }), whenIndexFresh: () => Promise.resolve(true) }));
vi.mock("@/persistence", () => ({ getPersistence: () => ({ meta: { get: async () => undefined, set: async () => undefined } }) }));
vi.mock("@/state/documents", () => ({ getDocumentStore: () => ({ get: () => undefined }) }));
vi.mock("@/components/canvas/renderPlanContext", () => ({ gatherRenderContext: () => ({ existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } }) }));
vi.mock("@/components/review/knowledgeActions", () => ({ showObjects: (_api: unknown, ids: string[]) => void w.shown.push([...ids]) }));
vi.mock("@/components/review/knowledgeStore", () => ({ knowledgeUI: { changed: (canvasId: string) => void w.changed.push(canvasId) } }));

const { promoteNote } = await import("./promote");

function setup() {
  w.scene = [{ id: "mine", version: 1, index: "a", isDeleted: false, x: 0, y: 0, width: 10, height: 10 }];
  w.writes = [];
  w.creates = true;
  w.shown = [];
  w.changed = [];
  const history = new CanvasHistory<El>({
    getElements: () => w.scene,
    apply: (elements) => void (w.scene = elements),
    bump: (t, above) => ({ ...t, version: above + 1 }),
    markDeleted: (el) => ({ ...el, isDeleted: true }),
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  history.init(w.scene);
  history.connect();
  const api = { getSceneElements: () => w.scene } as never;
  const home = { workspaceId: "ws", canvasId: "cv" } as never;
  return { history, env: { api, home, history } };
}
const live = () => w.scene.filter((e) => !e.isDeleted).map((e) => e.id);
const note = { key: "g1", title: "Keys expire", body: "After 24h a retry is new.", detail: "Servers forget keys.", cites: ["u2", "u3"], source: { sourceId: "s1", version: 2 } };

describe("promoteNote (Pin to canvas)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes one card as one history step, returns its id, shows it and refreshes the knowledge store", async () => {
    const { history, env } = setup();
    const id = await promoteNote(env, note);
    expect(id).toBe("el_1");
    expect(live()).toEqual(["mine", "el_1"]);
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]!.changes.map((c) => c.kind)).toEqual(["create_block"]);
    expect(w.writes[0]!.set.passage).toEqual({ sourceId: "s1", version: 2 });
    expect(w.writes[0]!.set.knowledge?.cards).toEqual({ "openui § g1": { sourceUnits: ["u2", "u3"] } });
    expect(w.writes[0]!.set.metadata).toMatchObject({ createdBy: "ai", task: "generate_openui_notes", noteModel: "distil" });
    expect(history.canUndo).toBe(true);
    expect(w.shown).toEqual([["el_1"]]);
    expect(w.changed).toEqual(["cv"]);
  });

  it("one Undo removes the pinned card and nothing else; Redo brings it back", async () => {
    const { history, env } = setup();
    await promoteNote(env, note);
    expect(history.undo()).toBe(true);
    expect(live()).toEqual(["mine"]);
    expect(history.canUndo).toBe(false);
    expect(history.redo()).toBe(true);
    expect(live()).toEqual(["mine", "el_1"]);
  });

  it("pinning twice is two separate steps (a new operation each); Undo takes back only the latest", async () => {
    const { history, env } = setup();
    await promoteNote(env, note);
    await promoteNote(env, { ...note, key: "g2", title: "Second" });
    expect(new Set(w.writes.map((x) => x.set.operationId)).size).toBe(2);
    expect(live()).toEqual(["mine", "el_1", "el_2"]);
    history.undo();
    expect(live()).toEqual(["mine", "el_1"]);
    history.undo();
    expect(live()).toEqual(["mine"]);
  });

  it("a flagged card carries its review; an unsourced note is a plain card", async () => {
    const { env } = setup();
    const review = { reasons: ['"300 seconds" is not on any card citing it'] };
    await promoteNote(env, { ...note, review });
    expect(w.writes[0]!.set.knowledge?.cards["openui § g1"]).toEqual({ sourceUnits: ["u2", "u3"], review });
    await promoteNote(env, { key: "g9", title: "T", body: "B", cites: [] });
    expect(w.writes[1]!.set.passage).toBeUndefined();
    expect(w.writes[1]!.set.knowledge).toBeUndefined();
  });

  it("returns null and moves no camera when the writer created nothing", async () => {
    const { env } = setup();
    w.creates = false;
    expect(await promoteNote(env, note)).toBeNull();
    expect(w.shown).toEqual([]);
    expect(w.changed).toEqual(["cv"]);
  });
});
