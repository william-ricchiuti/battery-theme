// Tests what the Linux helper installer does for sandboxed builds of Firefox
// (Flatpak and Snap), against a throwaway HOME and fake `flatpak` / `snap`
// commands, so it runs on macOS too and touches nothing real.
// Run with: node --test test/installers-linux-sandbox.test.js
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LINUX = path.join(ROOT, "host", "linux");
const HOST_SCRIPT = path.join(LINUX, "battery-host.sh");
const NAME = "com.williamricchiuti.batterytheme";

const regular = (home) => ({
  script: path.join(home, ".local", "share", "battery-theme", "battery-host.sh"),
  manifest: path.join(home, ".mozilla", "native-messaging-hosts", `${NAME}.json`),
});
const flatpakData = (home) => path.join(home, ".var", "app", "org.mozilla.firefox");
const flatpakDir = (home) => path.join(flatpakData(home), ".mozilla", "native-messaging-hosts");
const flatpak = (home) => ({
  script: path.join(flatpakDir(home), "battery-host.sh"),
  manifest: path.join(flatpakDir(home), `${NAME}.json`),
});

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const read = (f) => fs.readFileSync(f, "utf8");

// commands: { flatpak: "<shell body>", snap: "<shell body>" } -> a directory of
// fake commands. Each one appends its arguments to calls.log beside it.
function fakeBin(commands = {}) {
  const dir = tmp("bt-bin-");
  for (const [name, body] of Object.entries(commands)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/bash\necho "${name} $*" >>"${dir}/calls.log"\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }
  return dir;
}
const calls = (bin) => (fs.existsSync(path.join(bin, "calls.log")) ? read(path.join(bin, "calls.log")) : "");

// PATH holds only the fake commands and the system basics, so a real flatpak
// or snap on the machine running the tests cannot change the result.
function run(script, home, bin = fakeBin(), extraEnv = {}) {
  return spawnSync("/bin/bash", [script], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...extraEnv },
    encoding: "utf8",
  });
}
const install = (home, bin, env) => run(path.join(LINUX, "install.sh"), home, bin, env);
const uninstall = (home, bin, env) => run(path.join(LINUX, "uninstall.sh"), home, bin, env);

