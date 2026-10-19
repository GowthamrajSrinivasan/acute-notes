/**
 * Composite shapes (a cylinder, a hexagon, a document…). Excalidraw has a fixed set of element types, so a shape it doesn't
 * draw is built from ones it does:
 *
 * - the **host**, a native rectangle marked `customData.acuteShape`, drawn transparent. It holds the label and the
 *   arrow bindings, so labels, connectors, routing and everything that reads shapes keep working unchanged;
 * - **parts**, closed or open `line`s marked `customData.acuteShapePart`, that draw the outline.
 *
 * Host and parts share the host's innermost group (`groupIds[0]`), so a marquee selection, a z-order change or a
 * group move takes them together. The host is the single source of truth: `normalizeComposites` re-derives every part
 * from its box, angle and recorded style (`customData.acuteShapeStyle`), so a resize keeps the rim a sensible height
 * instead of stretching it, and a host copied on its own gets its outline drawn again.
 *
 * Pure and renderer-agnostic, like the adapter: written against `SceneElement`.
 */
import type { ShapeKind } from "../types";
import type { SceneElement } from "./adapter";

/** The composite shapes (a subroutine is a box with inner side bars). */
export const COMPOSITE_SHAPES = ["cylinder", "hexagon", "parallelogram", "trapezoid", "document", "subroutine"] as const;
export type CompositeShapeKind = (typeof COMPOSITE_SHAPES)[number];

/** What each composite shape means, for the model and the people reading a diagram. */
export const COMPOSITE_SHAPE_MEANINGS: Record<CompositeShapeKind, string> = {
  cylinder: "a database or data store",
  hexagon: "a preparation step or a service",
  parallelogram: "data in or out",
  trapezoid: "a manual operation",
  document: "a document or report",
  subroutine: "a predefined process",
};

/** The composite shapes with their meanings, for tool descriptions: "cylinder (a database or data store), …". */
export const COMPOSITE_SHAPES_DESCRIBED = COMPOSITE_SHAPES.map((s) => `${s} (${COMPOSITE_SHAPE_MEANINGS[s]})`).join(", ");

/** The lines a shape is drawn with. Only the `body`, a closed line, is ever filled; the others are open strokes on it. */
export const SHAPE_PARTS = ["body", "rim", "left", "right"] as const;
export type ShapePart = (typeof SHAPE_PARTS)[number];

export const COMPOSITE_PARTS: Record<CompositeShapeKind, readonly ShapePart[]> = {
  cylinder: ["body", "rim"],
  hexagon: ["body"],
  parallelogram: ["body"],
  trapezoid: ["body"],
  document: ["body"],
  subroutine: ["body", "left", "right"],
};

const NATIVE_SHAPES: readonly string[] = ["rectangle", "diamond", "ellipse"];
const TRANSPARENT = "transparent";
/** Excalidraw's default stroke. */
const DEFAULT_STROKE = "#1e1e1e";
/** Segments per half ellipse or wave: smooth at normal zoom, and exact bounds (no curve overshoot) for rotation. */
const ARC_STEPS = 16;
/** Tolerances: positions in scene pixels, angles in radians. */
const EPS = 0.5;
const ANGLE_EPS = 1e-3;

type Point = readonly [number, number];

/** The composite kind a host element draws, or null for anything else. */
export function compositeKindOf(el: Pick<SceneElement, "type" | "customData">): CompositeShapeKind | null {
  const kind = el.customData?.acuteShape;
  return el.type === "rectangle" && COMPOSITE_SHAPES.includes(kind as CompositeShapeKind) ? (kind as CompositeShapeKind) : null;
}

/** The part of a composite shape this element draws, or null. */
export function compositePartOf(el: Pick<SceneElement, "type" | "customData">): ShapePart | null {
  const part = el.customData?.acuteShapePart;
  return el.type === "line" && SHAPE_PARTS.includes(part as ShapePart) ? (part as ShapePart) : null;
}

