# {{project.name}} — 当前冲刺（context/current-sprint.md）

> 由 specflow init 生成（{{now}}）。本文件是 WORKFLOW §6.3 定义的运行时上下文，
> 描述当前冲刺的活跃范围；Agent 在阶段推进前应先读取本文件对齐范围。

## 冲刺信息

- 冲刺编号: {{TODO:sprint-编号}}
- 时间窗口: {{TODO:起止日期}}
- 目标（一句话）: {{TODO:本冲刺要交付什么}}

## 活跃工作流

- 主 Agent: default（阶段推进用 `sf.sh workflow advance --agent default`）
- 并行 Agent: {{TODO:如有并行 agent，在此登记 id / 职责 / 负责阶段}}

## 本冲刺标记

> 标记统一用 //TODO#NNN 注释形式写入代码；此处只登记编号与一句话说明。

| 标记 | 说明 | 负责人 / Agent |
|------|------|---------------|
| {{TODO:TODO#NNN}} | {{TODO:一句话说明}} | {{TODO:owner}} |

## 范围外（明确不做）

- {{TODO:列出本冲刺明确不做的事项，防止范围蔓延}}

## 风险与依赖

- {{TODO:外部依赖 / 阻塞项 / 降级预案}}
