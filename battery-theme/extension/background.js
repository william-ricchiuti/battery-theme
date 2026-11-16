// Battery Theme — background script
//
// Reads battery state from the native messaging host and recolors Firefox
// via browser.theme.update(). Designed for Firefox 157+ (Nova) where:
//   - the selected tab has no drop shadow (must contrast via color),
//   - tab_background_separator was removed in FF89,
//   - tab_loading / sidebar_highlight* have no visible effect.
//
// Performance: theme.update() is only called when the (quantized) color
// actually changes, and the icon/badge only when the reading changes, so
// a battery that stays at 78% for an hour costs zero extra repaints.

const HOST_NAME = "com.williamricchiuti.batterytheme";

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------
const FRAME_TINT = 0.18;   // how much battery color bleeds into the tab strip (0..1)
const FRAME_DESAT = 0.25;  // desaturate the strip tint so mid-tones stay clean
const THEME_STEP = 2;      // repaint the theme at most every N percent points

// Battery gradient endpoints (tailwind-calibrated for a cleaner look).
const CHARGING_GREEN = [34, 197, 94];  // green-500 — static, calm
const CHARGED_GREEN = [74, 222, 128];  // green-400 — 100%
const MID_YELLOW = [251, 191, 36];     // amber-400 — 50%
const CRITICAL_RED = [239, 68, 68];    // red-500 — 0%

// Cohesive dark base ramp.
const BASE = {
  deep: [16, 16, 20],      // #101014 — deepest (ntp, url field)
  low: [22, 22, 27],       // #16161b — frame base, sidebar
  mid: [28, 28, 34],       // #1c1c22 — toolbar, popup
  line: [46, 46, 56],      // #2e2e38 — separators / borders
  text: [232, 232, 236],   // #e8e8ec — primary text
  muted: [163, 163, 172],  // #a3a3ac — dimmed/inactive text
};

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------
function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function lerp(c1, c2, t) {
  t = clamp01(t);
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

// mix(c1, c2, t) -> c1 toward c2 by t (t = amount of c2).
function mix(c1, c2, t) {
  return lerp(c1, c2, t);
}

function css(c) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// Pull a color toward its own gray (luma) so tints stay moody, not neon.
function desaturate(c, amount) {
  const g = luminance(c);
  return lerp(c, [g, g, g], amount);
}

// green -> yellow for 100..50, yellow -> red for 49..0, static green charging.
function batteryColor(percentage, isCharging) {
  if (isCharging) return CHARGING_GREEN;
  if (percentage >= 50) return lerp(CHARGED_GREEN, MID_YELLOW, (100 - percentage) / 50);
  return lerp(MID_YELLOW, CRITICAL_RED, (49 - percentage) / 49);
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(percentage, isCharging) {
  const accent = batteryColor(percentage, isCharging);
  const strip = mix(BASE.low, desaturate(accent, FRAME_DESAT), FRAME_TINT); // dark, desaturated battery tint
  const stripInactive = mix(strip, BASE.deep, 0.4);         // slightly darker when unfocused
  const accentSoft = mix(BASE.mid, accent, 0.45);           // subtle accent for url-bar border
  const accentLine = mix(accent, [255, 255, 255], 0.35);    // bright tint for selected-tab line
  const activeText = luminance(accent) > 150 ? [20, 20, 24] : [255, 255, 255];

  browser.theme.update({
    colors: {
      frame: css(strip),
      frame_inactive: css(stripInactive),
      tab_selected: css(accent),
      tab_background_text: css(BASE.muted),
      tab_text: css(activeText),
      tab_line: css(accentLine),
      icons: css([169, 169, 178]),
      icons_attention: css(accent),
      toolbar: css(BASE.mid),
      toolbar_text: css(BASE.text),
      toolbar_field: css(BASE.deep),
      toolbar_field_text: css(BASE.text),
      toolbar_field_border: css(accentSoft),
      toolbar_field_focus: css(BASE.deep),
      toolbar_field_text_focus: "#ffffff",
      toolbar_field_border_focus: css(accent),
      toolbar_top_separator: css(BASE.line),
      toolbar_bottom_separator: css(BASE.line),
      toolbar_vertical_separator: css(BASE.line),
      popup: css(BASE.mid),
      popup_border: css(BASE.line),
      popup_text: css(BASE.text),
      popup_highlight: css(accentSoft),
      popup_highlight_text: "#ffffff",
      sidebar: css(BASE.low),
      sidebar_text: css(BASE.text),
      ntp_background: css(BASE.deep),
      ntp_card_background: css(BASE.low),
      ntp_text: css(BASE.text),
    },
  });
}

// ---------------------------------------------------------------------------
// Toolbar icon + badge
// ---------------------------------------------------------------------------
function generateBatteryIcon(percentage, isCharging) {
  const fillColor = css(batteryColor(percentage, isCharging));
  const w = Math.max(1.6, (percentage / 100) * 9.6);
  const bolt = isCharging
    ? `<path d="M 9.6 1.6 L 5.2 8.8 L 8 8.8 L 6.4 14.4 L 11 7 L 8.2 7 Z" fill="#ffffff"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect x="1" y="4.5" width="11" height="7" rx="1.8" fill="none" stroke="#8f8f98" stroke-width="1.1"/>
  <rect x="12.3" y="6.6" width="1.5" height="2.8" rx="0.75" fill="#8f8f98"/>
  <rect x="2.2" y="5.7" width="${w}" height="4.6" rx="0.9" fill="${fillColor}"/>
  ${bolt}
</svg>`;

  return "data:image/svg+xml;base64," + btoa(svg);
}

function updateIcon(percentage, isCharging) {
  browser.action.setIcon({ path: generateBatteryIcon(percentage, isCharging) });
  browser.action.setBadgeText({ text: String(percentage) });
  browser.action.setBadgeBackgroundColor({ color: "#000000" });
  browser.action.setBadgeTextColor({ color: css(batteryColor(percentage, isCharging)) });
  browser.action.setTitle({
    title: `${percentage}% — ${isCharging ? "Charging" : "Discharging"}`,
  });
}

// ---------------------------------------------------------------------------
// State handling (change detection for low resource use)
// ---------------------------------------------------------------------------
let lastState = null;    // { percentage, isCharging } — skip work if unchanged
let lastThemeKey = null; // quantized key last painted to the theme

function handleBatteryUpdate(percentage, isCharging) {
  if (
    lastState &&
    lastState.percentage === percentage &&
    lastState.isCharging === isCharging
  ) {
    return; // nothing changed — no repaint, no icon work
  }
  lastState = { percentage, isCharging };

  // theme.update() forces a full chrome repaint, so quantize it and treat
  // charging-state flips as an immediate repaint (they change the color class).
  const q = Math.round(percentage / THEME_STEP) * THEME_STEP;
  const themeKey = `${q}:${isCharging}`;
  if (themeKey !== lastThemeKey) {
    lastThemeKey = themeKey;
    applyTheme(q, isCharging);
  }

  updateIcon(percentage, isCharging);
}

// ---------------------------------------------------------------------------
// Native messaging
// ---------------------------------------------------------------------------
applyTheme(80, false); // dark default before the first reading (no white flash)
lastThemeKey = "80:false";

function connect() {
  let port;
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch (err) {
    setTimeout(connect, 60000);
    return;
  }

  port.onMessage.addListener((msg) => {
    if (msg && typeof msg.percentage === "number" && typeof msg.is_charging === "boolean") {
      handleBatteryUpdate(msg.percentage, msg.is_charging);
    }
  });

  port.onDisconnect.addListener(() => {
    setTimeout(connect, 60000);
  });
}

connect();
