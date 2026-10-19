import "fake-indexeddb/auto";
import { afterAll } from "vitest";
import { createSqliteTestServices, disposeSqliteTestBackends } from "@/persistence/conformance/sqliteBackend";
import { openAcuteDB } from "@/persistence/db";
import { createIndexedDbServices } from "@/persistence/repositories/indexeddb";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { runPortabilityConformance } from "./conformance/runPortabilityConformance";

let counter = 0;

afterAll(disposeSqliteTestBackends);

// Every ordered pair of backends: a workspace exported from one imports losslessly into any other.
runPortabilityConformance({
  memory: createMemoryServices,
  indexeddb: () => createIndexedDbServices(openAcuteDB(`acute-portability-${++counter}`)),
  sqlite: createSqliteTestServices,
});
