/**
 * Renderer ⇄ domain adapter.
 *
 * The canvas renderer (Excalidraw) owns geometry during interaction. This
 * module converts its scene elements into renderer-agnostic `AcuteObject`s for
 * AI context, MCP, search and export. It is written against a *structural*
 * subset of Excalidraw's element shape so the domain layer never imports the
 * renderer and can be tested without a browser.
 */
import { CARD_STYLE, normalizeBlockStyle, type BlockStyle } from "../content/blockStyle";
import { compositePartOf, shapeKindOf } from "./compositeShapes";
import { normalizeObjectMetadata } from "../provenance";
import {
  RELATION_TYPES,
  type AcuteObject,
  type AcuteRelation,
  type BaseObject,
  type ObjectMetadata,
  type RelationType,
  type RichBlockType,
  type StrokeStyle,
} from "../types";

/** Minimal structural view of an Excalidraw element (only fields we read). */
export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  locked: boolean;
  opacity: number;
  isDeleted: boolean;
  groupIds: readonly string[];
  frameId?: string | null;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness?: number;
  fillStyle?: string;
  link?: string | null;
  customData?: Record<string, unknown>;
  boundElements?: readonly { id: string; type: string }[] | null;
  // linear / freedraw
  points?: readonly (readonly [number, number])[];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  // text
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  containerId?: string | null;
  // image
  fileId?: string | null;
  scale?: readonly [number, number];
}

// ---------------------------------------------------------------------------
// Acute embeddable links. Rich blocks and page previews are hosted as
// Excalidraw embeddables whose `link` identifies the referenced document.
// ---------------------------------------------------------------------------

export const ACUTE_LINK_PREFIX = "acute://";

export interface ElementSize {
  width: number;
  height: number;
}

export type AcuteEmbedRef =
  | { kind: "rich-block"; blockType: RichBlockType; documentId: string; style: BlockStyle; href?: string }
  | {
      kind: "page-preview";
      pageId: string;
      /** Show the page content on the canvas (true) or a compact card (false). */
      preview: boolean;
      /** Size to restore when the preview mode is toggled back. */
      otherSize?: ElementSize;
    };

/** Stored form: `style` may be missing on blocks created before styles existed. */
export type StoredEmbedRef =
  | { kind: "rich-block"; blockType: RichBlockType; documentId: string; style?: BlockStyle }
  | { kind: "page-preview"; pageId: string; preview?: boolean; otherSize?: ElementSize };

function isSize(value: unknown): value is ElementSize {
  const s = value as Partial<ElementSize> | null;
  return !!s && typeof s === "object" && Number.isFinite(s.width) && Number.isFinite(s.height);
}

const RICH_BLOCK_TYPES: readonly RichBlockType[] = ["text", "todo", "table", "code"];

export function blockLink(documentId: string): string {
  return `${ACUTE_LINK_PREFIX}block/${documentId}`;
}

export function pageLink(pageId: string): string {
  return `${ACUTE_LINK_PREFIX}page/${pageId}`;
}

export function isAcuteLink(link: string | null | undefined): boolean {
  return typeof link === "string" && link.startsWith(ACUTE_LINK_PREFIX);
}

/** Reads the Acute embed reference stored on an embeddable element. */
export function getEmbedRef(el: Pick<SceneElement, "customData">): AcuteEmbedRef | null {
  const ref = el.customData?.acute as Partial<AcuteEmbedRef> | undefined;
  if (!ref || typeof ref !== "object") return null;
  if (ref.kind === "rich-block") {
    const r = ref as Partial<Extract<AcuteEmbedRef, { kind: "rich-block" }>>;
    if (typeof r.documentId === "string" && RICH_BLOCK_TYPES.includes(r.blockType as RichBlockType)) {
      return {
        kind: "rich-block",
        blockType: r.blockType as RichBlockType,
        documentId: r.documentId,
        style: normalizeBlockStyle(r.style, CARD_STYLE),
        ...(typeof r.href === "string" && r.href ? { href: r.href } : {}),
      };
    }
  }
  if (ref.kind === "page-preview") {
    const r = ref as Partial<Extract<AcuteEmbedRef, { kind: "page-preview" }>>;
    if (typeof r.pageId === "string") {
      return {
        kind: "page-preview",
        pageId: r.pageId,
        preview: r.preview === true,
        ...(isSize(r.otherSize) ? { otherSize: { width: r.otherSize.width, height: r.otherSize.height } } : {}),
      };
    }
  }
  return null;
}

