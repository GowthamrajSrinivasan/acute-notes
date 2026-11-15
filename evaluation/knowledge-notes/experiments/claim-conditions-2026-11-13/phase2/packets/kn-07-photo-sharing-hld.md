# Packet kn-07-photo-sharing-hld

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

## Generated note set (2026-10-19 distil recording). Each line: node id, type, parent frame, cites (unit ids the generator CLAIMS as sources), then the reader-visible text.
u0_h1 [heading] (no cites) :: Pinhole: high-level design for photo sharing
subtitle [heading] (no cites) :: Pinhole: photo sharing high-level design for 2M daily active users
g0 [group] (no cites) :: Purpose and scope | grid | High-level design for Pinhole, supporting 2M daily active users.
u1_n1 [text] in g0 cites=u1 :: Pinhole allows users to post photos and view photos from accounts they follow in a feed.
u1_n2 [text] in g0 cites=u2 :: The design is intended to support approximately 2 million daily active users at launch.
u1_n3 [text] in g0 cites=u3 :: This document provides a high-level design, outlining system components, their responsibilities, inter-component communication, and design rationale.
u1_n4 [text] in g0 cites=u4 :: This document does not cover code details, internal modules, or individual operations. These will be addressed in subsequent low-level designs created by individual service teams.
u1_ax1 [text] in g0 (no cites) :: Pinhole enables users to post photos and view photos from followed accounts in a feed, defining its core features.
u1_ax2 [text] in g0 (no cites) :: The system is designed to accommodate approximately 2 million daily active users at launch, setting a key performance target.
u1_ax3 [text] in g0 (no cites) :: This document provides a high-level design, outlining system components, responsibilities, and inter-component communication, along with design rationale.
u1_ax4 [text] in g0 (no cites) :: Detailed code, internal modules, and individual operations are excluded from this document, as they will be covered in subsequent low-level designs by service teams.
g1 [group] (no cites) :: System Architecture | tree | Pinhole uses a layered architecture with dedicated services for clients, API, core functions, async processing, and storage.
u2_n1 [shape] in g1 (no cites) :: rectangle | Clients
u2_n2 [shape] in g1 cites=u5 :: rectangle | Mobile App
u2_n3 [shape] in g1 cites=u5 :: rectangle | Web App
u2_n4 [shape] in g1 (no cites) :: rectangle | Edge and API
u2_n5 [shape] in g1 cites=u8 :: rectangle | API Gateway
u2_n6 [shape] in g1 cites=u9,u10,u12 :: rectangle | Auth Service
u2_n7 [shape] in g1 cites=u11 :: rectangle | CDN
u2_n8 [shape] in g1 (no cites) :: rectangle | Core Services
u2_n9 [shape] in g1 cites=u13 :: rectangle | Upload Service
u2_n10 [shape] in g1 cites=u14,u18 :: rectangle | Feed Service
u2_n11 [shape] in g1 (no cites) :: rectangle | Asynchronous Processing
u2_n12 [shape] in g1 cites=u15,u16 :: rectangle | Media Processing Workers
u2_n13 [shape] in g1 cites=u13,u15,u17,u19 :: rectangle | Message Queue
u2_n14 [shape] in g1 (no cites) :: rectangle | Storage
u2_n15 [shape] in g1 cites=u7,u16,u21 :: rectangle | Object Storage
u2_n16 [shape] in g1 cites=u13,u14,u16,u20,u22 :: rectangle | Metadata Database
u2_n17 [shape] in g1 cites=u14,u23,u24 :: rectangle | Cache
u2_n18 [shape] in g1 cites=u18 :: rectangle | Push Notification Provider
u2_n19 [text] in g1 cites=u6,u7 :: Both clients use the same public HTTPS API and have minimal business logic, primarily input checks. They upload photos directly to object storage using signed URLs to bypass our services for large files. **From the source:** short-lived
u2_n20 [text] in g1 cites=u8,u9,u10,u11 :: The API Gateway handles all client requests, performing TLS termination, access token validation with the auth service, and rate limiting (120 requests/min/account). It routes requests to the appropriate service. If the auth service is unreachable, requests are rejected. Photo bytes are served by the CDN, not the gateway.
u2_n21 [text] in g1 cites=u12 :: The Auth Service manages access tokens, accounts, and sessions.
u2_n22 [text] in g1 cites=u13 :: The Upload Service provides signed upload URLs, records new photos in the metadata database as 'processing' upon completion, and publishes a 'PhotoUploaded' event to the message queue.
u2_n23 [text] in g1 cites=u14,u18 :: **Feed Service Function** The Feed Service constructs user feeds by reading photo metadata from the metadata database and stores pre-built feed pages in the cache. **From the source:** ready-made **Feed Update and Notifications** The Feed Service subscribes to 'PhotoReady' events to add photos to followers' feeds and notifies followers via a push notification provider if notifications are enabled. **From the source:** push-notification
u2_n24 [text] in g1 cites=u15,u16,u17 :: Media processing workers subscribe to 'PhotoUploaded' events. For each event, they retrieve the original photo from object storage, generate three thumbnail sizes (150, 640, 1080 pixels), store them in object storage, and update the photo status to 'ready' in the metadata database. A 'PhotoReady' event is then published.
u2_n26 [text] in g1 cites=u19,u20 :: The message queue retains events for up to 7 days, ensuring that worker outages only delay, but do not lose, uploads. Photos that repeatedly fail processing remain in the 'processing' state and are not displayed in feeds.
u2_n27 [text] in g1 cites=u21 :: Object storage stores original photos and their thumbnails. Originals are immutable and never overwritten.
u2_n28 [text] in g1 cites=u22 :: The metadata database is the authoritative source for photo existence and stores follow relationships and photo records, including their processing status.
u2_n29 [text] in g1 cites=u23,u24 :: The cache stores ready-made feed pages for 60 seconds. It's a speed optimization; losing cached data makes feeds slower but doesn't affect correctness.
u2_a1 [text] in g1 (no cites) :: The Pinhole system is designed with a clear separation of concerns, utilizing a public API for clients, an API Gateway for request management, specialized core services, and asynchronous processing for media. Storage is distributed across object storage, a metadata database, and a cache, each serving a distinct purpose.
u2_fs1 [text] in g1 cites=u5 :: two
g2 [group] (no cites) :: Main data flow: posting a photo | chain | Photo posting involves client upload, service processing, event-driven updates, and follower notification.
u3_n1 [shape] in g2 cites=u29 :: rectangle | 1 · Client requests signed URL & uploads photo
u3_n2 [text] in g2 cites=u29 :: The client requests a signed URL from the upload service and directly uploads the original photo to object storage.
u3_n3 [shape] in g2 cites=u30 :: rectangle | 2 · Upload service records & publishes
u3_n4 [text] in g2 cites=u30 :: The upload service marks the photo as 'processing' and publishes a `PhotoUploaded` event.
u3_n5 [shape] in g2 cites=u31 :: rectangle | 3 · Media worker processes photo
u3_n6 [text] in g2 cites=u31 :: A media processing worker consumes the `PhotoUploaded` event, generates thumbnails, and updates the photo's status to 'ready'.
u3_n7 [shape] in g2 cites=u32 :: rectangle | 4 · Worker publishes PhotoReady & Feed service updates
u3_n8 [text] in g2 cites=u32 :: The worker publishes `PhotoReady`. The feed service then adds the photo to followers' feeds and requests the push-notification provider to send alerts.
u3_n9 [shape] in g2 cites=u33 :: rectangle | 5 · Followers fetch feed & load thumbnails
u3_n10 [text] in g2 cites=u33 :: Followers' clients retrieve the updated feed via the gateway and load thumbnails from the CDN.
u3_a1 [text] in g2 (no cites) :: This sequence describes the end-to-end process of posting a photo, from client upload to follower notification and display. It involves several services working asynchronously via event publishing.
u3_a2 [text] in g2 (no cites) :: The entire flow ensures that a user's photo is uploaded, processed into displayable formats, distributed to followers' feeds, and followers are notified, allowing them to view the new content.
g3 [group] (no cites) :: Design decisions | grid | Key design decisions.
u4_n1 [shape] in g3 cites=u34 :: rectangle | Queue between upload and processing
u4_n2 [text] in g3 cites=u34 :: To prevent slow or failed thumbnail jobs from blocking uploads, the upload service and workers interact via a message queue. This introduces a delay of a few seconds for new photos to appear in feeds.
u4_n3 [shape] in g3 cites=u35 :: rectangle | Direct upload with signed URLs
u4_n4 [text] in g3 cites=u35 :: Clients upload large photo originals (up to 25 MB) directly to object storage using signed URLs. The upload service is responsible for signing the URL and recording the result, avoiding the gateway as a bottleneck.
u4_n5 [shape] in g3 cites=u36 :: rectangle | Metadata separate from bytes
u4_n6 [text] in g3 cites=u36 :: Photo bytes are stored in object storage, while queryable metadata resides in a separate database. This separation is due to differing growth rates and backup requirements for each. **From the source:** two
u4_n7 [shape] in g3 cites=u37 :: rectangle | Disposable cache
u4_n8 [text] in g3 cites=u37 :: Feed pages are cached for performance, but the metadata database remains the authoritative source of truth. The cache can be flushed at any time without data loss.
u4_n9 [shape] in g3 cites=u38 :: rectangle | Buy delivery, don't build it
u4_n10 [text] in g3 cites=u38 :: Third-party CDN and push-notification providers are used for delivery, accepting that their outages are beyond direct control.
u4_a1 [text] in g3 (no cites) :: * **Queue between upload and processing** — Decided: Implemented to decouple services. * **Direct upload with signed URLs** — Decided: Implemented. * **Metadata separate from bytes** — Decided: Implemented for optimized storage and backup. * **Disposable cache** — Decided: Implemented for performance with data integrity. * **Buy delivery, don't build it** — Decided: Implemented for leveraging external services.
g4 [group] (no cites) :: External dependencies and system boundary | stack | Pinhole system boundary excludes CDN and push-notification provider, includes all other components.
u5_n1 [text] in g4 cites=u25 :: The CDN and push-notification provider are external services, operated by third parties, and are outside the Pinhole system boundary.
u5_n2 [text] in g4 cites=u26 :: The CDN retrieves photos and thumbnails from object storage and delivers them to clients from geographically optimized locations.
u5_n3 [text] in g4 cites=u27 :: The push-notification provider sends alerts to phones. Pinhole initiates these requests but does not control the delivery timing of the alerts.
u5_n4 [text] in g4 cites=u28 :: All other components mentioned in this document, including the gateway, three services, workers, queue, and three stores, are within the Pinhole system boundary and are managed by the Pinhole team.
u5_a1 [text] in g4 (no cites) :: This section clearly defines the operational scope of the Pinhole team by distinguishing between internal components and external, third-party dependencies.
g5 [group] (no cites) :: Open questions | grid | Two key design decisions regarding photo processing and feed generation remain open.
u6_n1 [text] in g5 cites=u39 :: The process for retrying failed photo processing and cleaning up stuck photos is currently undecided.
u6_n2 [text] in g5 cites=u40 :: The decision on whether the feed service should precompute feeds for accounts with a large number of followers is deferred to the feed service's low-level design.
u6_a1 [text] in g5 (no cites) :: - **Pending Decision:** Retry mechanism and cleanup for failed photo processing. - **Deferred Decision:** Feed precomputation strategy for high-follower accounts (to be decided during feed service low-level design).

