@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start Social Desk.ps1"
if errorlevel 1 pause
