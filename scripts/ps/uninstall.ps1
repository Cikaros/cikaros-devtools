﻿# uninstall.ps1 — cikaros-devtools marketplace 卸载器 v1.13.13
#
# 设计变更（v1.3.0）：
#   本脚本**只做一件事**——从 codex marketplace 列表移除 cikaros-devtools。
#   不再卸载任何具体 plugin（specflow / ai-sdlc 等），由用户在 codex 会话内
#   通过 `/plugins` 浏览器自行决定停用哪些 plugin。
#
# 用法：powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Yes] [-Status]
#   默认：移除 marketplace（幂等）
#   -Yes     跳过确认提示
#   -Status  仅查询当前注册状态，不修改
#
# 卸载前请先在 codex 会话内通过 /plugins 停用所有已启用的 plugin。
#
# 注：本文件首部加 UTF-8 BOM（PS 5.1 对无 BOM 的 .ps1 默认按 ANSI 代码页解析）。
param(
  [switch]$Yes,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$SCRIPT_DIR = $PSScriptRoot
$MARKETPLACE_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent
$MARKETPLACE_NAME = 'cikaros-devtools'

function Log($m)  { Write-Host "[$MARKETPLACE_NAME] $m" }
function Ok($m)   { Write-Host "[$MARKETPLACE_NAME ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[$MARKETPLACE_NAME warn] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[$MARKETPLACE_NAME err] $m" -ForegroundColor Red }

# ─────────────────────────────────────────────
# 前置检查
# ─────────────────────────────────────────────

if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
  Err '未找到 codex CLI'
  Err '如已卸载 codex，marketplace 注册会随配置文件一起消失，无需本脚本'
  exit 1
}

Log 'marketplace 卸载器 v1.13.13'
Write-Host ''

# ─────────────────────────────────────────────
# marketplace 注册状态查询
# ─────────────────────────────────────────────

function Test-MarketplaceRegistered {
  try {
    $list = (codex plugin marketplace list 2>$null) -join "`n"
    return $list -match $MARKETPLACE_NAME
  } catch { return $false }
}

if ($Status) {
  Log '查询 marketplace 注册状态：'
  if (Test-MarketplaceRegistered) {
    Warn "已注册：$MARKETPLACE_NAME"
  } else {
    Ok "未注册：$MARKETPLACE_NAME"
  }
  exit 0
}

# ─────────────────────────────────────────────
# 提示用户先停用 plugin
# ─────────────────────────────────────────────

if (Test-MarketplaceRegistered) {
  Log '卸载前请确认：'
  Log '  1. 已在 codex 会话内通过 /plugins 停用所有已启用的 plugin'
  Log '  2. 项目级的 .specflow/ / .sdlc/ 目录可选择保留（含工件历史）或手工删除'
  Write-Host ''
  if (-not $Yes) {
    $yn = Read-Host "确认移除 marketplace $MARKETPLACE_NAME？[y/N]"
    if ($yn -ne 'y' -and $yn -ne 'Y') { Warn '已取消'; exit 0 }
  }

  # 移除 marketplace
  try {
    codex plugin marketplace remove $MARKETPLACE_NAME
    if ($LASTEXITCODE -eq 0) {
      Ok "marketplace 已移除：$MARKETPLACE_NAME"
    } else {
      Warn "marketplace 移除失败（exit code $LASTEXITCODE）——可能已通过 /plugins 卸载"
      Warn "请手动执行：codex plugin marketplace remove $MARKETPLACE_NAME"
    }
  } catch {
    Warn "marketplace 移除失败：$_"
    Warn "请手动执行：codex plugin marketplace remove $MARKETPLACE_NAME"
  }
} else {
  Ok "marketplace 未注册：$MARKETPLACE_NAME（幂等，跳过）"
}

# ─────────────────────────────────────────────
# 输出残留清理指引
# ─────────────────────────────────────────────

Write-Host ''
Log '═══════════════════════════════════════════'
Log ' marketplace 卸载完成'
Log '═══════════════════════════════════════════'
Write-Host ''
Log '残留清理（可选）：'
Log '  - 项目级运行时目录（含工件历史与审计日志）：'
Log '      Remove-Item -Recurse -Force ~/your-project/.specflow/   # specflow'
Log '      Remove-Item -Recurse -Force ~/your-project/.sdlc/       # ai-sdlc'
Log '  - 用户级全局配置（如有）：'
Log '      Remove-Item -Recurse -Force ~/.specflow/                # specflow 全局配置'
Write-Host ''
Log '查询注册状态：'
Log '  powershell -ExecutionPolicy Bypass -File scripts\ps\uninstall.ps1 -Status'
