/**
 * Excalidraw side of the right-angle connector routes (`ai/changes/routing.ts`, Wave 1b item 2):
 * turns a route into an elbow arrow's fields, and re-routes Acute-routed arrows when a card they
 * attach to changes size after it mounts (an auto-height card fitting its content).
 *
 * Only arrows Acute routed (`customData.acuteRouted`) are re-routed; a user's own arrows are left alone.
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { frameNameBand, labelCenter, placeLabel, routeConnectors, sectionAvoid, type ConnectorRoute, type RoutedBox } from "@/ai/changes/routing";

export { labelCenter };
import { CONNECTOR_GAP } from "@/ai/changes/geometry";


/** Elements a route should keep clear of: objects, not connectors, labels or frames. */
export function isRouteObstacle(el: ExcalidrawElement): boolean {
  if (el.isDeleted) return false;
  if (el.type === "arrow" || el.type === "line" || el.type === "freedraw" || el.type === "frame" || el.type === "magicframe" || el.type === "selection") return false;
  if (el.type === "text" && (el as { containerId?: string | null }).containerId) return false;
  return true;
}

export const routedBox = (el: ExcalidrawElement): RoutedBox => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height });

export function isAcuteRouted(el: ExcalidrawElement): boolean {
  const data = el.customData as Record<string, unknown> | undefined;
  return el.type === "arrow" && !!data?.acuteRouted;
}

/** The fields that make `arrow` follow `route` as a bound elbow arrow. */
export function elbowFields(route: ConnectorRoute, fromId: string, toId: string, customData: Record<string, unknown> | undefined) {
  const [first] = route.points;
  const points = route.points.map((p) => [p.x - first!.x, p.y - first!.y] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x: first!.x,
    y: first!.y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    elbowed: true,
    roundness: null,
    fixedSegments: null,
    startIsSpecial: null,
    endIsSpecial: null,
    startBinding: { elementId: fromId, focus: 0, gap: CONNECTOR_GAP, fixedPoint: route.startRatio },
    endBinding: { elementId: toId, focus: 0, gap: CONNECTOR_GAP, fixedPoint: route.endRatio },
    customData: { ...(customData ?? {}), acuteRouted: true },
  };
}

/**
 * The fields of a straight Excalidraw arrow between the same two ports as `route` (Response styling's
 * "straight" connectors): bound at both ends, but not Acute-routed, so Excalidraw keeps it attached.
 */
export function straightFields(route: ConnectorRoute, fromId: string, toId: string, customData: Record<string, unknown> | undefined) {
  const first = route.points[0]!;
  const last = route.points.at(-1)!;
  const { acuteRouted: _routed, ...rest } = customData ?? {};
  return {
    x: first.x,
    y: first.y,
    points: [
      [0, 0],
      [last.x - first.x, last.y - first.y],
    ] as [number, number][],
    width: Math.abs(last.x - first.x),
    height: Math.abs(last.y - first.y),
    elbowed: false,
    roundness: { type: 2 },
    fixedSegments: null,
    startIsSpecial: null,
    endIsSpecial: null,
    startBinding: { elementId: fromId, focus: 0, gap: CONNECTOR_GAP },
    endBinding: { elementId: toId, focus: 0, gap: CONNECTOR_GAP },
    customData: rest,
  };
}

/** The points a connector is drawn along: its route, or just the route's two ends when straight. */
export function connectorPoints(route: ConnectorRoute, routing: "elbow" | "straight" | undefined): ConnectorRoute["points"] {
  return routing === "straight" ? [route.points[0]!, route.points.at(-1)!] : route.points;
}

type Arrow = ExcalidrawElement & { startBinding: { elementId: string } | null; endBinding: { elementId: string } | null; boundElements: readonly { id: string; type: string }[] | null };

/**
 * Re-routes the Acute-routed arrows attached to `elementIds`, and those sharing a box side with them
 * (so spread ports stay consistent), after those objects moved or changed size. Returns each changed arrow's id and
 * its version before, for the caller's history (a consequence of auto-size, never its own undo step).
 */
