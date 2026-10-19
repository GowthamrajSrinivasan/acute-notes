// Electron shell for Acute Notes.
//
// Runs the Next.js standalone server on a random loopback port and exposes it
// to the renderer through a custom `acute://app` scheme. The renderer's origin
// is therefore constant, so IndexedDB / localStorage survive restarts and port
// changes.
const { app, BrowserWindow, protocol, shell, dialog, Menu, ipcMain } = require("electron");
const { utilityProcess } = require("electron");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { Readable } = require("node:stream");

const SCHEME = "acute";
const APP_URL = `${SCHEME}://app/`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

let serverProc = null;
let storage = null;
let serverPort = 0;
let mainWindow = null;

// Prefer a fixed port so the MCP URL given to Claude Code stays valid across
// launches (override with ACUTE_PORT); fall back to any free port if it is taken.
const PREFERRED_PORT = Number(process.env.ACUTE_PORT) || 47821;

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => {
      const { port: actual } = srv.address();
      srv.close(() => resolve(actual));
    });
  });
}

async function freePort() {
  try {
    return await listenOn(PREFERRED_PORT);
  } catch {
    return listenOn(0);
  }
}

function serverDir() {
  // Packaged: resources/server (unpacked). Dev: .next/standalone.
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".next", "standalone");
}

async function waitForServer(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Timed out waiting for the Acute Notes server to start.");
}

async function startServer() {
  serverPort = await freePort();
  const dir = serverDir();
  let stderr = "";
  serverProc = utilityProcess.fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    stdio: "pipe",
    env: {
      ...process.env,
      // The desktop app serves MCP to the user's own local agents; the server enforces this flag on every MCP route.
      MCP_FEATURE: process.env.MCP_FEATURE ?? "on",
      PORT: String(serverPort),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
  });
  serverProc.stderr?.on("data", (d) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  serverProc.on("exit", (code) => {
    if (!app.isQuitting && code !== 0) {
      dialog.showErrorBox("Acute Notes server stopped", `Exit code ${code}\n\n${stderr}`);
      app.quit();
    }
  });
  await waitForServer(serverPort);
}

// Proxy acute://app/<path> -> http://127.0.0.1:<port>/<path>, rewriting Host /
// Origin so the app's loopback + same-origin checks (MCP routes) pass.
function proxy(request) {
  const url = new URL(request.url);
  const loopback = `127.0.0.1:${serverPort}`;
  const headers = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  headers.host = loopback;
  if (headers.origin) headers.origin = `http://${loopback}`;
  if (headers.referer) headers.referer = `http://${loopback}${new URL(headers.referer).pathname}`;
  headers["sec-fetch-site"] = "same-origin";
  delete headers["accept-encoding"];

  return new Promise((resolve) => {
    const upstream = http.request(
      { host: "127.0.0.1", port: serverPort, path: url.pathname + url.search, method: request.method, headers },
      (res) => {
        const outHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          if (Array.isArray(v)) v.forEach((x) => outHeaders.append(k, x));
          else outHeaders.set(k, v);
        }
        const noBody = request.method === "HEAD" || [101, 204, 304].includes(res.statusCode || 0);
        resolve(
          new Response(noBody ? null : Readable.toWeb(res), {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: outHeaders,
          }),
        );
      },
    );
    upstream.on("error", (err) => resolve(new Response(`Proxy error: ${err.message}`, { status: 502 })));
    request.signal?.addEventListener("abort", () => upstream.destroy());
    if (request.body && request.method !== "GET" && request.method !== "HEAD") {
      Readable.fromWeb(request.body).pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Acute Notes",
    // Packaged builds get the icon embedded in the executable; this is for `electron .`.
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, "..", "build", "icon.png") }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--acute-mcp-origin=http://127.0.0.1:${serverPort}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(APP_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
      ].filter((m) => process.platform === "darwin" || m.role !== "appMenu")));
      // Storage opens only here, after the single-instance lock above: a second instance quits before touching the database.
      storage = require("./storage/index.cjs").initStorage(app.getPath("userData"));
      storage.register(ipcMain);
      protocol.handle(SCHEME, proxy);
      await startServer();
      createWindow();
    } catch (err) {
      dialog.showErrorBox("Acute Notes failed to start", String(err && err.stack ? err.stack : err));
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow && serverPort) createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    app.isQuitting = true;
    if (serverProc) serverProc.kill();
    if (storage) {
      storage.close();
      storage = null;
    }
  });
}
