@echo off
chcp 65001 >nul
title AutoCAD Otomatik Senkronizasyon Koprusu - Mimari Talep
cls
echo ================================================================
echo    MIMARI TALEP - AUTOCAD SENKRONIZASYON KOPRUSU BASLATILIYOR   
echo ================================================================
echo.

set "SCRIPT_FILE=%~dp0autocad_koprusu.ps1"
if not exist "%SCRIPT_FILE%" (
    echo [+] Gerekli bilesenler otomatik hazirlaniyor, lutfen bekleyin...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$lines = Get-Content -LiteralPath '%~f0' -Encoding UTF8; $start = $false; $psLines = @(); foreach ($l in $lines) { if ($start) { $psLines += $l } elseif ($l.Trim() -eq ':::POWERSHELL_START:::') { $start = $true } }; $psLines | Set-Content -LiteralPath '%SCRIPT_FILE%' -Encoding UTF8"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_FILE%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [-] Kopru sonlandi veya bir hata olustu.
    pause
)
exit /b %ERRORLEVEL%

:::POWERSHELL_START:::
<#
.SYNOPSIS
    Mimari Talep - AutoCAD Otomatik Senkronizasyon Kprs (Local Bridge)
    Web uygulamasndan tklanan DWG dosyalarn AutoCAD ile aar,
    Ctrl+S ile kaydedildiinde dorudan sisteme geri ykler.
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Mimari Talep - AutoCAD Senkronizasyon Koprusu"

$PORT = 48791
$SUPABASE_URL = "https://ujlqrxqpdupzjpqgmoms.supabase.co"
$SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbHFyeHFwZHVwempwcWdtb21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTUxNjcsImV4cCI6MjEwMDk5MTE2N30.ry_7rA4apirfjsaTnRvk8D6mSxdS5vrVHVEpozOnhOU"

$WORK_DIR = Join-Path $env:USERPROFILE "Documents\MimariTaslaklar"
if (-not (Test-Path $WORK_DIR)) {
    New-Item -ItemType Directory -Path $WORK_DIR -Force | Out-Null
}

$watchedFiles = @{}
$updatesQueue = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "       MIMARI TALEP - AUTOCAD OTOMATIK SENKRONIZASYON KOPRUSU   " -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " [+] Calisma Klasoru : $WORK_DIR" -ForegroundColor Green
Write-Host " [+] Kopru Adresi    : http://127.0.0.1:$PORT" -ForegroundColor Green
Write-Host " [+] Durum           : Dinleniyor... (Kapatmak icin pencereyi kapatin)" -ForegroundColor White
Write-Host "----------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host " * Web uygulamasinda DWG dosyasina tiklandiginda AutoCAD acilir." -ForegroundColor Gray
Write-Host " * AutoCAD icinde Ctrl+S yaptiginizda degisiklik aninda yuklenir." -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# HTTP Listener Olustur
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$PORT/")
$listener.Prefixes.Add("http://localhost:$PORT/")

try {
    $listener.Start()
} catch {
    Write-Host "[-] HATA: Port $PORT dinlenemedi. Zaten acik bir kopru olabilir: $_" -ForegroundColor Red
    Read-Host "Cikmak icin Enter'a basin..."
    exit
}

function Send-JsonResponse($response, $data, [int]$statusCode = 200) {
    try {
        $json = $data | ConvertTo-Json -Depth 5 -Compress
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
        $response.StatusCode = $statusCode
        $response.ContentType = "application/json; charset=utf-8"
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.OutputStream.Close()
    } catch {}
}

function Send-OptionsResponse($response) {
    try {
        $response.StatusCode = 200
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        $response.ContentLength64 = 0
        $response.OutputStream.Close()
    } catch {}
}

