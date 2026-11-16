#!/bin/bash
# Installs (or removes) the optional Battery Theme tab outlines in a Firefox
# profile on macOS.
#
#   install-userchrome.sh                    install into the default profile
#   install-userchrome.sh --profile <dir>    install into a specific profile
#   install-userchrome.sh --list             show the profiles it can see
#   install-userchrome.sh --uninstall [--profile <dir>]
#
# It never overwrites your userChrome.css. The styles go into
# chrome/battery-theme.css and one @import line is added to userChrome.css
# (a timestamped backup is made first if that file already exists).
#
# You still have to enable the pref once and restart Firefox:
#   about:config -> toolkit.legacyUserProfileCustomizations.stylesheets = true

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIREFOX_DIR="$HOME/Library/Application Support/Firefox"
INI="$FIREFOX_DIR/profiles.ini"
IMPORT_LINE='@import "battery-theme.css"; /* Battery Theme */'

action=install
profile=""
while [ $# -gt 0 ]; do
    case "$1" in
        --profile) profile="$2"; shift 2 ;;
        --uninstall) action=uninstall; shift ;;
        --list) action=list; shift ;;
        -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

# Prints one line per profile from profiles.ini: "<default 0|1><TAB><absolute path>"
list_profiles() {
    [ -f "$INI" ] || return 0
    awk -v base="$FIREFOX_DIR" '
        function flush() {
            if (inprofile && path != "") {
                if (relative != "0") path = base "/" path
                print isdefault "\t" path
            }
        }
        /^\[/ { flush(); inprofile = ($0 ~ /^\[Profile/); path = ""; relative = "1"; isdefault = "0"; next }
        { sub(/\r$/, "") }
        /^Path=/ { path = substr($0, 6) }
        /^IsRelative=/ { relative = substr($0, 12) }
        /^Default=1$/ { isdefault = "1" }
        END { flush() }
    ' "$INI"
}

if [ "$action" = list ]; then
    found="$(list_profiles)"
    if [ -z "$found" ]; then
        echo "No Firefox profiles found in: $INI"
        exit 1
    fi
    printf '%s\n' "$found" | while IFS="$(printf '\t')" read -r isdefault path; do
        if [ "$isdefault" = 1 ]; then echo "$path  (default)"; else echo "$path"; fi
    done
    exit 0
fi

if [ -z "$profile" ]; then
    found="$(list_profiles)"
    count="$(printf '%s' "$found" | grep -c . || true)"
    defaults="$(printf '%s\n' "$found" | grep -c '^1' || true)"
    if [ "$count" = 0 ]; then
        echo "No Firefox profiles found in: $INI" >&2
        echo "Pass the profile folder yourself: --profile <dir>  (see about:support -> Profile Folder)" >&2
        exit 1
    elif [ "$count" = 1 ]; then
        profile="$(printf '%s\n' "$found" | cut -f2-)"
    elif [ "$defaults" = 1 ]; then
        profile="$(printf '%s\n' "$found" | grep '^1' | cut -f2-)"
    else
        echo "Several Firefox profiles exist and none is clearly the default:" >&2
        printf '%s\n' "$found" | cut -f2- | sed 's/^/  /' >&2
        echo "Choose one with: --profile <dir>  (about:support -> Profile Folder shows the one in use)" >&2
        exit 1
    fi
fi

if [ ! -d "$profile" ]; then
    echo "Profile folder does not exist: $profile" >&2
    exit 1
fi

CHROME_DIR="$profile/chrome"
USER_CHROME="$CHROME_DIR/userChrome.css"
OURS="$CHROME_DIR/battery-theme.css"

backup_user_chrome() {
    local backup="$USER_CHROME.backup-$(date +%Y%m%d-%H%M%S)"
    cp "$USER_CHROME" "$backup"
    echo "Backed up your userChrome.css to:"
    echo "  $backup"
}

if [ "$action" = uninstall ]; then
    if [ -f "$USER_CHROME" ] && grep -qF 'battery-theme.css' "$USER_CHROME"; then
        backup_user_chrome
        grep -vF 'battery-theme.css' "$USER_CHROME" > "$USER_CHROME.tmp" || true
        mv "$USER_CHROME.tmp" "$USER_CHROME"
        echo "Removed the Battery Theme @import from userChrome.css"
    fi
    if [ -f "$OURS" ]; then
        rm -f "$OURS"
        echo "Removed $OURS"
    fi
    echo "Done. Restart Firefox."
    exit 0
fi

mkdir -p "$CHROME_DIR"
cp "$SCRIPT_DIR/battery-theme.css" "$OURS"

if [ ! -f "$USER_CHROME" ]; then
    printf '%s\n' "$IMPORT_LINE" > "$USER_CHROME"
elif grep -qF 'Battery Theme — userChrome.css' "$USER_CHROME"; then
    # Left behind by the old installer, which copied its whole stylesheet here.
    backup_user_chrome
    printf '%s\n' "$IMPORT_LINE" > "$USER_CHROME"
elif ! grep -qF 'battery-theme.css' "$USER_CHROME"; then
    # Someone else's userChrome.css: keep it, just add our import at the top
    # (@import rules have to come before any other rule).
    backup_user_chrome
    { printf '%s\n' "$IMPORT_LINE"; cat "$USER_CHROME"; } > "$USER_CHROME.tmp"
    mv "$USER_CHROME.tmp" "$USER_CHROME"
fi

echo "Installed tab outlines into:"
echo "  $OURS"
echo ""
echo "Still to do (once):"
echo "  1. about:config -> toolkit.legacyUserProfileCustomizations.stylesheets = true"
echo "  2. Restart Firefox"
