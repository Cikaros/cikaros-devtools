# Plan: <feature-name> (from spec.md@<cycle-id>)

## Files that change
<!-- 全路径列表，标记 new/modified/deleted。 -->
- <path> (new)
- <path> (modified)
- <path> (deleted)

## Order of work
<!-- 编号步骤。每步可被一个从未看过本次对话的工程师独立执行。 -->
1. <
2. <
3. <

## Risks
<!-- 自我审视：可能破坏什么？哪步风险最高？没选的其他选项？ -->
- What might this break: <
- Highest risk step: <
- Alternatives not chosen: <

## Proof
<!-- 如何验证。具体测试文件 + 期望输出 + 截图匹配条件。 -->
- test_<name>.<ext> covers <behavior>
- screenshot matches <mock reference>
- endpoint returns 200 with <field>

<!--
生成后：
1. 工程师审视计划——可能破坏什么？哪步风险最高？没选的其他选项？
2. 迭代直到一个从未见过本次对话的工程师仅凭计划就能实施变更
3. 提交 plan.md
4. 工程师显式接受：调用 mcp__sdlc-orchestrator__accept_plan
5. PostToolUse hook 自动推进到 Stage 3b（实施）

阶段门禁（PreToolUse hook 强制）：
- 本阶段禁止修改业务代码（仅允许 plan.md / docs/ / .sdlc/）
- Bash 仅允许只读命令
-->
