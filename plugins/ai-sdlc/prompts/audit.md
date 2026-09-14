---
description: "查看 hook 审计日志和事件流（最近 N 条）"
---

# audit — 查看 hook 审计与事件流（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


输出最近的 hook 调用审计与事件流，用于排障和合规检查。

## 执行

调用 MCP 工具：

```
mcp__sdlc-orchestrator__audit({ limit: 20 })
mcp__sdlc-orchestrator__events({ limit: 20 })
```

或直接读文件：

```bash
# 审计日志（最近 20 条）
jq '.[-20:]' .sdlc/hook-audit.json

# 事件流（最近 20 条）
tail -20 .sdlc/events.jsonl | jq .
```

## 输出格式

### Hook 审计（.sdlc/hook-audit.json）

```json
[
  {
    "ts": "2026-09-07T03:15:42.123Z",
    "hook": "session_start",
    "trigger": "SessionStart",
    "duration_ms": 42,
    "result": "success",
    "detail": {
      "stage": "design",
      "confidence": "high",
      "source": "intent+no-spec"
    }
  },
  ...
]
```

### 事件流（.sdlc/events.jsonl）

```jsonl
{"ts":"2026-09-07T03:15:42Z","type":"session_start","session_id":"sess-xxx","detail":"stage=design confidence=high"}
{"ts":"2026-09-07T03:18:01Z","type":"stage_advanced","from":"design","to":"build_plan","artifact":"spec.md","path":"spec.md"}
{"ts":"2026-09-07T03:25:33Z","type":"test_executed","passed":true,"exit_code":0,"command":"make test"}
{"ts":"2026-09-07T03:30:11Z","type":"stage_advanced","from":"build_impl","to":"test","reason":"test_passed"}
```

## 关键事件类型

| type | 含义 |
|------|------|
| `session_start` | 会话启动 + 阶段检测 |
| `session_end` | 会话结束 + 快照归档 |
| `stage_advanced` | 阶段推进（含 from/to/reason） |
| `stage_blocked` | 推进被阻止（含 reason） |
| `test_executed` | 测试命令执行（含 passed/exit_code） |
| `cycle_completed` | 闭环完成（maintain→planning） |
| `state_reset` | 状态被重置 |

## 治理用途

- 排障：定位 hook 是否按预期触发
- 合规：审计追踪（谁请求了什么、代理生成了什么、谁批准了它）
- 指标：领先指标（首次 CI 成功率、PR 审查时间）与滞后指标（生产回归数）
