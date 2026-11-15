import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openDB } from "idb";
import { runPersistenceConformance, doc } from "./conformance/runPersistenceConformance";
import { DB_VERSION, MIGRATIONS, openAcuteDB, type AcuteDB } from "./db";
import { createIndexedDbServices } from "./repositories/indexeddb";
import { createMemoryServices } from "./repositories/memory";

let dbCounter = 0;

// Shared contract: every backend passes the same suite (see conformance/runPersistenceConformance.ts).
runPersistenceConformance("memory", createMemoryServices);
runPersistenceConformance("indexeddb", () => createIndexedDbServices(openAcuteDB(`acute-test-${++dbCounter}`)));

describe("database schema (IndexedDB only)", () => {
  it("creates every store at the current version", async () => {
    const db = await openAcuteDB(`acute-schema-${++dbCounter}`);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(
      ["agentChanges", "agentSessions", "aiConnections", "aiConversations", "aiTurns", "assets", "canvases", "contentSourceVersions", "contentSources", "documents", "meta", "repoMaps", "workspaces", "yupdates"].sort(),
    );
    db.close();
  });

  it("upgrades a v1 database in place and indexes existing documents by kind", async () => {
    const name = `acute-upgrade-${++dbCounter}`;
    const v1 = await openDB<AcuteDB>(name, 1, { upgrade: (db, _o, _n, tx) => MIGRATIONS[0]!(db, tx as never) });
    await v1.put("documents", doc("page_1", "ws", "page"));
    await v1.put("documents", doc("doc_1", "ws", "block"));
    v1.close();

    const services = createIndexedDbServices(openAcuteDB(name));
    expect((await services.documents.listByWorkspace("ws", "page")).map((d) => d.id)).toEqual(["page_1"]);
    expect(await services.documents.listByWorkspace("ws")).toHaveLength(2);
  });
});

describe("content source versions with unit ids (knowledge-notes-plan WP1.3, IndexedDB)", () => {
  it("needs no schema bump: a version written before units existed still loads, and one with units and lineage round-trips", async () => {
    const name = `acute-units-${++dbCounter}`;
    // A database as WP1.3 found it, with a version written before units existed.
    const before = await openAcuteDB(name);
    const header = { id: "s", workspaceId: "ws", canvasId: "cv", origin: "paste" as const, tier: "ai" as const, template: "sectioned", latestVersion: 1, createdAt: 1, updatedAt: 1 };
    const old = { sourceId: "s", version: 1, text: "One. Two.", plan: { version: 1 }, createdAt: 1 };
    await before.put("contentSources", header);
    await before.put("contentSourceVersions", old);
    before.close();

    const { contentSources } = createIndexedDbServices(openAcuteDB(name));
    expect(await contentSources.getVersion("s", 1)).toEqual(old);
    const units = { units: [{ id: "u1", kind: "sentence" as const, text: "One.", hash: "h", topic: "", span: { start: 0, end: 4 } }], nextId: 2 };
    const lineage = { fromVersion: 1, toVersion: 2, entries: [{ state: "added" as const, to: "u1" }] };
    await contentSources.append({ ...header, latestVersion: 2 }, { ...old, version: 2, units, lineage });
    expect(await contentSources.getVersion("s", 2)).toEqual({ ...old, version: 2, units, lineage });
    expect(await contentSources.getVersion("s", 1)).toEqual(old);
  });
});
