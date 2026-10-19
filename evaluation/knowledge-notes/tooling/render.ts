/**
 * Gate 3 facts: renders a plan with the product's own renderer (`renderVisualPlan`, a stub Markdown parser as in
 * `render.test.ts`) onto an empty canvas, and measures the result with the product's own layout checks
 * (`proposalGeometry` / `checkProposal`). Nothing here judges meaning; text clipping needs a browser (README).
 */
import { checkProposal, proposalGeometry } from "@/ai/changes/proposalGeometry";
import type { LayoutReport } from "@/ai/changes/layoutCheck";
import type { Box } from "@/ai/changes/changeSet";
import { renderVisualPlan } from "@/ai/renderer/render";
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
}

const TOLERANCE = 1;

function overlap(a: Box, b: Box): boolean {
  return a.x + a.width - TOLERANCE > b.x && b.x + b.width - TOLERANCE > a.x && a.y + a.height - TOLERANCE > b.y && b.y + b.height - TOLERANCE > a.y;
}

function inside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE && inner.x + inner.width <= outer.x + outer.width + TOLERANCE && inner.y + inner.height <= outer.y + outer.height + TOLERANCE;
}

export async function renderFacts(plan: VisualPlan): Promise<RenderFacts> {
  const set = await renderVisualPlan(plan, {
    operationId: "golden",
    title: "Golden dataset",
    metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "golden", operationId: "golden" },
    context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 1000 } },
    parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
  });
  const changes = set.changes;
  const geometry = proposalGeometry(changes, []);
  const layout = checkProposal(changes, []);
  const created = changes.flatMap((c) => (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page" ? [{ key: c.key, box: c.box }] : []));
  const frames = changes.flatMap((c) => (c.kind === "create_frame" ? [{ key: c.key, box: c.box, children: c.children }] : []));
  const boxOf = new Map(created.map((c) => [c.key, c.box]));
  const cardOverlaps: string[] = [];
  for (let i = 0; i < created.length; i++) for (let j = i + 1; j < created.length; j++) if (overlap(created[i]!.box, created[j]!.box)) cardOverlaps.push(`${created[i]!.key} × ${created[j]!.key}`);
  const outsideFrames = frames.flatMap((f) => f.children.filter((k) => boxOf.has(k) && !inside(boxOf.get(k)!, f.box)).map((k) => `${k} outside ${f.key}`));
  const frameOverlaps: string[] = [];
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) if (overlap(frames[i]!.box, frames[j]!.box)) frameOverlaps.push(`${frames[i]!.key} × ${frames[j]!.key}`);
  return { layout, cardOverlaps, outsideFrames, frameOverlaps, frames: frames.length, cards: geometry.cards.length };
}
