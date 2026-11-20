# Optional tab outlines

Firefox's theme API gives extensions colours only, so the extension cannot outline inactive tabs:

- `tab_background_separator` (the old line between tabs) was removed in Firefox 89.
- `theme_experiment` (custom chrome CSS from an extension) only works in Developer Edition and Nightly.

`battery-theme.css` adds a faint fill and a 1px outline to inactive tabs through Firefox's `userChrome.css` mechanism. Its colours are mixed from the tab text colour, so it follows the theme in both light and dark.

## Install (macOS and Linux)

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

Which profile: the one your installed Firefox starts with (the `[Install…]` entry in `profiles.ini`), not the one marked `Default=1`, which on current Firefox is usually an old unused profile. If more than one Firefox is installed (for example Firefox and Developer Edition) the installer stops and lists them.

Options: `--list` shows the profiles it found, `--all` installs into the profile of every installed Firefox, `--profile <dir>` picks one (`about:support` → Profile Folder shows the one in use), `--uninstall` removes the import line and the stylesheet (with `--all` or `--profile` as for installing).

On Linux it looks in `~/.mozilla/firefox`, then the Snap and Flatpak locations. The Linux paths are covered by tests against made-up profile folders only.

## Manual install

Copy `userChrome/battery-theme.css` into `<profile>/chrome/` and add `@import "battery-theme.css";` at the top of `<profile>/chrome/userChrome.css`.

## Status

The selectors were checked against Firefox 160's own `tabs.css`. How the outlines look in the real tab strip has not been reviewed yet; the two percentages in `battery-theme.css` (fill and outline strength) are the knobs.
