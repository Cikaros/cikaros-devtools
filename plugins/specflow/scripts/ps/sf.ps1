﻿# sf.ps1 — specflow 主入口 v1.2.2（与 sf.sh 对齐）
# v0.7.0 新增：events（事件总线查看）/ doc-version（文档版本 bump）/
#              git-pre-commit|git-post-checkout|git-post-merge（git hooks 真跑）
# v0.7.2：移除 `#Requires -Version 7.0`（Windows 默认 PowerShell 5.1 无法运行），
#         全部语法改写为 PS 5.1 兼容（无三元运算符 / 无 ?? / 无 -Parallel）。
# v0.7.3：文件首部加 UTF-8 BOM（PS 5.1 对无 BOM 的 .ps1 默认按 ANSI 代码页解析，
#         中文 Windows 上为 GBK，会把 UTF-8 多字节序列误读为乱码导致解析失败）。
# v0.7.4：Get-Content -Raw 加 -Encoding UTF8（同 PS 5.1 编码 fallback 问题影响
#         读盘——rules/sensitive-rules.json 无 BOM 时被按 GBK 读致 ConvertFrom-Json
#         失败）；doctor 检测 node 缺失后跳过 .mjs 循环避免 7 次重复报错；
#         codex plugin 子命令正则收紧 + 黑名单过滤英文文档段落。
param([string]$Action = 'help', [Parameter(ValueFromRemainingArguments)][string[]]$Args)
$SCRIPT_DIR = $PSScriptRoot; $PLUGIN_ROOT = Split-Path (Split-Path $SCRIPT_DIR -Parent) -Parent
$LIB = Join-Path $PLUGIN_ROOT 'scripts/lib'

# v0.7.1：不写 __pycache__（与 sf.sh 对齐）—— lib 模块互 import 会在插件目录生成垃圾文件
$env:PYTHONDONTWRITEBYTECODE = '1'

function Resolve-Python {
  # v0.7.0：支持 SPECFLOW_PY 显式指定（pyenv/conda 等）；探测链 python → python3 → py -3
  if ($env:SPECFLOW_PY) {
    $exe = ($env:SPECFLOW_PY -split ' ')[0]
    if ((Get-Command $exe -ErrorAction SilentlyContinue) -or (Test-Path $exe)) {
      return $env:SPECFLOW_PY
    }
    Write-Host "[err] SPECFLOW_PY 指定的解释器不可用: $exe" -ForegroundColor Red
    return $null
  }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) { return 'python' }
  $py3 = Get-Command python3 -ErrorAction SilentlyContinue
  if ($py3) { return 'python3' }
  $pyl = Get-Command py -ErrorAction SilentlyContinue
  if ($pyl) { return 'py' }   # Windows 启动器（默认解释器即 Python 3；含空格命令串会破坏 & 调用）
  return $null
}
$PY = Resolve-Python

# python 缺失时给出明确错误（而非 & $null 的隐晦失败）；
# git hook 场景放行（A7 原则：插件环境故障绝不阻塞 git 操作）
$needsPython = $Action -in 'parse','scan','todo','workflow','sanitize','events','doc-version','init','git-pre-commit','git-post-checkout','git-post-merge'
if ($needsPython -and -not $PY) {
  Write-Host '[err] 未找到 python / python3 / py（扫描/解析/初始化必需）' -ForegroundColor Red
  if ($Action -like 'git-*') {
    Write-Host '[specflow] python 缺失，跳过 git hook 检查（放行，不阻塞 git）'
    exit 0
  }
  exit 1
}