function Is-FileLocked($filePath) {
    try {
        $file = [System.IO.File]::Open($filePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        if ($file) {
            $file.Close()
            $file.Dispose()
        }
        return $false
    } catch {
        return $true
    }
}

function Upload-ToSupabase($filePath, $draftId, $originalFileName) {
    try {
        $cleanBase = [System.IO.Path]::GetFileNameWithoutExtension($originalFileName) -replace '[^a-zA-Z0-9]', '_'
        $ext = [System.IO.Path]::GetExtension($originalFileName)
        if (-not $ext) { $ext = ".dwg" }
        $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $storagePath = "${timestamp}_${cleanBase}${ext}"

        $uploadUrl = "$SUPABASE_URL/storage/v1/object/drawings/$storagePath"
        $headers = @{
            "apikey" = $SUPABASE_KEY
            "Authorization" = "Bearer $SUPABASE_KEY"
            "x-upsert" = "true"
        }

        # 1. Supabase Storage Upload
        $res = Invoke-RestMethod -Uri $uploadUrl -Headers $headers -Method Post -InFile $filePath -ContentType "application/octet-stream"
        $publicUrl = "$SUPABASE_URL/storage/v1/object/public/drawings/$storagePath"
        $fileSize = (Get-Item $filePath).Length

        # 2. Update draft_projects table
        if ($draftId) {
            $patchUrl = "$SUPABASE_URL/rest/v1/draft_projects?id=eq.$draftId"
            $patchBody = @{
                file_url = $publicUrl
                file_size = $fileSize
            } | ConvertTo-Json -Compress

            $patchHeaders = @{
                "apikey" = $SUPABASE_KEY
                "Authorization" = "Bearer $SUPABASE_KEY"
                "Content-Type" = "application/json"
                "Prefer" = "return=representation"
            }
            Invoke-RestMethod -Uri $patchUrl -Headers $patchHeaders -Method Patch -Body $patchBody | Out-Null
        }

        return @{
            success = $true
            publicUrl = $publicUrl
            fileSize = $fileSize
        }
    } catch {
        Write-Host "[-] Upload hatasi: $_" -ForegroundColor Red
        return @{
            success = $false
            error = $_.ToString()
        }
    }
}

# HTTP Dinleyici ve Dosya Izleme Dongusu
$lastCheckTime = [DateTime]::UtcNow
$pendingAsync = $listener.BeginGetContext($null, $null)

try {
    while ($listener.IsListening) {
        # 1. HTTP Istek Kontrolu
        if ($pendingAsync.AsyncWaitHandle.WaitOne(100)) {
            $context = $listener.EndGetContext($pendingAsync)
            $pendingAsync = $listener.BeginGetContext($null, $null)

            $request = $context.Request
            $response = $context.Response
            $path = $request.Url.AbsolutePath
            $method = $request.HttpMethod

            if ($method -eq "OPTIONS") {
                Send-OptionsResponse $response
            }
            elseif ($path -eq "/status") {
                $statusData = @{
                    status = "ok"
                    bridge = "running"
                    workDir = $WORK_DIR
                    watchedCount = $watchedFiles.Count
                    timestamp = [DateTime]::UtcNow.ToString("o")
                }
                Send-JsonResponse $response $statusData
            }
            elseif ($path -eq "/updates") {
                $updatesToSend = @($updatesQueue)
                $updatesQueue.Clear()
                Send-JsonResponse $response @{ updates = $updatesToSend }
            }
            elseif ($path -eq "/open" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $bodyText = $reader.ReadToEnd()
                $body = $bodyText | ConvertFrom-Json

                $draftId = $body.draftId
                $fileName = $body.fileName
                $fileUrl = $body.fileUrl

                if (-not $fileName) { $fileName = "taslak_$draftId.dwg" }
                $safeName = $fileName -replace '[\\/:*?"<>|]', '_'
                $localPath = Join-Path $WORK_DIR $safeName

                Write-Host "`n[+] Istek: $fileName (Taslak ID: $draftId)" -ForegroundColor Cyan
                Write-Host "    Dosya indiriliyor..." -ForegroundColor Gray

                try {
                    Invoke-WebRequest -Uri $fileUrl -OutFile $localPath -UseBasicParsing
                    Write-Host "    Dosya hazir: $localPath" -ForegroundColor Green

                    $item = Get-Item $localPath
                    $mtime = $item.LastWriteTimeUtc
                    $size = $item.Length

                    $watchedFiles[$localPath.ToLower()] = @{
                        draftId = $draftId
                        fileName = $fileName
                        localPath = $localPath
                        lastMtime = $mtime
                        lastSize = $size
                        lastUploadTime = [DateTime]::UtcNow
                        isHandling = $false
                    }

                    Write-Host "    AutoCAD baslatiliyor..." -ForegroundColor Yellow
                    Start-Process -FilePath $localPath

                    Send-JsonResponse $response @{
                        success = $true
                        message = "AutoCAD baslatildi"
                        localPath = $localPath
                    }
                } catch {
                    Write-Host "[-] Dosya hazirlanamadi: $_" -ForegroundColor Red
                    Send-JsonResponse $response @{
                        success = $false
                        error = $_.ToString()
                    } 500
                }
            }
            else {
                Send-JsonResponse $response @{ error = "Not found" } 404
            }
        }

        # 2. Dosya Degisiklik Kontrolu (Her 1 saniyede bir)
        $now = [DateTime]::UtcNow
        if (($now - $lastCheckTime).TotalMilliseconds -ge 1200) {
            $lastCheckTime = $now

            foreach ($key in @($watchedFiles.Keys)) {
                $watch = $watchedFiles[$key]
                $lPath = $watch.localPath

                if (Test-Path $lPath) {
                    $item = Get-Item $lPath
                    $currentMtime = $item.LastWriteTimeUtc
                    $currentSize = $item.Length

                    if (($currentMtime -ne $watch.lastMtime) -and (-not $watch.isHandling)) {
                        $locked = Is-FileLocked $lPath
                        if (-not $locked) {
                            $watch.isHandling = $true
                            Write-Host "`n[!] KAYIT ALGILANDI: $($watch.fileName)" -ForegroundColor Yellow
                            Write-Host "    AutoCAD degisiklikleri sisteme aktariliyor..." -ForegroundColor Cyan

                            Start-Sleep -Milliseconds 600
                            $upRes = Upload-ToSupabase -filePath $lPath -draftId $watch.draftId -originalFileName $watch.fileName

                            if ($upRes.success) {
                                Write-Host "    [OK] BASARIYLA SENKRONIZE EDILDI!" -ForegroundColor Green
                                Write-Host "    Yeni boyut: $($upRes.fileSize) bayt" -ForegroundColor Gray

                                $watch.lastMtime = (Get-Item $lPath).LastWriteTimeUtc
                                $watch.lastSize = (Get-Item $lPath).Length
                                $watch.lastUploadTime = [DateTime]::UtcNow

                                $updatesQueue.Add(@{
                                    draftId = $watch.draftId
                                    fileName = $watch.fileName
                                    fileUrl = $upRes.publicUrl
                                    fileSize = $upRes.fileSize
                                    time = (Get-Date -Format "HH:mm:ss")
                                }) | Out-Null
                            } else {
                                Write-Host "    [-] Yukleme basarisiz oldu: $($upRes.error)" -ForegroundColor Red
                            }

                            $watch.isHandling = $false
                        }
                    }
                }
            }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Host "`n[+] Kopru durduruldu." -ForegroundColor Yellow
}
