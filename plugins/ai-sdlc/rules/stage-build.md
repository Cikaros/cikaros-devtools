# Stage 3 — Build Rules

> 触发条件：`spec.md` 已存在并被产品负责人接受。
> 子阶段：
>   - **3a Plan Mode**：`plan.md` 不存在；Codex 在计划模式下生成 `plan.md`，工程师迭代后接受。
>     落位：默认 `.sdlc/artifacts/plan.md`（任务隔离模式 `.sdlc/tasks/<id>/plan.md`，
>     不入版本控制）；存量项目根目录已有 `plan.md` 时就地更新（legacy 落位仍可被检测）。
>   - **3b Implementation**：`plan.md` 存在且 `state.plan_accepted = true`；Codex 实施代码改动。

## Stage 3a — Plan Mode 硬约束（PreToolUse hook 强制，v0.4.0 策略）

完整标准见 `docs/write-policy.md`（文档写入保护策略）。核心语义：**代码不可变、文档可写**。

1. **禁止修改业务代码**（源码 / 构建清单 / 运行时配置 / 脚本 / SQL）——仅约束代码类文件；
2. **文档类全程放行**：`plan.md`（本职产出）、`README.md`、`CHANGELOG.md`、`docs/**`、
   `design/*.md`、ADR、`.sdlc/` 自定义等纯文档任意编辑，不受门禁限制；
   （playbook 依据："设计评审发生在任何代码生成之前——此时改变方向只是编辑文档的问题"）
3. **编辑 `spec.md` → warn**：spec 是已接受的规格，实施中途修改属需求漂移，
   应回 design 阶段走变更流程；
4. **Bash 仅允许只读命令**（逐段校验，v0.4.0 加固）：
   - `git status` / `git log` / `git diff` / `git show` / `git branch` / `git rev-parse` 等只读 git 子命令
   - `ls` / `cat` / `head` / `tail` / `rg` / `grep` / `find` / `pwd` / `which` / `stat` 等查看类
   - `--version` / `--help` / `make help` / `make -n`（dry-run）等元信息命令
   - 拦截：链式命令中的非只读段（`git status && rm x`）、输出重定向（`cat a > b`）、
     命令替换（`$(...)`）、测试执行（`make test` / `npm test` / `pytest`）
5. **未参与工作流的项目降级为 warn**（仓库仅有 spec.md 而从未用过 ai-sdlc 流程时，
   不硬拦、只提醒；详见 write-policy.md 第 3.1 节参与判定）；
6. **试图编辑业务代码 → hook 阻止**，reason 进 agent 上下文并指引逃生通道。

## Stage 3a — plan.md 必备章节

```markdown
# Plan: <feature> (from spec.md@<cycle-id>)

## Files that change
- <path> (new|modified|deleted)
- ...

## Order of work
1. <step that can be executed by an engineer who hasn't seen this conversation>
2. ...

## Risks
- What might this break?
- Which step is highest risk?
- What alternatives did you not choose?

## Proof
- test_<name>.py covers <behavior>
- screenshot matches <mock>
- endpoint returns 200 with <field>
```

## Stage 3a — 推进条件

- `plan.md` 文件存在
- 包含全部 4 个章节
- 工程师显式接受（`mcp__sdlc-orchestrator__accept_plan`）
- PostToolUse hook 自动推进到 Stage 3b

## Stage 3b — Implementation 硬约束（PreToolUse hook 强制）

1. **若 `state.in_fix_mode = true`**：禁止修改测试文件（`*_test.*` / `*.spec.*` / `tests/` / `__tests__/`）——这是 playbook 核心控制："修复代码的代理不能削弱对该代码的检查"。
2. **运行时状态保护（v0.4.0）**：`.sdlc/state.json` 等状态文件任何阶段都禁止 agent 直接
   编辑（防自我授权绕过门禁），状态变更走 MCP 受控工具或 hook 自动维护。
3. **编辑受保护知识文件触发警告**：`AGENTS.md` / `REVIEW.md` 等——机构知识工件，
   修改应经代码所有者审查（playbook 允许 agent 同错两次后自我纠正的例外）。

## Stage 3b — 实施规则

1. **按 plan.md 的 Order of work 逐步实施**——不要一次性写完所有代码再测。
2. **每步实施后跑局部验证**（lint / 该模块的单元测试）。
3. **偏离计划时同步更新 plan.md**——在同一提交中更新，保证 plan.md 始终与最终 diff 匹配。
4. **跑完整反馈循环**（报告完成前必做）：
   - `make build` / `npm run build`（必须成功）
   - `make test` / `npm test`（必须全绿，**永不跳过或删除失败的测试**）
   - `make lint` / `npm run lint`（必须零警告）
5. **UI 工作需视觉闭环**：实现 → 截图 → 与 mock 比较 → 调整（2-3 轮正常）。
6. **bug 修复特殊流程**：
   - 先写**失败的测试**用例（重现 bug）
   - 运行并确认其失败原因
   - 提交该测试用例
   - 调用 `mcp__sdlc-orchestrator__set_fix_mode(true)` 进入修复模式
   - 在**不修改测试**的前提下使测试通过
   - 退出修复模式

## Stage 3b — 推进条件

- `plan.md` 的 Files that change 全部已修改
- 测试通过（PostToolUse hook 检测到 `make test` 等命令 exit 0）
- diff 与 plan.md 匹配（无未声明的文件变更）
- PostToolUse hook 自动推进到 Stage 4: Test

## AGENTS.md（机构知识）

- **会话开始时读取**——提供新成员上下文：build/test/lint 命令、约定、代理常犯的错误。
- **工作规则**："当 Codex 两次犯同样的错误时，更正内容放入 AGENTS.md"（playbook 原文为 CLAUDE.md，Codex 环境统一为 AGENTS.md）。
- **保持一页以内**——Codex 在会话开始时读取所有内容，过时内容占用上下文无益。
- **必含章节**：Commands / Conventions / Architecture / Things the agent gets wrong。

## Skills（编码策略）

- **建议性控制**：在编写代码时应用策略（如 `secure-api-review` 在创建/修改 API 端点时触发）
- **经验法则**：为必须一致应用的机构知识编写 skills；不要为属于 AGENTS.md 或提示的部分编写 skills
- **必须始终成立的策略需要 hook 支撑**：skills 使违规罕见，hooks 使其几乎不可能

## Hooks（构建时安全防护）

- 阻止对受保护路径的编辑（生成的类、冻结的包）
- 文件编辑后运行格式化工具和代码检查工具（防止代码漂移）
- 将凭证信息从差异中排除
- 较重的检查（完整测试套件）应放在提交或 PR 中，不在构建期阻塞

## 治理

- **设计评审**发生在任何代码生成之前——此时改变方向只是编辑文档的问题。
- **计划记录**：plan.md 和修订记录连同接受人员一起记录在 git。
- **决策者**：常规变更由工程师批准；高风险变更由技术负责人或架构师批准。
- **领先指标**：从第一次实现阶段合并的变更比例；从计划批准到合并 PR 的时间。
- **滞后指标**：每个变更的返工周期；合并的 diff 仍然与 plan.md 匹配的频率。

## 反模式

- ❌ 写 `plan.md` 没有 `## Risks`——每个真实变更都有风险。
- ❌ 一次性写完所有代码再测——增量验证能更早发现问题。
- ❌ 修复模式下修改测试文件——这削弱了测试作为证据。
- ❌ Codex 同样错误犯两次不更新 AGENTS.md——机构知识没积累。
- ❌ 实施完成后改 plan.md 但不同步更新 diff——plan 和 diff 必须同步。
