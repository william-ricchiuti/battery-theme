// Starts a real Firefox on a throwaway profile and home folder, loads the
// extension as a temporary add-on, and wires it to a helper the test controls.
// Nothing here touches the real Firefox profile or the real installed helper:
// Firefox is given its own HOME, so it finds only the manifest written here.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Marionette } = require("./marionette.js");

const ROOT = path.join(__dirname, "..", "..");
const EXTENSION_DIR = path.join(ROOT, "extension");
const ADDON_ID = "battery-theme@willy.dev";
const HOST_NAME = "com.williamricchiuti.batterytheme";
const BUTTON_ID = "battery-theme_willy_dev-browser-action";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFirefox() {
  const candidates = [
    process.env.FIREFOX_BIN,
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    "/usr/bin/firefox",
    "/usr/bin/firefox-esr",
    "/opt/firefox/firefox",
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

// Where Firefox looks for a per-user native messaging manifest, given HOME.
function manifestDir(home) {
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts");
  }
  return path.join(home, ".mozilla", "native-messaging-hosts");
}

function writeManifest(home, hostPath) {
  const dir = manifestDir(home);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${HOST_NAME}.json`),
    JSON.stringify({
      name: HOST_NAME,
      description: "Battery Theme test helper",
      path: hostPath,
      type: "stdio",
      allowed_extensions: [ADDON_ID],
    })
  );
}

const BASE_PREFS = {
  "marionette.port": 0, // pick a free port; Firefox writes it to MarionetteActivePort
  "app.update.enabled": false,
  "app.update.auto": false,
  "app.normandy.enabled": false,
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.aboutwelcome.enabled": false,
  "startup.homepage_welcome_url": "about:blank",
  "startup.homepage_welcome_url.additional": "",
  "browser.startup.page": 0,
  "browser.startup.homepage": "about:blank",
  "browser.newtabpage.enabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "datareporting.healthreport.uploadEnabled": false,
  "toolkit.telemetry.enabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "browser.tabs.warnOnClose": false,
  "browser.warnOnQuit": false,
  "browser.sessionstore.resume_from_crash": false,
  "extensions.autoDisableScopes": 0,
  "extensions.update.enabled": false,
  "remote.prefs.recommended": true,
  "ui.prefersReducedMotion": 0,
  "ui.systemUsesDarkTheme": 1, // tests assume a dark system unless they say otherwise
  "termsofuse.bypassNotification": true,
  "browser.uitour.enabled": false,
};

function userJs(prefs) {
  return Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join("\n");
}

// opts:
//   helper   "fake" (default) | "none" | { path } (an executable to register)
//   prefs    extra about:config values
//   env      extra environment for Firefox (inherited by the helper)
//   headless default true; set BATTERY_E2E_HEADFUL=1 to watch
//   install  default true: load the extension right away
//   langpack { path, locale }: install a language pack and switch to it first
async function launch(opts = {}) {
  const firefox = opts.firefox || findFirefox();
  if (!firefox) throw new Error("No Firefox found; set FIREFOX_BIN");
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bt-e2e-"));
  const home = path.join(tmp, "home");
  const profile = path.join(tmp, "profile");
  const ctrl = path.join(tmp, "ctrl");
  for (const d of [home, profile, ctrl]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(profile, "user.js"), userJs({ ...BASE_PREFS, ...(opts.prefs || {}) }));

  const helper = opts.helper === undefined ? "fake" : opts.helper;
  if (helper === "fake") {
    const wrapper = path.join(tmp, "fake-host.sh");
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, "fake-host.js")}" "${ctrl}"\n`,
      { mode: 0o755 }
    );
    writeManifest(home, wrapper);
  } else if (helper && helper.path) {
    writeManifest(home, helper.path);
  }

  const headless = opts.headless !== undefined ? opts.headless : !process.env.BATTERY_E2E_HEADFUL;
  const args = ["--marionette", "-no-remote", "-profile", profile];
  if (headless) args.push("--headless");
  if (opts.width) args.push("--width", String(opts.width), "--height", String(opts.height || 800));
  const env = {
    ...process.env,
    HOME: home,
    CFFIXED_USER_HOME: home, // macOS: makes Firefox's "Application Support" lookups use our HOME
    MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1", // lets the tests look at the browser window itself
    MOZ_CRASHREPORTER_DISABLE: "1",
    MOZ_DISABLE_AUTO_SAFE_MODE: "1",
    ...(opts.env || {}),
  };
  const logFile = path.join(tmp, "firefox.log");
  const out = fs.openSync(logFile, "a");
  const child = spawn(firefox, args, { env, stdio: ["ignore", out, out] });
  let exited = false;
  child.on("exit", () => (exited = true));

  const portFile = path.join(profile, "MarionetteActivePort");
  const deadline = Date.now() + 60000;
  while (!fs.existsSync(portFile)) {
    if (exited) throw new Error(`Firefox exited during startup:\n${fs.readFileSync(logFile, "utf8").slice(-2000)}`);
    if (Date.now() > deadline) throw new Error("Firefox did not open its Marionette port in 60s");
    await sleep(100);
  }
  const port = Number(fs.readFileSync(portFile, "utf8"));
  const client = await Marionette.connect(port);
  await client.newSession();

  const b = {
    client, tmp, home, profile, ctrl, child, logFile, firefox,
    chrome: (script, args, o) => client.chrome(script, args, o),

    // --- helper control -----------------------------------------------------
    setMode(mode) {
      fs.writeFileSync(path.join(ctrl, "mode"), mode);
    },
    setState(state) {
      const full = {
        v: 1, has_battery: true, percentage: 80, on_ac: false, charging: false, charged: false,
        minutes_remaining: null, low_power: false, dark: true, ...state,
      };
      const file = path.join(ctrl, "state.json");
      fs.writeFileSync(file + ".tmp", JSON.stringify(full));
      fs.renameSync(file + ".tmp", file);
      return full;
    },
    setRawState(text) {
      fs.writeFileSync(path.join(ctrl, "state.json"), text);
    },
    helperLog() {
      try {
        return fs.readFileSync(path.join(ctrl, "log"), "utf8").trim().split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    helperStarts() {
      return b.helperLog().filter((l) => l.startsWith("start")).length;
    },

    // --- extension ----------------------------------------------------------
    async install() {
      const res = await client.send("Addon:Install", { path: EXTENSION_DIR, temporary: true });
      b.uuid = await b.chrome(
        `return WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;`, [ADDON_ID]);
      return res;
    },
    uninstall: () => client.send("Addon:Uninstall", { id: ADDON_ID }),

    // What Firefox has actually applied to the browser window.
    async theme() {
      return b.chrome(`
        const win = window, doc = document, root = doc.documentElement;
        const cs = (el) => (el ? win.getComputedStyle(el) : null);
        const rootStyle = cs(root);
        const v = (name) => rootStyle.getPropertyValue(name).trim();
        const bg = (sel) => { const s = cs(doc.querySelector(sel)); return s ? s.backgroundColor : null; };
        const button = doc.getElementById(arguments[0]);
        const selected = doc.querySelector(".tabbrowser-tab[selected] .tab-background");
        const other = doc.querySelector(".tabbrowser-tab:not([selected]) .tab-label");
        return {
          lwtheme: root.hasAttribute("lwtheme"),
          brightText: root.hasAttribute("lwtheme-brighttext") || root.getAttribute("lwtheme-brighttext"),
          frame: v("--lwt-accent-color"),
          frameInactive: v("--lwt-accent-color-inactive"),
          text: v("--lwt-text-color"),
          images: v("--lwt-additional-images"),
          toolbar: v("--toolbar-bgcolor"),
          toolbarText: v("--toolbar-color"),
          tabSelected: v("--tab-selected-bgcolor"),
          tabSelectedText: v("--tab-selected-textcolor"),
          field: v("--toolbar-field-background-color"),
          fieldBorder: v("--toolbar-field-border-color"),
          icons: v("--toolbarbutton-icon-fill"),
          sidebar: v("--sidebar-background-color"),
          paintedSelectedTab: selected ? cs(selected).backgroundColor : null,
          paintedNavBar: bg("#nav-bar"),
          paintedOtherTabText: other ? cs(other).color : null,
          button: button ? {
            title: button.getAttribute("tooltiptext") || button.getAttribute("label"),
            badge: button.getAttribute("badge") || "",
            image: (cs(button.querySelector(".toolbarbutton-icon")) || {}).listStyleImage || null,
          } : null,
        };`, [BUTTON_ID]);
    },

    // Polls until predicate(theme) is true; returns the theme, or throws with
    // the last one seen.
    async waitForTheme(predicate, what = "theme condition", timeoutMs = 8000) {
      const end = Date.now() + timeoutMs;
      let last;
      for (;;) {
        last = await b.theme();
        if (predicate(last)) return last;
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}. Last: ${JSON.stringify(last)}`);
        await sleep(100);
      }
    },

    // Runs a function body inside an extension page (popup.html by default),
    // where the real WebExtension APIs are available as `browser`.
    async inExtensionPage(script, args = [], page = "popup.html") {
      const url = `moz-extension://${b.uuid}/${page}`;
      const current = await client.send("WebDriver:GetCurrentURL");
      if (current.value !== url) await client.send("WebDriver:Navigate", { url });
      return client.execute(`const browser = window.wrappedJSObject.browser;\n${script}`, args, { async: true });
    },
    // Opens the real popup page in the tab and waits until it has drawn.
    async openPopup() {
      await client.send("WebDriver:Navigate", { url: `moz-extension://${b.uuid}/popup.html` });
      await sleep(300);
    },
    // Runs a plain (synchronous) function body in the current page.
    inPage: (script, args = []) => client.execute(script, args),

    // Counts how often Firefox restyles the browser window for a theme change
    // (each one is a full repaint of the chrome).
    async startRepaintCounter() {
      await b.chrome(`
        if (!window.__bt) {
          window.__bt = { n: 0, obs: { observe() { window.__bt.n++; } } };
          Services.obs.addObserver(window.__bt.obs, "lightweight-theme-styling-update");
        }
        window.__bt.n = 0;`);
    },
    repaints: () => b.chrome(`return window.__bt ? window.__bt.n : -1;`),
    setPref: (name, value) => b.chrome(`
      const [name, value] = arguments;
      if (typeof value === "boolean") Services.prefs.setBoolPref(name, value);
      else if (typeof value === "number") Services.prefs.setIntPref(name, value);
      else Services.prefs.setStringPref(name, value);`, [name, value]),
    async setSettings(patch) {
      return b.inExtensionPage(`
        const [patch, done] = arguments;
        browser.storage.local.get("settings").then(({ settings }) =>
          browser.storage.local.set({ settings: { ...(settings || {}), ...patch } })).then(() => done(true));`,
        [patch]);
    },
    session: () => b.inExtensionPage(
      `const done = arguments[0]; browser.storage.session.get(null).then(done);`),

    async screenshot(file) {
      await client.setContext("chrome");
      try {
        const res = await client.send("WebDriver:TakeScreenshot", { full: true });
        fs.writeFileSync(file, Buffer.from(res.value, "base64"));
      } finally {
        await client.setContext("content");
      }
      return file;
    },

    async close() {
      try {
        await Promise.race([client.send("Marionette:Quit", { flags: ["eForceQuit"] }), sleep(5000)]);
      } catch {}
      client.close();
      for (let i = 0; i < 50 && !exited; i++) await sleep(100);
      if (!exited) child.kill("SIGKILL");
      if (!process.env.BATTERY_E2E_KEEP) {
        // macOS marks some folders it creates in the fake home (Downloads,
        // Desktop) as protected; leftovers in the temp folder are harmless.
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
    },
  };

  // A language pack (an .xpi from Mozilla) switches the browser UI language,
  // e.g. to Arabic for right-to-left tests. Must happen before the extension
  // loads, because the extension reads the direction once at start.
  if (opts.langpack) {
    await client.send("Addon:Install", { path: opts.langpack.path, temporary: false });
    await b.setPref("intl.locale.requested", opts.langpack.locale);
    await sleep(1500);
  }
  if (opts.install !== false) await b.install();
  return b;
}

function firefoxVersion(firefox = findFirefox()) {
  if (!firefox) return null;
  const out = spawnSync(firefox, ["--version"], { encoding: "utf8" }).stdout || "";
  const m = out.match(/(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), text: out.trim() } : null;
}

module.exports = { launch, findFirefox, firefoxVersion, sleep, ROOT, ADDON_ID, HOST_NAME, BUTTON_ID };
