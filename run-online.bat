@echo off
cd /d "%~dp0"
title TeknikFix online
if not exist node_modules call npm install
start "TeknikFix server" /min cmd /c "node server.js >> data\server.log 2>&1"
start "TeknikFix tunnel" /min cloudflared tunnel run
