// Tests the colour model: readable text everywhere, quiet when healthy,
// loud when low, charging distinct, no muddy mid-tones. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const C = require("../extension/theme-colors.js");

const state = (percentage, kind = "battery", dark = true) => ({
  has_battery: true,
  percentage,
  on_ac: kind !== "battery",
  charging: kind === "charging",
  charged: false,
  dark,
});

const TEXT_PAIRS = [
  ["tab_text", "tab_selected"],
  ["tab_background_text", "frame"],
  ["tab_background_text", "frame_inactive"],
  ["toolbar_text", "toolbar"],
  ["toolbar_field_text", "toolbar_field"],
  ["toolbar_field_text_focus", "toolbar_field_focus"],
  ["popup_text", "popup"],
  ["popup_highlight_text", "popup_highlight"],
  ["sidebar_text", "sidebar"],
  ["ntp_text", "ntp_background"],
];

const lch = (rgb) => {
  const [L, a, b] = C.rgbToOklab(rgb);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
};
const distance = (x, y) => {
  const A = C.rgbToOklab(x), B = C.rgbToOklab(y);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

test("every text colour meets WCAG AA on its surface, in every state", () => {
  let worst = { ratio: Infinity };
  for (const palette of Object.keys(C.PALETTES)) {
    for (const intensity of [0.5, 1, 1.5, 2]) {
      for (const dark of [true, false]) {
        for (const kind of ["battery", "ac", "charging"]) {
          for (let p = 0; p <= 100; p++) {
            const { raw } = C.buildTheme(state(p, kind, dark), { palette, intensity });
            for (const [fg, bg] of TEXT_PAIRS) {
              const ratio = C.contrast(raw[fg], raw[bg]);
              if (ratio < worst.ratio) worst = { ratio, fg, bg, palette, intensity, dark, kind, p };
            }
          }
        }
      }
    }
  }
  assert.ok(worst.ratio >= C.MIN_CONTRAST, `worst contrast ${worst.ratio.toFixed(2)}: ${JSON.stringify(worst)}`);
});

test("theme output is well-formed", () => {
  const { theme } = C.buildTheme(state(42), null);
  for (const [key, value] of Object.entries(theme.colors)) {
    assert.match(value, /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/, key);
  }
  assert.strictEqual(theme.properties.color_scheme, "dark");
  assert.strictEqual(C.buildTheme(state(42, "battery", false), null).theme.properties.color_scheme, "light");
});

test("quiet when healthy, loud when low (both palettes, both modes)", () => {
  for (const palette of Object.keys(C.PALETTES)) {
    for (const dark of [true, false]) {
      const neutral = C.buildTheme(state(100, "ac", dark), { palette, intensity: 0 }).raw;
      const tint = (p, key) => distance(C.buildTheme(state(p, "battery", dark), { palette }).raw[key], neutral[key]);
      const label = `${palette}/${dark ? "dark" : "light"}`;
      // Healthy: strip barely tinted, toolbar untouched.
      assert.ok(tint(80, "frame") < 0.06, `${label}: strip should be near-neutral at 80%`);
      assert.strictEqual(tint(80, "toolbar"), 0, `${label}: toolbar neutral at 80%`);
      // Low: much more tint, on more surfaces.
      assert.ok(tint(10, "frame") > 3 * tint(80, "frame"), `${label}: strip much louder at 10%`);
      assert.ok(tint(10, "toolbar") > 0.02, `${label}: toolbar tinted at 10%`);
      assert.ok(tint(10, "tab_selected") > 0.15, `${label}: active tab is a strong card at 10%`);
      // Through the escalation zone (50% and below) the strip only ever
      // gets more colourful as the battery drains.
      let prev = -1;
      for (let p = 50; p >= 0; p--) {
        const chroma = lch(C.buildTheme(state(p, "battery", dark), { palette }).raw.frame).C;
        assert.ok(chroma >= prev - 0.002, `${label}: strip got less colourful at ${p}%`);
        prev = chroma;
      }
    }
  }
});

test("classic palette: green when full, red when critical, clean amber in between", () => {
  const s = C.normalizeSettings(null);
  const at = (p) => lch(C.accentRgb(state(p), s));
  assert.ok(at(100).h > 135 && at(100).h < 160, "green at 100%");
  assert.ok(at(5).h > 15 && at(5).h < 40, "red at 5%");
  assert.ok(at(35).h > 75 && at(35).h < 100, "amber at 35%");
  for (let p = 0; p <= 100; p++) assert.ok(at(p).C > 0.13, `accent is muddy at ${p}%`);
});

test("charging has its own hue, far from every on-battery colour", () => {
  for (const palette of Object.keys(C.PALETTES)) {
    const s = C.normalizeSettings({ palette });
    const charging = lch(C.accentRgb(state(50, "charging"), s));
    for (let p = 0; p <= 100; p++) {
      const battery = lch(C.accentRgb(state(p), s));
      const dh = Math.abs(((charging.h - battery.h + 540) % 360) - 180);
      assert.ok(dh > 60 || battery.C < 0.06, `${palette}: charging too close to ${p}% (hue gap ${dh.toFixed(0)})`);
    }
  }
});

test("colour-blind palette stays on the blue/orange axis", () => {
  const s = C.normalizeSettings({ palette: "cvd" });
  for (let p = 0; p <= 100; p++) {
    const a = lch(C.accentRgb(state(p), s));
    assert.ok(a.C < 0.06 || (a.h > 35 && a.h < 95), `unexpected hue ${a.h.toFixed(0)} at ${p}%`);
  }
  const blue = lch(C.accentRgb(state(50, "charging"), s));
  assert.ok(blue.h > 220 && blue.h < 270);
});

test("theme key: stable while plugged in, steps while draining, reacts to mode and settings", () => {
  assert.strictEqual(C.themeKey(state(40, "charging"), null), C.themeKey(state(90, "charging"), null));
  assert.strictEqual(C.themeKey(state(70), null), C.themeKey(state(70.4), null));
  assert.notStrictEqual(C.themeKey(state(70), null), C.themeKey(state(64), null));
  assert.notStrictEqual(C.themeKey(state(70), null), C.themeKey(state(70, "charging"), null));
  assert.notStrictEqual(C.themeKey(state(70), null), C.themeKey(state(70, "battery", false), null));
  assert.notStrictEqual(C.themeKey(state(70), null), C.themeKey(state(70), { palette: "cvd" }));
});

test("appearance setting overrides the OS; unknown OS appearance means dark", () => {
  assert.strictEqual(C.buildTheme(state(50, "battery", false), { appearance: "dark" }).dark, true);
  assert.strictEqual(C.buildTheme(state(50, "battery", true), { appearance: "light" }).dark, false);
  assert.strictEqual(C.buildTheme({ ...state(50), dark: null }, null).dark, true);
});

test("status wording", () => {
  const d = (extra) => C.describeState({ ...state(50), ...extra });
  assert.deepStrictEqual(d({ minutes_remaining: 192 }), { status: "On battery", time: "3h 12m left" });
  assert.deepStrictEqual(d({ on_ac: true, charging: true, minutes_remaining: 45 }), { status: "Charging", time: "45m until full" });
  assert.deepStrictEqual(d({ on_ac: true, charged: true, minutes_remaining: null }), { status: "Fully charged", time: null });
  assert.deepStrictEqual(d({ on_ac: true }), { status: "Plugged in, not charging", time: null });
});

test("settings are normalized", () => {
  assert.deepStrictEqual(C.normalizeSettings({ palette: "nope", intensity: 99, appearance: 3, badge: "yes" }), {
    palette: "classic", intensity: 2, appearance: "auto", badge: false,
  });
  assert.strictEqual(C.normalizeSettings({ badge: true }).badge, true);
});
