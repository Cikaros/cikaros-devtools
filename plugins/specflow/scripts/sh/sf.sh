#!/usr/bin/env bash
# sf.sh — specflow 主入口 v1.1.0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$PLUGIN_ROOT/scripts/lib"

# v1.1.0：不写 __pycache__ —— lib 模块互 import 会在插件目录（常为 git 仓库内）
# 生成 pycache 垃圾文件，污染 git status；脚本均为小型单文件，重编译开销可忽略
export PYTHONDONTWRITEBYTECODE=1

# ─────────────────────────────────────────────────────────────────
# python 探测（v0.7.0 / 用户反馈第 3 项：修复 git hook 场景 "py: command not found"）
#
# 根因：旧探测链 python3 → python → py -3 中，py 是 Windows 专属启动器；
# macOS 上 GUI/IDE 发起的 git 提交使用受限 PATH（如 /usr/bin:/bin），
# Homebrew 的 python3（/opt/homebrew/bin）不在其中 → 三级探测全部落空 →
# 执行不存在的 py → "sf.sh: line 67: py: command not found"。
#
# 新链：PATH 内命令 → 平台对应绝对路径（macOS/Linux：Homebrew/系统路径；
# Windows：py 启动器）→ 兜底 py 启动器；
# 全部落空时给出可读错误（而非 bash 原生报错），git hook 场景放行不阻塞提交。
# 可用环境变量 SPECFLOW_PY 强制指定解释器（pyenv/conda 等）。
# v1.1.0：Unix 绝对路径仅在非 Windows 平台尝试（避免在 Windows 上输出
# "tried /usr/bin/python3" 这类误导性错误信息；Windows 直接走 py 启动器）
# ─────────────────────────────────────────────────────────────────
sf_detect_py() {
  local c
  for c in python3 python; do
    command -v "$c" >/dev/null 2>&1 && { printf '%s\n' "$c"; return 0; }
  done
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*|*Windows*)
      # Windows：py 启动器是 python.org 官方安装器默认提供的；不在 PATH 时跳过
      command -v py >/dev/null 2>&1 && { printf 'py -3\n'; return 0; }
      ;;
    *)
      # POSIX：补常见绝对路径兜底（GUI/IDE 受限 PATH 场景）
      for c in /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 \
               /usr/bin/python /usr/local/bin/python; do
        [[ -x "$c" ]] && { printf '%s\n' "$c"; return 0; }
      done
      command -v py >/dev/null 2>&1 && { printf 'py -3\n'; return 0; }
      ;;
  esac
  return 1
}

if [[ -n "${SPECFLOW_PY:-}" ]]; then
  PY="${SPECFLOW_PY}"
  # 覆盖值不可用 → 明确报错（而不是裸 command not found）；
  # git hook 场景放行（A7 原则：插件环境故障绝不阻塞 git 操作）
  if ! command -v "${PY%% *}" >/dev/null 2>&1 && [[ ! -x "${PY%% *}" ]]; then
    echo "[err] specflow: SPECFLOW_PY 指定的解释器不可用: ${PY%% *}" >&2
    case "${1:-help}" in
      git-pre-commit|git-post-checkout|git-post-merge)
        echo "[specflow] SPECFLOW_PY 不可用，跳过 git hook 检查（放行，不阻塞 git）"
        exit 0 ;;
      *) exit 1 ;;
    esac
  fi
else
  PY="$(sf_detect_py || true)"
fi

if [[ -z "$PY" ]]; then
  echo "[err] specflow: 未找到 Python 解释器（已尝试 python3 / python / 常见安装路径 / py）。" >&2
  echo "      请安装 Python 3.8+（https://www.python.org/downloads/）或将 python3 加入 PATH；" >&2
  echo "      也可用环境变量 SPECFLOW_PY 显式指定（如 pyenv/conda 的解释器路径）。" >&2
  # git hook 场景：插件环境故障一律放行（A7 原则：绝不因插件问题阻塞 git 操作）
  case "${1:-help}" in
    git-pre-commit|git-post-checkout|git-post-merge)
      echo "[specflow] python 缺失，跳过 git hook 检查（放行，不阻塞 git）"
      exit 0 ;;
    *) exit 1 ;;
  esac
fi

