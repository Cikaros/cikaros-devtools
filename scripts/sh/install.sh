#!/usr/bin/env bash
# install.sh — cikaros-devtools marketplace 安装器 v1.13.13
#
# 设计变更（v1.3.0）：
#   本脚本**只做一件事**——把 cikaros-devtools 仓库注册为 codex marketplace。
#   不再安装任何具体 plugin（specflow / ai-sdlc 等），由用户在 codex 会话内
#   通过 `/plugins` 浏览器自行决定启用哪些 plugin。
#
# 用法：
#   bash scripts/sh/install.sh              # 注册 marketplace（幂等）
#   bash scripts/sh/install.sh --yes        # 跳过所有确认提示
#   bash scripts/sh/install.sh --status     # 仅查询当前注册状态，不修改
#
# 装完必做：进入 codex 会话执行 `/plugins`，浏览并启用需要的 plugin，
# 然后执行 `/hooks` 审查并信任对应 plugin 的 hooks。
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
cikaros-devtools marketplace 安装器

用法：
  bash scripts/sh/install.sh              注册 marketplace（幂等）
  bash scripts/sh/install.sh --yes        跳过确认提示
  bash scripts/sh/install.sh --status     仅查询当前注册状态
  bash scripts/sh/install.sh --help       显示本帮助

注册后：
  1. 进入 codex 会话
  2. 执行 /plugins 浏览 cikaros-devtools 下的所有 plugin
  3. 选择并启用需要的 plugin（specflow / ai-sdlc / ...）
  4. 执行 /hooks 审查并信任启用 plugin 的 hooks

本脚本不再安装具体 plugin——plugin 启用由用户在会话内决定。
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
  err "请先安装 Codex CLI ≥ 0.142（提供 plugin marketplace 系统）"
  exit 1
fi

if [ ! -f "${MARKETPLACE_ROOT}/.agents/plugins/marketplace.json" ]; then
  err "未找到 marketplace 清单：${MARKETPLACE_ROOT}/.agents/plugins/marketplace.json"
  err "请确认在 cikaros-devtools 仓库根目录运行本脚本"
  exit 1
fi

log "marketplace 安装器 v1.13.13"
log "MARKETPLACE_ROOT=${MARKETPLACE_ROOT}"
log ""

# ─────────────────────────────────────────────
# marketplace 注册状态查询
# ─────────────────────────────────────────────

is_marketplace_registered() {
  codex plugin marketplace list 2>/dev/null | grep -q "${MARKETPLACE_NAME}"
}

list_available_plugins() {
  # 从 marketplace.json 读取 plugin 清单
  local mp_file="${MARKETPLACE_ROOT}/.agents/plugins/marketplace.json"
  if command -v python3 >/dev/null 2>&1; then
    # v1.9.0 安全加固：路径经 argv 传入（不再内插进 python 源码）——
    # 含引号/反引号的安装路径此前会破坏甚至注入内嵌代码
    python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    mp = json.load(f)
print("  marketplace: " + mp["name"])
print("  plugins (" + str(len(mp["plugins"])) + "):")
for p in mp["plugins"]:
    print("    - " + p["name"] + ": " + str(p.get("description", ""))[:80])
' "${mp_file}" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    # v1.9.0 安全加固：同上，argv 传参
    node -e '
const fs = require("fs");
const mp = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
console.log("  marketplace: " + mp.name);
console.log("  plugins (" + mp.plugins.length + "):");
for (const p of mp.plugins) {
  console.log("    - " + p.name + ": " + (p.description || "").slice(0, 80));
}
' "${mp_file}" 2>/dev/null
  else
    # 退化为 cat
    cat "${mp_file}"
  fi
}

if [ "${STATUS_ONLY}" -eq 1 ]; then
  log "查询 marketplace 注册状态："
  if is_marketplace_registered; then
    ok "已注册：${MARKETPLACE_NAME}"
  else
    warn "未注册：${MARKETPLACE_NAME}"
  fi
  echo ""
  log "可用的 plugin："
  list_available_plugins
  exit 0
fi

# ─────────────────────────────────────────────
# 注册 marketplace（幂等）
# ─────────────────────────────────────────────

if is_marketplace_registered; then
  ok "marketplace 已注册：${MARKETPLACE_NAME}（幂等，跳过）"
else
  if [ "${ASSUME_YES}" -ne 1 ]; then
    log "即将注册 marketplace："
    log "  名称：${MARKETPLACE_NAME}"
    log "  路径：${MARKETPLACE_ROOT}"
    log ""
    read -r -p "确认注册？[Y/n] " yn || yn=""
    case "$yn" in
      n|N) warn "已取消"; exit 0 ;;
      *) ;;
    esac
  fi
  if codex plugin marketplace add "${MARKETPLACE_ROOT}" 2>&1; then
    ok "marketplace 注册成功：${MARKETPLACE_NAME}"
  else
    err "marketplace 注册失败"
    err "请手动执行：codex plugin marketplace add ${MARKETPLACE_ROOT}"
    exit 1
  fi
fi

# ─────────────────────────────────────────────
# 输出可用 plugin 清单 + 启用指引
# ─────────────────────────────────────────────

echo ""
log "═══════════════════════════════════════════"
log " marketplace 注册完成"
log "═══════════════════════════════════════════"
echo ""
log "可用的 plugin："
list_available_plugins
echo ""
log "下一步：启用 plugin（由用户决定）"
log "  1. 进入 codex 会话"
log "  2. 执行 /plugins 浏览 cikaros-devtools marketplace"
log "  3. 选择并启用需要的 plugin（如 specflow / ai-sdlc）"
log "  4. 执行 /hooks 审查并信任启用 plugin 的 hooks"
echo ""
log "卸载 marketplace："
log "  bash scripts/sh/uninstall.sh"
echo ""
log "查询注册状态："
log "  bash scripts/sh/install.sh --status"
