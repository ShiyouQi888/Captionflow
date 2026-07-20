param(
    [string]$Version = "8.0.1"
)

$ErrorActionPreference = "Stop"

# Downloads the fixed FFmpeg release bundled by the Windows installer.
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = Join-Path $repoRoot "tools\ffmpeg\8.0\bin"
$archive = Join-Path $env:TEMP "ffmpeg-$Version-essentials_build.zip"
$extractRoot = Join-Path $env:TEMP "captionflow-ffmpeg-$Version"
$downloadUrl = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-$Version-essentials_build.zip"

Remove-Item $targetRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $targetRoot, $extractRoot | Out-Null

Write-Host "Downloading FFmpeg $Version essentials build..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
Expand-Archive -Path $archive -DestinationPath $extractRoot -Force

$binDirectory = Get-ChildItem $extractRoot -Directory |
    ForEach-Object { Join-Path $_.FullName "bin" } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

if (-not $binDirectory) { throw "FFmpeg archive did not contain a bin directory." }

Copy-Item (Join-Path $binDirectory "ffmpeg.exe") $targetRoot -Force
Copy-Item (Join-Path $binDirectory "ffprobe.exe") $targetRoot -Force

& (Join-Path $targetRoot "ffmpeg.exe") -version
if ($LASTEXITCODE -ne 0) { throw "Bundled FFmpeg validation failed." }

Write-Host "Bundled FFmpeg is ready: $targetRoot"
