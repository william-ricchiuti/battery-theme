// Tests the install scripts against a throwaway HOME, so no real Firefox
// profile or native-host folder is touched. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const USERCHROME = path.join(ROOT, "userChrome", "install-userchrome.sh");
const IMPORT = '@import "battery-theme.css"; /* Battery Theme */';

// profiles: [{ dir, isDefault }] -> fake HOME with a profiles.ini
function fakeHome(profiles) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const ff = path.join(home, "Library", "Application Support", "Firefox");
  let ini = "[General]\nStartWithLastProfile=1\n\n[Install2656FF1E876E9973]\nDefault=Profiles/whatever\n\n";
  profiles.forEach((p, i) => {
    fs.mkdirSync(path.join(ff, "Profiles", p.dir), { recursive: true });
    ini += `[Profile${i}]\nName=${p.dir}\nIsRelative=1\nPath=Profiles/${p.dir}\n${p.isDefault ? "Default=1\n" : ""}\n`;
  });
  fs.mkdirSync(ff, { recursive: true });
  fs.writeFileSync(path.join(ff, "profiles.ini"), ini);
  return { home, chrome: (dir) => path.join(ff, "Profiles", dir, "chrome") };
}

const run = (script, home, args = []) =>
  spawnSync("/bin/bash", [script, ...args], { env: { ...process.env, HOME: home }, encoding: "utf8" });
const read = (f) => fs.readFileSync(f, "utf8");
const backups = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith("userChrome.css.backup-"));

test("fresh profile: installs the stylesheet and a one-line userChrome.css", () => {
  const { home, chrome } = fakeHome([{ dir: "abc.default-release" }]);
  const r = run(USERCHROME, home);
  assert.strictEqual(r.status, 0, r.stderr);
  const dir = chrome("abc.default-release");
  assert.strictEqual(read(path.join(dir, "userChrome.css")), IMPORT + "\n");
  assert.match(read(path.join(dir, "battery-theme.css")), /\.tab-background/);
  assert.deepStrictEqual(backups(dir), []);
});

test("existing userChrome.css is kept, backed up, and only gains the import; re-running changes nothing", () => {
  const { home, chrome } = fakeHome([{ dir: "abc.default-release" }]);
  const dir = chrome("abc.default-release");
  const mine = "/* my own tweaks */\n#nav-bar { padding: 2px !important; }\n";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "userChrome.css"), mine);

  assert.strictEqual(run(USERCHROME, home).status, 0);
  assert.strictEqual(read(path.join(dir, "userChrome.css")), IMPORT + "\n" + mine);
  assert.strictEqual(backups(dir).length, 1);
  assert.strictEqual(read(path.join(dir, backups(dir)[0])), mine);

  assert.strictEqual(run(USERCHROME, home).status, 0);
  assert.strictEqual(read(path.join(dir, "userChrome.css")), IMPORT + "\n" + mine);
  assert.strictEqual(backups(dir).length, 1, "no second backup when nothing needs changing");
});

test("userChrome.css left by the old installer is replaced by the import (with a backup)", () => {
  const { home, chrome } = fakeHome([{ dir: "abc.default-release" }]);
  const dir = chrome("abc.default-release");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "userChrome.css"), "/* Battery Theme — userChrome.css\n */\n.old { color: red; }\n");
  assert.strictEqual(run(USERCHROME, home).status, 0);
  assert.strictEqual(read(path.join(dir, "userChrome.css")), IMPORT + "\n");
  assert.strictEqual(backups(dir).length, 1);
});

test("several profiles: uses the one marked default, refuses to guess otherwise", () => {
  const a = fakeHome([{ dir: "one.dev-edition" }, { dir: "two.default-release", isDefault: true }]);
  assert.strictEqual(run(USERCHROME, a.home).status, 0);
  assert.ok(fs.existsSync(path.join(a.chrome("two.default-release"), "battery-theme.css")));
  assert.ok(!fs.existsSync(a.chrome("one.dev-edition")));

  const b = fakeHome([{ dir: "one" }, { dir: "two" }]);
  const r = run(USERCHROME, b.home);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--profile/);
  assert.ok(!fs.existsSync(b.chrome("one")) && !fs.existsSync(b.chrome("two")), "nothing written when ambiguous");

  const explicit = path.join(b.home, "Library", "Application Support", "Firefox", "Profiles", "two");
  assert.strictEqual(run(USERCHROME, b.home, ["--profile", explicit]).status, 0);
  assert.ok(fs.existsSync(path.join(b.chrome("two"), "battery-theme.css")));
});

test("no profiles: fails with guidance and writes nothing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const r = run(USERCHROME, home);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No Firefox profiles found/);
});

test("uninstall removes only what was added", () => {
  const { home, chrome } = fakeHome([{ dir: "abc.default-release" }]);
  const dir = chrome("abc.default-release");
  const mine = "#nav-bar { padding: 2px !important; }\n";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "userChrome.css"), mine);
  run(USERCHROME, home);
  assert.strictEqual(run(USERCHROME, home, ["--uninstall"]).status, 0);
  assert.strictEqual(read(path.join(dir, "userChrome.css")), mine);
  assert.ok(!fs.existsSync(path.join(dir, "battery-theme.css")));
});

test("native host install writes a valid manifest pointing at the installed script; uninstall removes both", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const dest = path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts");
  assert.strictEqual(run(path.join(ROOT, "host", "mac", "install.sh"), home).status, 0);
  const manifest = JSON.parse(read(path.join(dest, "com.williamricchiuti.batterytheme.json")));
  assert.strictEqual(manifest.path, path.join(dest, "battery-host.sh"));
  assert.deepStrictEqual(manifest.allowed_extensions, ["battery-theme@willy.dev"]);
  assert.ok(fs.statSync(manifest.path).mode & 0o100, "host script is executable");

  assert.strictEqual(run(path.join(ROOT, "host", "mac", "uninstall.sh"), home).status, 0);
  assert.deepStrictEqual(fs.readdirSync(dest), []);
});

test("install.sh picks the right helper per system; Linux install and uninstall round-trip", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const top = path.join(ROOT, "install.sh");
  const runOs = (osName, args = []) =>
    spawnSync("/bin/bash", [top, ...args], {
      env: { PATH: process.env.PATH, HOME: home, BATTERY_THEME_OS: osName },
      encoding: "utf8",
    });

  assert.strictEqual(runOs("Linux").status, 0);
  const manifestPath = path.join(home, ".mozilla", "native-messaging-hosts", "com.williamricchiuti.batterytheme.json");
  const manifest = JSON.parse(read(manifestPath));
  assert.strictEqual(manifest.path, path.join(home, ".local", "share", "battery-theme", "battery-host.sh"));
  assert.strictEqual(manifest.name, "com.williamricchiuti.batterytheme");
  assert.strictEqual(read(manifest.path), read(path.join(ROOT, "host", "linux", "battery-host.sh")));
  assert.ok(fs.statSync(manifest.path).mode & 0o100);

  assert.strictEqual(runOs("Linux", ["--uninstall"]).status, 0);
  assert.ok(!fs.existsSync(manifestPath) && !fs.existsSync(manifest.path));

  assert.strictEqual(runOs("Darwin").status, 0);
  assert.ok(fs.existsSync(path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts", "battery-host.sh")));

  const other = runOs("FreeBSD");
  assert.strictEqual(other.status, 1);
  assert.match(other.stderr, /Unsupported system/);
});
