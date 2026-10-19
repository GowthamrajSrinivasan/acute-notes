/**
 * The code block languages the editor's schema (`schema.ts`) actually
 * supports, kept in their own module (no `@blocknote/core` import) so
 * non-editor, non-browser code — F30's renderer maps a `VisualNode`'s
 * `content.language` to one of these keys — can use it without pulling in
 * BlockNote.
 */
export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: "Plain text" },
  typescript: { name: "TypeScript", aliases: ["ts"] },
  javascript: { name: "JavaScript", aliases: ["js"] },
  python: { name: "Python", aliases: ["py"] },
  csharp: { name: "C#", aliases: ["cs"] },
  json: { name: "JSON" },
  sql: { name: "SQL" },
  bash: { name: "Shell", aliases: ["sh"] },
  // Previewed as its diagram outside the editor (F33, `MermaidPreview`).
  mermaid: { name: "Mermaid", aliases: ["mmd"] },
};

/**
 * BlockNote's "```" + Enter shortcut creates a code block with language ""
 * (not the default language), and its language picker throws for any
 * language that isn't listed — which crashes the editor. Accept "" as plain
 * text without listing it as a second "Plain text" option.
 */
export const SUPPORTED_LANGUAGES = new Proxy(CODE_LANGUAGES, {
  has: (target, key) => key === "" || key in target,
});

/**
 * A language name/alias (from anywhere — a code fence, an AI plan) to one of
 * `CODE_LANGUAGES`' own keys, case-insensitively; `""` (plain text, always
 * accepted — see `SUPPORTED_LANGUAGES`) when nothing matches.
 */
export function normalizeCodeLanguage(raw: string | undefined): string {
  const lower = raw?.trim().toLowerCase();
  if (!lower) return "";
  if (lower in CODE_LANGUAGES) return lower;
  for (const [key, { aliases }] of Object.entries(CODE_LANGUAGES)) if (aliases?.includes(lower)) return key;
  return "";
}
