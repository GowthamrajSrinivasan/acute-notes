/**
 * Claim–condition records for kn-01 and kn-02 (PROVISIONAL, 2026-11-13).
 *
 * Derived from the golden dataset, not invented: every record comes from a `limits` edge in the case's `knowledge.json`
 * and/or a `source_fidelity` `text_present` assertion in `evaluation.json`. Where a golden assertion exists its marker
 * groups are used VERBATIM (`{ golden: id }`), so the prototype isn't tuned to the saved cards.
 *
 * Exceptions, flagged `note`: records with no golden marker groups have hand-written groups. Three of those
 * (kn01.replay.window's wording alternatives, kn02.surrogate.tagged, kn02.takeaway.struggles) were written after the
 * saved cards had been read, so they carry a risk of fitting them.
 *
 * `binding` follows the rule in `ClaimConditionRecord`: "claim" only when the claim's own sentence is false in a case the
 * condition describes.
 */
import type { ClaimConditionRecord } from "./claimConditions";

export const RECORDS: Record<string, ClaimConditionRecord[]> = {
  "kn-01-idempotency-keys": [
    {
      id: "kn01.replay.window",
      claim: { units: ["u2"], summary: "the server returns the stored result for a repeated key" },
      condition: { units: ["u6", "u7"], kind: "bound", summary: "only while it remembers the key: 24 hours" },
      binding: "claim",
      evidence: { groups: [["24 hours", "24-hour", "24 h", "24h", "while the server", "as long as the server", "expire", "window"]] },
      origin: { assertions: ["a.window-with-claim"], limits: "ku.expiry-window → ku.replay", note: "golden group ['24 hours'…] widened with u6/u9 wording (written after reading the cards)" },
    },
    {
      id: "kn01.replay.reuse",
      claim: { units: ["u2"], summary: "the server returns the stored result for a repeated key" },
      condition: { units: ["u8"], kind: "exception", summary: "a reused key with a different amount is rejected" },
      binding: "claim",
      evidence: { golden: "a.reuse-with-claim" },
      origin: { assertions: ["a.reuse-with-claim"], limits: "ku.key-reuse → ku.replay" },
    },
    {
      id: "kn01.replay.completed",
      claim: { units: ["u2"], summary: "the server returns the stored result" },
      condition: { units: ["u2"], kind: "precondition", summary: "only for a request that already completed" },
      binding: "claim",
      evidence: { golden: "a.completed-condition" },
      origin: { assertions: ["a.completed-condition"] },
    },
    {
      id: "kn01.takeaway.bounded",
      claim: { units: ["u9"], summary: "keys make retries safe" },
      condition: { units: ["u9"], kind: "bound", summary: "within a bounded window; not a general guarantee" },
      binding: "claim",
      evidence: { groups: [["window", "bounded"], ["not a general", "no general", "not provide a general", "not guarantee", "not a guarantee"]] },
      origin: { assertions: ["a.no-absolute"], note: "a.no-absolute is text_absent; groups hand-written from u9" },
    },
  ],
  "kn-02-edge-cache-invalidation": [
    {
      id: "kn02.ttl.guess",
      claim: { units: ["u6"], summary: "copies expire after a TTL" },
      condition: { units: ["u10"], kind: "caveat", summary: "the TTL is a guess made in advance" },
      binding: "set",
      evidence: { groups: [["guess", "in advance"]] },
      origin: { assertions: ["a.ttl-window"], limits: "ku.ttl-window → ku.ttl", note: "first half of a.ttl-window's second group" },
    },
    {
      id: "kn02.ttl.cannot-shorten",
      claim: { units: ["u11"], summary: "readers can see the old headline for the rest of the TTL" },
      condition: { units: ["u11", "u55"], kind: "caveat", summary: "nothing the origin does shortens that wait" },
      binding: "set",
      evidence: { groups: [["nothing the origin", "cannot shorten", "can't shorten", "can not shorten", "cannot be shortened", "can't be shortened"]] },
      origin: { assertions: ["a.ttl-window"], limits: "ku.ttl-window → ku.ttl", note: "second half of a.ttl-window's second group, verbatim" },
    },
    {
      id: "kn02.purge.eventual",
      claim: { units: ["u13", "u14"], summary: "a purge removes the copy; the next request is fetched fresh" },
      condition: { units: ["u16", "u17", "u18"], kind: "bound", summary: "eventually consistent: locations apply it at different times" },
      binding: "claim",
      evidence: { golden: "a.purge-eventual" },
      origin: { assertions: ["a.purge-eventual", "a.no-instant"], limits: "ku.purge-eventual → ku.purge-url" },
    },
    {
      id: "kn02.purge.scope",
      claim: { units: ["u13", "u14"], summary: "the origin can purge a specific URL" },
      condition: { units: ["u19", "u20", "u21"], kind: "scope", summary: "only that exact URL; other pages and query variants keep the old copy" },
      binding: "set",
      evidence: { golden: "a.purge-scope" },
      origin: { assertions: ["a.purge-scope"], limits: "ku.url-scope → ku.purge-url" },
    },
    {
      id: "kn02.purge.rate",
      claim: { units: ["u13"], summary: "the origin can purge a URL" },
      condition: { units: ["u22"], kind: "caveat", summary: "rate limited: 1,000 calls per minute" },
      binding: "set",
      evidence: { groups: [["rate limit", "rate-limit"], ["1,000", "1000"]] },
      origin: { limits: "ku.purge-rate-limit → ku.purge-url" },
    },
    {
      id: "kn02.walkthrough.bound",
      claim: { units: ["u27"], summary: "until the last location applies the purge, readers there get the old copy" },
      condition: { units: ["u26"], kind: "fact", summary: "half within 2 seconds, slowest 20 seconds" },
      binding: "set",
      evidence: { golden: "a.propagation-bound" },
      origin: { assertions: ["a.propagation-bound"] },
    },
    {
      id: "kn02.surrogate.tagged",
      claim: { units: ["u30"], summary: "one key purge removes every page that included the story" },
      condition: { units: ["u33"], kind: "precondition", summary: "only pages the origin tagged with that key" },
      binding: "claim",
      evidence: { groups: [["tagged", "with that key", "carrying", "carries the key", "labelled with"]] },
      origin: { limits: "ku.tag-discipline → ku.surrogate", note: "groups hand-written (written after reading the cards)" },
    },
    {
      id: "kn02.surrogate.silent",
      claim: { units: ["u30"], summary: "one key purge removes every page that included the story" },
      condition: { units: ["u32", "u33"], kind: "caveat", summary: "a missing tag leaves a stale page with no error" },
      binding: "set",
      evidence: { golden: "a.tag-discipline" },
      origin: { assertions: ["a.tag-discipline"], limits: "ku.tag-discipline → ku.surrogate" },
    },
    {
      id: "kn02.surrogate.burst",
      claim: { units: ["u30"], summary: "a key purge removes many pages" },
      condition: { units: ["u35", "u36"], kind: "caveat", summary: "about 12,000 objects at once; the origin absorbs the misses" },
      binding: "set",
      evidence: { groups: [["12,000", "12000"]] },
      origin: { limits: "ku.tag-burst → ku.surrogate" },
    },
    {
      id: "kn02.swr.bound",
      claim: { units: ["u38"], summary: "after the TTL the edge returns the expired copy immediately" },
      condition: { units: ["u41"], kind: "bound", summary: "at most 60 seconds past the TTL" },
      binding: "claim",
      evidence: { golden: "a.swr-bound" },
      origin: { assertions: ["a.swr-bound", "a.no-unbounded-stale"], limits: "ku.swr-bound → ku.swr" },
    },
    {
      id: "kn02.swr.tolerance",
      claim: { units: ["u37", "u38"], summary: "stale-while-revalidate serves expired copies" },
      condition: { units: ["u43", "u44"], kind: "caveat", summary: "a choice about tolerance, not freshness" },
      binding: "set",
      evidence: { golden: "a.stale-tolerance" },
      origin: { assertions: ["a.stale-tolerance"], limits: "ku.stale-tolerance → ku.swr" },
    },
    {
      id: "kn02.sie.condition",
      claim: { units: ["u42"], summary: "stale-if-error serves the expired copy for up to a day" },
      condition: { units: ["u42"], kind: "precondition", summary: "only while the origin is returning errors" },
      binding: "claim",
      evidence: { golden: "a.stale-if-error-condition" },
      origin: { assertions: ["a.stale-if-error-condition"] },
    },
    {
      id: "kn02.versioned.html",
      claim: { units: ["u45", "u46"], summary: "a new name is the cleanest invalidation" },
      condition: { units: ["u49"], kind: "scope", summary: "does not help for HTML entry pages" },
      binding: "set",
      evidence: { golden: "a.html-caveat" },
      origin: { assertions: ["a.html-caveat"], limits: "ku.html-caveat → ku.versioned" },
    },
    {
      id: "kn02.versioned.still-need",
      claim: { units: ["u49"], summary: "versioning does not help HTML entry pages" },
      condition: { units: ["u50"], kind: "caveat", summary: "they still need a TTL, a purge or both" },
      binding: "set",
      evidence: { groups: [["still need", "need a ttl", "a purge or both", "still require"]] },
      origin: { limits: "ku.html-caveat → ku.versioned", note: "groups from golden a.html-caveat's 'still need' alternative" },
    },
    {
      id: "kn02.versioned.old-assets",
      claim: { units: ["u46", "u47"], summary: "versioned assets can be cached a year" },
      condition: { units: ["u51", "u52"], kind: "caveat", summary: "keep old assets at least as long as the longest HTML TTL" },
      binding: "set",
      evidence: { golden: "a.old-assets" },
      origin: { assertions: ["a.old-assets"], limits: "ku.old-assets → ku.versioned" },
    },
    {
      id: "kn02.takeaway.struggles",
      claim: { units: ["u62"], summary: "stale serving keeps the site fast" },
      condition: { units: ["u62"], kind: "precondition", summary: "when the origin struggles" },
      binding: "set",
      evidence: { groups: [["origin struggles", "slow origin", "origin is slow", "origin struggl"]] },
      origin: { note: "not in the golden set; added for the user's g47 label (written after reading the cards)" },
    },
  ],
};
