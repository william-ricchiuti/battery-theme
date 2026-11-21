// Builds the store zip with web-ext and checks that it holds exactly the
// files in extension/ (nothing missing, nothing extra), that it stays small,
// and that every gauge image the colour model can ask for is inside.
//   npm run check:zip
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const C = require("../extension/theme-colors.js");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const MAX_BYTES = 120 * 1024; // budget; 1.9.0 is about half of this

// Names in a zip, read from its central directory (no unzip tool needed).
function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.subarray(off + 46, off + 46 + nameLen).toString("utf8"));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

const out = fs.mkdtempSync(path.join(os.tmpdir(), "bt-zip-"));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["--yes", "web-ext@8", "build", "--source-dir", EXT, "--artifacts-dir", out, "--overwrite-dest"],
  { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
const zip = fs.readdirSync(out).find((f) => f.endsWith(".zip"));
const buf = fs.readFileSync(path.join(out, zip));
const inZip = zipEntries(buf).filter((n) => !n.endsWith("/")).sort();
const onDisk = walk(EXT).map((f) => path.relative(EXT, f).split(path.sep).join("/")).sort();

const problems = [];
for (const f of onDisk) if (!inZip.includes(f)) problems.push(`missing from the zip: ${f}`);
for (const f of inZip) if (!onDisk.includes(f)) problems.push(`unexpected in the zip: ${f}`);
for (const dark of [true, false]) for (const rtl of [true, false]) for (const level of C.gaugeLevels()) {
  const f = C.gaugeFile(dark, level, rtl).split("#")[0];
  if (!inZip.includes(f)) problems.push(`gauge image not shipped: ${f}`);
}
const version = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).version;
if (!zip.includes(version)) problems.push(`zip name ${zip} does not carry version ${version}`);
if (buf.length > MAX_BYTES) problems.push(`zip is ${buf.length} bytes, over the ${MAX_BYTES} byte budget`);

fs.rmSync(out, { recursive: true, force: true });
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${zip}: ${inZip.length} files, ${buf.length} bytes. Matches extension/ exactly.`);
