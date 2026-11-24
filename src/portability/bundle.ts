/**
 * `.acute.json` workspace bundle, version 1 (F17): a versioned,
 * human-inspectable snapshot of one workspace with stable ids.
 *
 * - canvases carry their scene elements (renderer JSON, deleted ones dropped)
 * - documents carry block/page records with their content snapshot
 *   (BlockNote-shaped JSON — the editable Y.Doc is rebuilt from it on import)
 * - assets carry image binaries as data URLs (a ZIP bundle can replace this
 *   later without changing the model)
 * - relations are derived from typed arrows and included for readers/AI;
 *   import ignores them because the arrows already carry them
 *
 * A canvas export uses the same format with `scope: "canvas"`: one canvas,
 * the blocks it uses and its pages.
 *
 * Optional `sources` section (schema version 2, knowledge-notes plan §6.4):
 * the content sources the canvases were made from, with every version, so
 * citations still resolve after an import. `version` stays 1: it is the
 * breaking-change number a reader refuses when newer, and the section is
 * additive, so an older reader (which strips keys it doesn't know) still
 * imports such a file, without the sources. `schemaVersion` records the
 * additive revision; absent means 1.
 *
 * Never included: UI preferences, AI settings, API keys or usage records.
 */
import { z } from "zod";
import { CARD_LAYOUT_LANG_MAX, RELATION_TYPES } from "@/domain/types";
import { BundleError } from "./bundleError";

export const BUNDLE_FORMAT = "acute-notes";
export const BUNDLE_VERSION = 1;
/** Additive revisions within `BUNDLE_VERSION`: 2 adds the optional `sources` section. Never refused when newer. */
export const BUNDLE_SCHEMA_VERSION = 2;

const viewport = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() });

/** Scene elements are validated structurally; Excalidraw restores the rest. */
const element = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.number(),
  isDeleted: z.boolean().optional(),
});

const contentBlock = z.looseObject({ type: z.string().min(1) });

const metadata = z.looseObject({}).optional();

/**
 * One content source (`BundledSource` in `ai/fidelity/contracts.ts`). `plan`, `units` and `lineage` pass through as
 * they are: their readers validate them on use (`validateVisualPlan(plan, { stored: true })`).
 */
const bundledSource = z.object({
  id: z.string().min(1),
  canvasId: z.string().min(1),
  origin: z.enum(["paste", "import", "mcp"]),
  tier: z.enum(["local", "ai"]),
  template: z.string(),
  latestVersion: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
  versions: z
    .array(
      z.object({
        version: z.number().int().positive(),
        text: z.string(),
        plan: z.unknown(),
        pathIds: z.record(z.string(), z.string()).optional(),
        revisions: z.array(z.object({ unit: z.string(), earlier: z.string(), later: z.string() })).optional(),
        units: z.unknown().optional(),
        lineage: z.unknown().optional(),
        createdAt: z.number(),
      }),
    )
    .min(1),
});

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  /** Additive schema revision (absent: 1). A newer one still imports; what this reader doesn't know is ignored. */
  schemaVersion: z.number().int().positive().optional(),
  /** "canvas": one canvas only (a canvas export, not importable as a workspace). Absent: a whole workspace. */
  scope: z.enum(["workspace", "canvas"]).optional(),
  exportedAt: z.number(),
  workspace: z.object({
    id: z.string().min(1),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  canvases: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      createdAt: z.number(),
      updatedAt: z.number(),
      /** Note-taking mode (`domain/noteMode.ts`); absent = manual. Unknown values are dropped on import, never failed. */
      noteMode: z.enum(["manual", "ai"]).optional().catch(undefined),
      viewport: viewport.optional(),
      viewBackgroundColor: z.string().optional(),
      elements: z.array(element),
    }),
  ),
  documents: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(["block", "page"]),
      /** The owning canvas (absent in older bundles). */
      canvasId: z.string().min(1).optional(),
      title: z.string(),
      snapshot: z.array(contentBlock),
      createdAt: z.number(),
      updatedAt: z.number(),
      metadata,
      /** A text block's stored OpenUI layout (`CardLayout`); one that doesn't fit the shape is dropped on import, never failed. */
      layout: z
        .object({
          format: z.literal("openui-lang"),
          version: z.literal(1),
          lang: z.string().min(1).max(CARD_LAYOUT_LANG_MAX),
          contentHash: z.string().min(1).max(64),
          writtenAt: z.number(),
        })
        .optional()
        .catch(undefined),
    }),
  ),
  relations: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      type: z.enum(RELATION_TYPES),
      arrowId: z.string().optional(),
    }),
  ),
  assets: z.array(
    z.object({
      id: z.string().min(1),
      mimeType: z.string().min(1),
      createdAt: z.number(),
      dataURL: z.string().startsWith("data:"),
    }),
  ),
  /** The content sources, with every version (schema 2, "Include sources"). Absent: the file carries none. */
  sources: z.array(bundledSource).optional(),
});

export type AcuteBundle = z.infer<typeof bundleSchema>;
export type BundleCanvas = AcuteBundle["canvases"][number];
export type BundleElement = BundleCanvas["elements"][number];
export type BundleSource = NonNullable<AcuteBundle["sources"]>[number];

export { BundleError };

/**
 * Validates untrusted input as a bundle. Throws `BundleError` with a
 * user-facing message for other files, newer versions and malformed content.
 */
export function parseBundle(input: unknown): AcuteBundle {
  const head = input as { format?: unknown; version?: unknown } | null;
  if (!head || typeof head !== "object" || head.format !== BUNDLE_FORMAT) {
    throw new BundleError("This isn't an Acute-Notes workspace file.");
  }
  if (typeof head.version !== "number" || !Number.isInteger(head.version) || head.version < 1) {
    throw new BundleError("This workspace file has an invalid version.");
  }
  if (head.version > BUNDLE_VERSION) {
    throw new BundleError("This workspace was exported by a newer version of Acute-Notes. Update the app to import it.");
  }
  const result = bundleSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (at ${issue.path.join(".")})` : "";
    throw new BundleError(`This workspace file is damaged or incomplete${where}.`);
  }
  const bundle = result.data;
  const duplicate = firstDuplicate([
    ...bundle.canvases.map((c) => c.id),
    ...bundle.documents.map((d) => d.id),
  ]);
  if (duplicate) throw new BundleError(`This workspace file contains the id "${duplicate}" twice.`);
  const duplicateSource = firstDuplicate(bundle.sources?.map((s) => s.id) ?? []);
  if (duplicateSource) throw new BundleError(`This workspace file contains the source "${duplicateSource}" twice.`);
  return bundle;
}

function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}
