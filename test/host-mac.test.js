// Tests the macOS host against a fake pmset: state parsing, message framing,
// change events, and clean shutdown. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST = path.join(__dirname, "..", "host", "mac", "battery-host.sh");
const FAKE_BIN = path.join(__dirname, "fake-bin");

function fakeDir(batt, { lowPower = false, dark = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-test-"));
  fs.writeFileSync(path.join(dir, "batt"), batt);
  fs.writeFileSync(path.join(dir, "lowpower"), lowPower ? "1" : "0");
  if (dark) fs.writeFileSync(path.join(dir, "dark"), "");
  return dir;
}

function env(dir, extra = {}) {
  return { ...process.env, PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_DIR: dir, ...extra };
}

function stateFor(batt, opts) {
  const r = spawnSync("/bin/bash", [HOST, "--json"], { env: env(fakeDir(batt, opts)), encoding: "utf8" });
  return JSON.parse(r.stdout);
}

// Split a native-messaging byte stream into parsed messages.
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

const line = (rest) => `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t${rest}\n`;
const acLine = (rest) => `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t${rest}\n`;

test("discharging with estimate", () => {
  assert.deepStrictEqual(stateFor(line("78%; discharging; 3:12 remaining present: true"), { dark: true }), {
    v: 1, has_battery: true, percentage: 78, on_ac: false, charging: false, charged: false,
    minutes_remaining: 192, low_power: false, dark: true,
  });
});

test("discharging without estimate, low power mode", () => {
  const s = stateFor(line("9%; discharging; (no estimate) present: true"), { lowPower: true });
  assert.strictEqual(s.percentage, 9);
  assert.strictEqual(s.minutes_remaining, null);
  assert.strictEqual(s.low_power, true);
  assert.strictEqual(s.dark, false);
});

test("charging", () => {
  const s = stateFor(acLine("41%; charging; 1:08 remaining present: true"));
  assert.deepStrictEqual([s.on_ac, s.charging, s.charged, s.minutes_remaining], [true, true, false, 68]);
});

test("finishing charge counts as charging", () => {
  const s = stateFor(acLine("99%; finishing charge; 0:05 remaining present: true"));
  assert.deepStrictEqual([s.on_ac, s.charging, s.charged], [true, true, false]);
});

test("fully charged: 0:00 is not an estimate", () => {
  const s = stateFor(acLine("100%; charged; 0:00 remaining present: true"));
  assert.deepStrictEqual([s.on_ac, s.charging, s.charged, s.minutes_remaining], [true, false, true, null]);
});

test("plugged in but held (optimized charging)", () => {
  const s = stateFor(acLine("80%; AC attached; not charging present: true"));
  assert.deepStrictEqual([s.percentage, s.on_ac, s.charging, s.charged], [80, true, false, false]);
});

test("desktop with no battery", () => {
  const s = stateFor("Now drawing from 'AC Power'\n");
  assert.deepStrictEqual([s.has_battery, s.percentage, s.on_ac], [false, null, true]);
});

test("streams a framed message at start and on a power event, then exits when stdin closes", async () => {
  const dir = fakeDir(line("55%; discharging; 2:00 remaining present: true"));
  const child = spawn("/bin/bash", [HOST], { env: env(dir, { BATTERY_THEME_HEARTBEAT: "30" }) });
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

  // Plug in: the fake pslog announces it, well inside the 30s heartbeat.
  const t0 = Date.now();
  fs.writeFileSync(path.join(dir, "batt.next"), acLine("55%; charging; 1:30 remaining present: true"));
  assert.ok(await until(() => messages().length === 2, 3000), "event message arrives without waiting for the heartbeat");
  assert.ok(Date.now() - t0 < 3000);
  assert.strictEqual(messages()[1].on_ac, true);
  assert.strictEqual(messages()[1].charging, true);

  const exited = new Promise((r) => child.on("exit", r));
  child.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 3000))]);
  assert.strictEqual(code, 0, "host exits cleanly when Firefox closes stdin");
});

test("desktop Mac on a UPS: the UPS is not treated as a laptop battery", () => {
  const onMains = stateFor("Now drawing from 'AC Power'\n -UPS CP1500 (id=1234)\t100%; charging present: true\n");
  assert.deepStrictEqual([onMains.has_battery, onMains.percentage, onMains.on_ac], [false, null, true]);
  const onUps = stateFor("Now drawing from 'UPS Power'\n -UPS CP1500 (id=1234)\t64%; discharging; 0:22 remaining present: true\n");
  assert.deepStrictEqual([onUps.has_battery, onUps.percentage], [false, null]);
});

test("odd pmset output: empty, garbage, 0% and 100% all give a valid message", () => {
  for (const text of ["", "pmset: command failed\n", "Now drawing from 'Battery Power'\n"]) {
    const s = stateFor(text);
    assert.strictEqual(s.has_battery, false, JSON.stringify(text));
    assert.strictEqual(s.v, 1);
  }
  const zero = stateFor("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t0%; discharging; (no estimate) present: true\n");
  assert.deepStrictEqual([zero.has_battery, zero.percentage, zero.minutes_remaining], [true, 0, null]);
  const full = stateFor("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n");
  assert.deepStrictEqual([full.percentage, full.charged, full.on_ac], [100, true, true]);
});
