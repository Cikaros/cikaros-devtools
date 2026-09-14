#!/usr/bin/env bash
# uninstall.sh — cikaros-devtools marketplace 卸载器 v1.13.13
#
# 设计变更（v1.3.0）：
#   本脚本**只做一件事**——从 codex marketplace 列表移除 cikaros-devtools。
#   不再卸载任何具体 plugin（specflow / ai-sdlc 等），由用户在 codex 会话内
#   通过 `/plugins` 浏览器自行决定停用哪些 plugin。
#
# 用法：
#   bash scripts/sh/uninstall.sh              # 移除 marketplace（幂等）
#   bash scripts/sh/uninstall.sh --yes        # 跳过确认提示
#   bash scripts/sh/uninstall.sh --status     # 仅查询当前注册状态，不修改
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKETPLACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MARKETPLACE_NAME="cikaros-devtools"

ASSUME_YES=0
STATUS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)    ASSUME_YES=1 ;;
    --status)    STATUS_ONLY=1 ;;
    -h|--help)
      cat <<EOF
cikaros-devtools marketplace 卸载器

用法：
  bash scripts/sh/uninstall.sh              移除 marketplace（幂等）
  bash scripts/sh/uninstall.sh --yes        跳过确认提示
  bash scripts/sh/uninstall.sh --status     仅查询当前注册状态
  bash scripts/sh/uninstall.sh --help       显示本帮助

卸载前请先在 codex 会话内通过 /plugins 停用所有已启用的 plugin。
本脚本不卸载具体 plugin——plugin 停用由用户在会话内决定。
EOF
      exit 0 ;;
    *) echo "[err] 未知参数: ${arg}（支持 --yes / --status / --help）" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[0;34m[%s]\033[0m %s\n' "$MARKETPLACE_NAME" "$*"; }
ok()   { printf '\033[0;32m[%s ok]\033[0m %s\n' "$MARKETPLACE_NAME" "$*"; }
warn() { printf '\033[0;33m[%s warn]\033[0m %s\n' "$MARKETPLACE_NAME" "$*" >&2; }
err()  { printf '\033[0;31m[%s err]\033[0m %s\n' "$MARKETPLACE_NAME" "$*" >&2; }

# ─────────────────────────────────────────────
# 前置检查
# ─────────────────────────────────────────────

if ! command -v codex >/dev/null 2>&1; then
  err "未找到 codex CLI"
  err "如已卸载 codex，marketplace 注册会随配置文件一起消失，无需本脚本"
  exit 1
fi

log "marketplace 卸载器 v1.13.13"
log ""

# ─────────────────────────────────────────────
# marketplace 注册状态查询
# ─────────────────────────────────────────────

is_marketplace_registered() {
  codex plugin marketplace list 2>/dev/null | grep -q "${MARKETPLACE_NAME}"
}

if [ "${STATUS_ONLY}" -eq 1 ]; then
  log "查询 marketplace 注册状态："
  if is_marketplace_registered; then
    warn "已注册：${MARKETPLACE_NAME}"
  else
    ok "未注册：${MARKETPLACE_NAME}"
  fi
  exit 0
fi

# ─────────────────────────────────────────────
# 提示用户先停用 plugin
# ─────────────────────────────────────────────

if is_marketplace_registered; then
  log "卸载前请确认："
  log "  1. 已在 codex 会话内通过 /plugins 停用所有已启用的 plugin"
  log "  2. 项目级的 .specflow/ / .sdlc/ 目录可选择保留（含工件历史）或手工删除"
  echo ""
  if [ "${ASSUME_YES}" -ne 1 ]; then
    read -r -p "确认移除 marketplace ${MARKETPLACE_NAME}？[y/N] " yn || yn=""
    case "$yn" in
      y|Y) ;;
      *) warn "已取消"; exit 0 ;;
    esac
  fi

  # 移除 marketplace
  if codex plugin marketplace remove "${MARKETPLACE_NAME}" 2>&1; then
    ok "marketplace 已移除：${MARKETPLACE_NAME}"
  else
    warn "marketplace 移除失败——可能已通过 /plugins 卸载，或 codex CLI 版本不支持此子命令"
    warn "请手动执行：codex plugin marketplace remove ${MARKETPLACE_NAME}"
  fi
else
  ok "marketplace 未注册：${MARKETPLACE_NAME}（幂等，跳过）"
fi

# ─────────────────────────────────────────────
# 输出残留清理指引
# ─────────────────────────────────────────────

echo ""
log "═══════════════════════════════════════════"
log " marketplace 卸载完成"
log "═══════════════════════════════════════════"
echo ""
log "残留清理（可选）："
log "  - 项目级运行时目录（含工件历史与审计日志）："
log "      rm -rf ~/your-project/.specflow/   # specflow"
log "      rm -rf ~/your-project/.sdlc/       # ai-sdlc"
log "  - 用户级全局配置（如有）："
log "      rm -rf ~/.specflow/                # specflow 全局配置"
echo ""
log "查询注册状态："
log "  bash scripts/sh/uninstall.sh --status"
