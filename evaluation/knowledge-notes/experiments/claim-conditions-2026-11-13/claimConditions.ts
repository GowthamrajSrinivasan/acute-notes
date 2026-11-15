/**
 * Claim–condition integrity: an OFFLINE prototype (user decision 2026-11-13: "a bounded, offline claim–condition validation
 * prototype; do not activate it in production"). Lives in the experiment folder on purpose: no `src/` contract, no
 * `AIMetadata` or domain-type change, no permanent claim graph. Pure; no model call.
 *
 * Idea: the meaning check judges a card against its cited units and so cannot see a condition stated in *another*
 * sentence. Here the link is explicit: a `ClaimConditionRecord` says "this condition (units X) limits this claim
 * (units Y)", in the source's own unit ids, and the validator checks where the condition ended up in the generated notes.
 *
 * Two separate questions, reported separately:
 *  - integrity (per card): a card stating a claim whose `binding` condition it neither states nor links to;
 *  - coverage (per record): a condition no card in the note set states.
 *
 * Options: `acceptLinks` (default true) counts an explicit link to a carrying card as carrying; `anchored` (default
 * false) counts text evidence only on cards citing the claim's or the condition's units; `citeOnly` ignores text and
 * counts a card as carrying the condition when it cites one of the condition's units (a purely structural check).
 */
import type { Lineage, UnitId } from "@/ai/fidelity/contracts";

export type ConditionKind = "bound" | "precondition" | "exception" | "scope" | "caveat" | "fact";

/**
 * One condition limiting one claim, in source-unit ids.
 *
 * `binding`:
 *  - `"claim"`: the claim's sentence becomes FALSE in a case the condition describes (the stored result is not returned
 *    after 24 hours; an expired copy is not served past 60 seconds). Every card stating the claim must carry the
 *    condition, or link to a card that does.
 *  - `"set"`: the claim stays true without it (versioning really does make assets fresh; the condition adds a scope or a
 *    cost). It must be somewhere in the note set, not necessarily on the claim's card.
 */
export interface ClaimConditionRecord {
  id: string;
  claim: { units: UnitId[]; summary: string };
  condition: { units: UnitId[]; kind: ConditionKind; summary: string };
  binding: "claim" | "set";
  /** Text evidence that a card states the condition: every group must match, any alternative within a group (case-insensitive). */
  evidence: { golden: string } | { groups: string[][] };
  /** Where the record comes from: golden assertion ids and `knowledge.json` `limits` edges. */
  origin: { assertions?: string[]; limits?: string; note?: string };
}

export interface NoteCard {
  key: string;
  title: string;
  body: string;
  detail?: string;
  /** Text of attached extras (Callout, table rows…), read as part of the card. */
  extras?: string[];
  cites: UnitId[];
  /** Keys of cards this card links to explicitly (NoteLink). */
  links?: string[];
}

export type CardOutcome = "carried" | "linked" | "separated" | "absent";

export interface RecordResult {
  id: string;
  binding: "claim" | "set";
  /** Cards that state the condition (by text evidence). */
  carriers: string[];
  /** Carriers that don't cite any of the condition's units (a citation-completeness finding, not an integrity one). */
  carriersUncited: string[];
  /** Cards that state the claim (they cite a claim unit). */
  claimCards: string[];
  perCard: Record<string, CardOutcome>;
  covered: boolean;
}

