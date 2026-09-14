---
name: sdlc-planning
description: >-
  SDLC Stage 1 Planning（意图捕获）技能。何时使用：输入分流判定为需求/ISSUE 且仓库还没有
  intent.md（或新周期/新任务需重新锚定意图）时——用户描述的痛点/想法/缺陷属于需求类。
  临时任务不属本技能（登记 quick_task）；补充信息应融入既有工件而非重开。
  职责：把发起者的痛点以原话形式捕获为 .sdlc 工作区的 intent.md（不入版本控制；
  含 Open questions 并逐条向发起者提问、等待回答），不写用户故事/故事点、不碰任何业务代码。
---

# sdlc-planning — Stage 1: Planning 技能

> 权威规则：`rules/stage-planning.md`（本技能是其可执行摘要）；输入分流标准：`rules/triage.md`；
> 操作手册：`prompts/intent.md`（自然语言进入本阶段；v0.13.0 起无 slash 命令）。

## 何时触发

- 输入分流（rules/triage.md）判定为**需求/ISSUE**，且仓库中无 `intent.md`（新周期 / 新任务的隔离工作区同理）
- 用户首条提问描述了痛点、想法或缺陷
- Stop hook 提示「缺失工件 intent.md」时

## 输入分流边界（v0.12.0）

- **临时任务**（一次性小事）：不属本阶段——周期进行中登记 MCP `quick_task({action:"add"})`，
  无周期直接处理；不写 intent.md
- **补充信息**（对既有周期的澄清/回答）：不重开 intent——融入对应章节

## 做什么

1. **对话式澄清**：把心中的真实疑问整理成 `## Open questions`，逐条**在对话中向发起者
   提出，然后结束回合等待回答**——不自问自答、不替用户假设答案
2. 回答齐备后产出 `intent.md`（用 `templates/intent.md.tpl`），必备章节：
   Problem（发起者原话，禁止翻译成「作为 X 我想 Y」）/ Proposed outcome（可观察结果）/
   Affected users and systems / Constraints / **Open questions**
3. 写入约定工作区 `.sdlc/artifacts/intent.md`（任务隔离模式：任务目录；存量项目根
   目录同名工件就地更新）——**不入版本控制**（PostToolUse 检测到 intent.md 后自动推进 Stage 2）

## 不做什么

- ❌ 修改任何业务代码（本阶段唯一产出是 intent.md）
- ❌ 写正式需求文档 / 用户故事 / 故事点（旧 SDLC 仪式）
- ❌ 改写发起者原话的措辞与语气
- ❌ 省略 Open questions（「没有开放问题」= 过度自信）
- ❌ 把答案塞进 intent.md 却没先在对话里问过用户

## 门禁与治理（hook 强制）

| 机制 | 行为 |
|------|------|
| Open questions 交互门禁（v0.6.0） | intent.md 仍有未回答条目 → 阶段停在 planning/awaiting_answers，Stop/每回合提醒 |
| 解答标记约定 | 已回答条目打 `[x]` / 删除线 / 行尾 `[resolved]`，文件再保存即放行推进 |
| 逃生通道 | MCP `set_stage({stage:"design"})` / `advance`（确需跳过时用，需说明理由） |

## 反模式

- 一次性甩出 20 个问题——Open questions 贵在真实（3-5 个高杠杆问题即可）
- 问题只对开发者有意义（「用什么框架？」）而不对发起者有意义（「这功能给谁用？」）
- 用户还没回答就继续往下做——门禁会拦，但正确姿态本来就不该硬闯
