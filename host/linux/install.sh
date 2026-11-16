#!/bin/bash
# Installs the Battery Theme native messaging host on Linux (per user, no sudo).
#   script   -> ~/.local/share/battery-theme/battery-host.sh
#   manifest -> ~/.mozilla/native-messaging-hosts/
#
# Snap and Flatpak builds of Firefox run sandboxed and may not be able to
# start a native host; the Firefox from your distribution's package manager
# or from mozilla.org works.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/battery-theme"
MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
MANIFEST="$MANIFEST_DIR/com.williamricchiuti.batterytheme.json"

mkdir -p "$HOST_DIR" "$MANIFEST_DIR"
cp "$SCRIPT_DIR/battery-host.sh" "$HOST_DIR/battery-host.sh"
chmod +x "$HOST_DIR/battery-host.sh"

# JSON-escape the path (backslashes and double quotes).
escaped="${HOST_DIR//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
cat >"$MANIFEST" <<JSON
{
    "name": "com.williamricchiuti.batterytheme",
    "description": "Native messaging host for Battery Theme extension",
    "path": "$escaped/battery-host.sh",
    "type": "stdio",
    "allowed_extensions": ["battery-theme@willy.dev"]
}
JSON

echo "Installed:"
echo "  Script:   $HOST_DIR/battery-host.sh"
echo "  Manifest: $MANIFEST"
echo ""
echo "Done. Open the Battery Theme popup in Firefox and choose Try again."
