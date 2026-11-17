// Battery Theme — colour model (pure functions, no browser APIs).
//
// Loaded by the background page (as globalThis.BatteryColors) and by the
// Node tests / preview page, so everything here must stay side-effect free.
//
// Design rules:
//   1. Two styles. "vivid" (default) shows the battery colour at every
//      level: a coloured gauge in the tab strip and a solid battery-coloured
//      active tab. "subtle" stays close to neutral above ~50% and only shows
//      the colour on thin elements until the battery gets low.
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
    gauge: true,         // fill the tab strip only up to the battery level
    style: "vivid",      // "vivid" (colour at every level) | "subtle" (near-neutral while healthy)
    motion: true,        // flash the chrome once when the battery drops through 20% / 10%
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
  function separateFrom(surface, backdrops) {
    const tooClose = (c) => backdrops.some((b) => contrast(c, b) < MIN_TAB_SEPARATION);
    if (!tooClose(surface)) return surface;
    // Try lifting toward white and sinking toward black; keep whichever gets
    // clear of every backdrop in fewer steps (a mid-tone tab between a darker
    // and a lighter backdrop can only escape one way).
    let best = null;
    for (const target of [[255, 255, 255], [0, 0, 0]]) {
      let c = surface;
      let steps = 0;
      while (steps < 25 && tooClose(c)) {
        c = mix(c, target, 0.05);
        steps += 1;
      }
      if (!tooClose(c) && (!best || steps < best.steps)) best = { c, steps };
    }
    return best ? best.c : surface;
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
    out.gauge = out.gauge !== false;
    if (!["vivid", "subtle"].includes(out.style)) out.style = DEFAULT_SETTINGS.style;
    out.motion = out.motion !== false;
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

  // -------------------------------------------------------------------------
  // Gauge
  // -------------------------------------------------------------------------
  // The tab strip is tinted with the battery colour, and a "cover" image
  // paints the neutral strip colour over the part to the right of the charge
  // level, so the tinted part reads as a gauge. Firefox only accepts theme
  // images that ship inside the extension, so there is one small SVG per
  // level and appearance (extension/gauge/, generated by tools/build-gauge.js
  // from gaugeSvg below). The SVGs have no intrinsic size and use percentages,
  // so they follow the window width on their own.
  const GAUGE_MIN_TINT = 0.2; // the filled part must be visible even when healthy
  const GAUGE_GLOW_PX = 26;   // brightening toward the leading edge
  const GAUGE_EDGE_PX = 2;    // the leading edge itself
  const GAUGE_CELLS = 10;     // the fill is cut into battery cells
  // Part of every file name. Firefox keeps theme images cached across an
  // extension update, so bump this whenever gaugeSvg changes what it draws.
  const GAUGE_REV = "r2";
  const PULSE_AT = [20, 10];  // flash once when the battery drops through these

  const quantize = (percentage) =>
    Math.max(0, Math.min(100, Math.round(percentage / THEME_STEP) * THEME_STEP));

  function gaugeLevels() {
    const out = [];
    for (let p = 0; p <= 100; p += THEME_STEP) out.push(p);
    return out;
  }

  function gaugeFile(dark, level) {
    return `gauge/${GAUGE_REV}-${dark ? "dark" : "light"}-${level}.svg`;
  }

  // Layers, back to front: glow + leading edge, the cover over the empty
  // part, then the cell dividers (gaps in the filled part, faint ghost lines
  // in the empty part so the scale stays readable).
  // The images are static on purpose: Firefox 160 does not run SVG
  // animations in theme images (tried a charging sweep; it froze).
  function gaugeSvg(dark, level) {
    const B = BASES[dark ? "dark" : "light"];
    const empty = css(B.frame);
    const ink = dark ? "#fff" : "#000";
    const glow = dark ? 0.2 : 0.12;
    const edge = dark ? 0.6 : 0.4;
    let out =
      `<svg xmlns="http://www.w3.org/2000/svg"><defs>` +
      `<linearGradient id="g"><stop offset="0" stop-color="${ink}" stop-opacity="0"/>` +
      `<stop offset="1" stop-color="${ink}" stop-opacity="${glow}"/></linearGradient></defs>`;
    out += `<svg x="${level}%" overflow="visible">`;
    if (level > 0) {
      out +=
        `<rect x="-${GAUGE_GLOW_PX}" width="${GAUGE_GLOW_PX}" height="100%" fill="url(#g)"/>` +
        `<rect x="-${GAUGE_EDGE_PX}" width="${GAUGE_EDGE_PX}" height="100%" fill="${ink}" fill-opacity="${edge}"/>`;
    }
    out += `<rect width="100%" height="100%" fill="${empty}"/></svg>`;
    for (let i = 1; i < GAUGE_CELLS; i++) {
      const at = (100 / GAUGE_CELLS) * i;
      if (at < level) out += `<rect x="${at}%" width="2" height="100%" fill="${empty}"/>`;
      else if (at > level) out += `<rect x="${at}%" width="1" height="100%" fill="${css(B.line)}"/>`;
    }
    return out + `</svg>\n`;
  }

  // True when a drain from `before` to `after` percent passes a flash point.
  function crossesPulse(before, after) {
    return PULSE_AT.some((t) => before > t && after <= t);
  }

  // Two states with the same key paint the same theme.
  function themeKey(state, rawSettings) {
    const settings = normalizeSettings(rawSettings);
    const kind = powerKind(state);
    // While plugged in the level does not affect the colours, only the gauge.
    const level = kind === "battery" || settings.gauge ? quantize(state.percentage) : "-";
    return [
      settings.palette, settings.intensity, isDark(state, settings) ? "d" : "l", kind, level,
      settings.gauge ? "g" : "n", settings.style,
    ].join(":");
  }

  // Returns { colors, raw } where `colors` is ready for browser.theme.update
  // and `raw` holds the same values as [r, g, b] (for tests and the icon).
  // `opts.pulse` builds the brighter frame shown for a moment when the
  // battery drops through a flash point.
  function buildTheme(state, rawSettings, opts) {
    const pulse = !!(opts && opts.pulse);
    const settings = normalizeSettings(rawSettings);
    const dark = isDark(state, settings);
    const B = BASES[dark ? "dark" : "light"];
    const kind = powerKind(state);
    const u = urgency(state);
    const k = settings.intensity;
    const accent = accentRgb(state, settings);

    // How much accent each surface takes.
    //   subtle: healthy = a whisper on the strip only; critical = strip,
    //           toolbar, active tab and new-tab page all tinted.
    //   vivid:  the strip and active tab carry the colour at every level,
    //           and urgency adds to it.
    const charging = kind === "charging";
    const vivid = settings.style === "vivid";
    // Capped so the strip never becomes a mid-tone that no text can sit on.
    let tFrame, tToolbar, tTab, tNtp, tSidebar;
    if (vivid) {
      tFrame = Math.min(0.5, (charging ? 0.34 : 0.3 + 0.16 * u) * k);
      tToolbar = clamp01((0.05 + 0.16 * Math.pow(u, 1.5)) * k);
      tTab = clamp01(0.55 + 0.25 * k + 0.3 * u);
      tNtp = clamp01((0.05 + 0.1 * u) * k);
      tSidebar = clamp01((0.1 + 0.1 * u) * k);
    } else {
      tFrame = Math.min(0.5, (charging ? 0.12 : 0.07 + 0.33 * u) * k);
      tToolbar = clamp01(0.16 * Math.pow(u, 1.5) * k);
      tTab = clamp01((charging ? 0.24 : 0.14) * k + 0.86 * Math.pow(u, 1.2));
      tNtp = clamp01(0.1 * u * k);
      tSidebar = tToolbar * 0.5;
    }
    if (settings.gauge) tFrame = Math.max(tFrame, Math.min(0.5, GAUGE_MIN_TINT * k));
    if (pulse) {
      tFrame = Math.min(0.75, tFrame + 0.25);
      tToolbar = clamp01(tToolbar + 0.2);
    }
    const tBorder = clamp01(0.3 + 0.7 * u + (charging ? 0.25 : 0));
    // The line under the toolbar carries the colour too (it is all that
    // shows the state when tabs are vertical).
    const tLine = vivid ? 0.7 : 0;

    const frame = mix(B.frame, accent, tFrame);
    const frameInactive = mix(frame, B.dim, 0.35);
    const toolbar = mix(B.toolbar, accent, tToolbar);
    // With the gauge on, part of the strip shows the neutral colour instead.
    const stripColours = settings.gauge ? [frame, B.frame] : [frame];
    const tab = readableSurface(separateFrom(mix(toolbar, accent, tTab), stripColours), B.text);
    const tabSelected = tab.bg;
    const popup = B.toolbar;
    const highlight = readableSurface(mix(B.toolbar, accent, 0.3), B.text);
    const popupHighlight = highlight.bg;
    const sidebar = mix(B.frame, accent, tSidebar);
    const ntp = mix(B.deep, accent, tNtp);
    const ntpCard = mix(dark ? B.frame : B.field, accent, tNtp * 0.6);

    // Inactive-tab text has to be readable on both the focused and the
    // unfocused strip: take the first candidate that clears both, else the
    // one with the best worst-case.
    const stripBackdrops = settings.gauge
      ? [frame, frameInactive, B.frame, mix(B.frame, B.dim, 0.35)]
      : [frame, frameInactive];
    const worstOnStrip = (c) => Math.min(...stripBackdrops.map((b) => contrast(c, b)));
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
      toolbar_bottom_separator: mix(B.line, accent, tLine),
      toolbar_vertical_separator: B.line,
      popup,
      popup_border: B.line,
      popup_text: B.text,
      popup_highlight: popupHighlight,
      popup_highlight_text: highlight.text,
      sidebar,
      sidebar_text: textOn(sidebar, B.text),
      sidebar_border: mix(B.line, accent, tLine * 0.6),
      ntp_background: ntp,
      ntp_card_background: ntpCard,
      ntp_text: textOn(ntp, B.text),
    };

    const colors = {};
    for (const key of Object.keys(raw)) colors[key] = css(raw[key]);

    const theme = { colors, properties: { color_scheme: dark ? "dark" : "light" } };
    let gauge = null;
    if (settings.gauge) {
      gauge = { level: quantize(state.percentage), empty: B.frame };
      theme.images = { additional_backgrounds: [gaugeFile(dark, gauge.level)] };
      theme.properties.additional_backgrounds_alignment = ["left top"];
      theme.properties.additional_backgrounds_tiling = ["no-repeat"];
    }

    return { theme, raw, dark, accent, gauge };
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
    gaugeLevels,
    gaugeFile,
    gaugeSvg,
    crossesPulse,
    themeKey,
    buildTheme,
    contrast,
    mix,
    rgbToOklab,
    oklchToRgb,
    css,
  };
});
