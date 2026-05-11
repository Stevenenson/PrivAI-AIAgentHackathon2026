const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const DEFAULT_UI_PORT = 3100;
const DEFAULT_API_PORT = 8080;
const HOST = "127.0.0.1";

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

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, HOST);
  });
}

function getOpenPort(excluded = new Set()) {
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
      server.listen(0, HOST);
    };
    listen();
  });
}

async function pickPort(preferred, label, excluded = new Set()) {
  if (!excluded.has(preferred) && (await canListen(preferred))) {
    return preferred;
  }
  const port = await getOpenPort(excluded);
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
  );
  console.log(`[desktop] backend http://${HOST}:${apiPort}`);
  console.log(`[desktop] ui http://${HOST}:${uiPort}`);
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
  if (cfg.workspaceRoot && fs.existsSync(cfg.workspaceRoot)) {
    return cfg.workspaceRoot;
  }
  return isDev() ? repoRoot() : app.getPath("home");
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
        "LLM_PROVIDER=openai",
        "OPENAI_API_KEY=",
        "OPENAI_MODEL=gpt-5.4-mini",
        "OPENAI_VISION_MODEL=gpt-5.4-mini",
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
  writeDesktopConfig({ workspaceRoot });
}

function logFile(name) {
  const dir = userDataPath("logs");
  ensureDir(dir);
  return fs.openSync(path.join(dir, name), "a");
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
    ...desktopEnv(),
    ...process.env,
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
      ["run", "dev", "--", "--hostname", HOST, "--port", String(uiPort)],
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
  uiProc = spawnLogged(
    process.execPath,
    [server],
    {
      cwd: path.dirname(server),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HOSTNAME: HOST,
        PORT: String(uiPort),
        NEXT_PUBLIC_DEFAULT_BOARD_URL: `http://${HOST}:${apiPort}`,
      },
    },
    "next",
  );
}

function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
        } else {
          setTimeout(tick, 300);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    tick();
  });
}

async function createWindow() {
  await choosePorts();
  startBackend();
  startNext();
  const url = `http://${HOST}:${uiPort}`;
  try {
    await waitForUrl(url);
  } catch (err) {
    dialog.showErrorBox("Privai failed to start", String(err));
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 680,
    title: "Privai",
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

  mainWindow.loadURL(url);
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
}

async function chooseWorkspace() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Workspace",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  writeWorkspaceRoot(result.filePaths[0]);
  restartBackend();
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
        { type: "separator" },
        { role: "quit" },
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

app.whenReady().then(() => {
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