case "${1:-help}" in
  parse)   shift; $PY "$LIB_DIR/doc-parser.py" "$@" ;;
  scan)    shift; $PY "$LIB_DIR/env-scanner.py" "$@" ;;
  todo)    shift; $PY "$LIB_DIR/todo-scanner.py" "$@" ;;
  workflow) shift; $PY "$LIB_DIR/workflow-state.py" "$@" ;;
  sanitize) shift; $PY "$LIB_DIR/sanitize.py" "$@" ;;
  events)
    # v0.6.0（A7）：查看扩展触发点事件总线（<运行时目录>/events.jsonl；
    # v0.7.0 新项目 .specflow/，旧项目自动回退 .codex/）
    shift; $PY "$LIB_DIR/events.py" "$(pwd)" "$@" ;;
  init)    shift; CODEX_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$SCRIPT_DIR/init-project.sh" "$@" ;;
  session-start)
    # 手动跑一遍 SessionStart hook（排障/预热；等价于 Codex 会话启动时自动执行）
    echo '{}' | node "$PLUGIN_ROOT/hooks/scripts/session-start.mjs" ;;
  hooks-export)
    # 导出 hooks.json 供排障/参考：sf.sh hooks-export <目标路径> [根目录]
    # （v1.3.0+ classic 模式已移除，本命令仅用于生成参考文件，不再写入 ~/.codex/hooks.json）
    shift; DST="${1:-./hooks.exported.json}"; ROOT="${2:-$HOME/.codex}"
    node "$LIB_DIR/hooks-export.mjs" "$PLUGIN_ROOT/hooks/hooks.json" "$DST" "$ROOT" ;;
  doctor)
    echo "[doctor] specflow 自检"
    FAIL=0
    command -v node >/dev/null 2>&1 && echo "[ok]   node $(node --version)" || { echo "[err]  node 未安装（hooks/MCP 必需，需 ≥ 18）"; FAIL=1; }
    # v0.7.0：报告实际探测到的解释器（含受限 PATH 兑底路径），便于排障
    if [[ -n "$PY" ]]; then
      echo "[ok]   python: ${PY}（$(${PY} --version 2>&1)）"
    else
      echo "[warn] python 未安装（扫描/解析降级）"
    fi
    for f in "$PLUGIN_ROOT"/hooks/scripts/*.mjs; do
      node --check "$f" 2>/dev/null && echo "[ok]   语法 $(basename "$f")" || { echo "[err]  语法失败: $f"; FAIL=1; }
    done
    node -e '
      const fs = require("fs");
      const root = process.argv[1];
      for (const f of ["hooks/hooks.json", ".mcp.json", ".codex-plugin/plugin.json"]) {
        JSON.parse(fs.readFileSync(root + "/" + f, "utf8"));
        console.log("[ok]   JSON " + f);
      }
    ' "$PLUGIN_ROOT" || FAIL=1
    for s in hook-orchestrator config-reader env-scanner privacy-guard; do
      [[ -f "$PLUGIN_ROOT/mcp/$s/index.js" ]] && echo "[ok]   mcp/$s/index.js" || { echo "[err]  缺失 mcp/$s/index.js"; FAIL=1; }
    done
    for p in env-scanner doc-parser todo-scanner sanitize workflow-state init-project events; do
      [[ -f "$LIB_DIR/$p.py" ]] && echo "[ok]   lib/$p.py" || { echo "[warn] 缺失 lib/$p.py"; }
    done
    [[ -f "$PLUGIN_ROOT/rules/sensitive-rules.json" ]] \
      && echo "[ok]   规则单源 rules/sensitive-rules.json" \
      || { echo "[err]  缺失 rules/sensitive-rules.json（脱敏规则单源，v0.6.0 起必备）"; FAIL=1; }
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1]+"/rules/sensitive-rules.json","utf8"))' "$PLUGIN_ROOT" 2>/dev/null \
      && echo "[ok]   规则单源为合法 JSON" || { echo "[err]  rules/sensitive-rules.json 非法 JSON"; FAIL=1; }
    command -v codex >/dev/null 2>&1 && echo "[info] codex $(codex --version 2>/dev/null | head -1)$(codex plugin --help >/dev/null 2>&1 && echo '（支持插件系统）' || echo '（不支持插件系统，需升级 Codex CLI ≥ 0.142）')" || echo "[info] codex CLI 不在 PATH（不影响本机自检）"
    if command -v codex >/dev/null 2>&1 && codex plugin --help >/dev/null 2>&1; then
      SUBS="$(codex plugin --help 2>&1 | sed -n 's/^[[:space:]]\{1,\}\([a-z][a-z-]*\).*/\1/p' | tr '\n' ' ')"
      echo "[info] codex plugin 子命令: ${SUBS:-（解析失败）}（插件安装入口：会话内 /plugins）"
    fi
    [[ "$FAIL" == "0" ]] && echo "[doctor] 全部通过" || { echo "[doctor] 存在失败项"; exit 1; } ;;
  git-pre-commit|git-post-checkout|git-post-merge)
    # v0.6.0（A7）：git hooks 真跑（lint+test+sanitize / 依赖变更检测）
    # v0.7.0：① python 探测已加固（受限 PATH/绝对路径兜底；缺失时放行）；
    #         ② 修复动作名不匹配——此前把 git-pre-commit 原样传给 git-hooks.py
    #            （它只认 pre-commit|post-checkout|post-merge），旧版因 py 缺失
    #            从未执行到此处而漏测；③ 退出码兜底：git-hooks.py 语义 0=放行/
    #            1=拒绝/2=内部错误（放行），set -e 不再把 2 传播成阻塞提交
    ACTION="$1"; shift
    SF_ACTION="${ACTION#git-}"
    echo "[sf] $ACTION hook 执行..."
    set +e
    $PY "$LIB_DIR/git-hooks.py" "$(pwd)" "$SF_ACTION"
    RC=$?
    set -e
    if (( RC >= 2 )); then
      echo "[specflow] ⚠ git hook 内部故障（退出码 ${RC}），放行不阻塞 git" >&2
      exit 0
    fi
    exit $RC ;;
  doc-version)
    # v0.6.0（A8）：文档版本 bump / 查询（详见 doc-version.py --help）
    shift; $PY "$LIB_DIR/doc-version.py" "$@" ;;
  config)
    # v1.1.0: DIY 配置管理
    shift
    sub_cmd="${1:-show}"
    case "$sub_cmd" in
      show)
        echo '[config] 合并后的配置'
        MC="${PWD}/.specflow/merged-config.json"
        if [[ -f "$MC" ]]; then
          node -e 'const m=require(process.argv[1]);console.log("stages:",m.stages.map(s=>s.name).join(" -> "));console.log("antiPatterns:",m.antiPatterns.length);console.log("hookRules:","pre="+m.hookRules.preToolUse.length+" post="+m.hookRules.postToolUse.length);m.warnings.forEach(w=>console.log("WARN:",w));' "$MC" 2>/dev/null || echo '  (解析失败)'
        else
          echo '  (未找到 merged-config.json; 请先跑 sf.sh session-start)'
        fi
        ;;
      validate)
        echo '[config] 校验自定义文件格式...'
        SF_RC=0
        for f in .specflow/stages.md .specflow/anti-patterns.json .specflow/hooks/pre-tool-use.json .specflow/hooks/post-tool-use.json .specflow/error-kb-config.json .specflow/mcp-tools.json; do
          if [[ -f "$f" ]]; then
            if [[ "$f" == *.json ]]; then
              if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" 2>/dev/null; then
                echo '  [ok] '$f
              else
                echo '  [FAIL] '$f' JSON 语法错误'
                SF_RC=1
              fi
            else
              echo '  [ok] '$f' (Markdown)'
            fi
          else
            echo '  [-] '$f' (不存在)'
          fi
        done
        if [[ $SF_RC -eq 0 ]]; then echo '[config] 校验通过'; else echo '[config] 存在错误'; exit 1; fi
        ;;
      *)
        echo '用法: sf.sh config [show|validate]'
        ;;
    esac
    ;;
  *) cat <<USAGE
