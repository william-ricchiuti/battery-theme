// Battery Theme — background script
//
// Reads battery state from the native messaging host and recolors Firefox
// via browser.theme.update(). The background is an MV3 event page, so nothing
// here may rely on module globals or setTimeout surviving: reconnects are
// driven by an alarm, and the last painted state lives in storage.
//
// Designed for Firefox 157+ (Nova) where:
//   - the selected tab has no drop shadow (must contrast via color),
//   - tab_background_separator was removed in FF89,
//   - tab_loading / sidebar_highlight* have no visible effect.
//
// Performance: theme.update() is only called when the (quantized) color
// actually changes, and the icon/badge only when the reading changes, so
// a battery that stays at 78% for an hour costs zero extra repaints.

const HOST_NAME = "com.williamricchiuti.batterytheme";

// Colour model lives in theme-colors.js (loaded first; see manifest).
const Colors = globalThis.BatteryColors;

// User settings (palette / intensity / appearance / badge / enabled / gauge / style / motion). Stored in storage.local
// under "settings"; a settings UI only has to write that key.
let settings = Colors.normalizeSettings(null);

// ---------------------------------------------------------------------------
// Toolbar icon + badge
// ---------------------------------------------------------------------------
const PLACEHOLDER_GREY = "#8f8f98"; // readable on both light and dark default toolbars
function svgIcon(inner, outline = PLACEHOLDER_GREY) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect x="1" y="4.5" width="11" height="7" rx="1.8" fill="none" stroke="${outline}" stroke-width="1.1"/>
  <rect x="12.3" y="6.6" width="1.5" height="2.8" rx="0.75" fill="${outline}"/>
  ${inner}
</svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

function batteryIcon(state) {
  const built = Colors.buildTheme(shown(state), settings);
  const fillColor = Colors.css(built.accent);
  const w = Math.max(1.6, (state.percentage / 100) * 9.6);
  // The bolt pokes outside the battery body, so it must read on the toolbar.
  const boltColor = built.dark ? "#ffffff" : "#15141a";
  const bolt = state.on_ac
    ? `<path d="M 9.6 1.6 L 5.2 8.8 L 8 8.8 L 6.4 14.4 L 11 7 L 8.2 7 Z" fill="${boltColor}" stroke="${fillColor}" stroke-width="0.4"/>`
    : "";
  // While we tint the toolbar, the outline takes the theme's icon colour so
  // it stays visible on it; paused, the toolbar is the user's own.
  const outline = settings.enabled ? Colors.css(built.raw.icons) : PLACEHOLDER_GREY;
  return svgIcon(`<rect x="2.2" y="5.7" width="${w}" height="4.6" rx="0.9" fill="${fillColor}"/>${bolt}`, outline);
}

// Empty battery outline with a mark in it: "?" = no data, "-" = no battery.
function placeholderIcon(mark) {
  return svgIcon(
    `<text x="6.5" y="10.6" font-family="sans-serif" font-size="6.5" font-weight="700" text-anchor="middle" fill="${PLACEHOLDER_GREY}">${mark}</text>`
  );
}

function describe(state) {
  const { status, time } = Colors.describeState(state);
  const parts = [`${state.percentage}%`, status];
  if (time) parts.push(time);
  if (state.low_power) parts.push("Low Power Mode");
  return parts.join(" · ");
}

function showBattery(state) {
  browser.action.setIcon({ path: batteryIcon(state) });
  browser.action.setBadgeText({ text: settings.badge ? String(state.percentage) : "" });
  browser.action.setBadgeBackgroundColor({ color: "#000000" });
  // Badge is always black, so use the dark-chrome accent for its text.
  browser.action.setBadgeTextColor({
    color: Colors.css(Colors.accentRgb({ ...state, dark: true }, { ...settings, appearance: "dark" })),
  });
  browser.action.setTitle({ title: describe(state) });
}

function showPlaceholder(mark, title) {
  browser.action.setIcon({ path: placeholderIcon(mark) });
  browser.action.setBadgeText({ text: "" });
  browser.action.setTitle({ title });
}

