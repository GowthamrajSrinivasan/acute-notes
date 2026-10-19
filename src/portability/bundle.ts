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
 * Never included: UI preferences, AI settings, API keys or usage records.
 */
import { z } from "zod";
import { RELATION_TYPES } from "@/domain/types";
import { BundleError } from "./bundleError";

export const BUNDLE_FORMAT = "acute-notes";
export const BUNDLE_VERSION = 1;

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

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
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
});

export type AcuteBundle = z.infer<typeof bundleSchema>;
export type BundleCanvas = AcuteBundle["canvases"][number];
export type BundleElement = BundleCanvas["elements"][number];

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
