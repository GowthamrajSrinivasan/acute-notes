/**
 * BlockNote's named colour palette (from `@blocknote/core` Block.css), shared
 * by the editor schema and the static renderers so a named colour ("red")
 * renders identically while editing, in the compact preview and in the
 * Editor-view HTML.
 */
export const TEXT_PALETTE: Readonly<Record<string, string>> = {
  gray: "#9b9a97",
  brown: "#64473a",
  red: "#e03e3e",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d6461",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
};

export const BACKGROUND_PALETTE: Readonly<Record<string, string>> = {
  gray: "#ebeced",
  brown: "#e9e5e3",
  red: "#fbe4e4",
  orange: "#f6e9d9",
  yellow: "#fbf3db",
  green: "#ddedea",
  blue: "#ddebf1",
  purple: "#eae4f2",
  pink: "#f4dfeb",
};

/** Arbitrary CSS colours (e.g. Excalidraw's hex swatches) vs palette names. */
export function isCustomColor(value: unknown): value is string {
  return typeof value === "string" && /^(#|rgb|hsl)/i.test(value);
}

/** Resolves a stored colour value (palette name or CSS colour) to CSS, or null for default. */
export function resolveColor(value: unknown, palette: Readonly<Record<string, string>>): string | null {
  if (typeof value !== "string" || !value || value === "default") return null;
  if (isCustomColor(value)) return value;
  return palette[value] ?? null;
}
