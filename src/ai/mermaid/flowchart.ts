/**
 * A small, deterministic, hand-written parser for Mermaid flowcharts
 * (`graph` / `flowchart`) — no Mermaid library. Supported:
 *
 * - header with direction: `TB` `TD` `BT` `LR` `RL` (default `TB`)
 * - nodes: bare ids and every classic shape — `[ ]` `( )` `([ ])` `[[ ]]`
 *   `[( )]` `(( ))` `((( )))` `> ]` `{ }` `{{ }}` `[/ /]` `[\ \]` `[/ \]`
 *   `[\ /]` — plus the v11 `id@{ shape: …, label: … }` form; quoted and
 *   markdown-string labels, `<br>`, `#quot;`-style entity codes
 * - links: `-->` `---` `-.->` `-.-` `==>` `===` `~~~`, longer variants
 *   (`--->`, `-..->`, `====>`), `--o` `--x`, and two-headed `<-->` `o--o`
 *   `x--x`; labels as `-->|text|` and `-- text -->` (`-. text .->`,
 *   `== text ==>`)
 * - chains `A --> B --> C` and `&` groups `A & B --> C & D`
 * - `subgraph id [title]` / `subgraph title` … `end`, nested, with its own
 *   `direction`
 * - `%%` comments and directives; `classDef`, `class`, `style`, `linkStyle`,
 *   `click`, `:::class`, `accTitle`/`accDescr` are read past (styling and
 *   interaction don't carry into a plan)
 *
 * Anything else fails with a typed `syntax` error naming the line and column —
 * never a throw, never a silently wrong graph.
 */
import { GraphBuilder, normaliseDirection } from "./graphBuilder";
import { cleanLabel, lineColumn, readFrontmatter, splitStatements, type Statement } from "./source";
import type { GraphEdge, MermaidShape, ParseResult } from "./types";

