---
title: 团队约定
type: requirement
semantic: rule
version: 1.0.0
last_modified: 2026-09-01T18:00:00+08:00
author: specflow
status: active
refs:
  - docs/requirements/REQUIREMENTS.md
---

# 团队约定（rules/team-conventions.md）

> **本文档是团队工作流约定，属于 `semantic: rule` 层，全局加载。**
>
> 与 `spec/` 的不可变基线不同，本文件**可由团队按需调整**——分支策略、PR 规范、Code Review 流程等可按团队习惯修改。
>
> 修改建议：团队评审通过后 bump version 并记录到 CHANGELOG。

---

## 1. 分支策略

### 1.1 主流分支模型（推荐 Git Flow 简化版）

| 分支 | 来源 | 生命周期 | 用途 |
|------|------|---------|------|
| `main` | — | 永久 | 生产可发布版本，受保护 |
| `develop` | `main` | 永久 | 集成分支，下一个 release 的开发主线 |
| `feature/<slug>` | `develop` | 临时 | 单个功能开发，合并后删除 |
| `bugfix/<slug>` | `develop` | 临时 | 单个 bug 修复，合并后删除 |
| `hotfix/<slug>` | `main` | 临时 | 生产紧急修复，合并到 `main` 与 `develop` |
| `release/<version>` | `develop` | 临时 | 发布前准备（版本号 / CHANGELOG），合并到 `main` + `develop` |

### 1.2 分支命名规范

- `<type>/<issue-id>-<slug>` 形式：`feature/AUTH-101-user-login` / `bugfix/PAY-205-refund-zero`
- slug 用 kebab-case，≤ 30 字符
- 不用个人名：`feature/zhangsan-login` ❌
- 不用模糊词：`feature/update` / `bugfix/fix` ❌

### 1.3 小团队简化（≤ 5 人）

可直接用 GitHub Flow：

- `main` + `feature/*` / `bugfix/*` 两层
- 不用 `develop` 与 `release/*`
- PR 合并到 `main` 即发布

### 1.4 分支保护

- `main` 与 `develop` 必须保护：
  - 禁止直接 push
  - 必须通过 PR 合并
  - 至少 1 人 approve
  - CI 必须通过
  - 分支必须 up-to-date 才能合并

---

## 2. PR 规范

### 2.1 PR 标题

遵循 Conventional Commits：

- `feat(auth): 添加用户登录功能`
- `fix(payment): 修复退款金额为 0 的 bug`
- `docs(api): 更新用户接口文档`

### 2.2 PR 描述模板

```markdown
## 背景

<为什么做这个改动？关联 Issue / TODO#NNN>

## 变更

<做了哪些改动？分点列出>

## 测试

- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 手动测试 <场景>

## 风险

<可能影响的范围 / 已知风险>

## Checklist

- [ ] 代码已自审
- [ ] 注释已补充（Why 而非 What）
- [ ] 文档已同步
- [ ] CHANGELOG 已更新
```

### 2.3 PR 粒度

- **一个 PR 一个逻辑变更**：不把多个无关功能塞一个 PR。
- **PR diff ≤ 500 行**（含增删）：超过应拆分。
- **PR 文件数 ≤ 20**：超过应拆分。
- **避免"巨型 PR"**：1000+ 行的 PR 评审质量必然下降，应拆为多个小 PR。

### 2.4 PR 评审时效

- 评审请求后 **4 工作小时内**响应（同意 / 修改意见 / 拒绝）。
- 超时未响应可 @ 备选评审人或升级。
- 紧急 PR（hotfix）需 **1 小时内**响应。

### 2.5 PR 合并方式

| 方式 | 何时用 | 备注 |
|------|-------|------|
| Squash merge | feature 单一逻辑 | 推荐——保留干净历史 |
| Rebase merge | feature 多提交但相关 | 保留每次提交历史 |
| Create merge commit | 大特性多子 PR 集成 | 保留分支拓扑 |

---

## 3. Code Review 规范

### 3.1 评审维度（10 个）

