# Adjudication packet: kn-07-photo-sharing-hld

## Source units (id [heading path] text)
u1 [Pinhole: high-level design for photo sharing › Purpose and scope] Pinhole lets people post photos and see the photos of the accounts they follow in a feed.
u2 [Pinhole: high-level design for photo sharing › Purpose and scope] The design is sized for about 2 million daily active users at launch.
u3 [Pinhole: high-level design for photo sharing › Purpose and scope] This document is the high-level design only: it names the parts of the system, what each part is responsible for, how the parts talk to each other and why we chose this shape.
u4 [Pinhole: high-level design for photo sharing › Purpose and scope] It does not describe code, internal modules or individual operations; those belong in the low-level designs that each service team will write later.
u5 [Pinhole: high-level design for photo sharing › Clients] People use Pinhole through two clients: a mobile app for iOS and Android, and a web app that runs in the browser.
u6 [Pinhole: high-level design for photo sharing › Clients] Both clients speak the same public HTTPS API and hold no business rules of their own beyond simple input checks.
u7 [Pinhole: high-level design for photo sharing › Clients] Clients upload a photo directly to object storage with a short-lived signed URL, so large files never pass through our own services.
u8 [Pinhole: high-level design for photo sharing › Edge and API] Every client request enters through the API gateway.
u9 [Pinhole: high-level design for photo sharing › Edge and API] The gateway terminates TLS, checks the caller's access token with the auth service, applies a rate limit of 120 requests per minute per account, and routes the request to the right service.
u10 [Pinhole: high-level design for photo sharing › Edge and API] If the auth service cannot be reached, the gateway rejects the request instead of letting it through unchecked.
u11 [Pinhole: high-level design for photo sharing › Edge and API] Photo bytes are served to clients by the CDN, never by the gateway.
u12 [Pinhole: high-level design for photo sharing › Core services] The auth service issues and verifies access tokens and owns accounts and sessions.
u13 [Pinhole: high-level design for photo sharing › Core services] The upload service hands the client a signed upload URL, records the new photo in the metadata database with the status "processing" once the upload completes, and publishes a PhotoUploaded event to the message queue.
u14 [Pinhole: high-level design for photo sharing › Core services] The feed service builds each person's feed from the photos of the accounts they follow: it reads photo metadata from the metadata database and keeps ready-made feed pages in the cache.
u15 [Pinhole: high-level design for photo sharing › Asynchronous processing] Media processing workers subscribe to PhotoUploaded events on the message queue.
u16 [Pinhole: high-level design for photo sharing › Asynchronous processing] For each event, a worker reads the original from object storage, creates thumbnails in three sizes (150, 640 and 1080 pixels wide), writes them back to object storage and marks the photo "ready" in the metadata database.
u17 [Pinhole: high-level design for photo sharing › Asynchronous processing] The worker then publishes a PhotoReady event.
u18 [Pinhole: high-level design for photo sharing › Asynchronous processing] The feed service subscribes to PhotoReady events to add the photo to the followers' feeds, and asks the push-notification provider to alert followers who have notifications turned on.
u19 [Pinhole: high-level design for photo sharing › Asynchronous processing] The queue keeps an event for up to 7 days, so a worker outage delays thumbnails but does not lose uploads.
u20 [Pinhole: high-level design for photo sharing › Asynchronous processing] A photo whose processing keeps failing stays in the "processing" state and is not shown in any feed.
u21 [Pinhole: high-level design for photo sharing › Storage] Object storage holds the original photos and their thumbnails; originals are kept unchanged and are never overwritten.
u22 [Pinhole: high-level design for photo sharing › Storage] The metadata database holds follow relationships and photo records with their processing status, and it is the source of truth for whether a photo exists.
u23 [Pinhole: high-level design for photo sharing › Storage] The cache holds ready-made feed pages for 60 seconds.
u24 [Pinhole: high-level design for photo sharing › Storage] It is only a copy kept for speed: losing it makes feeds slower, never wrong.
u25 [Pinhole: high-level design for photo sharing › External dependencies and system boundary] The CDN and the push-notification provider are run by third parties and sit outside the Pinhole system boundary.
u26 [Pinhole: high-level design for photo sharing › External dependencies and system boundary] The CDN reads photos and thumbnails from object storage and serves them to clients from locations close to the user.
u27 [Pinhole: high-level design for photo sharing › External dependencies and system boundary] The push-notification provider delivers alerts to phones; Pinhole only sends it requests and does not control when an alert arrives.
u28 [Pinhole: high-level design for photo sharing › External dependencies and system boundary] Everything else in this document (the gateway, the three services, the workers, the queue and the three stores) is inside the boundary and is operated by the Pinhole team.
u29 [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] The client asks the upload service for a signed URL and uploads the original straight to object storage.
u30 [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] The upload service records the photo as "processing" and publishes PhotoUploaded.
u31 [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] A media processing worker picks up the event, creates the thumbnails and marks the photo "ready".
u32 [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] The worker publishes PhotoReady; the feed service adds the photo to the followers' feeds and asks the push-notification provider to alert them.
u33 [Pinhole: high-level design for photo sharing › Main data flow: posting a photo] Followers' clients fetch the updated feed through the gateway and load the thumbnails from the CDN.
u34 [Pinhole: high-level design for photo sharing › Design decisions] **A queue between upload and processing.** A slow or failed thumbnail job must never block or fail an upload, so the upload service and the workers only meet through the message queue. The cost is that a new photo takes a few seconds to appear in feeds.
u35 [Pinhole: high-level design for photo sharing › Design decisions] **Direct upload with signed URLs.** Originals can be up to 25 MB, and routing them through the gateway would make it the bottleneck, so clients send bytes straight to object storage and the upload service only signs the URL and records the result.
u36 [Pinhole: high-level design for photo sharing › Design decisions] **Metadata apart from bytes.** Photo bytes live in object storage and everything we query lives in the metadata database, because the two grow at very different rates and need different backups.
u37 [Pinhole: high-level design for photo sharing › Design decisions] **The cache is disposable.** Feed pages are cached for speed only; the metadata database stays the source of truth, so the cache can be flushed at any time.
u38 [Pinhole: high-level design for photo sharing › Design decisions] **Buy delivery, don't build it.** We use a third-party CDN and push-notification provider instead of running our own, and we accept that their outages are outside our control.
u39 [Pinhole: high-level design for photo sharing › Open questions] How failed processing is retried, and when a stuck photo is cleaned up, is not decided yet.
u40 [Pinhole: high-level design for photo sharing › Open questions] Whether the feed service should precompute feeds for accounts with very many followers is left to the feed service's own low-level design.

