# Adjudication packet: kn-02-edge-cache-invalidation

## Source units (id [heading path] text)
u1 [Invalidating cached content at the edge] This is the third article in our series on running a content-heavy site behind a CDN.
u2 [Invalidating cached content at the edge] Caching at the edge makes pages fast, but every cached copy is a copy that can go out of date.
u3 [Invalidating cached content at the edge] The hard part is not storing copies; it is deciding how an outdated copy gets replaced, and how quickly.
u4 [Invalidating cached content at the edge] No single technique is enough here, and a dependable setup layers several of them.
u5 [Invalidating cached content at the edge] We use Larkspur Media, a fictional news site, as the running example throughout.
u6 [Invalidating cached content at the edge › Letting copies expire] The simplest form of invalidation is not to invalidate at all: every cached object carries a time to live (TTL), and the edge discards or rechecks its copy once the TTL has passed.
u7 [Invalidating cached content at the edge › Letting copies expire] The origin sets the TTL with the `Cache-Control` header; for example, `Cache-Control: max-age=300` lets an edge location keep a copy for 300 seconds.
u8 [Invalidating cached content at the edge › Letting copies expire] TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default.
u9 [Invalidating cached content at the edge › Letting copies expire] When a TTL runs out, the edge does not always download the whole object again: if the origin sent an `ETag`, the edge can ask whether the copy changed and receive a short `304 Not Modified` answer when it has not.
u10 [Invalidating cached content at the edge › Letting copies expire] Its weakness is that the TTL is a guess made in advance.
u11 [Invalidating cached content at the edge › Letting copies expire] If an editor corrects a headline 60 seconds after publishing, readers can keep seeing the old headline for up to the remaining 240 seconds of a 300-second TTL, and nothing the origin does will shorten that wait.
u12 [Invalidating cached content at the edge › Letting copies expire] Shortening the TTL narrows the window but sends more requests back to the origin: when Larkspur dropped its article TTL from 300 to 30 seconds, origin traffic rose roughly eightfold.
u13 [Invalidating cached content at the edge › Purging by URL] When content must change now, the origin can ask the CDN to purge a specific URL.
u14 [Invalidating cached content at the edge › Purging by URL] The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin.
u15 [Invalidating cached content at the edge › Purging by URL] Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction.
u16 [Invalidating cached content at the edge › Purging by URL] A purge request is accepted quickly, but it is not applied everywhere at the same moment.
u17 [Invalidating cached content at the edge › Purging by URL] The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one.
u18 [Invalidating cached content at the edge › Purging by URL] Purging is eventually consistent, not instant.
u19 [Invalidating cached content at the edge › Purging by URL] Purging by URL has a second limit: it removes only the exact URL you name.
u20 [Invalidating cached content at the edge › Purging by URL] A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires.
u21 [Invalidating cached content at the edge › Purging by URL] Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
u22 [Invalidating cached content at the edge › Purging by URL] Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
u23 [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The origin calls the purge API with the URL. The API answers within about 150 milliseconds, but the answer only means the request was queued.
u24 [Invalidating cached content at the edge › Purging by URL › What happens after a purge] The CDN's control plane fans the purge out to all 90 edge locations.
u25 [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Each location marks its cached copy invalid, so the next request there is a cache miss that goes to the origin.
u26 [Invalidating cached content at the edge › Purging by URL › What happens after a purge] In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
u27 [Invalidating cached content at the edge › Purging by URL › What happens after a purge] Until the last location has applied the purge, a reader routed to that location still gets the old copy.
u28 [Invalidating cached content at the edge › Purging by tag with surrogate keys] Surrogate keys solve the listing problem by letting the origin label each response with tags.
u29 [Invalidating cached content at the edge › Purging by tag with surrogate keys] The origin sends a header such as `Surrogate-Key: story-417 section-politics`, and the CDN records which cached objects carry which keys.
u30 [Invalidating cached content at the edge › Purging by tag with surrogate keys] A single purge of the key `story-417` then removes every cached page that included that story: the article itself, the home page, the section page and the feed.
u31 [Invalidating cached content at the edge › Purging by tag with surrogate keys] Keys can be as coarse or as fine as you like, but every key a page carries makes the header longer, and Larkspur keeps it under 50 keys per response.
u32 [Invalidating cached content at the edge › Purging by tag with surrogate keys] The responsibility moves to the origin.
u33 [Invalidating cached content at the edge › Purging by tag with surrogate keys] A page is only purged by a key if the origin tagged it with that key, and a missing tag produces a stale page with no error anywhere.
u34 [Invalidating cached content at the edge › Purging by tag with surrogate keys] As with purging by URL, a tag purge is delivered to each edge location separately, so for a few seconds some locations serve the updated pages while others still serve the old ones.
u35 [Invalidating cached content at the edge › Purging by tag with surrogate keys] Tag purges can also be large.
u36 [Invalidating cached content at the edge › Purging by tag with surrogate keys] Purging `section-politics` at Larkspur removes about 12,000 cached objects at once, and the origin has to absorb the burst of cache misses that follows.
u37 [Invalidating cached content at the edge › Serving stale on purpose] Stale-while-revalidate turns expiry from a wait into a background task.
u38 [Invalidating cached content at the edge › Serving stale on purpose] With `Cache-Control: max-age=300, stale-while-revalidate=60`, an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background.
u39 [Invalidating cached content at the edge › Serving stale on purpose] The reader gets a fast response, and the next reader gets the refreshed copy.
u40 [Invalidating cached content at the edge › Serving stale on purpose] Larkspur uses it on article pages, where a minute of staleness is acceptable, but not on live election results.
u41 [Invalidating cached content at the edge › Serving stale on purpose] The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
u42 [Invalidating cached content at the edge › Serving stale on purpose] A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
u43 [Invalidating cached content at the edge › Serving stale on purpose] Serving stale is a choice about tolerance, not a way to make content fresher.
u44 [Invalidating cached content at the edge › Serving stale on purpose] It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.
u45 [Invalidating cached content at the edge › Versioned asset URLs] For static assets, the cleanest invalidation is a new name.
u46 [Invalidating cached content at the edge › Versioned asset URLs] The build puts a hash of each file's contents into its name, such as `app.3f9c2e.js`, so a changed file gets a new URL and the old cached copy is simply never requested again.
u47 [Invalidating cached content at the edge › Versioned asset URLs] Because a versioned URL never changes its content, it can be cached for a very long time; Larkspur serves its versioned assets with `max-age=31536000`, which is one year.
u48 [Invalidating cached content at the edge › Versioned asset URLs] Most build tools can add the hash automatically, so the cost is a one-time change to the build configuration.
u49 [Invalidating cached content at the edge › Versioned asset URLs] Versioning does not help for HTML entry pages.
u50 [Invalidating cached content at the edge › Versioned asset URLs] The home page and article pages are requested at fixed addresses such as `/` and `/story/417`, and they are the pages that point to the new asset names, so they still need a TTL, a purge or both.
u51 [Invalidating cached content at the edge › Versioned asset URLs] If an HTML page stays cached longer than the origin keeps the old asset files, it can send readers to files that no longer exist.
u52 [Invalidating cached content at the edge › Versioned asset URLs] Old asset versions should therefore stay available for at least as long as the longest HTML TTL.
u53 [Invalidating cached content at the edge › Comparing the techniques] The table below summarises how the techniques compare.
u54 [Invalidating cached content at the edge › Comparing the techniques] Technique | Freshness after a change | Main cost | Main caveat
u55 [Invalidating cached content at the edge › Comparing the techniques] TTL expiry | Up to the full TTL (300 seconds at Larkspur) | More origin traffic as the TTL shrinks | Cannot be shortened after the fact
u56 [Invalidating cached content at the edge › Comparing the techniques] Purge by URL | Seconds (20 seconds worst case measured) | One purge call per URL | Misses other pages that show the same content
u57 [Invalidating cached content at the edge › Comparing the techniques] Surrogate-key purge | Seconds, for every tagged page | Tagging discipline at the origin | Untagged pages stay stale
u58 [Invalidating cached content at the edge › Comparing the techniques] Stale-while-revalidate | Up to the TTL plus 60 seconds | Nothing at request time | Readers knowingly get expired copies
u59 [Invalidating cached content at the edge › Comparing the techniques] Versioned URLs | Immediate for pages that reference the new name | A build step | Does not cover HTML entry pages
u60 [Invalidating cached content at the edge › Conclusion] Invalidation at the edge is a set of trade-offs rather than a single switch.
u61 [Invalidating cached content at the edge › Conclusion] A reliable setup combines expiry times, explicit purges, deliberate stale serving and versioned file names, each covering the gaps of the others.
u62 [Invalidating cached content at the edge › Conclusion] Short TTLs are the safety net, purges handle urgent corrections, stale serving keeps the site fast when the origin struggles, and versioned names take static assets out of the problem entirely.
u63 [Invalidating cached content at the edge › Conclusion] Whatever the mix, remember that a purge reaches some edge locations before others, so plan for a window of several seconds in which some readers still see the old version.
u64 [Invalidating cached content at the edge › Conclusion] Thanks for reading; the next article in the series covers cache keys and personalisation.

## Candidates with every reading

### c1: condition units u10, u11, u55
- GOLDEN dataset link ku.ttl-window → ku.ttl: claim u6+u7+u8 — The TTL is a guess made in advance: a headline corrected 60 seconds after publishing can stay old for up to the remaining 240 seconds of a 300-second TTL, and nothing the origin does shortens that wait.
- phase 1 record (session author, golden-derived; NOT blind) kn02.ttl.guess: claim u6, binding set — the TTL is a guess made in advance
- phase 1 record (session author, golden-derived; NOT blind) kn02.ttl.cannot-shorten: claim u11, binding set — nothing the origin does shortens that wait
- A (blind): set, claim u6 (medium) — condition "readers can keep seeing the old headline for up to the remaining 240 seconds of a 300-second TTL, and nothing the origin does will shorten that wait" / claim "every cached object carries a time to live (TTL), and the edge discards or rechecks its copy once the TTL has passed" — A real weakness of TTL expiry, but the description of how TTL expiry works stays true without it.
- B (blind): set, claim u6 (medium) — condition "Its weakness is that the TTL is a guess made in advance." / claim "every cached object carries a time to live (TTL), and the edge discards or rechecks its copy once the TTL has passed" — TTL expiry still works as described; the inability to shorten the wait after a change is a real weakness that must be kept.

### c2: condition units u16, u17, u18
- GOLDEN dataset link ku.purge-eventual → ku.purge-url: claim u13+u14+u15 — A purge is accepted quickly but applied by each edge location on its own schedule, so for a while some locations serve the new version and others the old one.
- phase 1 record (session author, golden-derived; NOT blind) kn02.purge.eventual: claim u13+u14, binding claim — eventually consistent: locations apply it at different times
- A (blind): claim, claim u14 (high) — condition "it is not applied everywhere at the same moment" / claim "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin." — At locations that have not yet applied the purge, the next request still gets the old copy, so u14 is false for a short window.
- B (blind): claim, claim u14 (medium) — condition "it is not applied everywhere at the same moment" / claim "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin." — Until each location applies the purge, the next request there still gets the old copy, so u14 read alone is misleading.

### c3: condition units u19, u20, u21
- GOLDEN dataset link ku.url-scope → ku.purge-url: claim u13+u14+u15 — A URL purge removes only that URL: the home page, section page and RSS feed showing the same headline keep the old copy, and a query-string variant is a separate cache entry.
- phase 1 record (session author, golden-derived; NOT blind) kn02.purge.scope: claim u13+u14, binding set — only that exact URL; other pages and query variants keep the old copy
- A (blind): ambiguous, claim u13+u14 (medium) — condition "it removes only the exact URL you name" / claim "When content must change now, the origin can ask the CDN to purge a specific URL." — Reading 1 (set): u13/u14 already say 'a specific URL' and stay true; reading 2 (claim): presenting URL purge as the way to fix a correction now (u13, u15, u62 'purges handle urgent corrections') is misleading because other pages and query-string variants keep the old content.
- B (blind): set, claim u13+u14 (medium) — condition "it removes only the exact URL you name" / claim "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin." — The claim is already about 'that URL' and stays true; other pages and query-string variants staying stale is a scope limit that must be carried.

### c4: condition units u22
- GOLDEN dataset link ku.purge-rate-limit → ku.purge-url: claim u13+u14+u15 — Purge APIs are rate limited: Larkspur's plan allows 1000 purge calls per minute, which a bulk correction across the archive can exhaust.
- phase 1 record (session author, golden-derived; NOT blind) kn02.purge.rate: claim u13, binding set — rate limited: 1,000 calls per minute
- A (blind): set, claim u13 (medium) — condition "Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust." / claim "the origin can ask the CDN to purge a specific URL" — An operational limit; the purge claim stays true for normal volumes.
- B (blind): set, claim u13 (medium) — condition "Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust." / claim "When content must change now, the origin can ask the CDN to purge a specific URL." — Operational limit on purging; single-URL purge claim stays true.

### c5: condition units u26
- phase 1 record (session author, golden-derived; NOT blind) kn02.walkthrough.bound: claim u27, binding set — half within 2 seconds, slowest 20 seconds
- A (blind): set, claim u18 (low) — condition "half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds" / claim "Purging is eventually consistent, not instant." — Quantifies the propagation window (the 20 s worst case the table repeats); could also be read as mere supporting evidence for u18.
- B (blind): set, claim u23 (low) — condition "half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds" / claim "The API answers within about 150 milliseconds, but the answer only means the request was queued." — Quantifies the propagation window (20 s worst case); could also be read as mere evidence elaborating u16-u18.

### c6: condition units u32, u33
- GOLDEN dataset link ku.tag-discipline → ku.surrogate: claim u28+u29+u30 — Surrogate keys move responsibility to the origin: a page is purged by a key only if the origin tagged it, and a missing tag leaves a stale page with no error anywhere.
- phase 1 record (session author, golden-derived; NOT blind) kn02.surrogate.tagged: claim u30, binding claim — only pages the origin tagged with that key
- phase 1 record (session author, golden-derived; NOT blind) kn02.surrogate.silent: claim u30, binding set — a missing tag leaves a stale page with no error
- A (blind): claim, claim u30 (high) — condition "A page is only purged by a key if the origin tagged it with that key, and a missing tag produces a stale page with no error anywhere." / claim "A single purge of the key `story-417` then removes every cached page that included that story" — An untagged page that includes the story is not removed, so 'every cached page' is false in that case.
- B (blind): claim, claim u30 (high) — condition "A page is only purged by a key if the origin tagged it with that key, and a missing tag produces a stale page with no error anywhere." / claim "A single purge of the key `story-417` then removes every cached page that included that story" — 'Every cached page that included that story' is false for pages the origin failed to tag.

### c7: condition units u35, u36
- GOLDEN dataset link ku.tag-burst → ku.surrogate: claim u28+u29+u30 — Tag purges can be large: purging section-politics at Larkspur removes about 12000 cached objects, and the origin must absorb the burst of misses.
- phase 1 record (session author, golden-derived; NOT blind) kn02.surrogate.burst: claim u30, binding set — about 12,000 objects at once; the origin absorbs the misses
- A (blind): set, claim u30 (medium) — condition "Purging `section-politics` at Larkspur removes about 12,000 cached objects at once, and the origin has to absorb the burst of cache misses that follows." / claim "A single purge of the key `story-417` then removes every cached page that included that story" — A cost of tag purges; the claim about what a tag purge removes stays true.
- B (blind): set, claim u30 (medium) — condition "Tag purges can also be large. Purging `section-politics` at Larkspur removes about 12,000 cached objects at once, and the origin has to absorb the burst of cache misses that follows." / claim "A single purge of the key `story-417` then removes every cached page that included that story" — A cost of tag purges; the claim stays true.

### c8: condition units u41
- GOLDEN dataset link ku.swr-bound → ku.swr: claim u37+u38+u39 — An expired copy is served for at most 60 seconds past its TTL; after that the edge waits for the origin as on an ordinary miss.
- phase 1 record (session author, golden-derived; NOT blind) kn02.swr.bound: claim u38, binding claim — at most 60 seconds past the TTL
- A (blind): claim, claim u38 (medium) — condition "an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss" / claim "an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately and fetches a fresh one from the origin in the background" — u38 reads as unbounded; a request more than 60 s past the TTL does not get the expired copy immediately.
- B (blind): claim, claim u38 (medium) — condition "an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss" / claim "an edge location that receives a request after the 300 seconds have passed returns the expired copy immediately" — Without the 60-second bound, u38 implies any request after expiry gets an immediate stale copy, which is false beyond TTL+60s.

### c9: condition units u42
- phase 1 record (session author, golden-derived; NOT blind) kn02.sie.condition: claim u42, binding claim — only while the origin is returning errors
- A (blind): ambiguous, claim u41 (low) — condition "lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors" / claim "an expired copy is served for at most 60 seconds past its TTL" — Reading 1 (claim): an exception to u41's 'at most 60 seconds' bound when the origin errors; reading 2 (not_a_condition): a separate related directive described with its own scope, not limiting any earlier claim.
- B (blind): ambiguous, claim u41 (low) — condition "lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors" / claim "an expired copy is served for at most 60 seconds past its TTL" — Reading 1: an exception that makes u41's 'at most 60 seconds' false when the origin errors (claim); reading 2: a separate related directive with its own intra-sentence scope, not limiting another claim.

### c10: condition units u43, u44
- GOLDEN dataset link ku.stale-tolerance → ku.swr: claim u37+u38+u39 — Serving stale is a choice about tolerance, not a way to make content fresher: it hides a slow origin but some readers see a copy older than the TTL suggests.
- phase 1 record (session author, golden-derived; NOT blind) kn02.swr.tolerance: claim u37+u38, binding set — a choice about tolerance, not freshness
- A (blind): set, claim u39 (medium) — condition "some readers see a copy that is older than the TTL alone would suggest" / claim "The reader gets a fast response, and the next reader gets the refreshed copy." — A trade-off of serving stale; the speed claim stays true.
- B (blind): set, claim u39 (medium) — condition "it also means some readers see a copy that is older than the TTL alone would suggest" / claim "The reader gets a fast response, and the next reader gets the refreshed copy." — Caveat on stale serving; the fast-response claim stays true.

### c11: condition units u49, u50
- GOLDEN dataset link ku.html-caveat → ku.versioned: claim u45+u46+u47+u48 — Versioning does not help for HTML entry pages: they are requested at fixed addresses and point to the new asset names, so they still need a TTL, a purge or both.
- phase 1 record (session author, golden-derived; NOT blind) kn02.versioned.html: claim u45+u46, binding set — does not help for HTML entry pages
- phase 1 record (session author, golden-derived; NOT blind) kn02.versioned.still-need: claim u49, binding set — they still need a TTL, a purge or both
- A (blind): claim, claim u45+u46 (medium) — condition "Versioning does not help for HTML entry pages." / claim "a changed file gets a new URL and the old cached copy is simply never requested again" — u45 scopes to static assets, but u46/u62 ('take static assets out of the problem entirely') mislead unless the HTML pages that reference the new names are themselves refreshed by TTL or purge.
- B (blind): set, claim u45 (medium) — condition "Versioning does not help for HTML entry pages." / claim "For static assets, the cleanest invalidation is a new name." — The claim is already scoped to static assets; the HTML exclusion is a scope limit that must be kept (u62 'out of the problem entirely' could otherwise be over-read).

### c12: condition units u51, u52
- GOLDEN dataset link ku.old-assets → ku.versioned: claim u45+u46+u47+u48 — If HTML stays cached longer than the origin keeps old asset files, it can send readers to files that no longer exist, so old asset versions should stay available at least as long as the longest HTML TTL.
- phase 1 record (session author, golden-derived; NOT blind) kn02.versioned.old-assets: claim u46+u47, binding set — keep old assets at least as long as the longest HTML TTL
- A (blind): claim, claim u46 (medium) — condition "If an HTML page stays cached longer than the origin keeps the old asset files, it can send readers to files that no longer exist." / claim "the old cached copy is simply never requested again" — Cached HTML still requests old asset names, so 'never requested again' is false while old HTML is cached; u52 is the resulting requirement.
- B (blind): claim, claim u46 (low) — condition "If an HTML page stays cached longer than the origin keeps the old asset files, it can send readers to files that no longer exist." / claim "a changed file gets a new URL and the old cached copy is simply never requested again" — Stale cached HTML still requests the old asset name, so 'never requested again' is false in that case; u52 is the resulting requirement.

### c13: condition units u62
- phase 1 record (session author, golden-derived; NOT blind) kn02.takeaway.struggles: claim u62, binding set — when the origin struggles
- A (blind): not_a_condition, claim - (medium) — condition "Short TTLs are the safety net, purges handle urgent corrections, stale serving keeps the site fast when the origin struggles, and versioned names take static assets out of the problem entirely." / claim "" — A concluding summary of each technique's role; it is a set of claims, not a limit on one.
- B (blind): not_a_condition, claim - (medium) — condition "Short TTLs are the safety net, purges handle urgent corrections, stale serving keeps the site fast when the origin struggles, and versioned names take static assets out of the problem entirely." / claim "" — A concluding summary of each technique's role, itself a claim rather than a limit on another claim.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u40 — from A: set, claim u38 — condition "where a minute of staleness is acceptable, but not on live election results" / claim "returns the expired copy immediately and fetches a fresh one from the origin in the background" — Scope of when stale-while-revalidate is appropriate.

### a2: condition units u12 — from A: set, claim u62 — condition "Shortening the TTL narrows the window but sends more requests back to the origin: when Larkspur dropped its article TTL from 300 to 30 seconds, origin traffic rose roughly eightfold." / claim "Short TTLs are the safety net" — Cost of short TTLs; only u55's 'More origin traffic' column touches it in the candidate list.

### a3: condition units u9 — from A: claim, claim u9 — condition "if the origin sent an `ETag`" / claim "the edge can ask whether the copy changed and receive a short `304 Not Modified` answer when it has not" — Intra-sentence condition: conditional revalidation needs an ETag from the origin.

### a4: condition units u40 — from B: set, claim u37+u39 — condition "where a minute of staleness is acceptable, but not on live election results" / claim "Stale-while-revalidate turns expiry from a wait into a background task." — Scope of where stale-while-revalidate is appropriate; the mechanism claim stays true.

### a5: condition units u12 — from B: set, claim u12 — condition "but sends more requests back to the origin: when Larkspur dropped its article TTL from 300 to 30 seconds, origin traffic rose roughly eightfold" / claim "Shortening the TTL narrows the window" — Cost of the obvious remedy for TTL staleness; intra-sentence.

### a6: condition units u9 — from B: claim, claim u9 — condition "if the origin sent an `ETag`" / claim "the edge can ask whether the copy changed and receive a short `304 Not Modified` answer when it has not" — Revalidation with 304 only works when an ETag was sent; intra-sentence.