| # | 维度 | 关注点 |
|---|------|--------|
| 1 | 功能正确性 | 是否解决了 Issue？happy / edge / failure case 都覆盖？ |
| 2 | 可读性 | 命名是否清晰？逻辑是否直观？注释是否解释 Why？ |
| 3 | 可维护性 | 是否过度抽象？是否重复代码？是否易扩展？ |
| 4 | 性能 | 是否有 N+1 查询？是否有内存泄漏？是否有不必要循环？ |
| 5 | 安全 | 是否有 SQL 注入 / XSS？密钥是否硬编码？权限是否校验？ |
| 6 | 测试 | 测试是否充分（happy + edge + failure）？覆盖率达标？ |
| 7 | 错误处理 | 是否吞错？错误是否分类？是否有降级？ |
| 8 | 日志 | 是否打印 PII？日志级别是否合适？是否有 trace_id？ |
| 9 | 文档 | 公共 API 是否有文档注释？CHANGELOG 是否更新？ADR 是否需要？ |
| 10 | 一致性 | 是否遵循项目编码规范？是否与现有代码风格一致？ |

### 3.2 评审语言

- **对事不对人**：用"这段代码可以优化为..."而非"你写得不好"。
- **提建议而非命令**：用"建议..."而非"必须..."（除非规范要求）。
- **解释 Why**：每条意见说明理由，便于作者理解。
- **区分"必须改" vs "建议改" vs "可选"**：
  - `Must`：违反规范 / 有 bug / 安全问题
  - `Should`：可优化但不阻塞合并
  - `Nit`：风格小事，可忽略

### 3.3 评审时效

- 收到 review 请求后 4 工作小时内开始评审。
- 评审一次 < 30 分钟（超过应拆分为多次）。
- 评审后作者 24 小时内响应（修改或回复意见）。

### 3.4 评审者选择

- 至少 1 人评审，重要变更（架构 / 安全 / 性能）至少 2 人。
- 评审者中至少 1 人熟悉该模块。
- 鼓励跨团队评审（避免知识孤岛）。
- 作者可主动 @ 特定评审者（如模块 owner）。

---

## 4. 发布流程

### 4.1 版本号（SemVer）

- `MAJOR.MINOR.PATCH`（如 `1.2.3`）
- MAJOR：不兼容的 API 变更
- MINOR：向后兼容的新功能
- PATCH：向后兼容的 bug 修复

### 4.2 发布前检查清单

- [ ] 所有 PR 已合并到 `develop` / `main`
- [ ] CI 全绿（lint + test + build + 安全扫描）
- [ ] CHANGELOG 已更新（Added / Changed / Deprecated / Removed / Fixed / Security）
- [ ] 版本号已 bump
- [ ] 文档已同步（README / API docs / ADR）
- [ ] 数据库迁移已验证（若涉及）
- [ ] 回滚方案已准备

### 4.3 发布步骤

1. 从 `develop` 拉 `release/<version>` 分支
2. bump 版本号（package.json / pyproject.toml / go.mod 等）
3. 更新 CHANGELOG（[Unreleased] → [version] - date）
4. 提 PR 合并到 `main`（含版本号 + CHANGELOG）
5. 合并后打 git tag `v<version>`
6. CI 触发构建 + 发布到包管理器 / 部署到生产
7. 把 `release/<version>` 反向合并回 `develop`

### 4.4 灰度发布

- 大版本（MAJOR）必须灰度：
  - 内部测试环境 → 预发环境 → 5% 生产 → 25% → 50% → 100%
  - 每阶段观察 24 小时无异常后扩大
- 紧急回滚：发现严重问题立即回滚到上一稳定版本

### 4.5 Hotfix 流程

1. 从 `main` 拉 `hotfix/<slug>` 分支
2. 修复 + 测试 + bump patch 版本
3. 提 PR 合并到 `main`
4. 合并后打 tag + 发布
5. 反向合并到 `develop`
6. 更新 CHANGELOG § Fixed

---

## 5. 值班（On-call）

### 5.1 值班轮换

- 主值班 + 备值班 2 人轮换
- 周一轮换（周一 09:00 至下周一 09:00）
- 排班表提前 2 周发布到 `context/oncall-schedule.yaml`
- 调换需双方确认 + 通知团队

### 5.2 响应时效

