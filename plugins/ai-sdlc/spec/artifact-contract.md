# Artifact Contract — 工件契约

> 定义每个 SDLC 阶段产出的工件的格式、位置、必备字段、推进条件。
> v0.10.0：工件是任务推进的中间产物，统一存放于 `.sdlc/` 工作区（不入版本控制，
> gitignore 托管块管理）；任务/周期结束归档至 `.sdlc/archive/`。存量项目根目录/
> docs/ 的历史落位仍可被检测。

## intent.md（Stage 1 产物）

### 文件位置
- 默认：`.sdlc/artifacts/intent.md`（任务隔离模式：`.sdlc/tasks/<id>/intent.md`）
- 存量兼容：项目根 `intent.md` / `intent/<kebab-name>.md` 仍可被检测

### 必备章节
```markdown
# Intent: <feature-name>
Author: <name>. Status: draft.

## Problem
## Proposed outcome
## Affected users and systems
## Constraints
## Open questions
```

### 推进条件
- 文件存在
- 包含全部 5 个章节
- 已写入约定工作区（`.sdlc/artifacts/`，不入版本控制）
- 产品负责人接受（对话确认或 PR 流程）

### 接受者
- 产品负责人（接受/关闭）

### 触发下一阶段
- Stage 2: Design（自动检测：`intent.md` 存在 + `spec.md` 不存在）

---

## spec.md（Stage 2 产物）

### 文件位置
- 默认：`.sdlc/artifacts/spec.md`（任务隔离模式：`.sdlc/tasks/<id>/spec.md`）
- 存量兼容：项目根 `spec.md` / `docs/spec/<kebab-name>.md` 仍可被检测

### 必备章节
```markdown
# Spec: <feature-name>

Source intent: intent.md@<cycle-id>（工作区工件以周期为溯源单位）
Active skills: <list>

## Requirements
### Functional
### Non-functional

## Design
### Architecture
### Data model
### API
### UX

## Concerns
## Open questions
```

### 推进条件
- 文件存在
- 引用了 `spec.md`（以 cycle-id 为溯源单位）
- 所有 `## Concerns` 已路由到具体负责人
- 产品负责人审查并接受
- 标记的关切点已与策略所有者解决

### 接受者
- 产品负责人 + 策略所有者（解决关切点）

### 触发下一阶段
- Stage 3a: Build (Plan Mode)（自动检测：`spec.md` 存在 + `plan.md` 不存在）

---

## plan.md（Stage 3a 产物）

### 文件位置
- 默认：`.sdlc/artifacts/plan.md`（任务隔离模式：`.sdlc/tasks/<id>/plan.md`）
- 存量兼容：项目根 `plan.md` / `docs/plan/<kebab-name>.md` 仍可被检测

### 必备章节
```markdown
# Plan: <feature-name> (from spec.md@<cycle-id>)

## Files that change
## Order of work
## Risks
## Proof
```

### 推进条件
- 文件存在
- 包含全部 4 个章节
- 工程师显式接受（`mcp__sdlc-orchestrator__accept_plan` → `state.plan_accepted = true`）

### 接受者
- 工程师（常规变更）
- 技术负责人或架构师（高风险变更）

### 触发下一阶段
- Stage 3b: Build (Implementation)（自动检测：`plan.md` 存在 + `state.plan_accepted = true`）

### 阶段门禁（PreToolUse hook 强制）
- 本阶段禁止修改业务代码
- Bash 仅允许只读命令

---

## diff + tests（Stage 3b 产物）

### 形态
- git 中有未提交或已提交的 diff
- 测试文件覆盖变更行为
- plan.md 与最终 diff 匹配

### 推进条件
- plan.md 的 Files that change 全部已修改
- `make test` / `npm test` 等命令 exit 0（PostToolUse hook 检测）
- diff 与 plan.md 匹配（无未声明的文件变更）

### 接受者
- 工程师（自检）
- CI（自动化）

### 触发下一阶段
- Stage 4: Test（自动检测：`plan.md` + diff + `state.test_pass = true`）

### 阶段门禁
- `in_fix_mode = true` 时禁止修改测试文件

---

## test-pass + eval suite（Stage 4 产物）

### 形态
- `state.test_pass = true`（PostToolUse hook 检测测试命令 exit 0）
- `evals/` 目录存在且至少有一个 `.json` 评估
- `.github/workflows/agent-evals.yml` 存在

### 推进条件
- `state.test_pass = true`
- 评估套件已就绪或已有 CI 配置
- PR 已创建（`gh pr create` 或 `git push`，PostToolUse hook 检测）

### 接受者
- CI（评估套件通过率 ≥ 80%）
- 代码所有者（PR review）

### 触发下一阶段
- Stage 5: Deploy（自动检测：`state.test_pass = true` + 非 main 分支 + diff）

---

## pr-merged（Stage 5 产物）

### 形态
- PR 已合并到 main（`gh pr merge` 或 `git merge`）
- `state.last_deployed_at` 已设置
- 生产部署（若涉及）：`state.release_approval = true`

### 推进条件
- PR 已合并
- `state.release_approval = true`（若涉及生产部署）

### 接受者
- 代码所有者（分支保护）
- 发布管理员（生产部署授权）

### 触发下一阶段
- Stage 6: Maintain（自动检测：`state.last_deployed_at` + main 分支 + 无 diff）

### 阶段门禁
- 生产部署 Bash 命令需 `state.release_approval`
- 修改迁移/基础设施文件需 `state.change_ticket`

---

## 新 intent.md（Stage 6 产物，闭环关键）

### 形态
- 新的 `intent.md`（覆盖旧的或新增）
- `Author: ai-sdlc-monitor`
- `Status: draft`
- `## Problem` 包含异常证据（指标、日志、时间戳）

### 推进条件
- 文件存在
- `state.cycle_count` 自增（PostToolUse 维护）

### 接受者
- 服务所有者或值班工程师（分诊）

### 触发下一阶段
- 回到 Stage 1: Planning（PostToolUse hook 检测 `intent.md` 创建 + 当前阶段为 maintain → 推进到 planning）

---

## 跨工件约束

### 工件链 = 审计追踪
```
intent.md ──(产品负责人接受)──► spec.md
spec.md   ──(产品负责人接受)──► plan.md
plan.md   ──(工程师接受)──────► diff + tests
tests     ──(CI 通过)─────────► PR
PR        ──(代码所有者批准)──► merge to main
main      ──(控制带突破)──────► 新 intent.md（闭环）
```

### 工件不可回退
- 一旦 `spec.md` 提交，改动应在 `spec.md` 而非 `intent.md`
- 一旦 `plan.md` 接受，实施偏离时更新 `plan.md` 而非 `spec.md`
- 一旦 PR 合并，发现问题开新 PR 而非 revert 已合并 PR（除非回滚运行手册）

### 工件位置
- 见 `spec/sdlc-baseline.md`「工件位置约定」；多候选检测顺序见
  `hooks/scripts/lib/paths.mjs` 的 `ARTIFACT_CANDIDATES`（单一事实源，经 common.mjs 桶导出，
  hooks/MCP/归档共用）
- 工作区不入版本控制（gitignore 托管块）；需要 PR 可审查的归档链时，
  new_cycle/task_close 可显式传 `docs/sdlc/archive` 归档目录
