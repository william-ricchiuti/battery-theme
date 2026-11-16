# Battery Theme — Handoff

## What this project is

A Firefox WebExtension (Manifest V3) + Native Messaging Host that acts as an **ambient battery indicator**. A native host reads the system battery state and sends it to the extension via native messaging; the extension uses `browser.theme.update()` to dynamically recolor Firefox based on battery percentage and charging state.

## Project structure

```
battery-theme/
├── extension/
│   ├── manifest.json          # MV3, theme + nativeMessaging permissions, gecko id
│   └── background.js          # connectNative, color math, theme.update, icon + badge
├── host/
│   ├── mac/
│   │   ├── battery-host.sh                        # pmset -g batt, 120s poll, emit-on-change
│   │   ├── install.sh                              # copies to ~/Library/.../NativeMessagingHosts/
│   │   └── com.williamricchiuti.batterytheme.json # native messaging manifest template
│   └── windows/
│       ├── battery-host.ps1                        # Get-CimInstance Win32_Battery, 120s poll
│       ├── install.bat                             # copies to %LOCALAPPDATA%, .bat wrapper, HKCU reg key
│       └── com.williamricchiuti.batterytheme.json  # native messaging manifest template
├── userChrome/
│   ├── userChrome.css          # optional: real per-tab borders (one-time manual setup)
│   ├── install-userchrome.sh   # macOS helper that copies it into the active profile
│   └── README.md               # setup steps + tweaks
└── HANDOFF.md                  # this file
```

## What's working (verified end-to-end)

1. **Native messaging host (macOS)**: `pmset -g batt` → percentage + AC Power, length-prefixed JSON. Installed to `~/Library/Application Support/Mozilla/NativeMessagingHosts/`.
2. **Extension connects and themes**: `connectNative("com.williamricchiuti.batterytheme")` succeeds; `browser.theme.update()` recolors Firefox (verified in Browser Console).
3. **Toolbar icon + badge**: dynamic SVG battery with fill level + lightning bolt when charging; badge shows the number, battery-colored text on black.
4. **Protocol**: 32-bit little-endian length prefix + UTF-8 JSON. `28 00 00 00` = 40 bytes for `{"percentage": 45, "is_charging": false}`.

## The tab-border constraint (important context)

The user wants inactive tabs to have **borders and separation** instead of melting into the tab strip. Three findings govern what's possible on release Firefox 160 (Nova):

- `tab_background_separator` — the only standard theme property that drew a line between tabs — was **removed in Firefox 89**.
- `theme_experiment` (the extension mechanism for custom chrome CSS) is **Developer Edition / Nightly only** and needs `extensions.experiments.enabled`. That's why every `theme_experiment` attempt reverted the theme to default: it isn't available on this channel.
- In Nova the selected tab has **no drop shadow**, so the active tab must be separated by color contrast alone (`tab_selected` vs `frame`).

**Conclusion**: the theme API cannot border inactive tabs. The solution is a hybrid:

1. **Extension** (dynamic battery colors) — the polished dark theme below, with the battery gradient on the tab strip + active tab + URL-bar border.
2. **`userChrome.css`** (optional, one-time) — real borders/darker inactive tabs. This is the only way to get actual tab shapes on release Firefox. See `userChrome/README.md`.

## Current theme design

A cohesive dark ramp with the battery gradient as the accent. Tuning knobs live at the top of `background.js` (`FRAME_TINT`, `THEME_STEP`).

- `frame` = dark neutral blended 25% with the battery color (dark green at 100% → olive at 50% → dark red at 10%) — the strip still visibly reflects battery but stays dark.
- `tab_selected` = the vivid battery color — the active tab is a bright card on the dark strip.
- `tab_text` = auto-contrast (dark text on bright green/yellow, white on red).
- `tab_line` = bright tint of the battery color.
- `toolbar` / `popup` / `sidebar` / `ntp` = consistent dark surfaces; `toolbar_field_border` = subtle battery accent, vivid on focus.
- `userChrome.css` adds: inactive tabs darkened ~26%, 1px outline, 8px rounded corners, 2px gap.

Gradient endpoints (tailwind-calibrated):

- Charging: `rgb(34, 197, 94)` (green-500, static)
- 100%: `rgb(74, 222, 128)` (green-400)
- 50%: `rgb(251, 191, 36)` (amber-400)
- 0%: `rgb(239, 68, 68)` (red-500)

## Performance (deliberately low-impact)

- Host polls `pmset` every **120s** (was 60s) and **only emits when state changes**, so a steady battery sends nothing.
- Extension skips all work when the reading is unchanged, and quantizes `theme.update()` to **2% steps** (theme repaint is the expensive part — a full chrome repaint). Icon/badge update on every real change.
- No content scripts, no popup, no page observers. The only ongoing work is one native-messaging socket and a sleeping host loop.

## IDs

- **Extension ID (gecko)**: `battery-theme@willy.dev`
- **Native host name**: `com.williamricchiuti.batterytheme`

## How to test

1. Reinstall the native host (picks up the 120s/emit-on-change host): `bash battery-theme/host/mac/install.sh`
2. Load the extension: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → `battery-theme/extension/manifest.json`
3. (Optional) Install the tab borders: `bash battery-theme/userChrome/install-userchrome.sh` + the `about:config` pref + restart.
4. Browser Console (Cmd+Shift+J) shows any errors. Theme reflects battery; icon/badge show the exact %.
5. Quick host check: `bash battery-theme/host/mac/battery-host.sh </dev/null | head -c 20 | xxd` (should print a length-prefixed JSON payload).

## Environment

- Firefox 160.0 (Nova-based; Firefox 157+ theme properties apply)
- macOS (host tested on this machine)
- `pmset -g batt` returns e.g. `78%; discharging`

## Open items

- **Verify `userChrome.css` selectors against Nova.** `.tabbrowser-tab` / `.tab-background` are the long-stable Proton selectors; if Nova changed them the borders won't render until they're updated (diagnose via Browser Toolbox). Everything else needs no manual setup.
- Windows host is written but not tested against a real battery (`Win32_Battery` on a desktop has no instance; the `catch` returns 100%/charging).
- Badge/icon polish and mid-gradient (olive) tuning are subjective — easy to adjust via the constants at the top of `background.js`.
