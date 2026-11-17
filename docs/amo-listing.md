# addons.mozilla.org listing

Everything to paste into the submission form at <https://addons.mozilla.org/developers/addon/submit/>. Upload the zip from `npm run build` (`web-ext-artifacts/battery_theme-<version>.zip`) and choose **On this site**.

## Name

Battery Theme

## Summary (250 characters max)

Tints Firefox to match your laptop battery: calm when it's healthy, amber then red as it drains, blue while charging. Needs a small helper script, because Firefox can't read the battery itself.

## Description

Battery Theme turns the browser itself into a battery indicator, so you notice a low battery without looking for it.

- **Quiet when healthy.** Above 50% Firefox looks almost neutral, with just a hint of colour.
- **Louder as it drains.** The tab strip, then the active tab, then the toolbar shift from green through amber to red. At 10% you can't miss it.
- **Blue while charging**, so plugged in never looks the same as full.
- **Light and dark.** Pick one, or let it follow the system setting (on macOS and GNOME; elsewhere it defaults to dark).
- **Pause any time.** One switch hands the browser theme back to you while the button keeps showing the battery.
- **Colour-blind-safe option.** A neutral-to-orange palette that doesn't rely on telling red from green.
- **Toolbar button.** Shows the exact percentage, time remaining and the settings.

**This add-on needs a helper.** Firefox does not let extensions read the battery, so Battery Theme uses a small open-source shell script on your computer that reads the battery level and passes it to the extension. Without it the add-on does nothing except show you how to install it. Setup takes one terminal command, shown on a setup page the first time you run the add-on:

https://github.com/william-ricchiuti/battery-theme#install

macOS is fully supported. Linux support is new and Windows support is experimental.

**Privacy.** Battery Theme collects nothing and makes no network connections. The helper only reads the battery state, the light/dark setting and the low-power setting from your operating system.

When the helper isn't connected, or the computer has no battery, Battery Theme leaves your own Firefox theme alone.

## Categories

Appearance

## Tags

battery, theme, dynamic theme, laptop

## Links

- Homepage: https://github.com/william-ricchiuti/battery-theme
- Support site: https://github.com/william-ricchiuti/battery-theme/issues

## Licence

MIT

## Privacy policy

Not required: the manifest declares `data_collection_permissions: none`. If the form asks, use: "Battery Theme does not collect, store or transmit any data."

## Screenshots

Six are ready in `docs/screenshots/` (2560x1600, real Firefox windows driven by a simulated battery):

| File | Caption |
| --- | --- |
| `1-healthy-dark.png` | Healthy battery: Firefox stays calm, with just a hint of green. |
| `2-low-dark.png` | At 20% the tab strip and active tab turn amber. |
| `3-critical-dark.png` | Under 10% the browser is unmistakably red. |
| `4-charging-dark.png` | Blue while charging. |
| `5-popup-dark.png` | The toolbar button shows the exact level, time left and settings. |
| `6-low-light.png` | Works in light mode too. |

Notes on how they were taken:

- 1-4 and 6 come from Firefox Developer Edition with the window not focused, so the tint is slightly more muted than in a focused window.
- 5 comes from regular Firefox launched by `web-ext`, which is why its address bar has the striped "remote control" look and a robot icon. Retake it by hand (click the battery button, capture the window) if you want a clean address bar.

## Notes to reviewer

Battery Theme uses native messaging because `navigator.getBattery` is not available to extensions in Firefox.

- **Native host:** `com.williamricchiuti.batterytheme`, a plain shell script (PowerShell on Windows). Source is in the same repository as the extension, under `host/`: https://github.com/william-ricchiuti/battery-theme
- **What the host does:** reads battery state from the OS (`pmset` on macOS, `/sys/class/power_supply` on Linux, `Win32_Battery` on Windows) and writes it to stdout as JSON. It also reads the system light/dark setting (`defaults read -g AppleInterfaceStyle` on macOS, `gsettings` on GNOME) and the low-power setting (`pmset -g`, `powerprofilesctl`). On macOS it creates one named pipe in the temp directory for `pmset` events. It makes no network connections and ignores everything the extension sends it.
- **Message shape:** `{"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,"charged":false,"minutes_remaining":192,"low_power":false,"dark":true}`
- **To test with the host (macOS or Linux):** `curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash`, then open the popup and choose Try again. It installs per user, without sudo; add `-s -- --uninstall` after `bash` to remove it. Or clone the repository and run `bash install.sh`.
- **To test without the host:** on first install a bundled setup page (`setup.html`) opens once, the toolbar button shows "?", and the popup explains the setup. The browser theme is left untouched.
- **Permissions:** `theme` (apply colours), `nativeMessaging` (talk to the helper), `alarms` (reconnect to the helper after a failure), `storage` (`storage.local`: the user's five settings; `storage.session`: the current battery reading for the popup, what was last painted, and reconnect counters).
- **Code:** no build step, no minification, no remote code, no third-party libraries. The submitted files are the source.
