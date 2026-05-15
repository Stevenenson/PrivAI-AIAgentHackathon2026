const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, "build");
const iconsetDir = path.join(buildDir, "icon.iconset");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const i = row + 1 + x * 4;
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const radius = size * 0.22;
      const inside =
        x >= radius &&
        x <= size - radius &&
        y >= radius &&
        y <= size - radius;
      const corner =
        Math.hypot(Math.max(radius - x, x - (size - radius), 0), Math.max(radius - y, y - (size - radius), 0)) <=
        radius;
      if (!(inside || corner)) {
        raw[i + 3] = 0;
        continue;
      }
      raw[i] = Math.round(79 * (1 - nx) + 69 * nx);
      raw[i + 1] = Math.round(140 * (1 - ny) + 212 * ny);
      raw[i + 2] = Math.round(255 * (1 - nx) + 131 * nx);
      raw[i + 3] = 255;
    }
  }

  drawLetter(raw, size);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawRect(raw, size, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= size) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= size) continue;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = 255;
      raw[i + 1] = 255;
      raw[i + 2] = 255;
      raw[i + 3] = 255;
    }
  }
}

function drawLetter(raw, size) {
  const u = size / 1024;
  drawRect(raw, size, Math.round(330 * u), Math.round(260 * u), Math.round(116 * u), Math.round(520 * u));
  drawRect(raw, size, Math.round(330 * u), Math.round(260 * u), Math.round(285 * u), Math.round(116 * u));
  drawRect(raw, size, Math.round(330 * u), Math.round(472 * u), Math.round(285 * u), Math.round(110 * u));
  drawRect(raw, size, Math.round(545 * u), Math.round(315 * u), Math.round(110 * u), Math.round(210 * u));
}

function run(command, args) {
  childProcess.execFileSync(command, args, { stdio: "ignore" });
}

function writeIcnsFallback() {
  const entries = [
    ["icp4", "icon_16x16.png"],
    ["icp5", "icon_32x32.png"],
    ["icp6", "icon_32x32@2x.png"],
    ["ic07", "icon_128x128.png"],
    ["ic08", "icon_256x256.png"],
    ["ic09", "icon_512x512.png"],
    ["ic10", "icon_512x512@2x.png"],
  ].map(([type, name]) => {
    const data = fs.readFileSync(path.join(iconsetDir, name));
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(entries);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(path.join(buildDir, "icon.icns"), Buffer.concat([header, body]));
}

fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, "icon.png"), makePng(1024));

if (process.platform === "darwin") {
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
  const specs = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of specs) {
    run("sips", [
      "-z",
      String(size),
      String(size),
      path.join(buildDir, "icon.png"),
      "--out",
      path.join(iconsetDir, name),
    ]);
  }
  try {
    run("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(buildDir, "icon.icns")]);
  } catch {
    writeIcnsFallback();
  }
}

console.log("Privai icons generated");
