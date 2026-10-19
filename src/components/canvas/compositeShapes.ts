/**
 * Excalidraw side of composite shapes (`domain/canvas/compositeShapes.ts`): creating one, keeping its outline in
 * step with its host, and making it select, resize, rotate and edit like one shape.
 */
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith, restoreElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SceneElement } from "@/domain/canvas/adapter";
import {
  compositeKindOf,
  compositePartOf,
  normalizeComposites,
  type CompositePartSpec,
  type CompositeShapeKind,
  type CompositeStyle,
} from "@/domain/canvas/compositeShapes";
import { randomId } from "@/domain/ids";

type Box = { x: number; y: number; width: number; height: number };

const DEFAULT_STROKE = "#1e1e1e";
/** The fill a cylinder drawn by hand starts with: a filled body can be picked up anywhere inside it, not only on its outline. */
const DEFAULT_FILL = "#e7f5ff";
/** The size a shape drawn by hand starts at. */
const DEFAULT_SIZE: Record<CompositeShapeKind, { width: number; height: number }> = {
  cylinder: { width: 160, height: 120 },
  hexagon: { width: 180, height: 100 },
  parallelogram: { width: 200, height: 90 },
  trapezoid: { width: 200, height: 90 },
  document: { width: 180, height: 110 },
  subroutine: { width: 200, height: 90 },
};

export interface CompositeShapeOptions {
  box: Box;
  label?: string;
  strokeColor?: string;
  backgroundColor?: string;
  /** The host's customData (provenance, stable node key…). */
  customData?: Record<string, unknown>;
  id?: string;
}

/** Excalidraw line elements for part specs. Excalidraw draws a fill only for a closed line: the body carries it, the open rim can't. */
function partElements(specs: readonly CompositePartSpec[]): ExcalidrawElement[] {
  return restoreElements(
    specs.map(({ hostId: _host, part, ...spec }) => ({
      type: "line",
      ...spec,
      roundness: null,
      customData: { acuteShapePart: part },
    })) as never,
    null,
  );
}

/** A composite shape's elements, in z-order: its parts (drawn from the host), then the transparent host and its label. */
export function createCompositeShapeElements(kind: CompositeShapeKind, options: CompositeShapeOptions): ExcalidrawElement[] {
  const style = { strokeColor: options.strokeColor ?? DEFAULT_STROKE, backgroundColor: options.backgroundColor ?? "transparent" };
  const skeleton = {
    type: "rectangle",
    id: options.id ?? randomId(),
    ...options.box,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    roughness: 1,
    roundness: null,
    groupIds: [randomId()],
    customData: { ...options.customData, acuteShape: kind, acuteShapeStyle: style },
    ...(options.label ? { label: { text: options.label, strokeColor: style.strokeColor } } : {}),
  };
  const [host, ...label] = convertToExcalidrawElements([skeleton] as never, { regenerateIds: false }) as unknown as ExcalidrawElement[];
  // The parts are what the normalizer draws for a host that has none, so a new shape and a pasted one are drawn alike.
  const { created } = normalizeComposites([host as unknown as SceneElement], randomId);
  return [...partElements(created), host!, ...label.map((t) => newElementWith(t, { groupIds: host!.groupIds }))];
}

/**
 * `elements` with composite shapes made consistent (see `normalizeComposites`); the same array when nothing changes.
 * `scope` limits the work to some shapes: pass every element of each shape to check (host, parts and label).
 */
export function withNormalizedComposites<E extends ExcalidrawElement>(elements: readonly E[], scope?: (el: E) => boolean): readonly E[] {
  const checked = scope ? elements.filter(scope) : elements;
  const { patches, created } = normalizeComposites(checked as unknown as readonly SceneElement[], randomId);
  if (!patches.length && !created.length) return elements;
  const byId = new Map(patches.map((p) => [p.id, p.fields] as const));
  const newParts = new Map<string, ExcalidrawElement[]>();
  const made = partElements(created);
  created.forEach((spec, i) => newParts.set(spec.hostId, [...(newParts.get(spec.hostId) ?? []), made[i]!]));
  // New parts go just below their host.
  return elements.flatMap((el) => [...((newParts.get(el.id) as E[] | undefined) ?? []), byId.has(el.id) ? (newElementWith(el, byId.get(el.id) as never) as E) : el]);
}

const isHost = (el: ExcalidrawElement) => !!compositeKindOf(el as unknown as SceneElement);

const isComposite = (el: ExcalidrawElement) => isHost(el) || !!compositePartOf(el as unknown as SceneElement);
/** The key a composite element is checked under: its shape's group, or itself when ungrouped. */
const shapeKey = (el: ExcalidrawElement) => el.groupIds[0] ?? `loose:${el.id}`;

