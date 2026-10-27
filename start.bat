@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Axiom reparation
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js mangler. Installer det fra https://nodejs.org og koer filen igen.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installerer...
  call npm install
  if errorlevel 1 (
    echo Installationen mislykkedes.
    pause
    exit /b 1
  )
)
echo.
echo Kunder:  http://localhost:4321
echo Sager:   http://localhost:4321/admin
echo Adgangskoden staar i filen .env som ADMIN_PASSWORD
echo Luk ikke dette vindue, mens siden skal vaere i gang.
echo.
start "" http://localhost:4321
node server.js
echo.
echo Serveren er stoppet.
pause
