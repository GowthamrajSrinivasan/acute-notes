/**
 * Indented trees: one node per line, nested by branch markers.
 *
 *   ACUTE                    .                       C:.
 *   ├── FREE                 |-- src                 ├───src
 *   │   └── 10 AI actions    |   `-- index.ts        │   │   index.ts      ← `tree /F` lists files without a marker
 *   └── PAID                 +-- docs                │   └───components
 *       ├── PRO                                      └───docs
 *       └── LIFETIME
 *
 * A node's parent is the nearest line above whose marker (or label, for an unmarked `tree /F` entry) sits left of
 * its own. An unmarked line whose text starts exactly under the previous label continues that label; one at the
 * block's own indentation (or after a blank line) starts another root. A line of anything else — a table row, an
 * arrow, box-drawing that isn't a branch — means this isn't an indented tree.
 */
import { BOX_CHARS, cleanLine, isMeaningful } from "./label";
import { spanOf, splitLines, type Line } from "./lines";
import type { AsciiTreeError, AsciiTreeNode, AsciiTreeParseResult } from "./types";

/** `prefix` (pipes and spaces) · marker (`npm ls` adds a `┬` to one with children) · optional arrow head · label. `|--` needs two dashes so `| -` bullets and `|---|` rules don't read as branches. */
const BRANCH = /^([ │┃║|]*?)(?:[├└┣┗╠╚┠┖╟╙┝┕][─━═-]*[┬┐╮]?|\|[-─]{2,}|[+`\\][-─]+)[>▶►]?(?: +|(?=[^\s─━═-]))(.*)$/;
const PREFIX = /^[ │┃║|]*/;
/** Arrows in unmarked text: a flow, not a tree. */
const ARROW = /-->|->|<-|=>|[→←⇒⇐↦⟶▶◀]/;
/** Lines `tree` itself prints around a listing. */
const SKIPPED = [/^\d+ director(?:y|ies)(?:, \d+ files?)?$/i, /^Folder PATH listing\b/i, /^Volume serial number is\b/i, /^No subfolders exist\b/i];

interface Building extends AsciiTreeNode {
  /** Column of its marker; -1 for a root line. */
  col: number;
  /** Column its label starts at. */
  labelCol: number;
  /** Continuation text lines may follow (not for an unmarked `tree /F` entry, whose next unmarked line is a sibling). */
  continuable: boolean;
  raw: string[];
  line: number;
}

type Classified =
  | { kind: "blank" }
  | { kind: "connector" }
  | { kind: "branch"; col: number; labelCol: number; label: string }
  | { kind: "text"; col: number; piped: boolean; text: string }
  | { kind: "junk"; why: string };

function classify(line: Line): Classified {
  const text = line.text.replace(/\s+$/, "");
  if (!text.trim()) return { kind: "blank" };
  if (PREFIX.exec(text)![0].length === text.length) return { kind: "connector" };
  const m = BRANCH.exec(text);
  if (m) {
    const label = m[2]!;
    const labelCol = text.length - label.length;
    if (!label.trim()) return { kind: "connector" };
    if (BOX_CHARS.test(label) || label.includes("|") || !isMeaningful(cleanLine(label))) return { kind: "junk", why: "a branch whose label is more drawing" };
    return { kind: "branch", col: m[1]!.length, labelCol, label };
  }
  const prefix = PREFIX.exec(text)![0];
  const rest = text.slice(prefix.length);
  if (BOX_CHARS.test(rest) || rest.includes("|")) return { kind: "junk", why: "box-drawing or a table row that isn't a branch" };
  if (ARROW.test(rest)) return { kind: "junk", why: "an arrow" };
  return { kind: "text", col: prefix.length, piped: /[│┃║|]/.test(prefix), text: rest };
}

export function parseIndentedTree(source: string): AsciiTreeParseResult {
  const lines = splitLines(source);
  const indents = lines.flatMap((l) => (l.text.trim() ? [/^ */.exec(l.text)![0].length] : []));
  const base = indents.length ? Math.min(...indents) : 0;
  const nodes: Building[] = [];
  const notes: string[] = [];
  let stack: Building[] = [];
  let last: Building | null = null;
  let branches = 0;
  let skipped = 0;
  let afterBlank = true;
  const fail = (code: AsciiTreeError["code"], message: string, line?: number): AsciiTreeParseResult => ({ ok: false, error: { code, message, ...(line ? { line } : {}) } });

  const add = (line: Line, label: string, labelCol: number, col: number, parent: Building | null, continuable: boolean) => {
    const node: Building = {
      label: "",
      raw: [label],
      span: spanOf(line, labelCol, labelCol + label.trimEnd().length),
      parent: parent ? nodes.indexOf(parent) : null,
      children: [],
      col,
      labelCol,
      continuable,
      line: line.row,
    };
    nodes.push(node);
    if (parent) parent.children.push(nodes.length - 1);
    stack.push(node);
    last = node;
  };
  const popTo = (fits: (n: Building) => boolean): Building | null => {
    while (stack.length && !fits(stack.at(-1)!)) stack.pop();
    return stack.at(-1) ?? null;
  };

  for (const line of lines) {
    const c = classify(line);
    switch (c.kind) {
      case "blank":
        afterBlank = true;
        last = null;
        continue;
      case "connector":
        // A `│` spacer keeps the tree going (and ends a label's continuation lines).
        last = null;
        continue;
      case "junk":
        return fail("not_a_tree", `line ${line.row + 1} isn't part of an indented tree (${c.why})`, line.row + 1);
      case "branch": {
        branches++;
        const parent = popTo((n) => n.col < c.col);
        add(line, c.label, c.labelCol, c.col, parent, true);
        break;
      }
      case "text": {
        const lead = last as Building | null;
        if (lead && lead.continuable && c.col === lead.labelCol && lead.line === line.row - 1 - (lead.raw.length - 1)) {
          // Wrapped text under a label: more of the same label.
          lead.raw.push(c.text);
          const end = spanOf(line, c.col, c.col + c.text.trimEnd().length).end;
          lead.span = { start: lead.span.start, end };
          break;
        }
        const rootLine = !c.piped && (c.col <= base || afterBlank || !stack.length);
        if (rootLine) {
          if (SKIPPED.some((re) => re.test(c.text.trim()))) {
            skipped++;
            last = null;
            break;
          }
          stack = [];
          add(line, c.text, c.col, -1, null, true);
          break;
        }
        if (!stack.length) return fail("not_a_tree", `line ${line.row + 1} is indented under nothing`, line.row + 1);
        // An unmarked entry (`tree /F` lists files this way): a child of the nearest label left of it.
        const parent = popTo((n) => n.labelCol < c.col);
        if (!parent) return fail("unsupported", `line ${line.row + 1} is indented under nothing`, line.row + 1);
        add(line, c.text, c.col, c.col, parent, false);
        break;
      }
    }
    afterBlank = false;
  }

  if (!branches) return fail("not_a_tree", "no branch lines (├──, └──, |--, `--, +--)");
  for (const n of nodes) {
    n.label = n.raw.map(cleanLine).filter(Boolean).join(" ");
  }
  const empty = nodes.findIndex((n) => !n.label || !isMeaningful(n.label));
  if (empty >= 0) return fail("unsupported", `line ${nodes[empty]!.line + 1} has a branch without a readable label`, nodes[empty]!.line + 1);
  if (skipped) notes.push(`skipped ${skipped} line${skipped === 1 ? "" : "s"} of \`tree\` output that aren't part of the tree`);

  /** Roots drawn with a branch marker (a tree that starts with `├──`), by span start: never "loose". */
  const markedRoot = new Set(nodes.flatMap((n) => (n.parent === null && n.col >= 0 ? [n.span.start] : [])));
  const result = nodes.map((n): AsciiTreeNode => ({ label: n.label, span: n.span, parent: n.parent, children: n.children }));
  const tree = compact(result);
  // A root line with nothing under it is a caption or stray text: a few are fine, a list of them isn't a tree.
  const loose = tree.roots.filter((r) => !tree.nodes[r]!.children.length && !markedRoot.has(tree.nodes[r]!.span.start)).length;
  if (!tree.nodes.some((n) => n.parent !== null)) return fail("not_a_tree", "no node has children");
  if (loose > Math.max(1, Math.floor(tree.nodes.length / 4))) return fail("not_a_tree", `${loose} lines aren't part of the tree`);
  return { ok: true, tree: { style: "indented", ...tree, notes } };
}

/** Renumbers nodes in pre-order: roots in their given order, each node's children after it in theirs. */
export function compact(nodes: readonly AsciiTreeNode[]): { nodes: AsciiTreeNode[]; roots: number[] } {
  const out: AsciiTreeNode[] = [];
  const roots: number[] = [];
  const visit = (i: number, parent: number | null) => {
    const n = nodes[i]!;
    const at = out.length;
    out.push({ label: n.label, span: n.span, parent, children: [] });
    if (parent === null) roots.push(at);
    else out[parent]!.children.push(at);
    for (const c of n.children) if (nodes[c]!.parent === i) visit(c, at);
  };
  nodes.forEach((n, i) => {
    if (n.parent === null) visit(i, null);
  });
  return { nodes: out, roots };
}
