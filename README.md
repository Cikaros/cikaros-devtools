# cikaros-devtools

> **Cikaros** 出品的 **Codex CLI 专用**本地插件市场（marketplace 名 `cikaros-devtools`）。
> 仓库不含任何 Claude/Claude Code 运行时依赖——hook、MCP server、模板与文案均以
> Codex 约定为基准（机构知识工件 `AGENTS.md`、非交互调用 `codex exec`、配置目录 `.codex/`）。

## 版本矩阵

| 组件 | 版本 | 说明 |
|------|------|------|
| 仓库发行版（marketplace 安装器） | **v1.13.13** | 审批等待通知轮次：Codex 审批弹窗 y/esc 出现在回合进行中——任务静默暂停而用户不知情；网络/端口命令放行时发 alert 级桌面通知把人叫回终端（在场窗口 120s 降噪，SDLC_NOTIFY_APPROVAL=off 可整类关闭），见 [CHANGELOG](CHANGELOG.md) |
| 插件 `specflow` | v1.2.4 | 结构化文档驱动工程化工作流 |
| 插件 `ai-sdlc` | v0.13.13 | AI-Native SDLC 六阶段闭环 + 输入分流（临时任务队列）+ 自然语言→MCP + 零操作手册注册 + 环境自检与跨平台脚本护栏 + MCP 启动链自定位 + 健壮性加固 + 跨进程并发锁 + 模块化分层重构 + macOS 通知交互重构 + Bash 门禁准确性修复 + 全流程模拟排错 + plan 接受通道与生命周期记忆 + 沙盒授权三层联动与 Playwright 受控安装 + 审批等待通知 |

完整变更历史：根 [CHANGELOG.md](CHANGELOG.md)（仓库级入口）；插件细粒度历史见各自 `docs/changes/CHANGELOG.md`。

## 插件一览

- **specflow** —— 结构化文档驱动的工程化工作流：Markdown 配置 + Codex 原生生命周期
  hooks + 标记驱动 TODO 状态机 + 产出/测试双门禁 + 事件总线 + 隐私脱敏 + 智能提示 +
  语言-工具链衔接 + 错误知识库 + DIY 合并引擎，零依赖离线运行。
- **ai-sdlc** —— 把 Anthropic《AI-Native SDLC playbook》（方法学出处，非运行时依赖）
  翻译成可执行的 Codex 生命周期 hooks。按工作区工件
  （intent.md → spec.md → plan.md → diff → PR → incident）自动检测当前阶段，
  **用户无需显式 @ 插件或 slash 命令即可走完 6 阶段闭环**；首次使用自动初始化
  （state 引导 + gitignore 托管块）；工件为任务中间产物，存 `.sdlc/` 工作区
  不入版本控制，任务结束归档即审计；门禁执行
  「代码不可变、文档可写」写入保护策略（`plugins/ai-sdlc/docs/write-policy.md`）；
  输入分流（v1.12.0）——用户输入三分类：需求/ISSUE 走 SDLC、补充信息融入当前
  周期工件、临时任务登记队列**待周期走完后统一处理（二者不混淆）**。

## 仓库结构

```
cikaros-devtools/                    ← 文件夹名固定，不带版本号
├── .agents/plugins/marketplace.json ← 本地 marketplace 清单
├── README.md / CHANGELOG.md         ← 本文件 / 仓库级版本历史
├── docs/RELEASE-CHECKLIST.md        ← 发布前检查清单
├── scripts/                         ← 仓库级安装/卸载（仅 marketplace 注册/移除，幂等）
│   ├── sh/{install,uninstall}.sh
│   └── ps/{install,uninstall}.ps1
└── plugins/
    ├── specflow/                    ← 工程化工作流插件
    │   ├── .codex-plugin/plugin.json
    │   ├── hooks/                   ← 6 个 Codex 原生 hook 脚本 + 合并引擎
    │   ├── .mcp.json                ← 4 个 MCP server（共 26 个工具）
    │   ├── prompts/                 ← 20 份操作手册（specflow）
    │   ├── rules/                   ← 阶段规则 + 脱敏规则单源
    │   ├── spec/                    ← 语言无关规范
    │   ├── templates/coding/        ← 13 语言 × 5 文档 + toolchains.json
    │   ├── templates-project/       ← 项目初始化模板 + 预设设计稿
    │   └── scripts/{sh,ps,lib}/     ← init-project / sf CLI / Python 库
    └── ai-sdlc/                     ← AI-Native SDLC 插件
        ├── .codex-plugin/plugin.json
        ├── hooks/                   ← 6 个 Codex 原生 hook + 工件驱动状态机
        │   └── scripts/             ← hook 脚本 + bootstrap-project.mjs（自动初始化）
        ├── .mcp.json                ← 1 个 MCP server（sdlc-orchestrator，23 个工具）
        ├── prompts/                 ← 18 份操作手册（ai-sdlc；可选注册为官方 /prompts: 形式）
        ├── skills/                  ← 7 个技能（6 阶段技能 + frontend-e2e）
        ├── rules/                   ← 6 份阶段规则 + 审查策略
        ├── templates/               ← 9 份模板（6 工件 + evals/CI/生产门禁）
        ├── spec/                    ← SDLC 基线 + 工件契约
        └── scripts/sh/              ← init-project（可选手动）/ sdlc CLI
```

