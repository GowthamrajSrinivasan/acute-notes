/**
 * Study Mode Phase 1 (`.ai/docs/study-mode-implementation-plan.md` §1): stable concept identity. Pure — no store, no
 * React, no model.
 *
 * A concept is **the source passages a card teaches, not the card** (SM-D1): `c:<sourceId>:<units sorted by counter>`.
 * It survives regeneration, claim-level patches, user-wording merges and multi-location sync, because all of those keep
 * the cited unit ids. A note without a source or citations is a **local concept** (`l:<canvasId>:<objectId>`): it resets
 * if the card is recreated, is never remapped, and never leaves the device.
 *
 * `remapConcept` carries a concept across source versions through the stored one-step lineages, reading them the way
 * the citation update does (`ai/reconcile/citations.ts` `indexLineage` / `decide`), so a concept and the card citing
 * the same units always agree (parity tested):
 *
 * | lineage of the cited units | state | key |
 * |---|---|---|
 * | all unchanged (moved or not) | `kept` | same |
 * | some changed, none removed or ambiguous | `source_changed` | same (ids carry) |
 * | some removed, the rest survive | `source_changed` + `narrowed` | over the survivors; `carriedFrom` the old key |
 * | any cited unit is a candidate of an `ambiguous` entry | `needs_review` | old key, never remapped automatically |
 * | all removed | `retired` | old key |
 * | a step's lineage missing or not the expected step | `needs_review` (`lineage_gap`) | old key, never assumed unchanged |
 * | the source is gone from this device | `retired` (`source_missing`) | old key |
 *
 * Precedence: `retired` > `needs_review` > `source_changed` > `kept`. A unit with no entry in a valid lineage counts as
 * removed, never as unchanged (as `decide` does). Unlike the experiment's `remapRecord`, an ambiguous unit is found
 * through `candidates`, and a concept retires only when **all** its units are gone.
 *
 * This module never reads card review state or any guarded provenance field (`provenanceGuard.test.ts`): it takes unit
 * ids and lineages only.
 */
import { cyrb53 } from "@/ai/content/fingerprint";
import type { Lineage, LineageEntry } from "@/ai/fidelity/contracts";

/** Above this many units, the key is a hash of the list (the full list stays in the stored record). */
export const MAX_KEY_UNITS = 16;

const counter = (id: string) => {
  const m = /^u(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

/** Unit ids, de-duplicated and sorted by their counter (`u9` before `u10`; anything else last, then by text). */
export function sortUnits(units: readonly string[]): string[] {
  return [...new Set(units)].sort((a, b) => counter(a) - counter(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The concept key of a set of a source's units. */
export function conceptKey(sourceId: string, units: readonly string[]): string {
  const sorted = sortUnits(units);
  if (!sorted.length) throw new Error("a source concept needs at least one unit");
  const joined = sorted.join("+");
  return sorted.length > MAX_KEY_UNITS ? `c:${sourceId}:h${cyrb53(joined)}` : `c:${sourceId}:${joined}`;
}

/** A local concept: a note with no source or no citations. */
export const localConceptKey = (canvasId: string, objectId: string) => `l:${canvasId}:${objectId}`;

export const isLocalConcept = (key: string) => key.startsWith("l:");

export type Concept =
  | { key: string; local: false; sourceId: string; units: string[]; sourceVersion: number }
  | { key: string; local: true };

/** What Study needs of a note (`notesModel.ts` `Note`): its id, citations and the source version they belong to. */
export interface ConceptNote {
  id: string;
  cites: readonly string[];
  source?: { sourceId: string; version: number };
}

/** The concept a note teaches: its cited units (all of them, not only the first), else a local concept. */
export function conceptOfNote(note: ConceptNote, canvasId: string): Concept {
  const units = sortUnits(note.cites);
  if (!note.source || !units.length) return { key: localConceptKey(canvasId, note.id), local: true };
  return { key: conceptKey(note.source.sourceId, units), local: false, sourceId: note.source.sourceId, units, sourceVersion: note.source.version };
}

export type ConceptState = "kept" | "source_changed" | "needs_review" | "retired";
export type ConceptReason = "narrowed" | "lineage_gap" | "source_missing";

export interface RemappedConcept {
  state: ConceptState;
  reason?: ConceptReason;
  /** The key afterwards (the old key unless the units were narrowed). */
  key: string;
  units: string[];
  /** The version `units` belong to: the target when the remap went through, else where it stopped. */
  sourceVersion: number;
  /** The key before a narrowing. */
  carriedFrom?: string;
}

export interface RemapInput {
  /** The lineage of each step after the concept's version, by `toVersion` (missing steps are allowed: a gap). */
  lineageOf(toVersion: number): Lineage | undefined;
  /** The version to bring the concept to (the source's latest, or the version a live card cites). */
  targetVersion: number;
  /** False when the source no longer exists on this device. */
  sourceExists?: boolean;
}

/** Old unit id → its entry, and old unit id → the ambiguous entries naming it as a candidate (as `indexLineage`). */
function indexLineage(lineage: Lineage): { byOld: Map<string, LineageEntry>; ambiguousOf: Map<string, LineageEntry[]> } {
  const byOld = new Map<string, LineageEntry>();
  const ambiguousOf = new Map<string, LineageEntry[]>();
  for (const e of lineage.entries) {
    if (e.state === "ambiguous") for (const c of e.candidates ?? []) ambiguousOf.set(c, [...(ambiguousOf.get(c) ?? []), e]);
    else if (e.from) byOld.set(e.from, e);
  }
  return { byOld, ambiguousOf };
}

/** See module doc. Never throws; a local concept comes back unchanged. */
export function remapConcept(concept: Concept, input: RemapInput): RemappedConcept {
  if (concept.local) return { state: "kept", key: concept.key, units: [], sourceVersion: 0 };
  const stay = (state: ConceptState, reason?: ConceptReason, at = concept.sourceVersion): RemappedConcept => ({ state, ...(reason ? { reason } : {}), key: concept.key, units: concept.units, sourceVersion: at });
  if (input.sourceExists === false) return stay("retired", "source_missing");
  if (input.targetVersion <= concept.sourceVersion) return stay("kept");

  let units = [...concept.units];
  let changed = false;
  let removed = false;
  for (let v = concept.sourceVersion + 1; v <= input.targetVersion; v++) {
    const lineage = input.lineageOf(v);
    if (!lineage || !lineage.entries.length || lineage.fromVersion !== v - 1 || lineage.toVersion !== v) return stay("needs_review", "lineage_gap");
    const { byOld, ambiguousOf } = indexLineage(lineage);
    const next: string[] = [];
    for (const id of units) {
      if (ambiguousOf.get(id)?.length) return stay("needs_review");
      const e = byOld.get(id);
      if (!e || e.state === "removed" || !e.to) {
        removed = true;
        continue;
      }
      if (e.state === "changed") changed = true;
      next.push(e.to);
    }
    if (!next.length) return stay("retired");
    units = next;
  }

  const target = input.targetVersion;
  if (removed) {
    const sorted = sortUnits(units);
    return { state: "source_changed", reason: "narrowed", key: conceptKey(concept.sourceId, sorted), units: sorted, sourceVersion: target, carriedFrom: concept.key };
  }
  const sorted = sortUnits(units);
  const key = conceptKey(concept.sourceId, sorted);
  return { state: changed ? "source_changed" : "kept", key, units: sorted, sourceVersion: target, ...(key !== concept.key ? { carriedFrom: concept.key } : {}) };
}
