// End-to-end tests: a real Firefox, the real extension, and a fake helper the
// test steers. Assertions read what Firefox actually applied to its own
// window, not what the extension meant to apply.
//
// Run with: npm run test:e2e     (FIREFOX_BIN=/path/to/firefox to pick a build)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { launch, findFirefox, sleep } = require("./harness.js");
const C = require("../../extension/theme-colors.js");

const skip = findFirefox() ? false : "no Firefox found (set FIREFOX_BIN)";
const expected = (state, settings) => C.buildTheme({ dark: true, ...state }, settings || {});
const rgb = (c) => C.css(c);

async function withBrowser(opts, fn) {
  const b = await launch(opts);
  try {
    await fn(b);
  } finally {
    await b.close();
  }
}

test("a battery reading themes the real browser window", { skip }, async () => {
  await withBrowser({ install: false, prefs: { "ui.systemUsesDarkTheme": 1 } }, async (b) => {
    const state = b.setState({ percentage: 42 });
    await b.install();
    const want = expected(state);
    const t = await b.waitForTheme((t) => t.frame === rgb(want.raw.frame), "frame colour for 42%");
    assert.ok(t.lwtheme, "a theme is active");
    assert.match(t.images, /gauge\\?\/r\d+-dark-42\\?\.svg/, "gauge image for 42%");
    assert.strictEqual(t.paintedSelectedTab, rgb(want.raw.tab_selected), "selected tab colour as painted");
    assert.strictEqual(t.field, rgb(want.raw.toolbar_field));

    // The system switches to light.
    await b.setPref("ui.systemUsesDarkTheme", 0);
    await sleep(300);
    const light = b.setState({ percentage: 42, dark: false });
    const wantLight = expected(light);
    const tl = await b.waitForTheme((t) => t.frame === rgb(wantLight.raw.frame), "light frame");
    assert.match(tl.images, /light-42/);
    await b.setPref("ui.systemUsesDarkTheme", 1);

    // Charging is blue and keeps the gauge at the real level.
    const charging = b.setState({ percentage: 42, on_ac: true, charging: true });
    const wantCh = expected(charging);
    await b.waitForTheme((t) => t.frame === rgb(wantCh.raw.frame), "charging frame");

    const view = (await b.session()).view;
    assert.strictEqual(view.kind, "battery");
    assert.strictEqual(view.state.percentage, 42);
  });
});

test("extreme and odd readings: 0, 1, 100, jumps, and invalid messages", { skip }, async () => {
  await withBrowser({}, async (b) => {
    for (const percentage of [0, 1, 100, 3, 97, 50]) {
      const s = b.setState({ percentage });
      const want = expected(s);
      const t = await b.waitForTheme((t) => t.frame === rgb(want.raw.frame), `frame for ${percentage}%`);
      assert.ok(t.images.includes(`dark-${want.gauge.level}`), `gauge file for ${percentage}%`);
    }
    // Invalid readings are ignored: the last good theme stays.
    const good = await b.theme();
    for (const bad of [{ percentage: 101 }, { percentage: -1 }, { percentage: 55.5 }, { percentage: "80" },
      { percentage: null }, { on_ac: "yes", percentage: 20 }]) {
      b.setState(bad);
      await sleep(250);
    }
    b.setRawState(JSON.stringify("just a string"));
    await sleep(250);
    b.setRawState(JSON.stringify({ hello: "world" }));
    await sleep(250);
    const after = await b.theme();
    assert.strictEqual(after.frame, good.frame, "theme unchanged by invalid readings");
    assert.strictEqual((await b.session()).view.state.percentage, 50);
  });
});

test("an unchanged level costs no repaint; a 2% step costs exactly one", { skip }, async () => {
  await withBrowser({}, async (b) => {
    const s = b.setState({ percentage: 60 });
    await b.waitForTheme((t) => t.frame === rgb(expected(s).raw.frame), "60%");
    await sleep(5000); // let the once-per-session safety repaint pass
    await b.startRepaintCounter();
    b.setState({ percentage: 60, minutes_remaining: 200 }); // only the estimate moved
    b.setState({ percentage: 60, minutes_remaining: 199 });
    await sleep(600);
    assert.strictEqual(await b.repaints(), 0, "no repaint when only the time estimate changes");
    b.setState({ percentage: 59 }); // rounds to the same 2% step as 60
    await sleep(600);
    assert.strictEqual(await b.repaints(), 0, "no repaint inside the same 2% step");
    b.setState({ percentage: 57 });
    await b.waitForTheme((t) => t.images.includes("dark-58") || t.images.includes("dark-56"), "next step");
    await sleep(400);
    assert.strictEqual(await b.repaints(), 1, "one repaint for one step");
  });
});

