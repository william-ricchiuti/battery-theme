# Test stand-in for the Windows reads in host/windows/battery-host.ps1.
# Dot-sourced by the helper when BATTERY_THEME_TEST_HOOK points here. Must
# stay compatible with Windows PowerShell 5.1 and pure ASCII.
#
# $env:BT_FAKE_DIR holds:
#   power.json  {"ac":0,"flag":1,"percent":78,"saver":0,"seconds":11520}
#               (the fields of SYSTEM_POWER_STATUS), or the word FAIL to make
#               the read throw
#   dark        the AppsUseLightTheme value ("0" or "1"); no file = no value
# Optional: BT_POLL_MS, BT_SLOW_MS, BT_MAX_FAILURES, BT_ESTIMATE_GAP_MS,
# BT_FAKE_PARENT (a process id to report as the helper's parent).

if ($env:BT_POLL_MS) { $PollMs = [int]$env:BT_POLL_MS }
if ($env:BT_SLOW_MS) { $SlowMs = [int]$env:BT_SLOW_MS }
if ($env:BT_MAX_FAILURES) { $MaxFailures = [int]$env:BT_MAX_FAILURES }
if ($env:BT_ESTIMATE_GAP_MS) { $EstimateGapMs = [int]$env:BT_ESTIMATE_GAP_MS }

function Get-PowerStatusBytes {
    $text = [System.IO.File]::ReadAllText((Join-Path $env:BT_FAKE_DIR 'power.json'))
    if ($text -match 'FAIL') { throw 'simulated read failure' }
    $o = $text | ConvertFrom-Json
    $buf = New-Object byte[] 12
    $buf[0] = [byte]$o.ac
    $buf[1] = [byte]$o.flag
    $buf[2] = [byte]$o.percent
    $buf[3] = [byte]$o.saver
    [System.BitConverter]::GetBytes([int]$o.seconds).CopyTo($buf, 4)
    return , $buf
}

function Get-AppsUseLightTheme {
    $file = Join-Path $env:BT_FAKE_DIR 'dark'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    return [int]([System.IO.File]::ReadAllText($file).Trim())
}

function Get-ParentProcessId {
    param([int]$Id)
    if ($env:BT_FAKE_PARENT -and $Id -eq $PID) { return [int]$env:BT_FAKE_PARENT }
    return 0
}