const byIdCache = new WeakMap<readonly ExcalidrawElement[], Map<string, ExcalidrawElement>>();

/** The scene by element id, built once per scene array (Excalidraw keeps the array while elements change in place). */
function elementsById(api: ExcalidrawImperativeAPI): ReadonlyMap<string, ExcalidrawElement> {
  const scene = api.getSceneElementsIncludingDeleted();
  let byId = byIdCache.get(scene);
  if (!byId) byIdCache.set(scene, (byId = new Map(scene.map((el) => [el.id, el]))));
  return byId;
}

/** The composite host the selection amounts to: the shape's whole group, or the host alone. Null for anything else. */
export function selectedShape(api: ExcalidrawImperativeAPI, appState: AppState): { host: ExcalidrawElement; wholeGroup: boolean } | null {
  if (appState.editingGroupId) return null;
  // Called on every change event (pointer moves too): looks up the selection only, never scans the scene.
  const ids = Object.keys(appState.selectedElementIds);
  if (!ids.length || ids.length > 8) return null;
  const byId = elementsById(api);
  const selected = ids.flatMap((id) => {
    const el = byId.get(id);
    return el && !el.isDeleted ? [el] : [];
  });
  const host = selected.find(isHost);
  const group = host?.groupIds[0];
  if (!host || !group || selected.some((el) => el.groupIds[0] !== group)) return null;
  const groups = Object.keys(appState.selectedGroupIds).filter((g) => appState.selectedGroupIds[g]);
  if (groups.length > 1 || (groups.length === 1 && groups[0] !== group) || host.groupIds.length !== 1) return null;
  const hostAlone = !groups.length && selected.every((el) => el.id === host.id || (el.type === "text" && el.containerId === host.id));
  // Otherwise it's the shape's group, or its parts selected without it (what undo restores).
  return { host, wholeGroup: !hostAlone };
}

/**
 * Composite shapes on the live canvas (`onChange` + a double-click listener):
 *
 * - **Selected as one shape.** Clicking a shape selects its group (its parts are what's under the pointer). Once the
 *   click is done, the selection becomes the host alone: Excalidraw then resizes it as a single shape (free stretch;
 *   the label keeps its size, where a group resize would scale both), rotates and moves it. A shape grouped with other
 *   objects, or selected with others, stays a group selection.
 * - **Consistent.** The parts are re-derived from the host (`normalizeComposites`): frame by frame while the host alone
 *   is changed (Excalidraw never touches the parts then), and after anything else. The fix-ups land inside the canvas
 *   history's settle window, so they join the user's own undo step.
 * - **One double-click edits the label.** Excalidraw's double-click on a selected group only enters the group (and one
 *   on a part inside it adds free text); selecting the host alone first makes Excalidraw edit its label instead. That
 *   redirect is applied before Excalidraw's own (React, bubble-phase) handler reads the selection.
 */
export function createCompositeShapes() {
  let seen: readonly unknown[] | null = null;
  let gesture = false;
  /** Shapes (by `shapeKey`) to check at the next fix-up; the fix-up is queued once. */
  const dirty = new Set<string>();
  let pending = false;
  /** The version each composite element had when last checked: only shapes with a changed element are checked again. */
  const versions = new Map<string, number>();

  const normalizeSoon = (api: ExcalidrawImperativeAPI, keys: Iterable<string>) => {
    for (const key of keys) dirty.add(key);
    if (pending || !dirty.size) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const scope = new Set(dirty);
      dirty.clear();
      const now = api.getSceneElementsIncludingDeleted();
      const fixed = withNormalizedComposites(now, (el) => scope.has(shapeKey(el)));
      if (fixed !== now) api.updateScene({ elements: fixed, captureUpdate: CaptureUpdateAction.NEVER });
    });
  };

  /** Shapes with an element added, changed or deleted since they were last checked. */
  const changedShapes = (scene: readonly ExcalidrawElement[]): Set<string> => {
    const keys = new Set<string>();
    for (const el of scene) {
      if (!isComposite(el) || versions.get(el.id) === el.version) continue;
      versions.set(el.id, el.version);
      keys.add(shapeKey(el));
    }
    return keys;
  };

  const selectHost = (api: ExcalidrawImperativeAPI, hostId: string) =>
    api.updateScene({ appState: { selectedElementIds: { [hostId]: true }, selectedGroupIds: {}, editingGroupId: null }, captureUpdate: CaptureUpdateAction.NEVER });

  return {
    handleChange(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], appState: AppState): void {
      const shape = selectedShape(api, appState);
      if (appState.cursorButton === "down" || appState.isResizing || appState.isRotating) {
        gesture = true;
        // The host alone is being resized, rotated or moved: its parts follow it frame by frame (that shape only).
        if (shape && !shape.wholeGroup) normalizeSoon(api, [shapeKey(shape.host)]);
        return;
      }
      if (shape?.wholeGroup) {
        const { id } = shape.host;
        queueMicrotask(() => selectHost(api, id));
      }
      // A drag changes elements in place (the same array), so the end of a gesture is checked too.
      if (elements === seen && !gesture) return;
      seen = elements;
      gesture = false;
      normalizeSoon(api, changedShapes(api.getSceneElementsIncludingDeleted()));
    },

    install(api: ExcalidrawImperativeAPI, container: HTMLElement): () => void {
      const onDoubleClick = (e: MouseEvent) => {
        if (!(e.target instanceof HTMLCanvasElement) || e.ctrlKey || e.metaKey) return;
        const appState = api.getAppState();
        if (appState.activeTool.type !== "selection" || appState.editingTextElement) return;
        const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, appState);
        const elements = api.getSceneElements();
        const host = hostAt(elements, x, y);
        const group = host?.groupIds[0];
        if (!host || !group) return;
        const selected = appState.selectedElementIds;
        const involved =
          !!appState.selectedGroupIds[group] ||
          appState.editingGroupId === group ||
          elements.some((el) => selected[el.id] && el.groupIds[0] === group && (el.id === host.id || compositePartOf(el as unknown as SceneElement)));
        if (involved) selectHost(api, host.id);
      };
      container.addEventListener("dblclick", onDoubleClick, true);
      return () => container.removeEventListener("dblclick", onDoubleClick, true);
    },
  };
}