// ---------------------------------------------------------------------------
// State handling
// ---------------------------------------------------------------------------
// What is currently painted. Kept in storage.session so an event-page wake-up
// does not repaint an unchanged theme (theme.update forces a full chrome
// repaint); storage.session is cleared on browser restart, which is exactly
// when a repaint is needed.
//   themeKey: Colors.themeKey(...) | "reset"
//   viewKey:  JSON of the last state shown on the toolbar button
let painted = { themeKey: null, viewKey: null };

const NO_HOST_TITLE = "Battery Theme: helper not connected. Click for details.";
const NO_BATTERY_TITLE = "Battery Theme: this machine has no battery, so the theme is idle.";
const OLD_HELPER_TITLE = "Battery Theme: the helper needs updating. Click for details.";

// Message format version this extension needs from the helper (its "v" field).
const MIN_HELPER_VERSION = 1;

function isValidState(msg) {
  if (!msg || typeof msg.has_battery !== "boolean") return false;
  if (!msg.has_battery) return true;
  return (
    Number.isInteger(msg.percentage) &&
    msg.percentage >= 0 &&
    msg.percentage <= 100 &&
    typeof msg.on_ac === "boolean"
  );
}

// Firefox can replace our theme behind our back: its own default theme is
// (re)applied during browser startup, sometimes just after our first paint,
// and the user or another add-on can switch themes at any time. Because an
// unchanged battery level is never repainted, a lost paint would otherwise
// stick until the level moved. So: every theme change that is not ours gets
// painted over again (rate-limited), and the first paint after a browser
// start is repeated once a few seconds later.
let ownUpdates = 0;          // our theme calls not yet echoed by theme.onUpdated
let ownUpdatesTimer = null;
let repaintTimes = [];       // recent forced repaints, for rate limiting
let bootRepaintPending = false;
const MAX_REPAINTS_PER_MINUTE = 3;
const BOOT_REPAINT_MS = 4000;

// Light or dark, when the Appearance setting is "Match system".
//
// The theme is applied with color_scheme "system" (see theme-colors.js), and
// this background page then sees the browser's own idea of the system
// setting through prefers-color-scheme (checked on Firefox 140 and 160; it
// is not affected by resistFingerprinting). That is immediate and works on
// every OS, including where the helper cannot tell (it sends dark:null on
// KDE, Xfce, Flatpak and older Windows helpers).
//
// The query only means "the system" while our own system-following theme is
// the one applied; under the user's own theme it reports that theme instead.
// So until our theme is up, the helper's `dark` field is the first guess,
// and if that guess was wrong the query changes right after the first paint
// and the theme is painted again.
const darkQuery = globalThis.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
let helperDark = null;        // last `dark` from the helper (null = it cannot tell)
let followingSystem = false;  // our theme with color_scheme "system" is applied
let paintedFrame = null;      // frame colour of our last paint, to recognise our own theme
// Asked afresh every time: on Firefox 140 a kept MediaQueryList goes stale in
// this (never displayed) page, while a new query gives the current answer.
const systemIsDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function resolvedDark() {
  if (darkQuery && followingSystem) return systemIsDark();
  if (helperDark !== null) return helperDark;
  return darkQuery ? systemIsDark() : null;
}
// The state as it is drawn: the helper's reading with light/dark resolved.
function shown(state) {
  return { ...state, dark: resolvedDark() };
}

// Right-to-left Firefox (Arabic, Hebrew, Persian...) lays its tabs out from
// the right, so the gauge fills from the right too.
const RTL = browser.i18n.getMessage("@@bidi_dir") === "rtl";

// The OS "reduce motion" setting switches off the flash even when the
// extension's own motion setting is on.
const reducedMotion = globalThis.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
function paintSettings() {
  return reducedMotion && reducedMotion.matches ? { ...settings, motion: false } : settings;
}

