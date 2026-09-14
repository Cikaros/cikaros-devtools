# install-prompts.ps1 - ai-sdlc 操作手册注册器（Windows PowerShell，v0.13.1）
#
# 背景（v0.13.0）：官方 Codex CLI 不支持插件自定义 slash 命令，唯一的自定义
# 入口是 /prompts:<prompt_name>（读取用户 prompts 目录下的 markdown 文件）。
# 本脚本把插件 prompts/ 下全部操作手册以 `sdlc-<name>.md` 前缀拷贝过去
# （防与用户既有 prompts 撞名），注册后即可在会话内用 /prompts:sdlc-quick
# 等形式调用。
#
# v0.13.1 跨平台说明：注册逻辑的单一事实源是插件 lib/prompts.mjs（common.mjs 桶导出）的 Node fs
# 实现（register_prompt_manuals），会话内说「注册操作手册」即可经 MCP
# register_prompts 工具完成（macOS/Linux/Windows 一致，推荐）；本脚本与
# scripts/sh/install-prompts.sh 是等价的平台便利品（手动/离线场景）。
#
# v0.13.3 零操作说明：SessionStart 已默认自动注册/刷新（ensurePromptsRegistered）
# ——日常无需手动跑本脚本，仅在手动/离线/CI 场景使用。同步 opt-out 语义：
#   -Remove   写入 .sdlc-prompts-optout 标记（此后 SessionStart 不再自动恢复）
#   安装     清除该标记（恢复自动注册）；SDLC_PROMPTS_AUTO=off 可总关
#
# 幂等：重复执行会刷新为插件当前版本内容。
# 卸载：-Remove 移除全部 sdlc-* 前缀文件（只删本插件注册的，不再自动恢复）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File install-prompts.ps1              # 安装/刷新（默认 %USERPROFILE%\.codex\prompts）
#   powershell -ExecutionPolicy Bypass -File install-prompts.ps1 -Remove     # 卸载
#   powershell -ExecutionPolicy Bypass -File install-prompts.ps1 -List       # 查看已注册
#   powershell -ExecutionPolicy Bypass -File install-prompts.ps1 -Dir <path> # 自定义 prompts 目录
#
# 注：本文件为 UTF-8 BOM + CRLF（PS 5.1 对无 BOM 的 .ps1 默认按 ANSI 代码页
#     解析，中文 Windows 上为 GBK，会把 UTF-8 多字节序列误读为乱码）。
param(
  [switch]$Remove,
  [switch]$List,
  [string]$Dir = ''
)

$ErrorActionPreference = 'Stop'
$SCRIPT_DIR = $PSScriptRoot
$PLUGIN_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent
$SRC_DIR = Join-Path $PLUGIN_ROOT 'prompts'
if ($Dir -ne '') { $TARGET_DIR = $Dir } else { $TARGET_DIR = Join-Path (Join-Path $env:USERPROFILE '.codex') 'prompts' }

function Log($m)  { Write-Host "[ai-sdlc] $m" }
function Ok($m)   { Write-Host "[ai-sdlc ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[ai-sdlc warn] $m" -ForegroundColor Yellow }
function Err($m)  { Write-Host "[ai-sdlc err] $m" -ForegroundColor Red }

# 手册名单：动态扫描源目录（与 lib/prompts.mjs listPromptManuals / install-prompts.sh 同语义，
# 升版新增手册自动生效）
if (-not (Test-Path $SRC_DIR)) {
  Err "未找到手册源目录：$SRC_DIR"
  Err '请确认在 ai-sdlc 插件目录结构内运行（plugins/ai-sdlc/scripts/ps/）'
  exit 1
}
$Manuals = @(Get-ChildItem -Path $SRC_DIR -Filter '*.md' -File | ForEach-Object { $_.BaseName } | Sort-Object)

if ($Manuals.Count -eq 0) {
  Err "手册源目录为空：$SRC_DIR"
  exit 1
}

function Get-InstalledCount {
  $n = 0
  foreach ($m in $Manuals) {
    if (Test-Path (Join-Path $TARGET_DIR "sdlc-$m.md")) { $n++ }
  }
  return $n
}

if ($List) {
  $n = Get-InstalledCount
  Log "已注册 $n / $($Manuals.Count) 份（$TARGET_DIR）："
  foreach ($m in $Manuals) {
    if (Test-Path (Join-Path $TARGET_DIR "sdlc-$m.md")) {
      Write-Host "  /prompts:sdlc-$m"
    }
  }
  exit 0
}

if ($Remove) {
  $n = 0
  foreach ($m in $Manuals) {
    $p = Join-Path $TARGET_DIR "sdlc-$m.md"
    if (Test-Path $p) { Remove-Item $p -Force; $n++ }
  }
  # v0.13.3：卸载 = opt-out（阻止 SessionStart 自动恢复；重新安装即清除标记）
  try {
    Set-Content -Path (Join-Path $TARGET_DIR '.sdlc-prompts-optout') -Value 'ai-sdlc：用户已显式卸载操作手册。此标记阻止 SessionStart 自动注册；重新注册会自动删除本文件。' -Encoding UTF8
  } catch { Warn '无法写入卸载标记（不影响本次移除）' }
  Ok "已移除 $n 份手册（$TARGET_DIR 下的 sdlc-*.md），并写入卸载标记（不再自动恢复）"
  exit 0
}

# 默认：安装/刷新（幂等）
try {
  if (-not (Test-Path $TARGET_DIR)) {
    New-Item -ItemType Directory -Path $TARGET_DIR -Force | Out-Null
  }
  # v0.13.3：安装 = 清除卸载标记（恢复 SessionStart 自动注册；与 lib/prompts.mjs 同语义）
  $optout = Join-Path $TARGET_DIR '.sdlc-prompts-optout'
  if (Test-Path $optout) { Remove-Item $optout -Force }
} catch {
  Err "无法创建目录 $TARGET_DIR：$_"
  exit 1
}
$n = 0
foreach ($m in $Manuals) {
  Copy-Item (Join-Path $SRC_DIR "$m.md") (Join-Path $TARGET_DIR "sdlc-$m.md") -Force
  $n++
}
Ok "已注册 $n 份操作手册到 $TARGET_DIR（sdlc-<名>.md）"
Log '会话内调用示例：/prompts:sdlc-quick  /prompts:sdlc-status  /prompts:sdlc-intent'
Log '日常无需手动执行（SessionStart 自动注册/刷新）；卸载：powershell -ExecutionPolicy Bypass -File install-prompts.ps1 -Remove'
Log '跨平台替代：codex 会话内说「刷新操作手册」，agent 会调 MCP register_prompts 工具（效果相同）'
