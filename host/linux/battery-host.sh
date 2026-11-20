#!/bin/bash
# Battery Theme native messaging host for Linux.
#
# Reads the battery from sysfs (/sys/class/power_supply), which needs no
# extra packages. sysfs cannot notify a shell script of changes, so this
# polls every $BATTERY_THEME_POLL seconds (default 5). A poll is a handful of
# small file reads with no process spawned, so it costs next to nothing, and
# a message is only written when the state actually changes.
#
# Light/dark (gsettings) and power-saver mode (powerprofilesctl) do spawn a
# process, so they are refreshed once a minute instead. Both are optional.
#
# Message format: see host/mac/battery-host.sh (protocol v1, identical).
# The host exits when Firefox closes stdin.

SYSFS="${BATTERY_THEME_SYSFS:-/sys/class/power_supply}"
POLL="${BATTERY_THEME_POLL:-5}"
SLOW_EVERY=12 # refresh dark / low-power every this many polls

emit() {
    local message="$1"
    local n
    LC_ALL=C n=${#message}
    # shellcheck disable=SC2059  # the format string is the four length bytes, built on purpose
    printf "\\x$(printf '%02x' $((n & 0xFF)))\\x$(printf '%02x' $(((n >> 8) & 0xFF)))\\x$(printf '%02x' $(((n >> 16) & 0xFF)))\\x$(printf '%02x' $(((n >> 24) & 0xFF)))"
    printf '%s' "$message"
}

# First line of a file, or empty. No subprocess.
read_file() {
    REPLY=""
    [ -r "$1" ] && IFS= read -r REPLY <"$1"
}

is_uint() {
    case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

dark=null
low_power=false
refresh_slow() {
    local scheme profile
    dark=null
    # Inside a Flatpak sandbox gsettings answers from an empty store, not the
    # desktop's, so its answer is not trusted there (the extension then asks
    # Firefox itself).
    if [ -z "${FLATPAK_ID:-}" ] && command -v gsettings >/dev/null 2>&1; then
        scheme="$(gsettings get org.gnome.desktop.interface color-scheme 2>/dev/null)"
        case "$scheme" in
            *prefer-dark*) dark=true ;;
            *default*|*prefer-light*) dark=false ;;
        esac
    fi
    low_power=false
    if command -v powerprofilesctl >/dev/null 2>&1; then
        profile="$(powerprofilesctl get 2>/dev/null)"
        [ "$profile" = "power-saver" ] && low_power=true
    fi
}

