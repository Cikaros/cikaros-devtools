# Stage 1 — Planning Rules

> 触发条件：输入分流（`rules/triage.md`）判定为需求/ISSUE 且仓库中无 `intent.md`，或用户首条提问描述了痛点/想法/缺陷。
> 产物：`intent.md`（写入 `.sdlc/` 工作区——任务中间产物，不入版本控制；周期结束归档即审计。进入 Stage 2: Design 的输入）。

## 硬约束

1. **不修改业务代码**——本阶段只产出 `intent.md`。
2. **不写正式需求文档 / 用户故事 / 故事点**——这是旧 SDLC 的仪式，AI 原生 SDLC 直接用发起者原话。
3. **必须保留发起者原话**——不翻译为"作为 X，我想 Y，以便 Z"。
4. **必须包含 `## Open questions`**——每个真实想法都有未知；没有开放问题的 intent.md 是过度自信。
5. **Open questions 必须先呈现给发起者并等待回答（v0.6.0 交互闭环）**——问题必须在对话中逐条提出、由发起者回答；未回答前插件门禁阻止推进到 Stage 2（阶段停在 planning/awaiting_answers，Stop hook 持续提醒）。

## intent.md 必备章节

```markdown
# Intent: <feature>
Author: <name>. Status: draft.

## Problem
<initiator's own words>

## Proposed outcome
<concrete, observable result>

## Affected users and systems
<list>

## Constraints
<list, including skills-derived constraints>

## Open questions
<list>
```

## 工件位置

- 默认：`.sdlc/artifacts/intent.md`（v0.10.0 起的工作区约定——不入版本控制）
- 任务隔离模式：`.sdlc/tasks/<id>/intent.md`
- 存量兼容：项目根目录的既有 `intent.md` 就地更新（legacy 落位仍可被检测）
- 多 intent 并存：`intent/<kebab-name>.md`（共享 intent 主页，仅存量项目）

## 推进条件

- `intent.md` 文件存在
- 包含全部 5 个章节
- **Open questions 全部已回答**（章节为空，或条目全部标记 `- [x]` / `~~删除线~~` / 行尾 `[resolved]`）——v0.6.0 交互门禁，PostToolUse hook 强制
- 已写入约定工作区（默认 `.sdlc/artifacts/intent.md`；存量根目录落位兼容）
- 产品负责人审查并接受（对话确认或 PR 流程）—— 接受动作记录在 .sdlc/hook-audit.json 与周期归档
- 逃生通道：发起者明确跳过时，经用户明确同意后调 MCP `advance`（force 推进）

## 治理

- **证据**：工件头部作者/状态字段 + `.sdlc/hook-audit.json` 事件流（作者与时间戳）+ 周期归档（`.sdlc/archive/` + `cycles.json` 索引）保留完整历史（工件不入版本控制，v0.10.0 起）。
- **决策者**：产品负责人（接受或关闭），决定记录为工件的合并或关闭的评审。
- **领先指标**：从首次对话到产出 `intent.md` 所需时间（目标：数小时，不是数周）。
- **滞后指标**：存活率——产品负责人接受进入 Stage 2 而不是关闭的 `intent.md` 比例。

## 反模式

- ❌ 把发起者原话翻译为正式产品语言——丢失上下文。
- ❌ 跳过头脑风暴直接写 1 页文档——想法还不够具体。
- ❌ **自问自答 Open questions**——问题属于发起者；agent 假设答案 = 未经确认的需求（v0.6.0 门禁拦截）。
- ❌ 在 `intent.md` 中写技术方案——那是 Stage 2 的事。
- ❌ `spec.md` 提交后再回头改 `intent.md`——此时改动应在 `spec.md`。
- ❌ 把一次性小事也写成 intent.md——临时任务走 quick_task 队列，不进 SDLC 流程（输入分流）。
