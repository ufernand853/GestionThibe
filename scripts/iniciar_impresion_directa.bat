@echo off
setlocal

rem La XP-450B debe estar configurada como impresora predeterminada de Windows.
set "APP_URL=http://localhost:4173/items/download"
if not "%~1"=="" set "APP_URL=%~1"

set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not exist "%BROWSER%" (
  echo No se encontro Microsoft Edge ni Google Chrome.
  exit /b 1
)

start "GestionThibe - impresion directa" "%BROWSER%" --user-data-dir="%TEMP%\GestionThibePrintProfile" --no-first-run --app="%APP_URL%" --kiosk-printing
endlocal
