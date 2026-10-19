/**
 * SVG paths for the neighbourhood highlight of a diagram node, in whatever coordinates the boxes and points are
 * given in: scene coordinates on the canvas overlay (`DiagramOverlay`), normalised ones in Acute Lens.
 */
import type { DiagramEdge, DiagramNode } from "@/domain/canvas/diagram";

type Box = DiagramNode["box"];

export function edgePath(edge: Pick<DiagramEdge, "points">): string {
  return edge.points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
}

export function holePath({ x, y, width, height }: Box, pad = 6): string {
  const [l, t, r, b] = [x - pad, y - pad, x + width + pad, y + height + pad];
  return `M${l} ${t}H${r}V${b}H${l}Z`;
}

/** `area` with a hole around each box: drawn with `fill-rule="evenodd"`, it dims everything but the boxes. */
export function dimPath(area: Box, holes: readonly Box[]): string {
  return `M${area.x} ${area.y}H${area.x + area.width}V${area.y + area.height}H${area.x}Z ${holes.map((h) => holePath(h)).join(" ")}`;
}