function paintTheme(view, opts) {
  ownUpdates += 1;
  clearTimeout(ownUpdatesTimer);
  ownUpdatesTimer = setTimeout(() => (ownUpdates = 0), 2000); // some calls produce no event
  if (view.kind === "battery") {
    const { theme } = Colors.buildTheme(shown(view.state), paintSettings(), { ...opts, rtl: RTL });
    browser.theme.update(theme);
    followingSystem = settings.appearance === "auto";
    paintedFrame = theme.colors.frame;
  } else {
    followingSystem = false;
    browser.theme.reset();
  }
}

// A short brighter frame when the battery drops through 20% and 10%, so the
// change is noticed even if you were not looking at the tab strip.
const PULSE_MS = 900;
function pulseTheme(view) {
  paintTheme(view, { pulse: true });
  setTimeout(() => {
    if (lastView && lastView.kind === "battery" && settings.enabled) paintTheme(lastView);
  }, PULSE_MS);
}

function setTheme(themeKey, view) {
  if (painted.themeKey === themeKey) return;
  painted.themeKey = themeKey;
  paintTheme(view);
  if (bootRepaintPending && view.kind === "battery") {
    bootRepaintPending = false;
    setTimeout(() => {
      if (lastView && lastView.kind === "battery" && settings.enabled) paintTheme(lastView);
    }, BOOT_REPAINT_MS);
  }
}

browser.theme.onUpdated.addListener(() => {
  if (ownUpdates > 0) {
    ownUpdates -= 1;
    return;
  }
  ready.then(() => {
    // Someone else changed the theme. Only reclaim it while we have a reading.
    // Not while paused: then the theme is the user's to choose.
    if (!lastView || lastView.kind !== "battery" || !settings.enabled) return;
    const now = Date.now();
    repaintTimes = repaintTimes.filter((t) => now - t < 60000);
    if (repaintTimes.length >= MAX_REPAINTS_PER_MINUTE) return; // don't fight another theme add-on
    repaintTimes.push(now);
    setTimeout(() => {
      if (lastView && lastView.kind === "battery" && settings.enabled) paintTheme(lastView);
    }, 250);
  });
});

// Also publishes the current view for the popup, which reads it from
// storage.session and follows changes via storage.onChanged.
function savePainted() {
  // `dark` is the resolved light/dark, so the popup draws what the chrome shows.
  const view = lastView && lastView.kind === "battery" ? { ...lastView, state: shown(lastView.state) } : lastView;
  browser.storage.session.set({ painted, view, helperDark }).catch(() => {});
}

// view: { kind: "battery", state } | { kind: "no-battery" } | { kind: "no-host" }
//       | { kind: "old-helper" }
let lastView = null; // re-rendered when settings change

function render(view) {
  const previous = lastView;
  lastView = view;
  if (view.kind === "battery") helperDark = typeof view.state.dark === "boolean" ? view.state.dark : null;
  const viewKey = JSON.stringify({ view, settings, dark: resolvedDark() });
  if (painted.viewKey === viewKey) return; // nothing changed — no work at all
  painted.viewKey = viewKey;

  if (view.kind === "battery") {
    const { state } = view;
    // Paused: the button and popup keep showing the reading, but the browser
    // theme is handed back to the user.
    if (settings.enabled) {
      const ps = paintSettings();
      setTheme(Colors.themeKey(shown(state), ps), view);
      const drained =
        previous && previous.kind === "battery" && !state.on_ac && !previous.state.on_ac &&
        Colors.crossesPulse(previous.state.percentage, state.percentage);
      if (drained && ps.motion) pulseTheme(view);
    } else setTheme("reset", { kind: "paused" });
    showBattery(state);
  } else {
    // No trustworthy reading: hand the chrome back to the user's own theme
    // rather than painting a made-up battery level.
    setTheme("reset", view);
    if (view.kind === "no-battery") showPlaceholder("-", NO_BATTERY_TITLE);
    else if (view.kind === "old-helper") showPlaceholder("!", OLD_HELPER_TITLE);
    else showPlaceholder("?", NO_HOST_TITLE);
  }
  savePainted();
  maybeOpenSetup();
}

