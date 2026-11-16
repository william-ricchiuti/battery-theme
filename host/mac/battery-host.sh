#!/bin/bash
# Battery Theme native messaging host for macOS (works with the stock bash 3.2).
#
# Event-driven: `pmset -g pslog` prints a line whenever the power source
# changes (plug/unplug, percentage tick, sleep/wake). Each such line triggers
# a fresh state read, so a charger change reaches Firefox within a second.
# A slow heartbeat ($BATTERY_THEME_HEARTBEAT, default 60s) also re-reads the
# state to catch things pslog does not report (Low Power Mode, light/dark).
#
# A message is only written when the state actually changes. Messages use the
# native-messaging framing: 32-bit little-endian length, then UTF-8 JSON.
#
# Message shape (protocol v1):
#   {"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,
#    "charged":false,"minutes_remaining":192,"low_power":false,"dark":true}
# minutes_remaining is null when macOS has no estimate. On a machine with no
# battery: {"v":1,"has_battery":false,...} with percentage null.
#
# The host exits when Firefox closes stdin.

HEARTBEAT="${BATTERY_THEME_HEARTBEAT:-60}"

emit() {
    local message="$1"
    local n
    LC_ALL=C n=${#message}
    printf "\\x$(printf '%02x' $((n & 0xFF)))\\x$(printf '%02x' $(((n >> 8) & 0xFF)))\\x$(printf '%02x' $(((n >> 16) & 0xFF)))\\x$(printf '%02x' $(((n >> 24) & 0xFF)))"
    printf '%s' "$message"
}

RE_PCT='([0-9]+)%'
RE_TIME='([0-9]+):([0-9]+) remaining'

read_state() {
    local out line
    local has_battery=false percentage=null on_ac=false charging=false charged=false
    local minutes=null low_power=false dark=false

    out="$(pmset -g batt 2>/dev/null)"
    line="$(printf '%s\n' "$out" | grep -m1 'InternalBattery')"

    case "$out" in *"'AC Power'"*) on_ac=true ;; esac

    if [ -n "$line" ] && [[ $line =~ $RE_PCT ]]; then
        has_battery=true
        percentage="${BASH_REMATCH[1]}"
        case "$line" in
            *"not charging"*|*"discharging"*) ;;
            *"finishing charge"*|*"; charging"*) charging=true ;;
            *"; charged"*) charged=true ;;
        esac
        if [[ $line =~ $RE_TIME ]]; then
            minutes=$((10#${BASH_REMATCH[1]} * 60 + 10#${BASH_REMATCH[2]}))
            # "0:00 remaining" means "still estimating" / "full", not zero minutes.
            [ "$minutes" -eq 0 ] && minutes=null
        fi
    fi

    if pmset -g 2>/dev/null | grep -qE 'lowpowermode[[:space:]]+1'; then
        low_power=true
    fi
    if [ "$(defaults read -g AppleInterfaceStyle 2>/dev/null)" = "Dark" ]; then
        dark=true
    fi

    printf '{"v":1,"has_battery":%s,"percentage":%s,"on_ac":%s,"charging":%s,"charged":%s,"minutes_remaining":%s,"low_power":%s,"dark":%s}' \
        "$has_battery" "$percentage" "$on_ac" "$charging" "$charged" "$minutes" "$low_power" "$dark"
}

last_state=""
send_state() {
    local msg
    msg="$(read_state)"
    if [ "$msg" != "$last_state" ]; then
        emit "$msg"
        last_state="$msg"
    fi
}

# --once: print one framed message and exit (used by tests and for debugging).
if [ "$1" = "--once" ]; then
    send_state
    exit 0
fi
# --json: print the bare JSON state and exit.
if [ "$1" = "--json" ]; then
    read_state
    echo
    exit 0
fi

# First reading goes out immediately.
send_state

# Power-source events arrive through a FIFO so the loop below can time out
# (heartbeat) while waiting for the next one.
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/battery-theme.XXXXXX")"
fifo="$tmp_dir/pslog"
mkfifo "$fifo"

# Event loop, in the background. The main process stays in the foreground
# reading stdin (below): that is the arrangement Firefox reliably keeps open.
(
    pmset -g pslog >"$fifo" 2>/dev/null &
    pmset_pid=$!
    trap 'kill "$pmset_pid" 2>/dev/null; exit 0' TERM INT HUP PIPE
    exec 4<"$fifo"

    while :; do
        if read -r -t "$HEARTBEAT" -u 4 line; then
            case "$line" in
                *InternalBattery*|*"Now drawing"*) send_state ;;
            esac
        else
            # Heartbeat timeout, or pslog went away. If it went away, fall
            # back to plain polling instead of spinning on EOF.
            if ! kill -0 "$pmset_pid" 2>/dev/null; then
                sleep "$HEARTBEAT" &
                wait $!
            fi
            send_state
        fi
    done
) </dev/null &
loop_pid=$!

cleanup() {
    trap - EXIT
    kill "$loop_pid" 2>/dev/null
    wait "$loop_pid" 2>/dev/null
    rm -rf "$tmp_dir"
    exit 0
}
trap cleanup EXIT TERM INT HUP

# Block until Firefox closes stdin (EOF), discarding anything it sends.
cat >/dev/null 2>&1
cleanup
