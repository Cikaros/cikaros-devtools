﻿# install-git-hooks.ps1 — specflow git hooks 安装器（Windows PowerShell v1.2.1）
# 对应 scripts/sh/install-git-hooks.sh（macOS/Linux 用 bash 版本）。
#
# v0.7.3：文件首部加 UTF-8 BOM（PS 5.1 对无 BOM 的 .ps1 默认按 ANSI 代码页解析，
#         中文 Windows 上为 GBK，会把 UTF-8 多字节序列误读为乱码导致解析失败）。
#         注意：本文件「写入」的 hook 文件（pre-commit / post-checkout / post-merge）
#         仍用 BOM-less UTF-8（hook 由 git bash 执行，UTF-8 无 BOM 即可）。
# v0.7.7：修复 Windows 原生 git（VSCode/TortoiseGit 等不通过 Git Bash 调用 hook）
#         报 `cannot spawn .git/hooks/pre-commit: No such file or directory` 的问题。
#         根因：v0.7.2 生成的 hook 没有 shebang 行，git 找不到解释器。
#         修复：① hook 首行加 `#!/usr/bin/env bash` shebang（Git for Windows 自带 bash 能识别）
#         ② hook body 改为 bash 脚本，内部调 `powershell -File sf.ps1`（而非依赖 PS 直接执行）
#         ③ sf.ps1 路径烧录绝对路径（init-git-hooks.ps1 生成时已知 PLUGIN_ROOT），
#         不靠运行时 $PSScriptRoot 上溯（hook 在 .git/hooks/ 下，上溯 5 级根本到不了 sf.ps1）
#
# 由 init-project.py 在 Windows 平台调用：
#   powershell -ExecutionPolicy Bypass -File install-git-hooks.ps1 [-ProjectRoot <path>]
#
# 生成的钩子（pre-commit / post-checkout / post-merge）会调用 sf.ps1。
# 与 bash 版本一致的安全设计：
#   1. sf.ps1 不存在 → 自动退化为放行，绝不阻塞 git 操作（A7 原则）
#   2. 失败 hook 返回 0（不阻塞）；只有显式门禁失败才返回 1
#   3. 退出码兜底：>= 2 视为内部故障，放行不阻塞
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File install-git-hooks.ps1 [-ProjectRoot <path>]
param(
  [string]$ProjectRoot = $env:CODEX_PROJECT_ROOT
)

$ErrorActionPreference = 'Stop'
$SCRIPT_DIR = $PSScriptRoot
$PLUGIN_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent

# 项目根：-ProjectRoot 参数 > CODEX_PROJECT_ROOT 环境变量 > 当前目录
if (-not $ProjectRoot) {
  $ProjectRoot = (Get-Location).Path
}

$GIT_DIR = Join-Path $ProjectRoot '.git'
if (-not (Test-Path $GIT_DIR -PathType Container)) {
  Write-Host "[specflow] 未找到 .git 目录: $GIT_DIR" -ForegroundColor Yellow
  Write-Host "[specflow] 请在 git 仓库根目录下运行此脚本" -ForegroundColor Yellow
  exit 1
}

$HOOKS_DIR = Join-Path $GIT_DIR 'hooks'
if (-not (Test-Path $HOOKS_DIR)) {
  New-Item -ItemType Directory -Force -Path $HOOKS_DIR | Out-Null
}

# v0.7.7：探测可用的 PowerShell 解释器（优先 pwsh 7+，回退 Windows 自带 powershell 5.1）
# 烧录到 hook 里，避免 hook 运行时再探测（hook 运行环境可能 PATH 受限）
$psExe = $null
foreach ($c in @('pwsh', 'powershell', 'pwsh.exe', 'powershell.exe')) {
  $found = Get-Command $c -ErrorAction SilentlyContinue
  if ($found) {
    $psExe = $found.Source
    break
  }
}
if (-not $psExe) {
  Write-Host "[specflow] 未找到 pwsh / powershell，无法生成 git hooks" -ForegroundColor Red
  Write-Host "[hint] 请安装 PowerShell（Windows 自带 powershell.exe，或 winget install Microsoft.PowerShell 装 pwsh 7）" -ForegroundColor Yellow
  exit 1
}

# sf.ps1 候选路径（绝对路径，烧录到 hook 里）：
# ① classic 安装：~/.codex/scripts/ps/sf.ps1
# ② 插件源目录：$PLUGIN_ROOT/scripts/ps/sf.ps1
$sfCandidates = @(
  (Join-Path $env:USERPROFILE '.codex\scripts\ps\sf.ps1'),
  (Join-Path $PLUGIN_ROOT 'scripts\ps\sf.ps1')
)
$sfPath = $null
foreach ($c in $sfCandidates) {
  if (Test-Path $c) { $sfPath = $c; break }
}
if (-not $sfPath) {
  Write-Host "[specflow] 未找到 sf.ps1（candidates: $($sfCandidates -join ' ; '))" -ForegroundColor Yellow
  Write-Host "[hint] git hooks 仍会安装，但运行时会因找不到 sf.ps1 自动放行（不阻塞 git）" -ForegroundColor Yellow
  # 不退出——仍生成 hook（hook body 有 sf.ps1 缺失守卫，会自动放行）
}

