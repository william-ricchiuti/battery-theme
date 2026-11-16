# Battery Theme Native Messaging Host for Windows
# Uses Get-CimInstance Win32_Battery to read battery state and sends JSON
# to Firefox via stdout with the standard 32-bit little-endian message
# length prefix.
# Runs in an infinite loop, polling every $POLL_INTERVAL seconds
# (default 120) and only emitting when the state actually changes, so a
# steady battery costs almost nothing. Exits gracefully when the browser
# closes the stdin pipe.

$ErrorActionPreference = 'Stop'
$POLL_INTERVAL = 120

function Send-NativeMessage {
    param([string]$Json)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $lenBytes = [System.BitConverter]::GetBytes([uint32]$bytes.Length)

    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($lenBytes, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

# Emits protocol v1 (same shape as the macOS host). Fields Windows cannot
# report cheaply (time remaining, low power, light/dark) are sent as null/false.
function Get-BatteryInfoJson {
    $noBattery = '{"v":1,"has_battery":false,"percentage":null,"on_ac":true,"charging":false,"charged":false,"minutes_remaining":null,"low_power":false,"dark":null}'
    try {
        # A machine can have several batteries; use the first one.
        $battery = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop) | Select-Object -First 1
        if ($null -eq $battery) { return $noBattery }
        $percentage = [Math]::Min(100, [Math]::Max(0, [int]$battery.EstimatedChargeRemaining))
        # BatteryStatus: 1=discharging, 2=on AC, 3=fully charged, 6-9=charging variants
        $status = [int]$battery.BatteryStatus
        $charging = ($status -ge 6 -and $status -le 9)
        $charged = ($status -eq 3)
        $onAc = ($status -eq 2 -or $charged -or $charging)
        $b = { param($v) if ($v) { 'true' } else { 'false' } }
        return '{"v":1,"has_battery":true,"percentage":' + $percentage + ',"on_ac":' + (& $b $onAc) + ',"charging":' + (& $b $charging) + ',"charged":' + (& $b $charged) + ',"minutes_remaining":null,"low_power":false,"dark":null}'
    }
    catch {
        return $noBattery
    }
}

# Open stdin stream for async closure detection.
$stdin = [Console]::OpenStandardInput()
$readBuffer = New-Object byte[] 1
$asyncResult = $stdin.BeginRead($readBuffer, 0, 1, $null, $null)

try {
    $last = $null
    while ($true) {
        $msg = Get-BatteryInfoJson
        if ($msg -ne $last) {
            try {
                Send-NativeMessage $msg
            }
            catch {
                # stdout pipe closed - exit gracefully
                break
            }
            $last = $msg
        }

        Start-Sleep -Seconds $POLL_INTERVAL

        if ($asyncResult.IsCompleted) {
            $bytesRead = $stdin.EndRead($asyncResult)
            if ($bytesRead -eq 0) {
                # stdin pipe closed by browser - exit gracefully
                break
            }
            # Data arrived on stdin (ignore it) - start a new read
            $asyncResult = $stdin.BeginRead($readBuffer, 0, 1, $null, $null)
        }
    }
}
catch {
    # Any unhandled error - exit gracefully
}
finally {
    exit 0
}