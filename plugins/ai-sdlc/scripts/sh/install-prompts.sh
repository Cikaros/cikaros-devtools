#!/usr/bin/env bash
# install-prompts.sh — 把 ai-sdlc 的操作手册（动态扫描，v0.13.1 起 18 份）注册到用户
# prompts 目录（macOS / Linux 便利品；Windows 用 scripts/ps/install-prompts.ps1）
#
# 背景（v0.13.0）：官方 Codex CLI 不支持插件自定义 slash 命令，唯一的自定义
# 入口是 /prompts:<prompt_name>（读取用户 prompts 目录下的 markdown 文件）。
# 本脚本把插件 prompts/ 手册以 `sdlc-<name>.md` 前缀拷贝过去（防与用户既有
# prompts 撞名），注册后即可在会话内用 /prompts:sdlc-quick 等形式调用。
#
# v0.13.1 跨平台说明：注册逻辑的单一事实源是插件 lib/prompts.mjs（common.mjs 桶导出）的 Node fs 实现
# （registerPromptManuals，经 ESM 桥供 MCP register_prompts 工具复用）——
# 会话内说「注册操作手册」即可跨平台完成（macOS/Linux/Windows 一致，推荐）；
# 本脚本与 install-prompts.ps1 是等价的平台便利品（手动/离线场景）。
#
# v0.13.3 零操作说明：SessionStart 已默认自动注册/刷新（ensurePromptsRegistered）
# ——日常无需手动跑本脚本，仅在手动/离线/CI 场景使用。同步 opt-out 语义：
#   --remove  写入 .sdlc-prompts-optout 标记（此后 SessionStart 不再自动恢复）
#   安装     清除该标记（恢复自动注册）；SDLC_PROMPTS_AUTO=off 可总关
#
# 幂等：重复执行会刷新为插件当前版本内容。
# 卸载：--remove 移除全部 sdlc-* 前缀文件（只删本脚本安装的，不再自动恢复）。
#
# 用法：
#   bash install-prompts.sh                 # 安装/刷新（默认 ~/.codex/prompts）
#   bash install-prompts.sh --dir <path>    # 自定义 prompts 目录
#   bash install-prompts.sh --remove        # 卸载（停止自动注册）
#   bash install-prompts.sh --list          # 查看已注册
#
# 注意：即使不注册，手册仍可被 agent 按需读取（用户自然语言即可驱动全部
# 能力，见插件 AGENTS.md「意图→工具映射」）——本脚本只是给偏好显式调用
# 的用户一条官方通道。Windows 优先用 PowerShell 版（同目录 ../ps/）或直接
# 在会话内说「注册操作手册」（MCP register_prompts，免 shell）；误在无 bash
# 的 Windows 上跑本脚本会被 PreToolUse 跨平台护栏拦截并给出替代。

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_DIR="$PLUGIN_ROOT/prompts"
TARGET_DIR="${HOME}/.codex/prompts"
MODE="install"

for arg in "$@"; do
  case "$arg" in
    --remove) MODE="remove" ;;
    --list)   MODE="list" ;;
    --dir)    shift_next=1 ;;
    *)
      if [ "${shift_next:-0}" = "1" ]; then TARGET_DIR="$arg"; shift_next=0; fi ;;
  esac
done

MANUALS=(advance audit build cycle deploy init intent loop-resolve maintain plan quick reset review spec status task test workflow)
# v0.13.1：名单与 lib/prompts.mjs listPromptManuals / install-prompts.ps1 同源——
# 新增手册时三处同步（sh 数组 / ps 动态扫描 / Node 动态扫描）

count_installed() { local n=0; for m in "${MANUALS[@]}"; do [ -f "$TARGET_DIR/sdlc-$m.md" ] && n=$((n+1)); done; echo "$n"; }

case "$MODE" in
  install)
    if [ ! -d "$SRC_DIR" ]; then echo "错误：找不到 prompts 目录：$SRC_DIR" >&2; exit 1; fi
    mkdir -p "$TARGET_DIR" || { echo "错误：无法创建 $TARGET_DIR" >&2; exit 1; }
    # v0.13.3：安装 = 清除卸载标记（恢复 SessionStart 自动注册；与 lib/prompts.mjs 同语义）
    rm -f "$TARGET_DIR/.sdlc-prompts-optout"
    n=0
    for m in "${MANUALS[@]}"; do
      if [ -f "$SRC_DIR/$m.md" ]; then
        cp "$SRC_DIR/$m.md" "$TARGET_DIR/sdlc-$m.md" && n=$((n+1))
      fi
    done
    echo "已注册 $n 份操作手册到 $TARGET_DIR（sdlc-<名>.md）"
    echo "会话内调用示例：/prompts:sdlc-quick  /prompts:sdlc-status  /prompts:sdlc-intent"
    echo "日常无需手动执行（SessionStart 自动注册/刷新）；卸载：bash install-prompts.sh --remove"
    ;;
  remove)
    n=0
    for m in "${MANUALS[@]}"; do
      if [ -f "$TARGET_DIR/sdlc-$m.md" ]; then rm "$TARGET_DIR/sdlc-$m.md" && n=$((n+1)); fi
    done
    # v0.13.3：卸载 = opt-out（阻止 SessionStart 自动恢复；重新安装即清除标记）
    echo "ai-sdlc：用户已显式卸载操作手册。此标记阻止 SessionStart 自动注册；" > "$TARGET_DIR/.sdlc-prompts-optout" 2>/dev/null || true
    echo "已移除 $n 份手册（$TARGET_DIR/sdlc-*.md），并写入卸载标记（不再自动恢复）"
    ;;
  list)
    n=$(count_installed)
    echo "已注册 $n / ${#MANUALS[@]} 份（$TARGET_DIR）："
    for m in "${MANUALS[@]}"; do
      [ -f "$TARGET_DIR/sdlc-$m.md" ] && echo "  /prompts:sdlc-$m"
    done
    ;;
esac
