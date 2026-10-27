param(
  [string]$Domain = "teknikfix.dk",
  [string]$TunnelName = "teknikfix",
  [int]$Port = 4321
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  Write-Host "Installing cloudflared..."
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if (-not $cloudflared) { throw "cloudflared is not installed. Open a new window and run this again." }
}

Write-Host ""
Write-Host "Step 1 of 4: Cloudflare login"
if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
  Write-Host "A browser opens. Log in to Cloudflare and click $Domain."
  & $cloudflared tunnel login
  if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) { throw "Login did not finish. Run this again." }
} else {
  Write-Host "Already logged in."
}

Write-Host ""
Write-Host "Step 2 of 4: Tunnel"
$existing = & $cloudflared tunnel list --output json | ConvertFrom-Json
$tunnel = $existing | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
if (-not $tunnel) {
  & $cloudflared tunnel create $TunnelName | Out-Host
  $existing = & $cloudflared tunnel list --output json | ConvertFrom-Json
  $tunnel = $existing | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
if (-not $tunnel) { throw "Could not create the tunnel." }
$id = $tunnel.id
Write-Host "Tunnel $TunnelName ($id)"

Write-Host ""
Write-Host "Step 3 of 4: Point $Domain and www.$Domain at this PC"
& $cloudflared tunnel route dns --overwrite-dns $TunnelName $Domain | Out-Host
& $cloudflared tunnel route dns --overwrite-dns $TunnelName "www.$Domain" | Out-Host

$credentials = Join-Path $cfDir "$id.json"
$configPath = Join-Path $cfDir "config.yml"
$config = @"
tunnel: $id
credentials-file: $credentials
ingress:
  - hostname: $Domain
    service: http://localhost:$Port
  - hostname: www.$Domain
    service: http://localhost:$Port
  - service: http_status:404
"@
Set-Content -Path $configPath -Value $config -Encoding ASCII

$envPath = Join-Path $here ".env"
$envText = Get-Content $envPath -Raw
$envText = $envText -replace "(?m)^SITE_URL=.*$", "SITE_URL=https://$Domain"
Set-Content -Path $envPath -Value $envText.TrimEnd() -Encoding ASCII

Write-Host ""
Write-Host "Step 4 of 4: Start with Windows"
$runner = Join-Path $here "run-online.bat"
$startup = [Environment]::GetFolderPath("Startup")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $startup "TeknikFix online.lnk"))
$link.TargetPath = $runner
$link.WorkingDirectory = $here
$link.WindowStyle = 7
$link.Save()
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
Write-Host "The site starts when you log in to Windows. Sleep is off while the PC is plugged in."

Write-Host ""
Write-Host "Starting now..."
Start-Process -FilePath $runner -WorkingDirectory $here -WindowStyle Minimized
Start-Sleep -Seconds 12
try {
  $r = Invoke-WebRequest -Uri "https://$Domain/api/health" -UseBasicParsing -TimeoutSec 20
  Write-Host "Online: https://$Domain ($($r.StatusCode))"
} catch {
  Write-Host "Not reachable yet. DNS can take a few minutes. Try https://$Domain soon."
}
