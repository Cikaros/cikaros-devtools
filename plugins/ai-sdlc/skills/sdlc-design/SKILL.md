---
name: sdlc-design
description: >-
  SDLC Stage 2 Design（需求与设计合成）技能。何时使用：intent.md 已存在且 Open questions
  已回答、spec.md 尚不存在时。职责：在一个会话里合成 spec.md（需求+设计合一），扫描并应用
  组织 skills 作为硬约束，标记无法满足的关切点（Concerns）路由给策略负责人；不改代码、
  不改 intent.md。前端项目在此阶段补充 UI mock 供 Stage 4 视觉闭环使用。补充信息类输入
  融入本阶段工件；临时任务登记 quick_task 排队，不混入 spec。
---

# sdlc-design — Stage 2: Design 技能

> 权威规则：`rules/stage-design.md`（本技能是其可执行摘要）；输入分流标准：`rules/triage.md`；
> 操作手册：`prompts/spec.md`（自然语言进入本阶段；v0.13.0 起无 slash 命令）。

## 何时触发

- `intent.md` 已存在且 Open questions 已全部回答（阶段已离开 awaiting_answers）
- `spec.md` 尚不存在
- 需求变更被批准、需要重写 spec 时（回退路径：MCP `set_stage({stage:"design"})` 或 `advance`）

## 输入分流边界（v0.12.0）

- **补充信息**（范围/约束/澄清）：融入 spec.md 对应章节（可同步更新 plan.md 说明）
- **临时任务**：登记 MCP `quick_task({action:"add"})` 排队（周期走完后处理），不得混入 spec

## 做什么

1. **扫描组织 skills 并作为约束应用**（不是建议）：检查 `.codex/skills/`、`skills/`、
   `~/.codex/skills/`、`.sdlc/custom/skills/`——每条非功能需求都应引用约束它的 skill
2. 产出 `spec.md`（用 `templates/spec.md.tpl`），必备章节：
   - Requirements（Functional 可追溯到 intent.md 章节 / Non-functional 引用约束 skill）
   - Design（Architecture / Data model / **UI mock**（前端项目，含关键页面布局与状态，
     供 Stage 4 截图对比）/ API surface）
   - **Concerns**（无法满足的矛盾政策，明确路由到策略负责人）
3. 写入约定工作区（默认 `.sdlc/artifacts/spec.md`；存量根目录 spec.md 就地更新）
   ——无需 git 提交，工作区工件不入版本控制（PostToolUse 检测到 spec.md 推进 Stage 3a）

## 不做什么

- ❌ 把需求与设计拆成两个阶段/两份文档（playbook 核心转变：一个会话合成）
- ❌ 修改业务代码（本阶段唯一产出是 spec.md）
- ❌ 修改 `intent.md`（进入 Design 后的变更都落在 spec.md）
- ❌ UI 项目省略 mock——没有 mock 就没有 Stage 4 的视觉闭环基准

## 门禁与治理（hook 强制）

| 机制 | 行为 |
|------|------|
| 文档可写 | spec.md 是本职产出，全程放行 |
| 前置工件 | intent.md 缺失时 Stop hook 提示回补 |
| 前端提示 | 改 UI 的周期在资源索引中可见 frontend-e2e 技能（Stage 3b/4 起可用） |

## 反模式

- Non-functional 需求凭空编造却引不出任何约束来源（skill/ADR/法规）
- Concerns 空着——矛盾约束被静默取舍，而不是明确上报
- spec 写成实现细节清单（那是 plan.md 的事）
