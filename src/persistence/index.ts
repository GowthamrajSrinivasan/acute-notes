import { openAcuteDB } from "./db";
import { createIndexedDbServices } from "./repositories/indexeddb";
import { createIpcServices, desktopStorageInvoke } from "./repositories/ipc";
import type { PersistenceServices } from "./repositories/types";

export type * from "./repositories/types";

let services: PersistenceServices | null = null;

/**
 * App-wide local persistence services (browser only). In the desktop app they are backed by the SQLite store in the
 * Electron main process (reached over the validated storage IPC); in a normal browser by IndexedDB. Callers cannot
 * tell which, and never await storage on an interaction path.
 */
export function getPersistence(): PersistenceServices {
  if (!services) {
    const desktop = desktopStorageInvoke();
    if (desktop) {
      services = createIpcServices(desktop);
    } else {
      services = createIndexedDbServices(openAcuteDB());
      // Ask the browser not to evict local-first data under storage pressure.
      void navigator.storage?.persist?.().catch(() => undefined);
    }
  }
  return services;
}
