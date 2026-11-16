# Optional tab outlines

Firefox's theme API gives extensions colours only, so the extension cannot outline inactive tabs:

- `tab_background_separator` (the old line between tabs) was removed in Firefox 89.
- `theme_experiment` (custom chrome CSS from an extension) only works in Developer Edition and Nightly.

`battery-theme.css` adds a faint fill and a 1px outline to inactive tabs through Firefox's `userChrome.css` mechanism. Its colours are mixed from the tab text colour, so it follows the theme in both light and dark.

## Install (macOS)

```sh
bash userChrome/install-userchrome.sh
```

Then, once:

1. `about:config` → set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`.
2. Restart Firefox.

What the installer does:

- Copies `battery-theme.css` into the profile's `chrome/` folder.
- Adds `@import "battery-theme.css";` as the first line of `chrome/userChrome.css`, creating that file if needed.
- If you already have a `userChrome.css`, it is backed up first (`userChrome.css.backup-<timestamp>`) and its contents are kept.

Options: `--list` shows the profiles it found, `--profile <dir>` picks one (needed when several exist and none is marked default; `about:support` → Profile Folder shows the one in use), `--uninstall` removes the import line and the stylesheet.

## Manual install

Copy `userChrome/battery-theme.css` into `<profile>/chrome/` and add `@import "battery-theme.css";` at the top of `<profile>/chrome/userChrome.css`.

## Status

The selectors were checked against Firefox 160's own `tabs.css`. How the outlines look in the real tab strip has not been reviewed yet; the two percentages in `battery-theme.css` (fill and outline strength) are the knobs.
