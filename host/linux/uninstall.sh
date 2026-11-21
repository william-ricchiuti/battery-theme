#!/bin/bash
# Removes the Battery Theme native messaging host installed by install.sh:
# the regular copy and, if there is one, the copy made for a Flatpak Firefox.
# Nothing else in those folders is touched.

NAME="com.williamricchiuti.batterytheme"
HOST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/battery-theme"
MANIFEST="$HOME/.mozilla/native-messaging-hosts/$NAME.json"
FLATPAK_DIR="$HOME/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts"

for f in "$HOST_DIR/battery-host.sh" "$MANIFEST" \
    "$FLATPAK_DIR/battery-host.sh" "$FLATPAK_DIR/$NAME.json"; do
    if [ -f "$f" ]; then
        rm -f "$f"
        echo "Removed $f"
    fi
done
rmdir "$HOST_DIR" 2>/dev/null || true
echo "Done."
