/**
 * How a diagram node of each kind looks: the stroke and fill written onto the shape when its kind is set, so the
 * kind reads on the canvas, in exports, and everywhere else the element goes. Values follow Archify's light palette;
 * the canvas's dark mode is Excalidraw's own (it inverts the scene), so one set serves both themes.
 *
 * `accent` is the same hue for UI chrome (legend swatches, the passport chip) drawn outside the scene.
 */
import type { NodeKind } from "./diagram";

export interface NodeKindStyle {
  strokeColor: string;
  backgroundColor: string;
  accent: string;
}

export const NODE_KIND_STYLES: Record<NodeKind, NodeKindStyle> = {
  frontend: { strokeColor: "#0891b2", backgroundColor: "#cffafe", accent: "#0891b2" },
  backend: { strokeColor: "#059669", backgroundColor: "#d1fae5", accent: "#059669" },
  database: { strokeColor: "#7c3aed", backgroundColor: "#ede9fe", accent: "#7c3aed" },
  cloud: { strokeColor: "#d97706", backgroundColor: "#fef3c7", accent: "#d97706" },
  security: { strokeColor: "#e11d48", backgroundColor: "#ffe4e6", accent: "#e11d48" },
  messagebus: { strokeColor: "#ea580c", backgroundColor: "#ffedd5", accent: "#ea580c" },
  external: { strokeColor: "#64748b", backgroundColor: "#f1f5f9", accent: "#64748b" },
  // L3 flow and L4 operation kinds (plan §3.2).
  endpoint: { strokeColor: "#0e7490", backgroundColor: "#ecfeff", accent: "#0e7490" },
  step: { strokeColor: "#475569", backgroundColor: "#f8fafc", accent: "#475569" },
  function: { strokeColor: "#047857", backgroundColor: "#ecfdf5", accent: "#047857" },
  event: { strokeColor: "#c2410c", backgroundColor: "#fff7ed", accent: "#c2410c" },
  store: { strokeColor: "#6d28d9", backgroundColor: "#f5f3ff", accent: "#6d28d9" },
  // Project-knowledge kinds (plan D33): decisions and plan state read differently from architecture components.
  project: { strokeColor: "#1d4ed8", backgroundColor: "#dbeafe", accent: "#1d4ed8" },
  decision: { strokeColor: "#4f46e5", backgroundColor: "#e0e7ff", accent: "#4f46e5" },
  constraint: { strokeColor: "#b91c1c", backgroundColor: "#fee2e2", accent: "#b91c1c" },
  finding: { strokeColor: "#a16207", backgroundColor: "#fef9c3", accent: "#a16207" },
  open_question: { strokeColor: "#0284c7", backgroundColor: "#e0f2fe", accent: "#0284c7" },
  risk: { strokeColor: "#c2410c", backgroundColor: "#ffedd5", accent: "#c2410c" },
  milestone: { strokeColor: "#0f766e", backgroundColor: "#ccfbf1", accent: "#0f766e" },
  progress_item: { strokeColor: "#15803d", backgroundColor: "#dcfce7", accent: "#15803d" },
  annotation: { strokeColor: "#be185d", backgroundColor: "#fce7f3", accent: "#be185d" },
};

/** Style written when a node's kind is cleared: Excalidraw's defaults. */
export const PLAIN_NODE_STYLE = { strokeColor: "#1e1e1e", backgroundColor: "transparent" } as const;

/** Whether a shape still wears `kind`'s colours (so the user hasn't recoloured it since the kind was set). */
export function hasKindStyle(colours: { strokeColor?: string; backgroundColor?: string }, kind: NodeKind | undefined): boolean {
  const style = kind && NODE_KIND_STYLES[kind];
  return !!style && colours.strokeColor === style.strokeColor && colours.backgroundColor === style.backgroundColor;
}
