---
description: "临时任务队列（登记/查看/立即处理/完成/放弃）——输入分流：不走 SDLC 流程的临时小事单独处理"
---

# quick — 临时任务队列（操作手册）

管理 `.sdlc/quick-tasks.json` 临时任务队列。**语义（输入分流，详见
`rules/triage.md`）**：用户输入先分类——需求/ISSUE 走 SDLC 流程；补充信息融入
当前周期工件；**临时任务（一次性小事，与当前需求无关）不走流程、不落 SDLC 工件**。

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令，本手册有两种用法——
> ① **自然语言（推荐）**：用户直接说意图，agent 按下表调 MCP 工具；② **官方
> prompts 机制**：注册后用 `/prompts:sdlc-quick` 调用本手册（注册进用户
> prompts 目录的副本）——v0.13.2 起会话启动时自动注册/刷新（零操作；卸载后
> 不再自动恢复），手动刷新/卸载可用 MCP `register_prompts`（跨平台）或 sh/ps1
> 平台脚本。所有队列变更必须经 MCP
> `quick_task` 工具（受控通道，agent 直接编辑队列文件会被 PreToolUse 阻断）。

## 为什么需要队列（不混淆原则）

SDLC 周期进行中（工作区存在 intent/spec/plan）用户提出临时任务时：

- **登记排队，先走完 SDLC 流程，之后再处理临时任务**——二者的产物、工件、
  diff 互不混淆（临时任务的处理内容不得混入当前周期的任何工件或代码改动）
- 周期结束（maintain 闭环、`new_cycle`、`task_close` 后工作区回到干净状态）时，
  插件会自动提醒队列内容，逐条处理即可
- 用户显式要求"现在先处理 X" → `run`（用户优先级最高，但产物仍不混入周期）

无进行中周期时提出的临时任务：**直接处理即可**，无需登记——不写
intent/spec/plan、不触发阶段语义。

## 意图 → 工具映射（agent 侧）

| 用户说（示例） | 工具调用 |
|------|------|
| "记个临时任务：查一下线上超时原因" / "这事排队，先把手头的做完" | `quick_task({action:"add", desc:"查一下线上超时原因"})` |
| "看一下临时任务队列" / "排队的事有哪些" | `quick_task({action:"list"})` |
| "现在马上把 q3 处理了" | `quick_task({action:"run", id:"q3"})` |
| "q3 搞定了" / "排队那条做完了" | `quick_task({action:"done", id:"q3", note:"已查明是网关超时"})` |
| "q3 不要做了" | `quick_task({action:"drop", id:"q3"})` |

**约定**：`add` 时周期进行中→排队（默认）；`run` 仅用于用户显式要求提前处理；
`done`/`drop` 是终态（不可再变更，note 进审计）。

## 分类速查（给用户）

| 你说的话（示例） | 分类 | 去向 |
|------|------|------|
| "加一个导出 CSV 的功能" | 需求/ISSUE | SDLC 流程（intent.md 起步） |
| "用户主要是财务团队，约束是内网部署"（周期进行中） | 补充信息 | 融入当前阶段工件（intent.md/spec.md） |
| "帮我看看这个报错是什么意思" / "把 README 那句话改通顺" | 临时任务 | 周期内排队 / 空闲时直接处理 |
| "先别管流程，现在马上把这个报错查了" | 临时任务（显式提前） | `run` 后立即处理，不落周期工件 |

## 与相近概念的区别

| | 临时任务（quick） | 多任务隔离（task） |
|---|---|---|
| 适用 | 一次性小事，无工件链 | 并行多个**需求**（各自 intent→spec→plan） |
| 状态机 | 简单队列（queued/done） | 完整 SDLC 状态机 + 隔离工作区 |
| 产物 | 无 SDLC 工件 | intent/spec/plan/REVIEW + 门禁 |
| 存储 | `.sdlc/quick-tasks.json`（全局） | `.sdlc/tasks/<id>/`（隔离区） |
| 操作 | `quick_task` 工具 | `task_create` / `task_switch` / `task_close` 工具 |

## 治理

- 队列文件是插件运行时状态：agent 直接编辑会被 PreToolUse 阻断（block），
  只能经 MCP `quick_task` 工具受控修改；用户可在编辑器中直接改
- 登记与状态变更写入 `events.jsonl`（quick_task_added / quick_task_updated）
- 队列上限 100 条，超出后最旧的已完成/已放弃条目被裁剪（排队中条目永不丢）
- 提醒时机：SessionStart（会话恢复）、UserPromptSubmit（每回合）、Stop
  （回合结束）——队列非空时自动注入对应提示
