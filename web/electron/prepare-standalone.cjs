const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

if (!fs.existsSync(standalone)) {
  throw new Error("Missing .next/standalone. Run `next build` first.");
}

copyIfExists(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
copyIfExists(path.join(root, "public"), path.join(standalone, "public"));

console.log("standalone Next server prepared");
