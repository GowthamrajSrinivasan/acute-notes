# Pinhole: high-level design for photo sharing

## Purpose and scope

Pinhole lets people post photos and see the photos of the accounts they follow in a feed. The design is sized for about 2 million daily active users at launch. This document is the high-level design only: it names the parts of the system, what each part is responsible for, how the parts talk to each other and why we chose this shape. It does not describe code, internal modules or individual operations; those belong in the low-level designs that each service team will write later.

## Clients

People use Pinhole through two clients: a mobile app for iOS and Android, and a web app that runs in the browser. Both clients speak the same public HTTPS API and hold no business rules of their own beyond simple input checks. Clients upload a photo directly to object storage with a short-lived signed URL, so large files never pass through our own services.

## Edge and API

Every client request enters through the API gateway. The gateway terminates TLS, checks the caller's access token with the auth service, applies a rate limit of 120 requests per minute per account, and routes the request to the right service. If the auth service cannot be reached, the gateway rejects the request instead of letting it through unchecked. Photo bytes are served to clients by the CDN, never by the gateway.

## Core services

The auth service issues and verifies access tokens and owns accounts and sessions. The upload service hands the client a signed upload URL, records the new photo in the metadata database with the status "processing" once the upload completes, and publishes a PhotoUploaded event to the message queue. The feed service builds each person's feed from the photos of the accounts they follow: it reads photo metadata from the metadata database and keeps ready-made feed pages in the cache.

## Asynchronous processing

Media processing workers subscribe to PhotoUploaded events on the message queue. For each event, a worker reads the original from object storage, creates thumbnails in three sizes (150, 640 and 1080 pixels wide), writes them back to object storage and marks the photo "ready" in the metadata database. The worker then publishes a PhotoReady event. The feed service subscribes to PhotoReady events to add the photo to the followers' feeds, and asks the push-notification provider to alert followers who have notifications turned on.

The queue keeps an event for up to 7 days, so a worker outage delays thumbnails but does not lose uploads. A photo whose processing keeps failing stays in the "processing" state and is not shown in any feed.

## Storage

Object storage holds the original photos and their thumbnails; originals are kept unchanged and are never overwritten. The metadata database holds follow relationships and photo records with their processing status, and it is the source of truth for whether a photo exists. The cache holds ready-made feed pages for 60 seconds. It is only a copy kept for speed: losing it makes feeds slower, never wrong.

## External dependencies and system boundary

The CDN and the push-notification provider are run by third parties and sit outside the Pinhole system boundary. The CDN reads photos and thumbnails from object storage and serves them to clients from locations close to the user. The push-notification provider delivers alerts to phones; Pinhole only sends it requests and does not control when an alert arrives. Everything else in this document (the gateway, the three services, the workers, the queue and the three stores) is inside the boundary and is operated by the Pinhole team.

## Main data flow: posting a photo

1. The client asks the upload service for a signed URL and uploads the original straight to object storage.
2. The upload service records the photo as "processing" and publishes PhotoUploaded.
3. A media processing worker picks up the event, creates the thumbnails and marks the photo "ready".
4. The worker publishes PhotoReady; the feed service adds the photo to the followers' feeds and asks the push-notification provider to alert them.
5. Followers' clients fetch the updated feed through the gateway and load the thumbnails from the CDN.

## Design decisions

- **A queue between upload and processing.** A slow or failed thumbnail job must never block or fail an upload, so the upload service and the workers only meet through the message queue. The cost is that a new photo takes a few seconds to appear in feeds.
- **Direct upload with signed URLs.** Originals can be up to 25 MB, and routing them through the gateway would make it the bottleneck, so clients send bytes straight to object storage and the upload service only signs the URL and records the result.
- **Metadata apart from bytes.** Photo bytes live in object storage and everything we query lives in the metadata database, because the two grow at very different rates and need different backups.
- **The cache is disposable.** Feed pages are cached for speed only; the metadata database stays the source of truth, so the cache can be flushed at any time.
- **Buy delivery, don't build it.** We use a third-party CDN and push-notification provider instead of running our own, and we accept that their outages are outside our control.

## Open questions

- How failed processing is retried, and when a stuck photo is cleaned up, is not decided yet.
- Whether the feed service should precompute feeds for accounts with very many followers is left to the feed service's own low-level design.
