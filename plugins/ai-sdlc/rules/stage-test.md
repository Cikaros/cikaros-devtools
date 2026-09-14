# Stage 4 — Test Rules

> 触发条件：`plan.md` 存在 + git 有未提交 diff + `state.test_pass = false`。
> 产物：测试通过（`state.test_pass = true`）+ 评估套件就绪。
> v0.7.0：本阶段处于测试门禁与修复循环保护的核心区——实施后必须真实测试，
> 失败要么就地收敛要么进入下一个 intent，循环则中断询问用户。
> v0.8.0：前端项目一律配合 `skills/frontend-e2e/`（Playwright 能力技能）
> 取得 E2E 证据——用户行为层回归只有 E2E 拦得住。

## 硬约束

1. **报告完成前必跑反馈循环**：
   - `make build`（必须成功，必须以 "Build succeeded" 等明确成功标志结束）
   - `make test`（必须全绿，**永不跳过或删除失败的测试**）
   - `make lint`（必须零警告）
2. **必须粘贴原始输出**——`make test` 的原始输出、构建日志、截图差异，作为机械证据。
3. **测试失败时修代码不修测试**——除非测试本身有 bug，此时退出 `in_fix_mode` 再改。
4. **`in_fix_mode` 下禁止修改测试文件**（PreToolUse hook 强制）。
5. **测试未通过禁止 `git push` / `gh pr create`**（PreToolUse 测试门禁强制，v0.7.0）——
   plan 接受并实施后必须先真实运行测试；项目确实无测试套件时先补最小冒烟测试，
   或经用户明确同意后调 MCP `advance` 推进（逃生通道）。
6. **修复循环中断后禁止继续自动修改代码**（PreToolUse fix_loop 门禁强制，v0.7.0）——
   同一失败签名重复出现（A→A / A→B→A，含跨周期 intent 迭代后再现）或连续失败
   轮次超限（默认 3）时，必须停止自动修复，向用户呈报循环证据并等待决策：
   MCP `loop_resolve({decision:"retry|new-intent|manual|escalate", note})`。

## 失败的处理路径（v0.7.0）

测试失败 → 插件记录失败签名（`state.test_failures`）与轮次计数（`state.fix_rounds`）：

- **就地修复（首选）**：小问题修代码重跑，通过即清零轮次
- **intent 迭代**：失败暴露需求/设计缺口 → MCP `new_cycle` 归档当前周期，
  把失败测试作为 incident 写入新的 intent.md——下一个迭代周期解决它
- **循环中断（自动）**：签名窗口内重复 ≥2 或轮次超限 → `state.fix_loop` 置位 →
  代码写入被阻断 + Stop/每回合提醒 → 用户四决策（retry / new-intent / manual / escalate）
- **自动解除**：测试真实通过 → fix_loop 清除（但不得跳过/删除/弱化失败测试来"通过"）

## 反馈循环规则

### 前端项目（v0.8.0）

改了 UI 的周期，反馈循环的 `test` 环节按 `skills/frontend-e2e/SKILL.md` 执行：

- 标准命令：`npx playwright test`（或 `npm run e2e` / 裸 `playwright test`，
  均被测试门禁识别并计入 `test_runs`）；`playwright install` / `codegen` /
  `show-report` 是工具命令，不计为测试执行
- 报告器用默认 / list / line / dot（失败编号清单是失败签名提取依据）
- 视觉闭环用 `toHaveScreenshot` 与 spec.md mock 机械对比（Stage 4 「UI 视觉
  闭环」的实现路径）

### 命令封装

如果今天检查工作需要一系列命令和环境知识，封装成单一目标：

```makefile
# Makefile
test:
    pytest tests/ -v
lint:
    ruff check . && mypy .
build:
    python -m build
```

或 `package.json`：

```json
{
  "scripts": {
    "test": "jest",
    "lint": "eslint . && tsc --noEmit",
    "build": "next build"
  }
}
```

