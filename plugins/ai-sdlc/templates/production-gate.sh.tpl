#!/bin/bash
# production-gate.sh — 生产部署门禁钩子（Stage 5: Deploy）
#
# Anthropic playbook 治理要求：生产部署需发布管理员授权。
# 本脚本作为 PreToolUse hook 的 Bash matcher 调用，检查 Bash 命令是否包含 deploy+production。
# 若包含且未设置 RELEASE_APPROVAL 环境变量，exit 2 阻止操作。
#
# 安装位置：.sdlc/hooks/production-gate.sh（项目级钩子）或 codex 插件 hooks（不可协商钩子）
# 配套：mcp__sdlc-orchestrator__approve_release 设置授权
#
# 跨平台说明（v0.13.2）：生产门禁的主实现是插件 Node hook
# （hooks/scripts/pre-tool-use.mjs 规则 4，三平台一致）；本模板是 Unix
# CI/网关环境的项目级可选加固（Windows CI 请改用 Node hook 或等价 ps1）。

# 从 stdin 读取 hook 输入 JSON
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$cmd" ]]; then
  # 非 Bash 工具调用，放行
  exit 0
fi

# 检查命令是否包含 deploy + production
cmd_lower=$(echo "$cmd" | tr '[:upper:]' '[:lower:]')
if [[ "$cmd_lower" == *"deploy"* && "$cmd_lower" == *"production"* ]]; then
  # 检查授权
  if [ -z "$RELEASE_APPROVAL" ]; then
    # 检查 .sdlc/state.json 中的 release_approval
    state_file=".sdlc/state.json"
    if [ -f "$state_file" ]; then
      approved=$(jq -r '.release_approval // false' "$state_file" 2>/dev/null)
      if [ "$approved" != "true" ]; then
        echo "[ai-sdlc] Production deploys need a release authorization." >&2
        echo "" >&2
        echo "当前命令：$cmd" >&2
        echo "" >&2
        echo "请发布管理员通过 MCP 工具 approve_release 设置授权。" >&2
        echo "或设置 RELEASE_APPROVAL 环境变量。" >&2
        # exit 2 阻止操作，message 进 Codex 上下文
        exit 2
      fi
    else
      echo "[ai-sdlc] .sdlc/state.json not found. Run /sdlc-init first." >&2
      exit 2
    fi
  fi
fi

# 放行
exit 0
