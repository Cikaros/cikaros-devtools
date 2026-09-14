---
title: 代码评审阶段规则
type: requirement
semantic: rule
stage: review
version: 1.0.0
last_modified: 2026-09-01T18:00:00+08:00
author: specflow
status: active
refs:
  - docs/requirements/REQUIREMENTS.md
  - docs/requirements/WORKFLOW.md
  - docs/requirements/COMMANDS.md
  - spec/coding-standards.md
  - spec/security-baseline.md
---

# 代码评审阶段规则（rules/stage-review.md）

> **本文档是代码评审阶段（stage: review）的可调规则，仅在此阶段携带，阶段结束后卸载。**
>
> 加载策略：`on_prompt_receive` hook 检测当前阶段为 review 时加载。
>
> **始终加载**：`spec/coding-standards.md` + `spec/security-baseline.md`。

---

## 1. 阶段目标

对编码阶段产出的代码做 10 维度评审 + 安全扫描 + 复杂度检查——产出评审报告与修复建议，确保代码可进入测试阶段。

进入条件：编码阶段（coding）已 completed
退出条件：评审通过（APPROVED）+ 高危问题全部修复

---

## 2. 必做产出

| 产出 | 路径 | 必选 | 规范 |
|------|------|------|------|
| 评审报告 | `docs/review/<feature>-review-<YYYYMMDD>.md` | ✅ | 详见 §3 |
| 安全扫描报告 | `.specflow/security-scan.json` | ✅ | 由 privacy-guard / 静态扫描生成 |
| 复杂度报告 | `.specflow/complexity-report.json` | ❌ 可选 | 严格项目必选 |
| 修复 PR | `<source_files>` 修改 | 视情况 | 评审发现问题时必选 |

---

## 3. 评审报告规范

### 3.1 必含章节

```markdown
# <Feature> 代码评审报告

## 1. 评审信息
   - 评审者：<name>
   - 评审日期：<YYYY-MM-DD>
   - 评审范围：<files>
   - 代码行数：<count>

## 2. 评审结论
   - [ ] APPROVED（通过，可进入测试）
   - [ ] APPROVED_WITH_COMMENTS（通过但有建议）
   - [ ] CHANGES_REQUESTED（需修改后重审）
   - [ ] REJECTED（拒绝，需重大返工）

## 3. 10 维度评审结果

### 3.1 功能正确性
- happy / edge / failure case 是否覆盖？
- 是否实现了 PRD 的所有验收标准？

### 3.2 可读性
- 命名是否清晰？
- 逻辑是否直观？
- 注释是否解释 Why？

### 3.3 可维护性
- 是否过度抽象？
- 是否重复代码？
- 是否易扩展？

### 3.4 性能
- 是否有 N+1 查询？
- 是否有内存泄漏？
- 是否有不必要循环？

### 3.5 安全
- 是否有 SQL 注入 / XSS？
- 密钥是否硬编码？
- 权限是否校验？

### 3.6 测试
- 测试是否充分？
- 覆盖率是否达标？

### 3.7 错误处理
- 是否吞错？
- 错误是否分类？
- 是否有降级？

### 3.8 日志
- 是否打印 PII？
- 日志级别是否合适？
- 是否有 trace_id？

### 3.9 文档
- 公共 API 是否有文档注释？
- CHANGELOG 是否更新？
- ADR 是否需要？

### 3.10 一致性
- 是否遵循项目编码规范？
- 是否与现有代码风格一致？

## 4. 问题清单

### 高危（必须修复）
- [ ] <问题描述>（位置：<file>:<line>）

### 中危（建议修复）
- [ ] <问题描述>

### 低危（可选修复）
- [ ] <问题描述>

## 5. 改进建议
- <可改进但非问题的建议>
```

### 3.2 评审语言

按 `rules/team-conventions.md` §3.2：

- **对事不对人**
- **提建议而非命令**
- **解释 Why**
- **区分 Must / Should / Nit**

---

## 4. 评审维度（10 个）

按 `rules/team-conventions.md` §3.1：

| # | 维度 | 关注点 |
|---|------|--------|
| 1 | 功能正确性 | 是否解决了 Issue？happy / edge / failure case 都覆盖？ |
| 2 | 可读性 | 命名 / 逻辑 / 注释 |
| 3 | 可维护性 | 抽象 / 重复 / 扩展性 |
| 4 | 性能 | N+1 / 内存泄漏 / 循环 |
| 5 | 安全 | SQL 注入 / XSS / 密钥 / 权限 |
| 6 | 测试 | 充分性 / 覆盖率 |
| 7 | 错误处理 | 吞错 / 分类 / 降级 |
| 8 | 日志 | PII / 级别 / trace_id |
| 9 | 文档 | API 注释 / CHANGELOG / ADR |
| 10 | 一致性 | 规范 / 风格 |

