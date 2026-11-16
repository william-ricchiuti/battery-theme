#!/bin/bash
# Install script for the Battery Theme native messaging host on macOS.
# Copies the host script and manifest to the Firefox native messaging hosts directory.
# Replaces the __SCRIPT_DIR__ placeholder in the manifest with the actual path.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

echo "Installing Battery Theme native messaging host..."

mkdir -p "$DEST_DIR"

cp "$SCRIPT_DIR/battery-host.sh" "$DEST_DIR/battery-host.sh"
chmod +x "$DEST_DIR/battery-host.sh"

MANIFEST_DEST="$DEST_DIR/com.williamricchiuti.batterytheme.json"
cp "$SCRIPT_DIR/com.williamricchiuti.batterytheme.json" "$MANIFEST_DEST"

# Replace the placeholder path with the actual destination.
# macOS sed requires an empty backup extension flag for in-place edits.
if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|__SCRIPT_DIR__|$DEST_DIR|g" "$MANIFEST_DEST"
else
    sed -i "s|__SCRIPT_DIR__|$DEST_DIR|g" "$MANIFEST_DEST"
fi

echo "Installed:"
echo "  Script:   $DEST_DIR/battery-host.sh"
echo "  Manifest: $MANIFEST_DEST"
echo ""
echo "Done. Open the Battery Theme popup in Firefox and choose Try again."