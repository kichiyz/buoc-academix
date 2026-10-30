$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI not found." }
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) { throw "Supabase CLI not found." }
if (-not (Test-Path "supabase/config.toml")) { throw "supabase/config.toml is missing." }
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }
Write-Host "Starting isolated local Supabase..." -ForegroundColor Cyan
supabase start
if ($LASTEXITCODE -ne 0) { throw "Supabase failed to start. Production was not modified." }
$envOutput = supabase status -o env
if ($LASTEXITCODE -ne 0) { throw "Could not read local Supabase status." }
$values = @{}
foreach ($line in $envOutput) { if ($line -match '^([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"') } }
$apiUrl = $values["API_URL"]
$key = $values["PUBLISHABLE_KEY"]
if (-not $key) { $key = $values["ANON_KEY"] }
if (-not $apiUrl -or -not $key) { throw "Local API URL or publishable key missing from supabase status." }
if ($apiUrl -notmatch '^http://(localhost|127\.0\.0\.1):54321$') { throw "Safety stop: unexpected local API URL: $apiUrl" }
$config = @{ environment = "TEST"; supabaseUrl = $apiUrl; supabasePublishableKey = $key } | ConvertTo-Json -Compress
Set-Content -Path "academix-config.local.js" -Value "window.ACADEMIX_CONFIG = Object.freeze($config);" -Encoding UTF8
Write-Host "Serving frontend at http://127.0.0.1:4173" -ForegroundColor Green
Start-Process -FilePath "python" -ArgumentList "-m","http.server","4173","--bind","127.0.0.1" -WorkingDirectory $RepoRoot
Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:4173"
Write-Host "Local TEST configuration created. No hosted production project was changed." -ForegroundColor Green