---

## 5. 产出检查（on_stage_exit hook）

`on_stage_exit` hook 按 WORKFLOW.md §5.2 检查：

1. **评审报告存在**：
   - `docs/review/<feature>-review-<YYYYMMDD>.md` 存在
   - 含必含章节（§3.1）
2. **评审结论为 APPROVED 或 APPROVED_WITH_COMMENTS**：
   - CHANGES_REQUESTED / REJECTED 阻塞进入测试
3. **高危问题全部修复**：
   - 评审报告"高危"清单为空，或对应 PR 已合并
4. **安全扫描通过**：
   - `.specflow/security-scan.json` 中 high / critical 数 = 0
5. **复杂度达标**（若启用）：
   - 圈复杂度 ≤ 阈值（默认 20，严格项目 ≤ 10）
6. **隐私扫描通过**（若启用 privacy_scan）：
   - `.specflow/privacy-audit.json` 无 deny 记录

任一失败则阻塞进入测试阶段。

---

## 6. 阶段内禁止行为

### 6.1 禁止跳过安全扫描

- 所有 PR 必须经过静态安全扫描（SAST）
- 高危漏洞必须修复后才能合并
- 不允许"先合并后修"

### 6.2 禁止跳过隐私扫描（若启用）

- `review.privacy_scan: true` 时必须扫描
- privacy-guard 报 deny 的输出必须修复
- 不允许"业务需要所以绕过"

### 6.3 禁止自审通过

- 评审者不能是代码作者本人
- 至少 1 人评审，重要变更至少 2 人
- 评审者必须熟悉该模块

### 6.4 禁止"走过场"评审

- 评审不能仅看 CI 绿就 APPROVED
- 必须按 10 维度逐项检查
- 评审报告必须有具体内容（不能是"代码 OK，通过"）

### 6.5 禁止阻塞业务紧急修复

- 紧急修复（hotfix）可压缩评审流程
- 但必须事后补评审报告（24 小时内）
- 评审发现的问题必须开 Issue 跟进

---

## 7. 阶段内推荐实践

### 7.1 自动化检查优先

- 能用工具检查的不用人检查：lint / 类型 / 测试覆盖率 / 复杂度 / 安全扫描
- 评审者聚焦"工具检查不了的"：业务逻辑 / 可读性 / 可维护性 / 设计合理性

### 7.2 评审清单

按 `spec/security-baseline.md` §10 安全检查清单：

- [ ] 依赖已扫描漏洞
- [ ] 密钥已从代码移除
- [ ] 外部输入已校验
- [ ] 输出已按上下文编码
- [ ] SQL 已参数化
- [ ] HTTPS 已强制
- [ ] 敏感接口已鉴权 + 限流
- [ ] 日志已脱敏
- [ ] PII 存储已加密
- [ ] 第三方调用已设超时 + 重试 + 降级

### 7.3 性能评审

- 关键接口预估 QPS / 响应时间
- 数据库查询是否走索引
- 是否有 N+1 查询
- 是否有不必要的数据加载（如全表查询）
- 缓存策略是否合理

### 7.4 可读性评审

- 命名是否名副其实
- 函数是否 < 50 行
- 类是否 < 500 行
- 是否有"魔法数字"（应抽为常量）
- 是否有过深嵌套（应早返回 / 抽函数）

---

## 8. 与其他阶段的衔接

### 8.1 进入测试（testing）的前置

- 评审结论为 APPROVED 或 APPROVED_WITH_COMMENTS
- 高危问题全部修复
- 安全扫描通过
- 复杂度达标

### 8.2 与任务型命令的关系

- `/new-feature` / `/bugfix` / `/design-*` 等命令内部走 review 阶段子集
- `/bugfix` 必须经过 review + 回归测试（COMMANDS.md §4.3）
- 任务型命令在 review 阶段也必须遵循本规则

### 8.3 与标记系统的关系

- 本阶段不创建新标记（标记在 req / arch 阶段创建）
- 检查所有标记所在文件已修改（COMMANDS.md §3.4）
- 标记 resolved 状态在 testing 阶段触发

### 8.4 与 hook 的关系

- `tool_call_after` 调 privacy-guard 对评审过程读到的代码做脱敏
- 评审报告本身不含敏感信息（如密钥值）

---

## 9. 阶段状态变更

按 WORKFLOW.md §4.2：

| 命令 | 状态转换 | 前置检查 |
|------|---------|---------|
| `/workflow advance` | in_progress → completed → 下一阶段 pending | 产出检查通过 |
| `/workflow goto testing` | any → testing in_progress | 本阶段 completed |
| `/workflow goto coding` | any → coding in_progress | 回滚（CHANGES_REQUESTED） |

完成后自动进入测试验证阶段（testing），加载 `rules/stage-testing.md`。
