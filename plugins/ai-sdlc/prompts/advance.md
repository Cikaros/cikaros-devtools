---
description: "强制推进到下一阶段（绕过自动检测；用于手工创建工件后修复状态）"
---

# advance — 强制推进阶段（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


正常情况下，PostToolUse hook 会在工件创建后自动推进。仅当以下情况需要手工推进：

1. 工件是在 codex 会话外创建的（git checkout 别人提交的 spec.md）
2. 工件创建时 hook 未触发（手工 vim 创建）
3. 状态文件损坏需要重置后重建

## 执行

调用 MCP 工具 `mcp__sdlc-orchestrator__advance`：

```
mcp__sdlc-orchestrator__advance({ from: "<current-stage>" })
```

返回：
- `{ ok: true, next: "<next-stage>" }` — 推进成功
- `{ ok: false, error: "missing artifacts: ..." }` — 产出检查失败，需先创建缺失工件
- `{ ok: false, error: "unknown stage: ..." }` — 阶段名错误

## 推进路径

```
planning → design → build_plan → build_impl → test → deploy → maintain → planning（闭环）
```

## 治理

- 强制推进会写入 `.sdlc/hook-audit.json` 和 `.sdlc/events.jsonl`
- 推进前会做产出检查（除非用 `--force` 参数）
- 推进后清除下一阶段的接受标志（如 `plan_accepted = false`）

如果反复推进失败，调 MCP `reset` 重置状态后用 `status` 重新检测。
