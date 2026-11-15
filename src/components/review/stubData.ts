/**
 * Stub review data for building and testing the review components before the integrator wires them (Lane H). Types
 * from `contracts.ts` only; deterministic ids. The same search design note as the Source panel's stub: a card whose
 * condition changed, a caveat left out, filler, a repeat of an uncited passage and a section not processed.
 */
import type { AccountingResult, ReviewFlag, SourceUnit, SourceUnitKind } from "@/ai/fidelity/contracts";
import type { ReviewCard } from "./queue";

function units(rows: [topic: string, text: string, kind?: SourceUnitKind][]): SourceUnit[] {
  let at = 0;
  const out: SourceUnit[] = rows.map(([topic, text, kind], i) => {
    const span = { start: at, end: at + text.length };
    at = span.end + 1;
    return { id: `u${i + 1}`, kind: kind ?? "sentence", text, hash: `h${i + 1}`, topic, span };
  });
  out.forEach((u, i) => {
    if (i) u.prev = out[i - 1]!.id;
    if (i < out.length - 1) u.next = out[i + 1]!.id;
  });
  return out;
}

export interface StubReview {
  units: SourceUnit[];
  cards: ReviewCard[];
  flags: ReviewFlag[];
  sections: AccountingResult["sections"];
  labels: Record<string, string>;
}

export function stubReview(): StubReview {
  const u = units([
    ["t1", "The service caches search results for 10 minutes."],
    ["t1", "Results are served from the cache only when the cache contains a valid result."],
    ["t1", "As discussed last week."],
    ["t1", "Cache keys include the tenant id and the normalised query."],
    ["t2", "A write to the index clears the tenant's cache."],
    ["t2", "Clearing is asynchronous and can lag by up to 2 seconds."],
    ["t3", "The cache must not exceed 2 GB per node."],
    ["t3", "The cache holds at most 2 GB per node."],
    ["t4", "Should cold starts warm the cache?"],
  ]);
  const cards: ReviewCard[] = [
    { id: "c1", title: "Search results are cached for 10 minutes", body: "Results are always served from the cache.", cites: ["u1", "u2"] },
    { id: "c2", title: "Cache keys are scoped per tenant", body: "Keys combine the tenant id and the normalised query.", cites: ["u4"] },
    { id: "c3", title: "Writes clear the tenant's cache", body: "Clearing runs in the background and can lag by up to 2 seconds.", cites: ["u5", "u6"] },
  ];
  const flags: ReviewFlag[] = [
    {
      code: "condition_changed",
      unit: "u2",
      card: "c1",
      detail: 'source says "only when the cache contains a valid result"',
      evidence: { source: "only when the cache contains a valid result", card: "always served from the cache" },
    },
    { code: "critical_omitted", unit: "u7", detail: 'omitted as filler, but it carries a requirement: "The cache must not exceed 2 GB per node."', evidence: { source: "must not exceed 2 GB" } },
    { code: "duplicate_of_uncited", unit: "u8", detail: 'omitted as a repeat of a passage no card cites: "The cache holds at most 2 GB per node."' },
    { code: "pending", unit: "u9", detail: 'not processed: "Should cold starts warm the cache?"' },
  ];
  const sections: AccountingResult["sections"] = [
    { topic: "t1", represented: 2, omitted: 1, needsReview: 1, highOmittedShare: false },
    { topic: "t2", represented: 2, omitted: 0, needsReview: 0, highOmittedShare: false },
    { topic: "t3", represented: 0, omitted: 0, needsReview: 2, highOmittedShare: false },
    { topic: "t4", represented: 0, omitted: 0, needsReview: 1, highOmittedShare: false },
  ];
  return { units: u, cards, flags, sections, labels: { t1: "Caching", t2: "Invalidation", t3: "Limits", t4: "Open questions" } };
}
