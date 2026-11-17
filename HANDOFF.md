# Battery Theme — Handoff

## What this project is

A Firefox WebExtension (Manifest V3) + Native Messaging Host that acts as an **ambient battery indicator**. A native host reads the system battery state and sends it to the extension via native messaging; the extension uses `browser.theme.update()` to dynamically recolor Firefox based on battery percentage and charging state.

## Project structure

```
battery-theme/
├── extension/
│   ├── manifest.json          # MV3; theme, nativeMessaging, alarms, storage; gecko id
│   ├── theme-colors.js        # colour model (OKLCH, urgency, light/dark, contrast)
│   ├── background.js          # connectNative, lifecycle, theme.update, icon + badge
│   ├── popup.html/.css/.js    # status + settings popup
│   ├── setup.html/.css/.js    # first-run page shown once when the helper is missing
│   └── setup-help.js          # install command text shared by popup and setup page
├── host/
│   ├── mac/
│   │   ├── battery-host.sh                        # pmset -g pslog events + 60s heartbeat, emit-on-change
│   │   ├── install.sh / uninstall.sh               # ~/Library/.../NativeMessagingHosts/
│   │   └── com.williamricchiuti.batterytheme.json # native messaging manifest template
│   ├── linux/
│   │   ├── battery-host.sh                        # sysfs, 5s poll, emit-on-change (tested against a fake sysfs only)
│   │   └── install.sh / uninstall.sh               # ~/.local/share/battery-theme + ~/.mozilla/native-messaging-hosts
│   └── windows/
│       ├── battery-host.ps1                        # Get-CimInstance Win32_Battery, 120s poll
│       ├── install.bat                             # copies to %LOCALAPPDATA%, .bat wrapper, HKCU reg key
│       └── com.williamricchiuti.batterytheme.json  # native messaging manifest template
├── userChrome/
│   ├── battery-theme.css       # optional: outlines for inactive tabs
│   ├── install-userchrome.sh   # safe installer: backs up, adds one @import, --uninstall
│   └── README.md               # setup steps + tweaks
├── install.sh                  # one entry point: picks mac or linux, --uninstall
├── preview.html                # every colour state, dark and light
├── test/                       # node --test: hosts, colour model, installers
├── docs/amo-listing.md         # store listing text + reviewer notes
└── HANDOFF.md                  # this file
```

## How it works (v1.7)

1. **Native host (macOS)** — `host/mac/battery-host.sh`. Event-driven: `pmset -g pslog` prints a line on every power-source change, which triggers a state read, so plugging in shows within about a second. A 60s heartbeat re-reads the state to catch Low Power Mode and light/dark changes. It only writes when the state changes and exits when Firefox closes stdin.
2. **Protocol v1** — 32-bit little-endian length prefix + UTF-8 JSON:
   `{"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,"charged":false,"minutes_remaining":192,"low_power":false,"dark":true}`
   `minutes_remaining` is `null` when there is no estimate; a machine with no battery sends `has_battery:false`.
3. **Extension** — `connectNative`, then `browser.theme.update()`. Three honest views: battery (themed), no battery (user's own theme, "-" icon), helper not connected (user's own theme, "?" icon; the popup shows the install command and a Try again button). It never paints a made-up level.
4. **Popup** — `popup.html/.css/.js`. Shows percentage, status, time remaining and Low Power Mode, plus the settings. It reads the current view from `storage.session.view` (published by the background on every render), writes `storage.local.settings`, and messages the background (`wake` on open, `retry` on Try again). The percentage badge on the toolbar button is now off by default (`settings.badge`).
5. **Lifecycle** — the background is an MV3 event page. A 1-minute `watchdog` alarm reconnects after host failures (slowing to 5 minutes after 5 failures in a row), and what is painted is kept in `storage.session` so a wake-up does not repaint an unchanged theme.

### The gauge (v1.7, redrawn in v1.8)

