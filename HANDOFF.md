# Battery Theme — Handoff

## What this project is

A Firefox WebExtension (Manifest V3) plus a native messaging helper that turns the browser into an **ambient battery indicator**. The helper reads the battery from the operating system and sends it to the extension; the extension recolours Firefox with `browser.theme.update()`.

- **Extension ID (gecko)**: `battery-theme@willy.dev`
- **Native host name**: `com.williamricchiuti.batterytheme`
- Neither may change, and the helper message format may only grow in compatible ways: installed helpers must keep working after an extension update.
- Store promises that tests now enforce (`test/package.test.js`): only the `theme`, `nativeMessaging`, `alarms` and `storage` permissions; no network access; no remote, generated, minified or third-party code.

## Project structure

```
extension/
  manifest.json            MV3; gecko id; strict_min_version 140
  theme-colors.js          the whole colour model and the gauge drawing (pure functions)
  background.js            helper connection, lifecycle, theme.update, toolbar icon
  popup.html/.css/.js      status and settings
  setup.html/.css/.js      first-run page shown once when the helper is missing
  setup-help.js            install command text shared by popup and setup page
  gauge/r6-<level>.svg     51 generated gauge images (npm run gauge)
host/
  mac/      battery-host.sh (pmset events + 60s heartbeat), install.sh, uninstall.sh
  linux/    battery-host.sh (sysfs, 5s poll), install.sh, uninstall.sh
  windows/  battery-host.ps1 (GetSystemPowerStatus, 5s poll), battery-host.bat, install.bat, uninstall.bat
userChrome/                optional tab outlines + safe installer
install.sh                 one entry point for macOS and Linux, also works piped from curl
test/                      unit tests (node --test)
test/e2e/                  end-to-end tests that drive a real Firefox
test/docker/linux.sh       runs everything on Linux in Docker
tools/                     build-gauge.js, check-zip.js, shoot.js (screenshots)
docs/amo-listing.md        store listing text and reviewer notes
docs/ci/github-actions.yml proposed CI, NOT active (see "CI")
preview.html               every colour state, as a mock-up
```

## How it works

1. **Helper** reads the battery and writes a message only when the state changes. It exits when Firefox closes its stdin, and also when its parent process disappears.
2. **Protocol v1**: 32-bit little-endian length, then UTF-8 JSON:
   `{"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,"charged":false,"minutes_remaining":192,"low_power":false,"dark":true}`
   `minutes_remaining` and `dark` may be `null`. A machine with no battery sends `has_battery:false` and `percentage:null`.
