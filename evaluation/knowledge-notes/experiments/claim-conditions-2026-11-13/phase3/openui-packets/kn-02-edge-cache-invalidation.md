# OpenUI note sets: kn-02-edge-cache-invalidation

Saved replies of generate_openui_notes (gemini-2.5-flash, 2026-11-13). No frames or arrows: each card stands alone. Card id = <variant>:<key>.

## v1 (14 cards). Each line: id, cites (claimed sources), then the visible text (title | body | detail).
v1:g1 cites=u1,u2,u3,u4,u5,u60,u61 :: CDN Caching Strategies for Content Sites | Running a content-heavy site behind a CDN requires a combination of caching strategies to balance page speed with content freshness. No single technique is sufficient, and a dependable setup layers several methods.
v1:g2 cites=u6,u7,u8 :: Time to Live (TTL) Expiry | TTL expiry is the simplest invalidation method where cached objects are discarded or rechecked after a set time. The origin sets the TTL using the `Cache-Control` header. | When a TTL expires, the edge may revalidate with an ETag instead of re-downloading the entire object.
v1:g3 cites=u10,u11,u12 :: Weakness of TTL Expiry | The main weakness of TTL expiry is that the TTL is a pre-determined guess. If content changes before the TTL expires, readers may see outdated information for the remaining duration. | Shortening the TTL reduces the window for stale content but significantly increases origin traffic.
v1:g4 cites=u13,u14,u15 :: Purging by URL | To immediately update content, the origin can request the CDN to purge a specific URL, removing the cached copy and forcing the next request to fetch fresh content from the origin.
v1:g5 cites=u16,u17,u18,u19,u20,u21,u22,u23,u24,u25,u26,u27 :: Limitations of Purging by URL | Purging by URL is eventually consistent, not instant, as the purge request needs to be delivered to all edge locations. It also only removes the exact URL specified, missing other pages or URLs with query strings that display the same content.
v1:g6 cites=u28,u29,u30 :: Surrogate Keys for Purging | Surrogate keys allow the origin to tag responses with labels, enabling a single purge request to remove all cached pages associated with a specific key, such as an article appearing on multiple pages.
v1:g7 cites=u31,u32,u33,u34,u35,u36 :: Challenges with Surrogate Keys | The origin is responsible for accurate tagging; missing tags can lead to stale pages. Like URL purges, tag purges are eventually consistent and can be large, potentially causing a burst of cache misses at the origin.
v1:g8 cites=u37,u38,u39,u40,u41 :: Stale-While-Revalidate | This technique allows an edge location to immediately serve an expired copy of content while fetching a fresh version from the origin in the background, improving reader response time.
v1:g9 cites=u42 :: Stale-If-Error Directive | The `stale-if-error` directive allows the edge to continue serving expired content for an extended period if the origin is returning errors, providing resilience during origin outages.
v1:g10 cites=u43,u44 :: Considerations for Stale Serving | Serving stale content is a trade-off for tolerance and hides slow origins, but it means readers might see older content than the TTL alone would suggest. It does not make content fresher.
v1:g11 cites=u45,u46,u47,u48 :: Versioning Static Assets with New Names | For static assets, the most effective invalidation method is to include a hash of the file's content in its name. This creates a new URL for changed files, allowing old cached copies to be permanently cached and never requested again.
v1:g12 cites=u49,u50,u51,u52 :: Versioning Limitations for HTML Pages | Versioning does not apply to HTML entry pages, which are requested at fixed addresses. These pages still require TTLs or purges and must point to the correct asset versions, ensuring old asset files remain available as long as the HTML pages are cached.
v1:g13 cites=u53,u54,u55,u56,u57,u58,u59 :: Comparison of Invalidation Techniques | Different caching invalidation techniques offer varying levels of freshness, costs, and caveats, requiring a layered approach for a robust content delivery strategy.
v1:g14 cites=u61,u62,u63 :: Layered Invalidation Strategy | A reliable CDN setup combines short TTLs as a safety net, explicit purges for urgent corrections, stale serving for origin resilience, and versioned file names for static assets to cover each other's gaps.

