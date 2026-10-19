/** Label clean-up shared by both parsers: what a node shows, without the drawing around it. */

/** Box-drawing characters (lines, corners, junctions; light, heavy, double and rounded). */
export const BOX_CHARS = /[─━═│┃║┌┍┎┏╒╓╔╭┐┑┒┓╕╖╗╮└┕┖┗╘╙╚╰┘┙┚┛╛╜╝╯├┝┞┟┠┡┢┣╞╟╠┤┥┦┧┨┩┪┫╡╢╣┬┭┮┯┰┱┲┳╤╥╦┴┵┶┷┸┹┺┻╧╨╩┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╪╫╬]/;

/** A leading bullet (followed by a space) that only marks the item. */
const BULLET = /^(?:[•·▪▫◦‣∙►▸▶▹→*+>-]\s+)+/;

/** Paired wrappers around a whole label: `[ X ]`, `【X】`, `**X**`, `` `X` ``. */
const WRAPPERS: readonly RegExp[] = [/^\[\s*(.+?)\s*\]$/, /^【\s*(.+?)\s*】$/, /^⟦\s*(.+?)\s*⟧$/, /^\*\*(.+)\*\*$/, /^__(.+)__$/, /^`([^`]+)`$/];

/** One line of a label, trimmed of box and bullet characters, wrappers and repeated whitespace. */
export function cleanLine(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/^[│┃║|]+\s*/, "").replace(/\s*[│┃║|]+$/, "");
  s = s.replace(BULLET, "");
  for (let changed = true; changed; ) {
    changed = false;
    for (const w of WRAPPERS) {
      const m = w.exec(s);
      if (m?.[1]?.trim()) {
        s = m[1].trim();
        changed = true;
      }
    }
  }
  return s.trim();
}

/** A label: its lines cleaned, empty ones dropped, joined by "\n". */
export function cleanLabel(lines: readonly string[]): string {
  return lines
    .map(cleanLine)
    .filter((l) => l.length > 0)
    .join("\n");
}

/** A label on one line, for keys and messages. */
export const flat = (label: string) => label.replace(/\s+/g, " ").trim();

/** Something worth drawing: at least one letter, digit or symbol that isn't part of the drawing. */
export function isMeaningful(label: string): boolean {
  return /[^\s│┃║|─━═\-+`\\/_=~.:;,*#<>^v()[\]{}'"]/u.test(label) || /^\.{1,2}$/.test(label.trim());
}
