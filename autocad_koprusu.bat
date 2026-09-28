@echo off
chcp 65001 >nul
title AutoCAD Otomatik Senkronizasyon Koprusu - Mimari Talep
cls
echo ================================================================
echo    MIMARI TALEP - AUTOCAD SENKRONIZASYON KOPRUSU BASLATILIYOR   
echo ================================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autocad_koprusu.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [-] Kopru sonlandi veya bir hata olustu.
    pause
)
