// If Firefox dies without closing the helper's stdin (crash, force-quit), the
// helper must notice its parent is gone and exit, taking its children along.
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starts `bash <host>` under a wrapper shell that stands in for Firefox. The
// helper's stdin is a FIFO whose write end is held by an unrelated process
// (`holder`), so killing the wrapper does NOT give the helper an EOF: exactly
// the case where only the parent check can save it.
async function startUnderWrapper(host, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-fifo-"));
  const fifo = path.join(dir, "stdin");
  spawnSync("mkfifo", [fifo]);
  const holder = spawn("/bin/bash", ["-c", 'exec sleep 60 > "$0"', fifo], { stdio: "ignore" });
  const wrapper = spawn("/bin/bash", ["-c", 'bash "$0" < "$1" & echo "$!" >&2; wait', host, fifo], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
    detached: true, // own process group, so cleanup can sweep up any stragglers
  });
  let err = "";
  wrapper.stderr.on("data", (c) => (err += c));
  for (let i = 0; i < 60 && !/^\d+\s/.test(err); i++) await sleep(50);
  const hostPid = Number(err.trim().split(/\s+/)[0]);
  assert.ok(hostPid > 0, `could not read helper pid from: ${err}`);
  return { wrapper, holder, hostPid };
}

async function expectExitAfterParentKilled(host, env, childPattern) {
  const { wrapper, holder, hostPid } = await startUnderWrapper(host, env);
  try {
    await sleep(1500); // let it send its first reading and settle into its loop
    assert.ok(alive(hostPid), "helper is running");

    wrapper.kill("SIGKILL"); // "Firefox" dies; the stdin pipe stays open
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) {
      await sleep(100);
      gone = !alive(hostPid);
    }
    assert.ok(gone, "helper exited within 10s of its parent dying, with stdin still open");
    if (childPattern) {
      await sleep(300);
      const left = spawnSync("pgrep", ["-f", childPattern], { encoding: "utf8" }).stdout.trim();
      assert.strictEqual(left, "", `leftover child processes: ${left}`);
    }
  } finally {
    holder.kill("SIGKILL");
    // On failure the helper and its children are still around; kill the whole
    // group so the test run cannot hang on their open pipes.
    try { process.kill(-wrapper.pid, "SIGKILL"); } catch {}
  }
}

test("mac helper exits when its parent is killed, leaving no pmset watcher or temp dir", async () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), "bt-test-"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-tmp-"));
  fs.writeFileSync(path.join(fake, "batt"), "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t55%; discharging; 2:00 remaining present: true\n");
  fs.writeFileSync(path.join(fake, "lowpower"), "0");
  const env = {
    ...process.env,
    PATH: `${path.join(__dirname, "fake-bin")}:${process.env.PATH}`,
    FAKE_DIR: fake,
    TMPDIR: tmp,
    BATTERY_THEME_HEARTBEAT: "1",
  };
  await expectExitAfterParentKilled(path.join(ROOT, "host", "mac", "battery-host.sh"), env, "fake-bin/pmset");
  assert.deepStrictEqual(fs.readdirSync(tmp), [], "temp dir cleaned up");
});

test("linux helper exits when its parent is killed", async () => {
  const sysfs = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sysfs-"));
  fs.mkdirSync(path.join(sysfs, "BAT0"));
  for (const [f, v] of Object.entries({ type: "Battery", scope: "System", capacity: 55, status: "Discharging" })) {
    fs.writeFileSync(path.join(sysfs, "BAT0", f), `${v}\n`);
  }
  const env = { PATH: "/usr/bin:/bin", HOME: os.homedir(), BATTERY_THEME_SYSFS: sysfs, BATTERY_THEME_POLL: "1" };
  await expectExitAfterParentKilled(path.join(ROOT, "host", "linux", "battery-host.sh"), env, null);
});
