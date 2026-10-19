/**
 * The analysis check (content fidelity plan, Revision 2, Wave B): deterministic, on a section's raw reply. A plan
 * that only restates the content — no takeaway, no analysis of its own, or (item by item) an analysis that skips
 * most of the items the source names — fails, and the section is generated once more with that feedback; a second
 * failure is reported in the review, never hidden. No model call when it passes.
 */
import type { SectionKind } from "@/ai/visual-plan/sectionKinds";
import { nodeStrings } from "./information";
import type { SourceBlock } from "./sourceBlocks";

/** A note, not a document: "Keep as text" applies only up to this length, and the structure check only above it. */
export const SHORT_SOURCE_CHARS = 300;

/** At most this long; a longer "takeaway" is cut at a word. */
export const TAKEAWAY_MAX = 200;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The section's one-line takeaway from a raw reply (`metadata.takeaway`), trimmed; null when there is none. */
export function takeawayOf(raw: unknown): string | null {
  if (!isObject(raw) || !isObject(raw.metadata)) return null;
  const t = raw.metadata.takeaway;
  if (typeof t !== "string") return null;
  const text = t.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= TAKEAWAY_MAX) return text;
  const cut = text.slice(0, TAKEAWAY_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), TAKEAWAY_MAX / 2))}…`;
}

/** An item id: "D1", "A6", "HK-3", "#25" — how decision tables, response codes and trackers name their rows. */
const ITEM_ID = /^\s*(#?[A-Z]{0,4}-?\d{1,3}[a-z]?)(?=$|[\s:.)—–-])/i;

/** The items a section's source names by id (a table's row keys, a list's leading ids): what its analysis must cover. */
export function itemIds(blocks: readonly SourceBlock[]): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    const keys =
      b.kind === "table"
        ? (b.node.content as { rows: string[][] }).rows.map((r) => r[0] ?? "")
        : b.kind === "list" || b.kind === "checklist"
          ? b.text.split("\n").map((l) => l.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, ""))
          : [];
    for (const k of keys) {
      const m = ITEM_ID.exec(k);
      // A bare number is a count or an ordinal, not a name.
      if (m && /[A-Za-z#]/.test(m[1]!) && !ids.includes(m[1]!.toUpperCase())) ids.push(m[1]!.toUpperCase());
    }
  }
  return ids.length >= 2 ? ids : [];
}

/** Kinds whose analysis goes item by item (a status per decision, per pending item). */
const ITEMISED: readonly SectionKind[] = ["decision", "notes"];
/** The share of named items the analysis must mention. */
const ITEM_COVERAGE = 0.6;

/** Node types that draw structure, not only text. */
const VISUAL_TYPES = new Set(["shape", "table", "todo", "code", "image"]);

/**
 * What a section's raw reply lacks: "a takeaway", "its own analysis", "an analysis line for D3, D5" when an
 * item-by-item section's analysis skips most of the items its source names (`items`), or — with `needsStructure`
 * (a whole document in one section) — "a visual structure" when the plan is only text. Empty when it passes.
 */
export function missingAnalysis(raw: unknown, kind: SectionKind, items: readonly string[] = [], options: { needsStructure?: boolean } = {}): string[] {
  const missing: string[] = [];
  const takeaway = takeawayOf(raw);
  if (!takeaway) missing.push("a takeaway");
  // Supporting detail backs another section up; its takeaway says what it supports.
  if (kind === "supporting") return missing;
  const nodes = isObject(raw) && Array.isArray(raw.nodes) ? raw.nodes : [];
  const analysis = nodes.filter((n) => isObject(n) && n.origin === "analysis");
  if (!analysis.length) {
    missing.push("its own analysis");
    return missing;
  }
  if (options.needsStructure) {
    const relationships = isObject(raw) && Array.isArray(raw.relationships) ? raw.relationships : [];
    const drawn = nodes.some((n) => isObject(n) && typeof n.type === "string" && VISUAL_TYPES.has(n.type)) || relationships.some((r) => isObject(r) && r.type !== "explained_by");
    if (!drawn) missing.push("a visual structure (shapes and links for the components, steps or causes it describes)");
  }
  if (ITEMISED.includes(kind) && items.length) {
    const said = [takeaway ?? "", ...analysis.flatMap(nodeStrings)].join(" ").toUpperCase();
    const skipped = items.filter((id) => !new RegExp(`(^|[^A-Z0-9])${id.replace(/[#-]/g, "\\$&")}(?![A-Z0-9])`).test(said));
    if (items.length - skipped.length < Math.ceil(items.length * ITEM_COVERAGE)) missing.push(`an analysis line for ${skipped.join(", ")}`);
  }
  return missing;
}
