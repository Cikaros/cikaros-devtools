---
title: 项目适配与用户 DIY 架构需求
type: requirement
semantic: spec
version: 1.1.0
last_modified: 2026-09-08T00:00:00+08:00
author: Cikaros
status: active
refs:
  - docs/decisions/ADR-009-diy-architecture.md
---

# 项目适配与用户 DIY 架构需求

## 1. 背景与目标

specflow v0.9.2 提供的是**固定**工程化框架：固定 5 阶段工作流、固定 13 语言模板、
固定 67 条反模式、固定 10 个工具链、固定 hook 行为与错误知识库结构。不同项目类型
（Web 应用 / 嵌入式 / 数据管线 / 基础设施 / 学术研究）对流程的需求差异巨大，用户
要么忍受固定框架，要么 fork 源码。

DIY 架构的目标：**不 fork 源码**（通过 `.specflow/` 下的声明式配置实现）、
**不破坏框架**（自定义与内置共存，可继承可覆盖）、**可观测**（加载/校验/命中全程
可追踪）。所有自定义通过 Markdown/YAML/JSON 文件声明，不改 hook 脚本源码、不改
plugin.json / hooks.json / .mcp.json 格式、不做跨项目分发。

## 2. 实现状态总览（v1.2.4 对照）

合并引擎（`hooks/scripts/lib/merge-engine.mjs`）已于 v1.1.0 交付：SessionStart
执行一次，六维度统一装载，结果缓存 `<运行时目录>/merged-config.json`，格式错误
降级内置 + 告警。各维度的**运行时接线状态**：

| 维度 | 自定义文件 | 装载校验 | 运行时消费方 | 状态 |
|------|-----------|---------|-------------|------|
| 反模式 | `.specflow/anti-patterns.json` | ✅ | user-prompt-submit.mjs（追加去重） | **✅ 生效** |
| hook 规则 | `.specflow/hooks/{pre,post}-tool-use.json` | ✅ | pre/post-tool-use.mjs（deny/warn） | **✅ 生效** |
| 阶段/工作流 | `.specflow/stages.md` + `.specflow/rules/stage-<name>.md` | ✅ | 无（detectStage 为内置 5 阶段硬编码） | ⚠️ 未接线 |
| 语言规则 | `.specflow/languages/<lang>/` | ✅（观测计数） | 无 | ⚠️ 未接线 |
| 知识库 | `.specflow/error-kb-config.json` | ✅ | 无（匹配策略以每份 KB frontmatter 为准） | ⚠️ 未接线 |
| MCP 工具 | `.specflow/mcp-tools.json` | ✅（禁 `../`/绝对路径） | 无（hook-orchestrator 不读取） | ⚠️ 未接线 |
| 配置层级 | config.team.md / config.personal.md | 合并函数已实现（common.mjs loadMergedConfig） | 无调用方 | ⚠️ 未接线 |
| 项目预设 | `templates-project/presets/<type>/preset.json` | — | 无（`init --type` 实际取值见 §5） | ⚠️ 设计稿 |

> ⚠️ 维度的自定义文件会被 `sf.sh config validate` 校验并进入 merged-config.json
> （`sf.sh config show` 可查看），但当前无 hook/CLI 在运行时消费其语义——接线前
> 不要依赖这些维度改变行为。

## 3. 已接线维度详细规范

### 3.1 反模式自定义（`.specflow/anti-patterns.json`）

```json
{
  "version": 1,
  "rules": [
    {
      "pattern": "console.log(",
      "lang": "typescript",
      "id": "no-console-log",
      "warn": "禁止 console.log；用 logger 或 debug 模块"
    },
    {
      "pattern": "reentrancy",
      "lang": "solidity",
      "id": "no-reentrancy",
      "warn": "重入攻击风险；用 checks-effects-interactions 模式"
    }
  ]
}
```

规则：`pattern`（≤100 字符，防 ReDoS）/ `lang` / `id` / `warn` 均必填；与内置
`ANTI_PATTERN_TRIGGERS` **追加合并**（去重 by id，重复跳过 + 告警）；语言过滤
与内置规则同语义（检测到的语言 ≠ 规则所属语言时跳过）。

### 3.2 hook 行为自定义（`.specflow/hooks/*.json`）

