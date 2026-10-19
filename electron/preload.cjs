// The renderer gets no Node/Electron access except two narrow things:
//  - the loopback origin of the bundled server, which external MCP clients (Claude Code) need to connect to;
//  - `storage.invoke`, one validated request per repository call to the SQLite store in the main process
//    (electron/storage/contract.json lists every allowed call; there is no way to send SQL).
const { contextBridge, ipcRenderer } = require("electron");

const prefix = "--acute-mcp-origin=";
const arg = process.argv.find((a) => a.startsWith(prefix));

contextBridge.exposeInMainWorld("acuteDesktop", {
  ...(arg ? { mcpOrigin: arg.slice(prefix.length) } : {}),
  storage: {
    invoke: (service, method, args) => ipcRenderer.invoke("acute:storage", service, method, args),
  },
});
