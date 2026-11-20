# Battery Theme native messaging host for Windows.
# Runs on the stock Windows PowerShell 5.1 (no PowerShell 7 syntax). Keep this
# file pure ASCII: 5.1 reads a script without a BOM in the ANSI code page.
#
# Reads the power state with GetSystemPowerStatus: one cheap system call that
# already combines several batteries. Windows cannot push power events to a
# plain script, so this polls every 5 seconds; a message is only written when
# the state actually changes. The light/dark setting (one registry value) is
# refreshed once a minute.
#
# A failed read is never reported as "no battery": the last good reading
# stands, the read is retried on the next poll, and after $MaxFailures
# failures in a row the helper exits with code 1 so the extension shows
# "helper not connected" instead of a wrong state.
#
# Messages use the native-messaging framing: 32-bit little-endian length, then
# UTF-8 JSON (protocol v1, identical to host/mac/battery-host.sh):
#   {"v":1,"has_battery":true,"percentage":78,"on_ac":false,"charging":false,
#    "charged":false,"minutes_remaining":192,"low_power":false,"dark":true}
# minutes_remaining is null unless Windows has an estimate while discharging.
# dark is null when the setting cannot be read. No battery:
# has_battery false, percentage null.
#
# The helper exits (code 0) when Firefox closes stdin, and also when the
# process that started it is gone.
#
#   -Json   print the bare JSON state once and exit
#   -Once   print one framed message and exit
param(
    [switch]$Json,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'

$PollMs = 5000          # how often the power state is read
$SlowMs = 60000         # how often the light/dark setting is re-read
$MaxFailures = 5        # failed reads in a row before giving up (exit 1)
$EstimateGapMs = 60000  # a change in the time estimate alone is sent at most this often

# ---------------------------------------------------------------------------
# OS reads. These three functions are the only code that touches Windows, and
# the test hook at the end of the definitions can replace them.
# ---------------------------------------------------------------------------

$script:PowerApi = $null
$script:PowerApiError = ''

# Returns the 12 bytes of a SYSTEM_POWER_STATUS structure:
#   [0] ACLineStatus        0 offline, 1 online, 255 unknown
#   [1] BatteryFlag         bit 8 charging, bit 128 no system battery, 255 unknown
#   [2] BatteryLifePercent  0..100, 255 unknown
#   [3] SystemStatusFlag    1 = Battery Saver on (Windows 10 and later)
#   [4..7] BatteryLifeTime  seconds left as a signed 32-bit value, -1 unknown
#   [8..11] BatteryFullLifeTime (not used)
# Throws when the state cannot be read.
function Get-PowerStatusBytes {
    if ($null -eq $script:PowerApi) {
        try {
            Add-Type -Namespace BatteryTheme -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetSystemPowerStatus([System.Runtime.InteropServices.In, System.Runtime.InteropServices.Out] byte[] status);'
            $script:PowerApi = 'native'
        }
        catch {
            # Add-Type needs the C# compiler, which some locked-down machines
            # block. Windows Forms wraps the same call (without Battery Saver).
            try {
                Add-Type -AssemblyName System.Windows.Forms
                $script:PowerApi = 'winforms'
            }
            catch {
                $script:PowerApi = 'none'
                $script:PowerApiError = $_.Exception.Message
            }
        }
    }

    $buf = New-Object byte[] 12
    if ($script:PowerApi -eq 'native') {
        if (-not [BatteryTheme.Native]::GetSystemPowerStatus($buf)) {
            throw 'GetSystemPowerStatus failed'
        }
    }
    elseif ($script:PowerApi -eq 'winforms') {
        $ps = [System.Windows.Forms.SystemInformation]::PowerStatus
        $buf[0] = [byte]([int]$ps.PowerLineStatus -band 255)
        $buf[1] = [byte]([int]$ps.BatteryChargeStatus -band 255)
        $fraction = [double]$ps.BatteryLifePercent
        if ($fraction -lt 0 -or $fraction -gt 1) { $buf[2] = 255 }
        else { $buf[2] = [byte][Math]::Round($fraction * 100) }
        $buf[3] = 0
        [System.BitConverter]::GetBytes([int]$ps.BatteryLifeRemaining).CopyTo($buf, 4)
    }
    else {
        throw ('no way to read the power state: ' + $script:PowerApiError)
    }
    return , $buf
}

# Raw AppsUseLightTheme value (0 = dark apps, 1 = light apps), or $null when
# the value is missing or unreadable.
function Get-AppsUseLightTheme {
    try {
        return [Microsoft.Win32.Registry]::GetValue('HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize', 'AppsUseLightTheme', $null)
    }
    catch {
        return $null
    }
}

# Parent process id of a process, or 0 when unknown.
function Get-ParentProcessId {
    param([int]$Id)
    $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $Id" -Property ParentProcessId -ErrorAction Stop
    if ($null -eq $p) { return 0 }
    return [int]$p.ParentProcessId
}

# ---------------------------------------------------------------------------
# Logic (no OS access below, apart from stdin/stdout and process handles).
# ---------------------------------------------------------------------------

function Get-DarkSetting {
    $value = Get-AppsUseLightTheme
    if ($null -eq $value) { return $null }
    try { return ([int]$value -eq 0) } catch { return $null }
}

# Turns the raw power bytes into the message fields. Throws when Windows says
# the state is unknown, so the caller treats it as a failed read.
function ConvertTo-State {
    param($Bytes, $Dark)

    $b = [byte[]]$Bytes
    if ($b.Length -lt 8) { throw 'short power status' }
    $ac = [int]$b[0]
    $flags = [int]$b[1]
    $percent = [int]$b[2]
    $saver = ([int]$b[3] -eq 1)
    $seconds = [System.BitConverter]::ToInt32($b, 4)

    if ($flags -eq 255) { throw 'battery status unknown' }

    $state = @{
        has_battery = $false; percentage = $null; on_ac = ($ac -ne 0)
        charging = $false; charged = $false; minutes = $null
        low_power = $saver; dark = $Dark
    }
    if (($flags -band 128) -ne 0) { return $state }  # no system battery

    if ($percent -eq 255) { throw 'battery level unknown' }
    if ($percent -gt 100) { $percent = 100 }

    $charging = (($flags -band 8) -ne 0)
    $onAc = ($ac -eq 1 -or $charging)
    $state.has_battery = $true
    $state.percentage = $percent
    $state.on_ac = $onAc
    $state.charging = $charging
    # Windows has no "fully charged" flag: full, on mains and not charging.
    $state.charged = ($onAc -and -not $charging -and $percent -ge 100)

    # The estimate only means something while running on the battery; -1 is
    # "unknown", and anything under a minute or over 100 hours is noise.
    if (-not $onAc -and $seconds -gt 0) {
        $minutes = [int][Math]::Floor($seconds / 60)
        if ($minutes -ge 1 -and $minutes -lt 6000) { $state.minutes = $minutes }
    }
    return $state
}

function ConvertTo-JsonValue {
    param($Value)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
    return ([int]$Value).ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-StateJson {
    param($State)
    return '{"v":1,"has_battery":' + (ConvertTo-JsonValue $State.has_battery) +
        ',"percentage":' + (ConvertTo-JsonValue $State.percentage) +
        ',"on_ac":' + (ConvertTo-JsonValue $State.on_ac) +
        ',"charging":' + (ConvertTo-JsonValue $State.charging) +
        ',"charged":' + (ConvertTo-JsonValue $State.charged) +
        ',"minutes_remaining":' + (ConvertTo-JsonValue $State.minutes) +
        ',"low_power":' + (ConvertTo-JsonValue $State.low_power) +
        ',"dark":' + (ConvertTo-JsonValue $State.dark) + '}'
}

function Write-Diag {
    param([string]$Text)
    # Firefox shows a native app's stderr in the Browser Console.
    try { [Console]::Error.WriteLine('battery-host: ' + $Text) } catch { }
}

# Writes raw bytes to stdout. Returns $false when the pipe is closed.
function Write-Stdout {
    param([byte[]]$Bytes, [bool]$Framed)
    try {
        if ($Framed) {
            $len = [System.BitConverter]::GetBytes([uint32]$Bytes.Length)
            if (-not [System.BitConverter]::IsLittleEndian) { [Array]::Reverse($len) }
            $script:Stdout.Write($len, 0, 4)
        }
        $script:Stdout.Write($Bytes, 0, $Bytes.Length)
        $script:Stdout.Flush()
        return $true
    }
    catch {
        return $false
    }
}

# The processes whose exit means the browser is gone: our parent, and (when
# the parent is the cmd.exe that runs battery-host.bat) its parent, Firefox.
# Holding Process objects keeps handles open, so a reused id cannot fool us.
function Get-WatchedProcesses {
    $list = @()
    try {
        $self = [System.Diagnostics.Process]::GetCurrentProcess()
        $id = $self.Id
        for ($i = 0; $i -lt 2; $i++) {
            $id = Get-ParentProcessId $id
            if ($id -le 0) { break }
            $proc = [System.Diagnostics.Process]::GetProcessById($id)
            # A "parent" that started after us is a reused id, not our parent.
            if ($proc.StartTime -gt $self.StartTime) { break }
            $list += $proc
            if ($proc.ProcessName -ne 'cmd') { break }
        }
    }
    catch { }
    return , $list
}

function Test-WatchedProcessGone {
    param($Processes)
    foreach ($proc in $Processes) {
        try { if ($proc.HasExited) { return $true } } catch { }
    }
    return $false
}

# Returns the process exit code.
function Invoke-Host {
    $dark = Get-DarkSetting

    if ($Json -or $Once) {
        try {
            $text = ConvertTo-StateJson (ConvertTo-State (Get-PowerStatusBytes) $dark)
        }
        catch {
            Write-Diag ('could not read the power state: ' + $_.Exception.Message)
            return 1
        }
        if ($Json) { $text = $text + "`n" }
        $null = Write-Stdout ([System.Text.Encoding]::UTF8.GetBytes($text)) ([bool]$Once)
        return 0
    }

    # Firefox closing stdin is the signal to exit. The read runs in the
    # background and its wait handle doubles as the poll timer, so the close
    # is noticed at once instead of after a sleep.
    $stdin = [Console]::OpenStandardInput()
    $inBuf = New-Object byte[] 256
    $pending = $stdin.BeginRead($inBuf, 0, $inBuf.Length, $null, $null)

    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $nextPoll = 0
    $nextSlow = $SlowMs
    $failures = 0
    $watched = $null
    $lastFull = $null
    $lastCore = $null
    $lastEmit = 0

    while ($true) {
        $now = $clock.ElapsedMilliseconds
        if ($now -ge $nextPoll) {
            if ($now -ge $nextSlow) {
                $dark = Get-DarkSetting
                $nextSlow = $now + $SlowMs
            }
            if ($null -ne $watched -and (Test-WatchedProcessGone $watched)) { return 0 }

            $state = $null
            try {
                $state = ConvertTo-State (Get-PowerStatusBytes) $dark
                $failures = 0
            }
            catch {
                $failures++
                if ($failures -eq 1) { Write-Diag ('power state read failed, keeping the last reading: ' + $_.Exception.Message) }
                if ($failures -ge $MaxFailures) {
                    Write-Diag ('giving up after ' + $failures + ' failed reads in a row')
                    return 1
                }
            }

            if ($null -ne $state) {
                $full = ConvertTo-StateJson $state
                # "core" is the state without the estimate's number, so a
                # jittery estimate does not send a message on every poll.
                $hadMinutes = ($null -ne $state.minutes)
                $state.minutes = $null
                $core = (ConvertTo-StateJson $state) + $hadMinutes
                if ($core -ne $lastCore -or ($full -ne $lastFull -and ($now - $lastEmit) -ge $EstimateGapMs)) {
                    if (-not (Write-Stdout ([System.Text.Encoding]::UTF8.GetBytes($full)) $true)) { return 0 }
                    $lastFull = $full
                    $lastCore = $core
                    $lastEmit = $now
                }
            }

            # Looked up once, after the first reading has gone out (it is the
            # one slow call here).
            if ($null -eq $watched) { $watched = Get-WatchedProcesses }

            $nextPoll = $clock.ElapsedMilliseconds + $PollMs
        }

        $wait = [int][Math]::Max(0, $nextPoll - $clock.ElapsedMilliseconds)
        if ($pending.AsyncWaitHandle.WaitOne($wait)) {
            $read = 0
            try { $read = $stdin.EndRead($pending) } catch { $read = 0 }
            if ($read -le 0) { return 0 }  # stdin closed: the browser is done with us
            # Anything the extension sends is ignored.
            $pending = $stdin.BeginRead($inBuf, 0, $inBuf.Length, $null, $null)
        }
    }
}

# Test seam: a script named here is dot-sourced and may replace the OS read
# functions and the timing values above. Not used in normal operation.
if ($env:BATTERY_THEME_TEST_HOOK) { . $env:BATTERY_THEME_TEST_HOOK }

$script:Stdout = [Console]::OpenStandardOutput()
$exitCode = 1
try {
    # Only the last value counts: nothing a function leaks may reach stdout,
    # where it would corrupt the message stream.
    $exitCode = [int](@(Invoke-Host) | Select-Object -Last 1)
}
catch {
    Write-Diag ('unexpected error: ' + $_.Exception.Message)
    $exitCode = 1
}
# Environment.Exit rather than `exit`: a background read may still be blocked
# on stdin, and a normal host shutdown could wait for it.
[Environment]::Exit($exitCode)