## Candidates with every reading

### c1: condition units u7
- R1 (phase 2 blind reviewer) r4: claim u7, binding set — The signed URL is short-lived.
- R2 (blind): not_a_condition, claim - (medium) — condition "with a short-lived signed URL, so large files never pass through our own services" / claim "Clients upload a photo directly to object storage" — Mechanism and rationale for the direct upload, not a limit on another claim.

### c2: condition units u9
- R1 (phase 2 blind reviewer) r2: claim u9, binding set — The rate limit is 120 requests per minute per account.
- R2 (blind): set, claim u9 (medium) — condition "applies a rate limit of 120 requests per minute per account" / claim "routes the request to the right service" — A real numeric limit on gateway traffic; the routing claim stays broadly true.

### c3: condition units u10
- GOLDEN dataset link ku.gateway-fails-closed → ku.gateway: claim u8+u9 — If the auth service cannot be reached, the gateway rejects the request instead of letting it through unchecked.
- R1 (phase 2 blind reviewer) r1: claim u9, binding claim — If the auth service cannot be reached, the gateway rejects the request (fails closed) rather than letting it through.
- R2 (blind): set, claim u9 (medium) — condition "If the auth service cannot be reached, the gateway rejects the request instead of letting it through unchecked." / claim "checks the caller's access token with the auth service" — Fail-closed behaviour of the token check; important but the check claim stays true without it.

### c4: condition units u11
- R1 (phase 2 blind reviewer) r3: claim u8, binding claim — Photo bytes are served to clients by the CDN, never by the gateway.
- R2 (blind): claim, claim u8 (medium) — condition "Photo bytes are served to clients by the CDN, never by the gateway." / claim "Every client request enters through the API gateway." — Photo byte fetches (and direct uploads) bypass the gateway, so 'every client request' is misleading without this exception.

