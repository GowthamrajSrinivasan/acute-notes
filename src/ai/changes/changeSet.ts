/**
 * AI change sets (F19): what an AI operation proposes to do to a canvas,
 * declared as data before anything touches the scene.
 *
 * A change set is reviewed first (ghosted on the canvas), and only an
 * accepted one is written — as one transaction and one undo step. It can
 * only add: create blocks and shapes, connect objects, move existing ones.
 * There is no delete or overwrite operation, so an AI operation can never
 * silently remove or replace existing content.
 *
 * Renderer-agnostic: nothing here imports Excalidraw or BlockNote. Every
 * producer (Ask AI Insert today, the Visualize renderer and MCP tools later)
 * builds one of these and passes it through `parseChangeSet`.
 */
import type { DiagramCard, NodeSemantics } from "@/domain/canvas/diagram";
import { confidenceSchema, diagramCardsSchema, explanationSchema, nodeSemanticsSchema } from "@/domain/canvas/diagramSchema";
import { LENS_LIMITS, LENS_MAX_LEVEL, NODE_KINDS } from "@/domain/canvas/diagram";
import { DIAGRAM_LIMITS } from "@/domain/canvas/diagramSchema";
import type { NodePatch } from "@/domain/canvas/nodePatch";
import {
  ANNOTATION_INTENTS, DECISION_STATUSES, FINDING_NOTES, FINDING_STAGES, PROGRESS_STATUSES, PROJECT_KINDS, PROJECT_LIMITS, PROJECT_STYLES, QUESTION_STATUSES, RISK_SEVERITIES,
} from "@/domain/canvas/nodeProject";
import { analysisReportSchema, type AnalysisReport } from "@/ai/fidelity/analysis";
import { fidelityReportSchema, type FidelityReport } from "@/ai/fidelity/report";
import { z } from "zod";
import { normalizeAIMetadata } from "@/domain/provenance";
import { PLAN_SHAPES } from "@/ai/visual-plan/types";
import { RELATION_TYPES, type AIMetadata, type ContentBlockType, type ObjectId, type RelationType, type RichBlockType, type RichContent, type ShapeKind, type SourceRef } from "@/domain/types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An object a connection points at: already on the canvas, or created by this change set. */
export type ChangeTarget = { existing: ObjectId } | { created: string };

