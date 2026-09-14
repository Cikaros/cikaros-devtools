# <project-name>

> 本文件为 Codex 代理提供新成员所需的上下文。会话开始时代理读取全部内容。
> 由整个团队维护，每次犯错时迭代。保持一页以内——过时内容占用上下文无益。
> （AI-Native SDLC 惯例：playbook 原文称 CLAUDE.md，Codex 环境统一使用 AGENTS.md）

## Commands

- Build: `<cmd>` (must finish with "<success-marker>")
- Test: `<cmd>` (unit), `<cmd>` (integration, needs <deps>)
- Lint: `<cmd>` (runs in CI; fix before pushing)

## Conventions

- <language/framework/version>. <specific-rule>.
- <data-type-rule>. 例如：Money is always BigDecimal, never double.
- <testing-rule>. 例如：Every endpoint needs an integration test in src/itest.

## Architecture

- `<dir>/` holds <what>.
- `<dir>/` holds <what>.
- `<dir>/` talks to external systems.
- <key-architectural-constraint>. 例如：Kafka events are defined in schemas/; never edit generated classes.

## Things the agent gets wrong

- <rule-1>. 例如：Do not bump dependency versions; the platform team owns them.
- <rule-2>. 例如：The legacy v1/ package is frozen; changes go in v2/.
- <rule-3>.

## Verifying your work

- Build: `<cmd>` (must finish with "<success-marker>")
- Test: `<cmd>` (all green; never skip or delete a failing test)
- Lint: `<cmd>` (zero warnings)

Run all three before reporting any task complete, and paste the output.
**If a test fails, fix the code, not the test.**

<!--
工作规则：当 Codex 两次犯同样的错误时，更正内容放入本文件。
检查清单：
- 命令是否准确（copy-paste 即可运行）？
- 约定是否具体（不是"写干净代码"这种废话）？
- "Things the agent gets wrong" 是否反映了真实犯过的错？
- 是否保持一页以内？
-->
