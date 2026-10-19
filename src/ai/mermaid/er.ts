/**
 * A small hand-written parser for Mermaid entity-relationship diagrams
 * (`erDiagram`) into a `MermaidGraph`. Supported:
 *
 * - relationships `A ||--o{ B : label`, in symbol form (`|o` `||` `}o` `}|`
 *   on the left, `o|` `||` `o{` `|{` on the right, `--` identifying or `..`
 *   non-identifying) or word form (`A one or more to zero or many B : label`)
 * - attribute blocks `A { type name PK, FK "comment" }` → the entity becomes a
 *   table card (Type, Name, and Key / Comment columns when any are given)
 * - entity aliases `A["Label"]` / `A[Label]`, quoted entity names, `direction`
 * - `%%` comments; `classDef`/`class`/`style`/`:::class` are read past and reported
 *
 * Each relationship becomes a `relates_to` link from the first entity to the
 * second, labelled with its label and cardinality, e.g. "places (1 to 0..*)".
 */
import { GraphBuilder, normaliseDirection } from "./graphBuilder";
import { cleanLabel, lineColumn, readFrontmatter, splitStatements, type Statement } from "./source";
import type { ParseResult, Span } from "./types";

class ParseFailure {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** An entity name: word characters and inner hyphens, or a quoted name. */
const NAME = String.raw`(?:"[^"]+"|[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)`;
/** An entity with an optional alias: `NAME`, `NAME["Label"]`, `NAME[Label]`. */
const ENTITY = new RegExp(String.raw`^(${NAME})(?:\[("[^"]*"|[^\]]*)\])?(?::::[\w-]+)?$`, "u");

/** Left-end markers (read from the first entity's side) → cardinality. */
const LEFT: Record<string, string> = { "|o": "0..1", "||": "1", "}o": "0..*", "}|": "1..*" };
/** Right-end markers (read from the second entity's side) → cardinality. */
const RIGHT: Record<string, string> = { "o|": "0..1", "||": "1", "o{": "0..*", "|{": "1..*" };
const SYMBOL_REL = new RegExp(String.raw`^(${NAME}(?:\[[^\]]*\])?)\s*(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s*(${NAME}(?:\[[^\]]*\])?)\s*(?::\s*(.*))?$`, "u");

/** Word-form cardinalities (Mermaid's aliases), longest first. */
const WORDS: readonly (readonly [string, string])[] = [
  ["one or zero", "0..1"],
  ["zero or one", "0..1"],
  ["one or more", "1..*"],
  ["one or many", "1..*"],
  ["zero or more", "0..*"],
  ["zero or many", "0..*"],
  ["only one", "1"],
  ["many(1)", "1..*"],
  ["many(0)", "0..*"],
  ["1+", "1..*"],
  ["0+", "0..*"],
  ["1", "1"],
];
const WORD = WORDS.map(([w]) => w.replace(/[()+]/g, "\\$&")).join("|");
const WORD_REL = new RegExp(String.raw`^(${NAME}(?:\[[^\]]*\])?)\s+(${WORD})\s+(to|optionally to)\s+(${WORD})\s+(${NAME}(?:\[[^\]]*\])?)\s*(?::\s*(.*))?$`, "u");

const KEY = /^(PK|FK|UK)$/;

interface Attribute {
  type: string;
  name: string;
  keys: string[];
  comment?: string;
}

export function parseEr(source: string): ParseResult {
  const g = new GraphBuilder("er");
  const attributes = new Map<string, Attribute[]>();
  try {
    const front = readFrontmatter(source);
    if (front.title) g.title = front.title;
    const statements = splitStatements(source, front.bodyStart);
    const header = statements[0];
    if (!header || !/^erDiagram$/.test(header.text)) return fail(source, "expected an `erDiagram` header", header?.span.start ?? 0);
    let block: { id: string; span: Span } | null = null;
    let styled = 0;
    for (const st of statements.slice(1)) {
      const t = st.text;
      if (block) {
        if (t === "}") {
          block = null;
          continue;
        }
        const list = attributes.get(block.id) ?? [];
        list.push(attribute(st));
        attributes.set(block.id, list);
        continue;
      }
      if (/^(?:classDef|class|style)\s+\S/.test(t) || /^(?:accTitle|accDescr)\s*[:{]/.test(t)) {
        if (/^accTitle\s*:/.test(t) && !g.title) g.title = cleanLabel(t.replace(/^accTitle\s*:/, ""));
        else styled++;
        continue;
      }
      const dm = /^direction\s+(\S+)$/.exec(t);
      if (dm) {
        if (!/^(TB|TD|BT|RL|LR)$/i.test(dm[1]!)) throw new ParseFailure(`unknown direction "${dm[1]}"`, st.span.start);
        g.direction = normaliseDirection(dm[1]!);
        continue;
      }
      const opened = /^(.+?)\s*\{\s*(\})?$/.exec(t);
      if (opened) {
        const id = entity(g, opened[1]!, st.span);
        if (!attributes.has(id)) attributes.set(id, []);
        if (!opened[2]) block = { id, span: st.span };
        continue;
      }
      if (relationship(g, st)) continue;
      entity(g, t, st.span);
    }
    if (block) return fail(source, `the attribute block of "${block.id}" is never closed with \`}\``, block.span.start);
    for (const [id, list] of attributes) {
      const n = g.node(id);
      if (n && list.length) n.body = table(list);
    }
    if (styled) g.notes.push(`${styled} styling line${styled === 1 ? "" : "s"} ignored — the canvas uses its own styling`);
    return { ok: true, graph: g.build() };
  } catch (e) {
    if (e instanceof ParseFailure) return fail(source, e.message, e.offset);
    return fail(source, `unexpected parser failure: ${e instanceof Error ? e.message : String(e)}`, 0);
  }
}

function fail(source: string, message: string, offset: number): ParseResult {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "er", message: `line ${line}: ${message}`, line, column } };
}

