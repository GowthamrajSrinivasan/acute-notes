// Desktop storage entry point (main process): the SQLite database + asset files under the user-data folder, and
// the validated IPC dispatcher in front of them.
const path = require("node:path");
const { createAssetFiles } = require("./assets.cjs");
const { openDatabase } = require("./db.cjs");
const { createDispatcher, registerStorageIpc } = require("./ipc.cjs");
const { createStorageServices } = require("./services.cjs");

/** Opens storage under `<userData>/storage`. Call only after the single-instance lock has been taken. */
function initStorage(userDataDir) {
  const root = path.join(userDataDir, "storage");
  const db = openDatabase(path.join(root, "acute-notes.sqlite3"));
  const services = createStorageServices(db, createAssetFiles(path.join(root, "assets")));
  const invoke = createDispatcher(services);
  return {
    services,
    invoke,
    register: (ipcMain) => registerStorageIpc(ipcMain, invoke),
    close() {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        // Best effort: the WAL is replayed on the next open anyway.
      }
      db.close();
    },
  };
}

module.exports = { initStorage };