export type ProposedChange =
  | {
      kind: "create_block";
      key: string;
      blockType: RichBlockType;
      content: RichContent;
      box: Box;
      /** "none": frameless, like plain canvas text (F30 renders `heading` nodes this way). Defaults to "card" (a bordered block), F19's original look. */
      frame?: "card" | "none";
      /** Overrides the block's default font size (F30's "importance may map to size/emphasis", never a color). */
      fontSize?: number;
      /** Frameless text only: alignment across its box (F42 centres section and document titles). */
      textAlign?: "left" | "center" | "right";
      /** Cards only: fill colour (a canvas colour); default white. Set from AI settings → Response styling. */
      backgroundColor?: string;
      /**
       * Cards only: its title is an ordinary label, so Response styling's title background (the accent) is not
       * applied — the accent is kept for what matters: analysis and high-importance cards, sections, the document
       * (content fidelity Wave C). Its font and colour still apply.
       */
      plainTitle?: true;
      /** Links the object to the change set's `contentSource` (F37); set by Visualize only. */
      stableNodeKey?: string;
      /** External records the object is derived from (F43: a repo path at a commit), stamped into its provenance. */
      sourceRefs?: SourceRef[];
      /** A card's architecture kind (Lens Phase 2: a Repo Map node's `kind`), in its `acuteNode`. */
      semantics?: NodeSemantics;
    }
  | {
      kind: "create_shape";
      key: string;
      shape: ShapeKind;
      label?: string;
      backgroundColor?: string;
      box: Box;
      stableNodeKey?: string;
      sourceRefs?: SourceRef[];
      /** An architecture component's kind, sublabel, tag and details (interactive architecture frames); the kind sets its colours. */
      semantics?: NodeSemantics;
      /** A project-knowledge node's fields (D33), validated against `semantics.kind` like any other writer's (Phase 7B tools). */
      project?: NodePatch;
      /**
       * The node's Lens key (D13), assigned by the tool that builds the set — never taken from agent input — so refs to
       * it resolve from the moment it exists (D53). Unique among the canvas's keys when built.
       */
      lensKey?: string;
      /** A sub-topic's backdrop: an empty outline drawn behind the objects it groups (never content: no key, no label, not reconciled). */
      backdrop?: true;
    }
  | { kind: "create_page"; key: string; title: string; content: RichContent; box: Box; stableNodeKey?: string; sourceRefs?: SourceRef[] }
  /** A titled frame (F42's sections) holding objects created by this same change set (`children`: their keys). */
  | {
      kind: "create_frame";
      key: string;
      title: string;
      box: Box;
      children: string[];
      /** What the section says at a glance — its title and takeaway — shown over the frame when zoomed out (Wave D). */
      overview?: { title: string; takeaway?: string };
      /** The frame is an interactive architecture diagram, with these read-only info cards under it. */
      diagram?: { cards?: DiagramCard[] };
      /** Its Lens profile (`project`: the Project state frame of a template, setup plan Part B). Implies `diagram`. */
      profile?: "project";
      /** Its Lens level (Phase 2: a Repo Map section's `level`). */
      level?: number;
    }
  /**
   * Objects this set creates (`add`: their keys) join an existing section's frame (F42 Phase 3, "Update from new
   * content"); the frame grows to fit them. `section` is the section's title, for the review row. `name` renames
   * the frame (a section whose label changed, F43); `add` may then be empty.
   */
  | { kind: "update_frame"; target: ObjectId; add: string[]; section?: string; name?: string }
  | {
      kind: "connect";
      key: string;
      from: ChangeTarget;
      to: ChangeTarget;
      label?: string;
      relation?: RelationType;
      /** "elbow" (default): a right-angle route around objects; "straight": Excalidraw's straight arrow. */
      routing?: "elbow" | "straight";
      /** Why the connection exists, shown when it's inspected in a diagram frame. */
      explanation?: string;
      /** How sure the model was that it exists (0–1), when an AI plan said (Lens plan §6.3). */
      confidence?: number;
    }
  | { kind: "move"; target: ObjectId; to: { x: number; y: number } }
  // Reconciliation only (F38/F39): produced by "Update from new content", never by a first run, and — like
  // everything here — applied only on Accept, as part of one undoable transaction.
  /**
   * New content for an existing block or page preview (re-pointed at a fresh document, so undo restores the old one).
   * Also an MCP edit (F21): with no `contentSource` on the set and no `stableNodeKey`, the object keeps its own
   * provenance and reconciliation link, so the accepted edit counts as the user's.
   */
  | { kind: "update_block"; target: ObjectId; content: RichContent; title?: string; stableNodeKey?: string; sourceRefs?: SourceRef[] }
  /** A new label for an existing shape. */
  | { kind: "update_shape"; target: ObjectId; label: string; stableNodeKey: string; sourceRefs?: SourceRef[] }
  /**
   * Patches the descriptive and project-knowledge fields of an existing node (D43): a provided field replaces, `null`
   * clears, omitted is untouched. Never touches the Lens half (key, expandsTo, sources). Reviewed like any change.
   */
  | { kind: "update_node"; target: ObjectId; semantics: NodePatch }
  /**
   * Sets an existing node's or frame's Lens fields (D43; MCP `link_lens_detail`): a node's `expandsTo` ("zooming into
   * me shows that frame"), a frame's `level`. A provided field replaces, `null` clears, omitted is untouched. The one
   * reviewed door for Lens fields: AI and MCP input can't set them any other way (Phase 0.1).
   */
  | { kind: "set_lens"; target: ObjectId; level?: number | null; expandsTo?: { frameKey: string; canvasId?: string } | null }
  /** Removes an object whose node no longer appears in the new content. */
  | { kind: "remove"; target: ObjectId }
  /** "Keep mine": the object's current content becomes its new baseline; nothing visible changes. */
  | { kind: "rebaseline"; target: ObjectId; stableNodeKey: string }
  /**
   * Resets an element to a stored snapshot, or re-creates it from one when it was deleted, keeping its id and its
   * bindings (D43). Produced only by a revert (`revert_agent_changes`, the History tab's "Revert…"), from the
   * before-state Agent State recorded when the change was accepted (D30). `element.id` is `target`.
   */
  | { kind: "restore"; target: ObjectId; element: StoredElementSnapshot }
  /**
   * Changes an existing connection (Phase 7C, D50): its relation type (and so its line style), its label, its
   * explanation. A provided field replaces, `null` clears, omitted is untouched.
   */
  | { kind: "update_connection"; target: ObjectId; relation?: RelationType | null; label?: string | null; explanation?: string | null }
  /**
   * Puts existing objects in a new titled frame around them (Phase 7C's `group_blocks`, D50). Frames can't nest, so
   * an object already in a frame can't join one; arrows and frames aren't grouped.
   */
  | { kind: "group_objects"; key: string; title: string; targets: ObjectId[] };

