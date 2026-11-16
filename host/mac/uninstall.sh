#!/bin/bash
# Removes the Battery Theme native messaging host installed by install.sh.
# Firefox stops the running host by itself when the extension is removed or
# the browser quits.

DEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

for f in "$DEST_DIR/battery-host.sh" "$DEST_DIR/com.williamricchiuti.batterytheme.json"; do
    if [ -f "$f" ]; then
        rm -f "$f"
        echo "Removed $f"
    fi
done
echo "Done."