// Right after installation, if the helper is missing, open the setup page
// once: otherwise a new user just sees a "?" button and nothing else.
let justInstalled = false;
function maybeOpenSetup() {
  if (!justInstalled || !lastView) return;
  justInstalled = false;
  if (lastView.kind === "no-host") browser.tabs.create({ url: browser.runtime.getURL("setup.html") });
}

// ---------------------------------------------------------------------------
// Native messaging
// ---------------------------------------------------------------------------
const WATCHDOG_ALARM = "watchdog";
const WATCHDOG_MINUTES = 1;        // normal check interval
const WATCHDOG_SLOW_MINUTES = 5;   // after repeated failures (host not installed)
const FAILURES_BEFORE_SLOW = 5;
const STABLE_MS = 30000;          // a port that lived this long counts as healthy
const QUICK_DEATHS_BEFORE_GIVING_UP = 3;
const HOLD_MS = 5000;             // how long a suspect helper must stay up before we trust it
const FIRST_MESSAGE_MS = 8000;    // a helper that has said nothing by now is shown as not connected

let port = null;
let failures = 0;
// Times in a row the helper sent a reading and then died within STABLE_MS.
// Past the limit we stop showing its readings (they would be stale between
// crashes) until it proves it can stay up.
let quickDeaths = 0;

const ready = Promise.all([
  browser.storage.session.get(["painted", "failures", "view", "quickDeaths", "helperDark"]),
  browser.storage.local.get("settings"),
])
  .then(([session, local]) => {
    if (session.painted) painted = session.painted;
    else bootRepaintPending = true; // nothing painted yet this browser session
    if (session.view) lastView = session.view;
    if (typeof session.helperDark === "boolean") helperDark = session.helperDark;
    // The stored view carries the resolved light/dark; put the helper's own
    // value back so a later OS change can still override it.
    if (lastView && lastView.kind === "battery") lastView.state.dark = helperDark;
    followingSystem =
      !!painted.themeKey && painted.themeKey !== "reset" && settings.appearance === "auto" && settings.enabled;
    if (Number.isInteger(session.failures)) failures = session.failures;
    if (Number.isInteger(session.quickDeaths)) quickDeaths = session.quickDeaths;
    settings = Colors.normalizeSettings(local.settings);
  })
  .catch(() => {});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  settings = Colors.normalizeSettings(changes.settings.newValue);
  if (lastView) render(lastView);
});

