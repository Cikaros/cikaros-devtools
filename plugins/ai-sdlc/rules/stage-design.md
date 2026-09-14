# Stage 2 — Design Rules

> 触发条件：`intent.md` 已存在并被产品负责人接受；`spec.md` 不存在。
> 产物：`spec.md`（需求 + 设计合一，应用组织 skills 作为约束，标记关切点）。
> 落位：写入 `.sdlc/` 工作区（默认 `.sdlc/artifacts/spec.md`，任务隔离模式
> `.sdlc/tasks/<id>/spec.md`）——任务中间产物不入版本控制，周期结束归档即审计。

## 硬约束

1. **需求与设计合并为一个会话**——不分两个阶段、两个团队。这是 Anthropic playbook 的核心转变。
2. **必须应用组织 skills**——检查 `.codex/skills/`、`skills/`、`~/.codex/skills/`，skills 是约束不是建议。
3. **必须标记关切点（`## Concerns`）**——无法满足矛盾政策的地方，明确指出并路由到策略负责人。
4. **不修改业务代码**——本阶段只产出 `spec.md`。
5. **不修改 `intent.md`**——一旦进入 Design 阶段，改动应在 `spec.md`。

## spec.md 必备章节

```markdown
# Spec: <feature>
Source intent: intent.md@<cycle-id>

## Requirements
### Functional
- <numbered list, traceable to intent.md sections>
### Non-functional
- <performance / security / compliance / UX, each citing the skill that constrains it>

## Design
### Architecture
<diagram description + key components>
### Data model
<schema changes, migrations needed>
### API
<endpoints, request/response shapes>
### UX
<user flows, screen sketches (textual)>

## Concerns
- [security] <concern> → route to <policy owner>
- [compliance] <concern> → route to <policy owner>

## Open questions
- <inherited from intent.md or new>
```

## Skills 应用规则

- 每个 skill 在 `## Requirements / Non-functional` 中应被引用为约束来源
- 若 skill 之间冲突（如安全要求最小化日志 vs 调试要求详细日志），必须在 `## Concerns` 中标记并路由
- skills 版本记录在 `spec.md` 的 frontmatter 或 `## Source` 中

## 工件位置

- 默认：`.sdlc/artifacts/spec.md`（v0.10.0 起的工作区约定——不入版本控制）
- 多 spec 并存：`.sdlc/artifacts/specs/<kebab-name>.md`
- 存量兼容：项目根目录的既有 `spec.md` 就地更新（legacy 落位仍可被检测，
  PreToolUse 规则 0c 会提示迁回工作区）

## 推进条件

- `spec.md` 文件存在
- 引用了 `intent.md` 的 commit SHA
- 所有 `## Concerns` 已路由到具体负责人
- 产品负责人审查并接受
- 标记的关切点已与策略所有者解决（在工程看到规范之前）

## 治理

- **证据**：spec、生成它的提示、生效的 skills 版本都可在工作区工件与周期归档中追溯。
- **决策者**：产品负责人批准规范；高风险变更需咨询技术负责人。
- **领先指标**：`intent.md` 提交和 `spec.md` 提交之间的经过时间（两个 git 时间戳）。
- **滞后指标**：构建开始后的需求返工——统计同一变更中，在第一个 `plan.md` 提交之后日期的 `spec.md` 提交。

## 反模式

- ❌ 把需求和设计分成两份文档——playbook 明确合并它们。
- ❌ 没有 `## Concerns` 章节——每个真实设计都有权衡。
- ❌ skills 写"应遵循"而不是"约束本节"——skills 是约束。
- ❌ 不读现有代码库就设计——会提出不符合的模式。
- ❌ 自己解决关切点而不是路由到策略负责人——那不是你的决定。
