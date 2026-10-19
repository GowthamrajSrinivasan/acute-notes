/**
 * Decoder for the React Router "turbo-stream" payload ChatGPT share pages embed as
 * `window.__reactRouterContext.streamController.enqueue("…")`. A chunk is a flat JSON array: an object is
 * `{"_<k>": <v>}` where `<k>` indexes the key string and `<v>` the value; an array lists value indices; negative
 * numbers are constants. Only the shapes ChatGPT shares use are decoded; unknown tagged values come back as null.
 */

const HOLE = -1;
const NAN = -2;
const NEGATIVE_INFINITY = -3;
const NEGATIVE_ZERO = -4;
const NULL = -5;
const POSITIVE_INFINITY = -6;
const UNDEFINED = -7;

const MAX_DEPTH = 200;

/** The decoded value at the root of one chunk. Throws on malformed input. */
export function decodeTurboChunk(json: string): unknown {
  const table = JSON.parse(json) as unknown;
  if (!Array.isArray(table) || !table.length) throw new Error("Not a turbo-stream chunk.");
  const memo = new Map<number, unknown>();

  const at = (index: number, depth: number): unknown => {
    if (index < 0) {
      switch (index) {
        case NAN:
          return NaN;
        case NEGATIVE_INFINITY:
          return -Infinity;
        case NEGATIVE_ZERO:
          return -0;
        case POSITIVE_INFINITY:
          return Infinity;
        case HOLE:
        case UNDEFINED:
          return undefined;
        case NULL:
        default:
          return null;
      }
    }
    if (depth > MAX_DEPTH) throw new Error("Turbo-stream chunk is nested too deeply.");
    if (memo.has(index)) return memo.get(index);
    const raw = table[index];
    let out: unknown;
    if (Array.isArray(raw)) {
      if (typeof raw[0] === "string" && raw.length >= 1 && TAGS.has(raw[0])) {
        out = tagged(raw, depth);
      } else {
        const list: unknown[] = [];
        memo.set(index, list);
        for (const item of raw) list.push(typeof item === "number" ? at(item, depth + 1) : null);
        return list;
      }
    } else if (raw && typeof raw === "object") {
      const obj: Record<string, unknown> = {};
      memo.set(index, obj);
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!k.startsWith("_") || typeof v !== "number") continue;
        const keyIndex = Number(k.slice(1));
        const key = table[keyIndex];
        if (typeof key === "string" && key !== "__proto__") obj[key] = at(v, depth + 1);
      }
      return obj;
    } else {
      out = raw;
    }
    memo.set(index, out);
    return out;
  };

  const tagged = (raw: unknown[], depth: number): unknown => {
    switch (raw[0]) {
      case "D":
        return typeof raw[1] === "number" ? new Date(raw[1]) : null;
      case "Map": {
        const map = new Map<unknown, unknown>();
        for (let i = 1; i + 1 < raw.length; i += 2) map.set(at(raw[i] as number, depth + 1), at(raw[i + 1] as number, depth + 1));
        return map;
      }
      case "Set":
        return new Set(raw.slice(1).map((i) => at(i as number, depth + 1)));
      default:
        return null;
    }
  };
  const TAGS = new Set(["D", "Map", "Set", "B", "K", "Y", "S", "R", "E", "P"]);

  return at(0, 0);
}

/** The string arguments of every `streamController.enqueue("…")` call in a share page's HTML, in order. */
export function streamChunks(html: string): string[] {
  const chunks: string[] = [];
  const pattern = /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    try {
      const value = JSON.parse(m[1]!) as unknown;
      if (typeof value === "string") chunks.push(value);
    } catch {
      /* a chunk that isn't a JSON string literal can't be ours */
    }
  }
  return chunks;
}
