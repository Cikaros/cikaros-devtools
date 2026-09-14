﻿# init-project.ps1 — specflow 项目初始化器入口（PowerShell）v1.2.1
# v0.7.2：移除 `#Requires -Version 7.0`（Windows 默认 PowerShell 5.1 无法运行）；
#         Python 探测链与 sf.ps1 对齐：python → python3 → py（Windows 启动器）；
#         失败时给出可读错误而非裸异常；接受 -Python 参数显式指定解释器。
# v0.7.3：文件首部加 UTF-8 BOM（PS 5.1 对无 BOM 的 .ps1 默认按 ANSI 代码页解析，
#         中文 Windows 上为 GBK，会把 UTF-8 多字节序列误读为乱码导致解析失败）。
# v1.2.1：反模式扩充+自动捕获（版本号同步）。
param(
  [string]$Python,
  [Parameter(ValueFromRemainingArguments)][string[]]$Args
)

$ErrorActionPreference = 'Stop'
$SCRIPT_DIR = $PSScriptRoot
$PLUGIN_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent
$env:CODEX_PLUGIN_ROOT = $PLUGIN_ROOT
# v0.7.1：不写 __pycache__（与 sf.sh / sf.ps1 对齐）
$env:PYTHONDONTWRITEBYTECODE = '1'

function Resolve-Python {
  param([string]$Override)
  # 优先使用 -Python 参数；其次 SPECFLOW_PY 环境变量；最后探测链
  if ($Override) {
    $exe = ($Override -split ' ')[0]
    if ((Get-Command $exe -ErrorAction SilentlyContinue) -or (Test-Path $exe)) {
      return $Override
    }
    Write-Host "[err] -Python 指定的解释器不可用: $exe" -ForegroundColor Red
    return $null
  }
  if ($env:SPECFLOW_PY) {
    $exe = ($env:SPECFLOW_PY -split ' ')[0]
    if ((Get-Command $exe -ErrorAction SilentlyContinue) -or (Test-Path $exe)) {
      return $env:SPECFLOW_PY
    }
    Write-Host "[err] SPECFLOW_PY 指定的解释器不可用: $exe" -ForegroundColor Red
    return $null
  }
  # v0.7.2：Windows 上 'python' 比 'python3' 更常见（python.org 官方安装器），
  # 'py' 是 Windows 启动器（py -3 跑 Python 3）；按平台优先级排序
  foreach ($c in 'python','python3','py') {
    $g = Get-Command $c -ErrorAction SilentlyContinue
    if ($g) { return $c }
  }
  return $null
}

$PY = Resolve-Python -Override $Python
if (-not $PY) {
  Write-Host '[err] 未找到 python / python3 / py（项目初始化必需）' -ForegroundColor Red
  Write-Host '[hint] 可通过 -Python 参数或 SPECFLOW_PY 环境变量显式指定解释器' -ForegroundColor Yellow
  exit 1
}

$script = Join-Path $PLUGIN_ROOT 'scripts/lib/init-project.py'
if (-not (Test-Path $script)) {
  Write-Host "[err] init-project.py 不存在: $script" -ForegroundColor Red
  exit 1
}

# v0.7.2：PY 与额外参数以数组形式传给 & 调用，避免含空格路径被 shell 切碎
try {
  & $PY $script @Args
  exit $LASTEXITCODE
} catch {
  Write-Host "[err] init-project.py 执行失败: $_" -ForegroundColor Red
  exit 1
}