export interface ValidationResult {
  records: RecordResult[];
  /** Per card: records it fails (binding "claim" only). */
  integrityFlags: Record<string, { record: string; outcome: "separated" | "absent" }[]>;
  /** Records whose condition no card states. */
  coverageGaps: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[“”"’`]/g, (c) => (c === "’" ? "'" : "")).replace(/\s+/g, " ");
export const cardText = (c: NoteCard) => norm([c.title, c.body, c.detail ?? "", ...(c.extras ?? [])].join(" . "));
export const matches = (text: string, groups: string[][]) => groups.every((g) => g.some((alt) => text.includes(norm(alt))));

/** Validates `cards` against `records`. `goldenGroups` resolves `{ golden: id }` evidence to that assertion's `all` groups. */
export function validateClaimConditions(
  cards: readonly NoteCard[],
  records: readonly ClaimConditionRecord[],
  goldenGroups: (assertionId: string) => string[][],
  options: { acceptLinks?: boolean; anchored?: boolean; citeOnly?: boolean } = {},
): ValidationResult {
  const acceptLinks = options.acceptLinks ?? true;
  const text = new Map(cards.map((c) => [c.key, cardText(c)]));
  const results: RecordResult[] = [];
  const integrityFlags: ValidationResult["integrityFlags"] = {};
  for (const r of records) {
    const groups = "golden" in r.evidence ? goldenGroups(r.evidence.golden) : r.evidence.groups;
    // anchored: text evidence counts only on a card citing the claim or the condition (guards against a coincidental match
    // elsewhere in the set, e.g. "up to … 60 seconds" on an unrelated card); it then also requires citations to be complete.
    const near = (c: NoteCard) => !options.anchored || c.cites.some((u) => r.claim.units.includes(u) || r.condition.units.includes(u));
    // citeOnly: no text evidence at all; a card carries the condition when it cites one of the condition's units.
    const carriers = cards
      .filter((c) => (options.citeOnly ? c.cites.some((u) => r.condition.units.includes(u)) : near(c) && matches(text.get(c.key)!, groups)))
      .map((c) => c.key);
    const carrierSet = new Set(carriers);
    const claimCards = cards.filter((c) => c.cites.some((u) => r.claim.units.includes(u))).map((c) => c.key);
    const perCard: Record<string, CardOutcome> = {};
    for (const key of claimCards) {
      const card = cards.find((c) => c.key === key)!;
      perCard[key] = carrierSet.has(key)
        ? "carried"
        : acceptLinks && (card.links ?? []).some((l) => carrierSet.has(l))
          ? "linked"
          : carriers.length
            ? "separated"
            : "absent";
      if (r.binding === "claim" && (perCard[key] === "separated" || perCard[key] === "absent")) {
        (integrityFlags[key] ??= []).push({ record: r.id, outcome: perCard[key] as "separated" | "absent" });
      }
    }
    results.push({
      id: r.id,
      binding: r.binding,
      carriers,
      carriersUncited: carriers.filter((k) => !cards.find((c) => c.key === k)!.cites.some((u) => r.condition.units.includes(u))),
      claimCards,
      perCard,
      covered: carriers.length > 0,
    });
  }
  return { records: results, integrityFlags, coverageGaps: results.filter((r) => !r.covered).map((r) => r.id) };
}

export type RemapStatus = "kept" | "source_changed" | "needs_review" | "retired";

/**
 * A record carried to a new source version through lineage (same rules as the Study Mode design, §2): all units
 * unchanged → kept (ids may change); any changed → source_changed (re-confirm the link); any ambiguous → needs_review;
 * any claim or condition unit removed → retired (the link no longer holds as written).
 *
 * @deprecated KNOWN LIMITATION (2026-11-14, see review-v3/KNOWN-LIMITATIONS.md): not a trusted lineage operation.
 * Ambiguous lineage entries carry their old ids in `candidates`, not `from`, so this looks them up as missing and
 * returns `retired` where it should return `needs_review`; a unit absent from the lineage is also `retired`, not
 * `needs_review`. Do not import it outside this experiment. For production lineage use `planCitationUpdate` /
 * `indexLineage` (src/ai/reconcile). No phase 2–4 result used it; frozen results are unaffected.
 */
export function remapRecord(record: ClaimConditionRecord, lineage: Lineage): { record: ClaimConditionRecord; status: RemapStatus } {
  const byFrom = new Map(lineage.entries.filter((e) => e.from).map((e) => [e.from!, e]));
  let status: RemapStatus = "kept";
  const rank: Record<RemapStatus, number> = { kept: 0, source_changed: 1, needs_review: 2, retired: 3 };
  const bump = (s: RemapStatus) => {
    if (rank[s] > rank[status]) status = s;
  };
  const map = (units: UnitId[]) =>
    units.flatMap((u) => {
      const e = byFrom.get(u);
      if (!e || e.state === "removed" || !e.to) {
        bump("retired");
        return [];
      }
      if (e.state === "changed") bump("source_changed");
      if (e.state === "ambiguous") bump("needs_review");
      return [e.to];
    });
  return {
    record: { ...record, claim: { ...record.claim, units: map(record.claim.units) }, condition: { ...record.condition, units: map(record.condition.units) } },
    status,
  };
}
