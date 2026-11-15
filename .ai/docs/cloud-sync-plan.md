# Cloud Sync Plan: an optional, privacy-first sync layer, Firebase first, portable later

Status: **v2, decisions recorded** (2026-10-19). Plan only: no code has changed, and no cloud resource has been
created for sync. v2 adopts the user's privacy review and their three choices (§0.1); the decisions are in §12.

**Principle:** users control what leaves their device, where it is stored, how long deleted data persists, and
whether cloud sync is available at all. Cloud sync is an optional provider capability on top of a local-first app.
Turning it off never prevents local editing.

Scope: back up and sync a user's chosen workspaces across devices and installs (hosted web app, local web install,
desktop app), on Firebase first, behind interfaces of our own so the provider can change later. Acute Core and the MCP
contracts stay provider-neutral.

**Relationship to existing plans.** This plan replaces the sync designs in two earlier plans:

| Existing plan | What it said | Here |
|---|---|---|
| [Master plan](./pending-work-master-plan.md), C3–C5 (2026-09-27) | Firebase Auth accounts first; workspace snapshots to Cloud Storage; Firestore metadata; Firestore per-document update log | Kept: Firestore update log, Cloud Storage, Firestore metadata. Accounts are needed only to add devices (CS-D14) |
| [SQLite storage plan](./sqlite-desktop-storage-plan.md), Phases C–E, D1–D5 (2026-10-09) | Workspace-key access (D1); hosted Hocuspocus (D2); workspace manifest Y.Doc with tombstones (D3); IndexedDB + SQLite behind `PersistenceServices` (D4); storage, sync and AI billing independent (D5) | Kept: D3, D4, D5. **Replaced:** D1 by authenticated membership with scoped invitations (CS-D14); D2 by Firebase first, Hocuspocus as a later adapter (CS-D2) |

---

## 0. Summary

### 0.1 The user's choices (2026-10-19)

| Question | Choice | What it means here |
|---|---|---|
| Initial markets | **Global users, no specific residency commitments yet** | One global deployment (Option A, §2) |
| Data-residency priority | **Balance simplicity, latency and security.** Keeping customer content in a selected region is **future scope**, stated clearly in the plan | A US multi-region database now; the design carries a region on every workspace from day one so regional routing (Option C) can be added without migrating the model (§2.3) |
| Encryption | **Provider-managed encryption initially, with an architecture ready for client-side encryption** | Google's encryption at rest now; an encryption boundary in the engine (§5.9) so private workspaces can be encrypted on the device later |

### 0.2 The change in one paragraph

Sync is an opt-in layer over the local database. The user turns it on per device and per workspace, and chooses which
**data categories** go up (§3). Changes go through a durable local outbox to a provider-neutral sync API, implemented
first on Firestore (metadata, operations, checkpoints) and Cloud Storage (images, large blobs). Access is authenticated
membership with scoped, expiring, revocable invitations, enforced by security rules on every operation. Three
switches (build flag, remote kill switch, user setting) must all allow sync, and the client fails closed when it can't
tell. Nothing is provisioned until a read-only audit of the existing Firebase project is done, and nothing reaches
production before staging validation.

---

## 1. Goals and non-goals

**Goals**
1. **What the user chooses is in the cloud:** the selected workspaces and data categories, including data that already
   exists on a device today (§7).
2. **Every device converges,** web and desktop alike: offline edits on several devices merge without loss, and
   conflicts that can't merge safely are shown, never silently resolved (§5.3).
3. **"Synced" is provable** per workspace (§8).
4. **Local-first stays:** editing never waits for the network, and turning sync off never affects it.
5. **The user is in control:** of what leaves the device (§3), where it is stored (§2), how long deleted data lasts
   (§9), and whether sync runs at all (§5.8).
6. **Provider-neutral:** Firebase only behind four interfaces (§4); a later move is a new adapter plus a copy job
   (§11).

**Non-goals for this plan:** live co-editing with presence and cursors (CAP-16), sharing with other people and roles,
version-history UI, regional data residency (future scope, §2.3), end-to-end encryption (architecture-ready only,
§5.9).

---

## 2. Data location

### 2.1 Options considered

| Option | What | Fits |
|---|---|---|
| **A. One global deployment** | One Firestore database in the US multi-region `nam5`, one Storage bucket in the `US` multi-region | A global launch without residency commitments. Multi-region resilience. Doesn't guarantee Canadian, EU or Indian residency |
| B. Canada first | Regional `northamerica-northeast1` (Montréal) | Canadian locality as the main requirement. Other services must be set and verified separately |
| C. Several residency regions | Separate regional databases and buckets (for example `eur3` for the EU), with each workspace routed to its region | Customers with explicit residency requirements. More complex; only when real requirements justify it |

### 2.2 Decision: Option A now (CS-D9)

