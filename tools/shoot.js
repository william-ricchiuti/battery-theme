// Takes screenshots of a real Firefox window in chosen battery states, using
// the end-to-end harness (throwaway profile, fake helper). Used to review the
// look and to retake the store screenshots.
//
//   node tools/shoot.js <out-dir> [scenario-name ...]
//
// Scenarios are listed in SCENARIOS below; with no names, all are taken.
// FIREFOX_BIN picks the Firefox build; BATTERY_E2E_HEADFUL=1 shows the window.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("../test/e2e/harness.js");

const TITLES = ["Wikipedia", "MDN Web Docs", "Firefox", "Inbox (3)", "Weather", "Calendar", "News", "Maps"];
const VERTICAL = { "sidebar.revamp": true, "sidebar.verticalTabs": true };

// name: { state, settings?, tabs?, width?, height?, prefs?, whole? }
const SCENARIOS = {
  "100": { state: { percentage: 100 } },
  "82": { state: { percentage: 82 } },
  "50": { state: { percentage: 50 } },
  "34": { state: { percentage: 34 } },
  "20": { state: { percentage: 20 } },
  "8": { state: { percentage: 8 } },
  "3": { state: { percentage: 3 } },
  "charging-40": { state: { percentage: 40, on_ac: true, charging: true } },
  "full-ac": { state: { percentage: 100, on_ac: true, charged: true } },
  "light-82": { state: { percentage: 82, dark: false } },
  "light-20": { state: { percentage: 20, dark: false } },
  "light-8": { state: { percentage: 8, dark: false } },
  "light-charging": { state: { percentage: 60, on_ac: true, charging: true, dark: false } },
  "one-tab-8": { state: { percentage: 8 }, tabs: 1 },
  "one-tab-20": { state: { percentage: 20 }, tabs: 1 },
  "many-tabs-60": { state: { percentage: 60 }, tabs: 200 },
  "narrow-30": { state: { percentage: 30 }, width: 520 },
  "strong-8": { state: { percentage: 8 }, settings: { intensity: 1.5 } },
  "strong-60": { state: { percentage: 60 }, settings: { intensity: 1.5 } },
  "strong-light-8": { state: { percentage: 8, dark: false }, settings: { intensity: 1.5 } },
  "subtle-82": { state: { percentage: 82 }, settings: { style: "subtle" } },
  "subtle-15": { state: { percentage: 15 }, settings: { style: "subtle" } },
  "cvd-82": { state: { percentage: 82 }, settings: { palette: "cvd" } },
  "cvd-15": { state: { percentage: 15 }, settings: { palette: "cvd" } },
  "nogauge-40": { state: { percentage: 40 }, settings: { gauge: false } },
  "vertical-60": { state: { percentage: 60 }, prefs: VERTICAL, whole: true },
  "vertical-8": { state: { percentage: 8 }, prefs: VERTICAL, whole: true },
  "vertical-light-30": { state: { percentage: 30, dark: false }, prefs: VERTICAL, whole: true },
  "compact-40": { state: { percentage: 40 }, prefs: { "browser.uidensity": 1 } },
  // Needs BATTERY_E2E_RTL_LANGPACK=/path/to/ar.xpi (from ftp.mozilla.org, matching the Firefox version).
  "rtl-30": { state: { percentage: 30 }, rtl: true },
  "rtl-8": { state: { percentage: 8 }, rtl: true },
  "newtab-40": { state: { percentage: 40 }, prefs: { "browser.newtabpage.enabled": true }, whole: true, newtab: true },
  // Store screenshots (docs/screenshots/): whole window, 1280x800 at 2x = 2560x1600.
  "store-1-healthy-dark": { state: { percentage: 82, minutes_remaining: 372 }, store: true },
  "store-2-low-dark": { state: { percentage: 20, minutes_remaining: 54 }, store: true },
  "store-3-critical-dark": { state: { percentage: 8, minutes_remaining: 19 }, store: true },
  "store-4-charging-dark": { state: { percentage: 46, on_ac: true, charging: true, minutes_remaining: 61 }, store: true },
  // (5-popup-dark.png is taken by hand: the popup is a separate native panel that a headless capture does not include.)
  "store-6-low-light": { state: { percentage: 20, minutes_remaining: 54, dark: false }, store: true },
  "store-7-vertical-dark": { state: { percentage: 34, minutes_remaining: 95 }, store: true, prefs: VERTICAL },
};

