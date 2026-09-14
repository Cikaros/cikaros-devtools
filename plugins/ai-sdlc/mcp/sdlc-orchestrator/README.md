# sdlc-orchestrator MCP Server

> ai-sdlc 插件的 SDLC 编排 MCP server（零依赖 JS，无需构建，stdio JSON-RPC，
> 行长护栏 1 MiB）。
>
> 状态机由 6 个 Codex 生命周期 hook 自动驱动；本 server 提供**手动控制与查询**
> 入口（排障、显式接受、人工关卡授权、生命周期管理、输入分流临时任务队列），
> 共 23 个工具（v0.12.0 +`quick_task`；v0.13.1 +`register_prompts`，v0.13.2
> 起日常注册由 SessionStart 自动完成，本工具为显式通道）。

## 启动链（v0.13.3）

本 server 由插件 `.mcp.json` 的 `node -e` 内联 bootstrap 拉起——四级解析链自定位插件根：`SDLC_PLUGIN_ROOT` env > `.sdlc/mcp-launcher.json` 指针（SessionStart 写入，防投毒校验）> `CODEX_HOME/plugins` 两层扫描 > cwd。背景：Codex 以用户启动目录为 MCP 子进程 cwd，相对路径 args 在真实安装下 ENOENT（openai/codex#19582/#22842）。诊断：`SDLC_BOOTSTRAP_PROBE=1` 输出解析结果。

## 工具清单

### 查询类

- **`status({ task_id? })`** — 当前 SDLC 阶段、工件清单、缺失项、门禁状态、
  闭环次数、`scope_binding`（路由来源诊断）与 `test_gate`（失败历史/轮次/循环状态）
  诊断段：

```json
{
  "stage": "design",
  "stage_name": "Stage 2 — Design",
  "confidence": "high",
  "source": "intent+no-spec",
  "artifacts": {
    "intent.md": "intent.md",
    "spec.md": null,
    "plan.md": null,
    "REVIEW.md": null,
    "AGENTS.md": "CLAUDE.md"
  },
  "gates": {
    "plan_accepted": false, "test_pass": false, "release_approval": false,
    "in_fix_mode": false, "change_ticket": null
  },
  "cycle_count": 0,
  "next_stage": "build_plan"
}
```

> `AGENTS.md` 取值为实际命中的文件名；`CLAUDE.md` 为遗留兼容候选。

- **`workflow({ task_id? })`** — 6 阶段全景图与当前进度（done | current | pending）
- **`audit({ limit? })`** — 最近 N 条 hook 审计（默认 20，上限 100）
- **`events({ limit? })`** — 最近 N 条事件流（默认 20，上限 100）

### 控制类

- **`advance({ from, force? })`** — 强制推进到下一阶段；默认做产出检查（缺失工件
  失败），`force: true` 跳过
- **`reset({ keep_history? })`** — 重置状态到 planning（默认保留 artifact_history
  与 cycle_count；`sdlc_engaged` 同步清除——硬门禁降级回 warn 的逃生通道）
- **`refresh()`** — 强制重新检测当前阶段（从工件存在性推导）

### 阶段接受类（人工关卡）

- **`accept_plan()`** — 工程师显式接受 plan.md（置 `plan_accepted`；当前在
  build_plan 时即时推进到 Stage 3b，其后任意 PostToolUse 也会推进）
- **`set_fix_mode({ enabled })`** — 进入/退出修复模式（修复期 PreToolUse 阻止
  编辑测试文件）
- **`approve_release({ approver })`** — 发布管理员授权生产部署（记录接受者）
- **`set_change_ticket({ ticket_id })`** — 设置变更工单号（Stage 5 编辑迁移/
  基础设施文件需要）
- **`self_review()`** — AI 自审 PR（按 REVIEW.md 策略；返回三趟扫描指令与工件路径）

### 生命周期类（详见插件 docs/lifecycle.md）

- **`new_cycle({ archive_dir?, keep_history? })`** — 开启新迭代周期：归档当前周期
  工件（**移动而非删除**）到 `.sdlc/archive/<cycle-id>/`（默认，不入版本控制；
  可传 `docs/sdlc/archive` 迁回仓库内获得 PR 可审查的归档链），状态机重置
  planning、cycle_count+1、engagement 保持。**与 reset 的区别**：reset 不清
  旧工件（重置后阶段检测被旧工件污染），new_cycle 才是新需求/迭代的正确入口
- **`cycle_list()`** — 周期归档历史（`.sdlc/cycles.json`，最近 200 条）
- **`set_stage({ stage, note? })`** — 受控阶段回退/钉住（需求变更回 design）；
  override 在下一次推进时自动解除
- **`task_create({ name, note? })`** — 创建隔离任务工作区 `.sdlc/tasks/<id>/`
  （独立状态机/工件空间/审计流）。会话隔离：本进程已绑定会话时（默认）新任务
  只绑定该会话，**全局活跃指针不变**
- **`task_switch({ task_id, global? })`** — 切换任务上下文；已绑定会话时默认只切
  **会话绑定**，`global: true` 才切全局活跃指针（CI/无会话场景默认即全局）
- **`task_list()`** — 任务清单（含状态、周期数、活跃指针）
- **`task_close({ task_id, archive?, archive_dir? })`** — 关闭任务（默认归档工件到
  `.sdlc/archive/`，不入版本控制；任务目录保留为审计记录）

### 输入分流（v0.12.0，详见 rules/triage.md 与 docs/lifecycle.md §2.8）

