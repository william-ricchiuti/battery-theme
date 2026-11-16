// Tests the Linux host against a fake sysfs tree (it is plain bash, so this
// runs on macOS too): parsing, multiple batteries, time estimates, change
// detection and clean shutdown. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = path.join(__dirname, "..", "host", "linux", "battery-host.sh");
const FAKE_BIN = path.join(__dirname, "fake-bin-linux");

// supplies: { BAT0: { type: "Battery", capacity: 78, ... }, AC: { type: "Mains", online: 1 } }
function sysfs(supplies) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sysfs-"));
  for (const [name, files] of Object.entries(supplies)) write(dir, name, files);
  return dir;
}
function write(dir, name, files) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  for (const [file, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name, file), `${value}\n`);
}

function env(dir, { tools = false, fake = {} } = {}) {
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-fake-"));
  for (const [file, value] of Object.entries(fake)) fs.writeFileSync(path.join(fakeDir, file), `${value}\n`);
  // Without tools, use a PATH that has neither gsettings nor powerprofilesctl.
  const PATH = tools ? `${FAKE_BIN}:/usr/bin:/bin` : "/usr/bin:/bin";
  return { PATH, HOME: os.homedir(), BATTERY_THEME_SYSFS: dir, FAKE_DIR: fakeDir };
}

const stateFor = (supplies, opts) =>
  JSON.parse(spawnSync("/bin/bash", [HOST, "--json"], { env: env(sysfs(supplies), opts), encoding: "utf8" }).stdout);

function decode(buf) {
  const out = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    if (off + 4 + len > buf.length) break;
    out.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString("utf8")));
    off += 4 + len;
  }
  return out;
}

const battery = (extra) => ({ type: "Battery", scope: "System", ...extra });

test("discharging, with a time estimate from energy and power", () => {
  const s = stateFor({
    BAT0: battery({ capacity: 60, status: "Discharging", energy_now: 30000000, energy_full: 50000000, power_now: 10000000 }),
    AC: { type: "Mains", online: 0 },
  });
  assert.deepStrictEqual(s, {
    v: 1, has_battery: true, percentage: 60, on_ac: false, charging: false, charged: false,
    minutes_remaining: 180, low_power: false, dark: null,
  });
});

test("charging, estimate from charge and current figures", () => {
  const s = stateFor({
    BAT1: battery({ capacity: 50, status: "Charging", charge_now: 2000000, charge_full: 4000000, current_now: 2000000 }),
    ADP1: { type: "Mains", online: 1 },
  });
  assert.deepStrictEqual([s.on_ac, s.charging, s.charged, s.minutes_remaining], [true, true, false, 60]);
});

test("full on AC", () => {
  const s = stateFor({ BAT0: battery({ capacity: 100, status: "Full" }), AC: { type: "Mains", online: 1 } });
  assert.deepStrictEqual([s.percentage, s.on_ac, s.charging, s.charged, s.minutes_remaining], [100, true, false, true, null]);
});

test("held below full (charge threshold): plugged in, not charging", () => {
  const s = stateFor({ BAT0: battery({ capacity: 80, status: "Not charging" }), AC: { type: "Mains", online: 1 } });
  assert.deepStrictEqual([s.percentage, s.on_ac, s.charging, s.charged], [80, true, false, false]);
});

test("USB-C charger reported as a USB supply counts as plugged in", () => {
  const s = stateFor({
    BAT0: battery({ capacity: 40, status: "Unknown" }),
    "ucsi-source-psy-1": { type: "USB", online: 1 },
  });
  assert.strictEqual(s.on_ac, true);
});

test("two batteries: percentage is weighted by capacity; a draining one means on battery", () => {
  const s = stateFor({
    BAT0: battery({ capacity: 100, status: "Full", energy_now: 20000000, energy_full: 20000000, power_now: 0 }),
    BAT1: battery({ capacity: 25, status: "Discharging", energy_now: 15000000, energy_full: 60000000, power_now: 7000000 }),
    AC: { type: "Mains", online: 0 },
  });
  // (20 + 15) / (20 + 60) = 43.75% -> 44
  assert.deepStrictEqual([s.percentage, s.on_ac, s.charging, s.charged, s.minutes_remaining], [44, false, false, false, 300]);
});

test("peripheral batteries are ignored; no laptop battery means has_battery false", () => {
  const s = stateFor({
    hidpp_battery_0: { type: "Battery", scope: "Device", capacity: 15, status: "Discharging" },
    AC: { type: "Mains", online: 1 },
  });
  assert.deepStrictEqual([s.has_battery, s.percentage], [false, null]);
});

test("zero or absurd power draw gives no estimate", () => {
  const idle = stateFor({ BAT0: battery({ capacity: 60, status: "Discharging", energy_now: 30000000, energy_full: 50000000, power_now: 0 }) });
  assert.strictEqual(idle.minutes_remaining, null);
  const settling = stateFor({ BAT0: battery({ capacity: 60, status: "Discharging", energy_now: 30000000, energy_full: 50000000, power_now: 1000 }) });
  assert.strictEqual(settling.minutes_remaining, null);
});

test("dark mode and power-saver come from gsettings / powerprofilesctl when present", () => {
  const supplies = { BAT0: battery({ capacity: 60, status: "Discharging" }) };
  const dark = stateFor(supplies, { tools: true, fake: { "color-scheme": "'prefer-dark'", "power-profile": "power-saver" } });
  assert.deepStrictEqual([dark.dark, dark.low_power], [true, true]);
  const light = stateFor(supplies, { tools: true });
  assert.deepStrictEqual([light.dark, light.low_power], [false, false]);
});

test("streams a framed message at start and when the state changes, then exits when stdin closes", async () => {
  const dir = sysfs({ BAT0: battery({ capacity: 55, status: "Discharging" }), AC: { type: "Mains", online: 0 } });
  const child = spawn("/bin/bash", [HOST], { env: { ...env(dir), BATTERY_THEME_POLL: "1" } });
  const chunks = [];
  child.stdout.on("data", (c) => chunks.push(c));
  const messages = () => decode(Buffer.concat(chunks));
  const until = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  assert.ok(await until(() => messages().length === 1, 3000), "first message arrives immediately");
  assert.strictEqual(messages()[0].percentage, 55);

  // Nothing is sent while nothing changes.
  await new Promise((r) => setTimeout(r, 2200));
  assert.strictEqual(messages().length, 1, "no message for an unchanged state");

  write(dir, "BAT0", { status: "Charging" });
  write(dir, "AC", { online: 1 });
  assert.ok(await until(() => messages().length === 2, 4000), "change is picked up on the next poll");
  assert.deepStrictEqual([messages()[1].on_ac, messages()[1].charging], [true, true]);

  const exited = new Promise((r) => child.on("exit", r));
  child.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 3000))]);
  assert.strictEqual(code, 0, "host exits cleanly when Firefox closes stdin");
});
