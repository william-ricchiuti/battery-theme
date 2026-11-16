#!/bin/bash
# Installs userChrome.css into the default Firefox profile on macOS.
# One-time helper; the about:config preference must still be enabled manually.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_DIR="$HOME/Library/Application Support/Firefox/Profiles"

if [ ! -d "$PROFILES_DIR" ]; then
    echo "No Firefox profiles directory found at: $PROFILES_DIR"
    echo "Install Firefox or point this script at your profile folder."
    exit 1
fi

# Pick the most recently used profile (matches what Firefox starts by default).
PROFILE="$(ls -1dt "$PROFILES_DIR"/*/ 2>/dev/null | head -1)"

if [ -z "$PROFILE" ]; then
    echo "No profiles found under $PROFILES_DIR"
    exit 1
fi

CHROME_DIR="$PROFILE/chrome"
mkdir -p "$CHROME_DIR"
cp "$SCRIPT_DIR/userChrome.css" "$CHROME_DIR/userChrome.css"

echo "Installed userChrome.css to:"
echo "  $CHROME_DIR/userChrome.css"
echo ""
echo "Still to do (once):"
echo "  1. about:config -> toolkit.legacyUserProfileCustomizations.stylesheets = true"
echo "  2. Restart Firefox"