switch ($Action) {
  'parse'          { & $PY (Join-Path $LIB 'doc-parser.py') @Args }
  'scan'           { & $PY (Join-Path $LIB 'env-scanner.py') @Args }
  'todo'           { & $PY (Join-Path $LIB 'todo-scanner.py') @Args }
  'workflow'       { & $PY (Join-Path $LIB 'workflow-state.py') @Args }
  'sanitize'       { & $PY (Join-Path $LIB 'sanitize.py') @Args }
  'events'         { & $PY (Join-Path $LIB 'events.py') (Get-Location).Path @Args }
  'doc-version'    { & $PY (Join-Path $LIB 'doc-version.py') @Args }
  'config'         {
    # v1.2.1 P1-9：DIY 配置管理（与 sf.sh 对齐）
    $subCmd = if ($Args -and $Args[0]) { $Args[0] } else { 'show' }
    switch ($subCmd) {
      'show' {
        Write-Host '[config] 合并后的配置'
        $mc = Join-Path (Get-Location) '.specflow/merged-config.json'
        if (Test-Path $mc) {
          $m = Get-Content $mc -Raw -Encoding UTF8 | ConvertFrom-Json
          Write-Host "  stages: $($m.stages.name -join ' -> ')"
          Write-Host "  antiPatterns: $($m.antiPatterns.Count) 条"
          Write-Host "  hookRules: pre=$($m.hookRules.preToolUse.Count) post=$($m.hookRules.postToolUse.Count)"
          if ($m.warnings.Count -gt 0) { $m.warnings | ForEach-Object { Write-Host "  WARN: $_" } }
        } else {
          Write-Host '  (未找到 merged-config.json；正常会话由 Codex SessionStart hook 自动生成；或运行 sf.ps1 session-start 手动预热)'
        }
      }
      'validate' {
        Write-Host '[config] 校验自定义文件格式...'
        $rc = 0
        foreach ($f in @('.specflow/stages.md', '.specflow/anti-patterns.json', '.specflow/hooks/pre-tool-use.json', '.specflow/hooks/post-tool-use.json', '.specflow/error-kb-config.json', '.specflow/mcp-tools.json')) {
          $full = Join-Path (Get-Location) $f
          if (Test-Path $full) {
            if ($f -like '*.json') {
              try { Get-Content $full -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null; Write-Host "  [ok] $f" }
              catch { Write-Host "  [FAIL] $f JSON 语法错误"; $rc = 1 }
            } else {
              Write-Host "  [ok] $f (Markdown)"
            }
          } else {
            Write-Host "  [-] $f (不存在)"
          }
        }
        if ($rc -eq 0) { Write-Host '[config] 校验通过' } else { Write-Host '[config] 存在错误'; exit 1 }
      }
      default { Write-Host '用法: sf.ps1 config [show|validate]' }
    }
  }
  'init'           { & $PY (Join-Path $LIB 'init-project.py') @Args }
  'session-start'  { '{}' | & node (Join-Path $PLUGIN_ROOT 'hooks/scripts/session-start.mjs') }
  'hooks-export'   {
    $dst = if ($Args -and $Args[0]) { $Args[0] } else { Join-Path $env:USERPROFILE '.codex/hooks.json' }
    $root = if ($Args -and $Args[1]) { $Args[1] } else { Join-Path $env:USERPROFILE '.codex' }
    & node (Join-Path $LIB 'hooks-export.mjs') (Join-Path $PLUGIN_ROOT 'hooks/hooks.json') $dst $root
  }
  'git-pre-commit' { & $PY (Join-Path $LIB 'git-hooks.py') (Get-Location).Path 'pre-commit' }
  'git-post-checkout' { & $PY (Join-Path $LIB 'git-hooks.py') (Get-Location).Path 'post-checkout' }
  'git-post-merge' { & $PY (Join-Path $LIB 'git-hooks.py') (Get-Location).Path 'post-merge' }
  'doctor'         {
    Write-Host '[doctor] specflow 自检'
    $fail = $false
    # v0.7.4：先一次性检测 node 是否可用，避免对每个 .mjs 重复报 CommandNotFoundException
    $nodeOk = $false
    try { $null = node --version; if ($LASTEXITCODE -eq 0) { $nodeOk = $true } } catch {}
    if ($nodeOk) {
      Write-Host "[ok]   node $(node --version 2>$null)"
    } else {
      Write-Host '[err]  node 未安装（hooks 与 MCP server 必需，需 >= 18）'
      Write-Host '[hint] 下载：https://nodejs.org/zh-cn/download/（建议 LTS 版本）'
      Write-Host '[hint] 安装后重启 PowerShell 会话使 PATH 生效'
      $fail = $true
    }
    if ($PY) { & $PY --version } else { Write-Host '[warn] python 未安装（扫描/解析降级）' }
    # v0.7.4：node 缺失时跳过 .mjs 语法检查（避免 7 次重复 CommandNotFoundException）
    if ($nodeOk) {
      Get-ChildItem (Join-Path $PLUGIN_ROOT 'hooks/scripts') -Filter '*.mjs' | ForEach-Object {
        & node --check $_.FullName 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Host "[ok]   语法 $($_.Name)" } else { Write-Host "[err]  语法失败: $($_.Name)"; $fail = $true }
      }
    } else {
      Write-Host '[skip] hooks/scripts/*.mjs 语法检查（node 未安装）'
    }
    foreach ($s in 'hook-orchestrator','config-reader','env-scanner','privacy-guard') {
      $p = Join-Path $PLUGIN_ROOT "mcp/$s/index.js"
      if (Test-Path $p) { Write-Host "[ok]   mcp/$s/index.js" } else { Write-Host "[err]  缺失 mcp/$s/index.js"; $fail = $true }
    }
    foreach ($p in 'env-scanner','doc-parser','todo-scanner','sanitize','workflow-state','init-project','events','git-hooks','doc-version') {
      $f = Join-Path $LIB "$p.py"
      if (Test-Path $f) { Write-Host "[ok]   lib/$p.py" } else { Write-Host "[warn] 缺失 lib/$p.py" }
    }
    $rules = Join-Path $PLUGIN_ROOT 'rules/sensitive-rules.json'
    if (Test-Path $rules) {
      # v0.7.4：PS 5.1 Get-Content -Raw 无 -Encoding 时按 ANSI 代码页解析无 BOM 的 UTF-8 文件，
      # 会把中文字符（comment 字段）误读为乱码导致 ConvertFrom-Json 失败；显式 -Encoding UTF8 修复
      try {
        $rulesContent = Get-Content $rules -Raw -Encoding UTF8
        $null = $rulesContent | ConvertFrom-Json
        Write-Host '[ok]   规则单源 rules/sensitive-rules.json'
      } catch {
        Write-Host '[err]  rules/sensitive-rules.json 非法 JSON'
        Write-Host "[hint] 解析错误: $($_.Exception.Message)"
        $fail = $true
      }
    } else { Write-Host '[err]  缺失 rules/sensitive-rules.json（v0.7.0 起必备）'; $fail = $true }
    $codex = Get-Command codex -ErrorAction SilentlyContinue
    if ($codex) {
      $ver = (codex --version 2>$null | Select-Object -First 1)
      $pluginCap = $false
      try { codex plugin --help *> $null; $pluginCap = ($LASTEXITCODE -eq 0) } catch {}
      # v0.7.2：PS 5.1 无三元运算符 ? : —— 改用 if-as-expression（PS 5.0+ 支持）
      $pluginLabel = if ($pluginCap) { '（支持插件系统）' } else { '（不支持插件系统，需升级 Codex CLI ≥ 0.142）' }
      Write-Host "[info] codex $ver$pluginLabel"
      if ($pluginCap) {
        # v0.7.4：codex plugin --help 输出含英文文档段落（Override/Use/as/Examples/shell/
        # Enable/Disable/Print 等），旧正则 ^\s+([a-z][a-z-]*).*$ 会把这些英文单词当作子命令
        # 列出。改用更严格的匹配：行首缩进 + 单词 + (空格描述)? + 行尾，且排除常见非子命令词
        $subs = @()
        $nonSub = @('override','use','as','examples','shell','enable','disable','print',
                    'options','arguments','description','usage','commands','subcommands')
        try {
          $help = (codex plugin --help 2>&1) -join "`n"
          foreach ($line in ($help -split "`n")) {
            # 仅匹配"缩进 + 小写单词 + 可选空格描述"且看起来是命令行的行
            if ($line -match '^\s{2,}([a-z][a-z-]*)\s*[^a-z\n]') {
              $cmd = $Matches[1]
              if ($cmd -notin $nonSub -and $cmd -notin $subs) { $subs += $cmd }
            }
          }
        } catch {}
        if ($subs.Count -gt 0) {
          Write-Host "[info] codex plugin 子命令: $($subs -join ' ' )（插件安装入口：会话内 /plugins）"
        } else {
          Write-Host '[info] codex plugin 子命令解析失败（不影响使用，会话内 /plugins 是入口）'
        }
      }
    } else { Write-Host '[info] codex CLI 不在 PATH（不影响本机自检）' }
    if ($fail) {
      Write-Host '[doctor] 存在失败项（见上方 [err] 行）'
      Write-Host '[hint] 修复后重跑：powershell -ExecutionPolicy Bypass -File sf.ps1 doctor'
      exit 1
    } else { Write-Host '[doctor] 全部通过' }
  }
  default         { Write-Host "sf.ps1 — specflow 主入口 v1.2.2`n用法: sf.ps1 <parse|scan|todo|workflow|sanitize|events|doc-version|config|init|session-start|hooks-export|doctor|git-pre-commit|git-post-checkout|git-post-merge> [args]" }
}
