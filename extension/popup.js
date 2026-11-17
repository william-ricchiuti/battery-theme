// Battery Theme — popup.
//
// Reads the current view from storage.session (published by the background
// page) and the settings from storage.local, and follows both live. Changing
// a control writes storage.local.settings; the background re-themes on that.
"use strict";

const Colors = globalThis.BatteryColors;
const $ = (id) => document.getElementById(id);
const form = $("settings");

let settings = Colors.normalizeSettings(null);
let view = null; // { kind: "battery", state } | { kind: "no-battery" } | { kind: "no-host" } | null

const Help = globalThis.BatteryHelp;
let platform = "default";
let retryFailed = false; // the last "Try again" did not find the helper
let retryTimer = null;

// Paint the popup with the same surfaces as the browser chrome.
function applyColors(state) {
  const root = document.documentElement.style;
  if (!state) {
    for (const name of ["--bg", "--text", "--muted", "--line", "--field", "--accent", "--on-accent"]) {
      root.removeProperty(name);
    }
    root.removeProperty("color-scheme");
    return;
  }
  const built = Colors.buildTheme(state, settings);
  const c = built.theme.colors;
  root.setProperty("--bg", c.popup);
  root.setProperty("--text", c.popup_text);
  root.setProperty("--muted", c.tab_background_text);
  root.setProperty("--line", c.popup_border);
  root.setProperty("--field", c.toolbar_field);
  root.setProperty("--accent", Colors.css(built.accent));
  const dark = [12, 12, 16], light = [255, 255, 255];
  const onAccent = Colors.contrast(dark, built.accent) >= Colors.contrast(light, built.accent) ? dark : light;
  root.setProperty("--on-accent", Colors.css(onAccent));
  root.setProperty("color-scheme", built.dark ? "dark" : "light");
}

function showNotice(title, body, { command = null, retry = false, link = false } = {}) {
  $("battery").hidden = true;
  $("notice").hidden = false;
  $("noticeTitle").textContent = title;
  $("noticeBody").textContent = body;
  $("noticeCommand").hidden = !command;
  $("noticeCommand").textContent = command || "";
  $("retry").hidden = !retry;
  $("noticeLink").hidden = !link;
  $("noticeLink").href = browser.runtime.getURL("setup.html");
}

function draw() {
  // Controls always reflect the stored settings.
  form.elements.palette.value = settings.palette;
  form.elements.appearance.value = settings.appearance;
  form.elements.intensity.value = String(Math.max(0.5, Math.min(1.5, settings.intensity)));
  form.elements.badge.checked = settings.badge;
  form.elements.enabled.checked = settings.enabled;
  form.elements.gauge.checked = settings.gauge;
  form.elements.style.value = settings.style;
  form.elements.motion.checked = settings.motion;

  if (view && view.kind === "battery") {
    const { state } = view;
    const { status, time } = Colors.describeState(state);
    applyColors(state);
    $("notice").hidden = true;
    $("battery").hidden = false;
    $("percent").textContent = String(state.percentage);
    $("status").textContent = status;
    $("time").textContent = time || "";
    $("fill").style.width = `${Math.max(2, state.percentage)}%`;
    $("lowPower").hidden = !state.low_power;
    $("paused").hidden = settings.enabled;
    return;
  }

  applyColors(null);
  if (view && view.kind === "no-battery") {
    showNotice(
      "No battery found",
      "This computer doesn't report a battery, so Battery Theme leaves your Firefox theme alone."
    );
  } else if (view && (view.kind === "no-host" || view.kind === "old-helper")) {
    const help = Help.forPlatform(platform);
    const old = view.kind === "old-helper";
    const title = old
      ? "The helper needs updating"
      : retryFailed
        ? "Still not connected"
        : "One more step: install the helper";
    const body = old
      ? `This version of Battery Theme needs a newer helper script. ${help.how}`
      : `${Help.why} ${help.how}`;
    showNotice(title, body, { command: help.command, retry: true, link: true });
  } else {
    showNotice("Connecting…", "Waiting for the first battery reading.");
  }
}

function saveSettings() {
  settings = Colors.normalizeSettings({
    palette: form.elements.palette.value,
    appearance: form.elements.appearance.value,
    intensity: Number(form.elements.intensity.value),
    badge: form.elements.badge.checked,
    enabled: form.elements.enabled.checked,
    gauge: form.elements.gauge.checked,
    style: form.elements.style.value,
    motion: form.elements.motion.checked,
  });
  browser.storage.local.set({ settings });
  draw();
}

form.addEventListener("change", saveSettings);
$("intensity").addEventListener("input", saveSettings);
$("retry").addEventListener("click", () => {
  showNotice("Connecting…", "Trying the battery helper again.");
  browser.runtime.sendMessage({ type: "retry" }).catch(() => {});
  // If the helper is still missing, nothing changes for us to react to, so
  // look again shortly and say so instead of waiting forever.
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    view = (await browser.storage.session.get("view")).view || null;
    retryFailed = !view || view.kind === "no-host";
    draw();
  }, 2500);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.view) {
    view = changes.view.newValue || null;
    retryFailed = false;
  }
  else if (area === "local" && changes.settings) settings = Colors.normalizeSettings(changes.settings.newValue);
  else return;
  draw();
});

Promise.all([browser.storage.session.get("view"), browser.storage.local.get("settings")]).then(
  ([session, local]) => {
    view = session.view || null;
    settings = Colors.normalizeSettings(local.settings);
    draw();
  }
);

browser.runtime.getPlatformInfo().then((info) => {
  platform = info.os;
  draw();
});

// Make sure the background page is awake and connected.
browser.runtime.sendMessage({ type: "wake" }).catch(() => {});
