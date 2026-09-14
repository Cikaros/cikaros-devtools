---
description: 多 Agent 并行编排（创建/查看/删除 agent）
argument-hint: [list|create <id> <name>|delete <id>|switch <id>]
---
# /agent — 多 Agent 管理

## 输入

用户参数：$ARGUMENTS

- 子命令：`list` / `create <id> <name>` / `delete <id> --confirm` /
  `switch <id>`（切换后续命令的默认 agent）
- 若参数为空：显示 agent 清单与各自当前阶段

## 流程

1. **查看**：`sf.sh workflow list-agents`；并行拓扑示例见
   docs/requirements/WORKFLOW.md §6.1（frontend / backend / qa 三 agent）
2. **创建**：`sf.sh workflow create-agent --id backend --name "后端 Agent"`
   ——新 agent 从 req-analysis 起 in_progress；上限 5 个
   （`CODEX_MAX_AGENTS` 调整，`CODEX_MAX_AGENTS_HARD=1` 硬拒绝）
3. **绑定标记**：把工作分给某 agent 时，对应代码标记写
   `[agent:backend]`——todo-scanner 的 by_agent 分桶与 resolved
   自动判定都按这个绑定走
4. **删除**：`delete-agent --id <id> --confirm`——状态先归档到
   `.specflow/archive/workflow-state/`，可恢复
5. **切换**：后续 `/workflow`、`/coding` 等命令带 `--agent <id>`

## 标记绑定

- 分工即绑定：`[agent:<id>]` 元数据是 agent ↔ 标记的唯一关联
- 某 agent `advance` 成功 → 只有**它名下**的 created 标记 resolved

## 产出物

- `.specflow/workflow-state/agents/<id>.json`（每 agent 一份）
- `.specflow/workflow-state/global.json`（agent 注册表与共享产出）

## 反模式（禁止）

- ❌ 所有标记都不带 `[agent:]`（全落 default 桶，并行分形同虚设）
- ❌ 一个标记写两个 agent（元数据只认第一个）
- ❌ 删除 agent 前不确认它名下无未 resolve 的标记
- ❌ > 5 agent（上限是防止状态文件与上下文失控）
- ❌ agent 命名用中文/空格（id 限 `[A-Za-z0-9_\-.]`）
