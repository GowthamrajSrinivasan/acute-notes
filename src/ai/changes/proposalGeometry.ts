/**
 * The geometry a change set would leave on the canvas, for the layout checks
 * (`layoutCheck.ts`, Wave 1b item 4): the live scene with the set's moves and
 * removals applied, its new objects and frames, and its new connectors routed
 * exactly as the writer routes them (`routeConnectors` around every object).
 * Pure: scene elements and a change set in, boxes and polylines out.
 *
 * New objects are named `created:<key>`, existing ones by their element id;
 * links by their change key (new) or arrow id (existing).
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import type { Box, ChangeTarget, ProposedChange } from "./changeSet";
import { checkLayout, type LayoutGeometry, type LayoutLink, type LayoutReport } from "./layoutCheck";
import { frameNameBand, placeLabel, routeConnectors, sectionAvoid, type RoutedBox } from "./routing";
import { labelSize } from "./layoutCheck";

const NOT_OBSTACLES = new Set(["arrow", "line", "freedraw", "frame", "magicframe", "selection"]);

/** The objects a route keeps clear of (the writer's `isRouteObstacle`, on domain elements). */
export function isObstacle(el: SceneElement): boolean {
  if (el.isDeleted || NOT_OBSTACLES.has(el.type)) return false;
  return !(el.type === "text" && el.containerId);
}

const boxOf = (el: SceneElement): Box => ({ x: el.x, y: el.y, width: el.width, height: el.height });
const boxOnly = (b: Box): Box => ({ x: b.x, y: b.y, width: b.width, height: b.height });
const createdId = (key: string) => `created:${key}`;

export interface ProposalGeometry extends LayoutGeometry {
  /** What the proposal adds or moves: links it draws or re-routes, cards it creates or moves. */
  focus: Set<string>;
}

