# Review Policy（REVIEW.md 模板说明）

> 本文件描述 AI 自审 PR 时遵循的策略。技术负责人在仓库根目录编写 `REVIEW.md`。

## Passes

三趟扫描，每个发现标记其所属 pass：

- **Bugs**：逻辑错误、损坏的边界情况、微妙的回归
- **Security**：注入风险、认证缺口、PII 出现在日志
- **Compliance**：变更是否匹配 `spec.md`、`plan.md` 和设计原则

## What Important means here

仅将 Important 留给会破坏行为、泄露数据或违反政策的发现。风格和命名是 nits。

## Cap the nits

每个 review 最多报告 5 个 nits，其余汇总为计数。这防止 nit 爆炸淹没重要发现。

## Do not report

- `src/gen/` 下的生成文件
- CI 已强制的检查（lint 规则、类型检查等）

## 反馈循环

- 当审查第二次标记相同错误时，把修正内容添加到 `AGENTS.md`
- 审查会读取 `AGENTS.md`，错误会在后续 PR 中被捕获
- 审查还应标记何时更改导致 `AGENTS.md` 过时

## 月度调整

每月技术负责人通过评分发现来调整设置：

- 调整 REVIEW.md 限制 Nit 数量
- 排除已由 CI 强制的内容
- 排除生成路径

## 治理

- 审查策略适用于所有 PR
- 发现、修复、评分和批准都记录在 PR 历史中
- PR 是审计记录
- 批准来自通过分支保护机制的人类，并参考了发现结果