/** Object-level metadata (tags, provenance) stored alongside the element. */
export function getObjectMetadata(el: Pick<SceneElement, "customData">): ObjectMetadata | undefined {
  return normalizeObjectMetadata(el.customData?.acuteMeta);
}

// ---------------------------------------------------------------------------
// Semantic relationships (F23). The type is arrow metadata (never visual);
// the endpoints are the arrow's own bindings, so a relation exists exactly
// while the arrow connects two live objects.
// ---------------------------------------------------------------------------

/** Relation type stored on an arrow, if any. */
export function getArrowRelation(el: Pick<SceneElement, "customData">): RelationType | undefined {
  const type = el.customData?.acuteRelation;
  return RELATION_TYPES.includes(type as RelationType) ? (type as RelationType) : undefined;
}

/**
 * `customData` with the relation type set (or removed with `undefined`).
 * A duplicated/pasted arrow keeps its type only when both its ends were copied with it (`keepsRelationOnCopy`).
 */
export function withRelation(
  customData: Record<string, unknown> | undefined,
  type: RelationType | undefined,
): Record<string, unknown> {
  const next = { ...customData };
  if (type) next.acuteRelation = type;
  else delete next.acuteRelation;
  return next;
}

/**
 * Whether a copied arrow (duplicate, paste) keeps its relation type: only when it connects two objects copied
 * together with it — a copied sub-diagram means the same thing between the copies. An arrow copied on its own,
 * or still bound to an original, would give a relation nobody drew, so its type is dropped. `copied` holds the
 * ids of every element the copy created.
 */
export function keepsRelationOnCopy(arrow: Pick<SceneElement, "startBinding" | "endBinding">, copied: ReadonlySet<string>): boolean {
  const from = arrow.startBinding?.elementId;
  const to = arrow.endBinding?.elementId;
  return !!from && !!to && copied.has(from) && copied.has(to);
}

/** Stable relation id for the arrow that carries it. */
export const relationIdFor = (arrowId: string) => `rel_${arrowId}`;

// ---------------------------------------------------------------------------
// Layout hint (F41): where Acute last placed an object. A layout hint, not
// provenance — it says where Acute put the object, not who created it — so
// local reflow can prefer moving what Acute placed over what the user placed.
// ---------------------------------------------------------------------------

/** True while the object is still where Acute last placed it (the user hasn't moved it since). */
export function isWhereAcutePlacedIt(el: Pick<SceneElement, "customData" | "x" | "y">): boolean {
  const at = el.customData?.acuteLayout as { x?: unknown; y?: unknown } | undefined;
  return typeof at?.x === "number" && typeof at.y === "number" && Math.abs(at.x - el.x) < 0.5 && Math.abs(at.y - el.y) < 0.5;
}

/** `customData` recording that Acute placed the object at `at`. */
export function withLayoutHint(customData: Record<string, unknown> | undefined, at: { x: number; y: number }): Record<string, unknown> {
  return { ...customData, acuteLayout: { x: at.x, y: at.y } };
}

