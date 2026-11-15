/**
 * What a distil run decided about each passage of a source version, kept beside the version (knowledge-notes-plan
 * §5.1, §5.3, U3, U8; the lanes log's Lane H request on passage resolutions): the outcome per unit and its reasons
 * (the Source tab's marks), the Needs review flags about passages no card carries (the review queue's passage items),
 * and the user's Include / Dismiss resolutions of those passages.
 *
 * **Where:** the device-local meta store (`MetaRepository`), one record per source version
 * (`sourceReview:<sourceId>@<version>`). Source versions are append-only and say what the text was; this says what
 * the run made of it and what the user decided since, so it can change without touching the version. Device-local
 * like content sources. Card resolutions stay on the card (`AIMetadata.review.resolved`); only passages no card
 * carries are resolved here.
 *
 * Absent (a `preserve` run, a version from before Knowledge Notes, another device): the Source tab shows the passages
 * without outcomes and the queue only the cards' own reviews.
 */
import { REVIEW_RESOLUTIONS, type ReviewFlag, type ReviewResolution, type UnitId, type UnitOutcome } from "@/ai/fidelity/contracts";
import type { UnitOutcomes } from "@/ai/changes/changeSet";
import type { MetaRepository } from "@/persistence/repositories/types";

export interface SourceReviewRecord extends UnitOutcomes {
  /** Passage resolutions (Include / Dismiss), by unit. */
  resolutions: Record<UnitId, ReviewResolution>;
}

const OUTCOMES: readonly UnitOutcome[] = ["represented", "omitted", "needs_review"];

export const sourceReviewKey = (sourceId: string, version: number) => `sourceReview:${sourceId}@${version}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored record read leniently: anything malformed is dropped, never thrown. */
export function readSourceReview(raw: unknown): SourceReviewRecord | null {
  if (!isObj(raw)) return null;
  const outcome: Record<UnitId, UnitOutcome> = {};
  if (isObj(raw.outcome)) for (const [u, o] of Object.entries(raw.outcome)) if (OUTCOMES.includes(o as UnitOutcome)) outcome[u] = o as UnitOutcome;
  const reasons: Record<UnitId, string[]> = {};
  if (isObj(raw.reasons)) for (const [u, r] of Object.entries(raw.reasons)) if (Array.isArray(r)) reasons[u] = r.filter((x): x is string => typeof x === "string");
  const flags = Array.isArray(raw.flags) ? (raw.flags.filter((f) => isObj(f) && typeof f.code === "string" && typeof f.detail === "string") as unknown as ReviewFlag[]) : [];
  const resolutions: Record<UnitId, ReviewResolution> = {};
  if (isObj(raw.resolutions)) for (const [u, r] of Object.entries(raw.resolutions)) if (REVIEW_RESOLUTIONS.includes(r as ReviewResolution)) resolutions[u] = r as ReviewResolution;
  return { outcome, reasons, flags, resolutions };
}

export async function loadSourceReview(meta: MetaRepository, sourceId: string, version: number): Promise<SourceReviewRecord | null> {
  return readSourceReview(await meta.get<unknown>(sourceReviewKey(sourceId, version)));
}

/** On Accept: the run's outcomes for the version it recorded (resolutions made earlier, e.g. by an undo and redo, are kept). */
export async function saveSourceOutcomes(meta: MetaRepository, sourceId: string, version: number, outcomes: UnitOutcomes): Promise<void> {
  const had = await loadSourceReview(meta, sourceId, version);
  const record: SourceReviewRecord = { outcome: { ...outcomes.outcome }, reasons: { ...outcomes.reasons }, flags: [...outcomes.flags], resolutions: had?.resolutions ?? {} };
  await meta.set(sourceReviewKey(sourceId, version), record);
}

/** Include or Dismiss of a passage no card carries (the review queue, the Source tab). Returns the record as stored. */
export async function resolvePassage(meta: MetaRepository, sourceId: string, version: number, unit: UnitId, resolution: ReviewResolution): Promise<SourceReviewRecord> {
  const had = (await loadSourceReview(meta, sourceId, version)) ?? { outcome: {}, reasons: {}, flags: [], resolutions: {} };
  const record: SourceReviewRecord = { ...had, resolutions: { ...had.resolutions, [unit]: resolution } };
  // Included: the passage now has a card, so it reads as Represented; dismissed: confirmed omitted.
  if (resolution === "included") record.outcome = { ...record.outcome, [unit]: "represented" };
  if (resolution === "dismissed") record.outcome = { ...record.outcome, [unit]: "omitted" };
  await meta.set(sourceReviewKey(sourceId, version), record);
  return record;
}
