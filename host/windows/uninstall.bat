@echo off
REM Removes the Battery Theme native messaging host for the current user:
REM the registry key and the three files install.bat created, then the
REM battery-theme folder if nothing else is left in it. Touches nothing else.
REM
REM uninstall.bat /quiet   does not wait for a key at the end.

setlocal EnableExtensions DisableDelayedExpansion

set "HOST_NAME=com.williamricchiuti.batterytheme"
set "DEST=%LOCALAPPDATA%\battery-theme"
set "REG_KEY=HKCU\Software\Mozilla\NativeMessagingHosts\%HOST_NAME%"
set "RESULT=0"

if not defined LOCALAPPDATA goto :no_localappdata

echo Removing the Battery Theme helper...

reg query "%REG_KEY%" >nul 2>&1
if errorlevel 1 goto :files
reg delete "%REG_KEY%" /f >nul
if errorlevel 1 goto :reg_failed

:files
if exist "%DEST%\battery-host.ps1" del /f /q "%DEST%\battery-host.ps1"
if exist "%DEST%\battery-host.bat" del /f /q "%DEST%\battery-host.bat"
if exist "%DEST%\%HOST_NAME%.json" del /f /q "%DEST%\%HOST_NAME%.json"
REM rmdir without /s only removes an empty folder, so anything else stays.
if exist "%DEST%\" rmdir "%DEST%" 2>nul

if exist "%DEST%\battery-host.ps1" goto :files_left
if exist "%DEST%\battery-host.bat" goto :files_left
if exist "%DEST%\%HOST_NAME%.json" goto :files_left

echo Removed. A helper that is still running stops when Firefox closes.
goto :finish

:no_localappdata
echo ERROR: the LOCALAPPDATA variable is not set.
set "RESULT=1"
goto :finish

:reg_failed
echo ERROR: could not delete the registry key %REG_KEY%.
set "RESULT=1"
goto :finish

:files_left
echo ERROR: some files in "%DEST%" could not be deleted.
set "RESULT=1"
goto :finish

:finish
if /i not "%~1"=="/quiet" pause
endlocal & exit /b %RESULT%
