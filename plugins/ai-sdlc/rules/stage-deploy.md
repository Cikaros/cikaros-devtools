# Stage 5 — Deploy Rules

> 触发条件：`state.test_pass = true` + 当前分支非 main + git 有 diff。
> 产物：PR 合并到 main（`state.last_deployed_at`）。

## 硬约束（PreToolUse hook 强制）

1. **生产部署需发布授权**：Bash 命令含 `deploy` + `production` 时检查 `state.release_approval`，未授权 → hook 阻止。
2. **修改迁移/基础设施文件需变更工单**：Stage 5 编辑 `migrations/` / `terraform/` / `*.sql` / `*.tf` 时检查 `state.change_ticket`，未设置 → hook 阻止。
3. **受保护文件编辑触发警告**：`AGENTS.md` / `REVIEW.md` / `.sdlc/state.json`。

## PR 创建规则

PR body 必须包含完整审计追踪：

```markdown
## Intent
<reference intent.md commit>

## Spec
<reference spec.md commit>

## Plan
<reference plan.md commit>

## Diff vs plan
<state whether implementation matches plan; if deviated, reference updated plan.md>

## Test evidence
<paste make test / make lint output>
```

## AI 自审规则（按 REVIEW.md 策略）

### 三趟扫描

1. **Bugs**：逻辑错误、损坏的边界情况、微妙的回归
2. **Security**：注入风险、认证缺口、PII 出现在日志
3. **Compliance**：变更是否匹配 `spec.md`、`plan.md` 和设计原则

### 严重程度

- **Important**：会破坏行为、泄露数据或违反政策的发现
- **Nit**：风格、命名等小问题（每个 review 最多 5 个，其余汇总为计数）
- **Info**：建议但不阻塞

### 不报告

- `src/gen/` 下的生成文件
- CI 已强制的检查（如 lint 规则）

### 反馈到 AGENTS.md

当审查第二次标记相同错误时，把修正内容添加到 `AGENTS.md`——因为审查会读取 AGENTS.md，错误会在后续 PR 中被捕获。

## 处理审查评论

- 当审查者或作者在评论中标记 `@codex`：
  - 处理该评论
  - 提交修复（新 commit 到同一分支）
  - PR 线索记录请求和变更
- 对于 Codex 打开的 PR：可让 Codex 监督 PR 到合并——清理未解决的审查评论和失败检查，处理它们，提交修复，直到 PR 变为绿色

## 生产部署流程

1. 工程师调用 `mcp__sdlc-orchestrator__request_release_approval`
2. 发布管理员通过 `mcp__sdlc-orchestrator__approve_release` 授权
3. 现在 `deploy production` 命令被允许
4. Hook 记录授权时间戳

## CI/CD 集成规则

### 沙盒化执行

- 代理作业在容器中运行，具有短期有效作用域令牌
- 默认不持有生产凭证
- 网络策略限制出站访问

### MCP 暴露部署

- 部署、状态、回滚成为 MCP 工具，按环境划分范围
- 代理的部署权限是白名单，不是带凭证的 shell 脚本

### 按环境分层自主权

- **Dev**：代理可自由部署
- **Staging**：代理准备，人工批准
- **Production**：代理准备，发布管理员授权，hook 执行生产门禁

### 回滚路径

- 回滚应是管道中最常演练的路径
- 代理可运行的单个命令
- 在测试环境中定期演练
- 闭环操作（Stage 6）在控制带被违反时调用此回滚——必须提前验证

## 推进条件

- PR 已合并到 main（`gh pr merge`）
- `state.release_approval = true`（如果涉及生产部署）
- PostToolUse hook 检测到 merge 命令 + release_approval → 自动推进到 Stage 6: Maintain
- `state.last_deployed_at` 已设置

## 治理

- **职责分离**：编写代码的代理没有批准它的途径。
- **REVIEW.md**：审查策略适用于所有 PR；发现、修复、评分和批准都记录在 PR 历史中。
- **分支保护**：代理写入的任何内容都转化为 PR，没有直接路径到 main。
- **生产部署钩子**：阻止发布直到指定的发布经理授权。每次非交互式运行代表代理自己的身份，管道日志将代理的操作与触发它的工程师的操作分开。
- **每个环境的权限层级**：设定了代理在到达门禁前的操作权限。
- **领先指标**：首次审核时间（目标：分钟级）；无需人工触碰分支即可解决的审核评论比例。
- **滞后指标**：在合并前捕获的缺陷和漏洞 vs 逃逸到生产环境的数量。

## 反模式

- ❌ 不等所有检查绿色就合并——绕过门禁。
- ❌ 让 Codex 批准自己的 PR——职责分离禁止。
- ❌ 跳过回滚演练——需要时需要快速执行。
- ❌ 把 `@codex` 审查评论当作可选——它们是审计追踪的一部分。
- ❌ 不让策略所有者签字就改 REVIEW.md——那是控制变更。
