#!/bin/bash
# Installs the Battery Theme helper for this computer (macOS or Linux).
#
#   bash install.sh              install
#   bash install.sh --uninstall  remove
#
# The helper is a small script Firefox starts in the background to read the
# battery. It is installed for the current user only; no sudo needed.
# Windows: run host\windows\install.bat instead.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${BATTERY_THEME_OS:-$(uname -s)}" in
    Darwin) platform=mac ;;
    Linux) platform=linux ;;
    *)
        echo "Unsupported system: $(uname -s). On Windows run host\\windows\\install.bat." >&2
        exit 1
        ;;
esac

case "${1:-}" in
    "") exec bash "$SCRIPT_DIR/host/$platform/install.sh" ;;
    --uninstall) exec bash "$SCRIPT_DIR/host/$platform/uninstall.sh" ;;
    *) echo "Usage: bash install.sh [--uninstall]" >&2; exit 2 ;;
esac
