/**
 * A small hand-written parser for Mermaid class diagrams (`classDiagram` /
 * `classDiagram-v2`) into a `MermaidGraph`. Supported:
 *
 * - classes: `class A`, `class A { … }` member blocks, `A : +member` lines,
 *   generics `A~T~` (shown as `A<T>`), labels `class A["Label"]`,
 *   annotations `<<interface>>` (inside a block, or `<<interface>> A`)
 * - relationships `A <|-- B`, `*--`, `o--`, `-->`, `--`, `..>`, `..|>`, `..`
 *   (either direction), with cardinalities `A "1" *-- "many" B` and `: label`
 * - `namespace N { … }` → a section per namespace
 * - `direction`, `%%` comments; `note`, `classDef`/`cssClass`/`style`/`:::`,
 *   `click`/`link`/`callback` are read past and reported
 *
 * A class with members or an annotation becomes a text card (its members as
 * a list); one without becomes a plain box. Relationship types: inheritance
 * and realization → `implements` (from the subclass or implementation to its
 * parent), dependency → `depends_on`, everything else → `relates_to`.
 */
import { GraphBuilder, normaliseDirection } from "./graphBuilder";
import { cleanLabel, lineColumn, readFrontmatter, splitStatements, type Statement } from "./source";
import type { GraphEdge, ParseResult, Span } from "./types";

