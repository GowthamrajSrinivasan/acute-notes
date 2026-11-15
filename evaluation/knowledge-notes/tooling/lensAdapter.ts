/**
 * The Lens projection adapter (capability `lens.projection-adapter`): the product's own Lens (`lensTree` over a
 * canvas, `src/domain/lens/lensView.ts`) → the dataset's normalised `LensProjection` (schemas.ts), so a real canvas
 * is scored by the same `lens_*` checks as the hand-written reference projections.
 *
 * Mapping:
 * - every frame the tree reaches is one projected level: `frameKey` = the frame's Lens key (`acuteDiagram.lensKey`, else
 *   its id), `level` = Lens's level for it, nodes keyed by their Lens identity (`lensKeyOf`), edges between node keys;
 * - every resolved child frame (`expandsTo`, `explained_by`, or a title-match suggestion) is a drill;
 * - a node that drills into source (code evidence, no child frame) gets a level of its own at the profile's source
 *   level (L5): one node per code location, keyed by the location and of kind `source`, plus a drill into it. That is what Lens shows there:
 *   a source card, not a diagram;
 * - a frame reached twice (two nodes drill into it) is projected once; a loop stops where Lens stops.
 *
 * Nothing here is used by the app. Pure: it reads a `SceneSource`, like Lens itself.
 */
import { codeEvidence } from "@/domain/lens/evidence";
import { drillTarget, lensRootFrames, lensTree, type LensNode, type LensTreeNode, type SceneSource } from "@/domain/lens/lensView";
import { LENS_MAX_LEVEL } from "@/domain/canvas/diagram";
import type { LensProjection } from "./schemas";

type Level = LensProjection["levels"][number];

/**
 * The kind of a projected source-card node. Not a component kind: a code location is never the same component as the
 * node whose code it is, so `lens_identity` (which compares nodes of one kind) never mistakes `…/orchestrator/…` for
 * the Orchestrator.
 */
export const SOURCE_KIND = "source";

/** The projected key of one code location shown on a source card. */
export function sourceKey(path: string, lines?: readonly [number, number]): string {
  return lines ? `src:${path}#L${lines[0]}-${lines[1]}` : `src:${path}`;
}

function projectNode(n: LensNode): Level["nodes"][number] {
  const code = codeEvidence(n.evidence).map((e) => ({ path: e.path!, ...(e.lines ? { lines: e.lines } : {}) }));
  return { key: n.key, label: n.label, ...(n.semantics.kind ? { kind: n.semantics.kind } : {}), ...(code.length ? { evidence: code } : {}) };
}

/** One tree (from one root frame) into `into`, skipping frames already projected. */
function walk(tree: LensTreeNode, into: LensProjection, seen: Set<string>): void {
  const id = `${tree.frame.canvasId}/${tree.frame.frameId}`;
  if (tree.loop || seen.has(id)) return;
  seen.add(id);
  const keyOf = new Map(tree.nodes.map((n) => [n.id, n.key]));
  into.levels.push({
    level: tree.level,
    frameKey: tree.key,
    nodes: tree.nodes.map(projectNode),
    edges: tree.edges.map((e) => ({ from: keyOf.get(e.from) ?? e.from, to: keyOf.get(e.to) ?? e.to, relation: e.relation ?? "", ...(e.label ? { label: e.label } : {}) })),
  });
  // Child frames, in node order (the tree lists one child per node that resolved one).
  const children = new Map(tree.children.map((c) => [`${c.frame.canvasId}/${c.frame.frameId}`, c]));
  for (const n of tree.nodes) {
    const target = drillTarget(n);
    if (target === "frame" && n.childFrame && !n.childFrame.pending) {
      const child = children.get(`${n.childFrame.canvasId}/${n.childFrame.frameId}`);
      if (child) into.drills.push({ from: n.key, toFrameKey: child.key });
    } else if (target === "source") {
      const frameKey = `source:${n.key}`;
      into.drills.push({ from: n.key, toFrameKey: frameKey });
      if (into.levels.some((l) => l.frameKey === frameKey)) continue;
      into.levels.push({
        level: tree.sourceLevel ?? LENS_MAX_LEVEL,
        frameKey,
        nodes: codeEvidence(n.evidence).map((e) => ({ key: sourceKey(e.path!, e.lines), label: e.label, kind: SOURCE_KIND, evidence: [{ path: e.path!, ...(e.lines ? { lines: e.lines } : {}) }] })),
        edges: [],
      });
    }
  }
  for (const child of tree.children) walk(child, into, seen);
}

/** `lensTree` output (one or more roots) → the normalised projection. */
export function lensProjectionFromTrees(trees: readonly LensTreeNode[]): LensProjection {
  const out: LensProjection = { levels: [], drills: [] };
  const seen = new Set<string>();
  for (const t of trees) walk(t, out, seen);
  return out;
}

/** Every Lens root of a canvas (`lensRootFrames`), projected: what the Lens panel offers on that canvas. */
export function lensProjectionOfCanvas(scenes: SceneSource, canvasId: string): LensProjection {
  const trees = lensRootFrames(scenes, canvasId).flatMap((r) => lensTree(scenes, { canvasId, frameId: r.frameId }, r.level) ?? []);
  return lensProjectionFromTrees(trees);
}
