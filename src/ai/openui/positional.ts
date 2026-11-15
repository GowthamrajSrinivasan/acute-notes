/**
 * OpenUI Lang arguments are positional, in each component's prop order. Models sometimes write keyword arguments
 * instead (`IdeaCard(title="…", body="…")` — seen live with google/gemini-2.5-flash on 2026-11-13), which the parser
 * reads positionally, so every value lands in the wrong prop and the card renders nothing.
 *
 * `toPositional` rewrites keyword calls of known components into positional ones, using the prop order from the
 * library's JSON Schema (`$defs[Name].properties`). Unknown keywords are dropped; gaps become `null`; trailing nulls are
 * trimmed. Positional calls, strings and anything it doesn't understand are left exactly as they were. Nested calls are
 * rewritten too. Pure, no model.
 */

type Schema = { $defs?: Record<string, { properties?: Record<string, unknown> }> };

/** Each component's prop names in positional order. */
export function propOrders(schema: unknown): Map<string, string[]> {
  const defs = (schema as Schema).$defs ?? {};
  return new Map(Object.entries(defs).map(([name, def]) => [name, Object.keys(def.properties ?? {})]));
}

const IDENT = /[A-Za-z_]/;
const IDENT_REST = /[\w]/;
const KEYWORD = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/;

/** End index (exclusive) of the string literal starting at `i` (a `"` or `'`). */
function skipString(s: string, i: number): number {
  const quote = s[i];
  let j = i + 1;
  while (j < s.length && s[j] !== quote) j += s[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, s.length);
}

/** Index of the bracket closing the one opened just before `i`, or -1 (incomplete, e.g. mid-stream). */
function closing(s: string, i: number): number {
  let depth = 1;
  for (let j = i; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      j = skipString(s, j) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Splits an argument list on its top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (c === '"' || c === "'") {
      j = skipString(s, j) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, j));
      start = j + 1;
    }
  }
  if (s.slice(start).trim()) out.push(s.slice(start));
  return out;
}

export function toPositional(lang: string, orders: Map<string, string[]>): string {
  let out = "";
  let i = 0;
  while (i < lang.length) {
    const c = lang[i]!;
    if (c === '"' || c === "'") {
      const end = skipString(lang, i);
      out += lang.slice(i, end);
      i = end;
      continue;
    }
    if (IDENT.test(c) && (i === 0 || !IDENT_REST.test(lang[i - 1]!))) {
      let j = i + 1;
      while (j < lang.length && IDENT_REST.test(lang[j]!)) j++;
      const name = lang.slice(i, j);
      const order = orders.get(name);
      if (order && lang[j] === "(") {
        const end = closing(lang, j + 1);
        if (end < 0) {
          // Still streaming: leave the rest untouched until the call closes.
          out += lang.slice(i);
          break;
        }
        out += `${name}(${rewriteArgs(lang.slice(j + 1, end), order, orders)})`;
        i = end + 1;
        continue;
      }
      out += name;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function rewriteArgs(inner: string, order: string[], orders: Map<string, string[]>): string {
  const args = splitArgs(inner).map((a) => toPositional(a, orders));
  const keyed = args.map((a) => KEYWORD.exec(a));
  if (!keyed.some(Boolean)) return args.map((a) => a.trim()).join(", ");
  const slots: (string | undefined)[] = [];
  let next = 0;
  args.forEach((a, k) => {
    const m = keyed[k];
    if (m) {
      const at = order.indexOf(m[1]!);
      if (at >= 0) slots[at] = m[2]!.trim();
    } else {
      // A positional argument before the keywords keeps its place.
      slots[next] = a.trim();
    }
    next = Math.max(next, slots.length);
  });
  const filled = Array.from({ length: slots.length }, (_, k) => slots[k] ?? "null");
  while (filled.length && filled.at(-1) === "null") filled.pop();
  return filled.join(", ");
}
