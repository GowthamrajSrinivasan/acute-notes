/**
 * Acute-Notes domain model (PRD §5).
 *
 * These types are renderer-agnostic: nothing here may import Excalidraw or
 * BlockNote. The canvas adapter (`domain/canvas/adapter.ts`) converts between
 * renderer elements and these objects; AI, MCP, search and export only ever
 * see `AcuteObject`s.
 */

export type ObjectId = string;
export type PageId = string;
export type DocumentId = string;
export type AssetId = string;
export type CanvasId = string;
export type WorkspaceId = string;
export type RelationId = string;

export const SCHEMA_VERSION = 1;

/**
 * Top of the hierarchy: Workspace → canvases (`CanvasDocument`) → pages.
 * `canvasIds` is the workspace's canvas order.
 */
export interface Workspace {
  id: WorkspaceId;
  name: string;
  canvasIds: CanvasId[];
  createdAt: number;
  updatedAt: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Where a document lives: its workspace and the canvas that owns
 * it. Every block and page belongs to exactly one canvas.
 */
export interface DocumentHome {
  workspaceId: WorkspaceId;
  canvasId: CanvasId;
}

/** A canvas inside a workspace. */
export interface CanvasDocument {
  id: CanvasId;
  workspaceId: WorkspaceId;
  title: string;
  viewport?: Viewport;
  createdAt: number;
  updatedAt: number;
}

export interface SourceRef {
  provider: string;
  externalId?: string;
  url?: string;
  lastSyncedAt?: number;
}

/**
 * Provenance (PRD §5.1, F25). Descriptive only: no behaviour may branch on
 * it. Every field is optional except `createdBy`; read it through
 * `domain/provenance.ts`, which validates and bounds it.
 */
export interface AIMetadata {
  createdBy: "user" | "ai" | "import" | "mcp";
  /** The AI task that produced the object, e.g. "summarize". */
  task?: string;
  /** Connection id actually used. */
  provider?: string;
  /** How that connection is paid for / signed in to. */
  authType?: "subscription" | "api_key" | "oauth" | "local";
  model?: string;
  /** One AI transaction (F19): every object an accepted change set created shares it. */
  operationId?: string;
  /** VisualPlan template, when produced by Visualize (F30). */
  template?: string;
  /** VisualNode.id this object was rendered from (plan-local, per run; F30). */
  visualPlanNodeId?: string;
  /** External records the object was derived from (imports, MCP sources). */
  sourceRefs?: SourceRef[];