- **Firestore:** `nam5` (US multi-region). **Storage:** a bucket in the `US` multi-region. **Cloud Functions:**
  `us-central1`. **Firebase Auth:** global (no region choice).
- Firestore's location can't be changed after the database is created, and neither can a bucket's. So **nothing is
  provisioned until the audit (CS0) has confirmed** what already exists in `acute-notes` and `acute-qa`, including any
  default resource location already set on the project.
- **Regional storage isn't a full residency guarantee.** Authentication, logs, backups, telemetry, support access,
  AI processing and uploaded files each have their own location. The privacy notice states where each is processed
  (§10), and doesn't promise residency.

### 2.3 Future scope: regional residency (Option C)

Stated here so it can be added later without a data-model migration:
- **Every workspace records its backend from day one:** `backend: { provider: "firebase", region: "nam5" }` in the
  workspace manifest and in the cloud workspace record.
- **The sync API routes by that record,** not by a global constant. Adding a region is adding a backend entry (for
  example a Firestore named database and a bucket in `eur3`) to the backend config document (§5.8, level 2).
- **Moving a workspace between regions** is the same copy job as moving providers (§11), run per workspace.
- **The settings never show a region picker** until routing is built and enforced. Until then they show the one real
  location.
- **What residency would need beyond storage:** regional Functions, logs routed to regional buckets, backups in the
  region, AI processing in the region (or none), and support access limits. Each is a line item of that future plan.

---

## 3. Data categories: what may leave the device

Each category has its own decision: whether it uploads, whether it is retained, whether it is in exports, and whether
it is deleted with the cloud copy. The code twin is `src/cloud/syncScope.ts`. A guard test fails if a store is added
to `db.ts` without a category, so a new store can't silently stay off the cloud, or leak onto it.

