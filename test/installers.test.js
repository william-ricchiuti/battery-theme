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

// profiles: [{ dir, isDefault, inUse }] -> fake HOME with a profiles.ini.
// inUse gives the profile an [Install...] section, which is how Firefox
// records the profile each installed Firefox (release, Developer Edition...)
// actually starts with.
function fakeHome(profiles) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const ff = process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Firefox")
    : path.join(home, ".mozilla", "firefox");
  let ini = "[General]\nStartWithLastProfile=1\nVersion=2\n\n[Install2656FF1E876E9973]\nDefault=Profiles/whatever\n\n";
  profiles.forEach((p, i) => {
    fs.mkdirSync(path.join(ff, "Profiles", p.dir), { recursive: true });
    if (p.inUse) ini += `[Install${String(i).repeat(16)}]\nDefault=Profiles/${p.dir}\nLocked=1\n\n`;
    ini += `[Profile${i}]\nName=${p.dir}\nIsRelative=1\nPath=Profiles/${p.dir}\n${p.isDefault ? "Default=1\n" : ""}\n`;
  });
  fs.mkdirSync(ff, { recursive: true });
  fs.writeFileSync(path.join(ff, "profiles.ini"), ini);
  return { home, ff, chrome: (dir) => path.join(ff, "Profiles", dir, "chrome") };
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

  const explicit = path.join(b.ff, "Profiles", "two");
  assert.strictEqual(run(USERCHROME, b.home, ["--profile", explicit]).status, 0);
  assert.ok(fs.existsSync(path.join(b.chrome("two"), "battery-theme.css")));
});

test("a normal modern setup: the profile Firefox really uses wins over the old one marked Default=1", () => {
  // What a fresh Firefox creates: an unused "default" with Default=1, and "default-release" tied to the install.
  const h = fakeHome([{ dir: "aaaa.default", isDefault: true }, { dir: "bbbb.default-release", inUse: true }]);
  const r = run(USERCHROME, h.home);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(h.chrome("bbbb.default-release"), "battery-theme.css")), "installed into the profile in use");
  assert.ok(!fs.existsSync(h.chrome("aaaa.default")), "the unused legacy profile is left alone");
  assert.match(run(USERCHROME, h.home, ["--list"]).stdout, /bbbb\.default-release {2}\(in use by an installed Firefox\)/);
});

test("Firefox and Developer Edition side by side: asks which, --all does both, uninstall --all undoes both", () => {
  const h = fakeHome([
    { dir: "aaaa.default", isDefault: true },
    { dir: "bbbb.default-release", inUse: true },
    { dir: "cccc.dev-edition-default", inUse: true },
  ]);
  const r = run(USERCHROME, h.home);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /More than one Firefox/);
  assert.match(r.stderr, /bbbb\.default-release/);
  assert.match(r.stderr, /cccc\.dev-edition-default/);
  assert.doesNotMatch(r.stderr, /aaaa\.default\n/, "the unused profile is not offered");
  for (const d of ["aaaa.default", "bbbb.default-release", "cccc.dev-edition-default"]) {
    assert.ok(!fs.existsSync(h.chrome(d)), "nothing written when it has to ask");
  }

  assert.strictEqual(run(USERCHROME, h.home, ["--all"]).status, 0);
  assert.ok(fs.existsSync(path.join(h.chrome("bbbb.default-release"), "battery-theme.css")));
  assert.ok(fs.existsSync(path.join(h.chrome("cccc.dev-edition-default"), "battery-theme.css")));
  assert.ok(!fs.existsSync(h.chrome("aaaa.default")));

  assert.strictEqual(run(USERCHROME, h.home, ["--uninstall", "--all"]).status, 0);
  assert.ok(!fs.existsSync(path.join(h.chrome("bbbb.default-release"), "battery-theme.css")));
  assert.ok(!fs.existsSync(path.join(h.chrome("cccc.dev-edition-default"), "battery-theme.css")));
});

test("a profile path with spaces, an absolute path (IsRelative=0) and Windows line endings in profiles.ini", () => {
  const h = fakeHome([]);
  const odd = path.join(h.home, "My Profiles", "work profile");
  fs.mkdirSync(odd, { recursive: true });
  fs.writeFileSync(path.join(h.ff, "profiles.ini"),
    `[General]\r\nVersion=2\r\n\r\n[Profile0]\r\nName=work\r\nIsRelative=0\r\nPath=${odd}\r\nDefault=1\r\n`);
  const r = run(USERCHROME, h.home);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(odd, "chrome", "battery-theme.css")));
  assert.strictEqual(run(USERCHROME, h.home, ["--profile"]).status, 2, "--profile without a folder is a usage error");
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

test("install.sh piped from curl downloads the helper files and installs; --uninstall removes them", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const script = read(path.join(ROOT, "install.sh"));
  // Simulate `curl ... | bash`: the script arrives on stdin and has no file of
  // its own, so it must fetch host files from BASE_URL (here: this checkout).
  const piped = (args = []) =>
    spawnSync("/bin/bash", ["-s", "--", ...args], {
      input: script,
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, BATTERY_THEME_OS: "Darwin", BATTERY_THEME_BASE_URL: `file://${ROOT}` },
      encoding: "utf8",
    });
  const dest = path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts");

  const r = piped();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(read(path.join(dest, "battery-host.sh")), read(path.join(ROOT, "host", "mac", "battery-host.sh")));
  assert.strictEqual(JSON.parse(read(path.join(dest, "com.williamricchiuti.batterytheme.json"))).path, path.join(dest, "battery-host.sh"));

  assert.strictEqual(piped(["--uninstall"]).status, 0);
  assert.deepStrictEqual(fs.readdirSync(dest), []);

  const bad = spawnSync("/bin/bash", ["-s"], {
    input: script,
    env: { PATH: process.env.PATH, HOME: home, BATTERY_THEME_OS: "Darwin", BATTERY_THEME_BASE_URL: "file:///nonexistent" },
    encoding: "utf8",
  });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /Could not download/);
});

test("mac installer handles a home folder with awkward characters", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "bt-home-"));
  const home = path.join(base, 'we|ird & "quoted" name');
  fs.mkdirSync(home);
  assert.strictEqual(run(path.join(ROOT, "host", "mac", "install.sh"), home).status, 0);
  const dest = path.join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts");
  assert.strictEqual(JSON.parse(read(path.join(dest, "com.williamricchiuti.batterytheme.json"))).path, path.join(dest, "battery-host.sh"));
});
