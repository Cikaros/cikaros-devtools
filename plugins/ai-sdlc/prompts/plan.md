---
description: "Stage 3a Build (Plan Mode) — 读 spec.md 生成 plan.md，命名变更文件 + 工作顺序 + 风险 + 验证"
---

# plan — Stage 3a: Build / Plan Mode（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 3a: Build / Plan Mode**。本阶段是 Anthropic playbook 的硬约束——**计划模式作为默认的起始点**，Codex 在工程师接受计划前无法编辑文件。

## 前置条件

- 仓库中已存在被接受的 `spec.md`
- 如没有，先回到 Stage 2（读 `prompts/spec.md` 手册补齐 spec.md）

## 阶段门禁（PreToolUse hook 强制）

- 本阶段**禁止修改业务代码**（仅允许：读取、生成 plan.md、编辑 docs/ 或 .sdlc/ 内文件）
- Bash 仅允许只读命令（git status / ls / cat / rg / make help）
- 试图编辑业务代码会被 hook 阻止，reason 进你的上下文

## 执行步骤

1. **读 spec.md**：理解需求与设计，识别标记的关切点是否已解决。
2. **面试代码库**（只读）：扫描现有结构、相关模块、测试组织方式。
3. **生成 plan.md**：读 `templates/plan.md.tpl`，包含：
   - `# Plan: <feature> (from spec.md@<cycle-id>)`——cycle-id 见 `.sdlc/state.json`，工作区工件以周期为溯源单位
   - `## Files that change`（新增 / 修改 / 删除，全路径）
   - `## Order of work`（编号步骤，可被一个从未看过本次对话的工程师独立执行）
   - `## Risks`（可能破坏什么、哪步风险最高、Codex 没选的其他选项）
   - `## Proof`（如何验证——具体测试文件 + 期望输出）
4. **审视计划**：自问"变更可能破坏哪些内容？哪个步骤风险最高？"——把答案写入 `## Risks`。
5. **迭代直到清晰**：工程师修正计划，直到一个从未见过本次对话的工程师仅凭计划就能实施变更。
6. **写入工作区**：默认 `.sdlc/artifacts/plan.md`（任务隔离模式：`.sdlc/tasks/<id>/plan.md`）；存量项目根目录已有 plan.md 时就地更新。无需 git 提交——工作区工件不入版本控制。
7. **请工程师显式接受**：调用 MCP 工具 `mcp__sdlc-orchestrator__accept_plan` 标记 `state.plan_accepted = true`。PostToolUse hook 会自动推进到 Stage 3b（实施）。MCP 工具不可用（会话未暴露 mcp__sdlc-orchestrator__*）时，受控 CLI 回退：`bash <插件根>/scripts/sh/sdlc.sh accept`（v0.13.11，同锁同语义可审计；plan 模式 Bash 白名单对该子命令精确豁免）——切勿手改 `.sdlc/state.json`（会被 PreToolUse 拦截）。

## 治理

- 设计评审发生在任何代码生成之前——此时改变方向只是编辑文档的问题。
- 计划与修订记录连同接受人员一起记录在 `.sdlc/` 工作区与审计流（周期归档保留历史）。
- 常规变更由工程师批准；高风险变更由技术负责人或架构师批准。

## 完成判定

- 工件 `plan.md` 存在且包含上述 4 个章节
- `state.plan_accepted = true`（由 MCP 工具设置）
- PostToolUse hook 自动推进到 Stage 3b
