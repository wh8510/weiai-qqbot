# OneBot Companion - Windows setup
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "  OneBot Companion - Windows setup" -ForegroundColor Cyan
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "未找到 Node.js。请先安装 Node.js 22 或更新版本。" }
$version = (& node -v).TrimStart('v')
$major = [int]($version.Split('.')[0])
if ($major -lt 22) { throw "Node.js 版本过低: $version，需要 22+。" }
Write-Host "Node.js: $version"

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Host "未找到 pnpm，尝试用 corepack 启用..." -ForegroundColor Yellow
  & corepack enable
  & corepack prepare pnpm@9.11.0 --activate
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "已创建 .env，请编辑 ONEBOT_TOKEN / API Key 等配置。" -ForegroundColor Yellow
}
if (-not (Test-Path "config.yaml")) {
  Copy-Item "config.example.yaml" "config.yaml"
  Write-Host "已创建 config.yaml（可选，运行时设置主要在 Web 管理端）。" -ForegroundColor Yellow
}

Write-Host "安装依赖..." -ForegroundColor Cyan
& pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败" }

Write-Host "构建..." -ForegroundColor Cyan
& pnpm build
if ($LASTEXITCODE -ne 0) { throw "构建失败" }

Write-Host ""
Write-Host "完成。双击 scripts\start.bat 启动，然后打开 http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "首次启动密码在 data\initial-credentials.txt" -ForegroundColor Green
Write-Host ""