function setWatchdog(minutes) {
  browser.alarms.create(WATCHDOG_ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
}

function noteFailure() {
  failures += 1;
  browser.storage.session.set({ failures }).catch(() => {});
  if (failures === FAILURES_BEFORE_SLOW) setWatchdog(WATCHDOG_SLOW_MINUTES);
}

function noteSuccess() {
  if (failures === 0) return;
  const wasSlow = failures >= FAILURES_BEFORE_SLOW;
  failures = 0;
  browser.storage.session.set({ failures }).catch(() => {});
  if (wasSlow) setWatchdog(WATCHDOG_MINUTES);
}

function connect() {
  if (port) return;

  let p;
  try {
    p = browser.runtime.connectNative(HOST_NAME);
  } catch (err) {
    console.error("Battery Theme: connectNative failed:", err);
    noteFailure();
    render({ kind: "no-host" });
    return;
  }
  port = p;
  const connectedAt = Date.now();
  let gotMessage = false;
  let held = null;      // latest reading from a helper we do not trust yet
  let holdTimer = null;

  const setQuickDeaths = (n) => {
    if (quickDeaths === n) return;
    quickDeaths = n;
    browser.storage.session.set({ quickDeaths }).catch(() => {});
  };
  const viewFor = (msg) => {
    if (typeof msg.v === "number" && msg.v < MIN_HELPER_VERSION) return { kind: "old-helper" };
    return msg.has_battery ? { kind: "battery", state: msg } : { kind: "no-battery" };
  };

  // A helper that stays connected this long is healthy again.
  const stableTimer = setTimeout(() => {
    if (port === p) setQuickDeaths(0);
  }, STABLE_MS);

  // A helper that starts but never sends a reading (hung, or the wrong
  // program) would otherwise leave the popup on "Connecting…" forever, or an
  // old reading on screen. The port stays open: if it does speak later, its
  // reading is shown as usual.
  const silentTimer = setTimeout(() => {
    if (port === p && !gotMessage) render({ kind: "no-host" });
  }, FIRST_MESSAGE_MS);

  p.onMessage.addListener((msg) => {
    if (!isValidState(msg)) {
      console.warn("Battery Theme: ignoring unexpected host message:", msg);
      return;
    }
    gotMessage = true;
    clearTimeout(silentTimer);
    noteSuccess();
    if (quickDeaths < QUICK_DEATHS_BEFORE_GIVING_UP) {
      render(viewFor(msg));
      return;
    }
    // The helper has been crash-looping: wait until it has stayed up a few
    // seconds before believing it, so the theme does not flap.
    held = msg;
    if (!holdTimer) {
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (port === p && held) render(viewFor(held));
      }, HOLD_MS);
    }
  });

  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
    clearTimeout(stableTimer);
    clearTimeout(holdTimer);
    clearTimeout(silentTimer);
    const reason = p.error ? p.error.message : "host exited";
    console.warn("Battery Theme: host disconnected:", reason);
    if (gotMessage && Date.now() - connectedAt > STABLE_MS) {
      // It had been working for a while, so this is a one-off crash or a
      // sleep/wake hiccup. Keep the current theme and retry right away; the
      // watchdog alarm is the backstop if this page gets suspended first.
      // (If that retry finds no helper, the no-host branch below runs.)
      setQuickDeaths(0);
      setTimeout(connect, 2000);
    } else if (gotMessage) {
      // It spoke and then died almost immediately: a crash-looping host.
      // Let the (backing-off) watchdog retry rather than respawning it every
      // two seconds, and after a few rounds stop showing its last reading,
      // which would otherwise sit there going stale.
      setQuickDeaths(quickDeaths + 1);
      noteFailure();
      if (quickDeaths >= QUICK_DEATHS_BEFORE_GIVING_UP) render({ kind: "no-host" });
    } else {
      // Never heard from it: not installed, or broken.
      noteFailure();
      render({ kind: "no-host" });
    }
  });
}

// The watchdog reconnects after a host failure and also revives the
// connection if Firefox ever suspends this event page while the port is open.
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) ready.then(connect);
});

// The popup pings on open (waking this page if needed) and on "Try again".
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || (msg.type !== "wake" && msg.type !== "retry")) return;
  ready.then(() => {
    connect();
    // Firefox 140 does not deliver the prefers-color-scheme change event to
    // this page (160 does), so there an OS light/dark switch is picked up on
    // the next helper message, or here when the popup opens.
    if (lastView) render(lastView);
  });
});

// Registering these makes Firefox start the event page on launch / update.
browser.runtime.onStartup.addListener(() => {});
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  justInstalled = true;
  ready.then(maybeOpenSetup); // in case the first connection attempt already finished
});

if (reducedMotion) {
  reducedMotion.addEventListener("change", () => {
    painted.viewKey = null; // the OS setting is not part of the view key
    if (lastView) render(lastView);
  });
}

if (darkQuery) {
  darkQuery.addEventListener("change", async () => {
    await ready;
    // The query also flips when someone else's theme replaces ours. That says
    // nothing about the system, and reacting to it would have us repaint in
    // step with the other theme.
    let current = null;
    try {
      current = await browser.theme.getCurrent();
    } catch (err) {}
    const ours = !!(current && current.colors && current.colors.frame === paintedFrame &&
      current.properties && current.properties.color_scheme === "system");
    if (!ours) {
      followingSystem = false;
      return;
    }
    if (lastView) render(lastView); // does nothing unless the resolved appearance changed
  });
}

ready.then(async () => {
  if (!(await browser.alarms.get(WATCHDOG_ALARM))) setWatchdog(WATCHDOG_MINUTES);
  connect();
});
