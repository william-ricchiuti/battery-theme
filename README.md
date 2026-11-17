# Battery Theme

A Firefox theme that reflects your laptop's battery. When the battery is healthy the browser looks almost neutral. As it drains, the tab strip, the active tab and then the toolbar shift from green through amber to red. While charging it turns blue.

Firefox can't read the battery on its own, so there are two parts:

- **The extension** (`extension/`) recolours Firefox and provides the toolbar button and popup.
- **The helper** (`host/`) is a small shell script that Firefox starts in the background. It reads the battery from the operating system and hands it to the extension. It makes no network connections and the extension collects no data.

| System | Status |
| --- | --- |
| macOS | Tested on macOS with Firefox 160. Reacts to the charger within about a second. |
| Linux | Helper is covered by automated tests against a simulated battery, but has not yet been run on a real Linux laptop. Checks the battery every 5 seconds. Snap and Flatpak builds of Firefox may not be able to start it. |
| Windows | Experimental: a PowerShell helper exists but has never been run. |

## Install

### 1. The helper (macOS and Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash
```

That downloads two small scripts for your system and installs them for your user only; no `sudo`. If you'd rather read the code first, download or clone this repository and run `bash install.sh` inside it.

On Windows, download the project and run `host\\windows\\install.bat`.

### 2. The extension

Until the addons.mozilla.org listing is live, load it by hand: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `extension/manifest.json`. A temporary add-on is removed whenever Firefox restarts.

## Using it

Click the battery button in the toolbar to see the percentage, time remaining and these settings:

| Setting | What it does |
| --- | --- |
| Colours | **Green to red**, or **Colour-blind safe** (neutral to orange). Charging is blue in both. |
| Appearance | Follow the system's light/dark mode, or force one. |
| Tint strength | How strongly the battery colour tints the browser. |
| Show percentage on the toolbar button | Adds the number as a badge on the button. |

| Tint Firefox with the battery colour | Turn off to pause the tint. The button and popup keep showing the battery. |

While the tint is on, Battery Theme takes over the browser theme and repaints if another theme is applied. Pause it (or disable the add-on) to use a different theme.

If the button shows **?**, the helper isn't connected: the add-on opens a setup page the first time, and the popup has the install command and a **Try again** button. If it shows **-**, the computer has no battery and the theme stays out of the way.

To see every colour state without waiting for your battery to drain, open `preview.html` in a browser.

## Optional: outlined tabs (macOS)

Firefox themes can only set colours, so the extension can't outline inactive tabs. This optional stylesheet does:

```bash
bash userChrome/install-userchrome.sh
```

Then set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true` in `about:config` and restart Firefox. The installer never overwrites an existing `userChrome.css`; it backs it up and adds one `@import` line. Details are in `userChrome/README.md`.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash -s -- --uninstall
```

(or `bash install.sh --uninstall` from a copy of the project)

```bash
bash userChrome/install-userchrome.sh --uninstall
```

Remove the extension itself from `about:addons`.

## Development

```bash
npm test          # helper, colour model and installer tests
npm run lint      # web-ext lint
npm run build     # zip in web-ext-artifacts/
npm start         # run in a scratch Firefox profile
```

- `extension/theme-colors.js` is the whole colour model: pure functions, with tests that check text contrast at every battery level.
- `extension/background.js` talks to the helper and applies the theme.
- `host/mac/battery-host.sh --json` (or `host/linux/...`) prints the state the helper would send.
- `HANDOFF.md` has the design notes, the message format and the Firefox constraints behind the design.
- `docs/amo-listing.md` has the store listing text and the notes for Mozilla's reviewers.

To get a signed build that survives restarts without the store listing, set `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` from your [Firefox Add-ons API keys](https://addons.mozilla.org/developers/addon/api/key/) and run `npm run sign`.

## Licence

MIT. See `LICENSE`.
