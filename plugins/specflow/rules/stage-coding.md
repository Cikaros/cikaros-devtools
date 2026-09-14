---
title: 编码实现阶段规则
type: requirement
semantic: rule
stage: coding
version: 1.0.0
last_modified: 2026-09-01T18:00:00+08:00
author: specflow
status: active
refs:
  - docs/requirements/REQUIREMENTS.md
  - docs/requirements/WORKFLOW.md
  - docs/requirements/COMMANDS.md
  - spec/coding-standards.md
---

# 编码实现阶段规则（rules/stage-coding.md）

> **本文档是编码实现阶段（stage: coding）的可调规则，仅在此阶段携带，阶段结束后卸载。**
>
> 加载策略：`on_prompt_receive` hook 检测当前阶段为 coding 时加载。
>
> **始终加载**：`spec/coding-standards.md`（不可变基线）+ `spec/security-baseline.md`。本规则与 spec 层叠加生效。

---

## 1. 阶段目标

按 ADR 与模块设计实现代码——产出可运行、通过 lint、含必要注释的源码，作为代码评审阶段的输入。

进入条件：架构设计阶段（arch）已 completed
退出条件：产出清单全部通过（详见 §5）

---

## 2. 必做产出

按 WORKFLOW.md §5.1 / COMMANDS.md §3.5，本阶段产出：

| 产出 | 路径 | 必选 | 规范 |
|------|------|------|------|
| 源码实现 | `<source_files>`（每个 TODO 标记一个文件） | ✅ | 遵循 spec/coding-standards.md |
| 单元测试（可选） | `tests/<test_files>` | ❌ 可选 | 可推迟到 testing 阶段，但建议同步写 |
| Lint 报告 | `.specflow/lint-report.json` | ✅ | 由 codex_lint 生成 |
| Coverage 报告 | `.specflow/coverage-report.json` | ❌ 可选 | 严格项目必选 |

---

## 3. 实现规范

### 3.1 严格遵循 spec 层

- **命名**：遵循 `spec/coding-standards.md` §1（按语言社区习惯）
- **注释**：遵循 `spec/coding-standards.md` §2（解释 Why 不解释 What）
- **错误处理**：遵循 `spec/coding-standards.md` §3（不吞错 + 分类 + 上下文）
- **日志**：遵循 `spec/coding-standards.md` §4（统一 logger + 不打印 PII）
- **目录结构**：遵循 `spec/coding-standards.md` §5（按职责分层）
- **安全基线**：遵循 `spec/security-baseline.md`（SQL 参数化 / 密钥不硬编码 / 等）

### 3.2 按语言栈加载子规则

`on_session_start` hook 探测当前语言栈后，加载对应语言的子规则：

| 语言 | 子规则文件 | 4 部分 |
|------|----------|--------|
| TypeScript | `templates/coding/typescript/spec.md` | 语法 / 高级特性 / 编码规范 / 文档模板 / 反模式 |
| Python | `templates/coding/python/spec.md` | 同上 |
| Go | `templates/coding/go/spec.md` | 同上 |
| Java | `templates/coding/java/spec.md` | 同上 |
| Rust | `.specflow/languages/rust.md`（用户自定义） | 同上 |
| Kotlin | `.specflow/languages/kotlin.md`（用户自定义） | 同上 |

按需加载（REQUIREMENTS.md §4.3）——仅加载当前语言栈，其他跳过。

### 3.3 按 ADR 与设计实现

- 严格按 ADR 决策实现——不允许"实现时改方案"
- 若发现 ADR 决策有问题，回到 arch 阶段更新 ADR（不直接在代码里违反 ADR）
- 按模块设计卡片的"对外接口"实现——签名 / 入参 / 出参严格对齐

### 3.4 接口契约对齐

- REST API 实现必须与 OpenAPI 契约一致
- gRPC 实现必须与 proto 一致
- 接口变更必须先更新契约文件（design-first），不允许 code-first 反推契约

---

## 4. 标记驱动实现

### 4.1 单文件限定

每个 TODO 标记只对应一个文件的修改（CONVERGENCE.md §0.2 核心价值 5 / COMMANDS.md §12.1）：

- 一个标记 → 一个文件
- 跨文件修改需拆分为多个标记
- hook 在 `tool_call_before` 校验

### 4.2 标记推进流程

按 COMMANDS.md §12.1：

1. **创建标记**：req 阶段已创建（每个文件一个 TODO#NNN）
2. **检查依赖**：`tool_call_before` 检查 `[depends]` 是否完成
3. **推进标记**：`/todo <id> advance`（v1.0.0 已移除 stage 字段，CONVERGENCE.md §4.3）
4. **完成标记**：`/todo <id> resolve`（测试通过 + 产出存在后，由 hook 自动检测）

### 4.3 不允许跨文件