test("no battery and no helper both leave the user's own theme alone", { skip }, async () => {
  await withBrowser({}, async (b) => {
    const s = b.setState({ percentage: 30 });
    await b.waitForTheme((t) => t.frame === rgb(expected(s).raw.frame), "30%");
    b.setState({ has_battery: false, percentage: null, on_ac: true });
    await b.waitForTheme((t) => !t.images.includes("gauge"), "theme reset for no battery");
    assert.strictEqual((await b.session()).view.kind, "no-battery");
  });
  await withBrowser({ helper: "none" }, async (b) => {
    await sleep(1500);
    const t = await b.theme();
    assert.ok(!t.images.includes("gauge"), "no gauge without a helper");
    assert.strictEqual((await b.session()).view.kind, "no-host");
    // First install with no helper opens the setup page once.
    const urls = await b.chrome(`return [...gBrowser.tabs].map((t) => t.linkedBrowser.currentURI.spec);`);
    assert.ok(urls.some((u) => u.endsWith("/setup.html")), `setup page opened: ${urls}`);
  });
});

test("helpers that misbehave never leave a wrong reading on screen", { skip }, async () => {
  // Exits at once, or speaks nonsense: treated as not connected.
  for (const mode of ["exit", "garbage"]) {
    await withBrowser({ install: false }, async (b) => {
      b.setMode(mode);
      await b.install();
      await sleep(1500);
      assert.strictEqual((await b.session()).view.kind, "no-host", mode);
      assert.ok(!(await b.theme()).images.includes("gauge"), mode);
    });
  }
  // An outdated helper is reported as such, not themed.
  await withBrowser({ install: false }, async (b) => {
    b.setState({ v: 0, percentage: 50 });
    await b.install();
    await sleep(1200);
    assert.strictEqual((await b.session()).view.kind, "old-helper");
  });
});

test("a helper that starts but never answers is reported, not waited on forever", { skip }, async () => {
  await withBrowser({ install: false }, async (b) => {
    b.setMode("silent");
    await b.install();
    await sleep(9000);
    const view = (await b.session()).view;
    assert.ok(view, "a view is published even when the helper stays silent");
    assert.strictEqual(view.kind, "no-host");
    // If it does answer in the end, the reading is used.
    b.setMode("normal");
    await b.inExtensionPage(`const done = arguments[0]; browser.runtime.sendMessage({ type: "retry" }).then(() => done(1), () => done(0));`);
    assert.strictEqual((await b.session()).view.kind, "no-host", "still the same silent helper");
  });
});

test("pause hands the theme back; another theme is painted over while active", { skip }, async () => {
  await withBrowser({}, async (b) => {
    const s = b.setState({ percentage: 70 });
    const want = rgb(expected(s).raw.frame);
    await b.waitForTheme((t) => t.frame === want, "70%");
    await b.setSettings({ enabled: false });
    await b.waitForTheme((t) => !t.images.includes("gauge"), "reset when paused");
    await b.setSettings({ enabled: true });
    await b.waitForTheme((t) => t.frame === want, "theme back after resume");

    // Someone switches to a built-in theme: we repaint over it.
    await b.chrome(`
      const done = arguments[arguments.length - 1];
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      AddonManager.getAddonByID("firefox-compact-light@mozilla.org").then((a) => a.enable()).then(() => done(true));`,
      [], { async: true });
    await b.waitForTheme((t) => t.frame === want, "reclaimed after another theme was enabled");
  });
});

