// Tests the Windows host (host/windows/battery-host.ps1) with its OS reads
// replaced by test/windows/fake-os.ps1: state mapping, framing, change-only
// output, failure handling and shutdown. Run with: npm test
//
// The script is run by a real PowerShell:
//   - `powershell` or `pwsh` from PATH when there is one (a Windows CI runner
//     uses Windows PowerShell 5.1, the version the helper targets), else
//   - PowerShell 7 on Linux in Docker, when the image is already pulled:
//       docker pull mcr.microsoft.com/powershell:lts-7.4-azurelinux-3.0-arm64   (arm64)
//       docker pull mcr.microsoft.com/powershell:lts-7.4-azurelinux-3.0         (x64)
//     (override with BATTERY_THEME_PWSH_IMAGE).
// With neither, the PowerShell tests are skipped. Nothing here calls a real
// Windows API, except the last test when it runs on Windows.
const test = require("node:test");
const assert = require("node:assert");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const WIN_DIR = path.join(ROOT, "host", "windows");
const HOST_REL = ["host", "windows", "battery-host.ps1"];
const HOOK_REL = ["test", "windows", "fake-os.ps1"];
const IMAGE =
  process.env.BATTERY_THEME_PWSH_IMAGE ||
  `mcr.microsoft.com/powershell:lts-7.4-azurelinux-3.0${process.arch === "arm64" ? "-arm64" : ""}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Runner: native PowerShell, or one Docker container reused by every test.
// ---------------------------------------------------------------------------

let runner = null;
let skipReason = "";
let workDir = null;

function findRunner() {
  const names = process.platform === "win32" ? ["powershell", "pwsh"] : ["pwsh", "powershell"];
  for (const exe of names) {
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (r.status === 0) return { kind: "native", exe, version: r.stdout.trim() };
  }
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 15000 }).status !== 0) {
    skipReason = "no powershell/pwsh on PATH and docker is not available";
    return null;
  }
  if (spawnSync("docker", ["image", "inspect", IMAGE], { timeout: 15000 }).status !== 0) {
    skipReason = `no powershell/pwsh on PATH and the Docker image is not pulled (docker pull ${IMAGE})`;
    return null;
  }
  const r = spawnSync(
    "docker",
    ["run", "-d", "--rm", "--init", "-v", `${ROOT}:/repo:ro`, "-v", `${workDir}:/work`, IMAGE, "sleep", "900"],
    { encoding: "utf8", timeout: 60000 },
  );
  if (r.status !== 0) {
    skipReason = `could not start the Docker container: ${r.stderr.trim()}`;
    return null;
  }
  return { kind: "docker", id: r.stdout.trim() };
}

test.before(() => {
  workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bt-win-")));
  runner = findRunner();
});

test.after(() => {
  if (runner && runner.kind === "docker") spawnSync("docker", ["rm", "-f", runner.id], { timeout: 30000 });
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

// Path of a repo file / work file as the PowerShell process sees it.
const repoPath = (parts) => (runner.kind === "docker" ? `/repo/${parts.join("/")}` : path.join(ROOT, ...parts));
const seenPath = (dir) => (runner.kind === "docker" ? `/work/${path.basename(dir)}` : dir);

// Command line that runs the helper with the given environment additions.
function command(args, env) {
  const ps = ["-NoProfile", "-NonInteractive"];
  if (runner.kind === "docker") {
    const e = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return { cmd: "docker", argv: ["exec", "-i", ...e, runner.id, "pwsh", ...ps, "-File", repoPath(HOST_REL), ...args], env: process.env };
  }
  if (process.platform === "win32") ps.push("-ExecutionPolicy", "Bypass");
  return { cmd: runner.exe, argv: [...ps, "-File", repoPath(HOST_REL), ...args], env: { ...process.env, ...env } };
}

let counter = 0;
function fakeDir(power, dark) {
  const dir = path.join(workDir, `case${++counter}`);
  fs.mkdirSync(dir);
  setPower(dir, power);
  if (dark !== undefined) fs.writeFileSync(path.join(dir, "dark"), String(dark));
  return dir;
}

// Replaces the file in one step so the helper never reads half of it.
function setPower(dir, power) {
  const tmp = path.join(dir, "power.tmp");
  fs.writeFileSync(tmp, typeof power === "string" ? power : JSON.stringify(power));
  fs.renameSync(tmp, path.join(dir, "power.json"));
}

function hookEnv(dir, extra = {}) {
  return { BATTERY_THEME_TEST_HOOK: repoPath(HOOK_REL), BT_FAKE_DIR: seenPath(dir), ...extra };
}

function runOnce(args, dir, extra) {
  const c = command(args, hookEnv(dir, extra));
  return spawnSync(c.cmd, c.argv, { env: c.env, timeout: 30000 });
}

function jsonFor(power, dark) {
  const r = runOnce(["-Json"], fakeDir(power, dark));
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  const text = r.stdout.toString("utf8");
  assert.match(text, /^\{[^\n]*\}\r?\n$/, "one line of JSON and nothing else");
  return JSON.parse(text);
}

// Splits a native-messaging byte stream into messages; `rest` is what is left
// over (must be empty: any stray byte on stdout breaks the protocol).
function decode(buf) {
  const messages = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    if (off + 4 + len > buf.length) break;
    messages.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString("utf8")));
    off += 4 + len;
  }
  return { messages, rest: buf.length - off };
}

function start(dir, extra) {
  const c = command([], hookEnv(dir, extra));
  const child = spawn(c.cmd, c.argv, { env: c.env, stdio: ["pipe", "pipe", "pipe"] });
  const chunks = [];
  let stderr = "";
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => (stderr += d));
  child.stdin.on("error", () => {});
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const h = {
    child,
    exited,
    stderr: () => stderr,
    messages: () => decode(Buffer.concat(chunks)).messages,
    rest: () => decode(Buffer.concat(chunks)).rest,
    until: async (pred, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (pred()) return true;
        await sleep(25);
      }
      return pred();
    },
    exitWithin: (ms) => Promise.race([exited, sleep(ms).then(() => "timeout")]),
    stop: async () => {
      child.stdin.end();
      if ((await h.exitWithin(3000)) === "timeout") child.kill("SIGKILL");
    },
  };
  return h;
}

// SYSTEM_POWER_STATUS values. flag: 1 high, 2 low, 4 critical, 8 charging,
// 128 no system battery, 255 unknown. seconds: -1 unknown.
const DISCHARGING = { ac: 0, flag: 1, percent: 78, saver: 0, seconds: 11520 };
const CHARGING = { ac: 1, flag: 9, percent: 41, saver: 0, seconds: -1 };
const FULL = { ac: 1, flag: 1, percent: 100, saver: 0, seconds: -1 };
const HELD = { ac: 1, flag: 0, percent: 80, saver: 0, seconds: -1 };
const NO_BATTERY = { ac: 1, flag: 128, percent: 255, saver: 0, seconds: -1 };

const ps = (name, fn) =>
  test(name, async (t) => {
    if (!runner) return t.skip(skipReason);
    await fn(t);
  });

// ---------------------------------------------------------------------------
// Static checks (no PowerShell needed)
// ---------------------------------------------------------------------------

test("scripts are ASCII; batch files use CRLF and no delayed expansion", () => {
  for (const f of ["battery-host.ps1", "battery-host.bat", "install.bat", "uninstall.bat"]) {
    const buf = fs.readFileSync(path.join(WIN_DIR, f));
    // Windows PowerShell 5.1 and cmd.exe read these in a legacy code page.
    assert.ok(buf.every((b) => b < 0x80), `${f} is pure ASCII`);
    if (f.endsWith(".bat")) {
      const text = buf.toString("latin1");
      // cmd.exe can misread labels in batch files with bare LF line ends.
      assert.ok(!/(^|[^\r])\n/.test(text), `${f} has CRLF line endings`);
      // With delayed expansion on, a "!" in the user profile path is eaten.
      assert.ok(!/^\s*setlocal\b.*\benabledelayedexpansion\b/im.test(text), `${f} leaves delayed expansion off`);
    }
  }
  assert.ok(fs.readFileSync(path.join(ROOT, ...HOOK_REL)).every((b) => b < 0x80), "fake-os.ps1 is pure ASCII");
});

test("manifest, wrapper, installer and uninstaller agree on names and paths", () => {
  const name = "com.williamricchiuti.batterytheme";
  const manifest = JSON.parse(fs.readFileSync(path.join(WIN_DIR, `${name}.json`), "utf8"));
  assert.deepStrictEqual(manifest, {
    name,
    description: manifest.description,
    path: "battery-host.bat", // relative to the manifest: allowed on Windows
    type: "stdio",
    allowed_extensions: ["battery-theme@willy.dev"],
  });

  const wrapper = fs.readFileSync(path.join(WIN_DIR, "battery-host.bat"), "utf8");
  assert.strictEqual(wrapper.trim().split(/\r\n/).length, 1, "wrapper is a single line");
  assert.match(wrapper, /-File "%~dp0battery-host\.ps1"\s*$/);

  const key = `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\%HOST_NAME%`;
  for (const f of ["install.bat", "uninstall.bat"]) {
    const text = fs.readFileSync(path.join(WIN_DIR, f), "utf8");
    assert.ok(text.includes(`set "HOST_NAME=${name}"`), `${f}: host name`);
    assert.ok(text.includes('set "DEST=%LOCALAPPDATA%\\battery-theme"'), `${f}: install folder`);
    assert.ok(text.includes(`set "REG_KEY=${key}"`), `${f}: registry key`);
  }
  const install = fs.readFileSync(path.join(WIN_DIR, "install.bat"), "utf8");
  for (const f of ["battery-host.ps1", "battery-host.bat", "%HOST_NAME%.json"]) {
    assert.ok(install.includes(`copy /y "%SRC%${f}" "%DEST%\\${f}"`), `install copies ${f}`);
  }
  const uninstall = fs.readFileSync(path.join(WIN_DIR, "uninstall.bat"), "utf8");
  for (const f of ["battery-host.ps1", "battery-host.bat", "%HOST_NAME%.json"]) {
    assert.ok(uninstall.includes(`del /f /q "%DEST%\\${f}"`), `uninstall deletes ${f}`);
  }
  assert.ok(!/rmdir\s+\/s|rd\s+\/s|del\s+[^\r\n]*\*/i.test(uninstall), "uninstall never deletes recursively or by wildcard");
});

// ---------------------------------------------------------------------------
// State mapping (-Json)
// ---------------------------------------------------------------------------

ps("discharging with an estimate, dark apps", () => {
  assert.deepStrictEqual(jsonFor(DISCHARGING, 0), {
    v: 1, has_battery: true, percentage: 78, on_ac: false, charging: false, charged: false,
    minutes_remaining: 192, low_power: false, dark: true,
  });
});

ps("charging: no estimate, light apps", () => {
  // Windows can leave a stale number in the estimate while charging.
  assert.deepStrictEqual(jsonFor({ ...CHARGING, seconds: 4000 }, 1), {
    v: 1, has_battery: true, percentage: 41, on_ac: true, charging: true, charged: false,
    minutes_remaining: null, low_power: false, dark: false,
  });
});

ps("full on mains is charged; light/dark unknown is null", () => {
  assert.deepStrictEqual(jsonFor(FULL), {
    v: 1, has_battery: true, percentage: 100, on_ac: true, charging: false, charged: true,
    minutes_remaining: null, low_power: false, dark: null,
  });
});

ps("plugged in but not charging (held below full)", () => {
  const s = jsonFor(HELD, 0);
  assert.deepStrictEqual([s.percentage, s.on_ac, s.charging, s.charged, s.minutes_remaining], [80, true, false, false, null]);
});

ps("no battery", () => {
  assert.deepStrictEqual(jsonFor(NO_BATTERY, 0), {
    v: 1, has_battery: false, percentage: null, on_ac: true, charging: false, charged: false,
    minutes_remaining: null, low_power: false, dark: true,
  });
});

ps("percentage is clamped to 100; Battery Saver sets low_power", () => {
  const s = jsonFor({ ac: 0, flag: 2, percent: 150, saver: 1, seconds: -1 });
  assert.deepStrictEqual([s.percentage, s.low_power, s.minutes_remaining], [100, true, null]);
  assert.strictEqual(jsonFor({ ...DISCHARGING, percent: 0, flag: 4 }).percentage, 0);
});

ps("nonsense estimates become null", () => {
  for (const seconds of [0, 30, -1, -500, 400000, 2147483647]) {
    assert.strictEqual(jsonFor({ ...DISCHARGING, seconds }).minutes_remaining, null, `seconds=${seconds}`);
  }
  assert.strictEqual(jsonFor({ ...DISCHARGING, seconds: 60 }).minutes_remaining, 1);
});

ps("a failed or unknown read exits non-zero and prints no state", () => {
  const unknownFlag = { ...DISCHARGING, flag: 255 };
  const unknownLevel = { ...DISCHARGING, percent: 255 };
  for (const [power, args] of [["FAIL", ["-Json"]], ["FAIL", ["-Once"]], [unknownFlag, ["-Json"]], [unknownLevel, ["-Json"]]]) {
    const r = runOnce(args, fakeDir(power, 0));
    assert.strictEqual(r.status, 1, `${JSON.stringify(power)} ${args}: exit code`);
    assert.strictEqual(r.stdout.length, 0, "nothing on stdout");
    assert.match(r.stderr.toString(), /battery-host: /);
  }
});

// ---------------------------------------------------------------------------
// Framing and the long-running loop
// ---------------------------------------------------------------------------

ps("-Once writes one framed message: length prefix equals the byte length", () => {
  const r = runOnce(["-Once"], fakeDir(DISCHARGING, 0));
  assert.strictEqual(r.status, 0, r.stderr.toString());
  const len = r.stdout.readUInt32LE(0);
  assert.strictEqual(len, r.stdout.length - 4);
  const body = r.stdout.subarray(4).toString("utf8");
  assert.strictEqual(Buffer.byteLength(body, "utf8"), len);
  assert.strictEqual(JSON.parse(body).percentage, 78);
  assert.ok(!body.endsWith("\n"));
});

ps("emits at start and then only on change; a failed read is not 'no battery'", async () => {
  const dir = fakeDir({ ...DISCHARGING, percent: 55 }, 0);
  const h = start(dir, { BT_POLL_MS: "150", BT_MAX_FAILURES: "1000" });
  try {
    assert.ok(await h.until(() => h.messages().length === 1, 8000), `first message arrives: ${h.stderr()}`);
    assert.strictEqual(h.messages()[0].percentage, 55);

    await sleep(900); // several polls of an unchanged state
    assert.strictEqual(h.messages().length, 1, "nothing is sent while the state is unchanged");

    // Only the estimate moves: held back (default gap is a minute).
    setPower(dir, { ...DISCHARGING, percent: 55, seconds: 11000 });
    await sleep(700);
    assert.strictEqual(h.messages().length, 1, "a change in the estimate alone is not sent straight away");

    const t0 = Date.now();
    setPower(dir, { ...CHARGING, percent: 55 });
    assert.ok(await h.until(() => h.messages().length === 2, 3000), "plugging in is sent");
    assert.ok(Date.now() - t0 < 2000, "within a few polls");
    assert.deepStrictEqual([h.messages()[1].on_ac, h.messages()[1].charging], [true, true]);

    setPower(dir, "FAIL");
    await sleep(900);
    assert.strictEqual(h.messages().length, 2, "failed reads send nothing");
    assert.strictEqual(h.child.exitCode, null, "and the helper keeps running");

    setPower(dir, { ...CHARGING, percent: 55 });
    await sleep(600);
    assert.strictEqual(h.messages().length, 2, "the same state after a failure is not sent again");

    setPower(dir, { ...CHARGING, percent: 56 });
    assert.ok(await h.until(() => h.messages().length === 3, 3000), "the next real change is sent");
    assert.strictEqual(h.messages()[2].percentage, 56);

    setPower(dir, NO_BATTERY);
    assert.ok(await h.until(() => h.messages().length === 4, 3000));
    assert.strictEqual(h.messages()[3].has_battery, false);

    assert.ok(h.messages().slice(0, 3).every((m) => m.has_battery === true));
    assert.strictEqual(h.rest(), 0, "stdout holds whole framed messages and nothing else");
    assert.match(h.stderr(), /read failed, keeping the last reading/);
  } finally {
    await h.stop();
  }
});

ps("estimate changes are sent once the gap has passed; light/dark is re-read", async () => {
  const dir = fakeDir(DISCHARGING, 0);
  const h = start(dir, { BT_POLL_MS: "100", BT_ESTIMATE_GAP_MS: "300", BT_SLOW_MS: "300" });
  try {
    assert.ok(await h.until(() => h.messages().length === 1, 8000), `first message arrives: ${h.stderr()}`);
    setPower(dir, { ...DISCHARGING, seconds: 6000 });
    assert.ok(await h.until(() => h.messages().length === 2, 3000), "new estimate is sent");
    assert.strictEqual(h.messages()[1].minutes_remaining, 100);

    // No estimate -> estimate (and back) is a real change, never held back.
    setPower(dir, { ...DISCHARGING, seconds: -1 });
    assert.ok(await h.until(() => h.messages().length === 3, 3000));
    assert.strictEqual(h.messages()[2].minutes_remaining, null);

    fs.writeFileSync(path.join(dir, "dark"), "1");
    assert.ok(await h.until(() => h.messages().length === 4, 3000), "switching to light apps is sent");
    assert.strictEqual(h.messages()[3].dark, false);
    assert.strictEqual(h.rest(), 0);
  } finally {
    await h.stop();
  }
});

ps("repeated failed reads end the helper with a non-zero exit code", async () => {
  const dir = fakeDir(DISCHARGING, 0);
  const h = start(dir, { BT_POLL_MS: "100", BT_MAX_FAILURES: "4" });
  try {
    assert.ok(await h.until(() => h.messages().length === 1, 8000), `first message arrives: ${h.stderr()}`);
    setPower(dir, "FAIL");
    // stdin stays open: only the failure count can end it.
    assert.strictEqual(await h.exitWithin(5000), 1, "exit code 1");
    assert.strictEqual(h.messages().length, 1, "no made-up state was sent before exiting");
    assert.strictEqual(h.messages()[0].has_battery, true);
    assert.match(h.stderr(), /giving up after 4 failed reads/);
  } finally {
    await h.stop();
  }
});

ps("a helper that can never read exits non-zero without sending anything", async () => {
  const h = start(fakeDir("FAIL"), { BT_POLL_MS: "100", BT_MAX_FAILURES: "3" });
  try {
    assert.strictEqual(await h.exitWithin(8000), 1);
    assert.strictEqual(h.messages().length + h.rest(), 0, "stdout stayed empty");
  } finally {
    await h.stop();
  }
});

ps("exits within 2 seconds of stdin closing, in the middle of a 5 second poll", async () => {
  const h = start(fakeDir(DISCHARGING, 0)); // production timing: 5s poll
  try {
    assert.ok(await h.until(() => h.messages().length === 1, 8000), `first message arrives: ${h.stderr()}`);
    await sleep(300); // now waiting for the next poll
    const t0 = Date.now();
    h.child.stdin.end();
    const code = await h.exitWithin(2000);
    assert.strictEqual(code, 0, `clean exit, got ${code} after ${Date.now() - t0}ms`);
    assert.strictEqual(h.messages().length, 1);
  } finally {
    await h.stop();
  }
});

ps("data on stdin is ignored", async () => {
  const h = start(fakeDir(DISCHARGING, 0), { BT_POLL_MS: "100" });
  try {
    assert.ok(await h.until(() => h.messages().length === 1, 8000), `first message arrives: ${h.stderr()}`);
    const body = Buffer.from('{"hello":1}');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length);
    h.child.stdin.write(Buffer.concat([len, body]));
    await sleep(500);
    assert.strictEqual(h.child.exitCode, null, "still running");
    assert.strictEqual(h.messages().length, 1);
    h.child.stdin.end();
    assert.strictEqual(await h.exitWithin(2000), 0);
  } finally {
    await h.stop();
  }
});

ps("exits when its parent process is gone, with stdin still open", async () => {
  // A stand-in parent the fake Get-ParentProcessId reports.
  let pid;
  let killParent;
  if (runner.kind === "docker") {
    const r = spawnSync("docker", ["exec", runner.id, "sh", "-c", "sleep 300 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" });
    pid = Number(r.stdout.trim());
    killParent = () => spawnSync("docker", ["exec", runner.id, "sh", "-c", `kill -9 ${pid}`]);
  } else {
    const parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore" });
    pid = parent.pid;
    killParent = () => parent.kill("SIGKILL");
  }
  assert.ok(pid > 0, "stand-in parent started");

  const h = start(fakeDir(DISCHARGING, 0), { BT_POLL_MS: "150", BT_FAKE_PARENT: String(pid) });
  try {
    assert.ok(await h.until(() => h.messages().length === 1, 8000), `first message arrives: ${h.stderr()}`);
    await sleep(800);
    assert.strictEqual(h.child.exitCode, null, "runs while the parent is alive");
    killParent();
    assert.strictEqual(await h.exitWithin(3000), 0, "clean exit once the parent is gone");
  } finally {
    killParent();
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// Without the test hook: the real OS reads
// ---------------------------------------------------------------------------

ps("without the hook: a real reading on Windows, a non-zero exit elsewhere", () => {
  const c = command(["-Json"], {});
  const env = { ...c.env };
  delete env.BATTERY_THEME_TEST_HOOK;
  const r = spawnSync(c.cmd, c.argv, { env, timeout: 60000 });
  if (process.platform === "win32") {
    assert.strictEqual(r.status, 0, r.stderr.toString());
    const s = JSON.parse(r.stdout.toString("utf8"));
    assert.deepStrictEqual(Object.keys(s), ["v", "has_battery", "percentage", "on_ac", "charging", "charged", "minutes_remaining", "low_power", "dark"]);
    assert.strictEqual(s.v, 1);
    for (const k of ["has_battery", "on_ac", "charging", "charged", "low_power"]) assert.strictEqual(typeof s[k], "boolean", k);
    if (s.has_battery) assert.ok(Number.isInteger(s.percentage) && s.percentage >= 0 && s.percentage <= 100);
    else assert.strictEqual(s.percentage, null);
    assert.ok(s.minutes_remaining === null || Number.isInteger(s.minutes_remaining));
    assert.ok(s.dark === null || typeof s.dark === "boolean");
  } else {
    // No Windows API here: that must read as "helper failed", never "no battery".
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stdout.length, 0);
  }
});
