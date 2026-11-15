/**
 * Gate 3 facts: renders a plan with the product's own renderer (`renderVisualPlan`, a stub Markdown parser as in
 * `render.test.ts`) onto an empty canvas, and measures the result with the product's own geometry report
 * (`geometryOf`: `checkProposal`'s layout checks plus overlaps, containment and reading order), so the gate and the
 * product measure the same thing. Nothing here judges meaning; text clipping needs a browser (README).
 */
import type { LayoutReport } from "@/ai/changes/layoutCheck";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { geometryOf, type GeometryReport } from "@/ai/renderer/geometry";
import { subGroupLayout } from "@/ai/renderer/layout";
import { renderVisualPlan, type Organisation } from "@/ai/renderer/render";
import { wrapArchitecturePlan } from "@/ai/visual-plan/architectureFrame";
import { subGroupKey } from "@/ai/visual-plan/groups";
import type { VisualPlan } from "@/ai/visual-plan/types";

export interface RenderFacts {
  layout: LayoutReport;
  /** Pairs of new cards whose boxes overlap. */
  cardOverlaps: string[];
  /** New cards that stick out of the frame that lists them. */
  outsideFrames: string[];
  /** Pairs of new frames that overlap. */
  frameOverlaps: string[];
  frames: number;
  cards: number;
  /** The full report (reading order, links over frames, oversized frames, sub-groups), for checks beyond the five above. */
  geometry: GeometryReport;
  /**
   * Sub-groups drawn on a backdrop inside their frame (organisation v2 only; empty in v1, which draws none): the
   * sub-group's plan node id, its backdrop's change key and the cards it holds. `geometry.outsideSubGroups` checks them.
   */
  subGroups: { id: string; backdrop: string; members: string[] }[];
  /** The organisation rules it was rendered with (assertions scoped to one are decided only on it). */
  organisation: Organisation;
  /**
   * Every frame drawn: its change key (a section's group id, or `<group>::part<i>` for a later part of a split section),
   * its drawn title (the frame's overview title: the section's label, or "Section — sub-topic" for a part) and what it lists.
   */
  drawnFrames: { key: string; title: string; children: string[] }[];
}

export interface RenderOptions {
  /** The organisation rules to render with (organisation-layout plan §3.0). Default "v1": today's. */
  organisation?: Organisation;
}

/** The change set a first Visualize of `plan` proposes on an empty canvas. */
export async function renderGolden(plan: VisualPlan, options: RenderOptions = {}): Promise<ChangeSet> {
  return renderVisualPlan(plan, {
    operationId: "golden",
    title: "Golden dataset",
    metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "golden", operationId: "golden" },
    context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 1000 } },
    parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
    ...(options.organisation ? { organisation: options.organisation } : {}),
  });
}

export async function renderFacts(plan: VisualPlan, options: RenderOptions = {}): Promise<RenderFacts> {
  const changes = (await renderGolden(plan, options)).changes;
  const subGroups = options.organisation === "v2" ? drawnSubGroups(plan, changes) : [];
  const geometry = geometryOf(changes, [], subGroups.length ? { subGroups: new Map(subGroups.map((s) => [s.backdrop, s.members] as const)) } : {});
  const cards = changes.filter((c) => c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page").length;
  const drawnFrames = changes.flatMap((c) => (c.kind === "create_frame" ? [{ key: c.key, title: c.overview?.title ?? c.title ?? "", children: [...c.children] }] : []));
  const frames = drawnFrames.length;
  return {
    layout: geometry.layout,
    cardOverlaps: geometry.cardOverlaps,
    outsideFrames: geometry.outsideFrames,
    frameOverlaps: geometry.frameOverlaps,
    frames,
    cards,
    geometry,
    subGroups,
    organisation: options.organisation ?? "v1",
    drawnFrames,
  };
}

/** The sub-groups the renderer drew a backdrop for, as `renderVisualPlan` keys them (it renders the wrapped plan). */
function drawnSubGroups(plan: VisualPlan, changes: readonly ChangeSet["changes"][number][]): RenderFacts["subGroups"] {
  const drawn = new Set(changes.flatMap((c) => (c.kind === "create_shape" && c.backdrop ? [c.key] : [])));
  const { subsOf, subOf } = subGroupLayout(wrapArchitecturePlan(plan));
  return [...subsOf].flatMap(([group, subs]) =>
    subs.flatMap((sub, i) => {
      const backdrop = subGroupKey(group, i);
      return drawn.has(backdrop) ? [{ id: sub.id, backdrop, members: [...subOf].filter(([, s]) => s === sub.id).map(([id]) => id) }] : [];
    }),
  );
}