/** An element as it was, field for field (Excalidraw's own shape), stored by Agent State to restore it (D30, D43). */
export type StoredElementSnapshot = Record<string, unknown> & { id: string; type: string };

export type ProposedChangeKind = ProposedChange["kind"];

export interface ChangeSet {
  /** One AI operation; stamped on every object it creates (`metadata.ai.operationId`). */
  operationId: string;
  /** What produced it, shown in the review bar ("Summary", "Visualize: …"). */
  title: string;
  /** Provenance for created objects. */
  metadata: AIMetadata & { createdBy: Exclude<AIMetadata["createdBy"], "user"> };
  changes: ProposedChange[];
  /** The content version this set comes from (F37); recorded on Accept, never before. */
  contentSource?: ContentSourceRecord;
  /**
   * A split of one dense block (F42 Phase 4): the objects the set creates are pieces of node `of` of content
   * source `sourceId`, linked to it at the version the block was at — no new content version is recorded — so an
   * update keeps the split (`reconcile`'s `splits`). Never together with `contentSource`.
   */
  split?: SplitRecord;
  /**
   * Updates to objects the user has edited since AI last wrote them (F39).
   * Never part of `changes` and never applied by "Accept all": each needs its
   * own decision — its `apply` or its `keep` change joins the accepted set.
   */
  conflicts?: ConflictItem[];
  /**
   * A merged set (F43's mapping session): the set is made of parts — one per section, in arrival order — each
   * its own run of `changes` and `conflicts` (by count, in order) with its own content version. Reviewed and
   * accepted whole or part by part (`parts.ts`). A set with parts has no top-level `contentSource`.
   */
  parts?: ChangeSetPart[];
  /** Proposals with the same merge key merge into this set instead of being refused (`PendingChanges.merge`). */
  mergeKey?: string;
  /**
   * The producer's session (F43: what "auto-accept this session" applies to). Pending sets are kept one per session
   * per canvas (D40); a set with none is the in-app session `"app"`.
   */
  session?: string;
  /** The MCP client's name, as the client reports it (D32, D61): attribution, never a verified identity. */
  agent?: string;
  /** Why the producer proposed it (D32), one line; required on Project-profile writes (Phase 7B). */
  reason?: string;
  /** A bounded, redacted summary of the tool input that produced it (D46), for the change log. */
  args?: string;
  /** A revert (D30): the change-log records it undoes; accepting it marks them reverted. */
  reverts?: string[];
  /** AI Visualize: how much of the source the AI placed, and what the safety net added (the review's coverage row). */
  fidelity?: FidelityReport;
  /** AI Visualize: whether AI analysed the content or only its own structure is shown, and which sections fell back. */
  analysis?: AnalysisReport;
}

/** One section of a merged set (see `ChangeSet.parts`). */
export interface ChangeSetPart {
  key: string;
  /** The section's name in the review. */
  title: string;
  /** How many of the set's `changes`, after the previous parts', are this part's. */
  changes: number;
  /** Likewise for `conflicts`. */
  conflicts: number;
  contentSource?: ContentSourceRecord;
}

export interface SplitRecord {
  sourceId: string;
  version: number;
  /** The `stableNodeKey` of the node the split block showed. */
  of: string;
  /** That block's `contentFingerprint` (as the source gave it) when it was split. */
  fingerprint: string;
}

export interface ContentSourceRecord {
  sourceId: string;
  version: number;
  origin: "paste" | "import" | "mcp";
  tier: "local" | "ai";
  template: string;
  text: string;
  plan: unknown;
  /** Topic identity (G1, `ContentSourceVersion.pathIds`): set by "Update from new content" when a section was renamed. */
  pathIds?: Record<string, string>;
  /** Where the text changes its mind (G3.3, `ContentSourceVersion.revisions`). */
  revisions?: { unit: string; earlier: string; later: string }[];
}

