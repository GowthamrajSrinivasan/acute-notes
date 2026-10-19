/**
 * Top-down box trees: labels (bare, `[ bracketed ]` or in drawn boxes) joined by connector lines.
 *
 *                ACUTE                        ┌───────┐                  root
 *                  │                          │  CEO  │                   |
 *         ┌────────┴────────┐                 └───┬───┘              +----+----+
 *       FREE              PAID              ┌─────┴─────┐            |         |
 *     Full editor     ┌────┴────┐        ┌──┴──┐     ┌──┴──┐        [ a ]     [ b ]
 *     10 AI actions  PRO     LIFETIME    │ CTO │     │ CFO │
 *                                         └─────┘     └─────┘
 *
 * The drawing is read as a grid:
 *
 * 1. Closed rectangles with only text inside are boxes: each is one label, its border no longer a line.
 * 2. Every other box-drawing (and free-standing `| - +`) character is a connector; connected characters
 *    (each pointing at the other) form a *wire*.
 * 3. The remaining text forms labels: words on a line (split by two or more spaces), merged with the lines
 *    directly above/below that they overlap — a label can wrap over several lines.
 * 4. A label with a wire just below it is that wire's parent; a label with the wire just above it is its child.
 *    A wire with one parent links it to each of its children.
 *
 * Anything this can't read confidently fails: a line entering a label from the side (a flow or mixed drawing),
 * diagonal `/ \` branches, a wire with several parents (branches merging), a label under two wires, too many
 * labels not connected to anything, or no label with two or more children (a vertical chain is a flow, not a tree).
 */
import { BOX_CHARS, cleanLabel, flat, isMeaningful } from "./label";
import { spanOf, splitLines, type Line } from "./lines";
import { compact } from "./indented";
import type { AsciiTreeError, AsciiTreeNode, AsciiTreeParseResult, Span } from "./types";

const U = 1;
const D = 2;
const L = 4;
const R = 8;

const DIRS: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  const set = (chars: string, dirs: number) => {
    for (const ch of chars) out[ch] = dirs;
  };
  set("│┃║▼▲↓↑", U | D);
  set("─━═", L | R);
  set("┌┍┎┏╒╓╔╭", R | D);
  set("┐┑┒┓╕╖╗╮", L | D);
  set("└┕┖┗╘╙╚╰", U | R);
  set("┘┙┚┛╛╜╝╯", U | L);
  set("├┝┞┟┠┡┢┣╞╟╠", U | D | R);
  set("┤┥┦┧┨┩┪┫╡╢╣", U | D | L);
  set("┬┭┮┯┰┱┲┳╤╥╦", L | R | D);
  set("┴┵┶┷┸┹┺┻╧╨╩", L | R | U);
  set("┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╪╫╬", U | D | L | R);
  // ASCII: only when not part of a word (see `classify`).
  set("|", U | D);
  set("-", L | R);
  set("+", U | D | L | R);
  return out;
})();
const ASCII_CONNECTORS = new Set(["|", "-", "+"]);
const HORIZONTAL_ARROWS = /[→←▶◀►◄⇒⇐⟶]|-+>|<-+/;
const DIAGONALS = new Set(["/", "\\", "╱", "╲"]);
const OPPOSITE: Readonly<Record<number, number>> = { [U]: D, [D]: U, [L]: R, [R]: L };
const STEP: Readonly<Record<number, [number, number]>> = { [U]: [-1, 0], [D]: [1, 0], [L]: [0, -1], [R]: [0, 1] };

/** Grid size this parser reads; a bigger drawing is far over the node limit anyway. */
export const MAX_BOX_ROWS = 400;
export const MAX_BOX_COLS = 400;

type CellKind = "space" | "text" | "wire" | "box";

interface Block {
  /** The label's text per line (runs on the same line joined by a space). */
  rows: Map<number, { from: number; to: number }[]>;
  /** A drawn box's rectangle, when it is one. */
  box?: { top: number; left: number; bottom: number; right: number; lines: { row: number; from: number; to: number }[] };
}