/** Typed relations on the canvas: typed arrows bound at both ends to live objects. */
export function deriveRelations(elements: readonly SceneElement[]): AcuteRelation[] {
  const live = new Set(elements.filter((el) => !el.isDeleted).map((el) => el.id));
  const out: AcuteRelation[] = [];
  for (const el of elements) {
    if (el.isDeleted || el.type !== "arrow") continue;
    const type = getArrowRelation(el);
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!type || !from || !to || !live.has(from) || !live.has(to)) continue;
    out.push({ id: relationIdFor(el.id), from, to, type, arrowId: el.id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function base(el: SceneElement, zIndex: number): BaseObject {
  const metadata = getObjectMetadata(el);
  return {
    id: el.id,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.angle,
    locked: el.locked,
    opacity: el.opacity,
    zIndex,
    groupIds: [...el.groupIds],
    ...(metadata ? { metadata } : {}),
  };
}

function stroke(el: SceneElement): StrokeStyle {
  const s = el.strokeStyle;
  return {
    strokeColor: el.strokeColor,
    backgroundColor: el.backgroundColor,
    strokeWidth: el.strokeWidth,
    strokeStyle: s === "dashed" || s === "dotted" ? s : "solid",
  };
}

function points(el: SceneElement): [number, number][] {
  return (el.points ?? []).map(([x, y]) => [x, y]);
}

/**
 * Converts one scene element into a domain object. Returns `null` for deleted
 * elements and renderer-only element types (frames, non-Acute embeds, …).
 * `labels` maps container id → bound text, so shapes/arrows carry their label.
 */
export function toAcuteObject(
  el: SceneElement,
  zIndex: number,
  labels?: ReadonlyMap<string, string>,
): AcuteObject | null {
  if (el.isDeleted) return null;
  const b = base(el, zIndex);
  const label = labels?.get(el.id);

  const shape = shapeKindOf(el);
  if (shape) return { ...b, ...stroke(el), type: "shape", shape, ...(label ? { label } : {}) };
  // A composite shape's outline is part of its host shape, not an object of its own.
  if (compositePartOf(el)) return null;
  switch (el.type) {
    case "arrow":
      return {
        ...b,
        ...stroke(el),
        type: "arrow",
        points: points(el),
        ...(el.startBinding ? { startObjectId: el.startBinding.elementId } : {}),
        ...(el.endBinding ? { endObjectId: el.endBinding.elementId } : {}),
        startMarker: el.startArrowhead ?? null,
        endMarker: el.endArrowhead ?? null,
        ...(label ? { label } : {}),
        ...(getArrowRelation(el) ? { relation: getArrowRelation(el) } : {}),
      };
    case "line":
      return { ...b, ...stroke(el), type: "line", points: points(el) };
    case "freedraw":
      return { ...b, ...stroke(el), type: "draw", points: points(el) };
    case "text":
      return {
        ...b,
        type: "text",
        text: el.originalText ?? el.text ?? "",
        fontSize: el.fontSize ?? 20,
        fontFamily: el.fontFamily ?? 1,
        textAlign: el.textAlign ?? "left",
        color: el.strokeColor,
        ...(el.containerId ? { containerId: el.containerId } : {}),
      };
    case "image":
      if (!el.fileId) return null;
      return { ...b, type: "image", assetId: el.fileId, fit: "contain" };
    case "embeddable": {
      const ref = getEmbedRef(el);
      if (!ref) return null;
      if (ref.kind === "rich-block") {
        return { ...b, type: "rich-block", blockType: ref.blockType, documentId: ref.documentId, style: ref.style };
      }
      return { ...b, type: "page-preview", pageId: ref.pageId, preview: ref.preview };
    }
    default:
      return null;
  }
}

/** Converts a full scene (renderer order = z-order) into domain objects. */
export function sceneToAcuteObjects(elements: readonly SceneElement[]): AcuteObject[] {
  const labels = new Map<string, string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "text" && el.containerId) {
      labels.set(el.containerId, el.originalText ?? el.text ?? "");
    }
  }
  const out: AcuteObject[] = [];
  elements.forEach((el, index) => {
    const obj = toAcuteObject(el, index, labels);
    if (obj) out.push(obj);
  });
  return out;
}
