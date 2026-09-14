---
title: 测试验证阶段规则
type: requirement
semantic: rule
stage: testing
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

# 测试验证阶段规则（rules/stage-testing.md）

> **本文档是测试验证阶段（stage: testing）的可调规则，仅在此阶段携带，阶段结束后卸载。**
>
> 加载策略：`on_prompt_receive` hook 检测当前阶段为 testing 时加载。
>
> **始终加载**：`spec/coding-standards.md`（§7 测试规范）+ `spec/security-baseline.md`。

---

## 1. 阶段目标

为已实现的代码生成测试 + 跑测试 + 验证覆盖率 + resolve 所有 TODO/FIXME 标记——产出测试代码与覆盖率报告，作为发布的前置条件。

进入条件：代码评审阶段（review）已 completed
退出条件：产出清单全部通过（详见 §5）+ 所有标记 resolved

---

## 2. 必做产出

按 WORKFLOW.md §5.1 / COMMANDS.md §10-11，本阶段产出：

| 产出 | 路径 | 必选 | 规范 |
|------|------|------|------|
| 单元测试 | `tests/<test_files>` | ✅ | 覆盖所有 TODO 标记所在文件 |
| 覆盖率报告 | `docs/testing/<module>-coverage-<YYYYMMDD>.md` | ✅ | 行覆盖 + 分支覆盖 |
| 集成测试（视情况） | `tests/integration/<test_files>` | ❌ 可选 | 跨模块关键链路 |
| E2E 测试（视情况） | `tests/e2e/<test_files>` | ❌ 可选 | 关键用户场景 |
| 性能测试（视情况） | `docs/testing/perf-<feature>-<date>.md` | ❌ 可选 | 关键接口 QPS / 响应时间 |
| 测试报告 | `.specflow/test-report.json` | ✅ | 由测试 runner 生成 |

---

## 3. 测试规范

### 3.1 测试金字塔

按 `spec/coding-standards.md` §7.1：

```
       /\
      /e2e\        少（关键链路，< 5%）
     /------\
    /集成测试\      中（跨模块，~ 20%）
   /----------\
  /   单元测试  \    多（业务逻辑，~ 75%）
 /--------------\
```

### 3.2 测试用例三件套

每个公共函数至少 3 类用例：

- **happy path**：正常输入返回预期结果
- **edge case**：边界值（空 / 极大 / 极小 / null / undefined）
- **failure case**：异常输入返回错误或抛异常

### 3.3 测试命名

- 测试名说明"测什么 + 期望什么"：`it("should return 404 when user not found", ...)`
- 不用 `test1` / `test2` 等无意义命名

### 3.4 测试隔离

- 每个测试用例独立，不依赖其他用例的副作用
- 用 setup / teardown 清理状态
- 不依赖测试执行顺序

### 3.5 测试框架

按 `rules/team-conventions.md` 与 env-scanner 探测结果：

| 语言 | 推荐框架 | 备注 |
|------|---------|------|
| TypeScript | vitest（默认）/ jest | 二选一，项目内统一 |
| Python | pytest | 默认 |
| Go | go test | 标准库 |
| Java | junit 5 | 默认 |
| Rust | cargo test | 标准库 |

---

## 4. 覆盖率门槛

### 4.1 默认门槛

| 层级 | 行覆盖 | 分支覆盖 |
|------|--------|---------|
| 业务逻辑层（service） | ≥ 80% | ≥ 70% |
| API 层（api/handlers） | ≥ 70% | ≥ 60% |
| 数据访问层（repository） | ≥ 60% | ≥ 50% |
| 工具层（utils） | ≥ 90% | ≥ 80% |

### 4.2 严格度选择

按 CONVERGENCE.md §4.5（frontmatter `strictness` 字段）：

| 严格度 | 行覆盖 | 分支覆盖 | 复杂度 |
|--------|--------|---------|--------|
| 标准（默认） | ≥ 80% | ≥ 70% | ≤ 20 |
| 严格 | ≥ 90% | ≥ 80% | ≤ 10 |
| 宽松 | ≥ 70% | ≥ 60% | ≤ 20 |

### 4.3 覆盖率检查

按 COMMANDS.md §10.3 / WORKFLOW.md §5.4，frontmatter 声明 hook：

```markdown
---
stage: testing
output: [docs/testing/<module>-coverage-<date>.md]
hooks:
  on_stage_exit:
    - command: python3 scripts/lib/check-coverage.py --min 80
      timeout: 30
      on_failure: abort
---
```

`on_stage_exit` hook 跑覆盖率检查脚本，未达标则阻塞。

---

## 5. 产出检查（on_stage_exit hook）

`on_stage_exit` hook 按 WORKFLOW.md §5.2 检查：

1. **测试文件存在**：
   - 每个 TODO 标记所在文件有对应测试文件
   - 测试文件 size > 0
2. **测试通过**：
   - `.specflow/test-report.json` 中失败用例数 = 0
   - 测试退出码 = 0
3. **覆盖率达标**：
   - 行覆盖 ≥ 阈值（默认 80%）
   - 分支覆盖 ≥ 阈值（默认 70%）
4. **TODO 标记全部 resolved**：
   - `.specflow/todo-state.json` 中所有标记状态为 `resolved` 或 `deleted`
   - 未完成的标记阻塞推进
5. **测试报告存在**：
   - `.specflow/test-report.json` 含用例数 / 通过数 / 失败数 / 覆盖率
