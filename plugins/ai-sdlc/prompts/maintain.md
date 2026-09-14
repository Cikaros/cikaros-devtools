---
description: "Stage 6 Maintain — 闭环节奏：监控触发 → 诊断 → 写新 intent.md → 回到 Stage 1"
---

# maintain — Stage 6: Maintain（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——本手册是按需
> 读取的操作指引：用户自然语言表达意图（手册正文即执行步骤），agent 直接执行；
> 需要状态变更时调 MCP `mcp__sdlc-orchestrator__` 工具。偏好显式调用可把
> 手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用：v0.13.2 起
> 会话启动时自动注册/刷新（零操作，无需任何指令；卸载后不再自动恢复）；手动
> 刷新/卸载：MCP `register_prompts`（跨平台）或 sh/ps1 平台脚本（误跑不匹配
> 平台的脚本会被 PreToolUse 跨平台护栏拦截并给出替代）。


你正在执行 **AI-Native SDLC Stage 6: Maintain**。循环关闭：一个触发器调用 Codex，发现的内容重新进入管道作为 `intent.md`，调用路径中没有人员。

## 前置条件

- Stage 5 已完成（PR 已合并到 main，`state.last_deployed_at` 已设置）
- 已配置监控触发器（`.sdlc/bands.yaml`，参考模板 `templates/bands.yaml.tpl`）

## 执行步骤

1. **监控触发**（由外部确定性脚本调用，非本会话）：
   - 检测脚本查询指标存储（Prometheus / CI API / 等效方案）
   - 滚动窗口内均值 + 标准差，西方电气法或类似规则
   - 1σ → 仅记录日志；2σ → 调用 Codex 只读诊断；3σ → Codex 可能采取行动（开 PR / 触发预批准运行手册）
2. **诊断**（2σ 触发时）：
   - 读取受影响系统的代码、近期部署日志、CI 历史
   - 用 `Read, Grep, Bash(gh run view *)` 等只读工具
   - **不要直接修复**——本阶段产物是新 `intent.md`
3. **写 intent.md（闭环关键）**：
   - 读 `templates/intent.md.tpl`
   - `Author: ai-sdlc-monitor` / `Status: draft`
   - `## Problem`：异常及其证据（指标、日志、时间戳）
   - `## Proposed outcome`：建议结果（修复 / 回滚 / 文档化）
   - `## Affected users and systems`
   - `## Constraints`
   - `## Open questions`
4. **写入工作区**：默认 `.sdlc/artifacts/intent.md`（任务隔离模式：`.sdlc/tasks/<id>/intent.md`）。无需 git 提交——工作区不入版本控制；旧周期工件由 PostToolUse hook 自动归档到 `.sdlc/archive/`，新 intent 保留为下一周期起点。
5. **PostToolUse hook 自动检测 intent.md 创建**：推进到 Stage 1 Planning（如果是 maintain→planning 闭环，`state.cycle_count` 自增）
6. **分诊队列**：服务所有者或值班工程师对队列进行分诊：
   - 面向产品的发现 → 路由到产品负责人
   - 立即修复 → 安排计划
   - 驳回（噪音）→ 调整频段，减少噪音
7. **添加评估**：当修复发布时，为事件添加评估（持续评估流程），确保此类问题在未来得到保护。

## 闭环节奏配置（bands.yaml 示例）

```yaml
metric: ci_test_failure_rate
baseline: rolling_30d
rules: western_electric
tiers:
  1sigma: { action: log }
  2sigma:
    action: diagnose
    tools: "Read,Grep,Bash(gh run view *)"
  3sigma:
    action: propose
    routes:
      - pull_request
      - runbook:rollback-deploy
```

## 治理

- 级别边界通过版本控制的配置强制执行
- 权限和管理设置拒绝生产访问
- 调用、发现和分诊决策都会记录时间戳
- 服务所有者对发现进行分诊和批准
- 结果变更会通过正常的 PR 审查门
- 代理可能触发的运行手册已预先批准

## 完成判定

- 新 `intent.md` 已创建并提交
- `state.cycle_count` 自增
- 自动回到 Stage 1: Planning（PostToolUse hook 推进）