test("the popup's controls change the real theme", { skip }, async () => {
  await withBrowser({}, async (b) => {
    const s = b.setState({ percentage: 25 });
    await b.waitForTheme((t) => t.frame === rgb(expected(s).raw.frame), "25% classic");
    await b.openPopup();
    assert.strictEqual(await b.inPage(`return document.getElementById("percent").textContent;`), "25");
    await b.inPage(`document.querySelector('input[name=palette][value=cvd]').click();`);
    await b.waitForTheme((t) => t.frame === rgb(expected(s, { palette: "cvd" }).raw.frame), "cvd palette");
    await b.inPage(`document.querySelector('input[name=gauge]').click();`);
    const t = await b.waitForTheme((t) => !t.images.includes("gauge"), "gauge off");
    assert.strictEqual(t.frame, rgb(expected(s, { palette: "cvd", gauge: false }).raw.frame));
    await b.inPage(`document.querySelector('input[name=appearance][value=light]').click();`);
    await b.waitForTheme(
      (t) => t.frame === rgb(expected(s, { palette: "cvd", gauge: false, appearance: "light" }).raw.frame),
      "forced light");
  });
});

test("dropping through 20% flashes once, then settles; not under reduced motion", { skip }, async () => {
  await withBrowser({}, async (b) => {
    b.setState({ percentage: 22 });
    await b.waitForTheme((t) => t.images.includes("dark-22"), "22%");
    await sleep(5000);
    await b.startRepaintCounter();
    const s = b.setState({ percentage: 20 });
    await sleep(2000);
    assert.strictEqual(await b.repaints(), 3, "normal frame, flash frame, normal frame");
    assert.strictEqual((await b.theme()).frame, rgb(expected(s).raw.frame), "settled on the normal 20% theme");
  });
  await withBrowser({ prefs: { "ui.prefersReducedMotion": 1 } }, async (b) => {
    b.setState({ percentage: 22 });
    await b.waitForTheme((t) => t.images.includes("dark-22"), "22%");
    await sleep(5000);
    await b.startRepaintCounter();
    b.setState({ percentage: 20 });
    await sleep(2000);
    assert.strictEqual(await b.repaints(), 1, "no flash with reduced motion");
  });
});

test("new windows and private windows get the theme too", { skip }, async () => {
  await withBrowser({}, async (b) => {
    const s = b.setState({ percentage: 64 });
    const want = rgb(expected(s).raw.frame);
    await b.waitForTheme((t) => t.frame === want, "64%");
    const frames = await b.chrome(`
      const done = arguments[arguments.length - 1];
      const open = (opts) => new Promise((resolve) => {
        const w = OpenBrowserWindow(opts);
        w.addEventListener("load", () => setTimeout(() => resolve(w), 800), { once: true });
      });
      Promise.all([open({}), open({ private: true })]).then((wins) => {
        done(wins.map((w) => w.getComputedStyle(w.document.documentElement).getPropertyValue("--lwt-accent-color").trim()));
      });`, [], { async: true });
    assert.deepStrictEqual(frames, [want, want]);
  });
});

test("closing Firefox ends the helper", { skip }, async () => {
  let b = await launch();
  b.setState({ percentage: 80 });
  await b.waitForTheme((t) => t.images.includes("gauge"), "theme");
  const fs = require("node:fs");
  const path = require("node:path");
  const logFile = path.join(b.ctrl, "log");
  process.env.BATTERY_E2E_KEEP = "1";
  try {
    await b.close();
  } finally {
    delete process.env.BATTERY_E2E_KEEP;
  }
  await sleep(500);
  const log = fs.readFileSync(logFile, "utf8");
  try {
    fs.rmSync(b.tmp, { recursive: true, force: true });
  } catch {}
  assert.match(log, /stdin-closed/, "helper saw its stdin close");
});

