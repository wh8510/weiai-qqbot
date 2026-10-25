# OneBot Companion - start (Windows)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path 'dist\server\index.js')) {
  throw '还没有构建。请先运行 scripts\setup.ps1'
}
Write-Host 'OneBot Companion 启动中...' -ForegroundColor Cyan
Write-Host '管理端: http://127.0.0.1:8080' -ForegroundColor Green
node dist\server\index.js
