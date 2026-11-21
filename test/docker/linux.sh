#!/bin/bash
# Runs the unit tests and the real-Firefox end-to-end tests on Linux, in
# Docker. Usage:
#   bash test/docker/linux.sh            Debian's firefox-esr
#   bash test/docker/linux.sh release    current Firefox release from Mozilla's apt repository
# Needs Docker. The repository is mounted read-only; nothing is written to it.
set -e
flavour="${1:-esr}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec docker run --rm -v "$root":/repo:ro -e FLAVOUR="$flavour" debian:trixie bash -ec '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null
    apt-get install -y -qq --no-install-recommends nodejs ca-certificates procps wget curl shellcheck >/dev/null
    if [ "$FLAVOUR" = release ]; then
        install -d -m 0755 /etc/apt/keyrings
        wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O /etc/apt/keyrings/packages.mozilla.org.asc
        echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" >/etc/apt/sources.list.d/mozilla.list
        apt-get update -qq >/dev/null
        apt-get install -y -qq --no-install-recommends firefox >/dev/null
        export FIREFOX_BIN=/usr/bin/firefox
    else
        apt-get install -y -qq --no-install-recommends firefox-esr >/dev/null
        export FIREFOX_BIN=/usr/bin/firefox-esr
    fi
    "$FIREFOX_BIN" --version
    bash --version | head -1
    # Work on a copy so the tests cannot touch the mounted repository.
    cp -r /repo /work && cd /work
    useradd -m tester && chown -R tester /work
    su tester -c "FIREFOX_BIN=$FIREFOX_BIN node --test test/*.test.js 2>&1 | grep -E \"^not ok|^# (tests|pass|fail|skipped)\""
    su tester -c "FIREFOX_BIN=$FIREFOX_BIN node --test --test-concurrency=1 test/e2e/*.e2e.js 2>&1 | grep -E \"^not ok|^  error:|SKIP|^# (tests|pass|fail|skipped)\" | cut -c1-400"
'
