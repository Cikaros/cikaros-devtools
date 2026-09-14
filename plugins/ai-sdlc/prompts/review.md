---
description: "AI 自审 PR：按 REVIEW.md 策略三趟扫描（Bugs / Security / Compliance）"
---

# review — AI 自审 PR（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


让 Codex 按组织的 `REVIEW.md` 策略对当前 PR / diff 进行三趟扫描，发现按严重程度排序。

## 前置条件

- 仓库中存在 `REVIEW.md`（参考模板 `templates/REVIEW.md.tpl`）
- 当前分支有未合并的 diff（`git diff main...HEAD` 非空）

## 执行步骤

1. **读 REVIEW.md**：理解三趟扫描定义（Bugs / Security / Compliance）、Important 的判定标准、Nit 数量上限、不报告的路径。
2. **跑三趟扫描**：
   - **Bugs**：逻辑错误、损坏的边界情况、微妙的回归
   - **Security**：注入风险、认证缺口、PII 出现在日志
   - **Compliance**：变更是否匹配 `spec.md`、`plan.md` 和设计原则
3. **每个发现标记**：
   - `pass: bugs|security|compliance`
   - `severity: important|nit|info`
   - `file:line`
   - `evidence`（代码片段）
   - `suggestion`（具体修复建议）
4. **Nit 上限**：最多报告 5 个 nit，其余汇总为计数。
5. **不报告**：`src/gen/` 下的生成文件、CI 已强制的检查。
6. **输出结构化结果**：

```markdown
## AI 自审结果（REVIEW.md v<sha>）

### Important（<count>）
- [bugs] `path/to/file.ts:42` — <evidence>
  - 建议：<suggestion>
- [security] `api/auth.py:18` — <evidence>
  - 建议：<suggestion>

### Nits（5 of <total>）
- [compliance] `src/foo.ts:10` — <evidence>
- ...

### Skipped
- 生成文件：3
- CI 已强制：2
```

7. **反馈到 AGENTS.md**：如果审查第二次标记相同错误，把修正内容添加到 `AGENTS.md`——因为审查会读取 AGENTS.md，错误会在后续 PR 中被捕获。

## 治理

- AI 自审不批准也不阻止 PR——分支保护仍需要代码所有者批准
- 发现、修复、评分和批准都记录在 PR 历史中
- 平台工程师可读取 checks runs 发布的严重性计数作为机器可读统计
- 审查结果会反馈到 AGENTS.md，形成持续改进循环
