---
description: "查看当前 SDLC 阶段、工件清单、缺失项、闭环次数"
---

# status — 查看当前 SDLC 状态（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


调用 MCP 工具 `mcp__sdlc-orchestrator__status` 获取完整状态快照，并以易读格式输出：

```
## SDLC 状态快照（<timestamp>）

### 当前阶段
- **Stage N — <name>**（<substage>，置信度 <confidence>）
- 检测来源：<source>

### 工件清单
- ✅ intent.md     — <path> (cycle <cycle-id>)
- ✅ spec.md       — <path>
- ⬜ plan.md       — 未创建
- ⬜ REVIEW.md     — 未创建
- ✅ AGENTS.md     — <path>

### 缺失工件（本阶段需产出）
- ⬜/⚠️ plan.md — 进入 Stage 3a 后由 agent 生成（读 `prompts/plan.md` 手册）

### 闭环统计
- 闭环次数：<cycle_count>
- 上一阶段：<previous_stage>（completed at <ts>）
- 最后部署：<last_deployed_at>

### 阶段门禁状态
- plan_accepted: <true/false>
- test_pass: <true/false>
- release_approval: <true/false>
- in_fix_mode: <true/false>
- change_ticket: <ticket_id or null>

### 下一步
- 建议：<next-action>
- 命令：<suggested-slash-command>
```

如果 MCP 工具不可用，直接读 `.sdlc/state.json` + `.sdlc/hooks-state.json` 拼接。