- With `settings.gauge` on (default), the strip is tinted with the battery colour at no less than 20% strength and a packaged "cover" SVG (`extension/gauge/<rev>-<dark|light>-<level>.svg`, via `images.additional_backgrounds`) paints the neutral strip colour over everything to the right of the charge level. Since v1.8 it also draws ten battery cells (2px gaps in the filled part, faint ghost lines in the empty part), a glow toward the level and a bright 2px leading edge.
- **Bump `GAUGE_REV` whenever `gaugeSvg()` changes.** Firefox keeps theme images cached across an extension reload/update, so a changed file under an unchanged name keeps showing the old picture (seen live on Firefox 160).
- **Theme images do not animate.** A SMIL charging sweep was tried in v1.8 and froze on one frame, so the images are static. Motion has to come from `theme.update` calls (the 20%/10% flash does that).
- Why files: Firefox 160 rejects SVG data URLs in `theme.update` (only PNG/JPEG data or packaged relative URLs pass), and there is no window-resize event (`windows.onBoundsChanged` is undefined), so a generated fixed-size PNG could not follow the window. A packaged SVG with no intrinsic size and percentage geometry scales by itself.
- Levels are quantised to `THEME_STEP` (2%), so 51 levels x 2 appearances = 102 files, generated by `npm run gauge` from `gaugeSvg()`; a test fails if they are stale.
- The image covers only the tab strip. With vertical tabs it shows on the top bar instead and the sidebar is tinted whole.
- Text and active-tab contrast are checked against both the filled and the empty strip colour.

### Behaviours added in v1.5.1 - v1.6

- **Repaint guard.** Firefox's default theme can overwrite the first paint at browser start. The background repaints on any `theme.onUpdated` it did not cause (max 3 per minute) and once 4s after the first paint of a session.
- **Pause.** `settings.enabled = false` resets the theme and stops reclaiming it; the button and popup still show the reading.
- **Crash-looping helper.** A helper that sends a reading and dies within 30s three times in a row is treated as missing (no stale reading left on screen); its next readings are held for 5s before being trusted.
- **Helper version.** A helper whose `v` is below `MIN_HELPER_VERSION` (background.js) shows an "update the helper" notice instead of a reading. Bump both sides together when the message format changes.
- **Setup page.** Opened once on install if the first connection finds no helper.
- **Active tab.** `tab_selected` is lifted until it has at least 1.25:1 contrast against the strip (tested).
- **Install.** `install.sh` also works piped from `curl`: with no project files beside it, it downloads `host/<os>/{battery-host,install,uninstall}.sh` from `BATTERY_THEME_BASE_URL` (default: `main` on GitHub).

### Facts checked on Firefox 160 (2026-11-16, headless, temporary add-on)

- `navigator.getBattery` is `undefined` in an extension background page, so the native host is required.
- An open native port with no traffic kept the event page and host alive for 140s+ (no suspend at 30s). The watchdog alarm stays as a backstop.

### Tests and tooling

