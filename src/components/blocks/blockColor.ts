/**
 * Block text colour follows the element's Stroke colour, matching how
 * Excalidraw colours plain text. The subtle default block border means
 * "default text colour".
 *
 * Block content lives in a DOM layer that Excalidraw's dark-mode canvas
 * filter (`invert(93%) hue-rotate(180deg)`) does not reach, so in dark mode
 * the same transform is applied to the colour value to match the canvas.
 */
export const DEFAULT_BLOCK_STROKE = "#dcdce3";

const INVERT = 0.93;
// CSS `hue-rotate(180deg)` matrix (cos = -1, sin = 0).
const HUE_180 = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
] as const;

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const toHex = (v: number) =>
  Math.round(clamp(v) * 255)
    .toString(16)
    .padStart(2, "0");

/** Applies Excalidraw's dark-mode canvas filter to a hex colour. */
export function darkModeColor(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const inv = rgb.map((c) => INVERT + c * (1 - 2 * INVERT));
  const out = HUE_180.map((row) => row[0] * inv[0]! + row[1] * inv[1]! + row[2] * inv[2]!);
  return `#${out.map(toHex).join("")}`;
}

/** Text colour for a block's content, or `undefined` for the theme default. */
export function blockTextColor(strokeColor: string, theme: "light" | "dark"): string | undefined {
  const c = strokeColor.trim().toLowerCase();
  if (!c || c === "transparent" || c === DEFAULT_BLOCK_STROKE) return undefined;
  return theme === "dark" ? darkModeColor(c) : c;
}