/**
 * A change to an object the user has edited since (F39): never applied without a decision. A reconciliation conflict
 * (an update from new content) offers `apply` or `keep` ("Keep mine" rebaselines); a revert conflict (D30: the
 * element changed after the agent's change) offers `apply` (restore or remove it anyway), and keeping it adds
 * nothing (`keep` is absent).
 */
export interface ConflictItem {
  target: ObjectId;
  /** Reconciliation conflicts only. */
  stableNodeKey?: string;
  apply: Extract<ProposedChange, { kind: "update_block" | "update_shape" | "restore" | "remove" }>;
  keep?: Extract<ProposedChange, { kind: "rebaseline" }>;
  /** What the card is called when the change itself can't say (a revert's object). */
  name?: string;
  /** Revert conflicts only: changes decided with `apply` as one card (a shape's restore with its bound label's). */
  alsoApply?: Extract<ProposedChange, { kind: "restore" | "remove" }>[];
}

export const MAX_CHANGES = 500;
/** A restore's snapshot, as JSON, at most this many characters (Agent State caps what it stores the same way). */
export const MAX_SNAPSHOT_CHARS = 200_000;
/** `ChangeSet.args`, at most (D46). */
export const MAX_ARGS_CHARS = 2_048;
/** A merged set (F43: a whole repo map staged section by section) may be larger; each producer's own set stays within `MAX_CHANGES`. */
export const MAX_MERGED_CHANGES = 6_000;
const MAX_LABEL = 2000;
const MAX_SIZE = 20_000;

const CONTENT_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "codeBlock",
  "table",
  "quote",
  "toggleListItem",
  "divider",
] as const satisfies readonly ContentBlockType[];

const finite = z.number().finite();
const size = z.number().finite().positive().max(MAX_SIZE);
const box = z.object({ x: finite, y: finite, width: size, height: size });
const key = z.string().min(1).max(200);
const target = z.union([z.object({ existing: z.string().min(1) }).strict(), z.object({ created: key }).strict()]);
const contentBlock = z.looseObject({ type: z.enum(CONTENT_BLOCK_TYPES) });
const stableKey = z.string().min(1).max(300);
const sourceRefs = z.array(z.object({ provider: z.string().min(1).max(200), externalId: z.string().max(500).optional(), url: z.string().max(2048).optional() })).max(20);
const updateBlockSchema = z.object({
  kind: z.literal("update_block"),
  target: z.string().min(1),
  content: z.array(contentBlock).min(1),
  title: z.string().min(1).max(200).optional(),
  stableNodeKey: stableKey.optional(),
  sourceRefs: sourceRefs.optional(),
});
const updateShapeSchema = z.object({ kind: z.literal("update_shape"), target: z.string().min(1), label: z.string().max(MAX_LABEL), stableNodeKey: stableKey, sourceRefs: sourceRefs.optional() });
/** One patch field: absent = untouched, null = clear, a bad value drops that field only. Unknown keys (the Lens half) are stripped. */
const patchField = <T extends z.ZodType>(schema: T) => schema.nullable().optional().catch(undefined);
const patchText = (max: number) => patchField(z.string().trim().min(1).max(max));
const nodePatchSchema = z.object({
  kind: patchField(z.enum([...NODE_KINDS, ...PROJECT_KINDS])),
  sublabel: patchText(DIAGRAM_LIMITS.sublabel),
  tag: patchText(DIAGRAM_LIMITS.tag),
  details: patchField(z.array(z.string().trim().min(1).max(DIAGRAM_LIMITS.detail)).max(DIAGRAM_LIMITS.details)),
  project: patchText(PROJECT_LIMITS.key),
  refs: patchField(z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(PROJECT_LIMITS.refs)),
  style: patchField(z.enum(PROJECT_STYLES)),
  focus: patchText(PROJECT_LIMITS.focus),
  status: patchField(z.enum([...DECISION_STATUSES, ...PROGRESS_STATUSES, ...QUESTION_STATUSES])),
  reason: patchText(PROJECT_LIMITS.reason),
  options: patchField(z.array(z.object({ label: z.string().trim().min(1).max(PROJECT_LIMITS.optionLabel), tradeoffs: z.string().max(PROJECT_LIMITS.tradeoffs).optional().catch(undefined) })).max(PROJECT_LIMITS.options)),
  chosen: patchText(PROJECT_LIMITS.optionLabel),
  enforce: patchField(z.boolean()),
  supersedes: patchField(z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(PROJECT_LIMITS.refs)),
  deviatesFrom: patchField(z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(PROJECT_LIMITS.refs)),
  stage: patchField(z.enum(FINDING_STAGES)),
  note: patchField(z.enum(FINDING_NOTES)),
  answer: patchText(PROJECT_LIMITS.answer),
  severity: patchField(z.enum(RISK_SEVERITIES)),
  order: patchField(z.number().finite().min(0).max(PROJECT_LIMITS.order)),
  next: patchField(z.boolean()),
  intent: patchField(z.enum(ANNOTATION_INTENTS)),
});
const rebaselineSchema = z.object({ kind: z.literal("rebaseline"), target: z.string().min(1), stableNodeKey: stableKey });
const removeSchema = z.object({ kind: z.literal("remove"), target: z.string().min(1) });
const restoreSchema = z
  .object({ kind: z.literal("restore"), target: z.string().min(1), element: z.looseObject({ id: z.string().min(1), type: z.string().min(1) }) })
  .refine((c) => c.element.id === c.target, { message: "a restore's element is its target" })
  .refine((c) => JSON.stringify(c.element).length <= MAX_SNAPSHOT_CHARS, { message: `a restore's element is at most ${MAX_SNAPSHOT_CHARS} characters` });

const changeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_block"),
    key,
    blockType: z.enum(["text", "todo", "table", "code"]),
    content: z.array(contentBlock).min(1),
    box,
    frame: z.enum(["card", "none"]).optional(),
    fontSize: z.number().finite().positive().max(200).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    backgroundColor: z.string().max(64).optional(),
    plainTitle: z.literal(true).optional(),
    stableNodeKey: stableKey.optional(),
    sourceRefs: sourceRefs.optional(),
    semantics: nodeSemanticsSchema.optional(),
  }),
  z.object({
    kind: z.literal("create_frame"),
    key,
    title: z.string().max(200),
    box,
    children: z.array(key).max(MAX_CHANGES),
    overview: z.object({ title: z.string().min(1).max(200), takeaway: z.string().min(1).max(300).optional() }).optional(),
    diagram: z.object({ cards: diagramCardsSchema }).optional(),
    profile: z.literal("project").optional(),
    level: z.number().int().min(0).max(5).optional(),
  }),
  z
    .object({ kind: z.literal("update_frame"), target: z.string().min(1), add: z.array(key).max(MAX_CHANGES), section: z.string().max(200).optional(), name: z.string().min(1).max(200).optional() })
    .refine((c) => c.add.length > 0 || c.name !== undefined, { message: "update_frame needs objects to add or a new name" }),
  z.object({
    kind: z.literal("create_shape"),
    key,
    shape: z.enum(PLAN_SHAPES),
    label: z.string().max(MAX_LABEL).optional(),
    backgroundColor: z.string().max(64).optional(),
    box,
    stableNodeKey: stableKey.optional(),
    sourceRefs: sourceRefs.optional(),
    semantics: nodeSemanticsSchema.optional(),
    project: nodePatchSchema.optional(),
    lensKey: z.string().trim().min(1).max(PROJECT_LIMITS.key).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
  }),
  z.object({
    kind: z.literal("create_page"),
    key,
    title: z.string().min(1).max(200),
    content: z.array(contentBlock).min(1),
    box,
    stableNodeKey: stableKey.optional(),
    sourceRefs: sourceRefs.optional(),
  }),
  z.object({
    kind: z.literal("connect"),
    key,
    from: target,
    to: target,
    label: z.string().max(MAX_LABEL).optional(),
    relation: z.enum(RELATION_TYPES).optional(),
    routing: z.enum(["elbow", "straight"]).optional(),
    explanation: explanationSchema,
    confidence: confidenceSchema,
  }),
  z.object({ kind: z.literal("move"), target: z.string().min(1), to: z.object({ x: finite, y: finite }) }),
  updateBlockSchema,
  updateShapeSchema,
  removeSchema,
  rebaselineSchema,
  z.object({ kind: z.literal("update_node"), target: z.string().min(1), semantics: nodePatchSchema }),
  z
    .object({
      kind: z.literal("set_lens"),
      target: z.string().min(1),
      level: z.number().int().min(0).max(LENS_MAX_LEVEL).nullable().optional(),
      expandsTo: z.object({ frameKey: z.string().trim().min(1).max(LENS_LIMITS.key), canvasId: z.string().trim().min(1).max(LENS_LIMITS.key).optional() }).strict().nullable().optional(),
    })
    .refine((c) => c.level !== undefined || c.expandsTo !== undefined, { message: "set_lens needs a level or expandsTo" }),
  restoreSchema,
  z
    .object({
      kind: z.literal("update_connection"),
      target: z.string().min(1),
      relation: z.enum(RELATION_TYPES).nullable().optional(),
      label: z.string().trim().max(MAX_LABEL).nullable().optional(),
      explanation: z.string().trim().max(300).nullable().optional(),
    })
    .refine((c) => c.relation !== undefined || c.label !== undefined || c.explanation !== undefined, { message: "update_connection needs something to change" }),
  z.object({ kind: z.literal("group_objects"), key, title: z.string().trim().min(1).max(200), targets: z.array(z.string().min(1)).min(1).max(MAX_CHANGES) }),
]);

