const { contextBridge, ipcRenderer } = require("electron");

function argumentValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

contextBridge.exposeInMainWorld("privaiDesktop", {
  platform: process.platform,
  pairingCode: argumentValue("--privai-pairing-code="),
  apiUrl: argumentValue("--privai-api-url="),
  chooseWorkspace: () => ipcRenderer.invoke("privai:choose-workspace"),
  createWorkspace: (name) => ipcRenderer.invoke("privai:create-workspace", name),
  setWorkspace: (path) => ipcRenderer.invoke("privai:set-workspace", path),
  openLogs: () => ipcRenderer.invoke("privai:open-logs"),
  openAppData: () => ipcRenderer.invoke("privai:open-app-data"),
  revealEnvFile: () => ipcRenderer.invoke("privai:reveal-env-file"),
});
