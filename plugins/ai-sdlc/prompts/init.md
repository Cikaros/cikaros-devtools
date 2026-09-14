---
description: "初始化项目的 SDLC 工作流（幂等；v0.10.0 起核心引导自动化，本命令主要补置模板）"
---

# init — 初始化项目 SDLC 工作流（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


在当前项目根目录初始化 ai-sdlc 工作流。

> **v0.10.0 起无需手动初始化**：启用插件后的首个 codex 会话（SessionStart hook）
> 会自动完成核心引导并注入「首次使用已自动初始化」声明。本命令用于在会话前
> 预置模板（bands.yaml / REVIEW.md / AGENTS.md）或修复引导缺失的存量项目。

## 核心引导（自动，幂等）

由 `hooks/scripts/bootstrap-project.mjs` 完成（与 SessionStart hook 同一实现）：

1. **`.sdlc/state.json`**：缺失则落盘全量默认 schema（common.defaultState 单一事实源）
2. **`.gitignore` 托管块**（`.git` 或 `.gitignore` 存在时）：
   ```
   # >>> ai-sdlc workspace (runtime + artifacts, do not commit) >>>
   .sdlc/*
   !.sdlc/bands.yaml
   !.sdlc/custom/
   !.sdlc/hooks/
   # <<< ai-sdlc workspace <<<
   ```
   ——运行时状态与工件（任务中间产物）不进版本控制；仅团队共享配置
   （bands.yaml / custom/ / hooks/）留在版本控制
3. **`.codexignore` 托管块**（文件已存在时）：追加运行时文件忽略清单
   （**不含** `.sdlc/artifacts/` 与 `.sdlc/tasks/`——工件必须可被 agent 读写）

## 模板补置（幂等不覆盖）

- `templates/bands.yaml.tpl` → `.sdlc/bands.yaml`（闭环节奏，建议提交）
- `templates/REVIEW.md.tpl` → `.sdlc/artifacts/REVIEW.md`（审查策略工件，入工作区）
- `templates/AGENTS.md.tpl` → `AGENTS.md`（Codex 机构知识工件，留根目录；
  遗留 CLAUDE.md 项目保留原文件）

## 可选：git hooks（`--with-git-hooks`）

- `pre-commit`：跑 `make lint`（Makefile 存在且可 lint 时）+ 隐私扫描
  （阻止暂存 `*.env*` / `*secret*` 文件）

## 工作区布局

```
.sdlc/
├── state.json          （运行时状态，全 schema）
├── artifacts/          （工件工作区——intent/spec/plan/REVIEW，不入版本控制）
├── archive/            （周期/任务归档区，不入版本控制）
├── bands.yaml          （闭环节奏配置，建议提交）
└── custom/             （DIY 自定义：skills / rules / templates 覆盖，建议提交）
```

## 治理

- 初始化是幂等的——重复执行不会覆盖已有文件
- 所有创建的文件都记录到 `.sdlc/events.jsonl` 与 `.sdlc/hook-audit.json`
- 工件是任务推进的中间产物：任务/周期结束后由 MCP `new_cycle` 或
  `task_close` 归档到 `.sdlc/archive/`（不删除，不入版本控制）
