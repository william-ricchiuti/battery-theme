#!/bin/bash
# Installs the Battery Theme native messaging host on Linux (per user, no sudo).
#   script   -> ~/.local/share/battery-theme/battery-host.sh
#   manifest -> ~/.mozilla/native-messaging-hosts/
#
# That is where a Firefox from your distribution's packages or from
# mozilla.org looks, and also where the desktop looks on behalf of a Snap
# Firefox (which cannot start a helper itself and asks the desktop portal to).
#
# A Flatpak Firefox (org.mozilla.firefox from Flathub) sees neither of those
# folders: its ~/.mozilla is really ~/.var/app/org.mozilla.firefox/.mozilla,
# and it starts the helper inside its own sandbox. When one is detected, a
# second copy of the script and manifest goes there:
#   ~/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts/
# No sandbox permission is changed; reading the battery needs none.

set -e

NAME="com.williamricchiuti.batterytheme"
FLATPAK_APP="org.mozilla.firefox"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/battery-theme"
MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
MANIFEST="$MANIFEST_DIR/$NAME.json"
# Flatpak keeps per-app data in ~/.var/app/<id> (not configurable).
FLATPAK_DATA="$HOME/.var/app/$FLATPAK_APP"
FLATPAK_DIR="$FLATPAK_DATA/.mozilla/native-messaging-hosts"

# install_host <script dir> <manifest dir>
install_host() {
    local script_dir="$1" manifest_dir="$2" escaped
    mkdir -p "$script_dir" "$manifest_dir"
    cp "$SCRIPT_DIR/battery-host.sh" "$script_dir/battery-host.sh"
    chmod +x "$script_dir/battery-host.sh"

    # JSON-escape the path (backslashes and double quotes).
    escaped="${script_dir//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    cat >"$manifest_dir/$NAME.json" <<JSON
{
    "name": "$NAME",
    "description": "Native messaging host for Battery Theme extension",
    "path": "$escaped/battery-host.sh",
    "type": "stdio",
    "allowed_extensions": ["battery-theme@willy.dev"]
}
JSON
}

has_flatpak_firefox() {
    [ -d "$FLATPAK_DATA" ] && return 0
    command -v flatpak >/dev/null 2>&1 || return 1
    flatpak info "$FLATPAK_APP" >/dev/null 2>&1
}

has_snap_firefox() {
    [ -d "$HOME/snap/firefox" ] && return 0
    command -v snap >/dev/null 2>&1 || return 1
    snap list firefox >/dev/null 2>&1
}

install_host "$HOST_DIR" "$MANIFEST_DIR"
echo "Installed:"
echo "  Script:   $HOST_DIR/battery-host.sh"
echo "  Manifest: $MANIFEST"

if has_flatpak_firefox; then
    install_host "$FLATPAK_DIR" "$FLATPAK_DIR"
    echo ""
    echo "Flatpak Firefox found, so a second copy was installed where it looks:"
    echo "  Script:   $FLATPAK_DIR/battery-host.sh"
    echo "  Manifest: $FLATPAK_DIR/$NAME.json"
    echo "  The helper runs inside Firefox's sandbox. It can read the battery"
    echo "  there, and no Flatpak permission was changed or is needed. It cannot"
    echo "  see the desktop's power-saver setting from in there; light and dark"
    echo "  still follow the system, because Firefox itself reports that."
fi

if has_snap_firefox; then
    echo ""
    echo "Snap Firefox found. Nothing extra was installed for it: a Snap Firefox"
    echo "  cannot start the helper itself and instead asks the desktop to start"
    echo "  it from the regular location above."
    echo "  - The first time, a dialog may ask whether Battery Theme may launch"
    echo "    $NAME. Choose Allow."
    echo "    (Ubuntu 22.04 to 25.10 ask once; 26.04 is not expected to ask.)"
    echo "  - This relies on Ubuntu's desktop portal (xdg-desktop-portal, there"
    echo "    by default on Ubuntu desktops from 22.04). On other systems a Snap"
    echo "    Firefox may not be able to start the helper at all."
    echo "  - This project has not tested Snap Firefox. If the popup still says"
    echo "    the helper is not connected, use a Firefox from mozilla.org."
fi

echo ""
echo "Done. Open the Battery Theme popup in Firefox and choose Try again."