> 安装脚本只做 marketplace 注册/移除，不安装具体 plugin；plugin 的启用/停用由用户在
> codex 会话内通过 `/plugins` 自行决定。

## 安装与卸载

**第 1 步 · 注册 marketplace**（仓库根目录，幂等可重复执行）：

```bash
bash scripts/sh/install.sh                              # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\ps\install.ps1   # Windows（PS 5.1+）
```

可选参数：`--yes` / `-Yes` 跳过确认；`--status` / `-Status` 仅查询注册状态。

**第 2 步 · 在 codex 会话内启用 plugin**：

1. 执行 `/plugins` 浏览 `cikaros-devtools` marketplace
2. 选择并启用需要的 plugin（specflow / ai-sdlc / 两者皆可）
3. 执行 `/hooks` 审查并信任启用 plugin 的 hooks

**第 3 步 · 进入项目使用（按需）**：

```bash
# specflow：生成 AGENTS.md、.specflow/（配置+运行时+DIY 目录）、docs/、.codexignore、git hooks
bash ~/.codex/plugins/specflow/scripts/sh/init-project.sh
powershell -ExecutionPolicy Bypass -File ~/.codex/plugins/specflow/scripts/ps/init-project.ps1

# ai-sdlc：无需手动初始化——启用插件后首个 codex 会话自动完成
#   （.sdlc/state.json + gitignore 托管块；工件不入版本控制）
# 手动预置模板（可选）：
bash ~/.codex/plugins/ai-sdlc/scripts/sh/init-project.sh
```

**卸载**（仓库根目录，幂等）：

```bash
bash scripts/sh/uninstall.sh
powershell -ExecutionPolicy Bypass -File scripts\ps\uninstall.ps1
```

卸载前请先在 codex 会话内 `/plugins` 停用已启用的 plugin。项目级运行时目录
（`.specflow/` / `.sdlc/`）可保留（含工件历史）或手工删除。

## 核心能力速览

### specflow

- **智能提示**：SessionStart 只注入资源索引（约 2KB，`additionalContextLimit` 4000 内）；
  UserPromptSubmit 反模式警告直接注入 + 阶段规则首次注入（去重）+ 语言资源只提示路径；
  PostToolUse 敏感信息检测 + 错误知识库匹配；Stop 提示 pending 错误。
- **13 语言 × 5 文档 + 67 条反模式 + 10 工具链**：每语言 5 份文档
  （spec / features / standards / anti-patterns / docs）；反模式命中直接注入警告
  （带语言过滤防跨语言误报）；`toolchains.json`（含 28 条 commonErrors）实现
  语言与工具链双向提示。
- **错误知识库**：双源匹配（toolchains.json commonErrors + 项目本地
  `.specflow/error-kb/`）→ 未匹配错误自动捕获到 pending → Stop 提示 →
  4 个 MCP 工具记录/清除/查询；3 种匹配策略（exact / regex / fuzzy-Levenshtein）。
- **产出与测试双门禁**：`workflow advance` 检查阶段产出声明（缺失阻塞）+ 按
  `test-executor.json` 真实执行测试（失败/超时阻塞，v1.2.4 起命令护栏：非空且 ≤2000 字符）。
- **隐私脱敏**：`rules/sensitive-rules.json` 单源 12 条（8 high / 4 low，银行卡过 Luhn）；
  工具输出命中 high → 注入脱敏改写版；git pre-commit 对暂存文件脱敏扫描，high 命中拒绝提交。
- **DIY 合并引擎**：详见下表与 `plugins/specflow/docs/requirements/DIY-ARCHITECTURE.md`。

**DIY 六维度的实际接线状态**（合并引擎在 SessionStart 执行一次，缓存到
`merged-config.json`，全部格式错误自动降级内置 + 告警）：

| 维度 | 自定义文件 | 状态 |
|------|-----------|------|
| 反模式 | `.specflow/anti-patterns.json` | ✅ 接线：追加到内置 67 条（去重 by id），UserPromptSubmit 消费 |
| hook 规则 | `.specflow/hooks/{pre,post}-tool-use.json` | ✅ 接线：deny/warn 由对应 hook 消费 |
| 阶段/工作流 | `.specflow/stages.md` + `.specflow/rules/stage-<name>.md` | ⚠️ 已装载校验，暂无运行时消费方 |
| 语言规则 | `.specflow/languages/<lang>/` | ⚠️ 同上（仅观测计数） |
| 知识库 | `.specflow/error-kb-config.json` | ⚠️ 同上（匹配策略以每份 KB 文件 frontmatter 为准） |
| MCP 工具 | `.specflow/mcp-tools.json` | ⚠️ 同上（未注册到 hook-orchestrator） |

