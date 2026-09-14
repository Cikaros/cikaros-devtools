---
title: 项目适配与用户 DIY 架构决策
type: decision
status: accepted
decided_at: 2026-09-03
deciders: [Cikaros]
refs:
  - docs/requirements/DIY-ARCHITECTURE.md
  - docs/decisions/ADR-001-plugin-vs-project-boundary.md
  - docs/decisions/ADR-002-markdown-as-config.md
  - docs/decisions/ADR-004-output-driven-closure.md
  - docs/decisions/ADR-007-project-dir-specflow-observability-path.md
---

# ADR-009: 项目适配与用户 DIY 架构

> 合并引擎已实施（v1.1.0+）。各维度的**运行时接线状态**以
> `docs/requirements/DIY-ARCHITECTURE.md` §2 为准（阶段/语言/知识库/MCP/
> 配置层级当前为「已装载校验、暂无消费方」）。

## 背景

specflow v0.9.2 提供固定框架（5 阶段 / 13 语言 / 67 条反模式 / 10 工具链 /
固定 hook 行为）。不同项目类型需求差异巨大，此前用户只能 fork 源码改硬编码
常量，代价高且不可持续。

## 决策

### D1：声明式自定义 + 合并引擎（不 fork、不写代码）

用户在 `.specflow/` 下创建声明式配置（Markdown/JSON）自定义行为。拒绝插件
系统/Lua/WASM（运行时依赖 + 安全风险 + 学习成本，与「Markdown 即配置」哲学
冲突）；拒绝全量替换（违背开箱即用，用户只写差异部分，内置兜底）。

### D2：六维度的合并策略

| 维度 | 自定义位置 | 合并策略 |
|------|-----------|---------|
| 阶段/工作流 | `.specflow/stages.md` + `.specflow/rules/stage-<name>.md` | 追加到内置 5 阶段后；同名覆盖 |
| 语言规则 | `.specflow/languages/<lang>/` + `.specflow/anti-patterns.json` | 模板同名覆盖；反模式追加去重 |
| hook 行为 | `.specflow/hooks/{pre,post}-tool-use.json` | 自定义 deny/warn 规则 |
| 知识库 | `.specflow/error-kb-config.json` | 目录组织 + 匹配策略声明 |
| 配置层级 | config.team.md + config.personal.md | 6 层优先级（见 D3） |
| MCP 工具 | `.specflow/mcp-tools.json` | 注册声明（路径安全约束） |

### D3：配置层级 6 层优先级

环境变量（`SPECFLOW_*`，CI/CD）> 个人 `~/.specflow/config.personal.md` >
项目 `.specflow/config.md` > 团队 `.specflow/config.team.md` > 全局
`~/.specflow/config.md` > 内置 `config.default.md`。每层只覆盖已声明项。
（实施状态：合并函数已实现，尚未接线运行时——见 DIY-ARCHITECTURE §2。）

### D4：hook 规则用 JSON 而非 Markdown/YAML

hook 规则需要 pattern（正则）+ matcher + action + severity 等结构化字段——JSON
类型系统最适合；Node 内置 JSON.parse 而无 YAML parser（零依赖）；YAML 缩进
敏感易错。阶段规则仍用 Markdown（人类可读优先，frontmatter + 正文 +
codex:json block 三段式已被 doc-parser 支持）——**格式选择与使用场景匹配**。

### D5：自定义 MCP 工具的安全边界

命令路径必须相对项目根（禁 `../` / 绝对路径）；执行失败不阻塞主流程（A7
原则）；输出走审计基础设施；执行有超时。不禁止用户自定义命令——集成项目特定
工具是 DIY 的实际价值，约束已足够防风险。

### D6：知识库匹配策略 3 种

exact（默认，错误码）/ regex（可变路径，ReDoS 防护 + 编译失败降级）/ fuzzy
（Levenshtein，拼写变体；误报率较高故为 P2，v1.1.0 已实现）。默认 exact——
大部分错误码是固定字符串，regex 有风险与开销，需要时 frontmatter 显式声明。

### D7：自定义文件生命周期

生成（init 写入 `version: 1`，已存在则保留用户文件）→ 校验
（`sf.sh config validate`：JSON 语法 / 必填字段 / 枚举 / pattern 长度 / 路径
安全）→ 迁移（升级时打 migration guide，**不自动迁移**——自定义文件是用户
资产，合并引擎做版本兼容 graceful degradation）。

### D8：版本兼容性

向后兼容（旧格式自动补全默认值）；向前不兼容（高版本文件降级内置 + 告警）；
升级显式执行。格式变更 → major bump；当前所有自定义文件格式 v1。

## 后果

- 正面：按项目 DIY 不 fork；声明式零学习成本；合并让自定义与内置共存；
  `config show` 可观测
- 负面：合并引擎增加 SessionStart 开销（预估 <50ms）；格式错误需降级处理；
  6 个维度各有使用文档（维护成本）
- 中性：`--type` 预设模板需持续维护（当前 presets/ 为设计稿，见
  DIY-ARCHITECTURE §5）；社区分享配置由用户自行 git 管理

## 与现有 ADR 的关系

ADR-001（DIY 在项目边界内）；ADR-002（阶段规则沿用 Markdown，hook 规则 JSON
为 D4 例外）；ADR-004（自定义阶段沿用产出驱动模型）；ADR-007（自定义文件放
`.specflow/` 下）。
