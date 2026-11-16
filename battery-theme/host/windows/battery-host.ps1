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

function Get-BatteryInfoJson {
    try {
        $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop
        $percentage = [int]$battery.EstimatedChargeRemaining
        # BatteryStatus: 1=Discharging, 2=AC Power, 3=Charging
        $isCharging = ($battery.BatteryStatus -eq 2 -or $battery.BatteryStatus -eq 3)
        $chargingStr = if ($isCharging) { 'true' } else { 'false' }
        return '{"percentage":' + $percentage + ',"is_charging":' + $chargingStr + '}'
    }
    catch {
        return '{"percentage":100,"is_charging":true}'
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