/** The shape an element reads as: a composite kind for a host, the native type for a plain shape, else null. */
export function shapeKindOf(el: Pick<SceneElement, "type" | "customData">): ShapeKind | null {
  return compositeKindOf(el) ?? (NATIVE_SHAPES.includes(el.type) ? (el.type as ShapeKind) : null);
}

export const isCompositeShape = (shape: string): shape is CompositeShapeKind => COMPOSITE_SHAPES.includes(shape as CompositeShapeKind);

// Proportions that stay sensible as a shape is resized: each is a share of a small shape, capped so a big one
// doesn't get a tall rim, a deep wave or a wide slant.

/** Height of the cylinder's top ellipse. */
export function cylinderRimHeight(width: number, height: number): number {
  return Math.max(6, Math.min(height * 0.25, width * 0.2, 36));
}

/** How far a hexagon's points, a parallelogram's slant and a trapezoid's bottom inset reach in from the sides. */
export function slantInset(width: number, height: number): number {
  return Math.max(4, Math.min(width * 0.15, height * 0.5, 30));
}

/** Amplitude of a document's wavy bottom edge. */
export function documentWave(width: number, height: number): number {
  return Math.max(3, Math.min(height * 0.08, width * 0.05, 10));
}

/** Distance of a subroutine's inner bars from its sides. */
export function subroutineBar(width: number, height: number): number {
  return Math.max(6, Math.min(width * 0.08, height * 0.3, 16));
}

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = from + ((to - from) * i) / ARC_STEPS;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}

const closed = (points: Point[]): Point[] => [...points, points[0]!];

type Outline = Partial<Record<ShapePart, Point[]>>;

/**
 * The cylinder's parts in host-local coordinates (origin at the host's top-left):
 * `body` is the closed silhouette (sides, the bottom's front arc, the top's back arc), filled with the shape's fill;
 * `rim` is the front arc of the top ellipse, drawn over it.
 */
export function cylinderOutline(width: number, height: number): { body: Point[]; rim: Point[] } {
  const rx = width / 2;
  const ry = cylinderRimHeight(width, height) / 2;
  const bottom = arc(rx, height - ry, rx, ry, Math.PI, 0); // left → bottom → right
  const top = arc(rx, ry, rx, ry, 0, -Math.PI); // right → top → left
  return { body: [...bottom, ...top, bottom[0]!], rim: arc(rx, ry, rx, ry, Math.PI, 0) };
}

/** A document: a box whose bottom edge is one wave, its lowest point on the box's bottom. */
function documentOutline(w: number, h: number): Outline {
  const a = documentWave(w, h);
  const wave: Point[] = [];
  for (let i = 0; i <= 2 * ARC_STEPS; i++) {
    const t = i / (2 * ARC_STEPS); // right → left
    wave.push([w * (1 - t), h - a + a * Math.sin(2 * Math.PI * t)]);
  }
  return { body: closed([[0, 0], [w, 0], ...wave]) };
}

const OUTLINES: Record<CompositeShapeKind, (width: number, height: number) => Outline> = {
  cylinder: cylinderOutline,
  hexagon: (w, h) => {
    const s = slantInset(w, h);
    return { body: closed([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]]) };
  },
  // Leaning right, as Mermaid's [/ /] and the flowchart input/output symbol.
  parallelogram: (w, h) => {
    const s = slantInset(w, h);
    return { body: closed([[s, 0], [w, 0], [w - s, h], [0, h]]) };
  },
  // Wider at the top: the flowchart manual-operation symbol (Mermaid's [\ /], `trap-t`).
  trapezoid: (w, h) => {
    const s = slantInset(w, h);
    return { body: closed([[0, 0], [w, 0], [w - s, h], [s, h]]) };
  },
  document: documentOutline,
  subroutine: (w, h) => {
    const b = subroutineBar(w, h);
    return { body: closed([[0, 0], [w, 0], [w, h], [0, h]]), left: [[b, 0], [b, h]], right: [[w - b, 0], [w - b, h]] };
  },
};