read_state() {
    local d type scope status
    local count=0 cap_sum=0 now_sum=0 full_sum=0 rate_sum=0 have_energy=1
    local on_ac=false charging=false charged=false any_discharging=false all_full=true
    local percentage=null minutes=null

    for d in "$SYSFS"/*; do
        [ -d "$d" ] || continue
        read_file "$d/type"; type="$REPLY"
        case "$type" in
            Mains|USB*)
                read_file "$d/online"
                [ "$REPLY" = 1 ] && on_ac=true
                ;;
            Battery)
                # Skip batteries of peripherals (mice, keyboards, headsets,
                # game controllers). The kernel marks them scope=Device; for
                # drivers that leave scope out, go by the names those drivers
                # use, so a wireless mouse is never taken for the laptop.
                read_file "$d/scope"; scope="$REPLY"
                [ "$scope" = Device ] && continue
                if [ -z "$scope" ]; then
                    case "${d##*/}" in
                        hid-*|hidpp_battery_*|wacom_*|sony_controller_battery_*|ps-controller-battery-*|\
                        nintendo_switch_controller_battery_*|steam-controller-*|apple_mfi_*|wiimote_battery_*) continue ;;
                    esac
                fi
                read_file "$d/capacity"
                is_uint "$REPLY" || continue
                count=$((count + 1))
                cap_sum=$((cap_sum + REPLY))

                read_file "$d/status"; status="$REPLY"
                case "$status" in
                    Charging) charging=true; on_ac=true; all_full=false ;;
                    Full) on_ac=true ;;
                    "Not charging") on_ac=true; all_full=false ;;
                    Discharging) any_discharging=true; all_full=false ;;
                    *) all_full=false ;;
                esac

                # Energy (µWh/µW) or charge (µAh/µA) figures, for a weighted
                # percentage across batteries and a time estimate.
                local now="" full="" rate=""
                read_file "$d/energy_now"; now="$REPLY"
                if is_uint "$now"; then
                    read_file "$d/energy_full"; full="$REPLY"
                    read_file "$d/power_now"; rate="$REPLY"
                else
                    read_file "$d/charge_now"; now="$REPLY"
                    read_file "$d/charge_full"; full="$REPLY"
                    read_file "$d/current_now"; rate="$REPLY"
                fi
                if is_uint "$now" && is_uint "$full" && [ "$full" -gt 0 ]; then
                    now_sum=$((now_sum + now))
                    full_sum=$((full_sum + full))
                    is_uint "$rate" && rate_sum=$((rate_sum + rate))
                else
                    have_energy=0
                fi
                ;;
        esac
    done

    if [ "$count" -eq 0 ]; then
        printf '{"v":1,"has_battery":false,"percentage":null,"on_ac":true,"charging":false,"charged":false,"minutes_remaining":null,"low_power":%s,"dark":%s}' \
            "$low_power" "$dark"
        return
    fi

    if [ "$count" -gt 1 ] && [ "$have_energy" -eq 1 ]; then
        percentage=$(((now_sum * 100 + full_sum / 2) / full_sum))
    else
        percentage=$(((cap_sum + count / 2) / count))
    fi
    [ "$percentage" -gt 100 ] && percentage=100

    # A battery that is still draining wins over a second one that is idle.
    if [ "$any_discharging" = true ]; then
        on_ac=false
        charging=false
    elif [ "$charging" = false ] && [ "$all_full" = true ]; then
        charged=true
    fi

    if [ "$have_energy" -eq 1 ] && [ "$rate_sum" -gt 0 ]; then
        if [ "$any_discharging" = true ]; then
            minutes=$((now_sum * 60 / rate_sum))
        elif [ "$charging" = true ] && [ "$full_sum" -gt "$now_sum" ]; then
            minutes=$(((full_sum - now_sum) * 60 / rate_sum))
        fi
        # Ignore nonsense from a rate that is still settling.
        if [ "$minutes" != null ] && { [ "$minutes" -le 0 ] || [ "$minutes" -gt 2880 ]; }; then
            minutes=null
        fi
    fi

    printf '{"v":1,"has_battery":true,"percentage":%s,"on_ac":%s,"charging":%s,"charged":%s,"minutes_remaining":%s,"low_power":%s,"dark":%s}' \
        "$percentage" "$on_ac" "$charging" "$charged" "$minutes" "$low_power" "$dark"
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

refresh_slow

# --once: print one framed message and exit. --json: print the bare state.
if [ "$1" = "--once" ]; then
    send_state
    exit 0
fi
if [ "$1" = "--json" ]; then
    read_state
    echo
    exit 0
fi

# First reading goes out immediately.
send_state

# Poll loop in the background; the main process stays in the foreground
# reading stdin, which is the arrangement Firefox reliably keeps open.
#
# If Firefox crashes or is force-quit, stdin is not always closed (another
# process can still hold the pipe), so the loop also checks that the process
# that started us is still there and shuts everything down if it is not.
main_pid=$$
browser_pid=$PPID

# Waiting without starting a `sleep` process every few seconds: `read` with a
# timeout on a pipe nobody writes to. Whole seconds only on old bash, so any
# other interval (and any failure to set the pipe up) falls back to sleep.
wait_dir=""
case "$POLL" in
    ''|*[!0-9]*) ;;
    *)
        wait_dir="$(mktemp -d "${TMPDIR:-/tmp}/battery-theme.XXXXXX" 2>/dev/null)" &&
            mkfifo "$wait_dir/wait" 2>/dev/null &&
            exec 3<>"$wait_dir/wait" || wait_dir=""
        # The pipe stays open through fd 3; its name is no longer needed.
        [ -n "$wait_dir" ] && rm -rf "$wait_dir"
        ;;
esac
pause() {
    if [ -n "$wait_dir" ]; then
        read -r -t "$POLL" -u 3 _ || true
    else
        sleep "$POLL" &
        wait $!
    fi
}

(
    trap 'exit 0' TERM INT HUP PIPE
    tick=0
    while :; do
        pause
        if ! kill -0 "$browser_pid" 2>/dev/null; then
            # Ends the main process's `cat` (and this loop), which lets the
            # main process run its normal cleanup and exit.
            pkill -P "$main_pid" 2>/dev/null
            exit 0
        fi
        tick=$((tick + 1))
        if [ $((tick % SLOW_EVERY)) -eq 0 ]; then
            refresh_slow
        fi
        send_state
    done
) </dev/null &
loop_pid=$!

cleanup() {
    trap - EXIT
    kill "$loop_pid" 2>/dev/null
    wait "$loop_pid" 2>/dev/null
    exit 0
}
trap cleanup EXIT TERM INT HUP

# Block until Firefox closes stdin (EOF), discarding anything it sends.
cat >/dev/null 2>&1
cleanup