- 标记 ID 唯一对应一个文件
- 同 ID 在多个文件出现 → 报 error
- 修改其他文件需创建新标记

---

## 5. 产出检查（on_stage_exit hook）

`on_stage_exit` hook 按 WORKFLOW.md §5.2 检查：

1. **TODO 标记全部 resolved**：
   - 所有标记状态为 `resolved` 或 `deleted`
   - 未完成的标记阻塞推进（提示用户先完成）
2. **必选产出文件存在**：
   - 每个 TODO 标记对应的源码文件存在
   - 文件 size > 0
3. **Lint 通过**：
   - `.specflow/lint-report.json` 中 error 数 = 0
   - warning 数 < 阈值（默认 10）
4. **类型检查通过**（若严格类型启用）：
   - TypeScript `tsc --noEmit` 退出码 0
   - Python `mypy` 无 error
   - Go `go vet` 无 error
5. **格式化通过**：
   - prettier / black / gofmt 检查无 diff
6. **不捏造检查**：
   - 源码中 `{{TODO:xxx}}` 占位 = 0（不允许代码留 TODO 占位，需实现）
   - 注释中的 `// TODO#NNN` 必须有对应标记 ID

任一失败则阻塞进入评审阶段。

---

## 6. 阶段内禁止行为

### 6.1 禁止违反 spec 层

- 不违反命名规范
- 不吞错（`catch (e) {}` 反模式）
- 不打印 PII 到日志
- 不硬编码密钥
- 不字符串拼接 SQL

详见 `spec/coding-standards.md` 与 `spec/security-baseline.md`。

### 6.2 禁止跳过 lint / 类型检查

- 不允许 `// @ts-ignore` / `# type: ignore`（除非有 ADR 说明理由）
- 不允许 `eslint-disable` 全文件
- 不允许注释掉测试用例让 CI 通过

### 6.3 禁止跨文件 TODO

- 单文件限定（CONVERGENCE.md §0.2 核心价值 5）——一个标记只改一个文件
- 跨文件修改需拆分为多个标记
- hook 校验失败报 error

### 6.4 禁止实现未在 ADR 中的方案

- 实现时若发现 ADR 决策有问题，回到 arch 阶段更新 ADR
- 不允许"实现时改方案"——会让 ADR 与代码不一致
- 紧急修复可先改代码，但 24 小时内必须补 ADR

### 6.5 禁止提交未测试的代码

- 每个公共函数至少有 happy path 测试
- 不允许"先合并再补测试"
- 测试可与实现同步写（推荐）或推迟到 testing 阶段（不推荐）

---

## 7. 阶段内推荐实践

### 7.1 TDD（测试驱动开发）

- Red：先写失败的测试
- Green：写最少代码让测试通过
- Refactor：重构代码保持测试通过

### 7.2 小步提交

- 每完成一个 TODO 标记 + 通过测试 → 提交一次
- 不积累大量代码一次提交（难评审 / 难回滚）
- 提交信息含 TODO 标记 ID（如 `feat(auth): 实现登录（TODO#001）`）

### 7.3 持续集成验证

- 每次推送都触发 CI 跑 lint + 测试
- CI 失败立即修复，不积累技术债
- 主分支必须始终保持 CI 绿

### 7.4 Code Review 准备

- 编码完成前自审一遍
- 跑过 lint + 测试 + 格式化
- 准备好 PR 描述（背景 / 变更 / 测试 / 风险）

---

## 8. 与其他阶段的衔接

### 8.1 进入评审（review）的前置

- TODO 标记全部 resolved
- Lint / 类型检查 / 格式化通过
- 必选产出文件存在

### 8.2 与任务型命令的关系

- `/new-feature` / `/bugfix` / `/design-*` 等命令内部走 coding 阶段子集
- 任务型命令在 coding 阶段也必须遵循本规则
- `/bugfix` 在 coding 阶段创建 FIXME 标记（COMMANDS.md §4.4）

### 8.3 与标记系统的关系

- 本阶段推进标记：`/todo <id> advance` / `/todo <id> resolve`
- 标记 resolve 由 hook 自动检测（CONVERGENCE.md §7.13）：测试通过 + 产出存在
- 所有标记 resolved 后触发 `on_all_resolved` hook（删除注释 + 更新 CHANGELOG）

---

## 9. 阶段状态变更

按 WORKFLOW.md §4.2：

| 命令 | 状态转换 | 前置检查 |
|------|---------|---------|
| `/workflow advance` | in_progress → completed → 下一阶段 pending | 产出检查通过 |
| `/workflow goto review` | any → review in_progress | 本阶段 completed |
| `/workflow goto testing` | any → testing in_progress | 本阶段 completed（不允许跳过 review） |

完成后自动进入代码评审阶段（review），加载 `rules/stage-review.md`。
