/**
 * Cleanup of pasted AI answers before Visualize: the video timestamps and source-citation numbers that Gemini,
 * Perplexity, ChatGPT and similar tools add to their text ("… capacity [02:33].", "… in 2024.[1][2]") are
 * reading aids of the original page, not content, so they would only clutter the notes.
 *
 * - Pure and deterministic; each part is switched on by its option (both default on, see `DEFAULT_CLEANUP`).
 * - Fenced code and inline code are never touched, so `items[1]` in code stays.
 * - Only bracketed / parenthesised timestamps and numeric citation forms go: a plain "at 12:30" stays.
 */
export interface CleanupOptions {
  /** Video timestamps: `[02:33]`, `[[00:52](https://youtube…&t=52)]`, `(1:02:33)`, `[02:33 - 02:40]`. */
  timestamps: boolean;
  /** Source citations: `[1]`, `[1][2]`, `[1, 2]`, `[^1]`, `[cite: 1]`, `[1](https://…)`, `【1†source】`, and reference lists. */
  citations: boolean;
}

export const DEFAULT_CLEANUP: CleanupOptions = { timestamps: true, citations: true };

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}`;
const SPAN = String.raw`${TIME}(?:[ ]*[-–—][ ]*${TIME})?`;
const NUM = String.raw`\d{1,3}`;
/** Horizontal space before a marker goes with it ("capacity [02:33]." → "capacity."). */
const LEAD = String.raw`[ \t]*`;

const re = (source: string, flags = "g") => new RegExp(source, flags);

const TIMESTAMPS: RegExp[] = [
  // [[00:52](https://…&t=52)] and [00:52](https://…)
  re(String.raw`${LEAD}\[\[${SPAN}\]\([^)\n]*\)\]`),
  re(String.raw`${LEAD}\[${SPAN}\]\([^)\n]*\)`),
  // [02:33], [02:33, 02:45], (02:33)
  re(String.raw`${LEAD}\[${SPAN}(?:[ ]*[,;][ ]*${SPAN})*\]`),
  re(String.raw`${LEAD}\(${SPAN}(?:[ ]*[,;][ ]*${SPAN})*\)`),
];

const CITATIONS: RegExp[] = [
  // Whole reference-list lines: "[1]: https://…" and "[^1]: Source".
  re(String.raw`^[ \t]*\[\^?${NUM}\]:[ \t]+\S.*(?:\r?\n|$)`, "gm"),
  // Linked numbers: [1](https://…), [[1]](https://…)
  re(String.raw`${LEAD}\[\[${NUM}\]\]\([^)\n]*\)`),
  re(String.raw`${LEAD}\[${NUM}\]\([^)\n]*\)`),
  // Gemini: [cite: 1, 2], [cite_start], [cite_end], [source 1]
  re(String.raw`${LEAD}\[(?:cite|sources?)[ ]*:?[ ]*${NUM}(?:[ ]*[,;–-][ ]*${NUM})*\]`, "gi"),
  re(String.raw`\[cite_(?:start|end)\]`, "gi"),
  // ChatGPT: 【1†source】
  re(String.raw`${LEAD}【[^】\n]*】`),
  // Footnote marks: [^1]
  re(String.raw`${LEAD}\[\^${NUM}\]`),
  // Numeric marks, alone or in a run: [1], [1, 2], [1-3], [1][2] — after a space, a sentence mark or a closing quote/bracket, never after a word (items[1]).
  re(String.raw`(?<=^|[\s.,;:!?)"”'’\]])\[${NUM}(?:[ ]*[,–-][ ]*${NUM})*\](?:\[${NUM}(?:[ ]*[,–-][ ]*${NUM})*\])*`, "gm"),
];

/** Splits `text` into prose and code (fenced blocks, inline code), applies `fn` to the prose only. */
function outsideCode(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/** Stands in for a removed marker until the space around it is tidied (a private-use character). */
const REMOVED = "";
/** A removed marker with the spaces and other removed markers around it. */
const AROUND_REMOVED = /[ \t]*[ \t]*/g;

function strip(text: string, patterns: readonly RegExp[]): string {
  return outsideCode(text, (prose) => {
    // Text that already holds the stand-in can't be tidied safely: remove plainly, tidy nothing.
    if (prose.includes(REMOVED)) return patterns.reduce((out, p) => out.replace(p, ""), prose);
    let out = prose;
    for (const p of patterns) out = out.replace(p, REMOVED);
    // Removal leaves " ." or "  " behind: tidy only where something was removed, so "FastAPI :8000" or "Note : x" elsewhere stay as written.
    return out.replace(AROUND_REMOVED, (gap: string, at: number, all: string) => {
      const before = all[at - 1];
      const after = all[at + gap.length];
      // "capacity [02:33]." → "capacity."
      if (before !== undefined && /\S/.test(before) && after !== undefined && /[.,;:!?]/.test(after)) return "";
      // Spaces on either side of what was removed become one; none at the start of a line.
      const startOfLine = before === undefined || before === "\n";
      return /[ \t]/.test(gap) && !startOfLine ? " " : "";
    });
  });
}

/** `text` without the timestamps and/or citation marks the options switch on. */
export function cleanupAIText(text: string, options: CleanupOptions = DEFAULT_CLEANUP): string {
  let out = text;
  if (options.timestamps) out = strip(out, TIMESTAMPS);
  if (options.citations) out = strip(out, CITATIONS);
  return out;
}
