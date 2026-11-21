@echo off
REM Installs the Battery Theme native messaging host for the current user.
REM No admin rights needed. Safe to run again to update.
REM
REM   %LOCALAPPDATA%\battery-theme\battery-host.ps1    the helper
REM   %LOCALAPPDATA%\battery-theme\battery-host.bat    what Firefox starts
REM   %LOCALAPPDATA%\battery-theme\com.williamricchiuti.batterytheme.json
REM   HKCU\Software\Mozilla\NativeMessagingHosts\com.williamricchiuti.batterytheme
REM       (default value = full path of the .json manifest)
REM
REM The manifest and the wrapper are copied as they are: the manifest's
REM "path" is relative to the manifest (Firefox allows that on Windows) and
REM the wrapper finds the helper next to itself, so no file has the install
REM path written into it and odd characters in the user name cannot break them.
REM
REM battery-host.bat is a single line on purpose: cmd.exe reads a running batch
REM file by position, so when an update replaces it under a running helper
REM there must be no later lines for the old cmd.exe to stumble into.
REM
REM Delayed expansion stays off so a "!" in a path survives, and every path is
REM quoted so spaces, "&" and parentheses are harmless.
REM
REM install.bat /quiet   does not wait for a key at the end.

setlocal EnableExtensions DisableDelayedExpansion

set "SRC=%~dp0"
set "HOST_NAME=com.williamricchiuti.batterytheme"
set "DEST=%LOCALAPPDATA%\battery-theme"
set "REG_KEY=HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%"
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "RESULT=0"

if not defined LOCALAPPDATA goto :no_localappdata
if not exist "%SRC%battery-host.ps1" goto :missing_source
if not exist "%SRC%battery-host.bat" goto :missing_source
if not exist "%SRC%%HOST_NAME%.json" goto :missing_source

echo Installing the Battery Theme helper...

if not exist "%DEST%\" mkdir "%DEST%"
if not exist "%DEST%\" goto :copy_failed

copy /y "%SRC%battery-host.ps1" "%DEST%\battery-host.ps1" >nul
if errorlevel 1 goto :copy_failed
copy /y "%SRC%battery-host.bat" "%DEST%\battery-host.bat" >nul
if errorlevel 1 goto :copy_failed
copy /y "%SRC%%HOST_NAME%.json" "%DEST%\%HOST_NAME%.json" >nul
if errorlevel 1 goto :copy_failed

reg add "%REG_KEY%" /ve /t REG_SZ /d "%DEST%\%HOST_NAME%.json" /f >nul
if errorlevel 1 goto :reg_failed

echo Installed:
echo   Helper:   "%DEST%\battery-host.ps1"
echo   Wrapper:  "%DEST%\battery-host.bat"
echo   Manifest: "%DEST%\%HOST_NAME%.json"
echo   Registry: %REG_KEY%
echo.

if not exist "%PS_EXE%" goto :no_powershell
echo Current reading from the helper:
"%PS_EXE%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%DEST%\battery-host.ps1" -Json
if errorlevel 1 goto :check_failed
echo.
echo Done. Restart Firefox, or press "Try again" in the Battery Theme popup.
goto :finish

:no_localappdata
echo ERROR: the LOCALAPPDATA variable is not set, so there is nowhere to install to.
set "RESULT=1"
goto :finish

:missing_source
echo ERROR: battery-host.ps1, battery-host.bat and %HOST_NAME%.json
echo must be in the same folder as install.bat. Unzip the whole project first.
set "RESULT=1"
goto :finish

:copy_failed
echo ERROR: could not copy the helper files to "%DEST%".
set "RESULT=1"
goto :finish

:reg_failed
echo ERROR: could not write the registry key %REG_KEY%.
set "RESULT=1"
goto :finish

:no_powershell
echo WARNING: Windows PowerShell was not found at "%PS_EXE%".
echo The files are installed, but the helper cannot run without it.
set "RESULT=1"
goto :finish

:check_failed
echo.
echo WARNING: the files are installed, but the helper did not return a reading.
echo The message above says why. On a managed PC, a policy that blocks
echo PowerShell scripts is the usual cause.
set "RESULT=1"
goto :finish

:finish
if /i not "%~1"=="/quiet" pause
endlocal & exit /b %RESULT%
