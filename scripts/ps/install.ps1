﻿# install.ps1 — cikaros-devtools marketplace 安装器 v1.13.13
#
# 设计变更（v1.3.0）：
#   本脚本**只做一件事**——把 cikaros-devtools 仓库注册为 codex marketplace。
#   不再安装任何具体 plugin（specflow / ai-sdlc 等），由用户在 codex 会话内
#   通过 `/plugins` 浏览器自行决定启用哪些 plugin。
#
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1 [-Yes] [-Status]
#   默认：注册 marketplace（幂等）
#   -Yes     跳过所有确认提示
#   -Status  仅查询当前注册状态，不修改
#
# 装完必做：进入 codex 会话执行 `/plugins`，浏览并启用需要的 plugin，
# 然后执行 `/hooks` 审查并信任对应 plugin 的 hooks。
#
# 注：本文件首部加 UTF-8 BOM（PS 5.1 对无 BOM 的 .ps1 默认按 ANSI 代码页解析，
#     中文 Windows 上为 GBK，会把 UTF-8 多字节序列误读为乱码导致解析失败）。
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
  Err '请先安装 Codex CLI >= 0.142（提供 plugin marketplace 系统）'
  exit 1
}

$mpFile = Join-Path $MARKETPLACE_ROOT '.agents/plugins/marketplace.json'
if (-not (Test-Path $mpFile)) {
  Err "未找到 marketplace 清单：$mpFile"
  Err '请确认在 cikaros-devtools 仓库根目录运行本脚本'
  exit 1
}

Log 'marketplace 安装器 v1.13.13'
Log "MARKETPLACE_ROOT=$MARKETPLACE_ROOT"
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

function Show-AvailablePlugins {
  try {
    $mp = Get-Content $mpFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "  marketplace: $($mp.name)"
    Write-Host "  plugins ($($mp.plugins.Count)):"
    foreach ($p in $mp.plugins) {
      $desc = if ($p.description) { $p.description } else { '' }
      if ($desc.Length -gt 80) { $desc = $desc.Substring(0, 80) }
      Write-Host "    - $($p.name): $desc"
    }
  } catch {
    Err "读取 marketplace.json 失败：$_"
  }
}

if ($Status) {
  Log '查询 marketplace 注册状态：'
  if (Test-MarketplaceRegistered) {
    Ok "已注册：$MARKETPLACE_NAME"
  } else {
    Warn "未注册：$MARKETPLACE_NAME"
  }
  Write-Host ''
  Log '可用的 plugin：'
  Show-AvailablePlugins
  exit 0
}

# ─────────────────────────────────────────────
# 注册 marketplace（幂等）
# ─────────────────────────────────────────────

if (Test-MarketplaceRegistered) {
  Ok "marketplace 已注册：$MARKETPLACE_NAME（幂等，跳过）"
} else {
  if (-not $Yes) {
    Log '即将注册 marketplace：'
    Log "  名称：$MARKETPLACE_NAME"
    Log "  路径：$MARKETPLACE_ROOT"
    Write-Host ''
    $yn = Read-Host '确认注册？[Y/n]'
    if ($yn -eq 'n' -or $yn -eq 'N') { Warn '已取消'; exit 0 }
  }
  try {
    codex plugin marketplace add $MARKETPLACE_ROOT
    if ($LASTEXITCODE -eq 0) {
      Ok "marketplace 注册成功：$MARKETPLACE_NAME"
    } else {
      Err "marketplace 注册失败（exit code $LASTEXITCODE）"
      Err "请手动执行：codex plugin marketplace add $MARKETPLACE_ROOT"
      exit 1
    }
  } catch {
    Err "marketplace 注册失败：$_"
    Err "请手动执行：codex plugin marketplace add $MARKETPLACE_ROOT"
    exit 1
  }
}

# ─────────────────────────────────────────────
# 输出可用 plugin 清单 + 启用指引
# ─────────────────────────────────────────────

Write-Host ''
Log '═══════════════════════════════════════════'
Log ' marketplace 注册完成'
Log '═══════════════════════════════════════════'
Write-Host ''
Log '可用的 plugin：'
Show-AvailablePlugins
Write-Host ''
Log '下一步：启用 plugin（由用户决定）'
Log '  1. 进入 codex 会话'
Log '  2. 执行 /plugins 浏览 cikaros-devtools marketplace'
Log '  3. 选择并启用需要的 plugin（如 specflow / ai-sdlc）'
Log '  4. 执行 /hooks 审查并信任启用 plugin 的 hooks'
Write-Host ''
Log '卸载 marketplace：'
Log '  powershell -ExecutionPolicy Bypass -File scripts\ps\uninstall.ps1'
Write-Host ''
Log '查询注册状态：'
Log '  powershell -ExecutionPolicy Bypass -File scripts\ps\install.ps1 -Status'
