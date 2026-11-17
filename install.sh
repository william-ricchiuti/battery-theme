#!/bin/bash
# Installs the Battery Theme helper for this computer (macOS or Linux).
#
# From a download or clone of the project:
#   bash install.sh              install
#   bash install.sh --uninstall  remove
#
# Without downloading anything first:
#   curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main/install.sh | bash -s -- --uninstall
#
# The helper is a small script Firefox starts in the background to read the
# battery. It is installed for the current user only; no sudo needed.
# Windows: run host\windows\install.bat instead.

set -e

BASE_URL="${BATTERY_THEME_BASE_URL:-https://raw.githubusercontent.com/william-ricchiuti/battery-theme/main}"

case "${BATTERY_THEME_OS:-$(uname -s)}" in
    Darwin) platform=mac ;;
    Linux) platform=linux ;;
    *)
        echo "Unsupported system: $(uname -s). On Windows run host\\windows\\install.bat." >&2
        exit 1
        ;;
esac

case "${1:-}" in
    "") script=install.sh ;;
    --uninstall) script=uninstall.sh ;;
    *) echo "Usage: bash install.sh [--uninstall]" >&2; exit 2 ;;
esac

# Running from a copy of the project? Use the files next to this script.
self="${BASH_SOURCE[0]:-}"
if [ -n "$self" ] && [ -f "$self" ]; then
    here="$(cd "$(dirname "$self")" && pwd)"
    if [ -f "$here/host/$platform/$script" ]; then
        exec bash "$here/host/$platform/$script"
    fi
fi

# Otherwise (piped from curl) fetch just the helper files for this system.
if ! command -v curl >/dev/null 2>&1; then
    echo "curl is needed to download the helper. Install curl, or download the project and run install.sh from it." >&2
    exit 1
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/battery-theme-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
for f in battery-host.sh install.sh uninstall.sh; do
    if ! curl -fsSL "$BASE_URL/host/$platform/$f" -o "$tmp/$f"; then
        echo "Could not download $BASE_URL/host/$platform/$f" >&2
        exit 1
    fi
done
bash "$tmp/$script"