## Visible arrows (from -> to : label)
u1_ax1 -> u1_n1
u1_ax2 -> u1_n2
u1_ax3 -> u1_n3
u1_ax4 -> u1_n4
u2_n1 -> u2_n2
u2_n1 -> u2_n3
u2_n4 -> u2_n5
u2_n4 -> u2_n6
u2_n4 -> u2_n7
u2_n8 -> u2_n6
u2_n8 -> u2_n9
u2_n8 -> u2_n10
u2_n11 -> u2_n12
u2_n11 -> u2_n13
u2_n14 -> u2_n15
u2_n14 -> u2_n16
u2_n14 -> u2_n17
u2_n2 -> u2_n5
u2_n3 -> u2_n5
u2_n5 -> u2_n6
u2_n5 -> u2_n7
u2_n5 -> u2_n9
u2_n5 -> u2_n10
u2_n9 -> u2_n15
u2_n9 -> u2_n16
u2_n9 -> u2_n13
u2_n10 -> u2_n16
u2_n10 -> u2_n17
u2_n12 -> u2_n13
u2_n12 -> u2_n15
u2_n12 -> u2_n15
u2_n12 -> u2_n16
u2_n12 -> u2_n13
u2_n10 -> u2_n13
u2_n10 -> u2_n18
u2_n1 -> u2_n19
u2_n4 -> u2_n20
u2_n6 -> u2_n21
u2_n9 -> u2_n22
u2_n10 -> u2_n23
u2_n12 -> u2_n24
u2_n13 -> u2_n26
u2_n15 -> u2_n27
u2_n16 -> u2_n28
u2_n17 -> u2_n29
u2_n1 -> u2_a1
u2_n4 -> u2_a1
u2_n8 -> u2_a1
u2_n11 -> u2_a1
u2_n14 -> u2_a1
u2_n2 -> u2_fs1
u3_n1 -> u3_n2
u3_n1 -> u3_n3
u3_n3 -> u3_n4
u3_n3 -> u3_n5
u3_n5 -> u3_n6
u3_n5 -> u3_n7
u3_n7 -> u3_n8
u3_n7 -> u3_n9
u3_n9 -> u3_n10
u4_n1 -> u4_n2
u4_n3 -> u4_n4
u4_n5 -> u4_n6
u4_n7 -> u4_n8
u4_n9 -> u4_n10
u5_n1 -> u5_n2 : details
u5_n1 -> u5_n3 : details
u5_n1 -> u5_n4 : contrast
g1 -> g2 : data flow example
g1 -> g3 : justification
g1 -> g4 : external components
