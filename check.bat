@echo off
setlocal
node "%~dp0check-git-status.js" %*
set "exit_code=%errorlevel%"
echo.
pause
endlocal & exit /b %exit_code%
