/**
 * The Lens projection adapter on kn-08 (the full L0–L5 journey): a canvas drawn to the case's expected Lens goes
 * through the product's own `lensTree`, then the adapter, and must satisfy every Lens assertion of the case, the same
 * ones the hand-written reference projection satisfies. Planted faults (a missing drill link, missing code locations,
 * a reversed edge) must fail the assertions that guard them.
 */
import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { lensTree, singleScene } from "@/domain/lens/lensView";
import { evaluate, verdict } from "./evaluate";
import { sceneFromExpectedLens, type LensSceneOptions } from "./fixtures";
import { lensProjectionFromTrees, lensProjectionOfCanvas, sourceKey } from "./lensAdapter";
import { loadDataset } from "./load";
import { lensProjectionOfScene, sceneSourceOf } from "./recordedScene";
import { lensProjectionSchema } from "./schemas";

const kn08 = loadDataset().cases.find((c) => c.id.startsWith("kn-08"))!;
const lensAssertions = kn08.evaluation.assertions.filter((a) => a.target === "lens" && a.method === "deterministic" && a.support !== "future");

function project(options: LensSceneOptions = {}) {
  return lensProjectionOfScene(sceneFromExpectedLens(kn08.lens!, "kn08", options));
}

const statusOf = (projection: ReturnType<typeof project>) => new Map(evaluate(lensAssertions, kn08, { lens: projection }).map((r) => [r.id, r]));

describe("lens projection adapter: kn-08", () => {
  const projection = project();

  it("produces a valid projection", () => {
    expect(lensProjectionSchema.safeParse(projection).success).toBe(true);
  });

  it("passes every Lens assertion of the case, as the reference projection does", () => {
    expect(lensAssertions.length).toBeGreaterThan(30);
    const results = evaluate(lensAssertions, kn08, { lens: projection });
    expect(results.filter((r) => r.status !== "pass").map((r) => `${r.id}: ${r.detail}`)).toEqual([]);
    expect(verdict(results).pass).toBe(true);
  });

  it("projects the same nodes per level L0–L4 as the reference, and L5 as source cards", () => {
    const keysAt = (p: typeof projection, level: number) => p.levels.filter((l) => l.level === level).flatMap((l) => l.nodes.map((n) => n.key)).sort();
    for (const level of [0, 1, 2, 3, 4]) expect(keysAt(projection, level), `L${level}`).toEqual(keysAt(kn08.referenceLens!, level));
    // One source card per node with code: op.compose (compose.ts + citations.ts), the citation checker, vector search.
    expect(keysAt(projection, 5)).toEqual([sourceKey("services/orchestrator/src/citations.ts"), sourceKey("services/orchestrator/src/compose.ts", [40, 118]), sourceKey("services/orchestrator/src/citations.ts"), sourceKey("services/retrieval/src/search.ts")].sort());
    // Drills: the reference's, with the source level reached through the node that holds the code.
    const drills = projection.drills.map((d) => `${d.from}→${d.toFrameKey}`).sort();
    expect(drills).toEqual(
      [...kn08.referenceLens!.drills.filter((d) => !d.toFrameKey.startsWith("lens.l5")).map((d) => `${d.from}→${d.toFrameKey}`), "op.compose→source:op.compose", "orch.citation-checker→source:orch.citation-checker", "retr.vector-search→source:retr.vector-search"].sort(),
    );
  });

  it("a component keeps one identity across levels (the frame key and node keys come from Lens, not the labels)", () => {
    const orchestrator = projection.levels.flatMap((l) => l.nodes).filter((n) => n.key === "arch.orchestrator");
    expect(orchestrator).toHaveLength(1);
    expect(projection.levels.find((l) => l.level === 2 && l.nodes.some((n) => n.key === "orch.answer-composer"))?.frameKey).toBe("lens.l2-orchestrator");
  });

  it("a drill link the generation didn't set fails its drill and path checks", () => {
    const s = statusOf(project({ withoutDrill: ["arch.orchestrator"] }));
    expect(s.get("a.lens-drill-arch-orchestrator")?.status).toBe("fail");
    expect(s.get("a.lens-question-to-code")?.status).toBe("fail");
  });

  it("missing code locations leave no L5", () => {
    const s = statusOf(project({ withoutSources: ["op.compose"] }));
    expect(s.get("a.lens-node-src-compose")?.status).toBe("fail");
    expect(s.get("a.lens-drill-op-compose")?.status).toBe("fail");
  });

  it("a reversed edge is reported as reversed", () => {
    const s = statusOf(project({ reversed: ["r.orchestrator-gateway"] }));
    expect(s.get("a.lens-edge-orchestrator-gateway")).toMatchObject({ status: "fail", detail: expect.stringContaining("reversed") });
  });

  it("matches lensProjectionOfCanvas over the same scene", () => {
    const scene = sceneFromExpectedLens(kn08.lens!, "kn08");
    expect(lensProjectionOfCanvas(sceneSourceOf(scene), "kn08")).toEqual(projection);
  });
});

describe("lens projection adapter: tree shapes", () => {
  const frame = (id: string, level?: number) => ({ id, type: "frame", name: id, x: 0, y: 0, width: 400, height: 200, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid", customData: { acuteDiagram: { type: "architecture", interactive: true, ...(level !== undefined ? { level } : {}) } } }) as SceneElement;
  const shape = (id: string, frameId: string, acuteNode: Record<string, unknown>) => ({ id, type: "rectangle", frameId, x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid", customData: { acuteNode: acuteNode } }) as SceneElement;
  const label = (id: string, text: string) => ({ id: `${id}_t`, type: "text", text, containerId: id, x: 0, y: 0, width: 1, height: 1, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid" }) as SceneElement;

  it("projects a frame reached from two nodes once, with a drill from each, and stops at a loop", () => {
    const elements = [
      frame("top"),
      shape("a", "top", { kind: "backend", expandsTo: { frameKey: "detail" } }),
      label("a", "A"),
      shape("b", "top", { kind: "backend", expandsTo: { frameKey: "detail" } }),
      label("b", "B"),
      frame("detail"),
      shape("c", "detail", { kind: "backend", expandsTo: { frameKey: "top" } }),
      label("c", "C"),
    ];
    const tree = lensTree(singleScene("c1", elements), { canvasId: "c1", frameId: "top" })!;
    const p = lensProjectionFromTrees([tree]);
    expect(p.levels.map((l) => `${l.frameKey}@L${l.level}`)).toEqual(["top@L1", "detail@L2"]);
    expect(p.drills).toEqual([
      { from: "a", toFrameKey: "detail" },
      { from: "b", toFrameKey: "detail" },
      { from: "c", toFrameKey: "top" },
    ]);
  });
});
