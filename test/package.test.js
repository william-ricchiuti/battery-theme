// Checks on what gets shipped to the store, against the promises in the
// listing: only the four permissions, no network access, no remote or
// generated code, no third-party libraries, IDs unchanged. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(EXT).map((f) => path.relative(EXT, f).split(path.sep).join("/")).sort();

test("manifest: IDs, permissions and data collection are exactly what the listing says", () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.browser_specific_settings.gecko.id, "battery-theme@willy.dev");
  assert.deepStrictEqual([...manifest.permissions].sort(), ["alarms", "nativeMessaging", "storage", "theme"]);
  assert.strictEqual(manifest.host_permissions, undefined);
  assert.strictEqual(manifest.optional_permissions, undefined);
  assert.strictEqual(manifest.content_scripts, undefined);
  assert.deepStrictEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["none"] });
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.match(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), /"com\.williamricchiuti\.batterytheme"/);
});

test("shipped files: only the expected kinds, all tracked by git, nothing stray", () => {
  for (const f of files) assert.match(f, /\.(js|json|html|css|svg)$/, `unexpected file type: ${f}`);
  assert.ok(!files.some((f) => /(^|\/)\./.test(f)), "no dotfiles");
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "extension"], { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean).map((f) => f.replace(/^extension\//, "")).sort();
  } catch {
    return; // not a git checkout (e.g. a source zip): nothing to compare with
  }
  assert.deepStrictEqual(files, tracked, "extension/ on disk equals extension/ in git");
});

test("code: no network access, no remote or generated code, nothing minified", () => {
  const banned = [
    [/\bfetch\s*\(/, "fetch()"], [/XMLHttpRequest/, "XMLHttpRequest"], [/\bWebSocket\b/, "WebSocket"],
    [/\bEventSource\b/, "EventSource"], [/sendBeacon/, "sendBeacon"], [/\beval\s*\(/, "eval()"],
    [/new\s+Function\s*\(/, "new Function()"], [/\bimportScripts\b/, "importScripts"],
    [/document\.write/, "document.write"], [/innerHTML\s*=/, "innerHTML ="],
  ];
  for (const f of files.filter((f) => f.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(EXT, f), "utf8");
    for (const [re, what] of banned) assert.doesNotMatch(text, re, `${f} uses ${what}`);
    const longest = Math.max(...text.split("\n").map((l) => l.length));
    assert.ok(longest < 240, `${f} has a ${longest}-character line; shipped code must stay readable source`);
  }
  for (const f of files.filter((f) => f.endsWith(".html"))) {
    const text = fs.readFileSync(path.join(EXT, f), "utf8");
    for (const m of text.matchAll(/<(?:script|link|img|iframe)[^>]*(?:src|href)="([^"]+)"/g)) {
      assert.doesNotMatch(m[1], /^(https?:)?\/\//, `${f} loads ${m[1]} from the network`);
      assert.ok(files.includes(m[1]), `${f} refers to ${m[1]}, which is not shipped`);
    }
    assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>/, `${f} has an inline script`);
  }
  // The only web addresses in shipped code are the project's own pages, shown to the user as links or text.
  for (const f of files.filter((f) => /\.(js|html)$/.test(f))) {
    for (const m of fs.readFileSync(path.join(EXT, f), "utf8").matchAll(/https?:\/\/[^\s"'`<>)]+/g)) {
      assert.match(m[0], /^https:\/\/(github\.com|raw\.githubusercontent\.com)\/william-ricchiuti\/battery-theme|^http:\/\/www\.w3\.org\/2000\/svg/, `${f}: ${m[0]}`);
    }
  }
});

test("manifest refers only to files that are shipped", () => {
  const refs = [...manifest.background.scripts, manifest.action.default_popup, manifest.action.default_icon,
    ...Object.values(manifest.icons)];
  for (const r of refs) assert.ok(files.includes(r), `${r} is missing`);
});
