# Agent 配置目录（.specflow/agents/）

每个 Agent 一份配置：`<id>.md`（如 `backend.md`、`frontend.md`、`docs.md`）。

## 作用（WORKFLOW §6.3）

`sf.sh workflow create-agent --id <id>` 创建同名 agent 时读取本目录的
`<id>.md`，取其 frontmatter（agent_id / agent_name）与「启用阶段」勾选项
作为阶段清单；「语言栈」决定该 agent 的语言规范加载。

## 模板

```markdown
---
agent_id: backend
agent_name: 后端开发
---

# backend Agent 配置

## 启用阶段

- [x] 需求分析
- [x] 架构设计
- [x] 编码实现
- [x] 代码评审
- [x] 测试验证

## 语言栈

- (x) TypeScript
- ( ) Python

## 模块范围

- src/auth/
- src/payment/
```

> 阶段名与勾选状态由 workflow-state 解析（需求分析=req-analysis、
> 架构设计=arch-design、编码实现=coding、代码评审=review、测试验证=testing）。