### 健康输出示例

在 `AGENTS.md` 的 `## Verifying your work` 章节列出每个命令的健康输出示例：

```markdown
## Verifying your work

- Build: `make build` (must finish with "Build succeeded")
- Test: `make test` (all green; never skip or delete a failing test)
- Lint: `make lint` (zero warnings)

Run all three before reporting any task complete, and paste the output.
If a test fails, fix the code, not the test.
```

### 可量化目标

声明目标使其可量化，让 Codex 不询问你就能检查工作：

- "test_status.py 中的所有测试都通过"
- "截图与附加的 mock 图匹配"
- "端点返回带有新字段的 200 状态码"

## Bug 修复特殊流程

1. **先写失败的测试**——按预期重现 bug 作为测试
2. **运行并确认失败原因**——确认失败原因正确
3. **提交该测试用例**——单独提交
4. **进入修复模式**：`mcp__sdlc-orchestrator__set_fix_mode(true)`
5. **使测试通过但不修改测试**——PreToolUse hook 强制禁止
6. **退出修复模式**：`mcp__sdlc-orchestrator__set_fix_mode(false)`

一个在修复前已存在的且代理无法重写的测试用例，就是证明错误已消失的证据。

## UI 视觉闭环

1. 实现
2. 截图（通过 MCP 集成的浏览器工具或截图工具）
3. 与 mock 比较（来自 spec.md）
4. 调整
5. 重复 2-4 直到匹配（2-3 轮正常）

## 持续评估套件（CI 中运行）

### 何时运行

- 每次 `AGENTS.md` / skills / hooks 改动时（配置引导代理，值得回归测试）
- 定期 schedule（如每天凌晨 2 点）

### 套件组成

- 20-50 个真实任务 + 预期/接受结果
- 每个评估 = 提示 + 可接受结果定义（测试通过 / lint 干净 / 行为未改变 / 政策遵循）
- CI 配置参考 `.github/workflows/agent-evals.yml`

### 门控配置更改

- 一项导致通过率降低的 skills 更改会在合并前进行审查
- 每次生产事件得到一个评估，由拥有该事件的团队编写

## 推进条件

- `state.test_pass = true`（PostToolUse hook 检测到测试命令 exit 0）
- 评估套件已就绪或已有 CI 配置
- PostToolUse hook 自动推进到 Stage 5: Deploy

## 治理

- **强制执行**：在任务报告完成前进行验证；修复期间阻止代理编辑测试文件——两者均作为钩子实现。
- **证据**：`make test` 的原始输出、构建日志、Codex 运行并粘贴的截图差异——证据来自工具链。
- **记录位置**：会话记录中（OpenTelemetry 导出）+ PR 的 check runs 中。
- **决策者**：代码所有者审查 PR——他们专注于意图和风险，因为机械证据已附加。
- **领先指标**：首次 CI 成功率（针对代理编写的变更）。
- **滞后指标**：每个 PR 的审查时间（应在测试捕获审查者过去捕获的问题后减少）；从事件追踪器中的变更失败率。

## 反模式

- ❌ 报告完成但不粘贴测试输出——声称无证据。
- ❌ 跳过评估套件"以后再加"——以后永远不会来；套件是从真实工作增量构建的。
- ❌ 修改测试使其通过——那不是测试，那是表演。
- ❌ 只跑单元测试不跑集成测试（如果存在）——两者都重要。
- ❌ 把评估套件当作一次性设置——它是活的套件；每个事件添加一个用例。
- ❌ 未测试就 push / 提 PR——门禁会拦；先跑测试（v0.7.0）。
- ❌ 循环中断后继续自动改代码——必须先呈报用户等待决策（v0.7.0）。
- ❌ 为了解除 fix_loop 而跳过/删除/弱化失败测试——中断是为了保护你不在原地打转。
- ❌ 每次失败都机械开新周期——小问题就地修复；intent 迭代留给需求/设计缺口。