test("light/dark follows the OS at once, even when the helper cannot tell", { skip }, async () => {
  await withBrowser({ install: false, prefs: { "ui.systemUsesDarkTheme": 1 } }, async (b) => {
    const s = b.setState({ percentage: 70, dark: null }); // e.g. Windows or KDE
    await b.install();
    const dark = rgb(expected({ ...s, dark: true }).raw.frame);
    const light = rgb(expected({ ...s, dark: false }).raw.frame);
    await b.waitForTheme((t) => t.frame === dark, "dark from the OS setting");
    // Firefox 157+ tells the extension about the switch at once. Firefox 140
    // does not, so there it shows with the next message from the helper.
    const immediate = require("./harness.js").firefoxVersion().major >= 157;
    await b.setPref("ui.systemUsesDarkTheme", 0);
    if (!immediate) {
      await sleep(500);
      b.setState({ percentage: 70, dark: null, minutes_remaining: 111 });
    }
    const t = await b.waitForTheme((t) => t.frame === light, "light after the OS switched", 4000);
    assert.match(t.images, /light-70/);
    await b.setPref("ui.systemUsesDarkTheme", 1);
    if (!immediate) {
      await sleep(500);
      b.setState({ percentage: 70, dark: null, minutes_remaining: 110 });
    }
    await b.waitForTheme((t) => t.frame === dark, "dark again", 4000);
    // The popup draws the same appearance.
    assert.strictEqual((await b.session()).view.state.dark, true);
  });
  // The helper's value is only the first guess: when it is wrong (here it
  // says dark on a light system), Firefox's own view corrects it.
  await withBrowser({ install: false, prefs: { "ui.systemUsesDarkTheme": 0 } }, async (b) => {
    const s = b.setState({ percentage: 70, dark: true });
    await b.install();
    await b.waitForTheme((t) => t.frame === rgb(expected({ ...s, dark: false }).raw.frame), "settles on light");
  });
  // Forced appearance ignores both.
  await withBrowser({ prefs: { "ui.systemUsesDarkTheme": 0 } }, async (b) => {
    const s = b.setState({ percentage: 70, dark: false });
    await b.setSettings({ appearance: "dark" });
    await b.waitForTheme((t) => t.frame === rgb(expected(s, { appearance: "dark" }).raw.frame), "forced dark");
  });
});

test("vertical tabs: the gauge stays in the top bar", { skip }, async (t) => {
  const { firefoxVersion } = require("./harness.js");
  if (firefoxVersion().major < 157) return t.skip("backgrounds_area needs Firefox 157+; older versions already keep the image in the toolbox");
  await withBrowser({ prefs: { "sidebar.revamp": true, "sidebar.verticalTabs": true } }, async (b) => {
    b.setState({ percentage: 30 });
    await b.waitForTheme((t) => t.images.includes("dark-30"), "gauge");
    const where = await b.chrome(`
      const cs = (el) => getComputedStyle(el).backgroundImage;
      return { toolbox: cs(document.getElementById("navigator-toolbox")), body: cs(document.body) };`);
    assert.match(where.toolbox, /gauge/);
    assert.strictEqual(where.body, "none", "nothing painted over the whole window");
  });
});

test("right-to-left Firefox mirrors the gauge", { skip }, async (t) => {
  const langpack = process.env.BATTERY_E2E_RTL_LANGPACK;
  if (!langpack) return t.skip("set BATTERY_E2E_RTL_LANGPACK to Mozilla's ar.xpi for this Firefox version");
  await withBrowser({ install: false, langpack: { path: langpack, locale: "ar" } }, async (b) => {
    b.setState({ percentage: 30 });
    await b.install();
    const th = await b.waitForTheme((t) => t.images.includes("dark-30"), "gauge");
    assert.match(th.images, /#rtl|\\#rtl/, "mirrored variant requested");
    assert.strictEqual(await b.chrome(`return document.documentElement.matches(":-moz-locale-dir(rtl)");`), true);
  });
});

test("another add-on that keeps changing the theme is not fought forever", { skip }, async () => {
  await withBrowser({}, async (b) => {
    const s = b.setState({ percentage: 70 });
    const want = rgb(expected(s).raw.frame);
    await b.waitForTheme((t) => t.frame === want, "70%");
    // Something else re-applies a theme every 300ms for 6 seconds, while we
    // sample the window and count how often our colours come back.
    const takeovers = await b.chrome(`
      const [want, done] = arguments;
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const ids = ["firefox-compact-light@mozilla.org", "firefox-compact-dark@mozilla.org"];
      const frame = () => getComputedStyle(document.documentElement).getPropertyValue("--lwt-accent-color").trim();
      let n = 0, ours = true, count = 0;
      const sample = setInterval(() => {
        const now = frame() === want;
        if (now && !ours) count++;
        ours = now;
      }, 25);
      const tick = async () => {
        const a = await AddonManager.getAddonByID(ids[n % 2]);
        await a.enable();
        if (++n < 20) setTimeout(tick, 300);
        else setTimeout(() => { clearInterval(sample); done(count); }, 1500);
      };
      tick();`, [want], { async: true });
    assert.ok(takeovers <= 4, `we repaint over the other theme a few times, then stop: ${takeovers}`);
  });
});