# v0.7.7：BOM-less UTF-8 写盘 + LF 行尾（git hook 跨平台要求 LF）
# 注意：此处不能用 [System.IO.File]::WriteAllText 默认行为——它在 Windows 上会把 `\n` 当作
# 单字符写入，但 git 期望 LF（`\n`）。我们用 WriteAllText + 字符串里的 `n 已经是 LF，
# 但 .NET 的 WriteAllText 不会转换行尾，所以 body 里的 `n 必须显式为 LF（`n 在 PS heredoc 里是 LF）。
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-Hook([string]$hookName, [string]$sfAction) {
  $hookPath = Join-Path $HOOKS_DIR $hookName

  # v0.7.7：hook body 是 bash 脚本（首行 shebang #!/usr/bin/env bash）
  # Git for Windows 自带 bash 能识别此 shebang；Windows 原生 git（VSCode 集成等）
  # 调用 hook 时会通过 sh.exe（Git 安装时自带）执行，sh 也能识别 env bash shebang
  #
  # body 内部调用 powershell -File sf.ps1（绝对路径烧录），不依赖 $PSScriptRoot
  $sfPathEscaped = if ($sfPath) { $sfPath.Replace('\', '/') } else { '' }
  $psExeEscaped = $psExe.Replace('\', '/')

  # 备选 sf.ps1 路径（也烧录进去，主路径找不到时尝试）
  $sfBackup = if ($sfPath) {
    # 如果主路径是 ~/.codex/scripts/ps/sf.ps1，备选就是 PLUGIN_ROOT/scripts/ps/sf.ps1，反之亦然
    if ($sfPath -eq $sfCandidates[0]) {
      $sfCandidates[1].Replace('\', '/')
    } else {
      $sfCandidates[0].Replace('\', '/')
    }
  } else { '' }

  $body = @"
#!/usr/bin/env bash
# specflow git hook ($hookName) — 由 specflow 安装；插件卸载后自动退化为放行（不阻塞提交）
# v0.7.7：bash shebang + 内部调 powershell -File sf.ps1（兼容 Windows 原生 git 与 Git Bash）

# sf.ps1 主路径与备选路径（init-git-hooks.ps1 生成时烧录的绝对路径）
SF_PRIMARY="$sfPathEscaped"
SF_BACKUP="$sfBackup"
SF=""
if [[ -f "\$SF_PRIMARY" ]]; then SF="\$SF_PRIMARY"
elif [[ -f "\$SF_BACKUP" ]]; then SF="\$SF_BACKUP"
fi
if [[ -z "\$SF" ]]; then
  echo "[specflow] 未找到 sf.ps1（插件可能已卸载/迁移），跳过 $hookName 检查"
  exit 0
fi

# v0.7.7：powershell 解释器绝对路径（init-git-hooks.ps1 生成时探测）
PS_EXE="$psExeEscaped"
if [[ ! -x "\$PS_EXE" ]]; then
  # 回退：PATH 内找 powershell/pwsh
  for c in pwsh powershell; do
    if command -v "\$c" >/dev/null 2>&1; then PS_EXE="\$c"; break; fi
  done
fi
if [[ -z "\$PS_EXE" ]]; then
  echo "[specflow] 未找到 powershell/pwsh，跳过 $hookName 检查（非阻塞）"
  exit 0
fi

# v0.7.2：受限 PATH 兜底（GUI/IDE 发起的 git 提交可能 PATH 只有 System32）
for _d in "/c/Program Files/nodejs" "/c/Python311" "/c/Python310" "/c/Python39" \
          "\$HOME/AppData/Local/Programs/Python" "\$HOME/AppData/Roaming/npm"; do
  case ":\$PATH:" in *":\$_d:"*) ;; *) PATH="\$PATH:\$_d" ;; esac
done
export PATH

# 调用 sf.ps1，捕获退出码
exit_code=0
"\$PS_EXE" -ExecutionPolicy Bypass -File "\$SF" $sfAction "\$@" || exit_code=\$?
# v0.7.0：退出码兜底 —— 内部故障（>= 2）一律放行不阻塞 git
if [[ \$exit_code -ge 2 ]]; then
  echo "[specflow] $hookName hook 内部故障（退出码 \$exit_code），放行不阻塞 git"
  exit 0
fi
exit \$exit_code
"@

  # 写盘：BOM-less UTF-8 + LF 行尾
  # PowerShell here-string 里 `n 是 LF；WriteAllText 不会转换，所以保持 LF
  [System.IO.File]::WriteAllText($hookPath, $body, $Utf8NoBom)
  Write-Host "[ok] $hookName -> sf.ps1 $sfAction（bash shebang + powershell 调用 + 路径烧录）" -ForegroundColor Green
}

Write-Hook 'pre-commit'    'git-pre-commit'
Write-Hook 'post-checkout' 'git-post-checkout'
Write-Hook 'post-merge'    'git-post-merge'

Write-Host ''
Write-Host "[ok] git hooks 安装完成（powershell 解释器: $psExe）" -ForegroundColor Green
Write-Host "[ok] sf.ps1 路径: $sfPath" -ForegroundColor Green
