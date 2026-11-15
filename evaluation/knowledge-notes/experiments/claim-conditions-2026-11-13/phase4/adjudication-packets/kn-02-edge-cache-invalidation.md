# Phase 4 adjudication packet: kn-02-edge-cache-invalidation

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

Note set(s): ../phase3/openui-packets/kn-02-edge-cache-invalidation.md (openui-v1, openui-v2)

## Matched pairs (X and Y found the same clause)

- X: x1 [u9] claim (general, medium) clause "if the origin sent an `ETag`" → claim u9 "the edge can ask whether the copy changed and receive a short `304 Not Modified` answer"
  Y: y1 [u9] claim (general, medium) clause "if the origin sent an `ETag`" → claim u9 "the edge can ask whether the copy changed and receive a short `304 Not Modified` answer when it has not"
  context: phase3 a3 [u9] claim/agreed claim u9 outcomes {"openui-v1":{"v1:g2":"carried"},"openui-v2":{"v2:g7":"carried"}} carriers {"openui-v1":["v1:g2"],"openui-v2":["v2:g7"]}
  context: phase3 a6 [u9] claim/agreed claim u9 outcomes {"openui-v1":{"v1:g2":"carried"},"openui-v2":{"v2:g7":"carried"}} carriers {"openui-v1":["v1:g2"],"openui-v2":["v2:g7"]}

- X: x3 [u10] set (R3, medium) clause "the TTL is a guess made in advance" → claim u8 "TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default."
  Y: y2 [u10] set (R3, medium) clause "Its weakness is that the TTL is a guess made in advance." → claim u8 "TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default."
  context: phase3 c1 [u10,u11,u55] set/agreed claim u6 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g4":"separated"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g8","v2:g9"]}

- X: x4 [u11] set (general, medium) clause "for up to the remaining 240 seconds" → claim u11 "readers can keep seeing the old headline"
  Y: y3 [u11] claim (general, medium) clause "for up to the remaining 240 seconds" → claim u11 "readers can keep seeing the old headline"
  context: phase3 c1 [u10,u11,u55] set/agreed claim u6 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g4":"separated"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g8","v2:g9"]}

- X: x5 [u11] claim (general, high) clause "nothing the origin does will shorten that wait" → claim u6 "every cached object carries a time to live (TTL), and the edge discards or rechecks its copy once the TTL has passed"
  Y: y4 [u11] claim (R3, medium) clause "nothing the origin does will shorten that wait" → claim u8 "TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default."
  context: phase3 c1 [u10,u11,u55] set/agreed claim u6 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g4":"separated"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g8","v2:g9"]}

