# Second review packet: kn-02-edge-cache-invalidation

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

## Candidate conditions (the span to judge; its claim link and binding are YOURS to decide)
c1: units u10, u11, u55 :: Its weakness is that the TTL is a guess made in advance. If an editor corrects a headline 60 seconds after publishing, readers can keep seeing the old headline for up to the remaining 240 seconds of a 300-second TTL, and nothing the origin does will shorten that wait. TTL expiry | Up to the full TTL (300 seconds at Larkspur) | More origin traffic as the TTL shrinks | Cannot be shortened after the fact
c2: units u16, u17, u18 :: A purge request is accepted quickly, but it is not applied everywhere at the same moment. The CDN has to deliver the purge to every edge location, and each location removes its copy on its own schedule, so for a short time some locations serve the new version while others still serve the old one. Purging is eventually consistent, not instant.
c3: units u19, u20, u21 :: Purging by URL has a second limit: it removes only the exact URL you name. A corrected headline also appears on the home page, the section page and the RSS feed, and each of those cached pages keeps the old headline until it is purged separately or expires. Query strings make this worse, because `/story/417?ref=social` is a different cache entry from `/story/417` and is not removed by purging it.
c4: units u22 :: Purge APIs are also rate limited; Larkspur's plan allows 1,000 purge calls per minute, which a bulk correction across the archive can exhaust.
c5: units u26 :: In Larkspur's measurements, half of the locations had applied a purge within 2 seconds, and the slowest location took 20 seconds.
c6: units u32, u33 :: The responsibility moves to the origin. A page is only purged by a key if the origin tagged it with that key, and a missing tag produces a stale page with no error anywhere.
c7: units u35, u36 :: Tag purges can also be large. Purging `section-politics` at Larkspur removes about 12,000 cached objects at once, and the origin has to absorb the burst of cache misses that follows.
c8: units u41 :: The bound matters: an expired copy is served for at most 60 seconds past its TTL, and after that the edge waits for the origin as it would on an ordinary miss.
c9: units u42 :: A related directive, `stale-if-error=86400`, lets the edge keep serving the expired copy for up to 86,400 seconds, or one day, while the origin is returning errors.
c10: units u43, u44 :: Serving stale is a choice about tolerance, not a way to make content fresher. It hides a slow origin from readers, but it also means some readers see a copy that is older than the TTL alone would suggest.
c11: units u49, u50 :: Versioning does not help for HTML entry pages. The home page and article pages are requested at fixed addresses such as `/` and `/story/417`, and they are the pages that point to the new asset names, so they still need a TTL, a purge or both.
c12: units u51, u52 :: If an HTML page stays cached longer than the origin keeps the old asset files, it can send readers to files that no longer exist. Old asset versions should therefore stay available for at least as long as the longest HTML TTL.
c13: units u62 :: Short TTLs are the safety net, purges handle urgent corrections, stale serving keeps the site fast when the origin struggles, and versioned names take static assets out of the problem entirely.
