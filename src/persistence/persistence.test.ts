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
