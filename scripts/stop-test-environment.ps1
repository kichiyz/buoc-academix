$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)
Remove-Item "academix-config.local.js" -Force -ErrorAction SilentlyContinue
supabase stop
Write-Host "Local Supabase stopped; generated local config removed. Production unchanged." -ForegroundColor Green
