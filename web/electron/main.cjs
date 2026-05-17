const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const DEFAULT_UI_PORT = 3100;
const DEFAULT_API_PORT = 8080;
const HOST = "127.0.0.1";
// Bind + probe on IPv4 explicitly. With "localhost" Next/Turbopack binds
// IPv6-only on macOS (::1) but Node's http.get resolves localhost to 127.0.0.1
// first, so waitForUrl never connects.
const UI_HOST = "127.0.0.1";

app.setName("Privai");

let mainWindow = null;
let backendProc = null;
let uiProc = null;
let uiPort = DEFAULT_UI_PORT;
let apiPort = DEFAULT_API_PORT;

function isDev() {
  return !app.isPackaged;
}

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function webRoot() {
  return isDev() ? path.resolve(__dirname, "..") : app.getAppPath();
}

function userDataPath(...parts) {
  return path.join(app.getPath("userData"), ...parts);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function validPort(value, fallback) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function canListen(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function getOpenPort(excluded = new Set(), host = HOST) {
  return new Promise((resolve) => {
    const listen = () => {
      const server = net.createServer();
      server.once("error", listen);
      server.once("listening", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close(() => {
          if (port && !excluded.has(port)) resolve(port);
          else listen();
        });
      });
      server.listen(0, host);
    };
    listen();
  });
}

async function pickPort(preferred, label, excluded = new Set(), host = HOST) {
  if (!excluded.has(preferred) && (await canListen(preferred, host))) {
    return preferred;
  }
  const port = await getOpenPort(excluded, host);
  console.warn(`[desktop] ${label} port ${preferred} is busy; using ${port}`);
  return port;
}

async function choosePorts() {
  apiPort = await pickPort(
    validPort(process.env.API_PORT, DEFAULT_API_PORT),
    "backend",
  );
  uiPort = await pickPort(
    validPort(process.env.PRIVAI_UI_PORT, DEFAULT_UI_PORT),
    "ui",
    new Set([apiPort]),
    UI_HOST,
  );
  console.log(`[desktop] backend http://${HOST}:${apiPort}`);
  console.log(`[desktop] ui http://${UI_HOST}:${uiPort}`);
}

function isRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null && !child.killed);
}

function workspaceConfigPath() {
  return userDataPath("desktop.json");
}

function readDesktopConfig() {
  try {
    return JSON.parse(fs.readFileSync(workspaceConfigPath(), "utf8")) || {};
  } catch {
    return {};
  }
}

function writeDesktopConfig(patch) {
  const merged = { ...readDesktopConfig(), ...patch };
  fs.writeFileSync(workspaceConfigPath(), JSON.stringify(merged, null, 2));
  return merged;
}

function readWorkspaceRoot() {
  if (process.env.WORKSPACE_ROOT) return process.env.WORKSPACE_ROOT;
  const cfg = readDesktopConfig();
  if (cfg.workspaceExplicit && cfg.workspaceRoot && fs.existsSync(cfg.workspaceRoot)) {
    return cfg.workspaceRoot;
  }
  return "";
}

function ensurePairingCode() {
  if (process.env.PAIRING_CODE) return process.env.PAIRING_CODE;
  const cfg = readDesktopConfig();
  if (cfg.pairingCode && /^[0-9]{6,}$/.test(cfg.pairingCode)) {
    return cfg.pairingCode;
  }
  const code = String(crypto.randomInt(100000, 1000000));
  writeDesktopConfig({ pairingCode: code });
  return code;
}

function parseDotEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (key) values[key] = value;
  }
  return values;
}