- **`quick_task({ action, desc?, id?, note? })`** — 临时任务队列受控操作（与
  quick_task 是唯一受控入口；队列全局存于 `.sdlc/quick-tasks.json`，agent 直接
  编辑该文件会被 PreToolUse 阻断）：
  - `add { desc }` — 登记一条临时任务。周期进行中 → 排队（**周期走完后统一
    处理，处理内容不得混入当前周期工件或 diff**）；无进行中周期 → 登记后即可
    直接处理
  - `list` — 队列视图（in_progress → queued → 终态；含 queued_count）
  - `run { id }` — 标记立即处理（用户显式授权提前；仍不走 SDLC 流程、不落
    周期工件）
  - `done { id, note? }` / `drop { id, note? }` — 完成 / 放弃（终态，附审计备注）
  - 语义边界：**补充信息**（如 Open questions 的回答）不经队列——直接融入
    当前阶段工件；改变交付物的输入是需求/ISSUE——走 SDLC 流程

### 官方 /prompts: 手册注册（v0.13.1 跨平台；v0.13.2 起零操作自动注册）

- **日常已自动化**：SessionStart 每会话调 `common.ensurePromptsRegistered`
  自检——未注册/升版 → 自动差量刷新（只写 `sdlc-*`，不碰用户其他
  prompts）；已注册且无变化 → 静默跳过。**opt-out**：显式卸载写
  `.sdlc-prompts-optout` 标记（不再自动恢复）；重新注册清除标记；
  `SDLC_PROMPTS_AUTO=off` 总关。自动动作进审计 `detail.prompts_auto` 与
  事件流 `prompts_auto_registered`
- **`register_prompts({ action?, dir? })`** — 显式通道（强制刷新 / 自定义
  目录 / 卸载）：把插件 prompts/ 下全部操作手册（动态扫描，当前 18 份）
  注册到用户 prompts 目录，启用官方 `/prompts:sdlc-<名>` 调用形式
  （Node fs，经 ESM 桥复用 hooks/scripts/lib/ 模块群——prompts.mjs 单一事实源，common.mjs 桶导出）——
  bash 脚本（install-prompts.sh）与 PowerShell 脚本
  （install-prompts.ps1）是等价的平台便利品，语义完全同源（误在无 bash
  的 Windows / 无 pwsh 的 macOS 上跑脚本会被 PreToolUse 跨平台护栏拦截）
  - `register`（默认）— 安装/刷新（幂等，覆盖同名；清除 opt-out 标记恢
    复自动注册）。返回注册份数、目标目录与调用示例
  - `remove` — 卸载（只删本插件注册的 `sdlc-<名>.md`，用户其他 prompts
    不受影响；写 opt-out 标记，不再自动恢复）
  - `list` — 注册状态（已注册清单 / total / complete）
  - `dir` 可选：自定义目标目录（默认 `~/.codex/prompts`，`SDLC_PROMPTS_DIR`
    环境变量可覆盖——测试/自定义场景）
  - 事件留痕：`prompts_registered` / `prompts_removed` 写入会话项目
    `.sdlc/events.jsonl`（审计可溯）
  - 用户侧触发：自然语言（「刷新操作手册到最新版」「把手册注册到 prompts
    目录」「卸载 prompts 手册」「看注册状态」）

### 会话与循环管理

- **`loop_resolve({ decision, note?, task_id? })`** — 修复循环中断决策（与
  loop_resolve 工具）。触发背景：同一失败签名在最近窗口内重复
  （A→A / A→B→A，含跨周期）或同周期连续失败轮次超限（默认 3）→ `state.fix_loop`
  置位并阻断业务代码写入，直到用户决策：
  - `retry` — 轮次计数重置再修一轮（同失败再现立即再次中断）
  - `new-intent` — 归档当前周期（cycle+1），失败作为 incident 进下一个 intent 迭代
  - `manual` — 用户接管修复，agent 转只读协助
  - `escalate` — 记录升级决策，汇总证据呈报更高层

  测试真实通过会自动解除中断（`fix_loop_cleared` 事件）。
- **`session_scope({ action?, session_id? })`** — 本 MCP 进程的会话身份诊断与纠正：
  `show`（默认）查看绑定状态与路由来源；`bind` + `session_id` 纠正进程-会话配对；
  `unbind` 回退全局活跃指针路由。

> **会话路由背景**：每个 Codex 会话 spawn 独立 MCP 进程，首次工具调用自动认领
> SessionStart hook 写入的会话票据（`.sdlc/mcp-bind-queue/`，FIFO 原子认领），
> 此后按该会话的 session-map 绑定路由——多会话互不踩踏。所有工具均接受可选
> `task_id` 参数显式路由（最高优先）。

## 使用示例

```
# 开始新会话，查看当前进度
mcp__sdlc-orchestrator__status()

# 工程师审查 plan.md 后接受（hook 自动推进 Stage 3b）
mcp__sdlc-orchestrator__accept_plan()

# 进入 bug 修复模式（PreToolUse 阻止编辑测试文件；完成后退出）
mcp__sdlc-orchestrator__set_fix_mode({ enabled: true })
mcp__sdlc-orchestrator__set_fix_mode({ enabled: false })

# 生产部署授权（发布管理员）
mcp__sdlc-orchestrator__approve_release({ approver: "alice@example.com" })

# 旧需求已交付，开始新需求（正确入口；不要用 reset 迭代）
mcp__sdlc-orchestrator__new_cycle()

# 并行两个需求（多任务隔离）
mcp__sdlc-orchestrator__task_create({ name: "payment-refactor" })

# 状态出错后重置
mcp__sdlc-orchestrator__reset({ keep_history: true })
mcp__sdlc-orchestrator__refresh()
mcp__sdlc-orchestrator__status()
```

## 治理

- 所有控制类工具调用写入 `.sdlc/events.jsonl` 与 `.sdlc/hook-audit.json`
- 接受类操作（accept_plan / approve_release）记录接受者身份与时间戳
- 重置操作保留审计追踪（事件流不重置）
