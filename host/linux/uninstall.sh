#!/bin/bash
# Removes the Battery Theme native messaging host installed by install.sh.

HOST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/battery-theme"
MANIFEST="$HOME/.mozilla/native-messaging-hosts/com.williamricchiuti.batterytheme.json"

for f in "$HOST_DIR/battery-host.sh" "$MANIFEST"; do
    if [ -f "$f" ]; then
        rm -f "$f"
        echo "Removed $f"
    fi
done
rmdir "$HOST_DIR" 2>/dev/null || true
echo "Done."