export function rerouteAround(api: ExcalidrawImperativeAPI, elementIds: string | readonly string[]): { id: string; version: number }[] {
  const scene = api.getSceneElements() as readonly ExcalidrawElement[];
  const byId = new Map(scene.map((el) => [el.id, el] as const));
  const touches = (arrow: Arrow, ids: ReadonlySet<string>) => ids.has(arrow.startBinding?.elementId ?? "") || ids.has(arrow.endBinding?.elementId ?? "");
  // An arrow the user reshaped (Excalidraw's fixed segments) keeps the user's route.
  const routed = scene.filter((el) => isAcuteRouted(el) && !(el as { fixedSegments?: readonly unknown[] | null }).fixedSegments?.length) as Arrow[];
  const first = routed.filter((a) => touches(a, new Set(typeof elementIds === "string" ? [elementIds] : elementIds)));
  if (!first.length) return [];
  const ends = new Set(first.flatMap((a) => [a.startBinding?.elementId, a.endBinding?.elementId]).filter((id): id is string => !!id));
  const group = routed.filter((a) => touches(a, ends));
  // As when written: a link between two sections runs in the gutters, its ports spread along the frames' sides.
  const frames = scene.filter((el) => el.type === "frame" && !el.isDeleted).map(routedBox);
  const requests = group.flatMap((a) => {
    const from = a.startBinding && byId.get(a.startBinding.elementId);
    const to = a.endBinding && byId.get(a.endBinding.elementId);
    if (!from || !to) return [];
    const sections = from.type === "frame" && to.type === "frame" ? { avoid: sectionAvoid(frames, from.id, to.id), wide: true } : {};
    return [{ key: a.id, from: routedBox(from), to: routedBox(to), ...sections }];
  });
  // Labels of the links not re-routed here stay put: the moved ones keep clear of them, and of each other.
  const moving = new Set(requests.map((r) => r.key));
  const placedLabels = [...frames.map(frameNameBand), ...scene.flatMap((el) => {
    const container = (el as { containerId?: string | null }).containerId;
    return el.type === "text" && container && !moving.has(container) && byId.get(container)?.type === "arrow" ? [{ x: el.x, y: el.y, width: el.width, height: el.height }] : [];
  })];
  const routes = routeConnectors(requests, scene.filter(isRouteObstacle).map(routedBox));
  const changed: { id: string; version: number }[] = [];
  const replacements = new Map<string, ExcalidrawElement>();
  for (const r of requests) {
    const arrow = byId.get(r.key) as Arrow;
    const route = routes.get(r.key)!;
    const fields = elbowFields(route, r.from.id, r.to.id, arrow.customData as Record<string, unknown> | undefined);
    const same = arrow.x === fields.x && arrow.y === fields.y && JSON.stringify((arrow as unknown as { points: unknown }).points) === JSON.stringify(fields.points);
    if (same) continue;
    changed.push({ id: arrow.id, version: arrow.version });
    replacements.set(arrow.id, newElementWith(arrow, fields as never));
    // Its label follows the new route.
    const label = arrow.boundElements?.find((b) => b.type === "text");
    const text = label && byId.get(label.id);
    if (text) {
      const c = placeLabel(route.points, text.width, text.height, placedLabels);
      placedLabels.push({ x: c.x - text.width / 2, y: c.y - text.height / 2, width: text.width, height: text.height });
      changed.push({ id: text.id, version: text.version });
      replacements.set(text.id, newElementWith(text, { x: c.x - text.width / 2, y: c.y - text.height / 2 }));
    }
  }
  if (replacements.size) {
    api.updateScene({
      elements: (api.getSceneElementsIncludingDeleted() as readonly ExcalidrawElement[]).map((el) => replacements.get(el.id) ?? el),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
  }
  return changed;
}
