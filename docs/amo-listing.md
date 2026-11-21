# addons.mozilla.org listing

Everything to paste into the submission form at <https://addons.mozilla.org/developers/addon/submit/>. Upload the zip from `npm run build` (`web-ext-artifacts/battery_theme-<version>.zip`) and choose **On this site**.

## Name

Battery Theme: Battery Level Indicator

(Store listing name. The add-on itself, the repository and the IDs stay "Battery Theme".)

## Summary (250 characters max)

Turns the Firefox tab strip into a battery gauge: it fills to your charge level, shifts from green to amber to red as it drains, and turns blue while charging. Needs a small helper script, because Firefox can't read the battery itself.

## Description

Battery Theme turns the browser itself into a battery indicator, so you notice a low battery without looking for it.

- **A gauge you can't miss.** The tab strip fills up to your charge level with a bright leading edge, a thin ten-cell meter line runs along the top of the window, and the active tab is a solid card in the battery colour.
- **Louder as it drains.** The colour shifts from green through amber to red, spreading to the active tab and then the toolbar. At 10% the whole top of the browser is red.
- **A nudge at 20% and 10%.** The top of the browser flashes once as the battery drops through each.
- **Prefer it quieter?** Pick "Quiet until low" for a tint that stays almost neutral until the battery gets low, and turn the flash off.
- **Blue while charging**, so plugged in never looks the same as full.
- **Light and dark.** Pick one, or let it follow the system setting, on any operating system.
- **Vertical tabs and right-to-left.** With vertical tabs the gauge sits in the top bar; in right-to-left Firefox it fills from the right.
- **Pause any time.** One switch hands the browser theme back to you while the button keeps showing the battery.
- **Colour-blind-safe option.** A neutral-to-orange palette that doesn't rely on telling red from green.
- **Toolbar button.** Shows the exact percentage, time remaining and the settings.

**This add-on needs a helper.** Firefox does not let extensions read the battery, so Battery Theme uses a small open-source shell script on your computer that reads the battery level and passes it to the extension. Without it the add-on does nothing except show you how to install it. Setup takes one terminal command, shown on a setup page the first time you run the add-on:

https://github.com/william-ricchiuti/battery-theme#install

macOS is fully supported. Linux is supported, including Flatpak Firefox (Snap Firefox is untested). Windows support is experimental.

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

Two sets exist. Pick one per slot when updating the listing for 1.9.

**`docs/screenshots/` (1.8 look, 2560x1600).** Taken from Firefox Developer Edition windows with real pages open. They show the 1.8 gauge (cell dividers across the strip), which 1.9 replaced.

**`docs/screenshots/1.9/` (1.9 look, 2560x1600).** Taken with `node tools/shoot.js <folder> store-1-healthy-dark …` from a real Firefox 160 driven by a simulated battery. The browser chrome is exactly what 1.9 draws. The page area is an empty New Tab page and there are no window buttons, because the capture is headless. For a more inviting listing, retake by hand: load the add-on, open a few real sites, and capture the window.

| File | Caption |
| --- | --- |
| `1-healthy-dark.png` | The tab strip fills to your charge level: 82% here. |
| `2-low-dark.png` | At 20% the gauge is short and orange. |
| `3-critical-dark.png` | Under 10% the browser is unmistakably red. |
| `4-charging-dark.png` | Blue while charging. |
| `5-popup-dark.png` | The toolbar button shows the exact level, time left and settings. (Only in the 1.8 set: a headless capture cannot include the popup panel. Retake by hand: click the battery button, capture the window.) |
| `6-low-light.png` | Works in light mode too. |
| `7-vertical-dark.png` | With vertical tabs the gauge sits in the top bar. (1.9 set only.) |

## Notes to reviewer

Battery Theme uses native messaging because `navigator.getBattery` is not available to extensions in Firefox.

- **Native host:** `com.williamricchiuti.batterytheme`, a plain shell script (PowerShell on Windows). Source is in the same repository as the extension, under `host/`: https://github.com/william-ricchiuti/battery-theme
- **What the host does:** reads battery state from the OS and writes it to stdout as JSON. It makes no network connections and ignores everything the extension sends it.
  - macOS: `pmset -g batt`, `pmset -g` (low power mode), `defaults read -g AppleInterfaceStyle` (light/dark). It creates one named pipe in the temp directory for `pmset -g pslog` events.
  - Linux: files under `/sys/class/power_supply`; `gsettings` (light/dark) and `powerprofilesctl` (power saver) when present. It creates one named pipe in the temp directory, used only as a timer.
  - Windows: the `GetSystemPowerStatus` API; the `AppsUseLightTheme` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` (light/dark); and a `Win32_Process` lookup of its own parent process ids at start, so it can exit when Firefox is gone.
- **Message shape:** `{"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,"charged":false,"minutes_remaining":192,"low_power":false,"dark":true}`
- **To test with the host (macOS or Linux):** `curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash`, then open the popup and choose Try again. It installs per user, without sudo; add `-s -- --uninstall` after `bash` to remove it. Or clone the repository and run `bash install.sh`. On Windows: `host\windows\install.bat` and `host\windows\uninstall.bat` from a copy of the repository.
- **To test without the host:** on first install a bundled setup page (`setup.html`) opens once, the toolbar button shows "?", and the popup explains the setup. The browser theme is left untouched.
- **Permissions:** `theme` (apply colours), `nativeMessaging` (talk to the helper), `alarms` (reconnect to the helper after a failure), `storage` (`storage.local`: the user's eight settings; `storage.session`: the current battery reading for the popup, what was last painted, the helper's last light/dark value, and reconnect counters).
- **Code:** no minification, no remote code, no third-party libraries. The submitted files are the source. `gauge/*.svg` are 51 tiny static images (one per 2% of charge) generated by `tools/build-gauge.js` in the repository; Firefox requires theme images to be packaged files. The theme refers to them with a URL fragment (`#l`, `#r`, `#lr`) that selects the light or right-to-left variant through CSS inside the image; no script is involved.
- **Language:** the UI is English only. `browser.i18n.getMessage("@@bidi_dir")` is read once to mirror the gauge in right-to-left Firefox.
