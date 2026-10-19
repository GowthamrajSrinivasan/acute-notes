/**
 * Models often write arrows and symbols as LaTeX (`` `Classify` $\rightarrow$ `Retrieve` ``). Nothing here renders
 * LaTeX, and when such a reply travels inside a JSON string the unescaped `\r` / `\t` / `\n` become a carriage return /
 * tab / newline, leaving `$<CR>ightarrow$`. This turns both forms into the Unicode symbol so the steps read as
 * "Classify → Retrieve → Act → Confirm → Respond".
 *
 * Only `$…$` / `\(…\)` spans made entirely of known commands are touched, so prices ("$5 and $10") are safe.
 */
const SYMBOLS: Record<string, string> = {
  rightarrow: "→",
  longrightarrow: "⟶",
  to: "→",
  leftarrow: "←",
  longleftarrow: "⟵",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Longrightarrow: "⟹",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  iff: "⇔",
  implies: "⇒",
  uparrow: "↑",
  downarrow: "↓",
  mapsto: "↦",
  times: "×",
  cdot: "·",
  neq: "≠",
  leq: "≤",
  geq: "≥",
  approx: "≈",
  ldots: "…",
  dots: "…",
  checkmark: "✓",
};

/** What JSON.parse leaves of a command's `\` + first letter. */
const CONTROL: Record<string, string> = { r: "\r", t: "\t", n: "\n", f: "\f", b: "\b" };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every spelling → symbol: `\name`, plus the control-character spelling when the first letter is a JSON escape. */
const SPELLINGS = new Map<string, string>();
for (const [name, symbol] of Object.entries(SYMBOLS)) {
  SPELLINGS.set(`\\${name}`, symbol);
  const control = CONTROL[name[0]!];
  if (control) SPELLINGS.set(control + name.slice(1), symbol);
}

const TOKEN = [...SPELLINGS.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");
// Spaces only between tokens: `\s` would swallow a leading carriage return / tab that is really `\r` / `\t`.
const BODY = `(?:${TOKEN})(?:[ ]*(?:${TOKEN}))*`;
const SPAN = new RegExp(`\\$\\$?[ ]*(${BODY})[ ]*\\$?\\$|\\\\\\([ ]*(${BODY})[ ]*\\\\\\)`, "g");
const TOKENS = new RegExp(TOKEN, "g");
/** A bare `\rightarrow` outside any `$…$` (only the unmangled spelling; a lone CR is a line break). */
const BARE = new RegExp(`\\\\(${Object.keys(SYMBOLS).sort((a, b) => b.length - a.length).join("|")})(?![A-Za-z])`, "g");

export function normalizeMathArrows(text: string): string {
  if (!text.includes("\\") && !text.includes("$")) return text;
  return text
    .replace(SPAN, (_m, a: string | undefined, b: string | undefined) =>
      (a ?? b ?? "").replace(TOKENS, (t) => SPELLINGS.get(t) ?? t).replace(/[ ]+/g, " "),
    )
    .replace(BARE, (_m, name: string) => SYMBOLS[name] ?? _m);
}