const contentSourceSchema = z.object({
  sourceId: z.string().min(1).max(200),
  version: z.number().int().positive(),
  origin: z.enum(["paste", "import", "mcp"]),
  tier: z.enum(["local", "ai"]),
  template: z.string().min(1).max(100),
  text: z.string().max(200_000),
  plan: z.unknown(),
  pathIds: z.record(z.string().max(2000), z.string().max(2000)).optional(),
  revisions: z.array(z.object({ unit: z.string().max(2000), earlier: z.string().max(20_000), later: z.string().max(20_000) })).max(500).optional(),
});

const changeSetSchema = z.object({
  operationId: z.string().min(1),
  title: z.string().min(1).max(200),
  metadata: z.looseObject({
    createdBy: z.enum(["ai", "import", "mcp"]),
    task: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  }),
  changes: z.array(changeSchema).max(MAX_MERGED_CHANGES),
  // The one content-source schema, as parts use it: a copy here once dropped `pathIds` (G1) and `revisions` (G3.3) from every
  // accepted Visualize and update, silently — zod strips the fields a schema doesn't name.
  contentSource: contentSourceSchema.optional(),
  split: z.object({ sourceId: z.string().min(1).max(200), version: z.number().int().positive(), of: stableKey, fingerprint: z.string().min(1).max(300) }).optional(),
  conflicts: z
    .array(
      z.object({
        target: z.string().min(1),
        stableNodeKey: stableKey.optional(),
        apply: z.union([updateBlockSchema, updateShapeSchema, restoreSchema, removeSchema]),
        keep: rebaselineSchema.optional(),
        name: z.string().max(200).optional(),
        alsoApply: z.array(z.union([restoreSchema, removeSchema])).max(10).optional(),
      }),
    )
    .max(MAX_MERGED_CHANGES)
    .optional(),
  parts: z
    .array(
      z.object({
        key: z.string().min(1).max(300),
        title: z.string().max(200),
        changes: z.number().int().nonnegative(),
        conflicts: z.number().int().nonnegative(),
        contentSource: contentSourceSchema.optional(),
      }),
    )
    .max(MAX_CHANGES)
    .optional(),
  mergeKey: z.string().min(1).max(300).optional(),
  session: z.string().min(1).max(200).optional(),
  agent: z.string().min(1).max(40).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  args: z.string().max(MAX_ARGS_CHARS).optional(),
  reverts: z.array(z.string().min(1).max(200)).max(MAX_CHANGES).optional(),
  fidelity: fidelityReportSchema.optional(),
  analysis: analysisReportSchema.optional(),
}).refine((s) => s.changes.length > 0 || (s.conflicts?.length ?? 0) > 0, { message: "A change set needs at least one change or conflict", path: ["changes"] });