/** A shape's parts in host-local coordinates (origin at the host's top-left). */
export function compositeOutline(kind: CompositeShapeKind, width: number, height: number): Outline {
  return OUTLINES[kind](width, height);
}

/** The room a shape's outline takes from its box, beyond a rectangle's: what a label needs added to fit inside it. */
export function compositeLabelRoom(kind: CompositeShapeKind, width: number, height: number): { width: number; height: number } {
  switch (kind) {
    case "cylinder":
      return { width: 0, height: 2 * cylinderRimHeight(width, height) };
    case "hexagon":
    case "parallelogram":
    case "trapezoid":
      return { width: 2 * slantInset(width, height), height: 0 };
    case "document":
      return { width: 0, height: 2 * documentWave(width, height) };
    case "subroutine":
      return { width: 2 * subroutineBar(width, height), height: 0 };
  }
}

/** A line element's geometry: its origin (the first point) and points relative to it. */
export interface LineGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  points: [number, number][];
}

type HostBox = Pick<SceneElement, "x" | "y" | "width" | "height" | "angle">;

/**
 * Where `part` goes for a host with this box. Excalidraw rotates an element about the centre of its own bounds, so a
 * rotated part is placed with its centre rotated about the host's centre, then given the host's angle.
 */
export function partGeometry(kind: CompositeShapeKind, part: ShapePart, host: HostBox): LineGeometry {
  const local = OUTLINES[kind](host.width, host.height)[part]!;
  const [ox, oy] = local[0]!;
  const points = local.map(([x, y]) => [x - ox, y - oy] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // The part's bounds centre, unrotated, in scene coordinates; then rotated about the host's centre.
  const hx = host.x + host.width / 2;
  const hy = host.y + host.height / 2;
  const cx = host.x + ox + (minX + maxX) / 2 - hx;
  const cy = host.y + oy + (minY + maxY) / 2 - hy;
  const cos = Math.cos(host.angle);
  const sin = Math.sin(host.angle);
  const rx = hx + cx * cos - cy * sin;
  const ry = hy + cx * sin + cy * cos;
  return { x: rx - (minX + maxX) / 2, y: ry - (minY + maxY) / 2, width: maxX - minX, height: maxY - minY, angle: host.angle, points };
}

export type CompositePatchFields = Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  points: [number, number][];
  strokeColor: string;
  backgroundColor: string;
  isDeleted: boolean;
  groupIds: string[];
  frameId: string | null;
  customData: Record<string, unknown>;
}> &
  Partial<LineLook>;

/**
 * How a shape's outline is drawn, apart from its colours: set on the host by Excalidraw's own panel controls (stroke
 * width and style, sloppiness, fill style, opacity) and mirrored onto the parts, so those controls work unchanged.
 */
export interface LineLook {
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  fillStyle: string;
  opacity: number;
}

const lookOf = (el: SceneElement): LineLook => ({
  strokeWidth: el.strokeWidth,
  strokeStyle: el.strokeStyle,
  roughness: el.roughness ?? 1,
  fillStyle: el.fillStyle ?? "solid",
  opacity: el.opacity,
});

export interface CompositePatch {
  id: string;
  fields: CompositePatchFields;
}

/** A part to add (a host copied, pasted or duplicated on its own has none yet): drawn just below its host. */
export interface CompositePartSpec extends LineGeometry, LineLook {
  id: string;
  hostId: string;
  part: ShapePart;
  groupIds: string[];
  frameId: string | null;
  strokeColor: string;
  backgroundColor: string;
}

export interface CompositeFixes {
  patches: CompositePatch[];
  created: CompositePartSpec[];
}

/** The colours a composite shape is drawn in, recorded on its (transparent) host so its parts can be drawn again from it. */
export interface CompositeStyle {
  strokeColor: string;
  backgroundColor: string;
}

