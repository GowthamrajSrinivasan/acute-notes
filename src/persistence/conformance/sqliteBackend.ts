/**
 * Test harness for the desktop SQLite backend: the real main-process modules (electron/storage/*.cjs, running on
 * Node's `node:sqlite`) behind the real validating dispatcher, reached through the real renderer-side proxy. Requests
 * and responses pass through `structuredClone`, as they do over Electron IPC, so anything IPC cannot carry fails here.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIpcServices, type StorageInvoke } from "../repositories/ipc";
import type { PersistenceServices } from "../repositories/types";

const require = createRequire(import.meta.url);
const { initStorage } = require("../../../electron/storage/index.cjs") as { initStorage(userData: string): StorageHandle };

export interface StorageHandle {
  invoke: StorageInvoke;
  services: unknown;
  close(): void;
}

export interface SqliteTestBackend {
  dir: string;
  storage: StorageHandle;
  services: PersistenceServices;
}

const open: SqliteTestBackend[] = [];

/** A fresh, empty on-disk database (temp folder) + its renderer-side services. */
export function createSqliteTestBackend(dir = mkdtempSync(join(tmpdir(), "acute-sqlite-test-"))): SqliteTestBackend {
  const storage = initStorage(dir);
  const invoke: StorageInvoke = async (service, method, args) => structuredClone(await storage.invoke(service, method, structuredClone(args)));
  const backend = { dir, storage, services: createIpcServices(invoke) };
  open.push(backend);
  return backend;
}

export function createSqliteTestServices(): PersistenceServices {
  return createSqliteTestBackend().services;
}

/** Closes every database opened by this harness and deletes its temp folder. Call from `afterAll`. */
export function disposeSqliteTestBackends(): void {
  for (const b of open.splice(0)) {
    try {
      b.storage.close();
    } catch {
      // Already closed by the test.
    }
    rmSync(b.dir, { recursive: true, force: true });
  }
}
