---
name: sdlc-maintain
description: >-
  SDLC Stage 6 Maintain（闭环监控）技能。何时使用：PR 已合并（state.last_deployed_at 已置位）、
  监控指标突破控制带（bands.yaml）、或生产事件需要转化为新意图时。职责：确定性监控触发
  Codex 写出新 intent.md 闭环回 Stage 1；本阶段不直接修复生产问题；每个事件为持续评估套件
  添加一个评估。临时任务此时可统一处理（周期已归档，队列由 hooks 自动提醒）。
---

# sdlc-maintain — Stage 6: Maintain 技能

> 权威规则：`rules/stage-maintain.md`（本技能是其可执行摘要）；输入分流标准：`rules/triage.md`；
> 操作手册：`prompts/maintain.md`（自然语言进入本阶段；v0.13.0 起无 slash 命令）。

## 何时触发

- `state.last_deployed_at` 已设置 + 当前分支为 main + 无未提交 diff
- 监控检测脚本报告指标突破控制带（`bands.yaml` 配置的 1σ/2σ/3σ 响应级别）
- 生产事件（incident）复盘，需要转化为新工作项

## 输入分流边界（v0.12.0）

- 周期闭环归档后工作区回到干净状态——**临时任务队列此时可统一处理**（hooks 会提醒；
  `quick_task({action:"list"})` 查看，逐条 run→done）；处理完再开启下一个 intent 周期
- 新周期开始后新提出的临时任务继续排队，不因周期切换丢失（队列是全局的）

## 做什么

1. **产出新 `intent.md`**（闭环关键）：把事件/指标异常以发起者视角写成意图，
   走完整管道回 Stage 1——旧周期工件由 hook 自动归档轮转（默认 `.sdlc/archive/`，
   不入版本控制；需要 PR 可审查归档链时显式选 `docs/sdlc/archive/`），
   也可以 MCP `new_cycle` 显式开新周期
2. **维护确定性监控**：检测脚本无模型参与、进版本控制、有单元测试；
   响应级别边界由 `bands.yaml` 强制（templates/bands.yaml.tpl 起步）
3. **每个事件添加评估**到持续评估套件（`templates/evals.json.tpl`）——
   事件驱动的回归用例是套件增长的主要来源
4. 前端用户可见的故障（页面白屏/核心流程阻断）：新周期的 E2E 用例
   （frontend-e2e 技能）应覆盖该故障场景，防再现

## 不做什么

- ❌ 直接修复生产问题（Stage 6 的产物是新 intent.md，走完整管道——
  「本阶段不直接修复」是第一硬约束）
- ❌ 监控脚本里掺入模型调用（确定性 = 同输入必同输出，可测试）
- ❌ 事件复盘只写报告不留评估——没有回归用例的事件还会再来一次

## 反模式

- 跳过管道在生产上热修——审计链断裂，且热修本身没有测试证据
- bands.yaml 阈值拍脑袋不校准（western electric 规则要配 rolling baseline）
- 把 Maintain 当「终态」——它是闭环回到 Planning 的枢纽，不是结束