/** Records an entity mention (with its alias, if any) and returns its id. */
function entity(g: GraphBuilder, raw: string, span: Span): string {
  const m = ENTITY.exec(raw.trim());
  if (!m) throw new ParseFailure(`can't read "${raw.trim().slice(0, 40)}"`, span.start);
  const id = unquote(m[1]!);
  const alias = m[2] !== undefined ? cleanLabel(m[2]) : "";
  g.mention(id, span, alias ? { label: alias, shape: "rect" } : g.isDefined(id) ? undefined : { shape: "rect" });
  return id;
}

function relationship(g: GraphBuilder, st: Statement): boolean {
  const sym = SYMBOL_REL.exec(st.text);
  const word = sym ? null : WORD_REL.exec(st.text);
  if (!sym && !word) return false;
  const [fromRaw, fromCard, dotted, toCard, toRaw, labelRaw] = sym
    ? [sym[1]!, LEFT[sym[2]!]!, sym[3] === "..", RIGHT[sym[4]!]!, sym[5]!, sym[6]]
    : [word![1]!, cardinality(word![2]!), word![3] === "optionally to", cardinality(word![4]!), word![5]!, word![6]];
  const from = entity(g, fromRaw, st.span);
  const to = entity(g, toRaw, st.span);
  const text = labelRaw !== undefined ? cleanLabel(labelRaw) : "";
  const label = `${text ? `${text} ` : ""}(${fromCard} to ${toCard})`;
  g.edge({ from, to, label, line: dotted ? "dotted" : "solid", arrow: "none", bidirectional: false, relation: "relates_to", span: st.span });
  return true;
}

function cardinality(word: string): string {
  return WORDS.find(([w]) => w === word)![1];
}

/** `type name [PK|FK|UK[, …]] ["comment"]`. */
function attribute(st: Statement): Attribute {
  const m = /^(\S+)\s+(\S+)((?:\s*,?\s*(?:PK|FK|UK))*)\s*(?:"([^"]*)")?$/.exec(st.text);
  if (!m) throw new ParseFailure(`can't read attribute "${st.text.slice(0, 40)}" (expected \`type name\`)`, st.span.start);
  const keys = m[3]!
    .split(/[\s,]+/)
    .filter((k) => KEY.test(k));
  return { type: m[1]!.replace(/~([^~]*)~/g, "<$1>"), name: m[2]!, keys, ...(m[4] ? { comment: cleanLabel(m[4]) } : {}) };
}

function table(list: readonly Attribute[]): { type: "table"; columns: string[]; rows: string[][] } {
  const withKeys = list.some((a) => a.keys.length);
  const withComments = list.some((a) => a.comment);
  const columns = ["Type", "Name", ...(withKeys ? ["Key"] : []), ...(withComments ? ["Comment"] : [])];
  const rows = list.map((a) => [a.type, a.name, ...(withKeys ? [a.keys.join(", ")] : []), ...(withComments ? [a.comment ?? ""] : [])]);
  return { type: "table", columns, rows };
}

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}
