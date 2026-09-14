---
description: "重置 SDLC 状态（保留工件历史，清空运行时状态）"
---

# reset — 重置 SDLC 状态（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


把 `.sdlc/state.json` 重置为初始状态，但保留：
- `.sdlc/artifact_history/`（工件历史记录）
- `.sdlc/events.jsonl`（事件流）
- `.sdlc/hook-audit.json`（审计日志）

清空：
- `current_stage` → 回到 `planning`（自动检测会立即重新填充）
- `plan_accepted` / `test_pass` / `release_approval` / `in_fix_mode` / `change_ticket` → false/null
- `stage_override` → null

## 执行

调用 MCP 工具 `mcp__sdlc-orchestrator__reset`：

```
mcp__sdlc-orchestrator__reset({ keep_history: true })
```

或直接覆盖文件：

```bash
# 备份当前状态
cp .sdlc/state.json .sdlc/state.json.bak.$(date +%s)

# 重置（state.json 会被 SessionStart hook 在下次启动时重新填充）
rm .sdlc/state.json
```

## 使用场景

- 状态文件损坏（手工编辑出错）
- 阶段判定反复出错（多候选路径冲突）
- 切换工作流上下文（中途接手别人的会话）

## 治理

- 重置操作会写入事件流（`type: state_reset`），保留审计追踪
- 重置后立即调 MCP `status` 验证重新检测的结果
- 如果重置后阶段判定仍不正确，可能工件落位有问题——检查 `.sdlc/artifacts/`（默认工作区）与根目录存量工件
