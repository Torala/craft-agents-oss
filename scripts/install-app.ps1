# Craft Agent Windows Installer
# Usage: irm https://agents.craft.do/install-app.ps1 | iex

$ErrorActionPreference = "Stop"

$VERSIONS_URL = "https://agents.craft.do/electron"
$DOWNLOAD_DIR = "$env:TEMP\craft-agent-install"
$APP_NAME = "Craft Agent"

# Colors for output
function Write-Info { Write-Host "> $args" -ForegroundColor Blue }
function Write-Success { Write-Host "> $args" -ForegroundColor Green }
function Write-Warn { Write-Host "! $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "x $args" -ForegroundColor Red; exit 1 }

# Check for Windows
if ($env:OS -ne "Windows_NT") {
    Write-Err "This installer is for Windows only."
}

# Detect architecture
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$platform = "win32-$arch"

Write-Host ""
Write-Info "Detected platform: $platform"

# Create download directory
New-Item -ItemType Directory -Force -Path $DOWNLOAD_DIR | Out-Null

# Get latest version
Write-Info "Fetching latest version..."
try {
    $latestJson = Invoke-RestMethod -Uri "$VERSIONS_URL/latest" -UseBasicParsing
    $version = $latestJson.version
} catch {
    Write-Err "Failed to fetch latest version: $_"
}

if (-not $version) {
    Write-Err "Failed to get latest version"
}

Write-Info "Latest version: $version"

# Download manifest and extract checksum
Write-Info "Fetching manifest..."
try {
    $manifest = Invoke-RestMethod -Uri "$VERSIONS_URL/$version/manifest.json" -UseBasicParsing
    $binaryInfo = $manifest.binaries.$platform
    if (-not $binaryInfo) {
        Write-Err "Platform $platform not found in manifest"
    }
    $checksum = $binaryInfo.sha256
    $filename = $binaryInfo.filename
    $installerUrl = $binaryInfo.url
} catch {
    Write-Err "Failed to fetch manifest: $_"
}

# Validate checksum format
if (-not $checksum -or $checksum.Length -ne 64) {
    Write-Err "Invalid checksum in manifest"
}

# Use default filename if not in manifest
if (-not $filename) {
    $filename = "Craft-Agent-$arch.exe"
}

# Use default URL if not in manifest
if (-not $installerUrl) {
    $installerUrl = "$VERSIONS_URL/$version/$filename"
}

Write-Info "Expected checksum: $($checksum.Substring(0, 16))..."

# Download installer with progress bar
$installerPath = Join-Path $DOWNLOAD_DIR $filename
$fileSize = $binaryInfo.size

# Clean up any partial download from previous attempts
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

Write-Info "Downloading $filename ($([math]::Round($fileSize / 1MB, 1)) MB)..."
Write-Host ""

$webClient = $null
try {
    $webClient = New-Object System.Net.WebClient
    $downloadComplete = $false
    $downloadError = $null

    # Progress event handler
    $webClient.add_DownloadProgressChanged({
        param($sender, $e)
        $percent = $e.ProgressPercentage
        $downloaded = [math]::Round($e.BytesReceived / 1MB, 1)
        $total = [math]::Round($e.TotalBytesToReceive / 1MB, 1)
        Write-Progress -Activity "Downloading Craft Agent" -Status "$downloaded MB / $total MB" -PercentComplete $percent
    })

    $webClient.add_DownloadFileCompleted({
        param($sender, $e)
        $script:downloadComplete = $true
        if ($e.Error) { $script:downloadError = $e.Error }
    })

    # Start async download
    $webClient.DownloadFileAsync([Uri]$installerUrl, $installerPath)

    # Wait for completion
    while (-not $downloadComplete) {
        Start-Sleep -Milliseconds 100
    }

    Write-Progress -Activity "Downloading Craft Agent" -Completed

    if ($downloadError) {
        throw $downloadError
    }
} catch {
    # Clean up partial download on failure
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Download failed: $_"
} finally {
    # Dispose WebClient
    if ($webClient) {
        $webClient.Dispose()
    }
}
Write-Host ""

# Verify checksum
Write-Info "Verifying checksum..."
$actualHash = (Get-FileHash -Path $installerPath -Algorithm SHA256).Hash.ToLower()

if ($actualHash -ne $checksum) {
    Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    Write-Err "Checksum verification failed`n  Expected: $checksum`n  Actual:   $actualHash"
}

Write-Success "Checksum verified!"

# Close the app if it's running
$process = Get-Process -Name "Craft Agent" -ErrorAction SilentlyContinue
if ($process) {
    Write-Info "Closing Craft Agent..."
    $process | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Run the installer
Write-Info "Running installer..."
Write-Host ""
try {
    Start-Process -FilePath $installerPath -Wait
} catch {
    Write-Err "Installation failed: $_"
}

# Clean up
Write-Info "Cleaning up..."
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "---------------------------------------------------------------------"
Write-Host ""
Write-Success "Installation complete!"
Write-Host ""
Write-Host "  Craft Agent has been installed."
Write-Host ""
Write-Host "  You can launch it from the Start Menu or desktop shortcut."
Write-Host ""
