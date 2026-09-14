# 闭环节奏配置（bands.yaml）模板
#
# 用于 Stage 6: Maintain。确定性监控脚本读取此配置，按控制带违规调用 Codex。
# 监控脚本版本控制 + 单元测试，检测过程无模型参与。

metric: ci_test_failure_rate   # 选项：ci_test_failure_rate / post_deploy_5xx_rate / pr_cycle_time / custom
baseline: rolling_30d           # 选项：rolling_7d / rolling_30d / rolling_90d
rules: western_electric         # 选项：western_electric / nelson / simple_stddev

tiers:
  # 1σ：仅记录日志（噪音水平）
  1sigma:
    action: log
    # 不调用 Codex，仅写日志和事件流

  # 2σ：调用 Codex 只读诊断
  2sigma:
    action: diagnose
    tools: "Read,Grep,Bash(gh run view *),Bash(git log *)"
    # Codex 读取代码、CI 历史、部署日志
    # 产物：intent.md（不直接修复）

  # 3σ：Codex 可能采取行动
  3sigma:
    action: propose
    routes:
      - pull_request           # 开 PR 进入审查门
      - runbook:rollback-deploy # 触发预批准的回滚运行手册
    # 仍需通过 PR 审查门 / 预批准运行手册
    # 不直接修改生产

# 触发层配置
trigger:
  type: schedule                # 选项：schedule / webhook / cron
  schedule: "*/15 * * * *"      # 每 15 分钟检查一次

# 调用 Codex 的方式
codex_invocation:
  mode: non_interactive         # 非交互式（codex exec 或 Agent SDK）
  sandbox: true                 # 沙盒化执行
  credentials: scoped           # 短期有效作用域令牌，无生产凭证

# 推进规则
advancement:
  # intent.md 提交后 PostToolUse hook 自动推进到 Stage 1: Planning
  # state.cycle_count 自增
  auto_advance: true
  # 分诊队列：服务所有者或值班工程师
  triage_owner: oncall

# 治理
governance:
  # 级别边界通过版本控制的配置强制执行
  config_versioned: true
  # 权限和管理设置拒绝生产访问
  deny_production: true
  # 调用、发现和分诊决策都会记录时间戳
  timestamp_all: true
  # 代理可能触发的运行手册已预先批准
  pre_approved_runbooks:
    - rollback-deploy
    - restart-service