export function parseBoxTree(source: string): AsciiTreeParseResult {
  const fail = (code: AsciiTreeError["code"], message: string, line?: number): AsciiTreeParseResult => ({ ok: false, error: { code, message, ...(line ? { line } : {}) } });
  const lines = splitLines(source.replace(/\s+$/, ""));
  if (lines.length > MAX_BOX_ROWS || lines.some((l) => l.text.length > MAX_BOX_COLS)) {
    return fail("too_large", `the drawing is over ${MAX_BOX_ROWS} lines or ${MAX_BOX_COLS} columns`);
  }
  const rows = lines.length;
  const cols = Math.max(0, ...lines.map((l) => l.text.length));
  const ch = (r: number, c: number) => (r >= 0 && r < rows ? (lines[r]!.text[c] ?? " ") : " ");
  if (!lines.some((l) => BOX_CHARS.test(l.text) || /[|+]/.test(l.text) || /(?:^|\s)[/\\╱╲](?:\s|$)/.test(l.text))) return fail("not_a_tree", "no connector lines");

  // 1. Cell kinds: ASCII connectors next to a word are part of it ("Sign-up", "C++", "a|b").
  const kind: CellKind[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: CellKind[] = [];
    for (let c = 0; c < cols; c++) {
      const x = ch(r, c);
      row.push(x === " " ? "space" : DIRS[x] !== undefined ? "wire" : "text");
    }
    for (let c = 1; c < cols; c++) if (row[c] === "wire" && ASCII_CONNECTORS.has(ch(r, c)) && row[c - 1] === "text") row[c] = "text";
    for (let c = cols - 2; c >= 0; c--) if (row[c] === "wire" && ASCII_CONNECTORS.has(ch(r, c)) && row[c + 1] === "text") row[c] = "text";
    kind.push(row);
  }
  // A lone "-" or "+" joined to no other line ("Pro - 299", "a + b") is punctuation, not a connector.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ch(r, c);
      if (kind[r]![c] !== "wire" || (x !== "-" && x !== "+")) continue;
      const joined = [U, D, L, R].some((d) => {
        const [dy, dx] = STEP[d]!;
        const y = r + dy;
        const n = y >= 0 && y < rows ? kind[y]![c + dx] : undefined;
        return (DIRS[x]! & d) !== 0 && n === "wire" && ((DIRS[ch(y, c + dx)] ?? 0) & OPPOSITE[d]!) !== 0;
      });
      if (!joined) kind[r]![c] = "text";
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (kind[r]![c] !== "text" || !DIAGONALS.has(ch(r, c))) continue;
      const alone = (kind[r]![c - 1] ?? "space") === "space" && (kind[r]![c + 1] ?? "space") === "space";
      // "Free / Pro" is a label; a slash with no word beside it is a branch.
      const inWords = /[\p{L}\p{N}]/u.test(ch(r, c - 2)) || /[\p{L}\p{N}]/u.test(ch(r, c + 2));
      if (alone && !inWords) return fail("unsupported", `line ${r + 1} has a diagonal branch (/ or \\); only straight connector lines can be read`, r + 1);
    }
    if (HORIZONTAL_ARROWS.test(lines[r]!.text)) return fail("not_a_tree", `line ${r + 1} has a horizontal arrow: a flow, not a tree`, r + 1);
  }

  // 2. Boxes.
  const blocks: Block[] = [];
  const blockAt: (number | undefined)[][] = Array.from({ length: rows }, () => new Array<number | undefined>(cols).fill(undefined));
  for (const box of findBoxes(rows, ch, kind)) {
    const id = blocks.length;
    blocks.push({ rows: new Map(), box });
    for (let r = box.top; r <= box.bottom; r++) {
      for (let c = box.left; c <= box.right; c++) {
        kind[r]![c] = "box";
        blockAt[r]![c] = id;
      }
    }
  }

  // 3. Text labels: runs on a line, merged with overlapping runs on the lines above/below.
  const runs: { row: number; from: number; to: number }[] = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (kind[r]![c] !== "text") {
        c++;
        continue;
      }
      const from = c;
      let to = c + 1;
      const bracketed = ch(r, c) === "[";
      for (;;) {
        // A bracketed label ends at its bracket: "[ a ] [ b ]" is two labels.
        if (bracketed && lines[r]!.text.slice(from + 1, to).includes("]")) break;
        if (to < cols && kind[r]![to] === "text") to++;
        else if (to + 1 < cols && kind[r]![to] === "space" && kind[r]![to + 1] === "text") to += 2;
        else if (bracketed) {
          const close = lines[r]!.text.indexOf("]", to);
          if (close < 0 || lines[r]!.text.slice(to, close).split("").some((_, i) => kind[r]![to + i] === "wire" || kind[r]![to + i] === "box")) break;
          to = close + 1;
        } else break;
      }
      runs.push({ row: r, from, to });
      c = to;
    }
  }
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i]!;
      const b = runs[j]!;
      if (b.row > a.row + 1) break;
      if (b.row === a.row + 1 && b.from < a.to && a.from < b.to) parent[find(j)] = find(i);
    }
  }
  const blockOfRun = new Map<number, number>();
  runs.forEach((run, i) => {
    const root = find(i);
    let id = blockOfRun.get(root);
    if (id === undefined) {
      id = blocks.length;
      blocks.push({ rows: new Map() });
      blockOfRun.set(root, id);
    }
    const block = blocks[id]!;
    (block.rows.get(run.row) ?? block.rows.set(run.row, []).get(run.row)!).push({ from: run.from, to: run.to });
    for (let c = run.from; c < run.to; c++) blockAt[run.row]![c] = id;
  });

  // 4. Wires: connected connector cells.
  const wireAt: (number | undefined)[][] = Array.from({ length: rows }, () => new Array<number | undefined>(cols).fill(undefined));
  const dirsAt = (r: number, c: number) => (kind[r]?.[c] === "wire" ? (DIRS[ch(r, c)] ?? 0) : 0);
  let wires = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (kind[r]![c] !== "wire" || wireAt[r]![c] !== undefined) continue;
      const id = wires++;
      const queue: [number, number][] = [[r, c]];
      wireAt[r]![c] = id;
      while (queue.length) {
        const [y, x] = queue.pop()!;
        const dirs = dirsAt(y, x);
        for (const d of [U, D, L, R]) {
          if (!(dirs & d)) continue;
          const [dy, dx] = STEP[d]!;
          const ny = y + dy;
          const nx = x + dx;
          if (wireAt[ny]?.[nx] !== undefined || !(dirsAt(ny, nx) & OPPOSITE[d]!)) continue;
          wireAt[ny]![nx] = id;
          queue.push([ny, nx]);
        }
      }
    }
  }

  // 5. Attachments.
  const tops = Array.from({ length: wires }, () => new Set<number>());
  const bottoms = Array.from({ length: wires }, () => new Set<number>());
  for (const [id, block] of blocks.entries()) {
    const cells = cellsOf(block);
    // A line entering from the side: not a top-down tree.
    // (Also with one space between: "├── a1" under a box-tree label.)
    for (const [r, c] of cells) {
      const left = dirsAt(r, c - 1) & R || (kind[r]![c - 1] === "space" && dirsAt(r, c - 2) & R);
      const right = dirsAt(r, c + 1) & L || (kind[r]![c + 1] === "space" && dirsAt(r, c + 2) & L);
      if (left || right) return fail("unsupported", `line ${r + 1}: a connector runs into "${flat(labelText(lines, block))}" from the side`, r + 1);
    }
    const attach = (dy: number, need: number, into: Set<number>[]) => {
      const edge = dy < 0 ? topEdge(block) : bottomEdge(block);
      const hits = new Set<number>();
      for (const [r, c] of edge) {
        const w = wireAt[r + dy]?.[c];
        if (w !== undefined && dirsAt(r + dy, c) & need) hits.add(w);
      }
      if (!hits.size) {
        // A stem one column past a short label.
        for (const [r, c] of [edge[0], edge.at(-1)].flatMap((e, i) => (e ? [[e[0], e[1] + (i === 0 ? -1 : 1)] as const] : []))) {
          const w = wireAt[r + dy]?.[c];
          if (w !== undefined && dirsAt(r + dy, c) & need && (kind[r]?.[c] ?? "space") === "space") hits.add(w);
        }
      }
      for (const w of hits) into[w]!.add(id);
    };
    attach(-1, D, bottoms);
    attach(1, U, tops);
  }

  // 6. Edges.
  const childOf = new Map<number, number>();
  let dangling = 0;
  for (let w = 0; w < wires; w++) {
    const up = [...tops[w]!];
    const down = [...bottoms[w]!].filter((b) => !tops[w]!.has(b));
    if ([...bottoms[w]!].some((b) => tops[w]!.has(b))) return fail("unsupported", "a connector line loops around a label");
    if (!down.length) {
      if (up.length) dangling++;
      continue;
    }
    if (up.length > 1) {
      const names = up.map((b) => `"${flat(labelText(lines, blocks[b]!))}"`).join(", ");
      return fail("unsupported", `branches from ${names} merge into one line; only trees (one parent per label) can be read`);
    }
    if (!up.length) {
      dangling++;
      continue;
    }
    for (const b of down) {
      if (childOf.has(b) && childOf.get(b) !== up[0]) return fail("unsupported", `"${flat(labelText(lines, blocks[b]!))}" hangs from two lines`);
      childOf.set(b, up[0]!);
    }
  }

  // 7. The tree, in reading order.
  const readable = blocks.map((b) => cleanLabel(labelLines(lines, b)));
  const drawn = new Set(blocks.flatMap((_, i) => (readable[i] && isMeaningful(readable[i]) ? [i] : [])));
  const order = [...drawn].sort((a, b) => firstCell(blocks[a]!)[0] - firstCell(blocks[b]!)[0] || firstCell(blocks[a]!)[1] - firstCell(blocks[b]!)[1]);
  const index = new Map(order.map((b, i) => [b, i] as const));
  const nodes: AsciiTreeNode[] = order.map((b) => ({ label: readable[b]!, span: spanOfBlock(lines, blocks[b]!), parent: null, children: [] }));
  for (const [child, parentBlock] of childOf) {
    const c = index.get(child);
    const p = index.get(parentBlock);
    if (c === undefined || p === undefined) continue;
    nodes[c]!.parent = p;
  }
  // Children left to right.
  const colOf = (i: number) => firstCell(blocks[order[i]!]!)[1];
  nodes.forEach((n, i) => {
    if (n.parent !== null) nodes[n.parent]!.children.push(i);
  });
  for (const n of nodes) n.children.sort((a, b) => colOf(a) - colOf(b));
  if (hasCycle(nodes)) return fail("unsupported", "the connector lines form a loop");
  const tree = compact(nodes);
  const linked = tree.nodes.filter((n) => n.parent !== null || n.children.length).length;
  if (!tree.nodes.some((n) => n.children.length >= 2)) return fail("not_a_tree", "no label branches into two or more (a vertical chain is a flow, not a tree)");
  const loose = tree.nodes.length - linked;
  if (loose > Math.max(1, Math.floor(tree.nodes.length / 4))) return fail("unsupported", `${loose} of ${tree.nodes.length} labels aren't connected to the tree`);
  const notes: string[] = [];
  if (loose) notes.push(`${loose} label${loose === 1 ? " isn't" : "s aren't"} connected to the tree; ${loose === 1 ? "it is" : "they are"} shown on ${loose === 1 ? "its" : "their"} own`);
  if (dangling) notes.push(`${dangling} connector line${dangling === 1 ? "" : "s"} with nothing at one end ${dangling === 1 ? "was" : "were"} skipped`);
  return { ok: true, tree: { style: "box", ...tree, notes } };
}

