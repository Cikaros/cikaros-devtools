# 团队名册（context/team-roster.yaml）
# 由 specflow init 生成。vars.yaml 解析器支持两层读取（全局 ~/.codex-plugin/vars.yaml
# 与项目 .specflow/vars.yaml）；本文件可作为团队基线的录入模板。
# 被 {{user.xxx}} 变量引用（如 {{user.tech_lead}}）。

sprint:
  current: "{{TODO:冲刺编号}}"
  ends_at: "{{TODO:截止日期}}"

members:
  - id: "{{TODO:成员标识，如 zhangsan}}"
    name: "{{TODO:姓名}}"
    role: "{{TODO:角色，如 backend / frontend / qa}}"
    agent: "{{TODO:绑定的 workflow agent id，缺省 default}}"

review:
  required_roles: ["{{TODO:评审必须覆盖的角色}}"]
  min_approvers: {{TODO:最小评审人数}}
  escalation: "{{TODO:找不到评审人时的升级路径}}"

conventions:
  working_hours: "{{TODO:协作时区 / 工作时间}}"
  standup: "{{TODO:每日同步方式与时间}}"
