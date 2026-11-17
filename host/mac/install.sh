#!/bin/bash
# Install script for the Battery Theme native messaging host on macOS.
# Copies the host script to the Firefox native messaging hosts directory and
# writes the manifest that tells Firefox where it is.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

echo "Installing Battery Theme native messaging host..."

mkdir -p "$DEST_DIR"

cp "$SCRIPT_DIR/battery-host.sh" "$DEST_DIR/battery-host.sh"
chmod +x "$DEST_DIR/battery-host.sh"

MANIFEST_DEST="$DEST_DIR/com.williamricchiuti.batterytheme.json"

# JSON-escape the path (backslashes and double quotes).
escaped="${DEST_DIR//\\/\\\\}"
escaped="${escaped//\"/\\\"}"
cat >"$MANIFEST_DEST" <<JSON
{
    "name": "com.williamricchiuti.batterytheme",
    "description": "Native messaging host for Battery Theme extension",
    "path": "$escaped/battery-host.sh",
    "type": "stdio",
    "allowed_extensions": ["battery-theme@willy.dev"]
}
JSON

echo "Installed:"
echo "  Script:   $DEST_DIR/battery-host.sh"
echo "  Manifest: $MANIFEST_DEST"
echo ""
echo "Done. Open the Battery Theme popup in Firefox and choose Try again."