| 严重度 | 响应时间 | 处理时间 | 示例 |
|--------|---------|---------|------|
| P0（生产宕机） | 5 分钟 | 1 小时 | 服务不可用 / 数据丢失 |
| P1（核心功能异常） | 15 分钟 | 4 小时 | 支付失败 / 登录异常 |
| P2（次要功能异常） | 1 小时 | 1 工作日 | 部分页面 500 |
| P3（体验问题） | 4 小时 | 1 周 | 文案错误 / 样式错位 |

### 5.3 升级机制

- P0 / P1 主值班无法在响应时效内处理时立即升级到备值班
- 备值班也无法处理时升级到团队负责人
- 涉及安全的（数据泄漏 / 攻击）立即通知安全团队 + 负责人

### 5.4 值班交接

- 周一上午 09:00 交接
- 交接内容：未关闭的告警 / 进行中的 incident / 待跟进问题
- 交接形式：口头 + `context/oncall-handover.md` 记录

---

## 6. 知识管理

### 6.1 文档分类

| 类型 | 位置 | 维护者 | 修改频率 |
|------|------|--------|---------|
| 需求文档 | `docs/requirements/` | PM + 开发 | 每个迭代 |
| 设计文档 | `docs/design/` / `docs/component/cards/` | 开发 | 每个特性 |
| 决策记录 | `docs/decisions/ADR-*.md` | 评审决策者 | 一次性（不再改） |
| 变更记录 | `docs/changes/CHANGELOG.md` | 发布者 | 每次发布 |
| 团队约定 | `rules/team-conventions.md` | 团队负责人 | 按需 |
| 编码规范 | `spec/coding-standards.md` | 安全 + 架构 | 按 ADR 流程 |
| 安全基线 | `spec/security-baseline.md` | 安全团队 | 按 ADR 流程 |

### 6.2 文档更新原则

- **代码变更同步更新文档**：PR 必须含文档变更（若涉及）。
- **过时文档标记 deprecated**：不直接删，先标记 `status: deprecated` + `superseded_by: <path>`，给读者过渡期。
- **重大决策走 ADR**：影响多组件 / 难以回滚的决策必须写 ADR。

### 6.3 知识传承

- 新人入职：阅读 `docs/requirements/REQUIREMENTS.md` + `docs/decisions/ADR-*.md` + `docs/component/cards/*.md`
- 模块 owner 轮换：原 owner 给新 owner 做 1 小时讲解 + 走读代码
- 离职：原 owner 必须完成知识传承（写 `docs/component/cards/` + 视频讲解）

### 6.4 技术分享

- 双周一次技术分享（30 分钟 + 15 分钟 Q&A）
- 主题：新工具 / 踩坑总结 / 性能优化 / 安全实践
- 分享材料归档到 `docs/guides/`

---

## 7. 沟通约定

### 7.1 Issue 管理

- **每个 Issue 必须有：背景 / 复现步骤 / 期望 / 实际 / 截图 / 日志**
- **优先级标签**：P0 / P1 / P2 / P3
- **类型标签**：bug / feature / docs / refactor / security
- **模块标签**：auth / payment / user / order / ...
- **负责人**：每个 Issue 必须有人负责（即使"待分配"也要指定 triage 者）

### 7.2 站会

- 每日 09:30 站会（≤ 15 分钟）
- 三句话：昨天做了什么 / 今天计划做什么 / 有什么阻塞
- 阻塞问题不在站会讨论，会后单独拉会

### 7.3 周会

- 每周五 16:00 周会（≤ 1 小时）
- 内容：本周进展 / 下周计划 / 风险与决策 / 技术债
- 周会前更新 `context/weekly-report.md`

### 7.4 异步沟通

- 非紧急问题用 Issue / 文档评论，不用即时消息
- 紧急问题（P0 / P1）用即时消息 + 电话
- 重要决策必须留文档（不在口头会议中定）

---

## 8. 团队约定修改流程

1. 提 Issue 描述修改原因与影响
2. 团队周会讨论通过
3. 提 PR 修改本文档
4. 至少 2 人 approve
5. 合并后 bump version + 更新 CHANGELOG

历史变更见 `docs/changes/CHANGELOG.md`。
