// Property tests for colour-blind users: simulate the three common kinds of
// colour-vision deficiency (Machado, Oliveira & Fernandes 2009, full
// severity) and check that the states still look different from each other.
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const C = require("../extension/theme-colors.js");

const M = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const unlin = (v) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
const simulate = (c, m) => {
  const l = c.map(lin);
  return m.map((r) => unlin(r[0] * l[0] + r[1] * l[1] + r[2] * l[2]));
};
// Distance in OKLab; about 0.02 is a just-noticeable difference.
const distance = (a, b) => {
  const A = C.rgbToOklab(a), B = C.rgbToOklab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
const state = (percentage, kind, dark) => ({ percentage, on_ac: kind !== "battery", charging: kind === "charging", dark });

test("colour-blind palette: full, low and charging stay clearly apart under every simulated deficiency", () => {
  for (const [name, m] of Object.entries(M)) for (const dark of [true, false]) {
    const settings = C.normalizeSettings({ palette: "cvd" });
    const seen = (p, kind) => simulate(C.accentRgb(state(p, kind, dark), settings), m);
    const where = `${name}, ${dark ? "dark" : "light"}`;
    assert.ok(distance(seen(100, "battery"), seen(10, "battery")) >= 0.09, `full vs low: ${where}`);
    for (let p = 0; p <= 100; p += 5) {
      assert.ok(distance(seen(50, "charging"), seen(p, "battery")) >= 0.12, `charging vs ${p}%: ${where}`);
    }
  }
});

test("classic palette: full vs low survives red-green blindness (it also changes lightness and area)", () => {
  for (const name of ["protanopia", "deuteranopia"]) for (const dark of [true, false]) {
    const settings = C.normalizeSettings({ palette: "classic" });
    const seen = (p) => simulate(C.accentRgb(state(p, "battery", dark), settings), M[name]);
    assert.ok(distance(seen(100), seen(10)) >= 0.09, `${name}, ${dark ? "dark" : "light"}`);
  }
});

test("urgency is never colour alone: the tinted area grows as the battery drops, in both palettes", () => {
  for (const palette of ["classic", "cvd"]) for (const dark of [true, false]) for (const style of ["vivid", "subtle"]) {
    const B = C.buildTheme(state(100, "battery", dark), { palette, style }).raw;
    const low = C.buildTheme(state(8, "battery", dark), { palette, style }).raw;
    // At 8% the toolbar itself is visibly tinted; at 100% it is close to neutral.
    const neutral = C.buildTheme(state(100, "battery", dark), { palette, style, intensity: 0 }).raw.toolbar;
    assert.ok(distance(low.toolbar, neutral) > distance(B.toolbar, neutral) + 0.02, `${palette} ${style} dark=${dark}`);
  }
});