function desktopEnv() {
  const userEnv = userDataPath(".env");
  if (!fs.existsSync(userEnv)) {
    fs.writeFileSync(
      userEnv,
      [
        "LLM_PROVIDER=gemini",
        "GEMINI_API_KEY=",
        "GEMINI_MODEL=gemini-3.1-pro-preview",
        "GEMINI_VISION_MODEL=gemini-3.1-pro-preview",
        "GEMINI_THINKING_LEVEL=high",
        "GOOGLE_CLIENT_ID=",
        "GOOGLE_CLIENT_SECRET=",
        "GOOGLE_REDIRECT_URI=http://127.0.0.1:8080/google/oauth/callback",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  }

  const userValues = parseDotEnv(userEnv);
  for (const [key, value] of Object.entries(userValues)) {
    if (value === "") delete userValues[key];
  }
  return {
    ...(isDev() ? parseDotEnv(path.join(repoRoot(), ".env")) : {}),
    ...userValues,
  };
}

function writeWorkspaceRoot(workspaceRoot) {
  writeDesktopConfig({ workspaceRoot, workspaceExplicit: true });
}

function cleanWorkspaceName(rawName) {
  const fallback = "privai-project";
  const name = String(rawName || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/^[.-]+/, "")
    .slice(0, 80);
  return name || fallback;
}

function setWorkspace(workspaceRoot) {
  const next = path.resolve(String(workspaceRoot || ""));
  if (!next || !fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
    throw new Error("Workspace folder does not exist");
  }
  writeWorkspaceRoot(next);
  restartBackend();
  return next;
}

function logFile(name) {
  const dir = userDataPath("logs");
  ensureDir(dir);
  return fs.openSync(path.join(dir, name), "a");
}

function logsDir() {
  const dir = userDataPath("logs");
  ensureDir(dir);
  return dir;
}

function openLogs() {
  return shell.openPath(logsDir());
}

function openAppData() {
  ensureDir(app.getPath("userData"));
  return shell.openPath(app.getPath("userData"));
}

function revealEnvFile() {
  desktopEnv();
  shell.showItemInFolder(userDataPath(".env"));
  return Promise.resolve();
}

function spawnLogged(command, args, options, label) {
  const stdout = logFile(`${label}.log`);
  const stderr = logFile(`${label}.err.log`);
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", stdout, stderr],
  });
  child.on("exit", (code, signal) => {
    console.log(`[${label}] exited`, { code, signal });
  });
  child.on("error", (err) => {
    console.error(`[${label}]`, err);
  });
  return child;
}

function backendEnv() {
  const dataDir = userDataPath("data");
  ensureDir(dataDir);
  return {
    ...process.env,
    ...desktopEnv(),
    API_HOST: HOST,
    API_PORT: String(apiPort),
    DB_PATH: path.join(dataDir, "chat.db"),
    CACHE_DIR: path.join(dataDir, "cache"),
    WORKSPACE_ROOT: readWorkspaceRoot(),
    PAIRING_CODE: ensurePairingCode(),
    CORS_ORIGINS: [
      `http://${HOST}:${uiPort}`,
      `http://localhost:${uiPort}`,
      `http://${HOST}:${apiPort}`,
      `http://localhost:${apiPort}`,
    ].join(","),
  };
}

function startBackend() {
  if (isRunning(backendProc)) return;
  if (isDev()) {
    const root = repoRoot();
    const python = path.join(root, ".venv", "bin", "python");
    backendProc = spawnLogged(
      fs.existsSync(python) ? python : "python3",
      ["-m", "uvicorn", "backend.main:app", "--host", HOST, "--port", String(apiPort)],
      { cwd: root, env: backendEnv() },
      "backend",
    );
    return;
  }

  const exe = process.platform === "win32" ? "privai-backend.exe" : "privai-backend";
  const backendPath = path.join(process.resourcesPath, "backend", exe);
  if (!fs.existsSync(backendPath)) {
    dialog.showErrorBox(
      "Backend missing",
      `Could not find packaged backend at:\n${backendPath}\n\nRun npm run dist from web/ to build the installer.`,
    );
    return;
  }
  backendProc = spawnLogged(backendPath, [], {
    cwd: path.dirname(backendPath),
    env: backendEnv(),
  }, "backend");
}

function startNext() {
  if (isRunning(uiProc)) return;
  if (isDev()) {
    uiProc = spawnLogged(
      "npm",
      ["run", "dev", "--", "--hostname", UI_HOST, "--port", String(uiPort)],
      {
        cwd: webRoot(),
        env: {
          ...process.env,
          NEXT_PUBLIC_DEFAULT_BOARD_URL: `http://${HOST}:${apiPort}`,
        },
      },
      "next",
    );
    return;
  }

  const server = path.join(webRoot(), ".next", "standalone", "server.js");
  const unpackedServer = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    ".next",
    "standalone",
    "server.js",
  );
  const activeServer = fs.existsSync(unpackedServer) ? unpackedServer : server;
  uiProc = spawnLogged(
    process.execPath,
    [activeServer],
    {
      cwd: path.dirname(activeServer),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HOSTNAME: UI_HOST,
        PORT: String(uiPort),
        NEXT_PUBLIC_DEFAULT_BOARD_URL: `http://${HOST}:${apiPort}`,
      },
    },
    "next",
  );
}