// Every file under dir, as sorted relative paths.
function tree(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

function assertInstalled({ script, manifest }) {
  const m = JSON.parse(read(manifest));
  assert.strictEqual(m.name, NAME);
  assert.strictEqual(m.type, "stdio");
  assert.strictEqual(m.path, script);
  assert.deepStrictEqual(m.allowed_extensions, ["battery-theme@willy.dev"]);
  assert.strictEqual(read(script), read(HOST_SCRIPT));
  assert.ok(fs.statSync(script).mode & 0o100, "host script is executable");
}

test("no sandboxed Firefox: only the regular locations are written, and nothing is said about Flatpak or Snap", () => {
  const home = tmp("bt-home-");
  const r = install(home);
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  assert.deepStrictEqual(tree(home), [
    path.join(".local", "share", "battery-theme", "battery-host.sh"),
    path.join(".mozilla", "native-messaging-hosts", `${NAME}.json`),
  ]);
  assert.doesNotMatch(r.stdout, /flatpak|snap/i);
});

test("Flatpak Firefox known to flatpak (never started): a second copy goes where its sandbox looks", () => {
  const home = tmp("bt-home-");
  const bin = fakeBin({ flatpak: '[ "$1" = info ] && [ "$2" = org.mozilla.firefox ]' });
  const r = install(home, bin);
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  // The manifest must point at the copy inside the Flatpak's own folder: the
  // sandbox cannot see ~/.local/share.
  assertInstalled(flatpak(home));
  assert.match(r.stdout, /Flatpak Firefox found/);
  assert.ok(r.stdout.includes(flatpak(home).manifest), "says where the Flatpak copy went");
  assert.doesNotMatch(r.stdout, /Snap Firefox/);
});

test("Flatpak Firefox detected from its data folder alone, without a flatpak command", () => {
  const home = tmp("bt-home-");
  fs.mkdirSync(flatpakData(home), { recursive: true });
  const r = install(home);
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  assertInstalled(flatpak(home));
});

test("flatpak present but Firefox is not one of its apps: nothing is written under ~/.var", () => {
  const home = tmp("bt-home-");
  const bin = fakeBin({ flatpak: "exit 1" });
  const r = install(home, bin);
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  assert.ok(!fs.existsSync(path.join(home, ".var")));
  assert.doesNotMatch(r.stdout, /Flatpak/);
});

test("the installer only ever asks flatpak and snap questions; it never changes sandbox permissions", () => {
  const home = tmp("bt-home-");
  const bin = fakeBin({ flatpak: "exit 0", snap: "exit 0" });
  assert.strictEqual(install(home, bin).status, 0);
  assert.strictEqual(uninstall(home, bin).status, 0);
  const seen = calls(bin).trim().split("\n");
  assert.deepStrictEqual(seen, ["flatpak info org.mozilla.firefox", "snap list firefox"]);
});

test("Snap Firefox: nothing extra is installed, and the user is told about the permission dialog and the limits", () => {
  for (const setup of ["command", "folder"]) {
    const home = tmp("bt-home-");
    let bin = fakeBin();
    if (setup === "command") bin = fakeBin({ snap: '[ "$1" = list ] && [ "$2" = firefox ]' });
    else fs.mkdirSync(path.join(home, "snap", "firefox"), { recursive: true });

    const r = install(home, bin);
    assert.strictEqual(r.status, 0, r.stderr);
    assertInstalled(regular(home));
    assert.deepStrictEqual(
      tree(home).filter((f) => !f.startsWith("snap")),
      [
        path.join(".local", "share", "battery-theme", "battery-host.sh"),
        path.join(".mozilla", "native-messaging-hosts", `${NAME}.json`),
      ],
      `(${setup}) only the regular files`,
    );
    assert.match(r.stdout, /Snap Firefox found/);
    assert.match(r.stdout, /Allow/);
    assert.match(r.stdout, /not tested/i);
    assert.doesNotMatch(r.stdout, /Flatpak Firefox found/);
  }
});

test("snap present but Firefox is not a snap: no Snap message", () => {
  const home = tmp("bt-home-");
  const r = install(home, fakeBin({ snap: "exit 1" }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Snap/);
});

test("both Flatpak and Snap Firefox: both are handled in one run", () => {
  const home = tmp("bt-home-");
  const r = install(home, fakeBin({ flatpak: "exit 0", snap: "exit 0" }));
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  assertInstalled(flatpak(home));
  assert.match(r.stdout, /Flatpak Firefox found/);
  assert.match(r.stdout, /Snap Firefox found/);
});

test("uninstall removes exactly what install added, and leaves the neighbours alone", () => {
  const home = tmp("bt-home-");
  // Things that were there before and belong to someone else.
  const others = [
    path.join(".mozilla", "native-messaging-hosts", "org.keepassxc.keepassxc_browser.json"),
    path.join(".var", "app", "org.mozilla.firefox", ".mozilla", "native-messaging-hosts", "org.example.other.json"),
    path.join(".var", "app", "org.mozilla.firefox", ".mozilla", "firefox", "profiles.ini"),
  ];
  for (const f of others) {
    fs.mkdirSync(path.join(home, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(home, f), "{}\n");
  }
  const before = tree(home);

  assert.strictEqual(install(home).status, 0);
  assert.deepStrictEqual(
    tree(home),
    [
      ...before,
      path.join(".local", "share", "battery-theme", "battery-host.sh"),
      path.join(".mozilla", "native-messaging-hosts", `${NAME}.json`),
      path.join(".var", "app", "org.mozilla.firefox", ".mozilla", "native-messaging-hosts", "battery-host.sh"),
      path.join(".var", "app", "org.mozilla.firefox", ".mozilla", "native-messaging-hosts", `${NAME}.json`),
    ].sort(),
  );

  // Uninstall must not depend on detection: no flatpak command here.
  const r = uninstall(home);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(tree(home), before);
  assert.ok(!fs.existsSync(path.join(home, ".local", "share", "battery-theme")), "own folder is removed");
  assert.ok(r.stdout.includes(flatpak(home).manifest), "reports the Flatpak copy it removed");

  // A second uninstall has nothing to do and still succeeds.
  const again = uninstall(home);
  assert.strictEqual(again.status, 0);
  assert.doesNotMatch(again.stdout, /Removed/);
});

test("re-running install is harmless, and XDG_DATA_HOME moves only the regular script", () => {
  const home = tmp("bt-home-");
  const data = path.join(home, "my data");
  fs.mkdirSync(flatpakData(home), { recursive: true });
  const env = { XDG_DATA_HOME: data };

  assert.strictEqual(install(home, fakeBin(), env).status, 0);
  assert.strictEqual(install(home, fakeBin(), env).status, 0);
  assertInstalled({ script: path.join(data, "battery-theme", "battery-host.sh"), manifest: regular(home).manifest });
  assertInstalled(flatpak(home));

  assert.strictEqual(uninstall(home, fakeBin(), env).status, 0);
  assert.deepStrictEqual(tree(home), []);
});

test("a home folder with awkward characters still gives valid manifests in both places", () => {
  const home = path.join(tmp("bt-home-"), 'we|ird & "quoted" name');
  fs.mkdirSync(flatpakData(home), { recursive: true });
  const r = install(home);
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  assertInstalled(flatpak(home));
});

test("piped from curl (only the three helper files beside it): Flatpak copy is still installed and removed", () => {
  const home = tmp("bt-home-");
  fs.mkdirSync(flatpakData(home), { recursive: true });
  const piped = (args = []) =>
    spawnSync("/bin/bash", ["-s", "--", ...args], {
      input: read(path.join(ROOT, "install.sh")),
      cwd: home,
      env: {
        PATH: `${fakeBin()}:/usr/bin:/bin`,
        HOME: home,
        BATTERY_THEME_OS: "Linux",
        BATTERY_THEME_BASE_URL: `file://${ROOT}`,
      },
      encoding: "utf8",
    });

  const r = piped();
  assert.strictEqual(r.status, 0, r.stderr);
  assertInstalled(regular(home));
  assertInstalled(flatpak(home));

  assert.strictEqual(piped(["--uninstall"]).status, 0);
  assert.deepStrictEqual(tree(home), []);
});
