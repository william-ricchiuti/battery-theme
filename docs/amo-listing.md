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
- **Light and dark.** Follows your system appearance, or pick one.
- **Colour-blind-safe option.** A neutral-to-orange palette that doesn't rely on telling red from green.
- **Toolbar button.** Shows the exact percentage, time remaining and the settings.

**This add-on needs a helper.** Firefox does not let extensions read the battery, so Battery Theme uses a small open-source shell script on your computer that reads the battery level and passes it to the extension. Without it the add-on does nothing except show you how to install it. Setup takes one command:

https://github.com/william-ricchiuti/battery-theme#install

macOS is fully supported. Linux support is new and Windows support is experimental.

**Privacy.** Battery Theme collects nothing and makes no network connections. The helper only reads the battery state, light/dark setting and low-power setting from your operating system.

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

## Screenshots to take (real Firefox, 1280x800 or larger)

1. Healthy battery, dark mode: the near-neutral look.
2. Around 20%: amber/orange strip and active tab.
3. Under 10%: the red state.
4. Charging: blue.
5. The popup open, showing percentage and settings.
6. Light mode at a low level.

`preview.html` shows what each state should look like, but the listing needs screenshots of the real browser.

## Notes to reviewer

Battery Theme uses native messaging because `navigator.getBattery` is not available to extensions in Firefox.

- **Native host:** `com.williamricchiuti.batterytheme`, a plain shell script (PowerShell on Windows). Source is in the same repository as the extension, under `host/`: https://github.com/william-ricchiuti/battery-theme
- **What the host does:** reads battery state from the OS (`pmset` on macOS, `/sys/class/power_supply` on Linux, `Win32_Battery` on Windows) and writes it to stdout as JSON. It never reads from the network or the filesystem beyond that, and it ignores everything the extension sends it.
- **Message shape:** `{"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,"charged":false,"minutes_remaining":192,"low_power":false,"dark":true}`
- **To test with the host (macOS or Linux):** `git clone https://github.com/william-ricchiuti/battery-theme && bash battery-theme/install.sh`, then open the popup and choose Try again. It installs per user, without sudo; `bash battery-theme/install.sh --uninstall` removes it.
- **To test without the host:** the toolbar button shows "?" and the popup explains the setup. The browser theme is left untouched.
- **Permissions:** `theme` (apply colours), `nativeMessaging` (talk to the helper), `alarms` (reconnect to the helper after a failure), `storage` (the four user settings and the last painted state).
- **Code:** no build step, no minification, no remote code, no third-party libraries. The submitted files are the source.
