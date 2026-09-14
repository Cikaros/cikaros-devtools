#!/usr/bin/env bash
# init-project.sh — 在项目根目录初始化 ai-sdlc 工作流（幂等，不覆盖已有文件）
#
# v0.10.0 起核心引导（state.json 全 schema + .gitignore/.codexignore 托管块）委托
# hooks/scripts/bootstrap-project.mjs —— 与 SessionStart hook 的「首次使用自动
# 初始化」同一实现（单一事实源）。本脚本因此退化为「可选的手动初始化」：
#   - 自动路径：启用插件后首个 codex 会话即自动完成初始化，无需本脚本
#   - 手动路径：本脚本补充模板复制（bands.yaml / REVIEW.md / AGENTS.md）与
#     可选 git hooks —— 适合希望在会话前预置配置的团队
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(pwd)"

log()  { printf '\033[0;34m[ai-sdlc]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[ai-sdlc warn]\033[0m %s\n' "$*" >&2; }

# 参数解析（v0.10.0：移除 --guided 死参数——解析后从未被消费）
WITH_GIT_HOOKS=0
for arg in "$@"; do
  case "$arg" in
    --with-git-hooks) WITH_GIT_HOOKS=1 ;;
    *) echo "[err] 未知参数: ${arg}" >&2; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  warn "需要 Node ≥ 18（与 hooks / MCP server 同要求），未找到 node"
  exit 1
fi

log "初始化 ai-sdlc 工作流于 ${PROJECT_ROOT}"

# ─────────────────────────────────────────────
# 1. 核心引导（幂等）：state.json 全 schema + .gitignore/.codexignore 托管块
#    （.sdlc/ 运行时与工件不进版本控制——工件是任务推进的中间产物，
#     任务/周期结束后归档至 .sdlc/archive/ 即可，无需提交）
# ─────────────────────────────────────────────

BOOTSTRAP="$(node "${PLUGIN_ROOT}/hooks/scripts/bootstrap-project.mjs" "${PROJECT_ROOT}")"
log "引导结果：${BOOTSTRAP}"

# ─────────────────────────────────────────────
# 2. 创建 .sdlc/ 目录结构（工件工作区 + DIY 自定义）
# ─────────────────────────────────────────────

mkdir -p "${PROJECT_ROOT}/.sdlc/artifacts"
mkdir -p "${PROJECT_ROOT}/.sdlc/archive"
mkdir -p "${PROJECT_ROOT}/.sdlc/custom/skills"
mkdir -p "${PROJECT_ROOT}/.sdlc/custom/rules"
mkdir -p "${PROJECT_ROOT}/.sdlc/custom/templates"

# ─────────────────────────────────────────────
# 3. 复制模板（不覆盖已有文件）
# ─────────────────────────────────────────────

copy_template() {
  local src="${PLUGIN_ROOT}/templates/$1"
  local dst="${PROJECT_ROOT}/$2"
  if [ ! -f "${dst}" ]; then
    cp "${src}" "${dst}"
    log "已创建 ${dst}"
  else
    log "已存在 ${dst}（跳过）"
  fi
}

copy_template "bands.yaml.tpl" ".sdlc/bands.yaml"
# v0.10.0：REVIEW.md 是阶段工件 → 入工作区（不进版本控制；根目录存量 REVIEW.md 不动）
copy_template "REVIEW.md.tpl" ".sdlc/artifacts/REVIEW.md"

# AGENTS.md（Codex 约定的机构知识工件——机构知识属于版本控制的治理资产，留根目录；
# 遗留 CLAUDE.md 项目保持不动）
if [ -f "${PROJECT_ROOT}/CLAUDE.md" ] && [ ! -f "${PROJECT_ROOT}/AGENTS.md" ]; then
  log "已存在遗留 CLAUDE.md（Claude 时代工件，保留不动；如需迁移到 AGENTS.md 请手工处理）"
elif [ ! -f "${PROJECT_ROOT}/AGENTS.md" ]; then
  copy_template "AGENTS.md.tpl" "AGENTS.md"
fi

# ─────────────────────────────────────────────
# 4. 可选：安装 git hooks
# ─────────────────────────────────────────────

if [ "${WITH_GIT_HOOKS}" -eq 1 ]; then
  if [ ! -d "${PROJECT_ROOT}/.git" ]; then
    warn "未找到 .git 目录——跳过 git hooks 安装"
  else
    mkdir -p "${PROJECT_ROOT}/.git/hooks"
    # pre-commit: 跑 lint + 隐私扫描
    cat > "${PROJECT_ROOT}/.git/hooks/pre-commit" <<'EOF'
#!/bin/bash
# ai-sdlc pre-commit hook: lint + privacy scan
set -e
if [ -f Makefile ] && make -n lint >/dev/null 2>&1; then
  make lint
fi
# 简易隐私扫描：阻止提交 .env / secrets
for f in $(git diff --cached --name-only); do
  if [[ "$f" == *.env* ]] || [[ "$f" == *secret* ]]; then
    echo "[ai-sdlc] 阻止提交敏感文件: $f" >&2
    exit 1
  fi
done
EOF
    chmod +x "${PROJECT_ROOT}/.git/hooks/pre-commit"
    log "已安装 git pre-commit hook"
  fi
fi

# ─────────────────────────────────────────────
# 5. 输出初始化报告
# ─────────────────────────────────────────────

echo ""
log "═══════════════════════════════════════════"
log " ai-sdlc 初始化完成"
log "═══════════════════════════════════════════"
log ""
log "已创建："
log "  .sdlc/state.json              (运行时状态，全 schema)"
log "  .sdlc/artifacts/              (工件工作区——intent/spec/plan 落于此，不入版本控制)"
log "  .sdlc/archive/                (周期/任务归档区)"
log "  .sdlc/bands.yaml              (闭环节奏配置，建议提交——CI 闭环节奏共享)"
log "  .sdlc/custom/                 (DIY 自定义，建议提交)"
log "  .sdlc/artifacts/REVIEW.md     (审查策略模板)"
log "  AGENTS.md / CLAUDE.md         (机构知识模板，Codex 优先)"
log "  .gitignore / .codexignore     (托管块——.sdlc/ 运行时与工件已被忽略)"
[ "${WITH_GIT_HOOKS}" -eq 1 ] && log "  .git/hooks/pre-commit         (git hook)"
log ""
log "说明："
log "  - 本脚本为可选的手动初始化；启用插件后的首个 codex 会话会自动完成核心引导"
log "  - 工件（intent/spec/plan/REVIEW）不进版本控制：它们是任务推进的中间产物，"
log "    任务/周期结束后会话内说「开新周期/收尾任务」即可归档到 .sdlc/archive/（MCP new_cycle / task_close）"
log ""
log "下一步："
log "  1. 启动 codex 会话——SessionStart hook 会自动检测当前 SDLC 阶段"
log "  2. 任意提问即可——插件会根据上下文自动注入阶段规则"
log "  3. 自然语言即可驱动全部能力（意图→工具映射见会话注入）；操作手册 prompts/ 已由会话启动自动注册（v0.13.2 零操作，可选 /prompts:sdlc-<名> 调用；手动刷新/卸载用 MCP register_prompts 或 scripts/{sh,ps}/install-prompts.*）"
log "  4. 编辑 .sdlc/bands.yaml 配置闭环节奏（Stage 6 Maintain 用）"
log "  5. 编辑 .sdlc/artifacts/REVIEW.md 调整审查策略（Stage 5 Deploy 用）"