function findBoxes(rows: number, ch: (r: number, c: number) => string, kind: CellKind[][]): NonNullable<Block["box"]>[] {
  const boxes: NonNullable<Block["box"]>[] = [];
  const TL = new Set([..."┌┍┎┏╒╓╔╭+"]);
  const TR = new Set([..."┐┑┒┓╕╖╗╮+"]);
  const BL = new Set([..."└┕┖┗╘╙╚╰+"]);
  const BR = new Set([..."┘┙┚┛╛╜╝╯+"]);
  const H = new Set([..."─━═-┬┭┮┯┰┱┲┳╤╥╦┴┵┶┷┸┹┺┻╧╨╩┼╪+"]);
  const V = new Set([..."│┃║|├┤┝┥┠┨╟╢╞╡╠╣"]);
  const used = new Set<string>();
  for (let top = 0; top < rows; top++) {
    const width = kind[top]!.length;
    for (let left = 0; left < width; left++) {
      if (!TL.has(ch(top, left)) || kind[top]![left] !== "wire" || !V.has(ch(top + 1, left))) continue;
      // The top-right corner: the first corner along the edge with a side below it (an ASCII `+` may be a junction).
      let right = -1;
      for (let c = left + 1; c < width; c++) {
        const x = ch(top, c);
        if (TR.has(x) && V.has(ch(top + 1, c))) {
          right = c;
          break;
        }
        if (!H.has(x)) break;
      }
      if (right < left + 2) continue;
      let bottom = -1;
      for (let r = top + 1; r < rows; r++) {
        if (BL.has(ch(r, left)) && BR.has(ch(r, right))) {
          bottom = r;
          break;
        }
        if (!V.has(ch(r, left)) || !V.has(ch(r, right))) break;
      }
      if (bottom < top + 2) continue;
      let closed = true;
      for (let c = left + 1; c < right && closed; c++) closed = H.has(ch(bottom, c));
      if (!closed) continue;
      // Only text inside, and some of it.
      const inner: { row: number; from: number; to: number }[] = [];
      let clean = true;
      for (let r = top + 1; r < bottom && clean; r++) {
        let from = -1;
        let to = -1;
        for (let c = left + 1; c < right; c++) {
          const k = kind[r]![c];
          if (k === "wire" || k === "box") clean = false;
          if (k === "text") {
            if (from < 0) from = c;
            to = c + 1;
          }
        }
        if (from >= 0) inner.push({ row: r, from, to });
      }
      const key = `${top}:${left}`;
      if (!clean || !inner.length || used.has(key)) continue;
      used.add(key);
      boxes.push({ top, left, bottom, right, lines: inner });
    }
  }
  return boxes;
}