6. **覆盖率报告存在**：
   - `docs/testing/<module>-coverage-<YYYYMMDD>.md` 含详细覆盖率分析

任一失败则阻塞进入下一阶段（通常是 release 或新需求）。

---

## 6. 标记收尾

### 6.1 标记 resolve 流程

按 CONVERGENCE.md §7.13：

```
created ──(测试通过 + 产出存在)──→ resolved ──(注释删除)──→ deleted
   │                                                        ↑
   └────(cancel)─────────────────────────────────────────→ deleted
```

- **created → resolved**：测试通过 + 产出存在，由 hook `on_marker_resolved` 自动检测
- **resolved → deleted**：注释删除，由 hook `on_all_resolved` 触发清理
- **created → deleted**：取消标记（不实现），手动 `/todo <id> cancel`

### 6.2 全部 resolved 后的清理

按 COMMANDS.md §12.1 步骤 4：

1. 删除所有 `//TODO#NNN` / `//FIXME#NNN` 注释
2. 更新 `docs/changes/CHANGELOG.md` [Unreleased] § Added / Fixed
3. bump 相关文档版本（`<file>.version` SemVer）
4. 归档 `.specflow/todo-state.json` 到 `.specflow/archive/todo-state-<timestamp>.json`

由 hook `on_all_resolved` 自动触发（HOOKS.md §7.1）。

### 6.3 CHANGELOG 条目

按 CONVERGENCE.md §7.14：

```markdown
### Added
- [new-feature] <feature-slug>: <描述>（TODO#001~NNN）

### Fixed
- [bugfix] <issue-slug>: <描述>（FIXME#001~NNN）
```

---

## 7. 阶段内禁止行为

### 7.1 禁止跳过测试

- 测试可与实现同步写（推荐）或推迟到 testing 阶段
- 但 testing 阶段必须补齐所有测试
- 不允许"先合并再补测试"

### 7.2 禁止为了让测试通过修改业务代码

- 测试反映业务期望
- 若发现测试不通过因业务代码 bug，修业务代码
- 若发现测试不通过因测试期望错，修测试（需 ADR 说明）

### 7.3 禁止降低覆盖率门槛

- 严格度选择在项目初始化时确定（CONVERGENCE.md §4.5）
- 不允许"为了过 CI 临时降低门槛"
- 调整门槛需走 ADR + bump spec version

### 7.4 禁止 mock 一切

- 仅 mock 外部依赖（DB / 第三方 API / 文件系统）
- 不 mock 内部业务逻辑（应直接测）
- 过度 mock 让测试失去意义——只测了 mock 行为，没测真实代码

### 7.5 禁止跳过标记收尾

- 所有标记必须 resolved 才能进入下一阶段
- 不允许"标记没完成但功能已上线"
- `on_all_resolved` hook 必须触发清理

---

## 8. 阶段内推荐实践

### 8.1 TDD 三步循环

- Red：先写失败的测试
- Green：写最少代码让测试通过
- Refactor：重构保持测试通过

### 8.2 测试用例覆盖 PRD 验收标准

- PRD 中每条 AC（Given/When/Then）对应至少 1 个测试用例
- 测试用例名含 AC 编号：`test_ac_1_user_login_success`
- 评审时可对照 PRD 检查覆盖率

### 8.3 性能测试

- 关键接口做性能测试（如登录 / 下单 / 支付）
- 报告含 QPS / P50 / P95 / P99 / 错误率
- 与 PRD 非功能需求对比（如"登录响应时间 P95 ≤ 200ms"）

### 8.4 E2E 测试场景

- 关键用户场景做 E2E（如注册 → 登录 → 下单 → 支付 → 退款）
- E2E 数量少而精（≤ 10 个），覆盖核心链路
- 用 headless browser（Playwright / Cypress）

---

## 9. 与其他阶段的衔接

### 9.1 进入下一阶段（通常 release 或新需求）的前置

- 测试全部通过
- 覆盖率达标
- 所有标记 resolved
- CHANGELOG 已更新

### 9.2 与任务型命令的关系

- `/unit-test <path>` / `/integration-test <modules>` 内部走 testing 阶段子集（COMMANDS.md §10-11）
- `/bugfix` 在 testing 阶段做回归测试（COMMANDS.md §4.3）
- 任务型命令在 testing 阶段也必须遵循本规则

### 9.3 与标记系统的关系

- 本阶段完成所有标记的 resolve（hook 自动检测）
- 触发 `on_all_resolved` hook 清理注释 + 更新 CHANGELOG
- 归档 todo-state.json

### 9.4 与文档系统的关系

- 覆盖率报告归档到 `docs/testing/`
- CHANGELOG 更新到 `docs/changes/CHANGELOG.md`
- 相关需求 / 设计文档 bump version（`<file>.version`）

---

## 10. 阶段状态变更

按 WORKFLOW.md §4.2：

| 命令 | 状态转换 | 前置检查 |
|------|---------|---------|
| `/workflow advance` | in_progress → completed → 项目完成（或下一迭代） | 产出检查通过 |
| `/workflow goto <stage>` | any → <stage> in_progress | 回滚到指定阶段（需 ADR） |
| `/workflow reset` | any → pending（所有阶段） | 用户确认（重置整个 Agent） |

完成后整个工作流结束，触发：
- CHANGELOG 更新
- 文档版本 bump
- 标记归档
- `on_all_resolved` hook 清理

可继续创建新的 Agent 工作流，或开始新的迭代。