## v2 (48 cards). Each line: id, cites (claimed sources), then the visible text (title | body | detail).
v2:g1 cites=u1,u5 :: Content-heavy site CDN series | This is the third article in a series about running a "content-heavy" site behind a CDN, using Larkspur Media as an example.
v2:g2 cites=u2,u3 :: Caching challenges | Caching at the edge improves page speed, but cached copies can become outdated, and the main challenge is managing their replacement efficiently.
v2:g3 cites=u4,u61 :: Layered invalidation techniques | No single invalidation technique is sufficient; a dependable CDN setup requires layering several methods to ensure content freshness.
v2:g4 cites=u6 :: TTL expiry for caching | The simplest invalidation method is using a time to live (TTL), where each cached object has a set expiry time after which the edge discards or rechecks its copy.
v2:g5 cites=u7 :: Setting TTL with Cache-Control | The origin server sets the TTL using the `Cache-Control` header; for instance, `Cache-Control: max-age=300` allows an edge location to cache a copy for "300 seconds".
v2:g6 cites=u8 :: TTL expiry as CDN default | TTL expiry is the default for all CDNs because it requires no coordination between the origin and the edge.
v2:g7 cites=u9 :: Conditional revalidation with ETag | When a TTL expires, the edge can use an `ETag` to ask the origin if the copy has changed, receiving a "304 Not Modified" response if it hasn't, avoiding a full download.
v2:g8 (no cites) :: Weakness of TTL: fixed guess | The primary weakness of TTL is that it's a predetermined guess, which can lead to stale content if updates occur before the TTL expires.
v2:g9 cites=u11 :: Stale content with TTL | If content is updated, like a headline corrected "60 seconds" after publishing, readers might see the old version for up to the remaining "240 seconds" of a "300-second" TTL.
v2:g10 cites=u12 :: Shortening TTL increases origin traffic | Reducing the TTL narrows the window for stale content but significantly increases requests to the origin; Larkspur's origin traffic rose "eightfold" when its article TTL dropped from "300" to "30 seconds".
v2:g11 cites=u13 :: Purging by URL for immediate changes | When content requires immediate changes, the origin can request the CDN to purge a specific URL, removing its cached copy.
v2:g12 (no cites) :: Effect of URL purge | A URL purge removes the cached copy, forcing the next request for that URL to fetch fresh content directly from the origin.
v2:g13 cites=u15 :: Larkspur's purge implementation | Larkspur's publishing system automatically sends a purge request for an article's URL whenever an editor saves a correction.
v2:g14 cites=u16,u17 :: Purge consistency and timing | Purge requests are accepted quickly but are not applied simultaneously across all edge locations, leading to a brief period where some locations serve new content while others serve old.
v2:g15 (no cites) :: Purging is eventually consistent | Purging is an eventually consistent process, meaning it takes time to propagate across the CDN, rather than being instantaneous.
v2:g16 (no cites) :: Limitation of URL purging: exact match | Purging by URL only removes the exact URL specified, failing to update other cached pages that display the same content.
v2:g17 (no cites) :: URL purging misses related content | A corrected headline on an article page will remain stale on the home page, section page, and RSS feed until those pages are separately purged or expire.
v2:g18 cites=u21 :: Query strings and URL purging | Query strings complicate URL purging because `/story/417?ref=social` is treated as a distinct cache entry from `/story/417` and won't be removed by purging the latter.
v2:g19 cites=u22 :: Purge API rate limits | Purge APIs are rate-limited; Larkspur's plan allows "1,000" purge calls per minute, which can be quickly exhausted by bulk corrections.
v2:g20 cites=u23 :: Purge request queuing | The origin calls the purge API, which responds within about "150 milliseconds", but this response only confirms the request has been queued, not applied.
v2:g21 cites=u24 :: Purge propagation to edge locations | The CDN's control plane distributes the purge request to all "90" edge locations.
v2:g22 (no cites) :: Edge location purge action | Each edge location marks its cached copy as invalid, causing the next request for that content to be a cache miss and fetch from the origin.
v2:g23 cites=u26 :: Purge application timing | Larkspur's measurements show that "half" of the locations applied a purge within "2 seconds", with the slowest taking "20 seconds".
v2:g24 (no cites) :: Temporary inconsistency with purging | Until the purge is applied at every edge location, readers routed to slower-updating locations will still receive the old content.
v2:g25 cites=u28,u29 :: Surrogate keys for related content invalidation | Surrogate keys address the problem of invalidating related content by allowing the origin to tag responses with keys like `Surrogate-Key: story-417 section-politics`.
v2:g26 cites=u30 :: Broad invalidation with surrogate keys | A single purge of a surrogate key, such as `story-417`, removes all cached pages tagged with that key, including the article, home page, section page, and feed.
v2:g27 cites=u31 :: Surrogate key granularity and limits | Surrogate keys offer flexible granularity, but adding more keys lengthens the header; Larkspur limits responses to under "50" keys.
v2:g28 cites=u32,u33 :: Origin's responsibility for surrogate keys | Using surrogate keys shifts the responsibility for accurate tagging to the origin; a missing tag will result in a stale page without any error notification.
v2:g29 (no cites) :: Surrogate key purge consistency | Similar to URL purging, tag purges are delivered to each edge location separately, causing a brief period of inconsistency where some locations serve updated pages and others serve old ones.
v2:g30 cites=u35,u36 :: Large-scale tag purges | Tag purges can be extensive; purging `section-politics` at Larkspur invalidates approximately "12,000" cached objects, leading to a burst of cache misses at the origin.
v2:g31 cites=u37,u38 :: Stale-while-revalidate for background updates | `Stale-while-revalidate` transforms TTL expiry into a background task, allowing an edge location to immediately serve an expired copy while fetching a fresh one.
v2:g32 (no cites) :: Reader experience with stale-while-revalidate | With `stale-while-revalidate`, the initial reader gets a fast response from the expired copy, and subsequent readers receive the refreshed content.
v2:g33 cites=u40 :: Acceptable staleness with stale-while-revalidate | Larkspur uses `stale-while-revalidate` on article pages where a minute of staleness is acceptable, but not for time-sensitive content like live election results.
v2:g34 cites=u41 :: Stale-while-revalidate time bound | An expired copy is served for a maximum of "60 seconds" past its TTL with `stale-while-revalidate`; after this, the edge waits for the origin like a regular cache miss.
v2:g35 cites=u42 :: Stale-if-error directive | The `stale-if-error=86400` directive allows the edge to continue serving an expired copy for up to "86,400 seconds" (one day) if the origin is returning errors.
v2:g36 (no cites) :: Stale serving as tolerance, not freshness | Serving stale content is a choice about tolerance for older content, not a method to make content fresher.
v2:g37 cites=u44 :: Trade-offs of stale serving | While stale serving hides a slow origin from readers, it also means some readers might see content older than the TTL alone would suggest.
v2:g38 cites=u45,u46 :: Versioning for static asset invalidation | For static assets, the most effective invalidation method is to give them a new name, typically by including a hash of their contents in the filename, like `app.3f9c2e.js`.
v2:g39 cites=u47 :: Long caching for versioned URLs | Versioned URLs, whose content never changes, can be cached for extended periods; Larkspur serves its versioned assets with `max-age=31536000`, equivalent to one year.
v2:g40 cites=u48 :: Automating versioning with build tools | Most build tools can automatically add content hashes to filenames, making the cost a "one-time" change to the build configuration.
v2:g41 cites=u49,u50 :: Versioning limitations for HTML entry pages | Versioning does not apply to HTML entry pages, such as the home page or article pages like `/story/417`, which are requested at fixed addresses.
v2:g42 cites=u51 :: HTML TTL and asset availability | If an HTML page remains cached longer than the origin retains old asset files, it can direct readers to non-existent files.
v2:g43 cites=u52 :: Retaining old asset versions | To prevent broken links, old asset versions should remain available for at least as long as the longest HTML TTL.
v2:g44 cites=u53,u54,u55,u56,u57,u58,u59 :: Invalidation techniques comparison | The table below summarizes the comparison of different invalidation techniques.
v2:g46 cites=u60 :: Invalidation is a set of trade-offs | Invalidation at the edge involves a series of "trade-offs" rather than a single solution.
v2:g47 cites=u62 :: Combining invalidation techniques | A robust invalidation strategy combines short TTLs, explicit purges, deliberate stale serving, and versioned filenames to cover each other's weaknesses.
v2:g48 cites=u63 :: Planning for purge propagation delay | Regardless of the invalidation mix, anticipate a window of several seconds during which some readers may still see old content due to purge propagation delays.
v2:g49 cites=u64 :: Next article: cache keys and personalization | The next article in this series will cover cache keys and personalization.

