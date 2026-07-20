param(
    [string]$PythonVersion = "3.13.5",
    [switch]$UseLocalModelCache
)

$ErrorActionPreference = "Stop"

# Builds the redistributable CPU runtime used by the full offline installer.
$repoRoot = Split-Path -Parent $PSScriptRoot
$pythonRoot = Join-Path $repoRoot "python"
$runtimeRoot = Join-Path $pythonRoot "runtime\python"
$modelsRoot = Join-Path $pythonRoot "models"
$archive = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"

Remove-Item $runtimeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $runtimeRoot, $modelsRoot | Out-Null

Write-Host "Downloading embedded Python $PythonVersion..."
Invoke-WebRequest -Uri $pythonUrl -OutFile $archive
Expand-Archive -Path $archive -DestinationPath $runtimeRoot -Force

$pth = Get-ChildItem $runtimeRoot -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) { throw "Unable to configure embedded Python path." }
$pthContents = Get-Content $pth.FullName | ForEach-Object {
    if ($_ -match '^#import site$') { "import site" } else { $_ }
}
if ($pthContents -notcontains "Lib\site-packages") { $pthContents += "Lib\site-packages" }
Set-Content -Path $pth.FullName -Value $pthContents -Encoding ascii

$python = Join-Path $runtimeRoot "python.exe"
$getPip = Join-Path $env:TEMP "get-pip.py"
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip
& $python $getPip
& $python -m pip install --no-cache-dir --upgrade pip setuptools wheel
& $python -m pip install --no-cache-dir -r (Join-Path $pythonRoot "requirements-qwen-asr.txt")

function Copy-QwenModel([string]$name) {
    $destination = Join-Path $modelsRoot $name
    Remove-Item $destination -Recurse -Force -ErrorAction SilentlyContinue
    $cacheRoot = Join-Path $env:USERPROFILE ".cache\huggingface\hub"
    $cacheName = "models--Qwen--$name"
    $snapshots = Join-Path $cacheRoot "$cacheName\snapshots"
    $snapshot = if ($UseLocalModelCache -and (Test-Path $snapshots)) {
        Get-ChildItem $snapshots -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    if ($snapshot) {
        Write-Host "Copying cached $name..."
        Copy-Item $snapshot.FullName $destination -Recurse -Force
        return
    }

    Write-Host "Downloading $name..."
    $script = "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Qwen/$name', local_dir=r'$destination')"
    & $python -c $script
    if ($LASTEXITCODE -ne 0) { throw "Unable to download Qwen/$name." }
}

Copy-QwenModel "Qwen3-ASR-0.6B"
Copy-QwenModel "Qwen3-ForcedAligner-0.6B"

& $python -c "import torch; from qwen_asr import Qwen3ASRModel; print('CaptionFlow offline runtime ready:', torch.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Embedded runtime validation failed." }
Write-Host "Offline runtime is ready. Build with: pnpm tauri build --bundles nsis"