3. **Extension** connects with `connectNative` and paints with `theme.update`. Views: battery (themed), no battery ("-" on the button, user's own theme), helper not connected ("?"), helper too old ("!"). It never paints a made-up level.
4. **Popup** reads the current view from `storage.session.view` (published by the background on every render) and writes `storage.local.settings`.
5. **Lifecycle**: MV3 event page. A 1-minute `watchdog` alarm reconnects after a helper failure (5 minutes after 5 failures in a row). What is painted is kept in `storage.session`, so a wake-up does not repaint an unchanged theme.

### Helper failure handling (all covered by end-to-end tests)

- Missing, exits at once, or sends garbage: "not connected".
- **Starts but never sends anything**: "not connected" after 8 seconds (`FIRST_MESSAGE_MS`). Before 1.9 this left the popup on "Connecting…" forever.
- Sends a reading then dies within 30s, three times in a row: treated as missing; its next readings are held 5s before being trusted.
- `v` below `MIN_HELPER_VERSION`: "update the helper" notice.
- Invalid readings (percentage out of range, not an integer, wrong types) are ignored and the last good theme stays.

## The gauge (redrawn in 1.9, `GAUGE_REV` r6)

Two parts, both in the generated image (`gaugeSvg` in `theme-colors.js`):

1. **The fill.** The theme's `frame` colour tints the strip (at least 20% strength), and the image covers everything past the charge level with the neutral strip colour. A glow and a bright 2px edge mark the level.
2. **The meter line.** A 3px line along the very top edge of the window, cut into ten cells, bright up to the level and faint beyond. Tabs never reach the top few pixels, so the level stays readable when the fill is short enough to hide behind the active tab (below about 20% on a normal window).

Why it changed: real-window screenshots showed the 1.8 full-height cell dividers running through tab labels, the gauge vanishing behind the active tab at low levels, and a stripe down the sidebar with vertical tabs.

Facts that govern it, all checked in real Firefox:

- **One file per level** (51 files, 2% steps). Dark is the plain file; light, right-to-left and light right-to-left are the same file with `#l`, `#r` or `#lr` after the name. The fragment switches CSS variables or mirrors the drawing through `:target` rules inside the SVG. Verified by reading rendered pixels on Firefox 140, 153 ESR, 160 and 161.
- **`backgrounds_area: "top_toolbars"`** keeps the image on the top toolbars. Firefox 157+ otherwise stretches theme images over the whole window, where they show through the vertical-tabs sidebar. Firefox 140 ignores the property without error and already keeps the image in the toolbox.
- **Bump `GAUGE_REV` whenever `gaugeSvg()` changes.** Firefox caches theme images across an extension update, so a changed file under an unchanged name keeps showing the old picture.
- **Theme images do not animate** (a SMIL sweep froze on one frame in 1.8). Motion comes from `theme.update` calls only.
- **Theme images must be packaged files.** Firefox rejects SVG data URLs in `theme.update`.
- With vertical tabs the gauge sits in the top bar and the sidebar takes the tint colour as a whole.
- Text contrast is checked against both the filled and the empty strip colour. Icon colour is chosen the same way (3:1 minimum on the toolbar and both strip colours); before 1.9 it could fall to 2.35:1.

## Light and dark (changed in 1.9)

With Appearance on "Match system" the theme is applied with `color_scheme: "system"`. The background page then sees Firefox's own view of the OS setting through `prefers-color-scheme`, and uses that. This works on every OS, including where the helper sends `dark:null`.

- Verified on Firefox 140 and 160: the background page follows the theme's `color_scheme`, not `content_color_scheme`. `privacy.resistFingerprinting` does not affect it.
- **Firefox 157+** delivers the change event, so an OS switch shows at once. **Firefox 140 does not**, and a kept `MediaQueryList` goes stale there, so the code asks afresh each time; on 140 the switch shows with the next helper message or when the popup opens.
- The query only means "the system" while our own system-following theme is applied. Until then the helper's `dark` is the first guess. When another theme replaces ours, the query flips for that reason; the code checks `theme.getCurrent()` and does not react.
- A forced appearance (Dark or Light) names the scheme outright.

## Colour model

All in `extension/theme-colors.js`; `preview.html` shows every state.

- **Two styles** (`settings.style`): `vivid` (default) shows colour at every level; `subtle` stays near neutral above 50%.
- **Urgency** rises 0 to 1 between 50% and 10% and drives both hue and how much surface is tinted.
- **Charging is blue.** Plugged in but not charging shows the healthy colour.
- **OKLCH/OKLab** stops and blending. **WCAG-measured** text (4.5:1) and icons (3:1).
- **Flash** at 20% and 10% (`settings.motion`), skipped under the OS reduce-motion setting.
- **Settings** in `storage.local.settings`: `palette` (`classic` | `cvd`), `intensity` (0-2), `appearance` (`auto` | `dark` | `light`), `badge`, `enabled`, `gauge`, `style`, `motion`.
- **Colour-blind check**: `test/colour-vision.test.js` simulates protanopia, deuteranopia and tritanopia. The `cvd` palette keeps full, low and charging apart under all three. The classic palette does not keep charging-blue apart from healthy-green under tritanopia (0.03 OKLab), so tritan users should use the colour-blind palette.

## Helpers

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Source | `pmset -g batt` | `/sys/class/power_supply` | `GetSystemPowerStatus` |
| Reacts in | about 1s (pslog events) | up to 5s | up to 5s |
| Light/dark sent | yes | GNOME only; `null` in Flatpak | yes (registry) |
| Low power | yes | `powerprofilesctl` | Battery Saver |
| Run for real | yes, this Mac | under real Linux Firefox in Docker, fake battery | **never** |

- **Linux**: several batteries are weighted by capacity. Peripheral batteries are skipped by `scope=Device`, or by driver name when `scope` is missing (`hid-*`, `hidpp_battery_*`, `wacom_*`, game controllers). A `type=UPS` supply is not a battery. The poll waits with a shell builtin, not a `sleep` process.
- **Flatpak Firefox** starts the helper inside its sandbox from `~/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts/`; `install.sh` puts a second copy there when it finds one. No sandbox permission is changed. Run for real with Flathub Firefox 160 in Docker.
- **Snap Firefox** cannot start a helper itself; the desktop portal starts it from the regular location. `install.sh` only prints guidance. Not tested: snapd would not run in Docker.
- **Windows**: a failed read is no longer reported as "no battery"; after five in a row the helper exits so the extension shows "not connected". `charged` means 100%, on mains, not charging. The manifest uses a path relative to itself. Logic is tested under PowerShell 7 on Linux; nothing has run on Windows.
- **macOS UPS**: a desktop on a UPS reports no battery (tested against canned `pmset` output).

### Host gotchas

- Under Firefox, the helper's main process must read stdin in the **foreground** (`cat >/dev/null`), with the work loop in a background subshell. The reverse gets an immediate EOF when launched by Firefox.
- On macOS, a process started by Firefox may not execute files in privacy-protected folders such as `~/Desktop` ("Operation not permitted"). The tests copy the fake `pmset` to a temp folder for that reason.

## Tests and tooling

| Command | What it runs |
| --- | --- |
| `npm test` | 97 unit tests: helpers against fake batteries, installers against throwaway homes, colour model, snapshot, colour-blind simulation, package promises. Windows helper tests need Docker or PowerShell and skip without. |
| `npm run test:e2e` | 21 end-to-end tests in a real Firefox (`FIREFOX_BIN` picks the build). |
| `npm run check` | `npm test` + web-ext lint + `check:zip`. |
| `npm run check:zip` | Builds the store zip and checks it holds exactly `extension/`. |
| `npm run check:shell` | shellcheck + `bash -n` with the stock bash. |
| `npm run check:all` | All of the above. |
| `npm run test:linux` | Unit and end-to-end tests on Linux in Docker (`release` argument for the current Firefox). |
| `npm run gauge` | Regenerates `extension/gauge/`. |
| `node tools/shoot.js <dir> [scenario…]` | Real-window screenshots in any battery state. |
| `UPDATE_SNAPSHOT=1 node --test test/snapshot.test.js` | Accept an intended colour change. |

How the end-to-end tests work (`test/e2e/harness.js`): a dependency-free Marionette client starts Firefox on a throwaway profile **and a throwaway home folder** (`HOME` plus `CFFIXED_USER_HOME` on macOS), so Firefox finds only the native-messaging manifest the test wrote. The real profile and the really installed helper are never touched. Assertions read CSS variables and computed colours from the browser window itself, and `pixels()` reads rendered pixels. `fake-host.js` is a helper the test steers through files.

Right-to-left needs Mozilla's Arabic language pack for the exact Firefox version: `BATTERY_E2E_RTL_LANGPACK=/path/to/ar.xpi`.

### What has been run where (2026-11-20)

| Firefox | Result |
| --- | --- |
| 160.0 release, macOS | 21/21 |
| 161.0b4 Developer Edition, macOS | pass (RTL skipped) |
| 140.0 ESR, macOS | pass, incl. RTL (vertical-tabs test skipped by design) |
| 153.7 ESR, Debian in Docker | pass with the real Linux helper |
| 160.0.1 release, Debian in Docker | pass with the real Linux helper |
| 160.0.1 Flatpak, Debian in Docker | helper starts and themes (manual experiment, not in the suite) |
| Any Firefox on Windows | **never run** |
| Snap Firefox | **never run** |

## CI

`docs/ci/github-actions.yml` is a proposal. GitHub does not run it from there. To turn it on, copy it to `.github/workflows/ci.yml` and push. Its Windows job would be the first real run of the Windows helper, `install.bat`, `uninstall.bat` and `test/e2e/windows-helper.e2e.js`; expect to fix things on that first run.

## Performance (measured 2026-11-20, this Mac unless noted)

| | 1.8.1 | 1.9.0 |
| --- | --- | --- |
| Store zip | 62,176 bytes, 116 files | 55,000 bytes, 63 files |
| macOS helper, idle | 0.21 CPU-seconds per 5 minutes | same (unchanged) |
| Linux helper, idle (Docker) | 0.37 CPU-seconds per 5 minutes | 0.29 |
| Theme repaints | 106 per full discharge + recharge | same |
| Firefox idle CPU with the extension | no measurable difference from without it (2.0-2.8 CPU-seconds per minute either way) | same |

A steady battery sends nothing and repaints nothing; a 2% step costs exactly one repaint (end-to-end tested).

## The tab-border constraint

On release Firefox an extension cannot outline or separately colour inactive tabs: `tab_background_separator` was removed in Firefox 89, `theme_experiment` is Developer Edition and Nightly only, and since Nova (157) the selected tab has no shadow. Real outlines come from the optional `userChrome/battery-theme.css`.

`userChrome/install-userchrome.sh` picks the profile named by the `[Install…]` section of `profiles.ini`. On current Firefox the profile marked `Default=1` is usually an old unused one, which the pre-1.9 installer would have chosen. With Firefox and Developer Edition both installed it asks, or takes `--all`.

## Open items

- **Windows** is unverified end to end. See "CI".
- **Snap** is unverified.
- A real Linux laptop battery, a real UPS and real multi-battery hardware have not been seen; only simulated sysfs trees.
- KDE, Xfce and other desktops: light/dark now comes from Firefox itself, which was verified on macOS and headless Linux only.
- Real sleep/wake and a real unplug were simulated (frozen processes, fake `pmset` events).
- Forced-colours / Windows high-contrast mode has not been looked at.
- The popup store screenshot (`docs/screenshots/5-popup-dark.png`) still shows the 1.8 gauge behind the popup; a headless capture cannot include the popup panel.
- How the optional tab outlines look in a real profile has still not been reviewed.
- `preview.html` is a mock-up and does not draw the meter line.