### c5: condition units u18
- R1 (phase 2 blind reviewer) r12: claim u18+u32, binding claim — Only followers who have notifications turned on are alerted.
- R2 (blind): claim, claim u18 (medium) — condition "followers who have notifications turned on" / claim "asks the push-notification provider to alert followers" — Dropping the scope makes the alert claim (and the u32 flow step) read as alerting all followers.

### c6: condition units u19
- GOLDEN dataset link ku.queue-retention → ku.message-queue: claim u13+u15+u17+u18 — The queue keeps an event for up to 7 days, so a worker outage delays thumbnails but does not lose uploads.
- R1 (phase 2 blind reviewer) r6: claim u19, binding claim — Because the queue keeps an event for up to 7 days.
- R2 (blind): claim, claim u19 (high) — condition "The queue keeps an event for up to 7 days" / claim "a worker outage delays thumbnails but does not lose uploads" — 'Does not lose uploads' is false for an outage longer than 7 days.

### c7: condition units u20
- GOLDEN dataset link ku.stuck-photos → ku.workers: claim u15+u16+u17+u31 — A photo whose processing keeps failing stays in the processing state and is not shown in any feed.
- R1 (phase 2 blind reviewer) r7: claim u31+u32, binding claim — A photo whose processing keeps failing stays 'processing' and is never shown in any feed.
- R2 (blind): set, claim u32 (medium) — condition "A photo whose processing keeps failing stays in the "processing" state and is not shown in any feed." / claim "the feed service adds the photo to the followers' feeds" — Failure-path outcome of the posting flow; the success-path description stays true.

### c8: condition units u23
- R1 (phase 2 blind reviewer) r8: claim u14+u23, binding set — Feed pages are cached for 60 seconds.
- R2 (blind): set, claim u14 (medium) — condition "for 60 seconds" / claim "keeps ready-made feed pages in the cache" — Cache lifetime bound (staleness window); claim stays true.

### c9: condition units u27
- R1 (phase 2 blind reviewer) r11: claim u18+u32, binding set — Pinhole only sends requests and does not control when an alert arrives.
- R2 (blind): set, claim u18 (medium) — condition "Pinhole only sends it requests and does not control when an alert arrives" / claim "asks the push-notification provider to alert followers who have notifications turned on" — Delivery-timing caveat on the alerting step.

### c10: condition units u34
- R1 (phase 2 blind reviewer) r5: claim u34, binding set — Cost: a new photo takes a few seconds to appear in feeds.
- R2 (blind): set, claim u34 (high) — condition "The cost is that a new photo takes a few seconds to appear in feeds." / claim "the upload service and the workers only meet through the message queue" — Stated trade-off of the queue decision.

### c11: condition units u35
- R1 (phase 2 blind reviewer) r9: claim u35, binding set — Originals can be up to 25 MB (the deciding fact).
- R2 (blind): set, claim u35 (low) — condition "Originals can be up to 25 MB" / claim "clients send bytes straight to object storage and the upload service only signs the URL and records the result" — Mainly rationale, but it also states the size bound on originals, which a reader should keep.

### c12: condition units u38
- R1 (phase 2 blind reviewer) r10: claim u38, binding set — We accept that their outages are outside our control.
- R2 (blind): set, claim u38 (high) — condition "we accept that their outages are outside our control" / claim "We use a third-party CDN and push-notification provider instead of running our own" — Accepted risk of the buy decision.

### c13: condition units u39
- R1 (phase 2 blind reviewer) r13: claim u20, binding set — How failed processing is retried and when a stuck photo is cleaned up is not decided yet.
- R2 (blind): set, claim u20 (medium) — condition "How failed processing is retried, and when a stuck photo is cleaned up, is not decided yet." / claim "A photo whose processing keeps failing stays in the "processing" state and is not shown in any feed." — Open question on the failure path; the stated behaviour holds for now.

## Additional conditions proposed by a second reviewer (ids a1, a2… in your output)

### a1: condition units u2 — from R2: set, claim u1 — condition "The design is sized for about 2 million daily active users at launch." / claim "Pinhole lets people post photos and see the photos of the accounts they follow in a feed." — Capacity scope of the whole design; no single claim sentence it limits, so linked to the system statement.

### a2: condition units u40 — from R2: set, claim u14 — condition "Whether the feed service should precompute feeds for accounts with very many followers is left to the feed service's own low-level design." / claim "The feed service builds each person's feed from the photos of the accounts they follow" — Open question on how feed building scales for high-follower accounts.

