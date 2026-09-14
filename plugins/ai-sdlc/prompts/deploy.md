---
description: "Stage 5 Deploy — PR 审查循环 + 钩子作为审批门 + CI/CD 沙盒部署"
---

# deploy — Stage 5: Deploy（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 5: Deploy**。AI 在 PR 审查循环中既能给出也能接收审查；钩子作为审批门；CI/CD 沙盒化部署。

## 前置条件

- Stage 4 已完成（`state.test_pass = true`）
- 当前在非 main 分支（如 feature/xxx）

## 执行步骤

1. **创建 PR**：
   ```
   git push -u origin HEAD
   gh pr create --title "<one-line>" --body "$(cat <<'EOF'
   ## Intent
   (引用 intent.md commit)

   ## Spec
   (引用 spec.md commit)

   ## Plan
   (引用 plan.md commit)

   ## Diff vs plan
   (说明实施与计划是否一致；若有偏离，引用同步更新的 plan.md)

   ## Test evidence
   (粘贴 make test / make lint 输出)
   EOF
   )"
   ```
2. **AI 自审 PR**：调用 `mcp__sdlc-orchestrator__self_review` 让 Codex 按 `REVIEW.md` 策略自审（参考模板 `templates/REVIEW.md.tpl`）。
3. **处理审查评论**：当审查者或作者在评论中标记 @codex，处理该评论并提交修复。PR 线索记录请求和变更。
4. **生产部署门禁**：
   - 调用 `mcp__sdlc-orchestrator__request_release_approval` 请求发布管理员授权
   - 发布管理员通过 `mcp__sdlc-orchestrator__approve_release` 设置 `state.release_approval = true`
   - PreToolUse hook 在 Bash 命令含 `deploy` + `production` 时检查授权，未授权则阻止
5. **回滚路径演练**：在测试环境定期演练回滚命令（`make rollback` / `kubectl rollout undo`），确保闭环操作可调用。
6. **合并到 main**：
   ```
   gh pr merge --squash --delete-branch
   ```
   PostToolUse hook 检测到 merge 命令 + release_approval，自动推进到 Stage 6: Maintain。

## 治理

- 职责分离：编写代码的代理没有批准它的途径
- REVIEW.md 中的审查策略适用于所有 PR，发现按严重程度排序
- 分支保护：代理写入的任何内容都转化为 PR，没有直接路径到 main
- 生产部署钩子会阻止发布直到指定的发布经理授权
- 每个环境的权限层级设定了代理在到达门禁前的操作权限

## REVIEW.md 策略（参考）

```
## Passes
- Bugs: logic errors, broken edge cases, subtle regressions
- Security: injection risks, authentication gaps, PII in logs
- Compliance: the change matches spec.md, plan.md and our design principles

## What Important means here
Reserve Important for findings that would break behavior, leak data or breach a policy.

## Cap the nits
Report at most five nits per review; summarize the rest as a count.

## Do not report
Generated files under src/gen/ and anything CI already enforces.
```

## 完成判定

- PR 已合并到 main
- `state.last_deployed_at` 已设置
- PostToolUse hook 自动推进到 Stage 6: Maintain
