/**
 * Test fixtures built from a case's own files (never recorded model output): a canvas drawn from an expected Lens
 * (`lens.json`), and a run output whose units and citations are what a faithful run would carry. Used by the adapter
 * and replay tests; nothing here is a recording, and nothing is written to `recordings/`.
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import { LENS_MAX_LEVEL } from "@/domain/canvas/diagram";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { planCandidates } from "./evaluate";
import type { CaseBundle } from "./load";
import type { RecordedScene } from "./recordedScene";
import type { RunEvidence } from "./runOutput";
import type { ExpectedLens } from "./schemas";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return { x: 0, y: 0, width: 160, height: 60, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", ...partial };
}

export interface LensSceneOptions {
  /** Node keys whose drill link (`expandsTo`) is left out, as a generation that didn't set it would. */
  withoutDrill?: readonly string[];
  /** Node keys whose code locations are left out. */
  withoutSources?: readonly string[];
  /** Lens edge ids drawn the wrong way round. */
  reversed?: readonly string[];
}

/**
 * A canvas the way Acute holds an architecture drawn to the expected Lens: one interactive frame per level (lens key
 * and level set), one kinded shape per node (`acuteNode.key`, `expandsTo`, `sources`), one typed, labelled arrow per
 * edge. The source level isn't drawn: Lens shows a node's code locations there, so the L5 nodes' locations become
 * their parent's `sources`, as a user or an IDE agent would attach them.
 */
export function sceneFromExpectedLens(lens: ExpectedLens, canvasId = "golden", options: LensSceneOptions = {}): RecordedScene {
  const sourceLevel = LENS_MAX_LEVEL;
  const sourceFrames = new Set(lens.levels.filter((l) => l.level === sourceLevel).map((l) => l.frameKey));
  const node = new Map(lens.nodes.map((n) => [n.key, n]));
  const sources = new Map<string, { path: string; lines?: [number, number] }[]>();
  const addSources = (key: string, ev: ExpectedLens["nodes"][number]["evidence"]) => {
    if (options.withoutSources?.includes(key)) return;
    for (const e of ev) {
      if (e.type !== "code" || !e.path || e.availability !== "available") continue;
      const have = sources.get(key) ?? [];
      if (!have.some((x) => x.path === e.path && x.lines?.join() === e.lines?.join())) sources.set(key, [...have, { path: e.path, ...(e.lines ? { lines: e.lines } : {}) }]);
    }
  };
  for (const n of lens.nodes) {
    if (n.level === sourceLevel) {
      if (n.parent) addSources(n.parent, n.evidence);
    } else addSources(n.key, n.evidence);
  }
  const elements: SceneElement[] = [];
  let y = 0;
  for (const level of lens.levels) {
    if (level.level === sourceLevel || !level.nodes.length) continue;
    const frameId = `frame:${level.frameKey}`;
    elements.push({ ...el({ id: frameId, type: "frame", x: 0, y, width: 2000, height: 300, customData: { acuteDiagram: { type: "architecture", interactive: true, level: level.level, lensKey: level.frameKey } } }), name: level.title } as SceneElement);
    level.nodes.forEach((key, i) => {
      const n = node.get(key)!;
      const drill = n.expandsTo && !sourceFrames.has(n.expandsTo) && !options.withoutDrill?.includes(key) ? { expandsTo: { frameKey: n.expandsTo } } : {};
      const src = sources.get(key);
      elements.push(el({ id: `node:${key}`, type: "rectangle", frameId, x: 20 + i * 200, y: y + 40, customData: { acuteNode: { kind: n.kind, key, ...drill, ...(src ? { sources: src } : {}) } } }));
      elements.push(el({ id: `label:${key}`, type: "text", text: n.label, containerId: `node:${key}`, frameId }));
    });
    for (const id of level.edges) {
      const e = lens.edges.find((x) => x.id === id)!;
      const [from, to] = options.reversed?.includes(id) ? [e.to, e.from] : [e.from, e.to];
      elements.push(el({ id: `arrow:${id}`, type: "arrow", x: 0, y: y + 70, points: [[0, 0], [40, 0]], startBinding: { elementId: `node:${from}` }, endBinding: { elementId: `node:${to}` }, customData: { acuteRelation: e.relation } }));
      elements.push(el({ id: `arrow-label:${id}`, type: "text", text: e.label, containerId: `arrow:${id}` }));
    }
    y += 400;
  }
  return { canvasId, elements: elements as unknown as RecordedScene["elements"], documents: {} };
}

/**
 * A faithful run's own output for a plan: source units carrying the case's quotes under the run's own ids (`r1…`, so
 * matching must go by text), every node citing the units of the knowledge it carries, and the omittable units omitted.
 */
export function faithfulRun(c: CaseBundle, plan: VisualPlan, version = 1): RunEvidence {
  const text = c.texts.get(version) ?? "";
  const caseUnits = c.source.units.filter((u) => (u.version ?? 1) === version);
  const runId = new Map(caseUnits.map((u, i) => [u.id, `r${i + 1}`]));
  const units = caseUnits.map((u, i) => {
    const start = Math.max(0, text.indexOf(u.quote));
    return { id: runId.get(u.id)!, kind: "sentence", text: u.quote, hash: "", topic: u.section, span: { start, end: start + u.quote.length }, ...(i ? { prev: `r${i}` } : {}), ...(i + 1 < caseUnits.length ? { next: `r${i + 2}` } : {}) };
  });
  const knowledge = new Map(c.knowledge.units.map((k) => [k.id, k]));
  const cites: Record<string, string[]> = {};
  for (const e of c.canvas.elements) {
    const ids = e.knowledge.flatMap((k) => knowledge.get(k)?.sourceUnits ?? []).flatMap((u) => runId.get(u) ?? []);
    for (const n of planCandidates(plan, c.canvas, e.id)) cites[n.id] = [...new Set([...(cites[n.id] ?? []), ...ids])];
  }
  const cited = new Set(Object.values(cites).flat());
  const omitted = caseUnits.filter((u) => u.omittable && !cited.has(runId.get(u.id)!)).map((u) => ({ unit: runId.get(u.id)!, reason: u.omittable!.reason }));
  return { noteModel: "distil", units: { units, nextId: units.length + 1 }, cites, omitted };
}
