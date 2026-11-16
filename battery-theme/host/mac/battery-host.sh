#!/bin/bash
# Battery Theme Native Messaging Host for macOS
# Uses pmset -g batt to read battery state and sends JSON to Firefox via stdout
# with the standard 32-bit little-endian message length prefix.
# Runs in an infinite loop, polling every $BATTERY_THEME_INTERVAL seconds
# (default 120) and only emitting when the state actually changes, so a
# steady battery costs almost nothing. Exits gracefully when the browser
# closes the stdin pipe.

emit() {
    local message="$1"
    local byte_len
    LC_ALL=C byte_len=${#message}
    printf "\x$(printf '%02x' $((byte_len & 0xFF)))\x$(printf '%02x' $(((byte_len >> 8) & 0xFF)))\x$(printf '%02x' $(((byte_len >> 16) & 0xFF)))\x$(printf '%02x' $(((byte_len >> 24) & 0xFF)))"
    printf '%s' "$message"
}

get_battery_info() {
    local output
    local percentage
    local charging=false

    output=$(pmset -g batt 2>/dev/null)

    percentage=$(echo "$output" | grep -oE '[0-9]+%' | head -1 | tr -d '%')

    if echo "$output" | grep -q 'AC Power'; then
        charging=true
    fi

    if [ -z "$percentage" ]; then
        percentage=100
    fi

    echo "{\"percentage\": ${percentage}, \"is_charging\": ${charging}}"
}

POLL_INTERVAL="${BATTERY_THEME_INTERVAL:-120}"

last_state=""
send_state() {
    local msg
    msg="$(get_battery_info)"
    if [ "$msg" != "$last_state" ]; then
        emit "$msg"
        last_state="$msg"
    fi
}

# Emit immediately so the first message is guaranteed to go out
# before we start the background loop and block on stdin.
send_state

# Background sender: poll, emitting only when the state changes.
# stdin is redirected from /dev/null so the subshell does not
# consume the parent's stdin pipe (which we need for closure detection).
(
    while true; do
        sleep "$POLL_INTERVAL"
        send_state
    done
) </dev/null &

bg_pid=$!

# Block until the browser closes stdin (EOF on the pipe).
# cat reads from stdin (the Firefox pipe) and discards everything.
# When the pipe closes, cat returns and we proceed to exit.
cat >/dev/null 2>&1 || true

# Clean up background process and exit gracefully.
kill "$bg_pid" 2>/dev/null || true
wait "$bg_pid" 2>/dev/null || true
exit 0