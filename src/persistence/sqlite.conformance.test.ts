import { afterAll } from "vitest";
import { runPersistenceConformance } from "./conformance/runPersistenceConformance";
import { createSqliteTestServices, disposeSqliteTestBackends } from "./conformance/sqliteBackend";

afterAll(disposeSqliteTestBackends);

// The desktop store, through the real validating dispatcher and the renderer-side proxy (IPC simulated with structuredClone).
runPersistenceConformance("sqlite", createSqliteTestServices);
