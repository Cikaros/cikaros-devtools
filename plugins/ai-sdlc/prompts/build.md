---
description: "Stage 3b Build (Implementation) — 接受 plan.md 后实施，偏离计划时同提交更新 plan.md"
---

# build — Stage 3b: Build / Implementation（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 3b: Build / Implementation**。计划已被工程师接受，现在可以实施代码改动。

## 前置条件

- 仓库中已存在 `plan.md` 且 `state.plan_accepted = true`
- 如未接受，请先回到 Stage 3a 完成计划（读 `prompts/plan.md` 手册），并请工程师调用 `mcp__sdlc-orchestrator__accept_plan`

## 阶段门禁（PreToolUse hook 强制）

- 若 `state.in_fix_mode = true`（修复任务模式），**禁止修改测试文件**（`*_test.*` / `*.spec.*` / `tests/` / `__tests__/`）——这是 playbook 核心控制："修复代码的代理不能削弱对该代码的检查"
- 编辑受保护文件（AGENTS.md / REVIEW.md / .sdlc/state.json）会触发警告

## 执行步骤

1. **重新读 plan.md**：确认工作顺序、文件清单、风险点。
2. **按 plan.md 的 Order of work 逐步实施**：
   - 每步实施后跑对应的局部验证（lint / 单元测试）
   - 不要"一次性写完所有代码再测"——分步实施分步验证
3. **偏离计划时同步更新 plan.md**：如果实施过程中发现 plan.md 的某步不可行或需要调整，及时更新工作区中的 plan.md（PreToolUse 会提醒你把新工件写入 `.sdlc/artifacts/`）。这保证 plan.md 始终与最终 diff 匹配（PR 审查会比对）。
4. **跑完整反馈循环**（参见 `prompts/test.md` 手册）：
   - `make build` / `npm run build`（必须成功）
   - `make test` / `npm test`（必须全绿，**永不跳过或删除失败的测试**）
   - `make lint` / `npm run lint`（必须零警告）
5. **UI 工作需视觉闭环**：实现 → 截图 → 与 mock 比较 → 调整（2-3 轮正常）。
6. **bug 修复特殊流程**：
   - 先写**失败的测试**用例（重现 bug）
   - 运行并确认其失败原因
   - 提交该测试用例
   - 调用 `mcp__sdlc-orchestrator__set_fix_mode` 进入修复模式
   - 在**不修改测试**的前提下使测试通过
   - 退出修复模式
7. **提交 diff**（代码照常提交；plan.md 留在 `.sdlc/` 工作区，不随 diff 提交）：
   ```
   git add <changed-files>
   git commit -m "impl: <one-line> (plan: <plan.md 概要>)"
   ```

## 治理

- 机构知识以 `AGENTS.md` 形式版本控制——会话开始时读取，每次犯错时迭代。
- 编码策略以 skills 形式编码——在编写代码时应用，而非审查时。
- 钩子作为构建时的安全防护：阻止受保护路径编辑、文件保存后自动格式化、凭证信息从 diff 中排除。

## 完成判定

- plan.md 的 Files that change 全部已修改
- 测试通过（PostToolUse hook 检测到 `make test` 等命令 exit 0，自动推进到 Stage 4）
- diff 与 plan.md 匹配（无未声明的文件变更）
