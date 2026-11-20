// Generates the gauge cover images in extension/gauge/ from the colour model.
// Firefox only accepts theme images that ship inside the extension, so these
// are committed. Re-run after changing the strip colours or THEME_STEP:
//   npm run gauge
const fs = require("node:fs");
const path = require("node:path");
const C = require("../extension/theme-colors.js");

const dir = path.join(__dirname, "..", "extension", "gauge");
fs.mkdirSync(dir, { recursive: true });
const wanted = new Set();
for (const level of C.gaugeLevels()) {
  const file = C.gaugeFile(true, level); // dark is the plain file name; the other variants are fragments of it
  wanted.add(path.basename(file));
  fs.writeFileSync(path.join(__dirname, "..", "extension", file), C.gaugeSvg(level));
}
for (const f of fs.readdirSync(dir)) {
  if (!wanted.has(f)) fs.unlinkSync(path.join(dir, f));
}
console.log(`Wrote ${wanted.size} gauge images to extension/gauge/`);