/** The colours a composite host draws its outline in (its recorded style). */
export function compositeStyleOf(host: ExcalidrawElement): CompositeStyle {
  const style = host.customData?.acuteShapeStyle as Partial<CompositeStyle> | undefined;
  return { strokeColor: style?.strokeColor ?? DEFAULT_STROKE, backgroundColor: style?.backgroundColor ?? "transparent" };
}

/**
 * Sets a composite shape's colours (the panel's Stroke / Background for it; Excalidraw's own pickers would show the
 * transparent host's). One undo step: the host's recorded style and its parts change together.
 */
export function setCompositeStyle(api: ExcalidrawImperativeAPI, hostId: string, patch: Partial<CompositeStyle>): void {
  const scene = api.getSceneElementsIncludingDeleted();
  const host = scene.find((el) => el.id === hostId && !el.isDeleted);
  const group = host?.groupIds[0];
  if (!host || !group || !isHost(host)) return;
  const style = { ...compositeStyleOf(host), ...patch };
  api.updateScene({
    elements: scene.map((el) => {
      if (el.id === hostId) return newElementWith(el, { customData: { ...el.customData, acuteShapeStyle: style } });
      const part = el.groupIds[0] === group && !el.isDeleted ? compositePartOf(el as unknown as SceneElement) : null;
      if (!part) return el;
      return newElementWith(el, { strokeColor: style.strokeColor, backgroundColor: part === "body" ? style.backgroundColor : "transparent" });
    }),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Adds a composite shape at the viewport centre, selected. */
export function insertCompositeShape(api: ExcalidrawImperativeAPI, kind: CompositeShapeKind): string {
  const { width, height, scrollX, scrollY, zoom } = api.getAppState();
  const size = DEFAULT_SIZE[kind];
  const cx = width / 2 / zoom.value - scrollX;
  const cy = height / 2 / zoom.value - scrollY;
  const els = createCompositeShapeElements(kind, { box: { x: cx - size.width / 2, y: cy - size.height / 2, ...size }, backgroundColor: DEFAULT_FILL });
  const host = els.find(isHost)!;
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...els],
    appState: { selectedElementIds: { [host.id]: true }, selectedGroupIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return host.id;
}

/** A scene point in a shape's own frame: relative to its centre, unrotated. */
function toHostLocal(el: ExcalidrawElement, x: number, y: number): { lx: number; ly: number } {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(-el.angle);
  const sin = Math.sin(-el.angle);
  return { lx: (x - cx) * cos - (y - cy) * sin, ly: (x - cx) * sin + (y - cy) * cos };
}

/** The topmost live composite host under a scene point (its rotated box). */
function hostAt(elements: readonly ExcalidrawElement[], x: number, y: number): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (el.isDeleted || !isHost(el)) continue;
    const { lx, ly } = toHostLocal(el, x, y);
    if (Math.abs(lx) <= el.width / 2 && Math.abs(ly) <= el.height / 2) return el;
  }
  return null;
}