function cellsOf(block: Block): [number, number][] {
  if (block.box) {
    const { top, left, bottom, right } = block.box;
    const out: [number, number][] = [];
    for (let r = top; r <= bottom; r++) out.push([r, left], [r, right]);
    return out;
  }
  return [...block.rows].flatMap(([r, runs]) => runs.flatMap((run) => [[r, run.from] as [number, number], [r, run.to - 1] as [number, number]]));
}

/** The cells whose upper neighbour a parent's line would occupy. */
function topEdge(block: Block): [number, number][] {
  if (block.box) return range(block.box.left, block.box.right + 1).map((c) => [block.box!.top, c]);
  const edge: [number, number][] = [];
  const covered = new Set<number>();
  for (const [r, runs] of [...block.rows].sort((a, b) => a[0] - b[0])) {
    for (const run of runs) for (let c = run.from; c < run.to; c++) if (!covered.has(c)) edge.push([r, c]);
    for (const run of runs) for (let c = run.from; c < run.to; c++) covered.add(c);
  }
  return edge;
}

function bottomEdge(block: Block): [number, number][] {
  if (block.box) return range(block.box.left, block.box.right + 1).map((c) => [block.box!.bottom, c]);
  const edge: [number, number][] = [];
  const covered = new Set<number>();
  for (const [r, runs] of [...block.rows].sort((a, b) => b[0] - a[0])) {
    for (const run of runs) for (let c = run.from; c < run.to; c++) if (!covered.has(c)) edge.push([r, c]);
    for (const run of runs) for (let c = run.from; c < run.to; c++) covered.add(c);
  }
  return edge;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

function firstCell(block: Block): [number, number] {
  if (block.box) return [block.box.top, block.box.left];
  const [r, runs] = [...block.rows].sort((a, b) => a[0] - b[0])[0]!;
  return [r, Math.min(...runs.map((x) => x.from))];
}

/** The label's lines as written: one per line, runs on the same line joined by a space. */
function labelLines(lines: readonly Line[], block: Block): string[] {
  if (block.box) return block.box.lines.map((l) => lines[l.row]!.text.slice(l.from, l.to));
  return [...block.rows]
    .sort((a, b) => a[0] - b[0])
    .map(([r, runs]) => runs.map((run) => lines[r]!.text.slice(run.from, run.to)).join(" "));
}

const labelText = (lines: readonly Line[], block: Block) => labelLines(lines, block).join(" ").trim();

/** From the label's first character to its last, in source offsets. */
function spanOfBlock(lines: readonly Line[], block: Block): Span {
  const pieces = block.box ? block.box.lines.map((l) => ({ row: l.row, from: l.from, to: l.to })) : [...block.rows].flatMap(([row, runs]) => runs.map((run) => ({ row, ...run })));
  const spans = pieces.map((p) => {
    const line = lines[p.row]!;
    const text = line.text.slice(p.from, p.to);
    const lead = text.length - text.trimStart().length;
    return spanOf(line, p.from + lead, p.from + text.trimEnd().length);
  });
  return { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) };
}

function hasCycle(nodes: readonly AsciiTreeNode[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    let at = nodes[i]!.parent;
    for (let steps = 0; at !== null; steps++) {
      if (at === i || steps > nodes.length) return true;
      at = nodes[at]!.parent;
    }
  }
  return false;
}
