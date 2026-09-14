---
description: "查看 SDLC 6 阶段全景图、依赖关系、当前进度"
---

# workflow — SDLC 全景图（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：会话内说
> 「注册操作手册」→ MCP `register_prompts`（跨平台，推荐）；或手动运行
> `scripts/sh/install-prompts.sh`（macOS/Linux）/
> `scripts/ps/install-prompts.ps1`（Windows）。


输出 AI-Native SDLC 的 6 阶段全景图与当前进度。

```
## AI-Native SDLC Workflow（Anthropic playbook）

### 6 阶段闭环

  ┌─────────────────────────────────────────────────────────────┐
  │                                                              │
  │   ① Planning ──► ② Design ──► ③ Build ──► ④ Test           │
  │   intent.md       spec.md      plan.md     test-pass         │
  │                                                  │           │
  │                                                  ▼           │
  │   ⑥ Maintain ◄── ⑤ Deploy ◄────────────────────┘           │
  │   incident        pr-merged                                 │
  │      │                                                       │
  │      └──► 写新 intent.md ──► 回到 ① （闭环）                │
  │                                                              │
  └─────────────────────────────────────────────────────────────┘

### 当前进度（基于仓库工件自动检测）

  ① Planning     [<done|current|pending>]
     └─ intent.md: <path or "未创建">
  ② Design       [<done|current|pending>]
     └─ spec.md: <path or "未创建">
  ③a Build/Plan  [<done|current|pending>]
     └─ plan.md: <path or "未创建">
  ③b Build/Impl  [<done|current|pending>]
     └─ diff+tests
  ④ Test         [<done|current|pending>]
     └─ test-pass: <true/false>
  ⑤ Deploy       [<done|current|pending>]
     └─ pr-merged: <true/false>
  ⑥ Maintain     [<done|current|pending>]
     └─ cycle_count: <N>

### 阶段间工件契约（提交链 = 审计追踪）

  intent.md ──(产品负责人接受)──► spec.md
  spec.md   ──(产品负责人接受)──► plan.md
  plan.md   ──(工程师接受)──────► diff + tests
  tests     ──(CI 通过)─────────► PR
  PR        ──(代码所有者批准)──► merge to main
  main      ──(控制带突破)──────► 新 intent.md（闭环）

### 关键门禁

  - PreToolUse: plan 模式禁改代码 / 修复期禁改测试 / 无工单禁改迁移 / 生产部署需授权
  - PostToolUse: 工件创建自动推进 / 测试通过自动推进 / PR 合并自动推进
  - Stop: 阶段产出检查 + 人工关卡提示
```

调用 MCP 工具 `mcp__sdlc-orchestrator__workflow` 获取结构化数据，或直接读 `.sdlc/state.json`。
