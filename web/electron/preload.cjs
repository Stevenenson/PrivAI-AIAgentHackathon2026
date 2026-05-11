const { contextBridge } = require("electron");

function argumentValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

contextBridge.exposeInMainWorld("privaiDesktop", {
  platform: process.platform,
  pairingCode: argumentValue("--privai-pairing-code="),
  apiUrl: argumentValue("--privai-api-url="),
});
