/**
 * "What changed" (knowledge-notes-plan §5.1, §3.1): the lineage from the card's version to the latest, in words.
 * The panel shows the card's version, so it has the old units' text: changed, removed, ambiguous and moved entries
 * name the passage they started from; added units exist only in the latest version and are counted.
 */
import type { Lineage, LineageState, SourceUnit, UnitId } from "@/ai/fidelity/contracts";

export interface ChangeItem {
  state: Exclude<LineageState, "unchanged" | "added"> | "moved";
  /** The unit in the card's version. */
  unit: UnitId;
  /** Its text in the card's version, shortened. */
  excerpt: string;
}

export interface ChangeSummary {
  changed: number;
  removed: number;
  ambiguous: number;
  moved: number;
  added: number;
  items: ChangeItem[];
}

export const CHANGE_LABEL: Record<ChangeItem["state"], string> = {
  changed: "Changed",
  removed: "Removed",
  ambiguous: "Unclear match",
  moved: "Moved",
};

export function excerptOf(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function summarizeLineage(lineage: Lineage | undefined, unitById: ReadonlyMap<UnitId, SourceUnit>): ChangeSummary {
  const summary: ChangeSummary = { changed: 0, removed: 0, ambiguous: 0, moved: 0, added: 0, items: [] };
  if (!lineage) return summary;
  for (const e of lineage.entries) {
    if (e.state === "added") {
      summary.added += 1;
      continue;
    }
    const state: ChangeItem["state"] | null = e.state === "unchanged" ? (e.moved ? "moved" : null) : e.state;
    if (!state) continue;
    summary[state] += 1;
    // For ambiguous entries the old unit may be absent; its candidates are the card version's units.
    const from = e.from ?? e.candidates?.find((c) => unitById.has(c));
    const unit = from ? unitById.get(from) : undefined;
    if (unit) summary.items.push({ state, unit: unit.id, excerpt: excerptOf(unit.text) });
  }
  summary.items.sort((a, b) => (unitById.get(a.unit)?.span.start ?? 0) - (unitById.get(b.unit)?.span.start ?? 0));
  return summary;
}

/** "3 changed · 1 removed · 2 added", or "" when nothing changed. */
export function describeChanges(s: ChangeSummary): string {
  const parts: string[] = [];
  if (s.changed) parts.push(`${s.changed} changed`);
  if (s.moved) parts.push(`${s.moved} moved`);
  if (s.removed) parts.push(`${s.removed} removed`);
  if (s.ambiguous) parts.push(`${s.ambiguous} unclear`);
  if (s.added) parts.push(`${s.added} added`);
  return parts.join(" · ");
}
