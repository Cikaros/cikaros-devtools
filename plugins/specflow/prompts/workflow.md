---
description: 管理工作流状态（10 个子命令）
argument-hint: [status|advance|goto <stage>|skip|reset|block|create-agent|delete-agent|list-agents|history]
---
# /workflow — 工作流状态管理

## 输入

用户参数：$ARGUMENTS

- 子命令 + 可选 `--agent <id>`（缺省 `default`）
- 若参数为空：等价 `status`（显示当前 agent 的阶段进度）

## 流程

1. **状态查询**：`sf.sh workflow status --agent default`（default 不存在时
   自动创建，v0.4.0 起）；`list-agents` 看并行 agent
2. **阶段推进**：`advance` 先做产出检查——required 产出缺失 → 返回
   `blocked` 并列出缺失清单（产出声明来自 config.md 的
   `<stage>.outputs` codex:json 块，session-start 已自动导入）
3. **推进成功**：当前阶段 completed；绑定到该 agent 的 created 标记
   自动登记 resolved（`.specflow/todo-resolved.json`，下次扫描生效）
4. **跳转/跳过**：`goto` 检查前置阶段；`skip --force` 跳过当前阶段
   （产出检查一并跳过，慎用）；`reset --force` 重置全流程（先归档）
5. **多 Agent**：`create-agent --id <id> --name <名称>`（上限 5，
   `CODEX_MAX_AGENTS_HARD=1` 时超额硬拒绝）；agent 间并行、阶段内线性

## 标记绑定

- `advance` 成功 → 该 agent 的 created 标记自动 resolved（不手工）
- `block --reason` 登记阻塞原因时，可创建
  `//TODO#NNN unblock: <原因> [agent:<id>]`

## 产出物

- `.specflow/workflow-state/agents/<id>.json`（状态 + history 100 条滚动）
- `.specflow/output-check.json`（最近一次产出检查结果）
- `.specflow/todo-resolved.json`（resolved 登记）

## 反模式（禁止）

- ❌ 用 `skip --force` 逃避产出检查而不留说明
- ❌ 手工编辑 workflow-state JSON（状态机有锁与归档，命令行是唯一入口）
- ❌ 未看 status 就 goto 后置阶段（前置检查会被拒，但别浪费一轮）
- ❌ 单 agent 塞全部工作却创建 5 个空 agent 占位
- ❌ 产出文件造空文件骗过 advance（检查的是存在性，但这是自欺）
