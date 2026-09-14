---
description: "多任务隔离管理（新建/切换/清单/关闭）——并行需求的工件与状态隔离"
---

# task — 多任务隔离管理（操作手册）

管理 `.sdlc/tasks/<task-id>/` 隔离工作区。每个任务拥有**独立的**：
- SDLC 状态机（state.json：阶段/门禁/周期计数）
- 工件空间（intent.md / spec.md / plan.md / REVIEW.md 写入任务目录）
- 审计与事件流（hook-audit.json / events.jsonl）
- 注入去重状态（hooks-state.json，跨会话接管自动重置）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——用自然语言表达
> 意图（见下方映射表），agent 调 MCP 工具落地；或注册后用 `/prompts:sdlc-task`
> 调用本手册（v0.13.2 起会话启动时自动注册/刷新，零操作；手动刷新/卸载：
> MCP `register_prompts` 或 sh/ps1 平台脚本）。

## 语义（隔离标准，详见插件 docs/lifecycle.md）

**任务 = 需求级的工件+状态隔离**。并行多个需求时，各自的 intent/spec/plan 互不污染、
阶段判定互不干扰。**代码工作区不隔离**——同仓库多任务建议配合 git 分支（每任务独立分支）。

**会话亲和**：`task_create` / `task_switch` 会把**当前会话**绑定到任务（记录在
`.sdlc/session-map.json`），此后本会话所有 hook 自动路由到该任务。
其他会话默认工作在项目默认空间，不会自动吸附（防污染），需要时显式切换。

## 意图 → 工具映射（agent 侧）

| 用户说（示例） | 工具调用 |
|------|------|
| "并行开个新任务做支付重构" / "给这个新需求开个隔离区" | `mcp__sdlc-orchestrator__task_create({ name: "支付重构" })` |
| "切到任务 payment-refactor" / "现在做 t-02 那个任务" | `task_switch({ task_id: "payment-refactor" })` |
| "现在有哪些任务" / "任务清单" | `task_list()` |
| "支付重构这个任务收尾了" / "关闭任务 t-02" | `task_close({ task_id, archive: true })` |

**说明**：
- `task_create`：任务 id = 名称 slug 化（`Payment Refactor` → `payment-refactor`）；
  新任务立即参与工作流（sdlc_engaged=true），阶段从 planning 开始，并绑定当前会话
- `task_switch`：工件/状态/门禁/审计全部路由过去（id 可用 `task_list` 查询）
- `task_close`：默认归档该任务的周期工件到 `.sdlc/archive/`（**不删除**，不入版本
  控制）；任务目录保留为审计记录（status=closed）；若关闭的是活跃指针任务，指针清空

## 何时用任务 vs 周期

| 场景 | 用法 |
|------|------|
| 并行做多个需求（各自 intent→spec→plan） | 每需求 `task_create({name})` |
| 串行做下一个需求（旧的已完成/部署） | `new_cycle`（归档旧工件重开） |
| 单需求中途需求变更 | `set_stage({ stage: "design" })` 回设计阶段 |

## 治理

- 任务索引：`.sdlc/tasks.json`（agent 禁改，PreToolUse block）
- 会话绑定：`.sdlc/session-map.json`（LRU 200，agent 禁改）
- 所有任务/会话操作写入全局审计（hook-audit.json）