sf.sh — specflow 主入口 v1.2.2
用法: sf.sh <command> [args]
命令:
  parse <file>       解析 Markdown 配置
  scan [path]        扫描环境
  todo [path]        扫描 TODO/FIXME 标记
  workflow <cmd>     管理工作流状态
  sanitize <file>    隐私过滤
  events [N|--json] 查看扩展触发点事件总线（默认最近 20 条）
  init               初始化项目（v0.7.0：统一 .specflow/ 目录，旧布局自动迁移）
  doc-version <cmd>  文档版本 show/bump/init/check/bump-outputs（v0.6.0）
  session-start      手动执行 SessionStart hook（排障/预热）
  hooks-export [dst] 导出 hooks.json 供排障参考（默认 ./hooks.exported.json）
  doctor             环境与文件自检
  git-pre-commit       git pre-commit hook（门禁：隐私/测试/STRICT 标记）
  git-post-checkout   git post-checkout hook（依赖变更检测）
  git-post-merge      git post-merge hook（依赖变更检测 + TODO 重扫）
环境变量:
  SPECFLOW_PY        强制指定 Python 解释器（pyenv/conda 等非 PATH 场景）

注：v1.3.0+ 安装/卸载脚本已迁移至仓库根目录 scripts/，仅负责 marketplace 注册/移除。
    plugin 启用由用户在 codex 会话内 /plugins 自行决定。
USAGE
     exit 1 ;;
esac
