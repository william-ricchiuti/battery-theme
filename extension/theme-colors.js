// Battery Theme — colour model (pure functions, no browser APIs).
//
// Loaded by the background page (as globalThis.BatteryColors) and by the
// Node tests / preview page, so everything here must stay side-effect free.
//
// Design rules:
//   1. Quiet when healthy. Above ~50% the chrome is close to neutral and the
//      battery colour only shows on thin elements.
//   2. Escalate with urgency. As the battery drops, BOTH the hue and the
//      amount of tinted surface grow, so 15% is unmistakable even if you
//      cannot tell red from green.
//   3. Charging has its own hue (blue), so "plugged in" never looks like
//      "full".
//   4. Colours are defined and blended in OKLCH/OKLab so mid-tones stay clean
//      (no muddy olive between green and red).
//   5. Text colours are chosen by measured WCAG contrast, never by guess.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BatteryColors = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  const DEFAULT_SETTINGS = {
    palette: "classic",  // "classic" (green→amber→red) | "cvd" (neutral→orange, colour-blind safe)
    intensity: 1,        // 0.5 = subtler, 1.5 = stronger tinting
    appearance: "auto",  // "auto" (follow the OS) | "dark" | "light"
    badge: false,        // show the percentage as a badge on the toolbar button
    enabled: true,       // false = leave the browser theme alone (button and popup keep working)
  };

  // Accent stops per palette: [percentage, L, C, h] in OKLCH, tuned for dark
  // chrome. `charging` is [L, C, h].
  const PALETTES = {
    classic: {
      battery: [
        [100, 0.80, 0.17, 150], // green
        [60, 0.82, 0.17, 140],
        [35, 0.84, 0.16, 88],   // amber
        [20, 0.76, 0.17, 55],   // orange
        [10, 0.66, 0.21, 29],   // red
        [0, 0.63, 0.23, 27],
      ],
      charging: [0.78, 0.13, 235], // blue
    },
    cvd: {
      battery: [
        [100, 0.80, 0.03, 70],  // near-neutral
        [50, 0.80, 0.04, 70],
        [30, 0.80, 0.13, 70],   // orange grows in
        [10, 0.74, 0.18, 55],
        [0, 0.70, 0.19, 45],
      ],
      charging: [0.76, 0.13, 250], // blue
    },
  };

  // Neutral surfaces. All sRGB 0-255.
  const BASES = {
    dark: {
      deep: [16, 16, 20],       // new-tab page
      frame: [22, 22, 27],      // tab strip
      toolbar: [28, 28, 34],    // toolbar, popups
      field: [16, 16, 20],      // url bar
      dim: [16, 16, 20],        // what the strip fades toward when unfocused
      line: [46, 46, 56],       // separators
      text: [232, 232, 236],
      muted: [163, 163, 172],
      icon: [169, 169, 178],
    },
    light: {
      deep: [249, 249, 251],
      frame: [220, 220, 227],
      toolbar: [246, 246, 248],
      field: [255, 255, 255],
      dim: [240, 240, 244],
      line: [201, 201, 210],
      text: [21, 20, 26],
      muted: [85, 85, 95],
      icon: [91, 91, 102],
    },
  };

  const INK_DARK = [12, 12, 16];
  const INK_LIGHT = [255, 255, 255];
  const MIN_CONTRAST = 4.5; // WCAG AA for normal text

  // -------------------------------------------------------------------------
  // Colour math
  // -------------------------------------------------------------------------
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const smoothstep = (t) => {
    t = clamp01(t);
    return t * t * (3 - 2 * t);
  };

  const toLinear = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

  function rgbToOklab(c) {
    const r = toLinear(c[0]), g = toLinear(c[1]), b = toLinear(c[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  // Returns linear-light sRGB, possibly out of the 0..1 gamut.
  function oklabToLinear(lab) {
    const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  const inGamut = (lin) => lin.every((v) => v >= -0.0005 && v <= 1.0005);

  function oklabToRgb(lab) {
    return oklabToLinear(lab).map((v) => Math.round(clamp01(fromLinear(clamp01(v))) * 255));
  }

  // OKLCH -> sRGB, reducing chroma (never hue or lightness) to fit the gamut.
  function oklchToRgb(L, C, h) {
    const rad = (h * Math.PI) / 180;
    const at = (c) => [L, c * Math.cos(rad), c * Math.sin(rad)];
    if (inGamut(oklabToLinear(at(C)))) return oklabToRgb(at(C));
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(at(mid)))) lo = mid;
      else hi = mid;
    }
    return oklabToRgb(at(lo));
  }

  // Perceptual blend: a toward b by t.
  function mix(a, b, t) {
    t = clamp01(t);
    const A = rgbToOklab(a), B = rgbToOklab(b);
    return oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  }

  function relativeLuminance(c) {
    return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
  }

  function contrast(a, b) {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Use `preferred` if it is readable on `bg`, otherwise the stronger ink.
  function textOn(bg, preferred) {
    if (preferred && contrast(preferred, bg) >= MIN_CONTRAST) return preferred;
    return contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT;
  }

  // Some mid-tones (a saturated orange, say) are readable with neither ink.
  // Nudge such a surface lighter or darker, away from its text, until it is.
  function readableSurface(bg, preferred) {
    let text = textOn(bg, preferred);
    const away = text === INK_LIGHT || relativeLuminance(text) > relativeLuminance(bg) ? [0, 0, 0] : [255, 255, 255];
    for (let i = 0; i < 20 && contrast(text, bg) < MIN_CONTRAST; i++) {
      bg = mix(bg, away, 0.04);
      text = textOn(bg, text);
    }
    return { bg, text };
  }

  // Firefox draws no shadow under the selected tab, so it has to stand out
  // from the strip by lightness. If it does not, lift it toward white.
  const MIN_TAB_SEPARATION = 1.25;
  function separateFrom(surface, backdrop) {
    for (let i = 0; i < 25 && contrast(surface, backdrop) < MIN_TAB_SEPARATION; i++) {
      surface = mix(surface, [255, 255, 255], 0.05);
    }
    return surface;
  }

  const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

  // -------------------------------------------------------------------------
  // Model
  // -------------------------------------------------------------------------
  function normalizeSettings(s) {
    const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
    if (!PALETTES[out.palette]) out.palette = DEFAULT_SETTINGS.palette;
    if (!["auto", "dark", "light"].includes(out.appearance)) out.appearance = "auto";
    out.intensity = Number.isFinite(out.intensity) ? Math.max(0, Math.min(2, out.intensity)) : 1;
    out.badge = out.badge === true;
    out.enabled = out.enabled !== false;
    return out;
  }

  // "charging" | "ac" (plugged in, full or held) | "battery"
  function powerKind(state) {
    if (state.charging) return "charging";
    if (state.on_ac) return "ac";
    return "battery";
  }

  function isDark(state, settings) {
    if (settings.appearance === "dark") return true;
    if (settings.appearance === "light") return false;
    return state.dark !== false; // unknown -> dark
  }

  // 0 while healthy (>= 50%) or plugged in, rising smoothly to 1 at <= 10%.
  function urgency(state) {
    if (powerKind(state) !== "battery") return 0;
    return smoothstep((50 - state.percentage) / 40);
  }

  function interpolateStops(stops, p) {
    if (p >= stops[0][0]) return stops[0].slice(1);
    for (let i = 1; i < stops.length; i++) {
      const hi = stops[i - 1], lo = stops[i];
      if (p >= lo[0]) {
        const t = (hi[0] - p) / (hi[0] - lo[0]);
        return [1, 2, 3].map((k) => hi[k] + (lo[k] - hi[k]) * t);
      }
    }
    return stops[stops.length - 1].slice(1);
  }

  // The vivid battery colour as [L, C, h].
  function accentLch(state, settings) {
    const palette = PALETTES[settings.palette];
    const kind = powerKind(state);
    if (kind === "charging") return palette.charging.slice();
    // Plugged in but not charging (full, or held at 80%): show "healthy".
    return interpolateStops(palette.battery, kind === "ac" ? 100 : state.percentage);
  }

  // Vivid accent as sRGB. On light chrome it is darkened so thin lines and
  // borders stay visible against white.
  function accentRgb(state, settings) {
    const [L, C, h] = accentLch(state, settings);
    return isDark(state, settings) ? oklchToRgb(L, C, h) : oklchToRgb(L * 0.78, C * 1.05, h);
  }

  // -------------------------------------------------------------------------
  // Wording (shared by the toolbar tooltip and the popup)
  // -------------------------------------------------------------------------
  function formatMinutes(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }

  // { status: "On battery", time: "3h 12m left" | null }
  function describeState(state) {
    let status = "On battery";
    if (state.charged) status = "Fully charged";
    else if (state.charging) status = "Charging";
    else if (state.on_ac) status = "Plugged in, not charging";
    let time = null;
    if (typeof state.minutes_remaining === "number") {
      time = `${formatMinutes(state.minutes_remaining)} ${state.charging ? "until full" : "left"}`;
    }
    return { status, time };
  }

  const THEME_STEP = 2; // repaint the theme at most every N percentage points

  // Two states with the same key paint the same theme.
  function themeKey(state, rawSettings) {
    const settings = normalizeSettings(rawSettings);
    const kind = powerKind(state);
    // While plugged in the level does not affect the colours at all.
    const level = kind === "battery" ? Math.round(state.percentage / THEME_STEP) * THEME_STEP : "-";
    return [settings.palette, settings.intensity, isDark(state, settings) ? "d" : "l", kind, level].join(":");
  }

  // Returns { colors, raw } where `colors` is ready for browser.theme.update
  // and `raw` holds the same values as [r, g, b] (for tests and the icon).
  function buildTheme(state, rawSettings) {
    const settings = normalizeSettings(rawSettings);
    const dark = isDark(state, settings);
    const B = BASES[dark ? "dark" : "light"];
    const kind = powerKind(state);
    const u = urgency(state);
    const k = settings.intensity;
    const accent = accentRgb(state, settings);

    // How much accent each surface takes. Healthy = a whisper on the strip
    // only; critical = strip, toolbar, active tab and new-tab page all tinted.
    const charging = kind === "charging";
    // Capped so the strip never becomes a mid-tone that no text can sit on.
    const tFrame = Math.min(0.5, (charging ? 0.12 : 0.07 + 0.33 * u) * k);
    const tToolbar = clamp01(0.16 * Math.pow(u, 1.5) * k);
    const tTab = clamp01((charging ? 0.24 : 0.14) * k + 0.86 * Math.pow(u, 1.2));
    const tBorder = clamp01(0.3 + 0.7 * u + (charging ? 0.25 : 0));

    const frame = mix(B.frame, accent, tFrame);
    const frameInactive = mix(frame, B.dim, 0.35);
    const toolbar = mix(B.toolbar, accent, tToolbar);
    const tab = readableSurface(separateFrom(mix(toolbar, accent, tTab), frame), B.text);
    const tabSelected = tab.bg;
    const popup = B.toolbar;
    const highlight = readableSurface(mix(B.toolbar, accent, 0.3), B.text);
    const popupHighlight = highlight.bg;
    const sidebar = mix(B.frame, accent, tToolbar * 0.5);
    const ntp = mix(B.deep, accent, clamp01(0.1 * u * k));

    // Inactive-tab text has to be readable on both the focused and the
    // unfocused strip: take the first candidate that clears both, else the
    // one with the best worst-case.
    const worstOnStrip = (c) => Math.min(contrast(c, frame), contrast(c, frameInactive));
    const stripCandidates = [B.muted, B.text, INK_DARK, INK_LIGHT];
    const tabBackgroundText =
      stripCandidates.find((c) => worstOnStrip(c) >= MIN_CONTRAST) ||
      stripCandidates.reduce((best, c) => (worstOnStrip(c) > worstOnStrip(best) ? c : best));

    const raw = {
      frame,
      frame_inactive: frameInactive,
      tab_selected: tabSelected,
      tab_text: tab.text,
      tab_background_text: tabBackgroundText,
      tab_line: accent,
      icons: B.icon,
      icons_attention: accent,
      toolbar,
      toolbar_text: textOn(toolbar, B.text),
      toolbar_field: B.field,
      toolbar_field_text: B.text,
      toolbar_field_border: mix(B.line, accent, tBorder),
      toolbar_field_focus: B.field,
      toolbar_field_text_focus: B.text,
      toolbar_field_border_focus: accent,
      toolbar_top_separator: B.line,
      toolbar_bottom_separator: B.line,
      toolbar_vertical_separator: B.line,
      popup,
      popup_border: B.line,
      popup_text: B.text,
      popup_highlight: popupHighlight,
      popup_highlight_text: highlight.text,
      sidebar,
      sidebar_text: textOn(sidebar, B.text),
      ntp_background: ntp,
      ntp_card_background: dark ? B.frame : B.field,
      ntp_text: textOn(ntp, B.text),
    };

    const colors = {};
    for (const key of Object.keys(raw)) colors[key] = css(raw[key]);

    return {
      theme: { colors, properties: { color_scheme: dark ? "dark" : "light" } },
      raw,
      dark,
      accent,
    };
  }

  return {
    DEFAULT_SETTINGS,
    PALETTES,
    MIN_CONTRAST,
    MIN_TAB_SEPARATION,
    normalizeSettings,
    powerKind,
    isDark,
    urgency,
    accentLch,
    accentRgb,
    describeState,
    themeKey,
    buildTheme,
    contrast,
    mix,
    rgbToOklab,
    oklchToRgb,
    css,
  };
});
