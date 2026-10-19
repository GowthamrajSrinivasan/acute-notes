/**
 * `renderVisualPlan` (F30): a validated `VisualPlan` → a declarative F19
 * change set, ready for review. Nothing is written here — this only builds
 * data (positions, sizes, and F19's existing `create_block` / `create_shape`
 * / `create_page` / `connect` change kinds); F19's own Accept does the write,
 * as one transaction.
 *
 * Composes F30's own pure steps in order:
 *   layoutPlan (per-template positions) → findPlacement (free canvas space),
 *   or placeWithReflow (making room beside an anchor, F41) → mapNode (node →
 *   change, incl. Markdown → rich content) → relationships → moves.
 *
 * `plan` must already be `validateVisualPlan`'s output — this never
 * re-validates it. `context` (existing object boxes, viewport, an optional
 * anchor) is the caller's job to gather from the real canvas; nothing here
 * imports Excalidraw or reads any live state itself.
 */
import type { ChangeSet, ContentSourceRecord, ProposedChange } from "@/ai/changes/changeSet";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { isDiagramGroup, wrapArchitecturePlan } from "@/ai/visual-plan/architectureFrame";
import { groupTakeawayKey, groupTitleKey, isClusterKey } from "@/ai/visual-plan/groups";
import { frameName } from "@/ai/visual-plan/sectionKinds";
import { boundsOf, findPlacement } from "./place";
import { layoutPlan, sectionOfNodes } from "./layout";
import { mapNode, withAnalysisTag, type ParseMarkdown } from "./mapNode";
import { placeWithReflow } from "./reflow";
import type { Box, RenderContext, SceneObject } from "./types";

export type { Box, RenderContext, SceneObject };

export interface RenderVisualPlanOptions {
  operationId: string;
  /** Shown in the review bar, e.g. "Visualize: payment retry notes". */
  title: string;
  metadata: ChangeSet["metadata"];
  context: RenderContext;
  /** The content version this render comes from (F37); links every created object to it by its node's `stableKey`. */
  contentSource?: ContentSourceRecord;
  /**
   * Markdown → rich content for `text`/`page` nodes. Defaults to the app's
   * own parser (`components/blocks/editor/markdown.ts`, the same one Ask AI
   * Insert uses), lazy-loaded so a plan with no such node never pulls it in.
   * Tests inject a trivial stub to stay pure and DOM-free.
   */
  parseMarkdown?: ParseMarkdown;
}

let defaultParser: Promise<ParseMarkdown> | null = null;
/** The app's own Markdown → rich-content parser, lazy-loaded once (also used by F38 to fingerprint proposals). */
export function loadDefaultParser(): Promise<ParseMarkdown> {
  defaultParser ??= import("@/components/blocks/editor/markdown").then((m) => m.markdownToContent);
  return defaultParser;
}

export async function renderVisualPlan(validated: VisualPlan, options: RenderVisualPlanOptions): Promise<ChangeSet> {
  // A standalone architecture plan with component kinds lands in one (interactive) diagram frame.
  const plan = wrapArchitecturePlan(validated);
  const needsMarkdown = plan.nodes.some((n) => n.type === "text" || n.type === "page");
  const parseMarkdown = options.parseMarkdown ?? (needsMarkdown ? await loadDefaultParser() : neverCalled);

  const local = layoutPlan(plan);
  const { boxes, moves } = placeOnCanvas(local, options.context);

  // Sections (F42) first, so their frames sit under their members in review; each also gets a centred XL title.
  const sections = sectionOfNodes(plan);
  const groups = plan.nodes.filter((n) => n.type === "group");
  const changes: ProposedChange[] = groups.flatMap((g, i) => {
    const title = groupTitleKey(g.id);
    const takeaway = g.content.takeaway ? groupTakeawayKey(g.id) : null;
    const backdrops = [...boxes.keys()].filter((k) => isClusterKey(k) && k.startsWith(`${g.id}::`));
    const children = [title, ...(takeaway ? [takeaway] : []), ...backdrops, ...plan.nodes.filter((n) => sections.get(n.id) === g.id).map((n) => n.id)];
    const frame = mapNode(g, boxes.get(g.id)!, parseMarkdown);
    const heading = mapNode(
      { id: title, type: "heading", role: "section", content: { text: g.content.label }, ...(g.stableKey ? { stableKey: g.stableKey } : {}) },
      boxes.get(title)!,
      parseMarkdown,
    );
    // The section's main point, in one line under its title (Wave B). It has no stable key: it is the model's
    // reading of the section, redone with it, never content the user edits into place.
    const line = takeaway
      ? [mapNode({ id: takeaway, type: "heading", role: "subtitle", content: { text: g.content.takeaway! } }, boxes.get(takeaway)!, parseMarkdown) as ProposedChange]
      : [];
    // The frame's own label says where and what the section is; its name is the XL title inside it.
    // Its title and takeaway, for the overview shown over the frame when zoomed out (Wave D).
    const overview = { title: g.content.label, ...(g.content.takeaway ? { takeaway: g.content.takeaway } : {}) };
    // An architecture section's frame is interactive (kinds, relationship cards, legend) and carries its info cards.
    const diagram = isDiagramGroup(plan, g) ? { diagram: g.content.cards?.length ? { cards: g.content.cards } : {}, ...(g.content.level !== undefined ? { level: g.content.level } : {}) } : {};
    return [{ ...frame, title: frameName(g.role, i + 1), children, overview, ...diagram } as ProposedChange, heading as ProposedChange, ...line];
  });
  // A section's sub-topics, each on a backdrop drawn before (so behind) what it groups.
  for (const [key, box] of boxes) if (isClusterKey(key)) changes.push({ kind: "create_shape", key, shape: "rectangle", box, backdrop: true });
  for (const n of plan.nodes) if (n.type !== "group") changes.push(mapNode(withAnalysisTag(n), boxes.get(n.id)!, parseMarkdown) as ProposedChange);
  plan.relationships.forEach((r, i) => {
    changes.push({
      kind: "connect",
      key: `__rel${i}`,
      from: { created: r.from },
      to: { created: r.to },
      relation: r.type,
      ...(r.label ? { label: r.label } : {}),
      ...(r.explanation ? { explanation: r.explanation } : {}),
      ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
    });
  });
  for (const m of moves) changes.push({ kind: "move", target: m.id, to: m.to });

  return {
    operationId: options.operationId,
    title: options.title,
    metadata: options.metadata,
    changes,
    ...(options.contentSource ? { contentSource: options.contentSource } : {}),
  };
}


/**
 * Translates the local layout onto the canvas: beside the anchor, making room
 * when the context carries the scene's objects (see `reflow.ts`), else into
 * free space (see `place.ts`).
 */
function placeOnCanvas(local: ReadonlyMap<string, Box>, context: RenderContext): { boxes: Map<string, Box>; moves: { id: string; to: { x: number; y: number } }[] } {
  const bounds = boundsOf([...local.values()]);
  const { anchor, objects } = context;
  const { dx, dy, moves } = anchor && objects ? placeWithReflow(bounds, { ...context, anchor, objects }) : { ...findPlacement(bounds, context), moves: [] };
  return { boxes: new Map([...local].map(([id, b]) => [id, { ...b, x: b.x + dx, y: b.y + dy }])), moves };
}

/** Never actually invoked: `needsMarkdown` gates every call site that would reach it. */
const neverCalled: ParseMarkdown = () => {
  throw new Error("renderVisualPlan: no Markdown to parse — this is an internal bug (needsMarkdown was false)");
};
