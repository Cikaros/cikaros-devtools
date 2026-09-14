---
title: 需求分析阶段规则
type: requirement
semantic: rule
stage: req
version: 1.0.0
last_modified: 2026-09-01T18:00:00+08:00
author: specflow
status: active
refs:
  - docs/requirements/REQUIREMENTS.md
  - docs/requirements/WORKFLOW.md
  - docs/requirements/COMMANDS.md
---

# 需求分析阶段规则（rules/stage-req-analysis.md）

> **本文档是需求分析阶段（stage: req）的可调规则，仅在此阶段携带，阶段结束后卸载。**
>
> 加载策略：`on_prompt_receive` hook 检测当前阶段为 req 时加载。

---

## 1. 阶段目标

把模糊的业务诉求转化为清晰、可验证、可追踪的需求规格——产出 PRD + 验收标准 + 风险清单，作为后续阶段的契约。

进入条件：项目已初始化（`.specflow/.initialized` 存在）
退出条件：产出清单全部通过（详见 §4）

---

## 2. 必做产出

按 COMMANDS.md §3.5 / WORKFLOW.md §5.1，本阶段产出：

| 产出 | 路径 | 必选 | 规范 |
|------|------|------|------|
| PRD（产品需求文档） | `docs/requirements/<feature>-<YYYYMMDD>.md` | ✅ | 详见 §3.1 |
| 验收标准 | 含在 PRD 内（§验收标准章节） | ✅ | Given/When/Then 形式 |
| 风险清单 | `docs/requirements/<feature>-risks.md` 或含在 PRD 内 | ❌ 可选 | 至少列出技术 / 业务 / 进度三类风险 |
| 需求版本 | `docs/requirements/<feature>.version` | ✅ | SemVer，初始 0.1.0 |

---

## 3. PRD 内容规范

### 3.1 必含章节

```markdown
# <Feature 名> — PRD

## 1. 背景与目标
   - 业务背景：为什么做？解决什么问题？
   - 目标：可衡量的目标（如"用户登录成功率 ≥ 99.5%"）
   - 非目标：明确不做什么，避免范围蔓延

## 2. 用户故事
   - 作为 <角色>，我希望 <行为>，以便 <价值>
   - 至少 3 个核心用户故事

## 3. 功能需求
   - 按模块拆分，每个功能点列：
     - 描述
     - 输入 / 输出
     - 业务规则
     - 异常处理

## 4. 非功能需求
   - 性能：响应时间 / 并发量 / 数据量
   - 安全：认证 / 授权 / 数据保护
   - 可用性：SLA / 容灾
   - 兼容性：浏览器 / 设备 / 系统

## 5. 验收标准
   - 用 Given/When/Then 形式表达
   - 每个用户故事至少 3 条验收标准（happy + edge + failure）

## 6. 风险与依赖
   - 技术风险：未知技术 / 第三方依赖
   - 业务风险：法规 / 合规 / 用户接受度
   - 进度风险：依赖其他团队 / 外部条件

## 7. 里程碑
   - 按周拆分关键节点
   - 每个节点列产出与验收

## 8. 开放问题
   - 待确认的设计决策（标记 {{TODO:xxx}}）
```

### 3.2 验收标准写法

```markdown
### AC-1: 用户用正确密码登录成功

**Given** 用户已注册且账号激活
**When** 用户输入正确的邮箱和密码
**Then** 系统返回 200 + session token
**And** 用户被重定向到首页
```

### 3.3 不捏造原则

- 业务背景缺失 → `{{TODO:补充业务背景}}`，不编造
- 用户角色不清 → `{{TODO:确认目标用户}}`
- 非功能需求不清 → `{{TODO:与产品确认性能要求}}`

不填默认值（CONVERGENCE.md §0.2 核心价值 4 不捏造原则）。

---

## 4. 产出检查（on_stage_exit hook）

`on_stage_exit` hook 按 WORKFLOW.md §5.2 检查：