function waitForUrl(url, timeoutMs = 180000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url} after ${Math.round(timeoutMs / 1000)}s`));
        } else {
          setTimeout(tick, 500);
        }
      });
      req.setTimeout(1500, () => {
        req.destroy();
      });
    };
    tick();
  });
}

function splashUrl() {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      display: grid;
      place-items: center;
      background: #0b0d12;
      color: #ececec;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      display: grid;
      gap: 18px;
      justify-items: center;
      text-align: center;
    }
    .mark {
      width: 82px;
      height: 82px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(79, 140, 255, 0.36);
      background: linear-gradient(135deg, #4f8cff, #45d483);
      color: white;
      font-size: 44px;
      font-weight: 900;
      box-shadow: 0 18px 60px rgba(79, 140, 255, 0.24);
    }
    h1 {
      margin: 0;
      font-size: 36px;
      line-height: 1;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: #8a90a0;
      font-size: 14px;
    }
    .bar {
      width: 180px;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: #20242e;
    }
    .bar span {
      display: block;
      width: 42%;
      height: 100%;
      border-radius: inherit;
      background: #4f8cff;
      animation: load 1.2s ease-in-out infinite;
    }
    @keyframes load {
      0% { transform: translateX(-110%); }
      100% { transform: translateX(260%); }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark">P</div>
    <h1>Privai</h1>
    <p>Starting private workspace...</p>
    <div class="bar"><span></span></div>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function createWindow() {
  await choosePorts();
  const url = `http://${UI_HOST}:${uiPort}`;
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 680,
    title: "Privai",
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--privai-pairing-code=${ensurePairingCode()}`,
        `--privai-api-url=http://${HOST}:${apiPort}`,
      ],
    },
  });

  mainWindow.loadURL(splashUrl());
  startBackend();
  startNext();
  try {
    await waitForUrl(url);
    if (!mainWindow.isDestroyed()) mainWindow.loadURL(url);
  } catch (err) {
    dialog.showErrorBox("Privai failed to start", String(err));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  installContextMenu(mainWindow);
}

async function chooseWorkspace() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Workspace",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  return setWorkspace(result.filePaths[0]);
}

async function createWorkspace(_event, rawName) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Parent Folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const parent = result.filePaths[0];
  const target = path.join(parent, cleanWorkspaceName(rawName));
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
    throw new Error("A file already exists with that workspace name");
  }
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: false });
  }
  return setWorkspace(target);
}

function restartBackend() {
  if (isRunning(backendProc)) {
    backendProc.kill();
    backendProc = null;
  }
  startBackend();
  mainWindow?.webContents.reload();
}

function installMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Workspace...", click: chooseWorkspace },
        {
          label: "Create Workspace...",
          click: async () => {
            try {
              await createWorkspace(null, "privai-project");
            } catch (err) {
              dialog.showErrorBox("Could not create workspace", String(err));
            }
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Privai",
      submenu: [
        { label: "Open Logs", click: openLogs },
        { label: "Open App Data Folder", click: openAppData },
        { label: "Reveal Environment File", click: revealEnvFile },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installContextMenu(win) {
  win.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      );
    } else if (params.selectionText) {
      template.push(
        { role: "copy" },
        { type: "separator" },
        { role: "selectAll" },
      );
    }
    if (template.length) {
      Menu.buildFromTemplate(template).popup({ window: win });
    }
  });
}

function stripFramingHeadersForLocalhost() {
  // Local dev servers (Next, Vite, CRA, Flask debug) sometimes send
  // X-Frame-Options or a frame-ancestors CSP that blocks embedding the
  // in-app preview. Strip those only for 127.0.0.1 / localhost responses so
  // the Coding preview pane can iframe the dev server.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url || "";
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
    if (!isLocal) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === "x-frame-options") {
        delete headers[key];
      } else if (lower === "content-security-policy") {
        const values = Array.isArray(headers[key]) ? headers[key] : [headers[key]];
        const cleaned = values
          .map((value) =>
            String(value)
              .split(";")
              .map((part) => part.trim())
              .filter((part) => !/^frame-ancestors\b/i.test(part))
              .join("; "),
          )
          .filter(Boolean);
        if (cleaned.length) headers[key] = cleaned;
        else delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });
}

app.whenReady().then(() => {
  stripFramingHeadersForLocalhost();
  ipcMain.handle("privai:choose-workspace", chooseWorkspace);
  ipcMain.handle("privai:create-workspace", createWorkspace);
  ipcMain.handle("privai:set-workspace", (_event, workspaceRoot) =>
    setWorkspace(workspaceRoot),
  );
  ipcMain.handle("privai:open-logs", openLogs);
  ipcMain.handle("privai:open-app-data", openAppData);
  ipcMain.handle("privai:reveal-env-file", revealEnvFile);
  installMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  for (const child of [backendProc, uiProc]) {
    if (isRunning(child)) child.kill();
  }
});
