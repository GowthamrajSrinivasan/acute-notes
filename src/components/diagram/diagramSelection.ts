/**
 * What a single selection means for interactive diagram frames, for the properties panel: a frame (the
 * "Interactive diagram" switch), a node inside an interactive frame (kind, sublabel, …), or — merged into the arrow
 * entry — an arrow between two of its nodes (its explanation). Pure; called from the canvas `onChange`.
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import { getDiagramMeta, getEdgeSemantics, getFrameLens, getNodeLens, getNodeProject, getNodeSemantics, interactiveFrameOf, NODE_ELEMENT_TYPES } from "@/domain/canvas/diagram";
import type { SelectedObject } from "@/components/properties/selectedBlockStore";
import { compositeKindOf, compositePartOf } from "@/domain/canvas/compositeShapes";

/**
 * The one diagram node a selection stands for: the single selected element, or a composite shape's host when the
 * selection is that shape — its host and its outline parts, which a click selects together (they share a group).
 */
export function diagramSelectionTarget(elements: readonly SceneElement[], ids: readonly string[], single: SceneElement | undefined): SceneElement | undefined {
  if (single || ids.length < 2) return single;
  const selected = elements.filter((el) => ids.includes(el.id) && !el.isDeleted);
  const hosts = selected.filter((el) => compositeKindOf(el));
  const host = hosts.length === 1 ? hosts[0]! : undefined;
  if (!host) return undefined;
  const group = host.groupIds[0];
  return selected.every((el) => el === host || (el.type === "text" && el.containerId === host.id) || (!!group && el.groupIds[0] === group && compositePartOf(el))) ? host : undefined;
}

export function selectedDiagramObject(elements: readonly SceneElement[], single: SceneElement): SelectedObject | null {
  if (single.type === "frame") {
    const lens = getFrameLens(single);
    return { kind: "frame", elementId: single.id, interactive: getDiagramMeta(single)?.interactive === true, level: lens?.level, ...(lens?.profile ? { profile: lens.profile } : {}) };
  }
  if (!NODE_ELEMENT_TYPES.includes(single.type)) return null;
  const frame = interactiveFrameOf(elements, single);
  if (!frame) return null;
  const project = getNodeProject(single);
  return { kind: "diagram-node", elementId: single.id, frameId: frame.id, semantics: getNodeSemantics(single) ?? {}, lens: getNodeLens(single) ?? {}, ...(project ? { project } : {}) };
}

/** `{ diagram }` for an arrow whose start node is in an interactive frame; `{}` otherwise. */
export function diagramArrowInfo(elements: readonly SceneElement[], arrow: SceneElement): { diagram?: { explanation?: string } } {
  const startId = arrow.startBinding?.elementId;
  if (!startId || !arrow.endBinding) return {};
  const start = elements.find((el) => el.id === startId && !el.isDeleted);
  if (!start || !interactiveFrameOf(elements, start)) return {};
  const explanation = getEdgeSemantics(arrow)?.explanation;
  return { diagram: explanation ? { explanation } : {} };
}
