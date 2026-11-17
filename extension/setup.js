// Battery Theme — setup page. Opened once after installation when the helper
// is missing (and from the popup). Follows the view published by the
// background page, so it flips to "Connected" by itself once the helper runs.
"use strict";

const Help = globalThis.BatteryHelp;
const $ = (id) => document.getElementById(id);
let view = null;
let checking = null;

function draw() {
  const connected = view && (view.kind === "battery" || view.kind === "no-battery");
  $("todo").hidden = connected;
  $("done").hidden = !connected;
  $("title").textContent = connected ? "You're all set" : "One more step";
  $("why").hidden = connected;
  if (!connected) return;
  $("doneText").textContent =
    view.kind === "battery"
      ? `The helper is running and reports ${view.state.percentage}%. Firefox will now follow your battery.`
      : "The helper is running, but this computer doesn't report a battery, so Battery Theme will leave your Firefox theme alone.";
}

async function readView() {
  view = (await browser.storage.session.get("view")).view || null;
  draw();
}

$("why").textContent = Help.why;
$("source").href = Help.repoUrl;
browser.runtime.getPlatformInfo().then((info) => {
  const help = Help.forPlatform(info.os);
  $("how").textContent = help.how;
  $("command").textContent = help.command;
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("command").textContent);
    $("copy").textContent = "Copied";
  } catch (e) {
    $("copy").textContent = "Select and copy";
  }
  setTimeout(() => ($("copy").textContent = "Copy"), 2000);
});

$("check").addEventListener("click", () => {
  $("result").textContent = "Checking…";
  browser.runtime.sendMessage({ type: "retry" }).catch(() => {});
  clearTimeout(checking);
  // A missing helper produces no change to react to, so look again shortly.
  checking = setTimeout(async () => {
    await readView();
    if (!$("todo").hidden) {
      $("result").textContent =
        view && view.kind === "old-helper"
          ? "Found an old helper. Run the command again to update it."
          : "Not connected yet. Run the command above, then check again.";
    }
  }, 2500);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.view) return;
  view = changes.view.newValue || null;
  draw();
});

readView();
browser.runtime.sendMessage({ type: "wake" }).catch(() => {});
