---
description: "Stage 2 Design — 从已接受的 intent.md 合成 spec.md，应用 skills 并标记关切"
---

# spec — Stage 2: Design（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 2: Design**。需求与设计在一个会话中合成（不再是分开的两个阶段），产物是 `spec.md`，受组织 skills 约束并标记关切点。

## 前置条件

- 仓库中已存在被接受的 `intent.md`（由 SessionStart hook 自动检测）
- 如果没有，先回到 Stage 1（读 `prompts/intent.md` 手册补齐 intent.md）

## 执行步骤

1. **读取 intent.md**：理解发起者的问题、约束、开放问题。
2. **加载组织 skills**：检查 `.codex/skills/`、`skills/`、`~/.codex/skills/` 是否有可用技能（安全、合规、品牌、UX）。skills 是组织使其机构知识得以运作的方式——明确、版本控制、广泛应用。
3. **生成 spec.md**：读 `templates/spec.md.tpl`，包含：
   - `# Spec: <feature>`（与 intent.md 标题对齐）
   - `## Source intent`（引用 intent.md 路径 + commit SHA）
   - `## Requirements`（功能性 + 非功能性，引用 skills 标准）
   - `## Design`（架构、数据模型、API、UX）
   - `## Concerns`（标记的关切点 + 路由到的策略负责人）
   - `## Open questions`（继承自 intent.md 或新出现的）
4. **标记关切点**：明确指出"哪里你无法满足矛盾的政策"——这些是分析师会升级的点，需要产品负责人与策略所有者解决。
5. **写到约定位置**：默认 `.sdlc/artifacts/spec.md`（任务隔离模式：`.sdlc/tasks/<id>/spec.md`）；存量项目根目录已有 spec.md 时就地更新。
6. **请产品负责人审查**：规范是否解决了 intent.md 的问题？开放问题是否已回答？
7. **先解决标记的关切点**：产品负责人在工程看到规范前，与其政策所有者解决每一个关切。
8. **工件落位即完成**：无需 git 提交——工作区工件不入版本控制，周期结束归档到 `.sdlc/archive/`。

## 治理

- skills 在规范编写时被读取并应用——不是几周后的审查才发现。
- 规范、生成它的提示、生效的 skills 版本都可在工作区工件与周期归档中追溯。
- 产品负责人批准规范后，决定进入 Stage 3: Build（计划模式）。

## 完成判定

- 工件 `spec.md` 存在且引用了 `intent.md`
- 所有关切点已路由到具体负责人
- PostToolUse hook 会自动检测到 `spec.md` 创建并推进到 Stage 3a (plan mode)