- `npm test` — host tests against a fake `pmset` (state parsing, framing, plug-in event, clean exit) and colour-model tests (contrast, escalation, palettes) and installer tests against a throwaway HOME. `npm run check` runs tests + lint.
- `npm run lint` / `npm run build` — web-ext.
- `npm run sign` — unlisted AMO signing so the add-on survives restarts; needs `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from an AMO account.

## The tab-border constraint (important context)

The goal was for inactive tabs to have **borders and separation** instead of melting into the tab strip. Three findings govern what's possible on release Firefox 160 (Nova):

- `tab_background_separator` — the only standard theme property that drew a line between tabs — was **removed in Firefox 89**.
- `theme_experiment` (the extension mechanism for custom chrome CSS) is **Developer Edition / Nightly only** and needs `extensions.experiments.enabled`. That's why every `theme_experiment` attempt reverted the theme to default: it isn't available on this channel.
- In Nova the selected tab has **no drop shadow**, so the active tab must be separated by color contrast alone (`tab_selected` vs `frame`).

**Conclusion**: the theme API cannot border inactive tabs. The solution is a hybrid:

1. **Extension** (dynamic battery colors) — the polished dark theme below, with the battery gradient on the tab strip + active tab + URL-bar border.
2. **`userChrome.css`** (optional, one-time) — real borders/darker inactive tabs. This is the only way to get actual tab shapes on release Firefox. See `userChrome/README.md`.

## Current theme design (v1.3)

All colour logic is in `extension/theme-colors.js` (pure functions, shared by the background page, the tests and `preview.html`). Open `preview.html` in a browser to see every state in dark and light; `?palette=cvd` presets the colour-blind palette.

- **Two styles (`settings.style`).** `vivid` (default since v1.8): the strip is tinted ~30% and the active tab is a solid accent card at every level, the line under the toolbar and the sidebar border carry the accent, and the new-tab page and sidebar get a light tint; urgency adds to all of it. `subtle` is the pre-1.8 behaviour, described in the next point.
- **Quiet when healthy (`subtle`, gauge off).** At 50% and above the chrome is near-neutral: a ~7% tint on the tab strip, accent only on the tab line, URL-bar border and attention icons.
- **Flash (`settings.motion`).** When an on-battery reading drops through 20% or 10% (`crossesPulse`), the background paints `buildTheme(..., { pulse: true })` for 900ms, then the normal theme. Skipped under the OS reduce-motion setting.
- **Escalates with urgency.** `urgency` goes 0 → 1 between 50% and 10% (smoothstep). It drives both the hue and how much surface is tinted: strip, then active tab, then toolbar and new-tab page. At 10% the active tab is a solid red card.
- **Charging is blue**, at any level, so "plugged in" never looks like "full". Plugged in but not charging (full, or held at 80%) shows the healthy colour.
- **OKLCH.** Accent stops are defined in OKLCH and surfaces are blended in OKLab, so there is no olive between green and red.
- **Light and dark** follow the OS via the host's `dark` field (unknown = dark).
- **Contrast is measured.** Every text colour is picked by WCAG ratio; mid-tone surfaces are nudged until they clear 4.5:1. Tests sweep every percentage, mode, palette and intensity.
- **Settings** live in `storage.local` under `settings`: `palette` (`classic` | `cvd`), `intensity` (0-2, default 1), `appearance` (`auto` | `dark` | `light`), `badge` (boolean, default off), `enabled` (boolean, default on), `gauge` (boolean, default on), `style` (`vivid` | `subtle`, default `vivid`), `motion` (boolean, default on). The popup edits them; the background re-renders when the key changes.
- `userChrome/battery-theme.css` (optional) outlines inactive tabs using colours mixed from the tab text colour, so it follows light/dark and the battery tint.

## Performance (deliberately low-impact)

- Host blocks on `pmset -g pslog` events plus a **60s** heartbeat and **only emits when state changes**, so a steady battery sends nothing.
- Extension skips all work when the reading is unchanged, and quantizes `theme.update()` to **2% steps** (theme repaint is the expensive part — a full chrome repaint). Icon/badge update on every real change.
- No content scripts, no page observers; the popup only runs while open. The only ongoing work is one native-messaging socket and a sleeping host loop.

## IDs

- **Extension ID (gecko)**: `battery-theme@willy.dev`
- **Native host name**: `com.williamricchiuti.batterytheme`

## How to test

1. Reinstall the native host after any change to it: `bash install.sh`
2. Load the extension: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → `extension/manifest.json`
3. (Optional) Install the tab borders: `bash userChrome/install-userchrome.sh` + the `about:config` pref + restart.
4. Browser Console (Cmd+Shift+J) shows any errors. Theme reflects battery; icon/badge show the exact %.
5. Quick host check: `bash host/mac/battery-host.sh --json` prints the current state; `--once | xxd` shows the framed message.

## Environment

- Firefox 160.0 (Nova-based; Firefox 157+ theme properties apply)
- macOS (host tested on this machine)
- `pmset -g batt` returns e.g. `78%; discharging`

## Open items

- Tab-outline selectors were checked against Firefox 160's bundled `tabs.css` (`.tabbrowser-tab > .tab-stack > .tab-background`, `[selected]`, `[multiselected]`), but the result has not been looked at in a real profile.
- Windows host was updated to protocol v1 but has **never been run** (no Windows machine); it still polls every 120s.
- Colours have only been reviewed in `preview.html` mock-ups, not in the real Firefox chrome. Stops are in `PALETTES` at the top of `theme-colors.js`.
- Windows host sends `dark:null`, so Windows always gets dark chrome unless `appearance` is set.
