# specflow 使用指南

> 版本：v1.2.4 · 作者：Cikaros · 所属 marketplace：`cikaros-devtools`
> 目标读者：从零开始使用 specflow 的开发者，由浅入深。

## 目录

- [第 1 章：快速上手](#第-1-章快速上手)
- [第 2 章：工作流与标记驱动](#第-2-章工作流与标记驱动)
- [第 3 章：Slash 命令速查](#第-3-章slash-命令速查)
- [第 4 章：智能提示机制](#第-4-章智能提示机制)
- [第 5 章：语言规范与反模式](#第-5-章语言规范与反模式)
- [第 6 章：错误知识库与自动捕获](#第-6-章错误知识库与自动捕获)
- [第 7 章：工具链衔接](#第-7-章工具链衔接)
- [第 8 章：隐私脱敏与 git 门禁](#第-8-章隐私脱敏与-git-门禁)
- [第 9 章：DIY 自定义](#第-9-章diy-自定义)
- [第 10 章：团队协作](#第-10-章团队协作)
- [第 11 章：排障与自检](#第-11-章排障与自检)
- [附录 A：MCP 工具完整列表](#附录-amcp-工具完整列表)
- [附录 B：文件结构速查](#附录-b文件结构速查)
- [附录 C：环境变量](#附录-c环境变量)

---

## 第 1 章：快速上手

### 1.1 前置条件

| 依赖 | 版本 | 用途 |
|------|------|------|
| Codex CLI | ≥ 0.142 | 插件系统与 hooks |
| Node.js | ≥ 18 | hooks 与 MCP server（零 npm 依赖） |
| Python | ≥ 3.8 | 环境扫描 / 配置解析 / 标记扫描（缺失时降级） |

### 1.2 安装

> 安装流程为两步：先在仓库根目录注册 marketplace，再在 codex 会话内 `/plugins`
> 启用 plugin。

**第 1 步：注册 marketplace（仓库根目录运行）**

```bash
cd cikaros-devtools
bash scripts/sh/install.sh                                  # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\ps\install.ps1   # Windows（PS 5.1+）
```

安装器只做 `codex plugin marketplace add`（幂等）。`--yes` 跳过确认、`--status`
仅查询。

**第 2 步：在 codex 会话内启用 plugin**

1. 启动 codex 会话
2. `/plugins` → 浏览 `cikaros-devtools` marketplace → 选 specflow 启用
3. `/hooks` → 审查并信任 specflow 的 hooks
4. 重启会话（新会话才加载插件）

**卸载 marketplace**：`bash scripts/sh/uninstall.sh`（卸载前先在 `/plugins` 内
停用 specflow）。

### 1.3 初始化项目

```bash
cd ~/your-project
bash ~/.codex/plugins/specflow/scripts/sh/init-project.sh           # macOS/Linux
powershell -ExecutionPolicy Bypass -File ~/.codex/plugins/specflow/scripts/ps/init-project.ps1  # Windows
```

初始化生成：

```
your-project/
├── AGENTS.md                    ← 项目级 agent 指引
├── .specflow/
│   ├── config.md                ← 勾选式项目配置
│   ├── config.default.md        ← 团队基线
│   ├── error-kb/  error-kb-pending/   ← 错误知识库骨架
│   ├── hooks/                   ← DIY 自定义 hook 规则（空骨架）
│   ├── languages/               ← DIY 自定义语言模板（空骨架）
│   ├── rules/                   ← DIY 自定义阶段规则（空骨架）
│   └── workflow-state/          ← 工作流状态
├── .codexignore                 ← PreToolUse 拦截黑名单
├── .gitignore                   ← 追加 specflow 运行时忽略块
├── docs/
│   ├── requirements/REQUIREMENTS.md
│   ├── design/  decisions/  changes/CHANGELOG.md
│   └── cards/  guides/  manifest/  archive/
└── context/
    ├── current-sprint.md
    └── team-roster.yaml
```

### 1.4 验证与第一次使用

```bash
bash ~/.codex/plugins/specflow/scripts/sh/sf.sh doctor   # 环境自检
codex                                                      # 启动会话
ls .specflow/hooks-state.json                              # 会话启动后应出现
```

在 codex 会话里输入：

```
/new-feature 用户登录功能
```

specflow 会自动：检测「新功能」→ 进入需求分析阶段 → 注入阶段规则摘要 → 扫描环境
（语言/包管理器/测试框架）→ 创建 TODO 标记供后续跟踪。

---

## 第 2 章：工作流与标记驱动

### 2.1 五阶段工作流

```
req-analysis → arch-design → coding → review → testing
  需求分析      架构设计     编码     评审     测试
```

每个阶段有：**规则文件**（`rules/stage-<阶段>.md`，UserPromptSubmit 自动注入摘要）、
**产出物**（`config.md` 里声明，`advance` 时检查，缺失阻塞）。

### 2.2 推进阶段

```
sf.sh workflow status           # 查看当前阶段
sf.sh workflow advance          # 推进到下一阶段（产出检查 + 测试门禁）
```

`advance` 的行为：

1. 检查必需产出物是否存在 → 缺失则**阻塞**（写 output-check.json）
2. 若配置了 `test-executor.json` → 真实执行测试 → 失败/超时**阻塞**
   （`SPECFLOW_SKIP_TESTS=1` 可跳过；v1.2.4 起命令护栏：command 须非空字符串且
   ≤2000 字符）
3. 通过 → 标记该 agent 名下的 created TODO 为 resolved → 进入下一阶段
   （产出文档自动 minor bump 版本）

### 2.3 TODO 标记

在代码注释里写标记：

```python
# TODO#001 实现用户认证模块 [depends:TODO#002] [priority:high]
def authenticate(user, password):
    pass  # TODO#002 使用 bcrypt 哈希
```

- `TODO#NNN` / `FIXME#NNN` — 任务标记（created → resolved → deleted，3 态）
- `[depends:TODO#NNN]` — 依赖关系（`/todo start TODO#001` 前检查依赖，含环检测）
- 单文件限定：每个标记只改一个文件
- Python 文件 AST（tokenize）级扫描——字符串字面量里的 TODO#NNN 不误报

管理标记：

```
sf.sh todo "$(pwd)"              # 扫描所有 TODO/FIXME（--incremental/--no-cache 可选）
/todo start TODO#001             # 开始任务（检查依赖）
```

### 2.4 多 Agent 并行

```
sf.sh workflow create-agent --id api --name "API Agent" --stages coding,testing
sf.sh workflow create-agent --id docs --name "Docs Agent" --stages req-analysis
```

每个 Agent 有独立的阶段状态，互不干扰；`advance` 只推进当前 Agent。默认上限
5 个 agent（`CODEX_MAX_AGENTS` 可调）。

---

## 第 3 章：Slash 命令速查

### 3.1 主线命令（5 个）

| 命令 | 用途 | 阶段 |
|------|------|------|
| `/req-analysis` | 需求分析 | req-analysis |
| `/arch-design` | 架构设计 | arch-design |
| `/coding` | 编码实现 | coding |
| `/review` | 代码评审 | review |
| `/testing` | 测试验证 | testing |

### 3.2 任务型命令（13 个）

| 命令 | 用途 |
|------|------|
| `/new-feature` | 开始新功能开发 |
| `/bugfix` | 修复 bug |
| `/design-topdown` / `/design-bottomup` / `/design-bridge` / `/design-new` / `/design-module` | 设计类命令 |
| `/unit-test` / `/integration-test` | 编写测试 |
| `/setup-specflow` | 项目初始化 |
| `/todo` / `/workflow` / `/agent` | 标记 / 工作流 / Agent 管理 |

### 3.3 工具型命令（2 个）

| 命令 | 用途 |
|------|------|
| `/sanitize` | 隐私脱敏检查 |
| `/config` | 配置查看 |

---

## 第 4 章：智能提示机制

### 4.1 为什么不全量加载

旧版本 SessionStart 注入语言规范摘要、每次 prompt 注入阶段规则——浪费 token 且
分散注意力。v0.8.0 起按需注入：

| 层 | 时机 | 注入内容 | 大小 |
|----|------|---------|------|
| SessionStart | 会话启动 | 资源索引（有什么 + 怎么获取）+ 工程状态 | 约 2KB |
| UserPromptSubmit | 每次 prompt | 反模式警告 + 阶段规则（首次）+ 语言/工具链提示 | 0–2KB |
| PostToolUse | 工具输出后 | 敏感信息检测 + 错误知识库匹配 | 0–2KB |

### 4.2 反模式自动警告

prompt 含已知反模式时**直接注入警告**（无需用户主动查）：

```
用户输入：function f(x: any) { return x.foo }
specflow 注入：⚠ TypeScript 反模式：禁止用 any；用 unknown + 类型守卫收窄
```

67 条反模式规则覆盖 13 语言，带语言过滤（Java prompt 含 `: any` 不触发 TS 警告）。

### 4.3 去重与 token 预算

- 同一会话内已注入的规则/反模式不再重复注入
- 单次注入上限 2000 字符；累计上限 8000 估算 tokens（按 4 字符 = 1 token 估算）
- 超额时优先保留反模式警告

### 4.4 查看注入历史

```bash
cat .specflow/hooks-state.json     # 当前状态 + 已注入文件
cat .specflow/prompt-trace.json    # 上次 prompt 的检测详情
cat .specflow/loaded-sections.json # 所有已加载的文件 + token 估算
cat .specflow/hook-audit.json      # 完整审计日志（保留 500 条）
```

---

## 第 5 章：语言规范与反模式

### 5.1 13 语言 × 5 文档

每种语言 5 份文档（位于 `templates/coding/<lang>/`）：

| 文件 | 内容 |
|------|------|
| `spec.md` | 总览（语言版本、工具链、目录结构） |
| `features.md` | 语言特性（模型可能不全知道的部分） |
| `standards.md` | 编码规范（命名、格式化、错误处理、测试约定） |
| `anti-patterns.md` | 反模式与易错点（❌ bad / ✅ good 示例） |
| `docs.md` | 文档规范（注释约定、文档工具、README 结构） |

支持：C / C++ / C# / Go / Java / JavaScript / Kotlin / PowerShell / Python / Rust /
Shell / TypeScript / Zig。

### 5.2 反模式触发机制

1. UserPromptSubmit hook 扫描 prompt 文本
2. 匹配 `ANTI_PATTERN_TRIGGERS`（67 条）+ 自定义规则
   （`.specflow/anti-patterns.json`，✅ 已接线）
3. 命中时直接注入警告到 `additionalContext`；同一反模式 ID 会话内只注入一次

### 5.3 自定义语言模板与反模式

在 `.specflow/languages/<lang>/` 放文件可覆盖/新增语言模板（⚠️ 装载入
merged-config，暂无运行时注入消费方）；`.specflow/anti-patterns.json` 追加自定义
反模式（✅ 与内置合并去重，实时生效）：

```json
{
  "version": 1,
  "rules": [
    { "pattern": "console.log(", "lang": "typescript", "id": "no-console-log",
      "warn": "禁止 console.log；用 logger" }
  ]
}
```

---

## 第 6 章：错误知识库与自动捕获

### 6.1 双源匹配

PostToolUse hook 扫描工具输出错误时，从两个源头匹配修复方案：

| 源 | 内容 |
|----|------|
| `toolchains.json` 内嵌 commonErrors | 跨项目通用错误（28 条预置，按检测到的工具链过滤） |
| 项目本地 `.specflow/error-kb/<lang>/*.md` | 项目特定踩坑（递归 3 级；指定 lang 时先递归 `<lang>/` 再读顶层 .md 视为通用） |

### 6.2 自动捕获流程

```
用户跑 npm install nonexistent-pkg
  ↓ PostToolUse 检测到 "E404"（错误码优先，次选关键词）→ 未匹配知识库
  → 记录到 .specflow/error-kb-pending/<ts>-<hash>.json
  ↓ Stop hook 检查 pending → 注入提示「检测到 1 个未匹配错误：E404，是否记录？」
  ↓ Agent 询问用户
  → 确认 → MCP record_error（带 pending_file 确认并清空）→ 写入 .specflow/error-kb/javascript/xxx.md
  → 拒绝 → MCP dismiss_error → 清除 pending
  ↓ 下次同错误出现 → 自动匹配 → 直接注入修复方案
```

### 6.3 手动记录与匹配策略

手动创建 `.specflow/error-kb/<lang>/<日期>-<pattern摘要>.md`（frontmatter：
pattern / cause / fix 必填，lang 推荐）。frontmatter 可声明匹配策略：

| 策略 | 用途 | 示例 |
|------|------|------|
| `exact`（默认） | 精确子串匹配 | `E404` |
| `regex` | 正则匹配（编译失败降级 exact） | `Cannot find module '.*'` |
| `fuzzy` | Levenshtein 模糊匹配（阈值默认 3） | `ModuleNotFound` ≈ `module not found` |

### 6.4 MCP 工具与记录原则

`mcp__hook-orchestrator__{list_pending_errors, record_error, dismiss_error,
list_error_kb}` 四个工具支撑记录闭环。

**只记录模型默认不知道的内容**：✅ 项目特定踩坑、版本兼容性问题、环境特定的
诡异 bug；❌ 通用编程知识、语言基础语法、任何教程里都有的内容。
详见 `docs/guides/error-kb.md`。

---

## 第 7 章：工具链衔接

`toolchains.json`（10 个工具链配置）实现语言与工具链双向映射：

| 方向 | 触发 | 行为 |
|------|------|------|
| 正向 | 项目根有 `pom.xml`（浅层 2 级递归扫描） | 关联 java-jdk 工具链 → 提示 Java 语言规则 |
| 反向 | prompt 含 "Rust" 但项目根无 `Cargo.toml` | 提示用户可能缺少工具链配置 |

每个工具链内嵌 `commonErrors`——工具输出命中时自动注入修复方案（如 node-js 的
`EADDRINUSE`、rust-cargo 的 `cannot borrow .* as mutable`、python-pip 的
`ModuleNotFoundError`）。查看检测到的工具链：`sf.sh scan` 或 MCP `get_toolchain`。

---

## 第 8 章：隐私脱敏与 git 门禁

### 8.1 运行时脱敏（PostToolUse）

工具输出命中 high 级敏感规则（私钥 / OpenAI key / AWS AKID / GitHub token /
Slack token / JWT / 身份证 / 银行卡，共 8 条 high + 4 条 low，规则单源
`rules/sensitive-rules.json`，银行卡过 Luhn 防时间戳误伤）→ systemMessage 提醒 +
注入脱敏改写版本（后续引用以脱敏版为准）+ 完整脱敏版落盘
`.specflow/last-redaction.json`。

### 8.2 git hooks（真实门禁）

`install-git-hooks` 生成 pre-commit / post-checkout / post-merge：

- **pre-commit**：暂存文本文件（≤512KB/个）脱敏扫描，high 命中**退出码 1 拒绝
  提交**（`SPECFLOW_PRECOMMIT_SANITIZE=0` 可跳过）；lint 探测（警告不阻塞）；
  `test-executor.json` 的 run_on_commit=true 时跑测试（失败阻塞）；
  `SPECFLOW_PRECOMMIT_STRICT=1` 时 created 标记阻塞
- **post-checkout / post-merge**：依赖文件变更检测 + todo 状态刷新
- 插件自身故障一律放行（绝不阻塞 git）；报告落 precommit-report.json

### 8.3 主动脱敏

`sf.sh sanitize <file>`（--severity / --format / --audit 可选）或 MCP
`read_file_redacted` / `scan_output` / `redact_output`。

---

## 第 9 章：DIY 自定义

### 9.1 六个维度与接线状态

| 维度 | 文件 | 合并策略 | 接线 |
|------|------|---------|------|
| 反模式 | `.specflow/anti-patterns.json` | 追加到内置 67 条（去重 by id） | ✅ |
| hook 规则 | `.specflow/hooks/pre-tool-use.json` + `post-tool-use.json` | 自定义 deny/warn 规则 | ✅ |
| 阶段/工作流 | `.specflow/stages.md` + `.specflow/rules/stage-<name>.md` | 追加到内置 5 阶段后 | ⚠️ 未接线 |
| 语言规则 | `.specflow/languages/<lang>/` | 同名覆盖、新语言追加 | ⚠️ 未接线 |
| 知识库 | `.specflow/error-kb-config.json` | 目录组织 + 匹配策略 | ⚠️ 未接线 |
| MCP 工具 | `.specflow/mcp-tools.json` | 校验（禁 `../` 与绝对路径） | ⚠️ 未接线 |

> ⚠️ = 合并引擎装载并校验（`sf.sh config validate`），但当前无运行时消费方；
> ✅ = hook 实时消费。完整规范见 `docs/requirements/DIY-ARCHITECTURE.md`。

### 9.2 合并引擎

所有自定义内容在 SessionStart 时统一加载：

```
自定义文件 + 内置内容 → mergeAll() → .specflow/merged-config.json → hook 共享
```

格式错误时自动降级内置行为 + 告警（写 hook-audit）。

### 9.3 配置管理

```bash
sf.sh config show       # 显示合并后的配置
sf.sh config validate   # 校验 6 类自定义文件格式
```

### 9.4 自定义示例

`.specflow/stages.md`（阶段序列用表格 + 转换条件用 `codex:json` block）：

```markdown
---
version: 1
---
# 项目工作流阶段
## 阶段序列
| 序号 | 阶段名 | 说明 | 产出物 |
|------|--------|------|--------|
| 6 | deploy | 部署上线 | docs/deploy/checklist.md |
## 阶段转换条件
```codex:json
{ "transitions": { "testing→deploy": {
    "outputs": [{"path": "docs/deploy/checklist.md", "required": true}],
    "conditions": ["测试覆盖率 >= 80%"] } } }
```
```

`.specflow/hooks/pre-tool-use.json`：

```json
{
  "version": 1,
  "rules": [
    { "id": "block-rm-rf", "matcher": "bash", "pattern": "rm -rf /",
      "action": "deny", "reason": "禁止 rm -rf /" },
    { "id": "warn-prod-deploy", "matcher": "bash",
      "pattern": "kubectl apply.*--context=prod",
      "action": "warn", "reason": "建议先在 staging 验证" }
  ]
}
```

---

## 第 10 章：团队协作

### 10.1 配置与变量的生效层

- **变量层（vars.yaml，实际生效）**：环境变量（os.environ 基座）< 全局
  `~/.specflow/vars.yaml` < 项目 `vars.yaml`（doc-parser 模板渲染
  `{{var}}` 占位时合并）
- **checkbox 配置（config.md）**：解析为结构化数据，供 config-reader MCP 与
  `advance` 产出检查查询
- `.specflow/config.team.md` / `~/.specflow/config.personal.md` 的 6 层合并
  优先级（环境变量 > 个人 > 项目 > 团队 > 全局 > 内置）为规划中的设计，
  合并函数尚未接线到运行时

### 10.2 .codexignore 共享

`.codexignore` 定义 PreToolUse 拦截黑名单，进 git 团队共享：

```
.env
.env.*
!.env.example
*.log
secrets/
*.pem
*.key
```

匹配语义（v1.2.1+）：`*` 通配 / `*.ext` 后缀 / `name*` 前缀 / 精确或路径基名
匹配（`config/.env` 命中 `.env`，`.environment` 不误伤）；`!` 前缀白名单豁免。

### 10.3 引导式初始化（团队级）

`sf.sh init --guided` 8 问：项目名 / 作者 / 项目类型（web/api/cli/library/
monorepo）/ 主语言 / 包管理器 / 测试框架（答案写入 test-executor.json 作为真实
测试门禁命令）/ 阶段启用 / 严格度（standard/strict）。非 TTY 时可用
`--name --author --type --lang --pkg-manager --test-framework --stages
--strictness` 等价传参（CI 友好）。

> `templates-project/presets/` 下的 web-app / infrastructure / team-baseline
> 预设为设计稿，当前无代码消费。

---

## 第 11 章：排障与自检

### 11.1 环境自检

```bash
sf.sh doctor
```

检查：node 版本 / python 解释器 / hooks 脚本语法 / 三份 JSON 清单解析 /
4 个 MCP index.js / 7 个 Python 库 / 规则单源 / codex CLI。

### 11.2 常见问题

**Q: hooks 不生效？** 确认在 codex 会话里执行了 `/hooks` 并信任 specflow 的
hooks。未信任的 hooks 会被静默跳过。

**Q: `sf.ps1` 报 `#Requires` 错误？** v1.2.0 已移除所有
`#Requires -Version 7.0`，兼容 Windows 自带 PowerShell 5.1。

**Q: `sf.ps1` 中文乱码？** 所有 .ps1 文件带 UTF-8 BOM，PS 5.1 可正确识别。

**Q: git commit 报 `cannot spawn .git/hooks/pre-commit`？** git hooks 有
`#!/usr/bin/env bash` shebang，兼容 Windows 原生 git（v0.7.7 修复）。

**Q: `python3: command not found`？** 用 `SPECFLOW_PY` 环境变量指定解释器
（探测链：SPECFLOW_PY → python3 → python → Unix 绝对路径（非 Windows）→
py -3；git hook 场景解释器缺失一律放行）。

### 11.3 查看与清理运行时状态

```bash
cat .specflow/hooks-state.json        # hook 状态
cat .specflow/merged-config.json      # 合并后的配置
cat .specflow/hook-audit.json         # 审计日志（最近 500 条）
cat .specflow/events.jsonl            # 事件总线（500 行滚动，超限保留 400）
cat .specflow/prompt-trace.json       # 上次 prompt 检测详情
rm -f .specflow/hooks-state.json .specflow/merged-config.json \
      .specflow/hook-audit.json .specflow/events.jsonl       # 清理后自动重建
```

### 11.4 事件总线

`events.jsonl` 每行一个 JSON（`{ts, type, payload}`），12 个已登记类型：
marker_resolved / all_markers_resolved / batch_resolved / stage_enter /
stage_exit / session_start / session_end / git_pre_commit / git_post_checkout /
git_post_merge / test_run / doc_version_bumped。查看：`sf.sh events [N|--json]`。

---

## 附录 A：MCP 工具完整列表

| Server | 工具 |
|--------|------|
| hook-orchestrator（11） | on_session_start / on_subdir_enter / on_prompt_receive / on_tool_before / on_tool_after（排障用手动触发副本）/ get_hook_status / get_audit_log / list_pending_errors / record_error / dismiss_error / list_error_kb |
| config-reader（7） | get_config / get_config_key（dotted key）/ list_keys / get_config_flat / get_config_sources / set_config_key（返回编辑指引，不写文件）/ audit_log（恒空） |
| env-scanner（5） | get_env_summary / get_lang_stack / get_toolchain / check_tool / rescan（60s 缓存） |
| privacy-guard（3） | read_file_redacted（过 .codexignore 黑名单）/ scan_output / redact_output |

## 附录 B：文件结构速查

### 插件目录（`~/.codex/plugins/specflow/`）

```
plugins/specflow/
├── .codex-plugin/plugin.json      ← 插件清单
├── .mcp.json                       ← 4 个 MCP server 配置
├── hooks/
│   ├── hooks.json                 ← Codex 原生 hooks 定义
│   └── scripts/
│       ├── {session-start,user-prompt-submit,pre-tool-use,post-tool-use,stop,session-end}.mjs
│       ├── events.mjs             ← 事件总线共享模块
│       └── lib/
│           ├── common.mjs         ← 公共库（智能注入/知识库/Levenshtein）
│           └── merge-engine.mjs   ← 合并引擎（DIY 核心）
├── mcp/                            ← 4 个 MCP server + lib（概览见 mcp/README.md）
├── templates/coding/              ← 13 语言 × 5 文档 + toolchains.json + security.md
├── rules/                          ← sensitive-rules.json + 5 阶段规则 + team-conventions.md
├── spec/                           ← coding-standards.md + security-baseline.md
├── scripts/{sh,ps,lib}/           ← sf CLI / init-project / 11 个 Python 库
└── docs/                           ← 文档（guides/components/decisions/changes/requirements）
```

### 项目目录（初始化后）

```
your-project/
├── AGENTS.md
├── .specflow/
│   ├── config.md / config.default.md / .initialized
│   ├── hooks-state.json / merged-config.json / prompt-trace.json
│   ├── loaded-sections.json / hook-audit.json / events.jsonl
│   ├── todo-state.json / todo-cache.json / todo-resolved.json
│   ├── error-kb/ / error-kb-pending/
│   ├── hooks/ / languages/ / rules/          ← DIY 自定义
│   └── workflow-state/{global.json, agents/<id>.json}
├── .codexignore / .gitignore
├── docs/{requirements,design,decisions,changes,cards,guides,manifest,archive}/
└── context/{current-sprint.md, team-roster.yaml}
```

## 附录 C：环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `SPECFLOW_PY` | 强制指定 Python 解释器 | 自动探测 |
| `SPECFLOW_PROJECT_ROOT` | 指定项目根目录（MCP server） | 当前目录 |
| `SPECFLOW_SKIP_TESTS` | 跳过测试门禁（排障用） | 未设置 |
| `SPECFLOW_PRECOMMIT_STRICT` | STRICT 标记阻塞提交 | 未设置 |
| `SPECFLOW_PRECOMMIT_SANITIZE` | 置 0 跳过 pre-commit 脱敏扫描 | 未设置 |
| `CODEX_MAX_AGENTS` | 工作流 agent 上限 | 5 |

---

> 本指南覆盖 specflow v1.2.4 全部功能。如有疑问，跑 `sf.sh doctor` 自检或查看
> `docs/changes/CHANGELOG.md` 了解版本变更。