| Category | Local stores | Default once a workspace is synced | User control | Retained in the cloud | In exports | Deleted with the cloud copy |
|---|---|---|---|---|---|---|
| **Canvas and notes**: canvas scenes, blocks, pages | `yupdates` (Yjs), `documents` records | **Synced** (it's what syncing a workspace means) | Per workspace | Live data, plus 30-day trash for deleted items (§9) | Yes | Yes |
| **Workspace metadata and sync checkpoints** | `workspaces`, `canvases`, `documents` records; checkpoints | **Synced** as needed to coordinate devices | Follows the workspace | As long as the workspace syncs | Metadata yes; checkpoints no | Yes |
| **Attachments and images** | `assets` | **Off until chosen**: a separate switch per workspace | Per workspace | Until deleted, or the cloud copy is | Yes | Yes |
| **Pasted sources and imported documents**: source text, versions, units, lineage | `contentSources`, `contentSourceVersions` | **Off** | Per workspace | Until deleted | Optional ("Include sources", Knowledge Notes plan §6.4) | Yes |
| **AI conversations, agent traces and tool outputs** | `aiConversations`, `aiTurns`, `agentChanges`, `agentSessions` | **Off. Not syncable in v1** | None in v1 | — | No | — |
| **Repo Map bookkeeping** | `repoMaps` | **Never** (tied to a local agent and repository) | None | — | No | — |
| **Device settings** | `meta` (except the sync state, which is local by nature) | **Never** | None | — | No | — |
| **Credentials and AI keys** | `aiConnections`, `src/ai/credentials/` | **Never** (PRD §9.1). Sign-in is held by the auth provider, not as workspace content | None | — | Never | — |
| **Telemetry and diagnostics** | — | **Minimal and redacted:** counts, sizes, timings and error codes only, never note text, titles, source text or file names | Diagnostics opt-out in settings | 30 days | No | Yes, the workspace's |

**Indirect uploads.** A category switch covers every path into the cloud, not just one store:
- **Sources off** means no source text, unit text, version or lineage is uploaded, from any store. The guard test checks
  that only `syncScope.ts` decides what the engine reads.
- **What sources off doesn't cover:** content on the canvas is canvas content. A preserve-mode card that copies source
  text word for word ("Also in the source", "Source details"), a quote the user pinned, or text pasted into a block is
  a note, and syncs as one. The settings say this in plain words next to the switch.
- **Agent traces off** also covers MCP tool outputs written as change-set records (`agentChanges`). Changes an agent
  made to the canvas that the user accepted are canvas content, and sync with it.
- **Images off** means an image block syncs as a reference only. Other devices show "Image not synced" with the file
  name hidden.

---

## 4. Provider-neutral architecture

```
 Acute on each device: canvas, notes, local database (IndexedDB / SQLite), local history
   │  PersistenceServices ◄── the device copy stays the working copy
   │  DocumentProvider ──► SyncProvider (exists, unused today)
   ▼
 src/cloud/                       provider-neutral: no Firebase import allowed
   engine/      outbox, inbox, manifest, conflicts, first upload, verification, status
   policy.ts    switches, categories, consent, region eligibility → "may this operation run?"
   cipher.ts    encryption boundary (identity today, §5.9)
   contracts.ts the four interfaces
   syncScope.ts categories (§3)
   ▼
 src/cloud/adapters/firebase/     the only folder that may import firebase/*
   updateLog.ts   Firestore      blobStore.ts   Cloud Storage
   identity.ts    Firebase Auth  membership.ts  Firestore + callable functions
 functions/       Cloud Functions: invitations, purge, quotas, audit (Admin SDK; own authorization checks)
 (later) src/cloud/adapters/hocuspocus/, s3/, r2/; memory/ for tests
```

**The four interfaces** (`src/cloud/contracts.ts`):

| Interface | Methods (sketch) | Firebase adapter |
|---|---|---|
| `UpdateLog` | `append(docId, ops[]) → acks`; `read(docId, afterSeq)`; `subscribe(docId, afterSeq, cb)`; `checkpoint(docId, snapshotRef, uptoSeq)`; `latestCheckpoint(docId)` | Firestore `workspaces/{w}/docs/{d}/ops/{opId}`, a `head` doc with sequence and checkpoint |
| `BlobStore` | `put(hash, bytes, mime)`; `get(hash)`; `has(hashes[]) → missing[]` | Storage `workspaces/{w}/assets/{hash}`, `…/snapshots/{docId}/{seq}` |
| `Identity` | `current()`, `signInAnonymously()`, `link(provider)`, `signOut()`, `onChange(cb)` | Firebase Auth |
| `Membership` | `createWorkspace(id, backend)`, `invite(scope) → invitation`, `redeem(code)`, `revokeInvitation(id)`, `removeMember(uid)`, `listMembers()`, `leave()` | Firestore `workspaces/{w}/members/{uid}`, callable functions for invitations |

**Rules that keep it portable:**
- Only `src/cloud/adapters/firebase/**` (and `functions/`) may import Firebase. A guard test enforces it.
- Data crosses the interfaces in our own formats: Yjs updates as bytes, assets by hash, JSON records. No Firestore
  types, timestamps or references leak out.
- One **conformance suite** runs against every adapter: the in-memory fake on every test run, the Firebase adapter on
  the local Emulator Suite (no cost). A future adapter must pass it before use.
- The `.acute.json` bundle stays the provider-free full copy.

---

## 5. Sync design

### 5.1 Identity, membership and invitations (CS-D1, CS-D14)

- **Turning sync on for one device** signs it in with Firebase anonymous auth. The device creates the cloud
  workspace and is its owner. This is a one-device backup.
- **Adding a device, or recovering after losing one, needs an account.** The app asks the user to sign in with Google,
  GitHub or an email link, which links the anonymous user to that account (Firebase account linking). Signing in on a
  new device then finds the user's workspaces.
- **Invitations instead of a workspace key.** A join code never grants access on its own. An invitation:
  - is created by the workspace owner, for one workspace, with a role (`editor` in v1);
  - is **single-use** and **expires in 24 hours**;
  - can be **revoked** before use;
  - must be redeemed by a **signed-in account** (not an anonymous user);
  - is checked and turned into membership by a callable function, and is recorded as an audit event.
- **Membership is checked on every operation** by Firestore and Storage security rules (deny by default; a member of
  workspace *w* may read and write only under `workspaces/{w}`).
- **Removing a device or a member** deletes its membership; its next request fails, and its listeners are closed by the
  rules.
- **Server-side operations** (Cloud Functions with the Admin SDK) bypass security rules. Each function checks the
  caller's ID token, workspace membership and role itself, and runs with a service account limited to what it needs.

### 5.2 Metadata: the workspace manifest (SQLite plan D3)

One Y.Doc per workspace (`manifest/<workspaceId>`) holds the workspace, canvas and document records, so metadata merges
like content:
- Edits merge per field.
- **Deletion is a tombstone** (`deletedAt`, `deletedBy`), so an offline device can't bring a deleted item back.
- **Edit after delete:** the item is restored, and the user is told ("Restored 'Roadmap': edited on another device
  after it was deleted").
- The local `workspaces`, `canvases` and `documents` stores become caches the manifest writes through the existing
  repositories; UI code doesn't change.
- The manifest also holds the workspace's `backend` (§2.3) and its category switches (§3), so every device shows them.

### 5.3 Content: operations, idempotency and conflicts

- **Durable outbox:** every local change is written to an outbox in the local database before upload, so it survives
  closing the app and going offline.
- **Every operation** carries a stable `opId` (device id + monotonic local sequence), its workspace id and document id.
  The cloud stores it under its `opId`, so a retried upload can't duplicate it (idempotent writes).
- **Acknowledgements per device and workspace:** an operation leaves the outbox only once its write is confirmed; the
  device records the highest acknowledged sequence per document.
- **Snapshots for first sync and recovery, operations for normal edits:** a document opens from its latest checkpoint
  plus the operations after it.
- **No clocks decide anything.** Merging is Yjs's (causal, by state vectors), never "newest timestamp wins".
- **What merges safely:** text inside blocks and pages merges character by character (both edits are kept);
  independent edits to different nodes, edges or properties merge.
- **What doesn't, and is shown instead:** a canvas element (shape, card, arrow) is stored as one value per element.
  Two devices changing **the same element** while apart would otherwise keep only one change. The engine detects it
  (the same element key written by two devices between syncs, compared by state vector) and keeps both: the merged
  canvas shows one version, and the other is kept as a **conflict copy** next to it, with a marker "Edited on two
  devices: keep this · keep the other · keep both". Nothing is dropped without the user's choice.
- **Tombstones** for deleted nodes, edges and documents (§5.2).
- **Compaction:** when a document's log passes about 200 operations or 2 MB, a device that has it fully loaded writes a
  checkpoint. Operations before it are removed only by the scheduled cleanup, after every member device has
  acknowledged past it or 30 days have passed, so recovery history is kept.
- **Limits respected:** an operation over 512 KB goes to the blob store with only its reference in the log (Firestore
  documents are capped at 1 MiB).

### 5.4 Images and other blobs (when the category is on)

- Upload by hash: `has()` finds what's missing; only that is uploaded. Download on demand, cached locally.
- The hash is checked on download; a mismatch is rejected. New uploads also record a SHA-256 (CS-D6).
- Size limits are enforced by Storage rules, not only the UI (§10).

### 5.5 Pasted sources (when the category is on)

Each version is immutable and syncs once, keyed `[sourceId, version]`, with its units and lineage. With the category
off (the default), the Source tab on another device says "Source not on this device".

### 5.6 Several tabs on the web

One tab runs the engine, elected with a Web Lock (`navigator.locks`); the others relay through a `BroadcastChannel`.

### 5.7 The desktop app

The desktop app syncs the same workspaces to the same backend with the same engine. A workspace can have web and
desktop devices in any mix.

**The same as the web (verified in code):** the engine runs in the renderer and reaches SQLite in the main process
through `PersistenceServices` (`electron/storage/`); the outbox is one more SQLite store, covered by the existing
persistence conformance suite; images are already content-addressed files and cross IPC as `ArrayBuffer`; one process
owns the database, so no tab election is needed.

**Different, and handled:**

| Issue | Handling |
|---|---|
| **Account sign-in**: pages load from `acute://app` (not an authorized Firebase Auth domain), and the window opens every pop-up in the system browser (`setWindowOpenHandler`) | The app opens `https://acute.web.app/desktop-sign-in` in the system browser; the user signs in there; the page passes a single-use, 2-minute code back through an `acute://auth?code=…` deep link (arriving through the existing `second-instance` handler); a callable function exchanges it, with the app's verifier (PKCE-style), for a custom token. Anonymous auth for one-device backup needs none of this (CS-D8) |
| **App Check** | Enforced for the web app. Its web provider can't attest a desktop app, so desktop requests rely on authentication, membership rules, rate limits and quotas (CS-D7) |
| **No sync while the app is closed** | Sync runs while the app is open. On quit it waits up to 5 s for the outbox, then quits; the rest uploads at the next launch |
| **Firewalls blocking Google APIs** | "Offline: can't reach the sync service", never data loss; the outbox keeps the changes |
| **Old versions after a provider or region change** | The backend config carries `minAppVersion` per backend. An old version keeps syncing to the old backend until the cut-over date, then asks for an update; local data is untouched |
| **Providers that need secrets** (S3, R2) | Never in any client: a small service issues short-lived signed URLs to members |

### 5.8 Switches, modes and the user's settings

**Effective permission.** For every operation the policy module evaluates:

```ts
const syncAllowed =
  buildFlagEnabled &&        // NEXT_PUBLIC_CLOUD_SYNC === "on"
  remoteSyncEnabled &&       // config/sync, known and fresh (fails closed)
  deviceSyncEnabled &&       // Settings → Sync, this device
  workspaceSyncEnabled &&    // Settings → Sync, this workspace
  categoryAllowed(op) &&     // §3: canvas · images · sources …
  signedIn && isMember(op.workspace) && regionEligible(op.workspace);
```

The first four are the switches. The rest are checked too, on the client and again by the backend (rules and
functions), so a client bug can't skip them. Everything is read through one module, `src/config/cloudSync.ts`
(switches, modes, defaults and constants), in the pattern of `src/config/features.ts`.

| Level | Set by | Where | Behaviour |
|---|---|---|---|
| **1. Build flag** | Operator, per build | `NEXT_PUBLIC_CLOUD_SYNC` in `.env.*`, `apphosting.yaml`, the desktop build env | Anything other than `on` is off (fail closed). Off: no sync UI, no sync code runs, and no Firebase initialization attributable to sync (the cloud module is loaded dynamically only when on) |
| **2. Remote kill switch** | Operator, live | `config/sync` read at startup, on reconnect and every 15 min | Pauses new sync for everyone without a rebuild: cancels in-flight work where possible, closes listeners, rejects new operations, shows the operator's message. **Fails closed:** a client that has never read it, or whose last read is older than 24 h, treats sync as paused until it can read it. Enabled only after staging validation (CS-D15) |
| **3. User and workspace settings** | The user, in **Settings → Sync** | Device-local; workspace choices also in the manifest | Turn sync on for this device; choose workspaces; choose categories; choose the mode |

**Modes:**

| Mode | Uploads | Downloads | Listeners |
|---|---|---|---|
| **Real-time** (the default once sync is on) | Batches every 2 s while editing | Live | **Only while the user is in that synced workspace;** closed when they leave it or the app goes to the background for 5 min |
| **Every N minutes** (1–60, default 5) | On each tick, on blur and on quit | Pulled on each tick | **None** |
| **Manual only** | On **Sync now** | Same | **None** |

**Off, at any level:** closes existing listeners, stops writes and retries, and shows "Sync off". Editing is never
affected, and nothing is deleted locally or in the cloud. **On again:** the engine sends only the difference, per
document by state vector (`encodeStateAsUpdate(doc, remoteStateVector)`), and assets and sources by hash and id, so
time off costs nothing and catches up fully. Mode changes apply without a reload.

**Settings → Sync** (proposed design; nothing is built):

1. **Cloud Sync:** "Your notes stay on this device unless you choose to sync them." **Enable sync on this device**
   (off by default). Pause and resume.
2. **Workspaces:** each workspace with **Synced** or **Local only**. New workspaces start Local only.
3. **Sync behaviour:** Real-time · Every N minutes · Manual only.
4. **Data categories:** Canvas and notes (follows the workspace) · Attachments and images (separate switch) · Pasted
   sources (off by default, with the note on what it doesn't cover, §3) · Agent traces and AI context (off, not
   available in v1).
5. **Data location and deletion:** the actual storage location ("United States, multi-region"), last successful sync,
   cloud storage used against the quota, the retention periods, and **Delete cloud copy**.

Before sync is first enabled, a **data-location notice** says where data will be stored and processed, which
subprocessors are involved (Google Cloud / Firebase), and links the privacy page. Sync starts only after the user
confirms.

### 5.9 Encryption boundary: ready for client-side encryption (CS-D5)

- **Now:** provider-managed encryption at rest and TLS in transit. The privacy page says so, and the app never claims
  end-to-end encryption.
- **Ready for later:** every byte the engine uploads (operations, checkpoints, blobs, source versions) passes through
  `cipher.ts`, an identity function today. A later private-workspace mode swaps in envelope encryption (a per-workspace
  data key, wrapped per device) without changing the interfaces, because they already carry opaque bytes.
- **Metadata in the clear today** (titles in the manifest, sizes, timestamps) is kept minimal, and the manifest is
  stored as a Yjs blob rather than as queryable fields, so it can be encrypted too.
- **Designed before committing to E2E** (future scope): key recovery, device enrollment, revocation, multi-device key
  sync, and which features stop working on an encrypted workspace (hosted MCP, server search, hosted AI on its
  content). No E2E claim until all of these exist.

---

## 6. Backend enforcement, costs and abuse controls

Limits are enforced by the backend, not only in the UI:

| Control | Where | Default (config) |
|---|---|---|
| Workspace storage quota | Storage rules + a quota counter maintained by a function | 1 GB images, 200 MB sources, 100 MB operations and checkpoints |
| Maximum attachment size | Storage rules | 50 MB |
| Operations and upload bytes per time window | Firestore rules (document size), plus a per-user and per-workspace rate counter | 600 ops/min per device, 50 MB/hour per user |
| Retries | Client: bounded queue, exponential backoff with jitter, up to 1 h between tries | — |
| Active devices and concurrent listeners | Membership function; client listener cap | 10 devices per user; 50 listeners per device |
| Account-level abuse controls | Functions | New anonymous users limited to one workspace and 100 MB until they link an account |
| Billing alerts and emergency stop | Cloud Billing budget alerts; the remote kill switch | Alerts at 50/90/100% of the monthly budget |
| Usage metrics | Counts, sizes and timings only | Never note bodies, titles, source text or file names |

Free initially, with these quotas (CS-D12). The app never promises unlimited storage.

---

## 7. Bringing existing data to the cloud (first sync)

For each workspace the user selects:
1. **Inventory**, shown before anything uploads: "Personal: 4 canvases, 312 blocks, 41 images (18 MB, off), 6
   sources (off). Upload canvases and notes?" Only the chosen categories are listed as uploading.
2. **Manifest** built from the local records.
3. **Documents:** each Y.Doc's full state uploaded as its first checkpoint, with its state vector.
4. **Images** (if on): `has()`, then the missing ones, 4 at a time, with retries.
5. **Sources** (if on): every version.
6. **Resumable:** progress per item in the outbox; nothing is uploaded twice.
7. **Verified** (§8) before the workspace shows "Synced"; until then "Uploading… 212 of 359".
8. **A device that already holds the same workspace** (for example from an import) merges by Yjs, never overwrites.

---

## 8. Proving "everything is synced"

- **Per document:** the local state vector equals the cloud's (checkpoint plus tail), without downloading the document.
- **Per workspace:** every manifest entry has its document in the cloud; every referenced image (if on) passes
  `has()`; every source version (if on) exists; the outbox is empty.
- **Status:** **Synced** · **Syncing (N pending)** · **Offline, N changes waiting** · **Paused** (a switch is off, with
  which one) · **Problem** (reason and Retry). Shown next to the existing save status (`saveStatus.ts`).
- **Check sync:** re-runs the workspace check, lists what's missing or different, and repairs it from the device. Runs
  daily and after a first upload.
- **Restore test:** a fresh device signs in, loads the workspace, and its manifest, documents (by state hash), images
  and sources must equal the source device's.

---

## 9. Deletion and retention (CS-D11, CS-D13)

Three separate policies, with a stated precedence:

| What | Policy | Mechanism |
|---|---|---|
| **A deleted item** (a canvas, block, page, image) inside a synced workspace | Recoverable for **30 days** as a tombstone, then purged | A scheduled purge function (daily) removes the item, its descendants, its operations and checkpoints, and any image no other live item in the workspace references. It verifies each removal and records an audit event. Firestore TTL is **not** relied on for the deadline, since TTL deletion is asynchronous (typically within 24 h after expiry); TTL only backs up the purge |
| **Delete cloud copy** of a whole workspace (owner only, confirmed) | Sync stops at once on every device; the cloud copy is **recoverable for 7 days**, then irreversibly purged. Local copies on devices are untouched | The workspace is marked `deleting` (rules then deny all access except the owner's restore); the purge function removes everything under `workspaces/{w}` after 7 days and verifies it |
| **Delete account** | Every workspace the user solely owns gets Delete cloud copy; memberships in other workspaces are removed; the auth user is deleted after the 7 days | The same functions |

**Precedence:** the workspace-level timer wins. Once a cloud copy is deleted, everything in it is purged at the 7-day
mark, including items whose own 30-day trash period hasn't ended. Restoring within 7 days brings back the workspace
with its trash as it was.

**Exceptions, documented on the privacy page:** Firestore point-in-time recovery and backups (kept off, or with
retention ≤ 7 days), Cloud Logging (no content; 30 days), billing records, and anything a legal obligation requires.
Deleted data in backups expires with the backup.

---

## 10. International privacy and compliance readiness

This plan doesn't assume one deployment satisfies every country's rules. It builds what applicable requirements need,
so each market can be assessed as the user base grows. These obligations depend on the service, the users, the data
and the processing arrangements, not only on the database region.

| Area | What's built |
|---|---|
| Transparency | The data-location notice (§5.8), a privacy page listing what is uploaded, where, by whom (subprocessors: Google Cloud / Firebase; the user's own AI provider for AI features), and for how long |
| User rights | Export (the bundle), Delete cloud copy, Delete account; access to the audit events of one's own workspaces |
| Retention | Separate periods for live data, trash, deleted cloud copies, logs, backups and derived data (§9) |
| Security | Least-privilege rules and service accounts; authorization on every operation; encryption at rest and in transit; App Check on the web |
| Cross-border transfers | Assessed per market before launching there (for example GDPR for EU users; Canadian and Indian rules separately). Option A means data is stored in the US, which the notice states |
| AI and agents | The app says when workspace content is sent to an AI provider (today only with the user's own key, from their device or through the AI host). Agent access to synced content is a separate control (hosted MCP stays off) |
| Incident response | Audit events (sign-ins, invitations, membership changes, deletions, purges; never content), an incident procedure, and the remote kill switch, tested in staging |

---

## 11. Moving to another provider or region later

1. Write the adapter (`src/cloud/adapters/<name>/`) and pass the conformance suite.
2. **Copy job,** per workspace: manifest, each document's checkpoint and tail, images by hash, source versions;
   resumable and verified with §8's checks on the target.
3. **Switch:** the backend config points the workspace at its new backend; clients finish their outbox on the old one,
   then reconnect (`minAppVersion` covers old desktop builds).
4. **Fallback:** the `.acute.json` bundle remains a provider-free full copy.

Hocuspocus (WebSocket Yjs) is the likely second adapter, for live co-editing. S3, R2 and Azure Blob fit `BlobStore`.
A regional move (§2.3) is the same job with a different target region.

---

## 12. Decisions

| # | Decision | Status |
|---|---|---|
| CS-D1 | **Access:** anonymous auth for a one-device backup; adding devices or recovering needs a signed-in account (Google, GitHub or email link); no reusable workspace key | **Approved** 2026-10-19 (from the user's review, with CS-D14). Replaces SQLite plan D1 |
| CS-D2 | **First backend: Firebase** (Firestore + Cloud Storage + Functions), behind the four interfaces; Hocuspocus later for live co-editing | **Approved** ("Firebase for now, open to migrate later"). Replaces SQLite plan D2 |
| CS-D3 | **Pasted sources: off by default,** a per-workspace switch; images a separate switch, off until chosen | **Approved** (the review's data categories) |
| CS-D4 | **AI conversations, agent traces and tool outputs: off, not syncable in v1** | **Approved** |
| CS-D5 | **Encryption:** provider-managed now; the engine's encryption boundary ready for client-side encryption; no E2E claim | **Approved** (the user's choice 3) |
| CS-D6 | **Image ids:** keep SHA-1 ids; record SHA-256 on upload; move ids to SHA-256 later | Proposed |
| CS-D7 | **App Check:** enforced for the web app; desktop relies on auth, rules, rate limits and quotas | Proposed (the review: App Check complements, never replaces, authorization) |
| CS-D8 | **Desktop account sign-in:** system browser, `acute://auth` deep link, single-use code | Proposed |
| CS-D9 | **Location:** Option A, one global deployment (Firestore `nam5`, Storage `US`, Functions `us-central1`), provisioned only after the CS0 audit; regional residency is future scope (§2.3) | **Approved** (the user's choices 1 and 2) |
| CS-D10 | **Scope:** selected workspaces only; new workspaces stay local until the user selects them | **Approved** |
| CS-D11 | **Off and deletion:** off pauses transfers and closes listeners, never deletes; Delete cloud copy is owner-only with a 7-day undo | **Approved**, with the precedence in §9 |
| CS-D12 | **Cost:** free initially, with backend-enforced quotas, account-level abuse controls and billing alerts; no unlimited promise | **Approved** |
| CS-D13 | **Retention:** deleted items recoverable for 30 days, then purged by a verified purge workflow; exceptions documented | **Approved** |
| CS-D14 | **Workspace access:** authenticated membership; invitations single-use, 24-hour, revocable, scoped to one workspace, redeemed only by a signed-in account; membership checked on every operation; Admin SDK functions do their own authorization | **Approved** |
| CS-D15 | **Defaults:** build flag off; remote kill switch enabled only after staging validation; user opt-in required; Real-time the default mode once sync is on | **Approved** |
| CS-D16 | **Staging environment:** a separate Firebase project for staging validation; `acute-qa` is the candidate, confirmed by the CS0 audit | Proposed |

---

## 13. Phases

Nothing touches a live project before CS6, and nothing reaches production before CS7. Every step with a cloud change
needs the user's approval at that step.

| Phase | Work | Done when | Tests |
|---|---|---|---|
| **CS0: Audit, read-only** | Inspect `acute-notes` and `acute-qa`: App Hosting backend and region, Hosting sites, the default resource location if set, Firestore databases and their locations, Storage buckets, Auth providers and settings, existing rules, Functions, IAM, billing plan and budgets, API keys and their restrictions, App Check. **No changes** | A written audit in this plan: what exists, where, and anything that blocks CS-D9 | — |
| **CS1: Data policy** | Confirm categories (§3), retention (§9), the notice and privacy page text, subprocessors, the region (CS-D9) against the audit; decide CS-D6–CS-D8 and CS-D16 | All decisions in §12 approved | — |
| **CS2: Contracts** | `contracts.ts` (the four interfaces, the operation format with `opId`, checkpoints), `syncScope.ts` + guard, `policy.ts` + `config/cloudSync.ts` (switches, modes, defaults), `cipher.ts` (identity), the in-memory adapter, the conformance suite | Suite green on the fake; every store has a category; the policy table of §5.8 holds | Conformance; guard; policy truth table (every switch combination) |
| **CS3: Local engine, no cloud** | Manifest and tombstones, outbox, acks, batching, inbox, checkpoints, conflict detection and conflict copies, catch-up by state vector, tab election, first upload, verification, status | Two or three simulated devices converge; conflicts are kept, never dropped | Offline edits on several fakes; same-element edits → conflict copy; kill mid-batch and resume; duplicate ops; off → on catch-up sends only the difference; each switch off → zero adapter calls |
| **CS4: Firebase adapter on the emulator** | Firestore, Storage and Auth adapters; security rules; callable functions (invitations, desktop sign-in exchange, quotas, purge, audit) with their own authorization; App Check hooks | Conformance green on the emulator; rules and functions tests green | Same suite on the emulator; isolation (cross-user and cross-workspace reads, writes, deletes, asset access all fail); revocation; invitation expiry and single use; quota and size limits; purge |
| **CS5: UI and desktop** | Settings → Sync (§5.8), the data-location notice, invitations and device list, status, Check sync, Delete cloud copy and restore; desktop outbox, deep-link sign-in, flush on quit | e2e on the emulator: web and packaged desktop devices sync one workspace, offline edits converge, a conflict is shown | Two browser contexts plus the packaged app (`test:desktop-storage` extended) against the emulator |
| **CS6: Staging resources and validation** (approval) | In the staging project: Firestore `nam5`, a `US` bucket, Functions `us-central1`, rules, IAM, App Check, budgets, the kill switch | Every acceptance test in §14 passes in staging | §14 in full |
| **CS7: Production and controlled rollout** (approval) | The same resources in `acute-notes`; build flag on for a small test cohort, then wider | The restore test passes on two real devices; no incident in the cohort period | §14's smoke subset in production |

**Coordination with the Knowledge Notes lanes:** this work lives in new folders (`src/cloud/**`, `functions/`) and
touches `src/sync/DocumentProvider.ts`, `src/sync/saveStatus.ts`, `src/persistence/index.ts`, one new store in `db.ts`
(the outbox) and its repository. `persistence/repositories/*` is integrator-owned in
[knowledge-notes-lanes.md](./knowledge-notes-lanes.md), so the outbox repository goes through the lanes log while the
lanes run; `db.ts` isn't lane-owned but is shared, so its migration is added last.

---

## 14. Acceptance tests before launch

| Test | Passes when |
|---|---|
| **Build isolation** | With the build flag off, the production bundle has no sync-only Firebase initialization and no sync UI (bundle check) |
| **Zero network activity** | With any required switch off, no sync reads, writes, listeners or retries happen (a fake adapter fails on any call; in staging, network logs) |
| **Offline editing** | Network off: edit canvases and notes, restart the app (web and desktop), local data survives and later syncs |
| **Incremental catch-up** | Changes made while sync is off transfer as exactly the state-vector difference when it's turned back on |
| **Concurrent edits** | The same text on two devices: both edits kept. The same element on two devices: a conflict copy, nothing lost |
| **Isolation** | Cross-user and cross-workspace reads, writes, deletes and asset access all fail, through the client and directly against the API |
| **Revocation** | A removed device or a revoked or expired invitation is denied on its next operation, and its listeners close |
| **Deletion lifecycle** | Item recovery within 30 days; purge after; Delete cloud copy restore within 7 days; purge after, including images and descendants; precedence as §9 |
| **Categories** | With images or sources off, none of their bytes reach the cloud by any path (checked on the emulator's storage and database contents) |
| **Location** | Firestore, Storage and Functions are in the CS-D9 locations; logs and backups as the privacy page states. (Regional routing per workspace is future scope; until it exists, this test checks the single location) |
| **Abuse and cost** | Quotas, oversized uploads, retry limits, listener cleanup, rate limits and the kill switch all behave as §6 says |
| **Kill switch** | Turning it off pauses running clients within one refresh period; a client that can't read it fails closed after 24 h |
| **Restore** | A fresh device signs in and its workspace equals the source device's (manifest, documents by state hash, images, sources) |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| A device thinks it's synced but isn't | State-vector and hash verification; acks before leaving the outbox; daily Check sync |
| An offline device brings a deleted item back | Tombstones; edit-after-delete restores with a message |
| Same-element edits lose a change | Conflict detection and conflict copies (§5.3) |
| A category switch is bypassed indirectly | `syncScope.ts` as the only source of what the engine reads, with its guard; category tests on the emulator; the settings explain what's canvas content |
| Unauthorized access | Authenticated membership; rules on every operation; scoped, expiring, single-use invitations; functions check authorization themselves; isolation and revocation tests |
| Firestore or Storage location chosen wrongly | Nothing provisioned before the audit; locations fixed in CS-D9; staging first |
| Residency promised but not delivered | No residency promise in v1; the notice states the US location; regional routing is future scope with its own checklist (§2.3) |
| Cost runaway or abuse | Backend quotas, rate limits, anonymous-user limits, budget alerts, the kill switch |
| Lock-in to Firebase | Four interfaces, the import guard, the conformance suite, the copy job, the bundle |
| An anonymous user loses their only device | The notice explains it; the app prompts to link an account after the first upload; with an account, recovery is a sign-in |
| Deleted data lingers in backups or logs | Backups off or ≤ 7 days; logs carry no content; documented exceptions |
| A secret reaches the cloud | Credentials outside every sync path; category guard; upload payload tests |