export class InvalidChangeSetError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid change set: ${problems.join("; ")}`);
    this.name = "InvalidChangeSetError";
  }
}

/**
 * Validates untrusted input (a producer's output, an MCP tool call) into a
 * `ChangeSet`: shape, sizes, and references between its own changes. Throws
 * `InvalidChangeSetError` listing every problem; nothing partial is returned.
 * References to existing objects are checked later, at review and accept
 * time (`resolveChangeSet`), because the canvas keeps changing meanwhile.
 *
 * `externalKeys`: keys of objects other parts of a merged set create (F43), which a part about to be merged may
 * connect to.
 */
export function parseChangeSet(input: unknown, options: { externalKeys?: ReadonlySet<string> } = {}): ChangeSet {
  const parsed = changeSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidChangeSetError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const set = parsed.data as unknown as ChangeSet;
  if (!set.parts) {
    if (set.changes.length > MAX_CHANGES) throw new InvalidChangeSetError([`changes: Too big: expected array to have <=${MAX_CHANGES} items`]);
    if ((set.conflicts?.length ?? 0) > MAX_CHANGES) throw new InvalidChangeSetError([`conflicts: Too big: expected array to have <=${MAX_CHANGES} items`]);
  }
  const problems: string[] = [];
  const objects = new Set<string>();
  const keys = new Set<string>();
  const moved = new Set<string>();
  const touched = new Set<string>();
  set.changes.forEach((c, i) => {
    if (c.kind === "move") {
      if (moved.has(c.target)) problems.push(`changes.${i}: "${c.target}" is moved twice`);
      moved.add(c.target);
      return;
    }
    if (!("key" in c)) {
      // Reconciliation changes: at most one per existing object.
      if (touched.has(c.target)) problems.push(`changes.${i}: "${c.target}" is changed twice`);
      touched.add(c.target);
      return;
    }
    if (keys.has(c.key)) problems.push(`changes.${i}: duplicate key "${c.key}"`);
    keys.add(c.key);
    if (c.kind !== "connect") objects.add(c.key);
  });
  set.changes.forEach((c, i) => {
    if (c.kind !== "connect") return;
    for (const end of [c.from, c.to]) {
      if ("created" in end && !objects.has(end.created) && !options.externalKeys?.has(end.created)) problems.push(`changes.${i}: connects to unknown object "${end.created}"`);
    }
    if (sameTarget(c.from, c.to)) problems.push(`changes.${i}: connects an object to itself`);
  });
  if (set.parts) {
    // A merged set's parts cover its changes and conflicts exactly, in order, each part once.
    const counted = set.parts.reduce((n, p) => n + p.changes, 0);
    const conflicted = set.parts.reduce((n, p) => n + p.conflicts, 0);
    if (counted !== set.changes.length) problems.push(`parts: cover ${counted} changes, but the set has ${set.changes.length}`);
    if (conflicted !== (set.conflicts?.length ?? 0)) problems.push(`parts: cover ${conflicted} conflicts, but the set has ${set.conflicts?.length ?? 0}`);
    if (new Set(set.parts.map((p) => p.key)).size !== set.parts.length) problems.push("parts: duplicate part key");
    if (set.contentSource) problems.push("parts: a set with parts has no top-level contentSource (each part has its own)");
  }
  if (set.split && (set.contentSource || set.parts)) problems.push("split: a split set has no contentSource or parts (its pieces link to the split block's source)");
  if (problems.length) throw new InvalidChangeSetError(problems);
  // Known, bounded provenance only (F25); created objects carry the operation id whatever the producer put in metadata.
  const metadata = { ...normalizeAIMetadata(set.metadata)!, operationId: set.operationId } as ChangeSet["metadata"];
  return { ...set, metadata };
}

function sameTarget(a: ChangeTarget, b: ChangeTarget): boolean {
  return "existing" in a ? "existing" in b && a.existing === b.existing : "created" in b && a.created === b.created;
}

// ---------------------------------------------------------------------------
// Resolution against the live canvas
// ---------------------------------------------------------------------------

export interface DroppedChange {
  change: ProposedChange;
  /** The only reason today: an existing object the change refers to was deleted. */
  reason: "object_deleted";
}

export interface ResolvedChangeSet {
  set: ChangeSet;
  /** Changes that can be applied, in their original order. */
  changes: ProposedChange[];
  /** Changes left out, with why — reported to the user, never silently lost. */
  dropped: DroppedChange[];
}

/**
 * Checks a change set against the canvas as it is now. The user may keep
 * editing while a set is pending review, so a move or connection that refers
 * to an object deleted since is dropped (and reported) instead of failing the
 * whole set. Created objects refer to nothing existing and are never dropped,
 * so connections between them always survive.
 */
export function resolveChangeSet(set: ChangeSet, isLive: (id: ObjectId) => boolean): ResolvedChangeSet {
  const dropped: DroppedChange[] = [];
  const changes: ProposedChange[] = [];
  const gone = (t: ChangeTarget) => "existing" in t && !isLive(t.existing);
  for (const c of set.changes) {
    // A restore may re-create a deleted element (D43): its target needn't be live. A group needs at least one live member.
    const missing =
      c.kind === "restore" ? false : c.kind === "group_objects" ? !c.targets.some(isLive) : "target" in c ? !isLive(c.target) : c.kind === "connect" && (gone(c.from) || gone(c.to));
    if (missing) dropped.push({ change: c, reason: "object_deleted" });
    else changes.push(c);
  }
  return { set, changes, dropped };
}

// ---------------------------------------------------------------------------
// Summaries (review bar)
// ---------------------------------------------------------------------------

export interface ChangeSummary {
  created: number;
  connected: number;
  moved: number;
  updated: number;
  removed: number;
  /** Elements reset or re-created by a revert (D43); only present when there are any. */
  restored?: number;
  /** Frames (F42), counted apart from objects; only present when there are any. */
  sections?: number;
}

/** Every kind that adds a new object (as opposed to connecting or moving one that already exists/was just created). */
const CREATE_KINDS = ["create_block", "create_shape", "create_page"] as const satisfies readonly ProposedChangeKind[];

export function summarizeChanges(changes: readonly ProposedChange[]): ChangeSummary {
  const s: ChangeSummary = { created: 0, connected: 0, moved: 0, updated: 0, removed: 0 };
  for (const c of changes) {
    if (c.kind === "connect") s.connected++;
    else if (c.kind === "move") s.moved++;
    else if (c.kind === "update_block" || c.kind === "update_shape" || c.kind === "update_node" || c.kind === "set_lens" || c.kind === "update_connection" || (c.kind === "update_frame" && c.name !== undefined)) s.updated++;
    else if (c.kind === "remove") s.removed++;
    else if (c.kind === "restore") s.restored = (s.restored ?? 0) + 1;
    else if (c.kind === "create_frame" || c.kind === "group_objects") s.sections = (s.sections ?? 0) + 1;
    else if (c.kind !== "rebaseline" && c.kind !== "update_frame") s.created++;
  }
  return s;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "1 block", "3 objects · 2 connections · 1 move". `omitSections` leaves out
 * the frame count, for callers that already name the sections (a merged F43 set).
 */
export function describeChanges(changes: readonly ProposedChange[], options: { omitSections?: boolean } = {}): string {
  const s = summarizeChanges(changes);
  const onlyBlocks = changes.filter((c) => CREATE_KINDS.includes(c.kind as (typeof CREATE_KINDS)[number])).every((c) => c.kind === "create_block");
  const parts = [
    s.sections && !options.omitSections ? plural(s.sections, "section", "sections") : "",
    s.created ? (onlyBlocks ? plural(s.created, "block", "blocks") : plural(s.created, "object", "objects")) : "",
    s.connected ? plural(s.connected, "connection", "connections") : "",
    s.moved ? plural(s.moved, "move", "moves") : "",
    s.updated ? plural(s.updated, "update", "updates") : "",
    s.removed ? plural(s.removed, "removal", "removals") : "",
    s.restored ? plural(s.restored, "restore", "restores") : "",
  ];
  return parts.filter(Boolean).join(" · ") || "No changes";
}

/** "1 change was skipped: an object it refers to was deleted." */
export function describeDropped(dropped: readonly DroppedChange[]): string | null {
  if (!dropped.length) return null;
  return `${plural(dropped.length, "change was", "changes were")} skipped: ${dropped.length === 1 ? "an object it refers to was" : "objects they refer to were"} deleted.`;
}

/** Bounding box of the boxes a change set creates or moves to (null when it only connects). */
export function proposedBounds(changes: readonly ProposedChange[], boxOf: (id: ObjectId) => Box | undefined): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (b: Box) => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  };
  for (const c of changes) {
    if (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") add(c.box);
    else if (c.kind === "move") {
      const current = boxOf(c.target);
      if (current) add({ ...current, x: c.to.x, y: c.to.y });
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}