// A quiet new-tab page: no network content, just the search box on the theme's own background.
const STORE_PREFS = {
  "browser.newtabpage.enabled": true,
  "browser.newtabpage.activity-stream.feeds.topsites": false,
  "browser.newtabpage.activity-stream.feeds.section.topstories": false,
  "browser.newtabpage.activity-stream.feeds.system.topstories": false,
  "browser.newtabpage.activity-stream.showSponsored": false,
  "browser.newtabpage.activity-stream.showSponsoredTopSites": false,
  "browser.newtabpage.activity-stream.showWeather": false,
  "browser.newtabpage.activity-stream.feeds.section.highlights": false,
  "browser.newtabpage.activity-stream.feeds.snippets": false,
  "browser.newtabpage.activity-stream.newtabWallpapers.enabled": false,
  "browser.newtabpage.activity-stream.showSearch": true,
  "browser.newtabpage.activity-stream.logowordmark.alwaysVisible": true,
  "browser.newtabpage.activity-stream.asrouter.providers.messaging-experiments": "{}",
  "browser.startup.homepage": "about:home",
};

async function shoot(name, sc, outDir) {
  const scale = Number(process.env.SHOOT_SCALE || (sc.store ? 2 : 1)); // whole-window shots only
  if (sc.store) sc = { whole: true, newtab: true, height: 800, ...sc, prefs: { ...STORE_PREFS, ...(sc.prefs || {}) } };
  const b = await launch({
    width: sc.width || 1280,
    height: sc.height || (sc.whole ? 520 : 400),
    prefs: {
      "ui.systemUsesDarkTheme": sc.state.dark === false ? 0 : 1,
      ...(sc.prefs || {}),
    },
    langpack: sc.rtl && process.env.BATTERY_E2E_RTL_LANGPACK
      ? { path: process.env.BATTERY_E2E_RTL_LANGPACK, locale: "ar" } : undefined,
    install: false,
  });
  try {
    b.setState(sc.state);
    await b.install();
    if (sc.settings) await b.setSettings(sc.settings);
    await b.client.send("WebDriver:Navigate", { url: sc.newtab ? "about:home" : "about:blank" });
    const n = sc.tabs === undefined ? 5 : sc.tabs;
    await b.chrome(`
      const [n, titles] = arguments;
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      for (let i = 1; i < n; i++) {
        gBrowser.addTab("data:text/html,<title>" + titles[i % titles.length] + "</title>", { triggeringPrincipal: principal });
      }`, [n, TITLES]);
    await b.waitForTheme((t) => t.lwtheme, "theme", 10000);
    // Automation paints the address bar with warning stripes and a robot
    // icon; a user never sees those, so take them off for the picture.
    await b.chrome(`document.documentElement.removeAttribute("remotecontrol");`);
    await sleep(sc.store ? 4000 : 1500);
    const file = path.join(outDir, `${name}.png`);
    if (sc.whole) await b.screenshot(file, scale);
    else {
      await b.client.setContext("chrome");
      const el = await b.client.send("WebDriver:FindElement", { using: "id", value: "navigator-toolbox" });
      const id = Object.values(el.value)[0];
      const res = await b.client.send("WebDriver:TakeScreenshot", { id, full: false });
      fs.writeFileSync(file, Buffer.from(res.value, "base64"));
      await b.client.setContext("content");
    }
    console.log(file);
  } finally {
    await b.close();
  }
}

(async () => {
  const [outDir, ...names] = process.argv.slice(2);
  if (!outDir) throw new Error("usage: node tools/shoot.js <out-dir> [scenario ...]");
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of names.length ? names : Object.keys(SCENARIOS)) {
    if (!SCENARIOS[name]) throw new Error(`unknown scenario: ${name}`);
    try {
      await shoot(name, SCENARIOS[name], outDir);
    } catch (err) {
      console.error(`${name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
})();
