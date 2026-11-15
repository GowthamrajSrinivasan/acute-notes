# Phase 4 adjudication packet: kn-07-photo-sharing-hld

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

Note set(s): ../phase2/packets/kn-07-photo-sharing-hld.md (distil)

## Matched pairs (X and Y found the same clause)

- X: x1 [u2] set (R5, medium) clause "for about 2 million daily active users at launch" → claim u2 "The design is sized"
  Y: y1 [u2] set (R5, medium) clause "about 2 million daily active users at launch" → claim u2 "The design is sized for about 2 million daily active users at launch"
  context: phase3 a1 [u2] ambiguous/unresolved claim u1 outcomes {"distil":{"u1_n1":"frame","u1_ax1":"frame"}} carriers {"distil":["u1_n2","u1_ax2","subtitle","g0"]}

- X: x2 [u7] set (R5, medium) clause "short-lived" → claim u7 "Clients upload a photo directly to object storage with a short-lived signed URL"
  Y: y2 [u7] set (R5, medium) clause "short-lived" → claim u7 "Clients upload a photo directly to object storage with a short-lived signed URL"
  context: phase3 c1 [u7] ambiguous/unresolved claim u7 outcomes {"distil":{"u2_n19":"carried","u2_n22":"separated","u3_n2":"separated","u4_n4":"separated"}} carriers {"distil":["u2_n19"]}

- X: x3 [u9] claim (general, medium) clause "120 requests per minute per account" → claim u9 "applies a rate limit"
  Y: y3 [u9] set (general, medium) clause "of 120 requests per minute per account" → claim u9 "applies a rate limit"
  context: phase3 c2 [u9] set/agreed claim u9 outcomes {"distil":{"u2_n20":"carried"}} carriers {"distil":["u2_n20"]}

- X: x4 [u10] claim (general, high) clause "If the auth service cannot be reached" → claim u10 "the gateway rejects the request instead of letting it through unchecked"
  Y: y4 [u10] claim (general, high) clause "If the auth service cannot be reached" → claim u10 "the gateway rejects the request instead of letting it through unchecked"
  context: phase3 c3 [u10] claim/adjudicated claim u9 outcomes {"distil":{"u2_n20":"carried"}} carriers {"distil":["u2_n20"]}

- X: x5 [u11] claim (general, medium) clause "never by the gateway" → claim u11 "Photo bytes are served to clients by the CDN"
  Y: y5 [u11] claim (R4, medium) clause "never by the gateway" → claim u8 "Every client request enters through the API gateway."
  context: phase3 c4 [u11] claim/agreed claim u8 outcomes {"distil":{"u2_n20":"carried"}} carriers {"distil":["u2_n20"]}

- X: x6 [u18] claim (R5, medium) clause "who have notifications turned on" → claim u18 "asks the push-notification provider to alert followers"
  Y: y6 [u18] claim (general, high) clause "who have notifications turned on" → claim u18 "asks the push-notification provider to alert followers"
  context: phase3 c5 [u18] claim/agreed claim u18+u32 outcomes {"distil":{"u2_n23":"carried","u3_n8":"separated","u3_a2":"separated"}} carriers {"distil":["u2_n23"]}

- X: x7 [u19] claim (general, high) clause "for up to 7 days" → claim u19 "a worker outage delays thumbnails but does not lose uploads"
  Y: y7 [u19] claim (general, high) clause "for up to 7 days" → claim u19 "a worker outage delays thumbnails but does not lose uploads"
  context: phase3 c6 [u19] claim/agreed claim u19 outcomes {"distil":{"u2_n26":"carried"}} carriers {"distil":["u2_n26"]}

- X: x9 [u20] claim (R4, medium) clause "whose processing keeps failing" → claim u18 "The feed service subscribes to PhotoReady events to add the photo to the followers' feeds"
  Y: y8 [u20] claim (R4, medium) clause "whose processing keeps failing" → claim u32 "the feed service adds the photo to the followers' feeds"
  context: phase3 c7 [u20] ambiguous/unresolved claim u16+u31+u32 outcomes {"distil":{"u3_n8":"separated","u3_a2":"separated","u3_n6":"separated","u2_n24":"separated"}} carriers {"distil":["u2_n26"]}

