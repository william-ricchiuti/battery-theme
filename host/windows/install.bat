@echo off
REM Install script for the Battery Theme native messaging host on Windows.
REM Copies the host script and manifest to a local directory and creates
REM a .bat wrapper (native messaging requires an .exe/.bat path, not .ps1).
REM Adds the registry key that Firefox uses to discover the host manifest.

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set DEST_DIR=%LOCALAPPDATA%\battery-theme

echo Installing Battery Theme native messaging host...

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

REM Copy the PowerShell script
copy "%SCRIPT_DIR%battery-host.ps1" "%DEST_DIR%\battery-host.ps1" >nul

REM Create a .bat wrapper that invokes the PowerShell script.
REM Native Messaging on Windows requires the path to be an .exe or .bat.
(
    echo @echo off
    echo powershell -ExecutionPolicy Bypass -NoProfile -File "%DEST_DIR%\battery-host.ps1"
) > "%DEST_DIR%\battery-host.bat"

REM Generate the manifest JSON with the correct absolute path.
REM Backslashes must be escaped as \\ in JSON strings.
set ESCAPED_DEST=%DEST_DIR:\=\\%

(
    echo {
    echo     "name": "com.williamricchiuti.batterytheme",
    echo     "description": "Native messaging host for Battery Theme extension",
    echo     "path": "%ESCAPED_DEST%\\battery-host.bat",
    echo     "type": "stdio",
    echo     "allowed_extensions": ["battery-theme@willy.dev"]
    echo }
) > "%DEST_DIR%\com.williamricchiuti.batterytheme.json"

REM Add the registry key that Firefox looks for.
REM The default value of the key is the full path to the manifest JSON.
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\com.williamricchiuti.batterytheme" /ve /t REG_SZ /d "%DEST_DIR%\com.williamricchiuti.batterytheme.json" /f >nul

echo Installed:
echo   Script:   %DEST_DIR%\battery-host.ps1
echo   Wrapper:  %DEST_DIR%\battery-host.bat
echo   Manifest: %DEST_DIR%\com.williamricchiuti.batterytheme.json
echo   Registry: HKCU\Software\Mozilla\NativeMessagingHosts\com.williamricchiuti.batterytheme
echo.
echo Done. Load the extension in Firefox via about:debugging or install the XPI.

endlocal