export function proposalGeometry(changes: readonly ProposedChange[], scene: readonly SceneElement[]): ProposalGeometry {
  const removed = new Set(changes.flatMap((c) => (c.kind === "remove" ? [c.target] : [])));
  const moves = new Map(changes.flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
  const focus = new Set<string>();
  const live = scene.filter((el) => !el.isDeleted && !removed.has(el.id));

  const cardById = new Map<string, RoutedBox>();
  for (const el of live) {
    if (!isObstacle(el)) continue;
    const to = moves.get(el.id);
    cardById.set(el.id, { id: el.id, ...boxOf(el), ...(to ?? {}) });
    if (to) focus.add(el.id);
  }
  const frames: RoutedBox[] = live.filter((el) => el.type === "frame").map((el) => ({ id: el.id, ...boxOf(el), ...(moves.get(el.id) ?? {}) }));
  for (const c of changes) {
    if (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") {
      cardById.set(createdId(c.key), { ...boxOnly(c.box), id: createdId(c.key) });
      focus.add(createdId(c.key));
    } else if (c.kind === "create_frame") {
      frames.push({ ...boxOnly(c.box), id: createdId(c.key) });
    }
  }
  const cards = [...cardById.values()];

  // Labels of existing arrows are text elements bound to them.
  const labels = new Map<string, string>();
  /** Where existing labels sit (their text element's centre), and the boxes they take. */
  const labelAt = new Map<string, { x: number; y: number }>();
  const taken: { x: number; y: number; width: number; height: number }[] = [];
  for (const el of live) {
    if (el.type !== "text" || !el.containerId || !el.text) continue;
    labels.set(el.containerId, el.text);
    labelAt.set(el.containerId, { x: el.x + el.width / 2, y: el.y + el.height / 2 });
    taken.push({ x: el.x, y: el.y, width: el.width, height: el.height });
  }

  const links: LayoutLink[] = [];
  type Request = { key: string; from: RoutedBox; to: RoutedBox; avoid?: readonly RoutedBox[]; wide?: boolean };
  const reroute: Request[] = [];
  const straight = new Set<string>();
  const connects: Request[] = [];
  const labelOf = new Map<string, string | undefined>();
  for (const el of live) {
    if (el.type !== "arrow") continue;
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!from || !to || removed.has(from) || removed.has(to)) continue;
    const a = cardById.get(from);
    const b = cardById.get(to);
    if (!a || !b) continue;
    const routed = !!(el.customData as { acuteRouted?: unknown } | undefined)?.acuteRouted;
    // The writer re-routes an Acute-routed connector whose end this set moves.
    if (routed && (moves.has(from) || moves.has(to))) {
      reroute.push({ key: el.id, from: a, to: b });
      labelOf.set(el.id, labels.get(el.id));
      focus.add(el.id);
      continue;
    }
    const points = (el.points ?? []).map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
    if (points.length >= 2) links.push({ key: el.id, fromId: from, toId: to, points, ...(labels.has(el.id) ? { label: labels.get(el.id)!, labelAt: labelAt.get(el.id)! } : {}) });
  }

  // A link between two sections runs frame to frame (the writer routes it the same way, around cards, over frames):
  // it is judged too — it used to be skipped, so "links cross cards" left out the links most likely to.
  const frameById = new Map(frames.map((f) => [f.id, f] as const));
  const end = (t: ChangeTarget) => {
    const id = "existing" in t ? t.existing : createdId(t.created);
    return cardById.get(id) ?? frameById.get(id);
  };
  for (const c of changes) {
    if (c.kind !== "connect") continue;
    const from = end(c.from);
    const to = end(c.to);
    if (!from || !to) continue;
    // As the writer routes it: a section-to-section link avoids the other sections' frames.
    const sectionLink = frameById.has(from.id) && frameById.has(to.id);
    connects.push({ key: c.key, from, to, ...(sectionLink ? { avoid: sectionAvoid(frames, from.id, to.id), wide: true } : {}) });
    if (c.routing === "straight") straight.add(c.key);
    labelOf.set(c.key, c.label);
    focus.add(c.key);
  }
  taken.push(...frames.map(frameNameBand));
  // Two batches, as the writer routes them: new connectors together, then the re-routed ones (ports spread per batch).
  const routes = new Map([...routeConnectors(connects, cards), ...routeConnectors(reroute, cards)]);
  for (const r of [...connects, ...reroute]) {
    const route = routes.get(r.key)!;
    const label = labelOf.get(r.key);
    // A straight connector runs between the same two ports (see the writer's `straightFields`).
    const points = straight.has(r.key) ? [route.points[0]!, route.points.at(-1)!] : route.points;
    // Placed as the writer places it: clear of the labels before it.
    const size = label ? labelSize(label) : null;
    const at = size ? placeLabel(points, size.width, size.height, taken) : null;
    if (at && size) taken.push({ x: at.x - size.width / 2, y: at.y - size.height / 2, ...size });
    links.push({ key: r.key, fromId: r.from.id, toId: r.to.id, points, ...(label && at ? { label, labelAt: at } : {}) });
  }
  return { cards, frames, links, focus };
}

/** What `changes` add or move, as layout ids: new links, new cards, moved objects. */
export function focusOf(changes: readonly ProposedChange[]): Set<string> {
  const out = new Set<string>();
  for (const c of changes) {
    if (c.kind === "connect") out.add(c.key);
    else if (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") out.add(createdId(c.key));
    else if (c.kind === "move") out.add(c.target);
  }
  return out;
}

/**
 * The layout checks for what `changes` would add or move on `scene`. `focusOn`: judge only these changes (one part
 * of a merged set) while the rest of `changes` still shapes the geometry.
 */
export function checkProposal(
  changes: readonly ProposedChange[],
  scene: readonly SceneElement[],
  options: { focusOn?: readonly ProposedChange[]; name?: (id: string) => string } = {},
): LayoutReport {
  const g = proposalGeometry(changes, scene);
  return checkLayout(g, { focus: options.focusOn ? focusOf(options.focusOn) : g.focus, ...(options.name ? { name: options.name } : {}) });
}