- X: x6 [u12] claim (R3, high) clause "but sends more requests back to the origin" → claim u12 "Shortening the TTL narrows the window"
  Y: y5 [u12] claim (R3, high) clause "but sends more requests back to the origin" → claim u12 "Shortening the TTL narrows the window"
  context: phase3 a2 [u12] set/adjudicated claim u62 outcomes {"openui-v1":{"v1:g14":"separated"},"openui-v2":{"v2:g47":"separated"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g10"]}
  context: phase3 a5 [u12] set/adjudicated claim u12 outcomes {"openui-v1":{"v1:g3":"carried"},"openui-v2":{"v2:g10":"carried"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g10"]}

- X: x7 [u16] claim (R4, medium) clause "but it is not applied everywhere at the same moment" → claim u14 "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin."
  Y: y6 [u16] claim (general, high) clause "but it is not applied everywhere at the same moment" → claim u16 "A purge request is accepted quickly"
  context: phase3 c2 [u16,u17,u18] claim/agreed claim u14 outcomes {"openui-v1":{"v1:g4":"separated"},"openui-v2":{"v2:g11":"separated","v2:g12":"separated"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g14","v2:g15","v2:g23","v2:g24","v2:g48"]}

- X: x8 [u17] claim (R4, medium) clause "for a short time some locations serve the new version while others still serve the old one" → claim u14 "the next request for that URL is fetched fresh from the origin"
  Y: y7 [u17] claim (general, medium) clause "for a short time some locations serve the new version while others still serve the old one" → claim u14 "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin."
  context: phase3 c2 [u16,u17,u18] claim/agreed claim u14 outcomes {"openui-v1":{"v1:g4":"separated"},"openui-v2":{"v2:g11":"separated","v2:g12":"separated"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g14","v2:g15","v2:g23","v2:g24","v2:g48"]}

- X: x9 [u18] claim (R4, high) clause "eventually consistent, not instant" → claim u14 "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin."
  Y: y8 [u18] claim (general, high) clause "eventually consistent, not instant" → claim u14 "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin."
  context: phase3 c2 [u16,u17,u18] claim/agreed claim u14 outcomes {"openui-v1":{"v1:g4":"separated"},"openui-v2":{"v2:g11":"separated","v2:g12":"separated"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g14","v2:g15","v2:g23","v2:g24","v2:g48"]}

- X: x10 [u19] claim (R4, high) clause "it removes only the exact URL you name" → claim u14 "The purge removes the cached copy"
  Y: y9 [u19] claim (general, high) clause "it removes only the exact URL you name" → claim u14 "The purge removes the cached copy"
  context: phase3 c3 [u19,u20,u21] set/adjudicated claim u13+u14 outcomes {"openui-v1":{"v1:g4":"separated"},"openui-v2":{"v2:g11":"separated","v2:g12":"separated"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g16","v2:g17","v2:g18"]}

- X: x11 [u20] set (general, medium) clause "until it is purged separately or expires" → claim u20 "each of those cached pages keeps the old headline"
  Y: y10 [u20] set (general, low) clause "each of those cached pages keeps the old headline until it is purged separately or expires" → claim u15 "Larkspur's publishing system sends a purge for the article URL every time an editor saves a correction."
  context: phase3 c3 [u19,u20,u21] set/adjudicated claim u13+u14 outcomes {"openui-v1":{"v1:g4":"separated"},"openui-v2":{"v2:g11":"separated","v2:g12":"separated"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g16","v2:g17","v2:g18"]}

- X: x12 [u21] claim (R4, medium) clause "`/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it" → claim u14 "The purge removes the cached copy"
  Y: y11 [u21] claim (general, medium) clause "`/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it" → claim u14 "The purge removes the cached copy, so the next request for that URL is fetched fresh from the origin."
  context: phase3 c3 [u19,u20,u21] set/adjudicated claim u13+u14 outcomes {"openui-v1":{"v1:g4":"separated"},"openui-v2":{"v2:g11":"separated","v2:g12":"separated"}} carriers {"openui-v1":["v1:g5"],"openui-v2":["v2:g16","v2:g17","v2:g18"]}

- X: x13 [u22] claim (general, medium) clause "Purge APIs are also rate limited" → claim u13 "When content must change now, the origin can ask the CDN to purge a specific URL."
  Y: y12 [u22] ambiguous (R3, low) clause "Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust" → claim u13 "When content must change now, the origin can ask the CDN to purge a specific URL." | A: claim: in a bulk correction the purge calls fail once the limit is exhausted, so 'purge when content must change now' would lead a reader to rely on it wrongly | B: set: a secondary operational cost; the takeaway that purges handle urgent single corrections stands | Q: Does the source present purging as the mechanism for bulk/archive-wide corrections, or only for individual urgent corrections?
  context: phase3 c4 [u22] set/agreed claim u13 outcomes {"openui-v1":{"v1:g4":"absent"},"openui-v2":{"v2:g11":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g19"]}

- X: x14 [u26] set (general, medium) clause "the slowest location took 20 seconds" → claim u16 "A purge request is accepted quickly, but it is not applied everywhere at the same moment."
  Y: y13 [u26] set (general, medium) clause "the slowest location took 20 seconds" → claim u18 "Purging is eventually consistent, not instant."
  context: phase3 c5 [u26] ambiguous/unresolved claim u18+u23+u27 outcomes {"openui-v1":{"v1:g5":"absent"},"openui-v2":{"v2:g15":"separated","v2:g20":"separated","v2:g24":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g23"]}

- X: x15 [u32] set (R3, medium) clause "The responsibility moves to the origin." → claim u28 "Surrogate keys solve the listing problem by letting the origin label each response with tags."
  Y: y14 [u32] set (R3, medium) clause "The responsibility moves to the origin." → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  context: phase3 c6 [u32,u33] claim/agreed claim u30 outcomes {"openui-v1":{"v1:g6":"separated"},"openui-v2":{"v2:g26":"separated"}} carriers {"openui-v1":["v1:g7"],"openui-v2":["v2:g28"]}

- X: x16 [u33] claim (general, high) clause "A page is only purged by a key if the origin tagged it with that key" → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  Y: y15 [u33] claim (general, high) clause "A page is only purged by a key if the origin tagged it with that key" → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  context: phase3 c6 [u32,u33] claim/agreed claim u30 outcomes {"openui-v1":{"v1:g6":"separated"},"openui-v2":{"v2:g26":"separated"}} carriers {"openui-v1":["v1:g7"],"openui-v2":["v2:g28"]}

- X: x17 [u33] claim (general, medium) clause "a missing tag produces a stale page with no error anywhere" → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  Y: y16 [u33] claim (general, medium) clause "a missing tag produces a stale page with no error anywhere" → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  context: phase3 c6 [u32,u33] claim/agreed claim u30 outcomes {"openui-v1":{"v1:g6":"separated"},"openui-v2":{"v2:g26":"separated"}} carriers {"openui-v1":["v1:g7"],"openui-v2":["v2:g28"]}

- X: x18 [u35] set (R3, medium) clause "Tag purges can also be large." → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  Y: y17 [u35] set (R3, low) clause "Tag purges can also be large." → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  context: phase3 c7 [u35,u36] set/agreed claim u30 outcomes {"openui-v1":{"v1:g6":"separated"},"openui-v2":{"v2:g26":"separated"}} carriers {"openui-v1":["v1:g7"],"openui-v2":["v2:g30"]}

- X: x19 [u36] set (R3, medium) clause "the origin has to absorb the burst of cache misses that follows" → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  Y: y18 [u36] set (R3, medium) clause "the origin has to absorb the burst of cache misses that follows" → claim u30 "A single purge of the key `story-417` then removes every cached page that included that story"
  context: phase3 c7 [u35,u36] set/agreed claim u30 outcomes {"openui-v1":{"v1:g6":"separated"},"openui-v2":{"v2:g26":"separated"}} carriers {"openui-v1":["v1:g7"],"openui-v2":["v2:g30"]}

- X: x20 [u40] claim (R4, medium) clause "where a minute of staleness is acceptable" → claim u40 "Larkspur uses it on article pages"
  Y: y19 [u40] claim (general, medium) clause "where a minute of staleness is acceptable" → claim u37 "Stale-while-revalidate turns expiry from a wait into a background task."
  context: phase3 a1 [u40] set/adjudicated claim u37+u38+u39 outcomes {"openui-v1":{"v1:g8":"absent"},"openui-v2":{"v2:g31":"separated","v2:g32":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g33"]}
  context: phase3 a4 [u40] set/adjudicated claim u37+u38+u39 outcomes {"openui-v1":{"v1:g8":"absent"},"openui-v2":{"v2:g31":"separated","v2:g32":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g33"]}

- X: x21 [u40] claim (R4, medium) clause "but not on live election results" → claim u40 "Larkspur uses it on article pages"
  Y: y20 [u40] claim (general, medium) clause "but not on live election results" → claim u40 "Larkspur uses it on article pages"
  context: phase3 a1 [u40] set/adjudicated claim u37+u38+u39 outcomes {"openui-v1":{"v1:g8":"absent"},"openui-v2":{"v2:g31":"separated","v2:g32":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g33"]}
  context: phase3 a4 [u40] set/adjudicated claim u37+u38+u39 outcomes {"openui-v1":{"v1:g8":"absent"},"openui-v2":{"v2:g31":"separated","v2:g32":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g33"]}

- X: x22 [u41] claim (general, high) clause "an expired copy is served for at most 60 seconds past its TTL" → claim u38 "returns the expired copy immediately and fetches a fresh one from the origin in the background"
  Y: y21 [u41] claim (general, high) clause "an expired copy is served for at most 60 seconds past its TTL" → claim u38 "returns the expired copy immediately and fetches a fresh one from the origin in the background"
  context: phase3 c8 [u41] claim/agreed claim u38 outcomes {"openui-v1":{"v1:g8":"absent"},"openui-v2":{"v2:g31":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g34"]}

- X: x23 [u41] set (general, medium) clause "after that the edge waits for the origin as it would on an ordinary miss" → claim u38 "returns the expired copy immediately and fetches a fresh one from the origin in the background"
  Y: y22 [u41] claim (general, medium) clause "after that the edge waits for the origin as it would on an ordinary miss" → claim u39 "The reader gets a fast response"
  context: phase3 c8 [u41] claim/agreed claim u38 outcomes {"openui-v1":{"v1:g8":"absent"},"openui-v2":{"v2:g31":"separated"}} carriers {"openui-v1":[],"openui-v2":["v2:g34"]}

- X: x24 [u42] claim (general, high) clause "while the origin is returning errors" → claim u42 "lets the edge keep serving the expired copy for up to 86,400 seconds, or one day"
  Y: y23 [u42] claim (general, high) clause "while the origin is returning errors" → claim u42 "lets the edge keep serving the expired copy"
  context: phase3 c9 [u42] ambiguous/agreed claim u41 outcomes {"openui-v1":{},"openui-v2":{"v2:g34":"separated"}} carriers {"openui-v1":["v1:g9"],"openui-v2":["v2:g35"]}

- X: x25 [u42] set (general, medium) clause "for up to 86,400 seconds, or one day" → claim u42 "lets the edge keep serving the expired copy"
  Y: y24 [u42] set (general, medium) clause "for up to 86,400 seconds, or one day" → claim u42 "lets the edge keep serving the expired copy"
  context: phase3 c9 [u42] ambiguous/agreed claim u41 outcomes {"openui-v1":{},"openui-v2":{"v2:g34":"separated"}} carriers {"openui-v1":["v1:g9"],"openui-v2":["v2:g35"]}

- X: x26 [u43] claim (R3, medium) clause "not a way to make content fresher" → claim u37 "Stale-while-revalidate turns expiry from a wait into a background task."
  Y: y25 [u43] claim (general, medium) clause "not a way to make content fresher" → claim u37 "Stale-while-revalidate turns expiry from a wait into a background task."
  context: phase3 c10 [u43,u44] set/agreed claim u39 outcomes {"openui-v1":{"v1:g8":"separated"},"openui-v2":{"v2:g32":"separated"}} carriers {"openui-v1":["v1:g10"],"openui-v2":["v2:g36","v2:g37"]}

- X: x27 [u44] claim (R3, high) clause "but it also means some readers see a copy that is older than the TTL alone would suggest" → claim u44 "It hides a slow origin from readers"
  Y: y26 [u44] claim (R3, high) clause "but it also means some readers see a copy that is older than the TTL alone would suggest" → claim u44 "It hides a slow origin from readers"
  context: phase3 c10 [u43,u44] set/agreed claim u39 outcomes {"openui-v1":{"v1:g8":"separated"},"openui-v2":{"v2:g32":"separated"}} carriers {"openui-v1":["v1:g10"],"openui-v2":["v2:g36","v2:g37"]}

- X: x28 [u49] claim (R4, high) clause "Versioning does not help for HTML entry pages." → claim u46 "a changed file gets a new URL and the old cached copy is simply never requested again"
  Y: y27 [u49] claim (general, medium) clause "Versioning does not help for HTML entry pages." → claim u45 "the cleanest invalidation is a new name"
  context: phase3 c11 [u49,u50] set/adjudicated claim u45 outcomes {"openui-v1":{"v1:g11":"separated"},"openui-v2":{"v2:g38":"separated"}} carriers {"openui-v1":["v1:g12"],"openui-v2":["v2:g41"]}

- X: x29 [u50] claim (R1, medium) clause "so they still need a TTL, a purge or both" → claim u46 "a changed file gets a new URL and the old cached copy is simply never requested again"
  Y: y28 [u50] claim (R1, medium) clause "so they still need a TTL, a purge or both" → claim u45 "the cleanest invalidation is a new name"
  context: phase3 c11 [u49,u50] set/adjudicated claim u45 outcomes {"openui-v1":{"v1:g11":"separated"},"openui-v2":{"v2:g38":"separated"}} carriers {"openui-v1":["v1:g12"],"openui-v2":["v2:g41"]}

- X: x30 [u51] claim (R4, medium) clause "If an HTML page stays cached longer than the origin keeps the old asset files" → claim u46 "the old cached copy is simply never requested again"
  Y: y29 [u51] claim (general, medium) clause "If an HTML page stays cached longer than the origin keeps the old asset files" → claim u46 "the old cached copy is simply never requested again"
  context: phase3 c12 [u51,u52] claim/agreed claim u46 outcomes {"openui-v1":{"v1:g11":"separated"},"openui-v2":{}} carriers {"openui-v1":["v1:g12"],"openui-v2":["v2:g42","v2:g43"]}

- X: x31 [u52] claim (R1, high) clause "for at least as long as the longest HTML TTL" → claim u52 "Old asset versions should therefore stay available"
  Y: y30 [u52] claim (R1, high) clause "for at least as long as the longest HTML TTL" → claim u52 "Old asset versions should therefore stay available"
  context: phase3 c12 [u51,u52] claim/agreed claim u46 outcomes {"openui-v1":{"v1:g11":"separated"},"openui-v2":{}} carriers {"openui-v1":["v1:g12"],"openui-v2":["v2:g42","v2:g43"]}

- X: x32 [u55] claim (R3, medium) clause "Cannot be shortened after the fact" → claim u55 "TTL expiry | Up to the full TTL (300 seconds at Larkspur)"
  Y: y32 [u55] set (R3, low) clause "Cannot be shortened after the fact" → claim u8 "TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default."
  context: phase3 c1 [u10,u11,u55] set/agreed claim u6 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g4":"separated"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g8","v2:g9"]}

- X: x33 [u55] set (R3, medium) clause "More origin traffic as the TTL shrinks" → claim u55 "TTL expiry | Up to the full TTL (300 seconds at Larkspur)"
  Y: y31 [u55] set (R3, medium) clause "More origin traffic as the TTL shrinks" → claim u8 "TTL expiry needs no coordination between the origin and the edge, which is why every CDN uses it as the default."
  context: phase3 c1 [u10,u11,u55] set/agreed claim u6 outcomes {"openui-v1":{"v1:g2":"separated"},"openui-v2":{"v2:g4":"separated"}} carriers {"openui-v1":["v1:g3"],"openui-v2":["v2:g8","v2:g9"]}

- X: x34 [u62] claim (R5, medium) clause "static" → claim u62 "versioned names take static assets out of the problem entirely"
  Y: y34 [u62] claim (general, medium) clause "static assets" → claim u62 "versioned names take static assets out of the problem entirely"
  context: phase3 c13 [u62] not_a_condition/agreed claim -

- X: x35 [u62] set (general, low) clause "when the origin struggles" → claim u62 "stale serving keeps the site fast"
  Y: y33 [u62] set (general, low) clause "when the origin struggles" → claim u62 "stale serving keeps the site fast"
  context: phase3 c13 [u62] not_a_condition/agreed claim -

## Found by X only

- x2 [u9] claim (general, medium) clause "when it has not" → claim u9 "receive a short `304 Not Modified` answer"
  context: phase3 a3 [u9] claim/agreed claim u9 outcomes {"openui-v1":{"v1:g2":"carried"},"openui-v2":{"v2:g7":"carried"}} carriers {"openui-v1":["v1:g2"],"openui-v2":["v2:g7"]}
  context: phase3 a6 [u9] claim/agreed claim u9 outcomes {"openui-v1":{"v1:g2":"carried"},"openui-v2":{"v2:g7":"carried"}} carriers {"openui-v1":["v1:g2"],"openui-v2":["v2:g7"]}

## Found by Y only

- y35 [u45] claim (general, medium) clause "For static assets" → claim u45 "the cleanest invalidation is a new name"