**PreToolUse 拦截规则**（pre-tool-use.json）：

```json
{
  "version": 1,
  "rules": [
    { "id": "block-terraform-destroy", "matcher": "bash",
      "pattern": "terraform destroy", "action": "deny",
      "reason": "禁止 terraform destroy；用 terraform plan -destroy 先审查" },
    { "id": "warn-prod-deploy", "matcher": "bash",
      "pattern": "kubectl apply.*--context=prod", "action": "warn",
      "reason": "建议先在 staging 验证" }
  ]
}
```

**PostToolUse 检测规则**（post-tool-use.json）：

```json
{
  "version": 1,
  "rules": [
    { "id": "detect-console-log", "matcher": "apply_patch|Edit|Write",
      "pattern": "console\\.log\\(", "severity": "warn",
      "message": "检测到 console.log；建议用 logger" },
    { "id": "detect-todo-without-id", "matcher": "apply_patch|Edit|Write",
      "pattern": "//\\s*TODO(?!#\\d)", "severity": "warn",
      "message": "TODO 缺少 ID 标记；用 //TODO#NNN 格式" }
  ]
}
```

规则：`id` / `pattern` 必填（pattern ≤100 字符，正则须可编译并含 matcher 校验）；
pre 规则缺 `action` 默认 warn，post 规则缺 `severity` 默认 warn；`matcher` 为
工具名正则（`^(?:matcher)$` 匹配）；deny → `permissionDecision: "deny"`，
warn → 放行 + 提醒；命中写 hook-audit.json。

## 4. 未接线维度的声明格式（供校验与未来接线）

### 4.1 阶段/工作流（`.specflow/stages.md` + `.specflow/rules/stage-<name>.md`）

阶段序列用 Markdown 表格（人类可读），转换条件用 `codex:json` block（机器可解析，
与 config.md 的产出声明格式一致）：

```markdown
---
version: 1
---
# 项目工作流阶段
## 阶段序列
| 序号 | 阶段名 | 说明 | 产出物 |
|------|--------|------|--------|
| 1 | requirement | 需求分析 | docs/requirements/REQUIREMENTS.md |
| 6 | deploy | 部署上线（自定义新增） | docs/deploy/checklist.md |
## 阶段转换条件
```codex:json
{ "transitions": { "testing→deploy": {
    "outputs": [{"path": "docs/deploy/checklist.md", "required": true}],
    "conditions": ["测试覆盖率 >= 80%"] } } }
```
```

自定义阶段规则（`.specflow/rules/stage-<name>.md`）：frontmatter 只保留 flat
key-value（`stage` / `order`），门禁规则用 `codex:json` block（gate type 枚举：
`file_exists` / `test_coverage` / `changelog_updated` / `no_strict_todos` /
`lint_passed`；severity 枚举：`block` / `warn`；未知 type 降级 warn + 告警）。
解析失败回退内置 5 阶段 + 告警。

> ⚠️ 当前 `sf.sh workflow advance` 与 UserPromptSubmit 阶段检测均按内置 5 阶段
> 执行，stages.md 不改变运行行为。

### 4.2 语言规则（`.specflow/languages/<lang>/`）

同名覆盖内置 `templates/coding/<lang>/`、新语言（如 solidity）追加；当前仅被
合并引擎装载计数，注入仍提示内置路径。

### 4.3 知识库（`.specflow/error-kb-config.json`）

声明目录组织（`by-lang` 默认 / `by-module` / `flat`）与全局匹配策略
（`exact` 默认 / `regex` / `fuzzy`，fuzzyThreshold 0-10 枚举校验）。当前
**不生效**——本地知识库的匹配策略以每份文件 frontmatter 的 `matchStrategy` 为准
（每份独立声明 exact / regex / fuzzy-Levenshtein，阈值默认 3）。

### 4.4 配置层级（规划中）

规划 6 层优先级：环境变量（`SPECFLOW_*`）> 个人 `~/.specflow/config.personal.md`
> 项目 `.specflow/config.md` > 团队 `.specflow/config.team.md` > 全局
`~/.specflow/config.md` > 内置 `config.default.md`；每层只覆盖已声明项，未声明
继承下层。合并函数 `loadMergedConfig` 已实现但**尚未接线**——当前实际生效的变量层
为 doc-parser 的 3 层（os.environ 基座 < 全局 `~/.specflow/vars.yaml` < 项目
`vars.yaml`）。

