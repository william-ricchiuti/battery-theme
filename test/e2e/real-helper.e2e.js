// End-to-end with the REAL helper script for this OS, started by a real
// Firefox through a real native-messaging manifest. Only the battery itself
// is fake: a canned `pmset` on macOS, a made-up sysfs folder on Linux.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { launch, findFirefox, sleep, ROOT } = require("./harness.js");
const C = require("../../extension/theme-colors.js");

const platform = process.platform === "darwin" ? "mac" : process.platform === "linux" ? "linux" : null;
const skip = !findFirefox() ? "no Firefox found (set FIREFOX_BIN)" : !platform ? "no shell helper for this OS" : false;
const rgb = (c) => C.css(c);
const frameFor = (state) => rgb(C.buildTheme({ dark: true, ...state }, {}).raw.frame);

// Returns { env, set(percentage, plugged) } for a fake battery.
function fakeBattery() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "bt-batt-"));
  if (platform === "mac") {
    const text = (p, plugged) => plugged
      ? `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t${p}%; charging; 1:00 remaining present: true\n`
      : `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${p}%; discharging; 3:00 remaining present: true\n`;
    fs.writeFileSync(path.join(dir, "dark"), "");
    // Copied out of the repo: macOS will not let a process started by
    // Firefox run files from protected folders such as ~/Desktop.
    const bin = path.join(dir, "bin");
    fs.cpSync(path.join(ROOT, "test", "fake-bin"), bin, { recursive: true });
    return {
      dir,
      env: { FAKE_DIR: dir, PATH: `${bin}:${process.env.PATH}`, BATTERY_THEME_HEARTBEAT: "2" },
      set(p, plugged, first) {
        // The fake pmset announces batt.next as a power event; the first reading is just there.
        fs.writeFileSync(path.join(dir, first ? "batt" : "batt.next"), text(p, plugged));
      },
    };
  }
  const bat = path.join(dir, "BAT0"), ac = path.join(dir, "AC");
  fs.mkdirSync(bat);
  fs.mkdirSync(ac);
  fs.writeFileSync(path.join(bat, "type"), "Battery\n");
  fs.writeFileSync(path.join(ac, "type"), "Mains\n");
  return {
    dir,
    env: { BATTERY_THEME_SYSFS: dir, BATTERY_THEME_POLL: "1" },
    set(p, plugged) {
      fs.writeFileSync(path.join(bat, "capacity"), `${p}\n`);
      fs.writeFileSync(path.join(bat, "status"), plugged ? "Charging\n" : "Discharging\n");
      fs.writeFileSync(path.join(ac, "online"), plugged ? "1\n" : "0\n");
    },
  };
}

test("the real helper, started by a real Firefox, drives the theme and exits with it", { skip }, async () => {
  const battery = fakeBattery();
  battery.set(64, false, true);
  // Install into a scratch folder exactly as a user would, then register that copy.
  const helper = path.join(battery.dir, "battery-host.sh");
  fs.copyFileSync(path.join(ROOT, "host", platform, "battery-host.sh"), helper);
  fs.chmodSync(helper, 0o755);
  const b = await launch({ helper: { path: helper }, env: battery.env });
  let pids = "";
  try {
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 64 }), "64% from the real helper", 10000);
    assert.strictEqual((await b.session()).view.state.v, 1);
    pids = spawnSync("pgrep", ["-f", helper], { encoding: "utf8" }).stdout.trim();
    assert.ok(pids, "helper process is running");

    // Plug in: the theme turns blue within a few seconds.
    battery.set(64, true);
    await b.waitForTheme((t) => t.frame === frameFor({ percentage: 64, on_ac: true, charging: true }), "charging", 8000);
  } finally {
    await b.close();
  }
  let left = "x";
  for (let i = 0; i < 80 && left; i++) {
    await sleep(100);
    left = spawnSync("pgrep", ["-f", helper], { encoding: "utf8" }).stdout.trim();
  }
  assert.strictEqual(left, "", "no helper process left after Firefox quit");
  fs.rmSync(battery.dir, { recursive: true, force: true });
});
