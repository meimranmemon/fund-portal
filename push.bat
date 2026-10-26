@echo off
title Push to GitHub
cd /d "%~dp0"
echo ========================================================
echo   Pushing code to https://github.com/meimranmemon/fund-portal.git
echo ========================================================
echo.
echo Browser window khulegi, wahan GitHub se "Sign in / Authorize" click karein.
echo.
"%~dp0mingit\cmd\git.exe" config --local credential.helper "%~dp0mingit\cmd\git-credential-manager.exe"
"%~dp0mingit\cmd\git.exe" remote set-url origin https://github.com/meimranmemon/fund-portal.git
"%~dp0mingit\cmd\git.exe" branch -M main
"%~dp0mingit\cmd\git.exe" push -u origin main
echo.
echo ========================================================
echo   Code GitHub par push ho chuka hai!
echo ========================================================
pause
