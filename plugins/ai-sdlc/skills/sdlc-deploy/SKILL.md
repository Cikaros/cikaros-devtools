---
name: sdlc-deploy
description: >-
  SDLC Stage 5 Deploy（PR 审查与发布）技能。何时使用：state.test_pass = true、需要创建
  带完整审计追踪的 PR、或执行生产部署（需发布授权）时。职责：PR body 携带
  intent/spec/plan 提交引用 + diff vs plan + 测试证据；迁移与基础设施改动需变更工单；
  生产部署需发布管理员授权。临时任务登记 quick_task 排队，严禁混入 PR 的审计追踪与 diff。
---

# sdlc-deploy — Stage 5: Deploy 技能

> 权威规则：`rules/stage-deploy.md`（本技能是其可执行摘要）；输入分流标准：`rules/triage.md`；
> 操作手册：`prompts/deploy.md`（自然语言进入本阶段；v0.13.0 起无 slash 命令）。

## 何时触发

- `state.test_pass = true` + 当前分支非 main + git 有 diff（可以提 PR 了）
- 生产部署、或需要编辑迁移/基础设施文件时

## 输入分流边界（v0.12.0）

- **补充信息**（发布环境/窗口等约束）：更新 plan.md 或 PR 描述，不影响测试证据
- **临时任务**：登记 MCP `quick_task({action:"add"})` 排队——**严禁**混入 PR（审计追踪与 diff
  只覆盖本周期交付物；「Diff vs plan 无偏差」的声明会被混入内容污染）

## 做什么

1. **创建 PR**，body 必须包含完整审计追踪（机器可读的证据链）：
   - Intent / Spec / Plan 各自的 commit 引用
   - **Diff vs plan**：实施与 plan.md 是否一致；偏离处引用更新后的 plan.md 提交
   - **Test evidence**：粘贴 `make test` / `npx playwright test` 等原始输出
   （测试门禁通过才有资格走到这一步——未通过时 PreToolUse 拦 `gh pr create`）
2. **PR 审查循环**：AI 双向 review + hooks 作为审批门 + CI 沙盒部署
3. 生产部署前确认 `state.release_approval` 已由发布管理员设置（MCP `approve_release`）
4. PR 合并 → PostToolUse 检测 → 推进 Stage 6

## 不做什么

- ❌ 无 release_approval 执行 `deploy … production`（PreToolUse 硬拦）
- ❌ 无 change_ticket 编辑 `migrations/` / `terraform/` / `*.sql` / `*.tf`（硬拦）
- ❌ PR body 省略审计追踪段落（审查者要看的恰恰是意图与风险对照）
- ❌ 绕过测试门禁直接 push（v0.7.0 起门禁在 push 与 PR 两处都拦）

## 反模式

- 把测试证据写成「测试已通过」的结论句——要粘贴原始输出
- Diff vs plan 写「无偏差」而实际改了未列文件——审计链在 PR 审查时暴露
- 迁移文件「随功能顺手改」——Stage 5 的迁移保护要求先有工单
