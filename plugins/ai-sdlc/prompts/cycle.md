---
description: "开启新迭代周期：归档当前周期工件（不删除）→ 重置阶段机 → cycle+1"
---

# cycle — 开启新需求周期（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——自然语言说
> "开个新周期 / 旧需求收尾，开始下一轮迭代"，agent 调 MCP `new_cycle` 落地；
> 或注册后用 `/prompts:sdlc-cycle` 调用本手册（v0.13.2 起会话启动时自动
> 注册/刷新，零操作；手动刷新/卸载：MCP `register_prompts` 或 sh/ps1 平台
> 脚本）。

把当前周期的工件归档并重置阶段机，开始下一轮需求迭代。

## 与 reset 的区别（重要）

| | new_cycle（开新周期） | reset（重置退出） |
|---|---|---|
| 语义 | **迭代延续**：旧周期收尾归档，新周期开始 | **完整退出**：清空运行时状态 |
| 旧工件（intent/spec/plan/REVIEW） | **归档**（移动到 `.sdlc/archive/<cycle-id>/`，不删除；不入版本控制） | **原地不动**（重置后阶段检测会再次看到旧工件） |
| workflow engagement（sdlc_engaged） | 保持 true（门禁持续生效） | 清为 false（门禁降级回 warn） |
| cycle_count | +1（周期计数递增） | 清零（keep_history=false 时） |
| 适用 | 旧需求已交付，开始新需求/下一轮迭代 | 状态损坏/换人接手/彻底停用工作流 |

**为什么 reset 后"新需求"会被旧工件污染**：阶段检测是工件驱动的——只要根目录
还有旧的 intent.md + spec.md + plan.md，检测器就会把阶段判到 build/deploy 附近，
新 intent 无从产生。归档轮转（new_cycle）才是"反复迭代"的正确入口。

## 执行（MCP 工具）

用户自然语言（如"开新周期"）→ agent 调用：

```
mcp__sdlc-orchestrator__new_cycle({ archive_dir: ".sdlc/archive" })
```

可选参数 `archive_dir`：需要 PR 可审查的仓库内归档链时传 `docs/sdlc/archive`。

## 归档行为

1. 收集当前 scope（任务隔离区或项目工作区）的 intent.md / spec.md / plan.md / REVIEW.md
2. 移动到 `<archive_dir>/cycle-<NNN>-<时间戳>/`（默认 `.sdlc/archive/`，不入版本控制；
   需要归档链可 PR 审查时显式传 `docs/sdlc/archive`）
   - 目录内附 `cycle-meta.json`：周期号、关闭时间、最终阶段、工件清单、原因
3. 全局索引 `.sdlc/cycles.json` 追加条目（保留最近 200 条）
4. 状态机重置：阶段 → planning，门禁全清，cycle_count+1，cycle_id 更新
5. **不删除任何文件**；工件留工作区/归档区（均不入版本控制），无需 git 操作

## Maintain 阶段的自动闭环

Stage 6 控制带突破时（bands.yaml 触发），agent 写出**新的 intent.md** 即自动完成
闭环：旧周期的 spec/plan/REVIEW 由 PostToolUse hook 自动归档，新 intent 保留为
下一周期起点，阶段回到 planning。无需手工调用本工具。

## 治理

- 周期归档是审计链的一部分：归档目录内容修改会触发 PreToolUse warn
- 查询归档历史：`mcp__sdlc-orchestrator__cycle_list`
- `cycle_count` = 已完成周期数；`cycle_id` = 当前活动周期标识
