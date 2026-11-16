# Battery Theme — userChrome.css (optional, for real tab borders)

## Why this exists

Firefox's theme API gives extensions **colors only**. There is no way for an
extension to draw borders or change the background of individual *inactive*
tabs on release Firefox:

- `tab_background_separator` (the old "line between tabs") was **removed in Firefox 89**.
- `theme_experiment` (the only extension mechanism for custom chrome CSS) is
  **Dev Edition / Nightly only** and needs `extensions.experiments.enabled`.

`userChrome.css` is the one supported way to style the chrome on release
Firefox. It's a one-time manual setup, then the extension keeps doing the
dynamic battery colors on top of it.

## Setup (once)

1. `about:config` → search `toolkit.legacyUserProfileCustomizations.stylesheets`
   → set to `true`.
2. `about:support` → under "Application Basics" find **Profile Folder** → click
   **Open Folder** (macOS) / **Show in Finder**.
3. In that profile folder create a `chrome` subfolder if it doesn't exist.
4. Copy `userChrome.css` into `chrome/` as `userChrome.css`.
5. Restart Firefox.

Or run the helper (macOS):

```sh
bash battery-theme/userChrome/install-userchrome.sh
```

## What it does

- Inactive tabs get a slightly darker background, rounded corners, a subtle
  1px outline, and a small gap between them — so they no longer melt into the
  tab strip.
- The active tab keeps the extension's live battery color and is rounded to
  match.

## Tweaks

All values are at the top of the CSS. Common ones:

- `rgba(0, 0, 0, 0.26)` — how much darker inactive tabs are. Raise for more
  contrast, lower for less.
- `rgba(255, 255, 255, 0.13)` — the border brightness. Raise for a more
  obvious border.
- `border-radius: 8px` — corner rounding. Set `0` for squared tabs.

## If the borders don't appear

Nova (Firefox 157+) reworked the tab strip, and the internal selectors
(`.tabbrowser-tab`, `.tab-background`) may have changed. Diagnose with the
Browser Toolbox (about:debugging → "This Firefox" → "Inspect" the default
toolbar, or Ctrl/Cmd+Shift+Alt+I), hover a tab, and check the element names.
Paste what you find and I'll adjust the selectors.