  // Reconciliation (F37–F39, PRD §5.1, §13.15.18–§13.15.22) — set only on objects created/updated by Visualize.
  // The one deliberate exception to "descriptive only": read by the reconciliation engine (F38) and nothing else
  // (`provenanceGuard.test.ts`). `normalizeAIMetadata` drops them unless asked, so export, MCP and search never see them.
  /** Which ContentSource this object was derived from. */
  contentSourceId?: ContentSourceId;
  /** ContentSourceVersion.version at the last AI write. */
  contentSourceVersion?: number;
  /** Identity stable across regenerations (unlike `visualPlanNodeId`, comparable run to run). */
  stableNodeKey?: string;
  /** Hash of this object's content as AI last wrote it — the reconciliation baseline (`ai/content/fingerprint.ts`). */
  contentFingerprint?: string;
  /** Derived by comparing current content to `contentFingerprint`; never stored or trusted as stored. */
  modificationState?: "ai_clean" | "user_modified";
  /** The user opted this object out of future AI updates (F39). */
  excludeFromReconciliation?: boolean;
  /**
   * A piece of a dense block the user split (F42 Phase 4): the `stableNodeKey` of the node the split block showed.
   * While any piece of it is on the canvas, "Update from new content" keeps the split instead of bringing the
   * original block back.
   */
  splitOf?: string;
  /** With `splitOf`: the split node's `contentFingerprint` as the source gave it when it was split. */
  splitFingerprint?: string;
}

export type ContentSourceId = string;

/**
 * The user's pasted/imported input a Visualize run was based on (F37). Append-only
 * versions; not a general document-history feature (§13.15.19). Device-local,
 * like AI conversations: never in workspace documents, Yjs state or exports.
 */
export interface ContentSource {
  id: ContentSourceId;
  workspaceId: WorkspaceId;
  canvasId: CanvasId;
  origin: "paste" | "import" | "mcp";
  /**
   * How its plans are produced, fixed at the first run so later versions stay
   * comparable: the local tier (deterministic, re-planned in full), or AI with
   * one template (re-analysed per changed section only).
   */
  tier: "local" | "ai";
  template: string;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface ContentSourceVersion {
  sourceId: ContentSourceId;
  /** 1, 2, 3, … append-only. */
  version: number;
  /** Raw pasted/imported text for this version (plain text, never editor/canvas state). */
  text: string;
  /** The validated VisualPlan accepted for this version — the previous proposal a later run compares against. */
  plan: unknown;
  /**
   * Topic identity (G1): heading paths of `text` that stand for an earlier path, because their section was renamed.
   * The plan's keys are built from the id, so a renamed section keeps its objects. Absent when every path is its own id.
   */
  pathIds?: Record<string, string>;
  /**
   * Where `text` changes its mind (G3.3): in section `unit`, `later` replaces `earlier` (both as the text has them). The earlier
   * statement is left out of what is drawn, and kept on the section's "Changed over time" page. Absent when there are none.
   */
  revisions?: { unit: string; earlier: string; later: string }[];
  createdAt: number;
}

export interface ObjectMetadata {
  title?: string;
  tags?: string[];
  source?: SourceRef;
  ai?: AIMetadata;
}

export interface BaseObject {
  id: ObjectId;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  opacity: number;
  /** Stacking order; derived from the renderer's fractional index order. */
  zIndex: number;
  groupIds: string[];
  metadata?: ObjectMetadata;
}

/** Visual style shared by drawn objects. Values are renderer-neutral strings. */
export interface StrokeStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
}

/** Native Excalidraw shapes, plus composite ones drawn from native parts (`domain/canvas/compositeShapes.ts`). */
export type ShapeKind = "rectangle" | "diamond" | "ellipse" | "cylinder" | "hexagon" | "parallelogram" | "trapezoid" | "document" | "subroutine";

export interface ShapeObject extends BaseObject, StrokeStyle {
  type: "shape";
  shape: ShapeKind;
  /** Plain-text label bound inside the shape, if any. */
  label?: string;
}

export interface ArrowObject extends BaseObject, StrokeStyle {
  type: "arrow";
  points: [number, number][];
  startObjectId?: ObjectId;
  endObjectId?: ObjectId;
  startMarker: string | null;
  endMarker: string | null;
  label?: string;
  /** Optional semantic meaning (F23); never changes how the arrow looks. */
  relation?: RelationType;
}

export interface LineObject extends BaseObject, StrokeStyle {
  type: "line";
  points: [number, number][];
}

export interface DrawObject extends BaseObject, StrokeStyle {
  type: "draw";
  points: [number, number][];
}

export interface SimpleTextObject extends BaseObject {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: number;
  textAlign: string;
  color: string;
  /** Set when the text is a label bound to a shape/arrow. */
  containerId?: ObjectId;
}

export interface ImageObject extends BaseObject {
  type: "image";
  assetId: AssetId;
  fit: "contain" | "cover";
}

export type RichBlockType = "text" | "todo" | "table" | "code";

export interface RichBlockObject extends BaseObject {
  type: "rich-block";
  blockType: RichBlockType;
  documentId: DocumentId;
  /** Frame, font, size, alignment and colour (see content/blockStyle.ts). */
  style: import("./content/blockStyle").BlockStyle;
}

export interface PagePreviewObject extends BaseObject {
  type: "page-preview";
  pageId: PageId;
  /** true: the page's content is shown on the canvas; false: a compact card. */
  preview: boolean;
}

export type AcuteObject =
  | ShapeObject
  | ArrowObject
  | LineObject
  | DrawObject
  | SimpleTextObject
  | ImageObject
  | RichBlockObject
  | PagePreviewObject;

export type AcuteObjectType = AcuteObject["type"];

export const RELATION_TYPES = [
  "relates_to",
  /** From a step to the one that follows it: a sequence, a process, a state transition. */
  "flows_to",
  "caused_by",
  "depends_on",
  "supports",
  "blocks",
  "implements",
  "derived_from",
  "references",
  /** From a concept to a child explanation of it (more detail, kept out of the concept itself). */
  "explained_by",
  /** From a later decision to the earlier one it replaces for good (plan D26). */
  "supersedes",
  /** From a decision to the decision or constraint it makes a documented exception to, here only (plan D45). */
  "deviates_from",
  /** From a "Needs your call" box to one of its options: sources disagree and the user hasn't chosen yet (G3, choices). */
  "option_of",
  // Acute Lens's architecture vocabulary (plan D9, Phase 2): what code does to code, for trace, impact and AI context.
  /** A caller to what it calls (a function, an endpoint, a service). */
  "calls",
  /** Code to the store it reads from. */
  "reads",
  /** Code to the store it writes to. */
  "writes",
  /** A producer to the event or topic it publishes. */
  "publishes",
  /** A consumer to the event or topic it subscribes to. */
  "subscribes",
  /** A container to what it contains (a module to its component, a milestone to its items). */
  "contains",
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

/**
 * A typed relationship between two objects. In the MVP every relation is an
 * arrow bound at both ends whose type is stored on the arrow, so relations
 * are derived (see `deriveRelations`) and can never dangle.
 */
export interface AcuteRelation {
  id: RelationId;
  from: ObjectId;
  to: ObjectId;
  type: RelationType;
  /** The arrow that visually represents this relation, if any. */
  arrowId?: ObjectId;
}

/**
 * Metadata for a rich document (a canvas rich block's content or a page).
 * The full editable state lives in its own Y.Doc; `snapshot` is a cached,
 * renderer-independent copy used for previews, search, AI context and export
 * so that inactive blocks never need an editor instance.
 */
export interface DocumentRecord {
  id: DocumentId;
  workspaceId: WorkspaceId;
  kind: "block" | "page";
  /**
   * The canvas that owns this block or page. Optional only for
   * records written before canvases existed; assigned when the workspace opens.
   */
  canvasId?: CanvasId;
  title: string;
  snapshot: RichContent;
  createdAt: number;
  updatedAt: number;
  metadata?: ObjectMetadata;
}

/** A page is a document record of kind "page". PageId === DocumentId. */
export type PageDocument = DocumentRecord & { kind: "page" };

// ---------------------------------------------------------------------------
// Renderer-independent rich content (a minimal subset of BlockNote's JSON).
// ---------------------------------------------------------------------------

export interface InlineStyles {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  code?: true;
  /** BlockNote colour name ("red", "blue", …) or "default". */
  textColor?: string;
  backgroundColor?: string;
  /** Inline font (a `BlockFontId`) and size (scene px as a number string). */
  fontFamily?: string;
  fontSize?: string;
}

export type InlineContent =
  | { type: "text"; text: string; styles: InlineStyles }
  | { type: "link"; href: string; content: { type: "text"; text: string; styles: InlineStyles }[] };

/** A table cell as BlockNote emits it (object form) or accepts it (string/array form). */
export type TableCell = string | InlineContent[] | { type: "tableCell"; content: InlineContent[]; props?: Record<string, unknown> };

export interface TableContent {
  type: "tableContent";
  headerRows?: number;
  columnWidths?: (number | null | undefined)[];
  rows: { cells: TableCell[] }[];
}

export type ContentBlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "codeBlock"
  | "table"
  // Page-editor blocks (Notion-style); also renderable anywhere content is shown.
  | "quote"
  | "toggleListItem"
  | "divider"
  /** Pages only; `props.url` is usually an `acute-asset://` URL (see domain/content/assetUrl.ts). */
  | "image";

/**
 * Mirrors BlockNote's block JSON so snapshots can be stored as-is. `id` and
 * `props` may be omitted in templates; plain strings are accepted as content.
 */
export interface ContentBlock {
  id?: string;
  type: ContentBlockType;
  props?: Record<string, string | number | boolean>;
  content?: string | InlineContent[] | TableContent;
  children?: ContentBlock[];
}

export type RichContent = ContentBlock[];
