/**
 * A small hand-written parser for Mermaid state diagrams (`stateDiagram` /
 * `stateDiagram-v2`) into the same `MermaidGraph` as flowcharts. Supported:
 *
 * - transitions `A --> B` and `A --> B : label`
 * - `[*]` start/end pseudo-states, one pair per scope (the root or a
 *   composite state), drawn as small circles labelled Start / End
 * - `state "Description" as A`, `A : description` (description lines become
 *   the label), `state A <<choice>>` (a diamond) / `<<fork>>` / `<<join>>`
 * - composite states `state A { … }` (nested allowed) → subgraphs
 * - `direction`, `%%` comments; `note …` (single-line and `end note`
 *   blocks), `classDef`/`class`/`style`/`:::class`, and the `--` concurrency
 *   separator are read past and reported as notes
 */
import { GraphBuilder, normaliseDirection } from "./graphBuilder";
import { cleanLabel, lineColumn, readFrontmatter, splitStatements, type Statement } from "./source";
import type { ParseResult } from "./types";

class ParseFailure {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** A state id: anything but whitespace, `:`, braces, quotes and `-->`-starting dashes. */
const STATE_ID = /^[\p{L}\p{N}_$.]+(?:-[\p{L}\p{N}_$.]+)*$/u;

export function parseState(source: string): ParseResult {
  const g = new GraphBuilder("state");
  const descriptions = new Map<string, string[]>();
  try {
    const front = readFrontmatter(source);
    if (front.title) g.title = front.title;
    const statements = splitStatements(source, front.bodyStart);
    const header = statements[0];
    if (!header || !/^stateDiagram(?:-v2)?$/.test(header.text)) return fail(source, "expected a `stateDiagram` or `stateDiagram-v2` header", header?.span.start ?? 0);
    let inNote = false;
    let notes = 0;
    let styled = 0;
    let concurrency = 0;
    for (const st of statements.slice(1)) {
      const t = st.text;
      if (inNote) {
        if (/^end\s+note$/.test(t)) inNote = false;
        continue;
      }
      if (/^note\s/.test(t)) {
        notes++;
        if (!t.includes(":")) inNote = true;
        continue;
      }
      if (/^(?:classDef|class|style)\s+\S/.test(t) || /^(?:accTitle|accDescr)\s*[:{]/.test(t)) {
        if (/^accTitle\s*:/.test(t) && !g.title) g.title = cleanLabel(t.replace(/^accTitle\s*:/, ""));
        else styled++;
        continue;
      }
      if (t === "--") {
        concurrency++;
        continue;
      }
      statement(g, st, descriptions);
    }
    if (inNote) return fail(source, "a `note` block is never closed with `end note`", source.length);
    const open = g.currentSubgraph;
    if (open) return fail(source, `composite state "${open.title}" is never closed with \`}\``, open.span.start);
    for (const [id, lines] of descriptions) {
      const n = g.node(id);
      if (n && n.shape !== "start" && n.shape !== "end") n.label = lines.join("\n");
    }
    if (notes) g.notes.push(`${notes} note${notes === 1 ? "" : "s"} skipped — notes aren't converted`);
    if (styled) g.notes.push(`${styled} styling line${styled === 1 ? "" : "s"} ignored — the canvas uses its own styling`);
    if (concurrency) g.notes.push("concurrent regions (`--`) are shown as one region");
    return { ok: true, graph: g.build() };
  } catch (e) {
    if (e instanceof ParseFailure) return fail(source, e.message, e.offset);
    return fail(source, `unexpected parser failure: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
}

function fail(source: string, message: string, offset: number): ParseResult {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "state", message: `line ${line}: ${message}`, line, column } };
}

function statement(g: GraphBuilder, st: Statement, descriptions: Map<string, string[]>): void {
  const t = st.text;
  const span = st.span;
  if (t === "}") {
    if (!g.closeSubgraph(span.end)) throw new ParseFailure("`}` without an open composite state", span.start);
    return;
  }
  const dm = /^direction\s+(\S+)$/.exec(t);
  if (dm) {
    if (!/^(TB|TD|BT|RL|LR)$/i.test(dm[1]!)) throw new ParseFailure(`unknown direction "${dm[1]}"`, span.start);
    const sg = g.currentSubgraph;
    if (sg) sg.direction = normaliseDirection(dm[1]!);
    else g.direction = normaliseDirection(dm[1]!);
    return;
  }
  if (/^state\s/.test(t)) return stateDeclaration(g, st);
  const tm = /^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.*))?$/.exec(t);
  if (tm) {
    const from = endpoint(g, tm[1]!, "from", span);
    const to = endpoint(g, tm[2]!, "to", span);
    const label = tm[3] !== undefined ? cleanLabel(tm[3]) : "";
    g.edge({ from, to, line: "solid", arrow: "arrow", bidirectional: false, span, ...(label ? { label } : {}) });
    return;
  }
  const descm = /^([^\s:]+)\s*:\s*(.*)$/.exec(t);
  if (descm) {
    const id = stripClass(descm[1]!);
    if (!STATE_ID.test(id)) throw new ParseFailure(`"${id}" isn't a valid state id`, span.start);
    g.mention(id, span, { shape: "round" });
    const text = cleanLabel(descm[2]!);
    if (text) descriptions.set(id, [...(descriptions.get(id) ?? []), text]);
    return;
  }
  const id = stripClass(t);
  if (STATE_ID.test(id)) {
    g.mention(id, span, { shape: "round" });
    return;
  }
  throw new ParseFailure(`can't read "${t.slice(0, 40)}"`, span.start);
}

/** `state …` forms: alias, stereotype, composite opener. */
function stateDeclaration(g: GraphBuilder, st: Statement): void {
  const span = st.span;
  let rest = st.text.replace(/^state\s+/, "").trim();
  const opensComposite = rest.endsWith("{");
  if (opensComposite) rest = rest.slice(0, -1).trim();
  let id: string;
  let label: string | undefined;
  const alias = /^"([^"]*)"\s+as\s+(\S+)$/.exec(rest) ?? /^(\S+)\s+as\s+"([^"]*)"$/.exec(rest);
  if (alias) {
    const quotedFirst = rest.startsWith('"');
    id = stripClass(quotedFirst ? alias[2]! : alias[1]!);
    label = cleanLabel(quotedFirst ? alias[1]! : alias[2]!);
  } else {
    const sm = /^(\S+)(?:\s+<<(choice|fork|join)>>)?$/.exec(rest);
    if (!sm) throw new ParseFailure(`can't read state declaration "${st.text.slice(0, 40)}"`, span.start);
    id = stripClass(sm[1]!);
    if (sm[2]) {
      if (opensComposite) throw new ParseFailure(`a <<${sm[2]}>> state can't be composite`, span.start);
      g.mention(id, span, sm[2] === "choice" ? { shape: "choice", label: "" } : { shape: "fork", label: sm[2] });
      return;
    }
  }
  if (!STATE_ID.test(id)) throw new ParseFailure(`"${id}" isn't a valid state id`, span.start);
  if (opensComposite) {
    g.openSubgraph(id, label || id, span.start);
    return;
  }
  g.mention(id, span, { shape: "round", ...(label ? { label } : {}) });
}

/** A transition endpoint: `[*]` becomes this scope's start (as a source) or end (as a target) pseudo-state. */
function endpoint(g: GraphBuilder, raw: string, side: "from" | "to", span: { start: number; end: number }): string {
  const id = stripClass(raw.trim());
  if (id === "[*]") {
    const scope = g.currentSubgraph?.id;
    const pseudo = `${side === "from" ? "_start" : "_end"}${scope ? `_${scope}` : ""}`;
    g.mention(pseudo, span, side === "from" ? { shape: "start", label: "Start" } : { shape: "end", label: "End" });
    return pseudo;
  }
  if (!STATE_ID.test(id)) throw new ParseFailure(`"${id}" isn't a valid state id`, span.start);
  g.mention(id, span, g.isDefined(id) ? undefined : { shape: "round" });
  return id;
}

function stripClass(id: string): string {
  return id.replace(/:::[\w-]+$/, "");
}