- X: x10 [u23] claim (general, medium) clause "for 60 seconds" → claim u23 "The cache holds ready-made feed pages"
  Y: y9 [u23] set (general, medium) clause "for 60 seconds" → claim u23 "The cache holds ready-made feed pages"
  context: phase3 c8 [u23] set/agreed claim u14+u23 outcomes {"distil":{"u2_n29":"carried","u2_n23":"separated","u4_n8":"separated"}} carriers {"distil":["u2_n29"]}

- X: x11 [u27] claim (R3, medium) clause "Pinhole only sends it requests and does not control when an alert arrives" → claim u18 "asks the push-notification provider to alert followers who have notifications turned on"
  Y: y10 [u27] claim (R3, medium) clause "does not control when an alert arrives" → claim u18 "asks the push-notification provider to alert followers"
  context: phase3 c9 [u27] set/agreed claim u18+u32 outcomes {"distil":{"u2_n23":"separated","u3_n8":"separated"}} carriers {"distil":["u5_n3"]}

- X: x12 [u34] claim (R3, medium) clause "The cost is that a new photo takes a few seconds to appear in feeds." → claim u34 "the upload service and the workers only meet through the message queue"
  Y: y11 [u34] claim (R3, high) clause "The cost is that a new photo takes a few seconds to appear in feeds." → claim u34 "the upload service and the workers only meet through the message queue"
  context: phase3 c10 [u34] set/agreed claim u34 outcomes {"distil":{"u4_n1":"linked","u4_n2":"carried","u4_a1":"separated"}} carriers {"distil":["u4_n2"]}

- X: x13 [u35] not_a_condition (general, medium) clause "Originals can be up to 25 MB" → claim - ""
  Y: y12 [u35] ambiguous (R5, low) clause "Originals can be up to 25 MB" → claim u35 "clients send bytes straight to object storage" | A: set: a real upper bound on upload size that the notes must carry (clients and signing must respect it) | B: not_a_condition: a rationale figure explaining why routing through the gateway would bottleneck; it limits no claim | Q: Is 25 MB stated as an enforced maximum, or only as the typical size that motivates direct upload?
  context: phase3 c11 [u35] set/agreed claim u35 outcomes {"distil":{"u4_n3":"linked","u4_n4":"carried","u2_n19":"separated","u4_a1":"separated"}} carriers {"distil":["u4_n4"]}

- X: x14 [u38] claim (R3, medium) clause "we accept that their outages are outside our control" → claim u38 "We use a third-party CDN and push-notification provider instead of running our own"
  Y: y13 [u38] claim (R3, high) clause "we accept that their outages are outside our control" → claim u38 "We use a third-party CDN and push-notification provider instead of running our own"
  context: phase3 c12 [u38] set/agreed claim u38 outcomes {"distil":{"u4_n9":"linked","u4_n10":"carried","u4_a1":"separated"}} carriers {"distil":["u4_n10"]}

- X: x15 [u39] set (general, medium) clause "is not decided yet" → claim u20 "A photo whose processing keeps failing stays in the "processing" state and is not shown in any feed."
  Y: y14 [u39] claim (R4, medium) clause "is not decided yet" → claim u20 "A photo whose processing keeps failing"
  context: phase3 c13 [u39] set/agreed claim u20 outcomes {"distil":{"u2_n26":"separated"}} carriers {"distil":["u6_n1","u6_a1"]}

- X: x16 [u40] set (R5, medium) clause "is left to the feed service's own low-level design" → claim u14 "The feed service builds each person's feed from the photos of the accounts they follow"
  Y: y15 [u40] set (R5, medium) clause "is left to the feed service's own low-level design" → claim u14 "The feed service builds each person's feed from the photos of the accounts they follow"
  context: phase3 a2 [u40] set/adjudicated claim u14 outcomes {"distil":{"u2_n23":"separated"}} carriers {"distil":["u6_n2","u6_a1"]}

- X: x17 [u4] set (R5, medium) clause "It does not describe code, internal modules or individual operations" → claim u3 "This document is the high-level design only"
  Y: y16 [u4] set (R5, medium) clause "It does not describe code, internal modules or individual operations" → claim u3 "This document is the high-level design only"

## Found by X only

- x8 [u19] set (R3, low) clause "a worker outage delays thumbnails" → claim u19 "does not lose uploads"
  context: phase3 c6 [u19] claim/agreed claim u19 outcomes {"distil":{"u2_n26":"carried"}} carriers {"distil":["u2_n26"]}

## Found by Y only