class ParseFailure {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** A node id: letters/digits/`_`/`$`, with single inner hyphens (`node-1`) — a `-` followed by `-`, `.` or `>` starts a link instead. */
const ID = /[\p{L}\p{N}_$]+(?:-[\p{L}\p{N}_$]+)*/uy;

/** Classic shape delimiters, longest opener first; a failed match falls through to the next (so `[/path]` is a plain `[ ]`). */
const SHAPES: readonly { open: string; close: readonly string[]; shape: MermaidShape | readonly MermaidShape[] }[] = [
  { open: "(((", close: [")))"], shape: "double-circle" },
  { open: "((", close: ["))"], shape: "circle" },
  { open: "([", close: ["])"], shape: "stadium" },
  { open: "[[", close: ["]]"], shape: "subroutine" },
  { open: "[(", close: [")]"], shape: "cylinder" },
  { open: "[/", close: ["/]", "\\]"], shape: ["parallelogram", "trapezoid"] },
  { open: "[\\", close: ["\\]", "/]"], shape: ["parallelogram-alt", "trapezoid-alt"] },
  { open: "{{", close: ["}}"], shape: "hexagon" },
  { open: "[", close: ["]"], shape: "rect" },
  { open: "(", close: [")"], shape: "round" },
  { open: "{", close: ["}"], shape: "rhombus" },
  { open: ">", close: ["]"], shape: "asymmetric" },
];

/** The v11 `@{ shape: name }` names this parser maps; any other name is drawn as a rectangle. */
const NAMED_SHAPES: Record<string, MermaidShape> = {
  rect: "rect",
  rectangle: "rect",
  proc: "rect",
  process: "rect",
  rounded: "round",
  event: "round",
  stadium: "stadium",
  pill: "stadium",
  terminal: "stadium",
  subproc: "subroutine",
  subroutine: "subroutine",
  cyl: "cylinder",
  cylinder: "cylinder",
  database: "cylinder",
  db: "cylinder",
  circle: "circle",
  circ: "circle",
  "sm-circ": "circle",
  start: "circle",
  "dbl-circ": "double-circle",
  "double-circle": "double-circle",
  "fr-circ": "double-circle",
  stop: "double-circle",
  diam: "rhombus",
  diamond: "rhombus",
  decision: "rhombus",
  question: "rhombus",
  hex: "hexagon",
  hexagon: "hexagon",
  prepare: "hexagon",
  "lean-r": "parallelogram",
  "lean-l": "parallelogram-alt",
  "trap-b": "trapezoid",
  "trap-t": "trapezoid-alt",
  manual: "trapezoid-alt",
  "in-out": "parallelogram",
  doc: "document",
  document: "document",
};

const IGNORED = /^(?:(?:classDef|class|style|linkStyle|click)\s+\S|(?:accTitle|accDescr)\s*[:{])/;

export function parseFlowchart(source: string): ParseResult {
  const g = new GraphBuilder("flowchart");
  try {
    const front = readFrontmatter(source);
    if (front.title) g.title = front.title;
    const statements = splitStatements(source, front.bodyStart);
    const header = statements[0];
    const hm = header && /^(?:flowchart-elk|flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*(.*)$/i.exec(header.text);
    if (!header || !hm) return fail(source, "expected a `graph` or `flowchart` header", header?.span.start ?? 0);
    if (hm[1]) g.direction = normaliseDirection(hm[1]);
    if (hm[2]) return fail(source, `unexpected "${hm[2].slice(0, 20)}" after the header (expected a direction: TB, TD, BT, LR or RL)`, header.span.start);
    const rest = statements.slice(1);
    let skippingAccDescr = false;
    let styled = 0;
    for (const st of rest) {
      if (skippingAccDescr) {
        if (st.text.includes("}")) skippingAccDescr = false;
        continue;
      }
      if (IGNORED.test(st.text)) {
        if (/^accTitle\s*:/.test(st.text) && !g.title) g.title = cleanLabel(st.text.replace(/^accTitle\s*:/, ""));
        if (/^accDescr\s*\{/.test(st.text) && !st.text.includes("}")) skippingAccDescr = true;
        if (/^(classDef|class|style|linkStyle)\b/.test(st.text)) styled++;
        continue;
      }
      statement(g, st);
    }
    if (skippingAccDescr) return fail(source, "unclosed `accDescr {` block", source.length);
    const open = g.currentSubgraph;
    if (open) return fail(source, `subgraph "${open.title}" is never closed with \`end\``, open.span.start);
    if (styled) g.notes.push(`${styled} styling line${styled === 1 ? "" : "s"} (classDef/class/style/linkStyle) ignored — the canvas uses its own styling`);
    return { ok: true, graph: g.build() };
  } catch (e) {
    if (e instanceof ParseFailure) return fail(source, e.message, e.offset);
    return fail(source, `unexpected parser failure: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
}

function fail(source: string, message: string, offset: number): ParseResult {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "flowchart", message: `line ${line}: ${message}`, line, column } };
}

function statement(g: GraphBuilder, st: Statement): void {
  const t = st.text;
  if (/^end$/.test(t)) {
    if (!g.closeSubgraph(st.span.end)) throw new ParseFailure("`end` without an open subgraph", st.span.start);
    return;
  }
  const sm = /^subgraph(?:\s+(.*))?$/.exec(t);
  if (sm) return subgraph(g, st, sm[1]?.trim() ?? "");
  const dm = /^direction\s+(\S+)$/.exec(t);
  if (dm) {
    if (!/^(TB|TD|BT|RL|LR)$/i.test(dm[1]!)) throw new ParseFailure(`unknown direction "${dm[1]}"`, st.span.start);
    const d = normaliseDirection(dm[1]!);
    const sg = g.currentSubgraph;
    if (sg) sg.direction = d;
    else g.direction = d;
    return;
  }
  new Chain(g, t, st.span.start).parse();
}

function subgraph(g: GraphBuilder, st: Statement, rest: string): void {
  let id: string;
  let title: string;
  const quoted = /^"([^"]*)"$/.exec(rest);
  const withTitle = /^([^\s[\]"]+)\s*\[\s*("?)(.*?)\2\s*\]$/.exec(rest);
  if (!rest) {
    id = g.anonymousSubgraphId();
    title = "";
  } else if (quoted) {
    title = cleanLabel(quoted[1]!);
    id = title || g.anonymousSubgraphId();
  } else if (withTitle) {
    id = withTitle[1]!;
    title = cleanLabel(withTitle[3]!);
  } else {
    // `subgraph My Service`: Mermaid uses the whole text as both id and title.
    id = rest;
    title = cleanLabel(rest);
  }
  g.openSubgraph(id, title || id, st.span.start);
}

/** One statement of nodes and links: `A[x] --> B & C -.label.-> D`. Offsets are absolute (`base` + index). */
class Chain {
  private i = 0;

  constructor(
    private readonly g: GraphBuilder,
    private readonly s: string,
    private readonly base: number,
  ) {}

  parse(): void {
    let left = this.nodeGroup();
    if (!left) throw this.error("expected a node id");
    for (;;) {
      this.ws();
      if (this.eof()) return;
      const linkStart = this.i;
      const link = this.link();
      if (!link) throw this.error("expected a link (such as `-->`) or the end of the statement");
      this.ws();
      const right = this.nodeGroup();
      if (!right) throw this.error("expected a node after the link");
      for (const from of left) {
        for (const to of right) {
          this.g.edge({ from, to, ...link, span: { start: this.base + linkStart, end: this.base + this.i } });
        }
      }
      left = right;
    }
  }

  private eof(): boolean {
    return this.i >= this.s.length;
  }

  private ws(): void {
    while (!this.eof() && /\s/.test(this.s[this.i]!)) this.i++;
  }

  private error(message: string): ParseFailure {
    const near = this.s.slice(this.i, this.i + 20);
    return new ParseFailure(near ? `${message}, near "${near}"` : message, this.base + this.i);
  }

  private nodeGroup(): string[] | null {
    const first = this.node();
    if (!first) return null;
    const ids = [first];
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.s[this.i] !== "&") {
        this.i = save;
        return ids;
      }
      this.i++;
      this.ws();
      const next = this.node();
      if (!next) throw this.error("expected a node after `&`");
      ids.push(next);
    }
  }

  private node(): string | null {
    const start = this.i;
    ID.lastIndex = this.i;
    const m = ID.exec(this.s);
    if (!m) return null;
    const id = m[0];
    this.i += id.length;
    let def: { label?: string; shape?: MermaidShape } | undefined;
    if (this.s.startsWith("@{", this.i)) def = this.namedShape(id);
    else def = this.shape();
    // `:::className` — styling, ignored.
    if (this.s.startsWith(":::", this.i)) {
      this.i += 3;
      ID.lastIndex = this.i;
      const cls = ID.exec(this.s);
      if (!cls) throw this.error("expected a class name after `:::`");
      this.i += cls[0].length;
    }
    this.g.mention(id, { start: this.base + start, end: this.base + this.i }, def);
    return id;
  }

  private shape(): { label?: string; shape: MermaidShape } | undefined {
    for (const { open, close, shape } of SHAPES) {
      if (!this.s.startsWith(open, this.i)) continue;
      const bodyStart = this.i + open.length;
      const found = this.closeOf(bodyStart, close);
      if (!found) continue;
      const which = Array.isArray(shape) ? shape[found.index]! : (shape as MermaidShape);
      const label = cleanLabel(this.s.slice(bodyStart, found.at));
      this.i = found.at + found.token.length;
      return { ...(label ? { label } : {}), shape: which };
    }
    if ("[({>".includes(this.s[this.i] ?? " ")) throw this.error("unclosed node shape");
    return undefined;
  }

  /** The first closer after `from` (a quoted label is skipped whole, so it may contain the closer). */
  private closeOf(from: number, closers: readonly string[]): { at: number; token: string; index: number } | null {
    let j = from;
    while (j < this.s.length && /\s/.test(this.s[j]!)) j++;
    if (this.s[j] === '"') {
      const endQuote = this.s.indexOf('"', j + 1);
      if (endQuote < 0) return null;
      j = endQuote + 1;
      while (j < this.s.length && /\s/.test(this.s[j]!)) j++;
      for (const [index, token] of closers.entries()) if (this.s.startsWith(token, j)) return { at: j, token, index };
      return null;
    }
    let best: { at: number; token: string; index: number } | null = null;
    for (const [index, token] of closers.entries()) {
      const at = this.s.indexOf(token, from);
      if (at >= 0 && (!best || at < best.at)) best = { at, token, index };
    }
    return best;
  }

  /** `id@{ shape: diam, label: "Ok?" }` (Mermaid v11). Only `shape` and `label` are read. */
  private namedShape(id: string): { label?: string; shape: MermaidShape } {
    const open = this.i + 1;
    let j = open + 1;
    let inQuote = false;
    for (; j < this.s.length; j++) {
      if (this.s[j] === '"') inQuote = !inQuote;
      else if (!inQuote && this.s[j] === "}") break;
    }
    if (j >= this.s.length) throw this.error(`unclosed \`@{\` on node "${id}"`);
    const body = this.s.slice(open + 1, j);
    this.i = j + 1;
    const shapeName = /(?:^|,)\s*shape\s*:\s*([\w-]+)/.exec(body)?.[1]?.toLowerCase();
    const labelRaw = /(?:^|,)\s*label\s*:\s*("[^"]*"|[^,]*)/.exec(body)?.[1];
    const label = labelRaw !== undefined ? cleanLabel(labelRaw) : undefined;
    const shape = shapeName ? (NAMED_SHAPES[shapeName] ?? "rect") : "rect";
    if (shapeName && !NAMED_SHAPES[shapeName]) this.g.notes.push(`shape "${shapeName}" on "${id}" isn't supported; drawn as a rectangle`);
    return { ...(label ? { label } : {}), shape };
  }

  /** A link at the cursor, with its label; null (cursor unchanged) when there is none. */
  private link(): Omit<GraphEdge, "from" | "to" | "span"> | null {
    const start = this.i;
    const prevIsSpace = start === 0 || /\s/.test(this.s[start - 1]!);
    const LINK = /(<|[ox](?=--|==|-\.))?(?:(-{2,}|={2,})|(-\.+-)|(~{3,}))(>|[ox](?=\s|$))?/y;
    LINK.lastIndex = start;
    const m = LINK.exec(this.s);
    if (m && m[1] && m[1] !== "<" && !prevIsSpace) return null;
    const leftHead = m?.[1];
    if (m) {
      const body = m[2] ?? m[3] ?? m[4]!;
      const head = m[5];
      const open = !head && (body === "--" || body === "==");
      if (!open) {
        this.i = start + m[0].length;
        return this.finish(body, head, leftHead, this.pipeLabel());
      }
      // `-- text -->` / `== text ==>`
      this.i = start + m[0].length;
      return this.textLink(body[0] === "=" ? "thick" : "solid", leftHead);
    }
    const dotted = /(<|[ox])?-\.(?![.-])/y;
    dotted.lastIndex = start;
    const dm = dotted.exec(this.s);
    if (!dm || (dm[1] && dm[1] !== "<" && !prevIsSpace)) return null;
    this.i = start + dm[0].length;
    return this.textLink("dotted", dm[1]);
  }

  /** The label of an open link (`-- text -->`), up to its closer. */
  private textLink(line: "solid" | "thick" | "dotted", leftHead: string | undefined): Omit<GraphEdge, "from" | "to" | "span"> {
    const closer = line === "solid" ? /-{2,}(>|[ox](?=\s|$))|-{3,}/g : line === "thick" ? /={2,}(>|[ox](?=\s|$))|={3,}/g : /\.+-(>|[ox](?=\s|$))?/g;
    closer.lastIndex = this.i;
    const c = closer.exec(this.s);
    if (!c) throw this.error("link text is never closed (expected e.g. `-->` after it)");
    const label = cleanLabel(this.s.slice(this.i, c.index));
    this.i = c.index + c[0].length;
    const body = line === "solid" ? "---" : line === "thick" ? "===" : "-.-";
    return this.finish(body, c[1], leftHead, label || undefined);
  }

  /** `|label|` right after a link. */
  private pipeLabel(): string | undefined {
    const save = this.i;
    this.ws();
    if (this.s[this.i] !== "|") {
      this.i = save;
      return undefined;
    }
    const end = this.s.indexOf("|", this.i + 1);
    if (end < 0) throw this.error("unclosed `|label|`");
    const label = cleanLabel(this.s.slice(this.i + 1, end));
    this.i = end + 1;
    return label || undefined;
  }

  private finish(body: string, head: string | undefined, leftHead: string | undefined, label: string | undefined): Omit<GraphEdge, "from" | "to" | "span"> {
    const line: GraphEdge["line"] = body[0] === "~" ? "invisible" : body[0] === "=" ? "thick" : body.includes(".") ? "dotted" : "solid";
    const arrow: GraphEdge["arrow"] = head === ">" ? "arrow" : head === "o" ? "circle" : head === "x" ? "cross" : "none";
    return { line, arrow, bidirectional: !!leftHead, ...(label ? { label } : {}) };
  }
}