### ai-sdlc

- **首次使用自动初始化**（v0.10.0）：插件自行监测新项目——首个会话即建
  state 引导 + `.gitignore` 托管块，无需手动 init；存量项目自动治愈补齐。
- **工件驱动状态机**：按工作区已存在的 intent.md / spec.md / plan.md + git 状态
  自动检测当前阶段（7 个状态：planning / design / build_plan / build_impl / test /
  deploy / maintain）。
- **零显式注入**：自然语言提问即可走完整套闭环；偏好显式调用可用官方 `/prompts:` 形式——**v0.13.2 起会话启动自动注册/刷新 18 份手册（零操作，升版自愈；卸载可 opt-out）**，手动刷新/卸载用 MCP `register_prompts` / `install-prompts.sh`（macOS/Linux）/ `install-prompts.ps1`（Windows）；跨平台脚本误调用会被 PreToolUse 能力感知护栏拦截并给出替代（v0.13.2）。
- **门禁即代码**（PreToolUse 强制）：plan 模式禁改代码、修复期禁改测试、无工单禁改
  迁移、生产部署需授权、未通过测试禁 push/PR、修复循环中断、运行时状态一律禁改。
- **工件工作区化**（v0.10.0）：工件是任务推进的中间产物，存 `.sdlc/` 工作区
  不入版本控制；任务/周期结束归档到 `.sdlc/archive/`（永不删除，本地审计链）。
- **闭环**：maintain 阶段产出新 intent.md → 旧周期工件归档（永不删除）→ 回到 planning，
  cycle_count 自增。
- **frontend-e2e 技能**（v0.8.0/v0.9.0）：Playwright 前端 E2E + 反检测阶梯
  （L1 原生加固 → L2 真实 Chrome → L3 stealth，合规硬边界）。
- **回合结束通知**（v0.11.0）：任务完成或需你决策/回答时系统弹窗+声音叫你
  回来（macOS / Windows / Linux；长任务必达、快答不扰；`SDLC_NOTIFY=off` 可关，
  详见插件 `docs/usage-guide.md`）。

## 命令参考（sf CLI）

```bash
sf.sh doctor              # 环境自检
sf.sh config show         # 显示合并后的配置
sf.sh config validate     # 校验自定义文件格式
sf.sh scan [path]         # 环境扫描
sf.sh todo [path]         # 扫描 TODO/FIXME 标记
sf.sh events [N|--json]   # 查看事件总线
sf.sh doc-version <cmd>   # 文档版本（show/bump/init/check）
sf.sh init                # 项目初始化
sf.sh init --guided       # 8 问引导式初始化
sf.sh init --type web     # 项目类型（web / api / cli / library / monorepo）
sf.sh workflow <cmd>      # 工作流状态（status/advance/goto/skip/…）
sf.sh sanitize <file>     # 隐私脱敏
```

> `templates-project/presets/` 下的 web-app / infrastructure / team-baseline 预设为
> 设计稿，当前无代码消费。

## 依赖

- Node ≥ 18（hooks 与 MCP server；零 npm 依赖）
- Python ≥ 3.8（环境扫描 / 配置解析 / 标记扫描；缺失时降级，可用 `SPECFLOW_PY` 指定）
- Codex CLI ≥ 0.142（插件系统与 hooks）

## 文档索引

- 版本历史：根 [`CHANGELOG.md`](CHANGELOG.md)；发布检查：[`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md)
- specflow：使用说明 `plugins/specflow/AGENTS.md`；使用指南 `plugins/specflow/docs/guides/usage-guide.md`；
  错误知识库指南 `plugins/specflow/docs/guides/error-kb.md`；组件参考
  `plugins/specflow/docs/components.md`；设计决策 `plugins/specflow/docs/decisions/`（ADR-001~009）；
  DIY 架构 `plugins/specflow/docs/requirements/DIY-ARCHITECTURE.md`；
  MCP 概览 `plugins/specflow/mcp/README.md`；变更日志 `plugins/specflow/docs/changes/CHANGELOG.md`
- ai-sdlc：使用说明 `plugins/ai-sdlc/AGENTS.md`、`plugins/ai-sdlc/README.md`；
  架构 `plugins/ai-sdlc/docs/architecture.md`；工件生命周期与隔离标准
  `plugins/ai-sdlc/docs/lifecycle.md`；写入保护策略 `plugins/ai-sdlc/docs/write-policy.md`；
  使用指南 `plugins/ai-sdlc/docs/usage-guide.md`；MCP 工具手册
  `plugins/ai-sdlc/mcp/sdlc-orchestrator/README.md`；变更日志 `plugins/ai-sdlc/docs/changes/CHANGELOG.md`

## 命名约定

| 概念 | 名字 |
|------|------|
| 仓库名 / 文件夹名 / marketplace 名 | `cikaros-devtools`（固定，不带版本号） |
| 发行包名 | `cikaros-devtools-v<repo-version>.zip` |
| 插件名 | `specflow` / `ai-sdlc` |
| 作者 | `Cikaros` |