const near = (a: number, b: number) => Math.abs(a - b) < EPS;

function samePoints(a: readonly (readonly [number, number])[] | undefined, b: readonly [number, number][]): boolean {
  return !!a && a.length === b.length && a.every(([x, y], i) => near(x, b[i]![0]) && near(y, b[i]![1]));
}

function without(customData: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> {
  const next = { ...customData };
  for (const key of keys) delete next[key];
  return next;
}

function recordedStyle(host: SceneElement): Partial<CompositeStyle> {
  const s = host.customData?.acuteShapeStyle as Partial<CompositeStyle> | undefined;
  return {
    ...(typeof s?.strokeColor === "string" ? { strokeColor: s.strokeColor } : {}),
    ...(typeof s?.backgroundColor === "string" ? { backgroundColor: s.backgroundColor } : {}),
  };
}

/**
 * What must change so every composite shape in `elements` (the scene including deleted elements) is consistent.
 * Nothing when it already is, so calling it after every scene change is safe (it never loops).
 *
 * - each live host's parts follow its box, angle, frame and line look (`LineLook`), and take any stroke/fill set on the
 *   host (which stays invisible);
 * - a host with no parts (copied, pasted or duplicated on its own) gets them drawn again; a duplicate that landed in
 *   its original's group first gets a group of its own;
 * - an ungrouped host is broken apart: it becomes a plain, visible rectangle, and its former parts plain lines;
 * - parts of a deleted host are deleted with it; a part whose host is gone entirely (copied on its own) becomes a plain line.
 *
 * `newId` makes ids for new groups and parts.
 */
export function normalizeComposites(elements: readonly SceneElement[], newId: () => string): CompositeFixes {
  const hosts = new Map<string, SceneElement[]>();
  const deletedHostGroups = new Set<string>();
  const loose: SceneElement[] = [];
  const parts = new Map<string, SceneElement[]>();
  const labels = new Map<string, SceneElement[]>();
  for (const el of elements) {
    const group = el.groupIds[0];
    if (compositeKindOf(el)) {
      if (el.isDeleted) {
        if (group) deletedHostGroups.add(group);
      } else if (group) hosts.set(group, [...(hosts.get(group) ?? []), el]);
      else loose.push(el);
    } else if (compositePartOf(el) && !el.isDeleted) {
      if (group) parts.set(group, [...(parts.get(group) ?? []), el]);
      else loose.push(el);
    } else if (el.type === "text" && el.containerId && !el.isDeleted) {
      labels.set(el.containerId, [...(labels.get(el.containerId) ?? []), el]);
    }
  }

  const patches: CompositePatch[] = [];
  const created: CompositePartSpec[] = [];
  const addParts = (host: SceneElement, kind: CompositeShapeKind, groupIds: string[], style: CompositeStyle) => {
    for (const part of COMPOSITE_PARTS[kind]) {
      created.push({
        id: newId(),
        hostId: host.id,
        part,
        groupIds,
        frameId: host.frameId ?? null,
        ...partGeometry(kind, part, host),
        strokeColor: style.strokeColor,
        backgroundColor: part === "body" ? style.backgroundColor : TRANSPARENT,
        ...lookOf(host),
      });
    }
  };

  for (const el of loose) {
    if (compositePartOf(el)) {
      patches.push({ id: el.id, fields: { customData: without(el.customData, "acuteShapePart") } });
      continue;
    }
    // Ungrouped: broken apart into a plain rectangle drawn in the shape's colours.
    const style = recordedStyle(el);
    patches.push({
      id: el.id,
      fields: {
        strokeColor: el.strokeColor !== TRANSPARENT ? el.strokeColor : (style.strokeColor ?? DEFAULT_STROKE),
        backgroundColor: el.backgroundColor !== TRANSPARENT ? el.backgroundColor : (style.backgroundColor ?? TRANSPARENT),
        customData: without(el.customData, "acuteShape", "acuteShapeStyle"),
      },
    });
  }

  for (const [group, [host, ...duplicates]] of hosts) {
    const kind = compositeKindOf(host!)!;
    const own = parts.get(group) ?? [];
    const body = own.find((el) => compositePartOf(el) === "body");
    const recorded = recordedStyle(host!);
    // A stroke or fill set on the host (the properties panel, a diagram kind) belongs to the parts.
    const setStroke = host!.strokeColor !== TRANSPARENT ? host!.strokeColor : null;
    const setFill = host!.backgroundColor !== TRANSPARENT ? host!.backgroundColor : null;
    const style: CompositeStyle = {
      strokeColor: setStroke ?? body?.strokeColor ?? recorded.strokeColor ?? DEFAULT_STROKE,
      backgroundColor: setFill ?? body?.backgroundColor ?? recorded.backgroundColor ?? TRANSPARENT,
    };
    const hostFields: CompositePatchFields = {};
    if (setStroke || setFill) Object.assign(hostFields, { strokeColor: TRANSPARENT, backgroundColor: TRANSPARENT });
    if (recorded.strokeColor !== style.strokeColor || recorded.backgroundColor !== style.backgroundColor) {
      hostFields.customData = { ...host!.customData, acuteShapeStyle: style };
    }
    if (Object.keys(hostFields).length) patches.push({ id: host!.id, fields: hostFields });

    if (!own.length) addParts(host!, kind, [...host!.groupIds], style);
    for (const el of own) {
      const part = compositePartOf(el)!;
      if (!COMPOSITE_PARTS[kind].includes(part)) continue;
      const want = partGeometry(kind, part, host!);
      const fields: CompositePatchFields = {};
      if (!near(el.x, want.x) || !near(el.y, want.y) || Math.abs(el.angle - want.angle) > ANGLE_EPS || !samePoints(el.points, want.points)) Object.assign(fields, want);
      if (el.strokeColor !== style.strokeColor) fields.strokeColor = style.strokeColor;
      const look = lookOf(host!);
      const partLook = lookOf(el);
      for (const key of Object.keys(look) as (keyof LineLook)[]) if (partLook[key] !== look[key]) Object.assign(fields, { [key]: look[key] });
      // The parts are in whatever section (frame) the host is in.
      if ((el.frameId ?? null) !== (host!.frameId ?? null)) fields.frameId = host!.frameId ?? null;
      // Only the body is filled: the rim is an open line (Excalidraw fills closed lines only), kept transparent.
      if (part === "body" && el.backgroundColor !== style.backgroundColor) fields.backgroundColor = style.backgroundColor;
      if (Object.keys(fields).length) patches.push({ id: el.id, fields });
    }

    // A host duplicated inside its original's group: a group of its own (with its label), and its own parts.
    for (const dup of duplicates) {
      const groupIds = [newId(), ...dup.groupIds.slice(1)];
      const dupRecorded = recordedStyle(dup);
      const dupStyle: CompositeStyle = {
        strokeColor: dupRecorded.strokeColor ?? style.strokeColor,
        backgroundColor: dupRecorded.backgroundColor ?? style.backgroundColor,
      };
      patches.push({ id: dup.id, fields: { groupIds, strokeColor: TRANSPARENT, backgroundColor: TRANSPARENT, customData: { ...dup.customData, acuteShapeStyle: dupStyle } } });
      for (const label of labels.get(dup.id) ?? []) patches.push({ id: label.id, fields: { groupIds } });
      addParts(dup, kind, groupIds, dupStyle);
    }
  }

  for (const [group, own] of parts) {
    if (hosts.has(group)) continue;
    for (const el of own) patches.push({ id: el.id, fields: deletedHostGroups.has(group) ? { isDeleted: true } : { customData: without(el.customData, "acuteShapePart") } });
  }
  return { patches, created };
}
