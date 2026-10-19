/**
 * "Visualize better" (F42 Phase 4.2): one dense block (`assessDensity`) sent
 * to the model on its own, split into a more visual form — a table's rows as
 * cards, steps as a flow, long detail on linked pages — and proposed as its
 * replacement: one frame of pieces beside the block, and the block's removal.
 * Reviewed like any other change set, and one undo step once accepted.
 *
 * With the block's reconciliation link (`splitLinkOf`), the set is a `split`:
 * its pieces are linked to the block's content source as pieces of the
 * block's node, so "Update from new content" keeps the split (F42 Phase 4.3).
 * Without one, the pieces are plain new objects.
 *
 * Only this block's content is sent — never the rest of the canvas. Opt-in
 * per block: nothing calls this but the user's own click.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { SplitLink } from "@/ai/reconcile/split";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import { renderVisualPlan, type Box, type RenderContext } from "@/ai/renderer/render";
import type { AIRuntime } from "@/ai/runtime";
import { ungroup } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { frameName } from "@/ai/visual-plan/sectionKinds";
import { ensureStableKeys } from "@/ai/reconcile/keys";
import type { GenerateVisualPlanInput } from "@/ai/visualize/tasks";
import { provenanceMetadata } from "@/ai/visualize/visualize";

/** The dense block a split replaces, and where. */
export interface SplitTarget {
  /** Its title (or a short name for it): the frame's title, and the section label the model is given. */
  label: string;
  /** The block's canvas element, removed once the split is accepted. */
  target: string;
  /** Where it is: the pieces are placed beside it. */
  box: Box;
  /** The block's link to its content source, when it has one. */
  split: SplitLink | null;
  operationId: string;
  context: RenderContext;
  /** Frames already on the canvas: the new frame is numbered after them ("6 · Overview"). */
  frameCount: number;
}

export interface VisualizeBetterInput extends SplitTarget {
  /** The block's content, as Markdown. */
  text: string;
  /** Why it is dense (`DensityFinding.reason`). */
  reason: string;
}

export interface VisualizeBetterOptions {
  signal?: AbortSignal;
  parseMarkdown?: ParseMarkdown;
}

/** The model's reply had nothing to split into (a single node, or none). */
export class NothingToSplitError extends Error {
  override name = "NothingToSplitError";
  constructor(message = "The AI couldn't split this block into smaller parts. Nothing was changed.") {
    super(message);
  }
}

/** "Split locally" found no table rows or long checklist items to make cards of. */
export const NOTHING_TO_SPLIT_LOCALLY = "This block has nothing to split without AI. Nothing was changed.";

const SECTION_ID = "split";
const norm = (s: string) => s.replace(/^#+\s*/, "").trim().toLowerCase();

export async function visualizeBetter(input: VisualizeBetterInput, runtime: AIRuntime, options: VisualizeBetterOptions = {}): Promise<{ changeSet: ChangeSet; warnings: string[] }> {
  const { signal, parseMarkdown } = options;
  const result = await runtime.run<GenerateVisualPlanInput, unknown>(
    "generate_visual_plan",
    { template: "sectioned", text: input.text, section: { label: input.label, kind: "cards" }, dense: { reason: input.reason } },
    { signal },
  );
  if (signal?.aborted) throw new DOMException("Visualize better was cancelled.", "AbortError");
  const metadata = provenanceMetadata(input.operationId, { providerId: result.providerId, role: result.role, model: result.usage.model });
  return proposeSplit(result.data, input, { title: `Visualize better: ${input.label}`, metadata }, parseMarkdown);
}

/**
 * A raw plan of a block's pieces (a model's reply, or `splitLocally`'s) as the block's replacement: validated, framed,
 * placed beside the block, with the block's removal and — when it has a link — the split record (F42 Phase 4.3).
 */
export async function proposeSplit(
  raw: unknown,
  input: SplitTarget,
  meta: { title: string; metadata: ChangeSet["metadata"] },
  parseMarkdown?: ParseMarkdown,
): Promise<{ changeSet: ChangeSet; warnings: string[] }> {
  const validated = validateVisualPlan(raw);
  const plan = framed(ensureStableKeys(ungroup(validated.plan)), input);
  if (plan.nodes.length < 3) throw new NothingToSplitError(); // the frame, its title… and at least two pieces
  const changeSet = await renderVisualPlan(plan, {
    operationId: input.operationId,
    title: meta.title,
    metadata: meta.metadata,
    // Beside the block it replaces; the block itself is never moved to make room.
    context: { ...input.context, anchor: input.box, anchorSide: "right", anchorIds: [input.target] },
    ...(parseMarkdown ? { parseMarkdown } : {}),
  });
  // The frame is numbered after the sections already on the canvas, not as the first of a fresh document.
  changeSet.changes = changeSet.changes.map((c) => (c.kind === "create_frame" ? { ...c, title: frameName("cards", input.frameCount + 1) } : c));
  changeSet.changes.push({ kind: "remove", target: input.target });
  return { changeSet: { ...changeSet, ...(input.split ? { split: input.split.record } : {}) }, warnings: validated.warnings };
}

/**
 * The pieces in one frame titled like the block (a heading repeating that title is dropped: the frame shows it),
 * each keyed under the block's own key when it has a link.
 */
function framed(plan: VisualPlan, input: SplitTarget): VisualPlan {
  const prefix = input.split?.keyPrefix ?? "";
  const pieces = plan.nodes.filter((n) => !(n.type === "heading" && norm(n.content.text) === norm(input.label)));
  const kept = new Set(pieces.map((n) => n.id));
  const group: VisualNode = { id: SECTION_ID, type: "group", role: "cards", content: { label: input.label, arrangement: "grid" }, ...(prefix ? { stableKey: `${prefix}section` } : {}) };
  const nodes = pieces.map((n): VisualNode => ({ ...n, parent: SECTION_ID, ...(prefix && n.stableKey ? { stableKey: `${prefix}${n.stableKey}` } : {}) }));
  return {
    ...plan,
    template: "sectioned",
    nodes: pieces.length ? [group, ...nodes] : [],
    relationships: plan.relationships.filter((r) => kept.has(r.from) && kept.has(r.to)),
  };
}