1. **文件存在性**：
   - `docs/requirements/<feature>-<YYYYMMDD>.md` 存在
   - `docs/requirements/<feature>.version` 存在
2. **文件非空**：size > 0
3. **必含章节**：PRD 含 8 个必含章节（§3.1）
4. **验收标准格式**：每条 AC 含 Given/When/Then
5. **不捏造检查**：扫描 `{{TODO:xxx}}` 占位数量，> 5 个时 warning（不阻塞，但提示用户补充）

任一失败则阻塞进入下一阶段，提示用户补齐。

---

## 5. 阶段内禁止行为

### 5.1 禁止写代码

- 本阶段**不写实现代码**——只写需求文档。
- 可写伪代码 / 流程图说明逻辑，但不创建 `src/` 下文件。
- 若发现需先做技术调研，标记 `{{TODO:技术调研}}` 留给架构阶段。

### 5.2 禁止跳过验收标准

- 每个用户故事必须有验收标准——验收标准是后续测试阶段的契约。
- 不能用"系统正常工作"等模糊描述。
- 必须用 Given/When/Then 形式，可被自动化测试脚本解析。

### 5.3 禁止范围蔓延

- 非目标章节必须明确——把"看起来相关但本期不做"的功能列入非目标。
- 新增需求需走变更流程：bump PRD version + 更新 CHANGELOG。

---

## 6. 阶段内推荐实践

### 6.1 用户故事拆分

- 大故事拆成多个小故事：每个故事可在 1 个迭代内完成。
- 用 INVEST 原则检查：Independent / Negotiable / Valuable / Estimable / Small / Testable。

### 6.2 验收标准与测试用例对应

- 每条 AC 对应至少 1 个测试用例（在测试阶段生成）。
- AC 编号 `AC-1` / `AC-2`...，测试用例 `test_ac_1_*` 形式命名。

### 6.3 风险评估

- 技术风险标记 `[tech-risk]`：未知技术 / 性能瓶颈 / 第三方依赖
- 业务风险标记 `[biz-risk]`：法规 / 合规 / 用户接受度
- 进度风险标记 `[schedule-risk]`：依赖其他团队 / 外部条件
- 每个风险列：发生概率（高 / 中 / 低）+ 影响（高 / 中 / 低）+ 缓解措施

### 6.4 里程碑对齐

- 里程碑按周拆分，每周一个关键节点
- 每个节点列：产出 / 验收 / 负责人
- 里程碑与团队迭代节奏对齐（如双周迭代）

---

## 7. 与其他阶段的衔接

### 7.1 进入架构设计（arch）的前置

- PRD 已通过产出检查（§4）
- 验收标准已确认（产品 / 开发双方）
- 风险已识别且有缓解措施

### 7.2 与任务型命令的关系

- `/new-feature <desc>` 内部走 req 阶段子流程（COMMANDS.md §3）
- 任务型命令在 req 阶段也必须遵循本规则
- 任务型命令的 PRD 命名按 COMMANDS.md §3.6：`<feature-slug>-<YYYYMMDD>.md`

### 7.3 与标记系统的关系

- 本阶段创建 TODO 标记：每个规划修改的文件一个标记（COMMANDS.md §3.4）
- 标记 ID 从 `.specflow/todo.version` 分配
- 标记 `[depends]` 关系在架构阶段声明，本阶段仅创建标记

---

## 8. 阶段状态变更

按 WORKFLOW.md §4.2：

| 命令 | 状态转换 | 前置检查 |
|------|---------|---------|
| `/workflow start <agent>` | (none) → pending | Agent 不存在 |
| `/workflow advance` | in_progress → completed → 下一阶段 pending | 产出检查通过 |
| `/workflow goto arch` | any → arch in_progress | 本阶段 completed 或 skipped |
| `/workflow skip` | in_progress → skipped | 用户确认 |

完成后自动进入架构设计阶段（arch），加载 `rules/stage-arch-design.md`。