### 4.5 MCP 工具（`.specflow/mcp-tools.json`）

声明自定义工具（`name` / `command` 必填，可选 args / events / matcher；命令
禁止 `../` 与绝对路径——REQ-SEC-02）。规划注册到 hook-orchestrator 事件总线、
复用审计/状态基础设施、失败不阻塞主流程（A7 原则）。当前 hook-orchestrator 不
读取该文件。

## 5. 项目类型预设（现状澄清）

`sf.sh init --type` 的**实际**取值：`web / api / cli / library / monorepo`
（记入 vars.yaml 的 project.type，配合 `--lang --pkg-manager --test-framework`
等价传参，测试框架答案写入 test-executor.json 作为真实测试门禁命令）。

`templates-project/presets/` 下的 `web-app / infrastructure / library /
team-baseline` 四份 preset.json 为**设计稿**（规划中「6 阶段含 deploy」「4 阶段
terraform 流水线」「团队基线」等场景的预设蓝图），当前无代码消费，传入会被
argparse 拒绝。

## 6. 通用需求（合并引擎契约）

| 需求 ID | 描述 | 状态 |
|---------|------|------|
| REQ-MERGE-01 | 合并引擎统一装载全部自定义文件 + 内置内容，按维度策略产出最终规则集 | ✅ |
| REQ-MERGE-02 | 结果缓存 `<运行时目录>/merged-config.json`（含 merged_at，可观测） | ✅ |
| REQ-MERGE-03 | SessionStart 执行一次，所有 hook 共享 | ✅ |
| REQ-MERGE-04 | 文件缺失/格式错误 → 该维度回退内置 + 告警写 hook-audit.json | ✅ |
| REQ-MERGE-05 | 合并引擎为纯函数，可独立测试 | ✅ |
| REQ-COMPAT-01 | 无任何自定义文件时行为与 v0.9.2 一致 | ✅ |
| REQ-COMPAT-02 | 格式错误降级不阻塞 | ✅ |
| REQ-COMPAT-03 | 自定义文件可部分声明 | ✅ |
| REQ-OBS-01/02 | `sf.sh config show` / `config validate` | ✅（show 读取 merged-config；validate 校验 6 类文件 JSON 语法） |
| REQ-SEC-01 | 反模式 pattern ≤100 字符防 ReDoS | ✅ |
| REQ-SEC-02 | MCP 工具命令路径校验 | ✅（装载层） |
| REQ-SEC-04 | hook 规则正则编译失败 try/catch 降级 | ✅（100ms 超时未实现） |
| REQ-WF / REQ-LANG / REQ-KB / REQ-CFG / REQ-MCP 运行时消费 | 见 §2 接线状态 | ⚠️ 待接线 |

## 7. 风险与约束

| 风险 | 缓解措施 |
|------|---------|
| 自定义规则过多影响 hook 性能 | 建议反模式 ≤100 条 + hook 规则 ≤50 条 |
| 用户 pattern 正则 ReDoS | pattern 长度 ≤100 字符；编译失败降级精确匹配 |
| 自定义 MCP 工具执行恶意命令 | 命令路径限制项目根内（禁 `../`/绝对路径）；失败不阻塞主流程 |
| 自定义与未来版本冲突 | 自定义文件带 `version` 字段；升级时检查兼容性 + 告警 |
| 配置层级过深调试困难 | `sf.sh config show` 显示合并后配置与警告 |

## 8. 术语表

| 术语 | 定义 |
|------|------|
| DIY | 用户按项目需要自定义 specflow 行为（声明式配置，不 fork 源码） |
| 自定义文件 | 用户在 `.specflow/` 下创建的声明式配置文件 |
| 内置 | specflow 插件自带内容（templates/ / rules/ / ANTI_PATTERN_TRIGGERS 等） |
| 合并 | 自定义与内置按规则组合（同名覆盖 / 数组追加去重 / 对象浅合并） |
| 接线 | 合并结果被运行时（hook/CLI）实际消费 |
| 产出物 | 阶段完成时必须存在的文件 |
| 反模式 | 代码中应避免的模式（如 `: any`） |
