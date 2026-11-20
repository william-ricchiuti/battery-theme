#!/bin/bash
# Installs (or removes) the optional Battery Theme tab outlines in a Firefox
# profile on macOS or Linux.
#
#   install-userchrome.sh                    install into the profile Firefox uses
#   install-userchrome.sh --all              install into the profile of every installed Firefox
#   install-userchrome.sh --profile <dir>    install into a specific profile
#   install-userchrome.sh --list             show the profiles it can see
#   install-userchrome.sh --uninstall [--all | --profile <dir>]
#
# It never overwrites your userChrome.css. The styles go into
# chrome/battery-theme.css and one @import line is added to userChrome.css
# (a timestamped backup is made first if that file already exists).
#
# You still have to enable the pref once and restart Firefox:
#   about:config -> toolkit.legacyUserProfileCustomizations.stylesheets = true

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${BATTERY_THEME_FIREFOX_DIR:-}" ]; then
    FIREFOX_DIR="$BATTERY_THEME_FIREFOX_DIR"
elif [ "$(uname -s)" = Darwin ]; then
    FIREFOX_DIR="$HOME/Library/Application Support/Firefox"
else
    # Regular packages first, then Snap and Flatpak, which keep their own copy.
    FIREFOX_DIR="$HOME/.mozilla/firefox"
    for d in "$HOME/.mozilla/firefox" "$HOME/snap/firefox/common/.mozilla/firefox" \
        "$HOME/.var/app/org.mozilla.firefox/.mozilla/firefox"; do
        if [ -f "$d/profiles.ini" ]; then FIREFOX_DIR="$d"; break; fi
    done
fi
INI="$FIREFOX_DIR/profiles.ini"
IMPORT_LINE='@import "battery-theme.css"; /* Battery Theme */'

action=install
profile=""
all=0
while [ $# -gt 0 ]; do
    case "$1" in
        --profile)
            if [ $# -lt 2 ]; then echo "--profile needs a folder" >&2; exit 2; fi
            profile="$2"; shift 2 ;;
        --all) all=1; shift ;;
        --uninstall) action=uninstall; shift ;;
        --list) action=list; shift ;;
        -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

# Prints one line per profile from profiles.ini: "<kind><TAB><absolute path>"
#   kind I  the profile an installed Firefox starts with (its [Install...] section).
#           This is what matters: a machine with Firefox and Developer Edition
#           has one of these each.
#   kind D  marked Default=1 in its [Profile...] section. On current Firefox
#           that is often an old, unused profile, so it only counts when no
#           [Install...] section names an existing profile.
#   kind -  any other profile
list_profiles() {
    [ -f "$INI" ] || return 0
    awk -v base="$FIREFOX_DIR" '
        function abs(p, rel) { return (rel != "0") ? base "/" p : p }
        function flush() {
            if (section == "profile" && path != "") {
                paths[++n] = abs(path, relative); legacy[n] = isdefault
            }
        }
        { sub(/\r$/, "") }
        /^\[/ {
            flush()
            section = ($0 ~ /^\[Profile/) ? "profile" : ($0 ~ /^\[Install/) ? "install" : "other"
            path = ""; relative = "1"; isdefault = "0"; next
        }
        section == "profile" && /^Path=/ { path = substr($0, 6) }
        section == "profile" && /^IsRelative=/ { relative = substr($0, 12) }
        section == "profile" && /^Default=1$/ { isdefault = "1" }
        # An install names its profile by the same Path string the profile uses.
        section == "install" && /^Default=/ { used[substr($0, 9)] = 1 }
        END {
            flush()
            matched = 0
            for (i = 1; i <= n; i++) {
                kind[i] = "-"
                for (u in used) if (paths[i] == abs(u, "1") || paths[i] == u) { kind[i] = "I"; matched++ }
            }
            for (i = 1; i <= n; i++) {
                # Default=1 only counts when no install points at a profile that exists.
                if (matched == 0 && legacy[i] == "1") kind[i] = "D"
                print kind[i] "\t" paths[i]
            }
        }
    ' "$INI"
}

TAB="$(printf '\t')"

if [ "$action" = list ]; then
    found="$(list_profiles)"
    if [ -z "$found" ]; then
        echo "No Firefox profiles found in: $INI"
        exit 1
    fi
    printf '%s\n' "$found" | while IFS="$TAB" read -r kind path; do
        case "$kind" in
            I) echo "$path  (in use by an installed Firefox)" ;;
            D) echo "$path  (default)" ;;
            *) echo "$path" ;;
        esac
    done
    exit 0
fi

# Which profile(s) to work on, one path per line.
if [ -n "$profile" ]; then
    targets="$profile"
else
    found="$(list_profiles)"
    count="$(printf '%s' "$found" | grep -c . || true)"
    chosen="$(printf '%s\n' "$found" | grep "^[ID]$TAB" | cut -f2- || true)"
    chosen_count="$(printf '%s' "$chosen" | grep -c . || true)"
    if [ "$count" = 0 ]; then
        echo "No Firefox profiles found in: $INI" >&2
        echo "Pass the profile folder yourself: --profile <dir>  (see about:support -> Profile Folder)" >&2
        exit 1
    elif [ "$count" = 1 ]; then
        targets="$(printf '%s\n' "$found" | cut -f2-)"
    elif [ "$chosen_count" = 1 ] || { [ "$all" = 1 ] && [ "$chosen_count" -gt 1 ]; }; then
        targets="$chosen"
    elif [ "$chosen_count" -gt 1 ]; then
        echo "More than one Firefox is installed here (for example Firefox and Developer Edition)," >&2
        echo "each with its own profile:" >&2
        printf '%s\n' "$chosen" | sed 's/^/  /' >&2
        echo "Use --all for all of them, or pick one with: --profile <dir>" >&2
        echo "(about:support -> Profile Folder shows the one a running Firefox uses)" >&2
        exit 1
    else
        echo "Several Firefox profiles exist and none is clearly the one in use:" >&2
        printf '%s\n' "$found" | cut -f2- | sed 's/^/  /' >&2
        echo "Choose one with: --profile <dir>  (about:support -> Profile Folder shows the one in use)" >&2
        exit 1
    fi
fi

backup_user_chrome() {
    local backup
    backup="$USER_CHROME.backup-$(date +%Y%m%d-%H%M%S)"
    cp "$USER_CHROME" "$backup"
    echo "Backed up your userChrome.css to:"
    echo "  $backup"
}

do_profile() {
profile="$1"
if [ ! -d "$profile" ]; then
    echo "Profile folder does not exist: $profile" >&2
    exit 1
fi

CHROME_DIR="$profile/chrome"
USER_CHROME="$CHROME_DIR/userChrome.css"
OURS="$CHROME_DIR/battery-theme.css"

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
    return 0
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
}

# Check every target before touching any of them.
printf '%s\n' "$targets" | while IFS= read -r p; do
    if [ ! -d "$p" ]; then
        echo "Profile folder does not exist: $p" >&2
        exit 1
    fi
done
printf '%s\n' "$targets" | while IFS= read -r p; do
    do_profile "$p"
done

if [ "$action" = uninstall ]; then
    echo "Done. Restart Firefox."
else
    echo ""
    echo "Still to do (once):"
    echo "  1. about:config -> toolkit.legacyUserProfileCustomizations.stylesheets = true"
    echo "  2. Restart Firefox"
fi
