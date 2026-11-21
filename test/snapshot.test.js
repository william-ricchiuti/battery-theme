// Snapshot of the colour model: every colour handed to Firefox for a grid of
// representative states. A colour change that was not intended fails here.
// After an intended change, regenerate with:
//   UPDATE_SNAPSHOT=1 node --test test/snapshot.test.js
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../extension/theme-colors.js");

const FILE = path.join(__dirname, "fixtures", "theme-snapshot.json");

function snapshot() {
  const out = {};
  for (const dark of [true, false]) for (const palette of ["classic", "cvd"]) for (const style of ["vivid", "subtle"])
    for (const kind of ["battery", "charging", "ac"]) for (const p of [0, 5, 10, 20, 35, 50, 80, 100]) {
      for (const intensity of [1, 1.5]) {
        const state = { percentage: p, on_ac: kind !== "battery", charging: kind === "charging", dark };
        const { theme } = C.buildTheme(state, { palette, style, intensity });
        const key = `${dark ? "dark" : "light"}/${palette}/${style}/x${intensity}/${kind}/${p}`;
        // A short hash keeps the fixture small; the key says which state moved.
        out[key] = crypto.createHash("sha1").update(JSON.stringify(theme)).digest("hex").slice(0, 12);
      }
    }
  return out;
}

test("theme colours match the committed snapshot", () => {
  const now = snapshot();
  if (process.env.UPDATE_SNAPSHOT) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(now, null, 0).replace(/","/g, '",\n"') + "\n");
    return;
  }
  const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  assert.deepStrictEqual(Object.keys(now), Object.keys(saved), "same set of states");
  const changed = Object.keys(now).filter((k) => now[k] !== saved[k]);
  assert.deepStrictEqual(changed.slice(0, 10), [],
    `${changed.length} states changed colour. If intended: UPDATE_SNAPSHOT=1 node --test test/snapshot.test.js`);
});

test("the model is deterministic and total: any percentage and any settings give a valid theme", () => {
  // Cheap pseudo-random sweep with a fixed seed.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  for (let i = 0; i < 3000; i++) {
    const state = {
      percentage: Math.floor(rnd() * 101), on_ac: rnd() < 0.5, charging: rnd() < 0.3,
      dark: pick([true, false, null, undefined]),
    };
    const settings = {
      palette: pick(["classic", "cvd", "nonsense", undefined]), intensity: pick([0, 0.5, 1, 1.5, 2, -3, 99, NaN, "1"]),
      appearance: pick(["auto", "dark", "light", "x"]), style: pick(["vivid", "subtle", null]),
      gauge: pick([true, false, undefined]), motion: pick([true, false]),
    };
    const a = C.buildTheme(state, settings), b = C.buildTheme(state, settings);
    assert.deepStrictEqual(a.theme, b.theme);
    for (const [name, value] of Object.entries(a.theme.colors)) {
      assert.match(value, /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/, name);
      assert.ok(value.match(/\d+/g).every((n) => Number(n) <= 255), name);
    }
    assert.ok(C.contrast(a.raw.tab_text, a.raw.tab_selected) >= C.MIN_CONTRAST);
    assert.ok(C.contrast(a.raw.toolbar_text, a.raw.toolbar) >= C.MIN_CONTRAST);
  }
});