class ParseFailure {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** A class name: word characters with an optional generic `~T~`, or backtick-quoted. */
const NAME = String.raw`(?:${"`"}[^${"`"}]+${"`"}|[\p{L}\p{N}_$]+(?:~[^~\s]+~)?)`;
const NAME_ONLY = new RegExp(String.raw`^(${NAME})(?::::[\w-]+)?$`, "u");
const CLASS_DECL = new RegExp(String.raw`^class\s+(${NAME})(?:\s*\["([^"]*)"\])?(?::::[\w-]+)?\s*(\{)?\s*(\})?$`, "u");
const REL = new RegExp(
  String.raw`^(${NAME})\s*(?:"([^"]*)"\s*)?(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?\s*(?:"([^"]*)"\s*)?(${NAME})\s*(?::\s*(.*))?$`,
  "u",
);
const MEMBER_LINE = new RegExp(String.raw`^(${NAME})\s*:\s*(.+)$`, "u");
const ANNOTATION = new RegExp(String.raw`^<<([^>]+)>>\s*(${NAME})?$`, "u");

interface ClassInfo {
  annotations: string[];
  members: string[];
}

export function parseClass(source: string): ParseResult {
  const g = new GraphBuilder("class");
  const info = new Map<string, ClassInfo>();
  const infoOf = (id: string) => info.get(id) ?? info.set(id, { annotations: [], members: [] }).get(id)!;
  try {
    const front = readFrontmatter(source);
    if (front.title) g.title = front.title;
    const statements = splitStatements(source, front.bodyStart);
    const header = statements[0];
    if (!header || !/^classDiagram(?:-v2)?$/.test(header.text)) return fail(source, "expected a `classDiagram` header", header?.span.start ?? 0);
    let block: { id: string; span: Span } | null = null;
    let namespaceOpen: Span | null = null;
    let notes = 0;
    let styled = 0;
    let interactive = 0;
    let lollipops = 0;
    for (const st of statements.slice(1)) {
      const t = st.text;
      if (block) {
        if (t === "}") {
          block = null;
          continue;
        }
        const ann = /^<<([^>]+)>>$/.exec(t);
        if (ann) infoOf(block.id).annotations.push(ann[1]!.trim());
        else infoOf(block.id).members.push(member(t));
        continue;
      }
      if (/^note(?:\s|$)/.test(t)) {
        notes++;
        continue;
      }
      if (/^(?:classDef|cssClass|style)\s+\S/.test(t) || /^(?:accTitle|accDescr)\s*[:{]/.test(t)) {
        if (/^accTitle\s*:/.test(t) && !g.title) g.title = cleanLabel(t.replace(/^accTitle\s*:/, ""));
        else styled++;
        continue;
      }
      if (/^(?:click|link|callback)\s/.test(t)) {
        interactive++;
        continue;
      }
      const dm = /^direction\s+(\S+)$/.exec(t);
      if (dm) {
        if (!/^(TB|TD|BT|RL|LR)$/i.test(dm[1]!)) throw new ParseFailure(`unknown direction "${dm[1]}"`, st.span.start);
        g.direction = normaliseDirection(dm[1]!);
        continue;
      }
      const ns = /^namespace\s+(\S+?)\s*\{$/.exec(t);
      if (ns) {
        if (namespaceOpen) throw new ParseFailure("namespaces can't be nested", st.span.start);
        g.openSubgraph(ns[1]!, ns[1]!, st.span.start);
        namespaceOpen = st.span;
        continue;
      }
      if (t === "}") {
        if (!namespaceOpen || !g.closeSubgraph(st.span.end)) throw new ParseFailure("`}` without an open class or namespace", st.span.start);
        namespaceOpen = null;
        continue;
      }
      const decl = CLASS_DECL.exec(t);
      if (decl) {
        const id = declare(g, decl[1]!, st.span, decl[2] !== undefined ? cleanLabel(decl[2]) : undefined);
        infoOf(id);
        if (decl[3] && !decl[4]) block = { id, span: st.span };
        continue;
      }
      const ann = ANNOTATION.exec(t);
      if (ann) {
        if (!ann[2]) throw new ParseFailure(`annotation <<${ann[1]}>> must name its class, e.g. \`<<${ann[1]}>> Shape\``, st.span.start);
        infoOf(declare(g, ann[2], st.span)).annotations.push(ann[1]!.trim());
        continue;
      }
      const rel = REL.exec(t);
      if (rel) {
        if (rel[3] === "()" || rel[5] === "()") lollipops++;
        g.edge(relationship(g, rel, st));
        continue;
      }
      const ml = MEMBER_LINE.exec(t);
      if (ml) {
        infoOf(declare(g, ml[1]!, st.span)).members.push(member(ml[2]!));
        continue;
      }
      const only = NAME_ONLY.exec(t);
      if (only) {
        declare(g, only[1]!, st.span);
        continue;
      }
      throw new ParseFailure(`can't read "${t.slice(0, 40)}"`, st.span.start);
    }
    if (block) return fail(source, `the member block of "${block.id}" is never closed with \`}\``, block.span.start);
    if (namespaceOpen) return fail(source, "a namespace is never closed with `}`", namespaceOpen.start);
    for (const [id, { annotations, members }] of info) {
      const n = g.node(id);
      if (!n || (!annotations.length && !members.length)) continue;
      const lines = [...annotations.map((a) => `«${a}»`), ...(annotations.length && members.length ? [""] : []), ...members.map((m) => `- \`${m.replaceAll("`", "'")}\``)];
      n.body = { type: "text", markdown: lines.join("\n") };
    }
    if (notes) g.notes.push(`${notes} note${notes === 1 ? "" : "s"} skipped — notes aren't converted`);
    if (styled) g.notes.push(`${styled} styling line${styled === 1 ? "" : "s"} ignored — the canvas uses its own styling`);
    if (interactive) g.notes.push(`${interactive} click/link line${interactive === 1 ? "" : "s"} ignored`);
    if (lollipops) g.notes.push(`${lollipops} lollipop interface link${lollipops === 1 ? "" : "s"} drawn as plain links`);
    return { ok: true, graph: g.build() };
  } catch (e) {
    if (e instanceof ParseFailure) return fail(source, e.message, e.offset);
    return fail(source, `unexpected parser failure: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
}

function fail(source: string, message: string, offset: number): ParseResult {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "class", message: `line ${line}: ${message}`, line, column } };
}

/** `A~T~` → id `A`, shown as `A<T>`; a backtick name keeps its text. */
function nameParts(raw: string): { id: string; display: string } {
  if (raw.startsWith("`")) {
    const text = raw.slice(1, -1);
    return { id: text, display: text };
  }
  const generic = /^([^~]+)~([^~]+)~$/.exec(raw);
  return generic ? { id: generic[1]!, display: `${generic[1]}<${generic[2]!.replace(/~/g, "")}>` } : { id: raw, display: raw };
}

/** Records a class mention and returns its id. The first display name (or an explicit label) wins. */
function declare(g: GraphBuilder, raw: string, span: Span, label?: string): string {
  const { id, display } = nameParts(raw);
  const shown = label || (display !== id ? display : undefined);
  g.mention(id, span, shown ? { label: shown, shape: "rect" } : g.isDefined(id) ? undefined : { shape: "rect" });
  return id;
}

/** A member as written, with generics shown as `<T>`. */
function member(raw: string): string {
  return raw.trim().replace(/~([^~]*)~/g, "<$1>");
}

type Kind = "inheritance" | "realization" | "composition" | "aggregation" | "association" | "dependency" | "link";

/** Default labels, from the `from` end's point of view. */
const LABELS: Record<Kind, string | undefined> = {
  inheritance: "extends",
  realization: "implements",
  composition: "composed of",
  aggregation: "has",
  association: undefined,
  dependency: "uses",
  link: undefined,
};

function relationship(g: GraphBuilder, m: RegExpExecArray, st: Statement): GraphEdge {
  const left = declare(g, m[1]!, st.span);
  const right = declare(g, m[7]!, st.span);
  const [leftCard, leftHead, line, rightHead, rightCard] = [m[2], m[3], m[4], m[5], m[6]];
  const dotted = line === "..";
  const text = m[8] !== undefined ? cleanLabel(m[8]) : "";

  // Which end the relationship "points" at, and what it is. Inheritance and
  // realization point from the child to its parent (the triangle end);
  // composition and aggregation from the whole (the diamond end) to the part.
  const headOf = (h: string | undefined): Kind | null => {
    if (h === "<|" || h === "|>") return dotted ? "realization" : "inheritance";
    if (h === "*") return "composition";
    if (h === "o") return "aggregation";
    if (h === "<" || h === ">") return dotted ? "dependency" : "association";
    return null;
  };
  const lk = headOf(leftHead);
  const rk = headOf(rightHead);
  let kind: Kind = lk ?? rk ?? "link";
  // Triangles and arrows point *at* the target; diamonds sit *on* the whole.
  let [from, to] = [left, right];
  let [fromCard, toCard] = [leftCard, rightCard];
  const pointsLeft = lk === "inheritance" || lk === "realization" || lk === "association" || lk === "dependency";
  const wholeOnRight = !lk && (rk === "composition" || rk === "aggregation");
  if (pointsLeft || wholeOnRight) {
    [from, to] = [right, left];
    [fromCard, toCard] = [rightCard, leftCard];
  }
  if (lk && rk && lk !== rk) kind = lk;
  const cards = fromCard || toCard ? ` (${fromCard || "?"} to ${toCard || "?"})` : "";
  const base = text || LABELS[kind] || "";
  const label = `${base}${cards}`.trim();
  return {
    from,
    to,
    ...(label ? { label } : {}),
    line: dotted ? "dotted" : "solid",
    arrow: kind === "link" ? "none" : "arrow",
    bidirectional: !!(lk && rk),
    relation: kind === "inheritance" || kind === "realization" ? "implements" : kind === "dependency" ? "depends_on" : "relates_to",
    span: st.span,
  };
}
