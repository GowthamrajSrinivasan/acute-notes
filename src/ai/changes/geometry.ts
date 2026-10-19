/** Connector geometry shared by the change-set writer, its preview and the demo canvas. */
import type { Box } from "./changeSet";

/** Distance between a connector's end and the object it is bound to. */
export const CONNECTOR_GAP = 8;

/**
 * Endpoints for a straight connector between two boxes: the facing sides'
 * midpoints (left/right when they sit side by side, top/bottom when stacked),
 * just outside each box.
 */
export function connectorEndpoints(from: Box, to: Box, gap = CONNECTOR_GAP): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const fc = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const tc = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const horizontal = Math.abs(tc.x - fc.x) - (from.width + to.width) / 2 > Math.abs(tc.y - fc.y) - (from.height + to.height) / 2;
  if (horizontal) {
    const right = tc.x > fc.x;
    return {
      start: { x: right ? from.x + from.width + gap : from.x - gap, y: fc.y },
      end: { x: right ? to.x - gap : to.x + to.width + gap, y: tc.y },
    };
  }
  const down = tc.y > fc.y;
  return {
    start: { x: fc.x, y: down ? from.y + from.height + gap : from.y - gap },
    end: { x: tc.x, y: down ? to.y - gap : to.y + to.height + gap },
  };
}
