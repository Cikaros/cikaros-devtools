# Stage 6 — Maintain Rules

> 触发条件：`state.last_deployed_at` 已设置 + 当前分支为 main + 无未提交 diff。
> 产物：新 `intent.md`（闭环关键，回到 Stage 1: Planning）。

## 硬约束

1. **本阶段不直接修复生产问题**——产物是新 `intent.md`，走完整管道。
2. **监控必须确定性**——检测脚本无模型参与，版本控制 + 单元测试。
3. **级别边界由配置强制**——bands.yaml 定义响应级别，权限和管理设置拒绝生产访问。
4. **每个事件添加评估**——修复发布时，为事件添加评估到持续评估套件。

## 闭环节奏配置（bands.yaml）

```yaml
metric: ci_test_failure_rate   # 或: post_deploy_5xx_rate, pr_cycle_time
baseline: rolling_30d
rules: western_electric
tiers:
  1sigma:
    action: log
  2sigma:
    action: diagnose
    tools: "Read,Grep,Bash(gh run view *)"
  3sigma:
    action: propose
    routes:
      - pull_request
      - runbook:rollback-deploy
```

### 响应级别

- **1σ**：仅记录日志
- **2σ**：调用 Codex 只读诊断（Read / Grep / Bash(gh run view *)）
- **3σ**：Codex 可能采取行动——开 PR 进入审查门 / 触发预批准的运行手册

### 触发层

- GitHub 或 GitLab 中的计划工作流
- 现有监控堆栈的 webhook
- 网络内部的 Cron 任务

### 无状态运行

- Codex 以无状态方式运行
- CI 运行器上的非交互式步骤 / 沙盒容器中的 Agent SDK 服务
- 一个循环可以开始和结束而无需任何人启动它

## 诊断规则（2σ 触发）

- **只读工具**：Read / Grep / Bash(gh run view *)
- **不要直接修复**——本阶段产物是新 `intent.md`
- 读取受影响系统的代码、近期部署日志、CI 历史

## intent.md（闭环关键）

```markdown
# Intent: <anomaly-summary>
Author: ai-sdlc-monitor. Status: draft.

## Problem
<anomaly description + evidence: metrics, logs, timestamps>

## Proposed outcome
<suggested outcome: fix / rollback / document>

## Affected users and systems
<list>

## Constraints
<e.g., must not affect production traffic during business hours>

## Open questions
<e.g., is this a regression from the last deploy or a long-running issue?>
```

提交后，PostToolUse hook 检测 `intent.md` 创建，推进到 Stage 1: Planning，`state.cycle_count` 自增。

## 分诊队列规则

服务所有者或值班工程师对队列进行分诊：

- **面向产品的发现** → 路由到产品负责人
- **立即修复** → 安排计划
- **驳回（噪音）** → 调整频段，减少噪音

驳回有助于调整频段并减少噪音。

## 定期代码库扫描（安全）

- **托管安全扫描**（托管形式）：连接 GitHub 仓库，扫描在 Anthropic 基础设施中的 云端模型 上运行
- **每个发现经过验证并附带置信度评分**，在报告前
- **建议的补丁**：在 Codex 云端界面 上审查和应用，通过 PR 审查门
- **更大的问题**（架构弱点、跨服务重复模式）：写成 `intent.md`，从 Stage 1 开始
- **覆盖范围**从上次运行开始计算，不是从第一次开始

### 扫描频率

- 积极开发的服务：每周
- 大型或混合存储库：范围扫描到目录或分支

### 处理发现

- 参考置信评级处理
- 给出拒绝理由（记录拒绝原因，相同发现不会作为新发现返回）
- 有边界的发现 → 在 Codex 云端界面 中打开建议的补丁 → 审查 → 通过 PR 审查门发送
- 超出一个补丁范围的问题 → 写成 `intent.md` → Stage 1: Planning

## On-call with Codex 代理集成

- Codex 是事件频道的成员，以其自己的身份存在
- 每个新事件得到第一响应者
- 对话和机构知识保留在频道中
- 任何人都可以指导和执行响应，频道历史记录辅助
- Codex 写事后分析到版本控制的 lessons 文件

### 处理范围

- 小型、范围明确的修复 → PR 通过审查门提交
- 较大的问题 → `intent.md` → Stage 1: Planning
- 循环开始自我驱动

## 治理

- **级别边界**通过版本控制的配置强制执行（bands.yaml）
- **权限和管理设置**拒绝生产访问
- **调用、发现和分诊决策**都会记录时间戳
- **服务所有者**对发现进行分诊和批准
- **结果变更**通过正常的 PR 审查门
- **代理可能触发的运行手册**已预先批准
- **领先指标**：从安全漏洞发生到 triage 队列中的 `intent.md` 所需时间。
- **滞后指标**：成为合并修复的发现比例；同类事件的重复发生（应随着修复为评估套件添加用例而减少）。

## 反模式

- ❌ 让 Codex 直接修复生产问题而不走 intent.md → PR 门——绕过审查。
- ❌ 没有 bands.yaml 就监控——没有分级响应，每个异常都变成事件。
- ❌ 修复后不加评估——同样的问题会复发。
- ❌ 把驳回当作失败——它们是调频的信号。
- ❌ 把扫描当作事件（发布/审计触发）而不是按计划——代码和模型都会漂移。
