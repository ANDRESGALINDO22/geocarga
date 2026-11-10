@echo off
cd /d "C:\GeoCarga\geocarga\GeoCarga-App"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "Iniciar-Demo.ps1"
if errorlevel 1 pause
