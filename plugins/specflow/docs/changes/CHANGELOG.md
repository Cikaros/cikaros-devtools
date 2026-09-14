# Changelog — specflow

specflow 插件的重要变更记录（v0.7.8 起仓库从 `codex-plugin-demo` 更名为
`cikaros-devtools`；历史条目保留原仓库名引用作为决策记录）。
格式遵循 [Keep a Changelog 1.0](https://keepachangelog.com/zh-CN/1.0.0/)，
版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
仓库级发行历史见仓库根 CHANGELOG.md。

## [Unreleased]

### Changed（文档层重构）

- 依据代码实测重写全部文档：AGENTS.md / usage-guide / error-kb / DIY-ARCHITECTURE /
  ADR ×9 精简；7 份 v0.x 时代组件卡合并为 `docs/components.md`（按 v1.2.4 实际
  工具名与行为重写）；4 个 MCP README 合并为 `mcp/README.md`；本 CHANGELOG 去铺陈
- **移除 v0.x 旧需求文档归档目录**（v1.2.0 归档的 7 份需求文档与 manifest-v0.2）
- 澄清 DIY 六维度运行时接线状态（反模式 + hook 规则已接线；阶段/语言/知识库/
  MCP 工具/配置层级「已装载校验、暂无消费方」）与 `init --type` 实际取值
  （web/api/cli/library/monorepo）；修正 MCP 工具清单、资源索引体积（约 2KB）
  等失实表述

## [1.2.4] — 2026-09-08

> 安全加固轮（与仓库 v1.9.0 / ai-sdlc v0.9.0 同批）。

### Fixed

- mcp-lite.js（4 个 server 共用 stdio 底座）：单行 JSON-RPC 长度护栏
  （> 1 MiB 拒绝解析并记 stderr，`MAX_LINE_CHARS` / `isLineAllowed` 导出）
- workflow-state.py 测试执行器输入护栏：test-executor.json 的 command 必须为
  非空字符串且 ≤ 2000 字符（TEST_COMMAND_MAX_LEN），异常/超长拒绝执行并留痕；
  docstring 显式声明信任边界

## [1.2.3] - 2026-09-07

> Codex 适配收尾轮 + 安全修复（配合仓库发行版 v1.3.1）。

### Fixed（安全）

- pre-tool-use.mjs `matchToken` 路径绕过：v1.2.1 精确匹配过度收紧，
  `config/.env` 等带目录写法无法命中 `.env` → 增加路径基名匹配分支
  （`token.endsWith('/'+pattern)`），防误报语义不变（`.environment` 不命中），
  回归 7 用例全过

### Removed

- `adapters/` 跨 CLI 适配层整体移除（claude-code/cursor/aider/continue/generic）：
  marketplace-only 重构后为死代码，且与 Codex 专用定位冲突

### Migration

- 无需迁移：adapters/ 自仓库 v1.3.0 起已不可达；曾直接调用
  `adapters/<cli>/adapter.sh` 的用户改用 marketplace 流程

## [1.2.2] - 2026-09-07

> 安装流程重构轮（配合仓库级 marketplace 安装器，仓库 v1.3.x）。

### Changed

- 移除插件级 install/uninstall 脚本与 classic 模式（直接写 ~/.codex/hooks.json /
  config.toml 的兜底安装方式）；config.toml / hooks.json 描述 / doctor /
  hooks-export（默认输出 ./hooks.exported.json，不再写 ~/.codex/hooks.json）/
  4 个 MCP README 同步；文档安装章节改为两步流程

### Added

- 仓库根目录新增 `scripts/{sh,ps}/{install,uninstall}.{sh,ps1}`（marketplace
  注册/移除，幂等）

### Migration

- 旧版升级：仓库根 install.sh 注册 marketplace → 会话内 /plugins 启用；
  classic 副本可手工删除；项目级 `.specflow/` 不受影响

## [1.2.0] - 2026-09-03

> 文档收敛轮：归档 v0.x 旧需求文档，重写 README + AGENTS.md。

### Changed（文档收敛）

- 归档 7 份 v0.x 需求文档至 v0.x-requirements 归档目录（描述 v0.2 时代
  设计，与 v1.2.0 代码严重脱节；该归档目录后于文档重构轮移除，见 [Unreleased]）
- 重写 README.md 与 AGENTS.md 为 v1.2.0 实际能力；ADR-009 状态
  proposed→accepted；DIY-ARCHITECTURE 状态 draft→active；ADR README 修正
  （仓库名 / ADR-009 状态）；spec/coding-standards.md 语言列表 6→13；
  error-kb.md 更新自动捕获描述（v0.9.2 已实装）

## [1.1.1] - 2026-09-03

> 审计修复轮：v1.1.0 审计发现 P0×2 + P1×9 + P2×2 + P3×5 共 18 项。

### Fixed

- **P0-1** session-start 合并引擎告警写入 hook-audit（空循环体修复）；
  **P0-2** 传 ANTI_PATTERN_TRIGGERS 给 mergeAll（merged-config.json 成为真正
  单一事实源）
- **P1** mergeAntiPatterns 设 customCount；validateHookRules 加 matcher 校验；
  pre/post-tool-use regex 编译 try/catch；删死代码；fuzzyMatch 文本上限 8000
  （防 50K 文本阻塞）；matchPattern ReDoS 防护；gitignore.tpl 修复 DIY 子目录
  被全量忽略；sf.ps1 补 config 子命令
- **P2** sf.sh config validate 补 error-kb-config.json + mcp-tools.json；
  init-project.sh 用探测链替代硬编码 python3
- **P3** 版本号同步、注释修正、消息优化

## [0.9.2] - 2026-09-03

> 反模式规则扩充（22→67 条，4→13 语言）+ 错误知识库自动捕获。

### Added

- 9 个新语言各 5 条反模式（C / C++ / C# / JavaScript / Rust / Zig / Kotlin /
  Shell / PowerShell）
- **错误知识库自动捕获**：PostToolUse 检测错误关键词 → 未匹配知识库 → 记录
  `.specflow/error-kb-pending/` → Stop 提示询问用户 → MCP 工具记录/清除；
  新增 4 个 MCP 工具（list_pending_errors / record_error / dismiss_error /
  list_error_kb）；common.mjs 新增 detectErrorInOutput / recordPendingError /
  readPendingErrors / confirmPendingError / dismissPendingError

### Fixed

- shell LANG_KEYWORDS 移除 `function `（TS/JS prompt 被误识别为 shell）；
  Java `Optional.get(` pattern 放宽为 `.get()`（靠语言过滤）；
  语言检测 java 抢占 javascript（同命中数按关键词长度降序）

## [0.9.1] - 2026-09-03

> v0.9.0 的修复与优化轮。审计发现错误知识库功能**链路彻底断裂**
> （记录函数无调用方 + 本地匹配不递归子目录）等多个 bug。

### Fixed（P0）

- matchLocalErrorKb 改递归遍历（最大 3 级，lang 指定时先 `<lang>/` 再顶层）；
  PostToolUse 从 hooks-state 读 current_language 传入
- 反模式跨语言误报加语言过滤（检测语言 ≠ 规则语言时跳过，未检出仍触发）
- LANG_DIR_MAP 移除硬编码 5 语言映射，改目录存在性检查（支持 13 语言）
- shell-toolchain 特征文件改 glob 形态（*.sh 等）；detectToolchains 加浅层
  2 级递归（排除 node_modules 等）
- recordErrorToKb 文件名改 sha1 前 12 位（防 Unicode 模式冲突覆盖）；
  frontmatter 解析健壮化（CRLF / 单双引号 / 转义）

### Changed

- session-start 简化 langSpecDigest 计算；hooks-state schema 统一
  `current_language`；buildResourceIndex 补全 v0.9.0 资源项
- init-project.py 新增 `.specflow/error-kb/` 目录骨架

### Removed

- `hooks/manifest.md`（v0.3.0 起自标 deprecated）移入归档目录（后随归档一并
  移除）；MCP resources 移除 hooks://manifest；
  移除 GIT_HOOKS_INSTALLER 死常量与 LANG_DIR_MAP 硬编码

## [0.9.0] - 2026-09-03

> 语言扩展 + 语言-工具链衔接 + 错误知识库。核心原则：**只记录模型默认不知道
> 的内容**。

### Added

- **语言模板扩充 4 → 13 语言**（各 5 份文档，共 45 份）：C / C++ / C# /
  JavaScript / Rust / Zig / Kotlin / Shell / PowerShell——聚焦版本特定行为、
  工具链配置、语言独有反模式
- **语言-工具链衔接**：`templates/coding/toolchains.json`（10 工具链，内嵌 28
  条 commonErrors）——正向：特征文件 → 工具链 → 提示语言规则；反向：prompt
  含语言关键词但无特征文件 → 提示缺配置
- **错误知识库（双源匹配）**：toolchains.json commonErrors + 项目本地
  `.specflow/error-kb/<lang>/*.md`（frontmatter：pattern/cause/fix/lang）；
  common.mjs 新增 loadToolchains / detectToolchains / toolchainsForLanguage /
  matchKnownErrors / matchLocalErrorKb / recordErrorToKb / errorKbDir /
  smartInjectV2
- LANG_KEYWORDS 扩展到 13 语言；post-tool-use 重写（敏感 + 已知错误双检测）；
  user-prompt-submit 升级 smartInjectV2

## [0.8.0] - 2026-09-03

> 智能提示机制 + 语言模板扩充 + skill 重命名。

### Added

- **语言模板扩充**：TypeScript / Python / Go / Java 各 4 份新文档（features /
  standards / anti-patterns / docs，反模式每份 ≥11 对 bad/good 示例）
- **智能提示机制**：三层注入——SessionStart 只注入资源索引（上下文 ~3KB →
  ~1KB）；UserPromptSubmit 按需注入（反模式警告直接注入 / 阶段规则首次注入 /
  语言资源只提示路径）；去重（injected_files / injected_anti_patterns）+
  token 预算（单次 2000 字符 / 累计 8000 tokens，超额保留反模式）
- common.mjs 新增 LANG_KEYWORDS / ANTI_PATTERN_TRIGGERS（21 条）/ smartInject /
  estimateTokens / buildResourceIndex；user-prompt-submit 重写

### Changed

- skill 重命名 specflow-workflow → workflow（去掉反复强调的插件名前缀）

## [0.7.9] - 2026-09-03

> Codex 官方 schema 合规修复：plugin.json 补 3 个 interface 必填字段
>（developerName / category / capabilities）；skills 声明修复（新增
> specflow-workflow SKILL.md）；longDescription 过时描述（git hooks「非质量
> 门禁」——v0.6.0 起已是真门禁）改为如实描述。补 homepage / repository /
> websiteURL / defaultPrompt / brandColor 推荐字段。

### Verified

- marketplace.json / plugin.json / hooks.json（6 事件名 + `${PLUGIN_ROOT}`）/
  .mcp.json 对照 Codex 官方 schema 全部合规。此前对照 Claude Code 文档做的
  audit 把 Codex 正确约定（`.codex-plugin/` 目录、`.agents/plugins/` 路径、
  prompts/ 目录、`~/.codex/` 配置等）误标为 P0——两个产品的合法差异，不是 bug

## [0.7.8] - 2026-09-03

> 仓库重命名 `codex-plugin-demo` → `cikaros-devtools`（仓库/marketplace/目录
> 结构统一）。ADR 文档保留原仓库名引用（决策记录反映当时事实）；代码零改动
>（路径均相对仓库根或基于 PLUGIN_ROOT，与仓库名无关）。

## [0.7.7] - 2026-09-03

> 修复 Windows 原生 git 提交 hooks 无法执行（`cannot spawn
> .git/hooks/pre-commit`）。

### Fixed

- install-git-hooks.ps1 生成的 hook 加 `#!/usr/bin/env bash` shebang（Windows
  原生 git / TortoiseGit 需要；Git Bash 不需要）；hook body 改 bash 脚本内部
  调 powershell 执行 sf.ps1；sf.ps1 绝对路径烧录（不再 $PSScriptRoot 上溯）；
  powershell 解释器路径烧录（受限 PATH 兜底）；init-project.py 显式传
  -ProjectRoot 参数

## [0.7.6] - 2026-09-02

> marketplace 重命名 `specflow` → `cikaros-devtools`（容器与内容同名混淆；
> displayName 改 Cikaros DevTools）+ 作者信息修正（author.name → Cikaros）。
> install/uninstall 同步 marketplace 名与移除调用。

## [0.7.5] - 2026-09-02

> 移除非官方插件安装 hack，回归纯官方安装流。

### Removed

- `install_user_plugin_copy`（v0.5.0 引入的程序化复制到
  `~/.codex/plugins/specflow/`——Codex 不认该目录里的插件，「看似已装实则
  没装」的假象是 auto 模式回退 classic 写 hooks.json 造成的）

### Changed

- install 重写：marketplace 注册 → 探测 codex plugin 子命令面 → 未生效则打印
  /plugins 指引（不偷偷复制）；auto 模式不再自动回退 classic；uninstall 改用
  官方 `codex plugin remove`（`uninstall` 子命令从未存在）

## [0.7.4] - 2026-09-02

> v0.7.3 的 Windows 真机验证修复轮。

### Fixed

- sensitive-rules.json 在 PS 5.1 上误报非法 JSON（Get-Content -Raw 无 BOM 按
  ANSI 解析）→ 3 处加 `-Encoding UTF8`
- node 缺失时 doctor 7 次重复报错 → 先一次性检测再跳过循环；
  `codex plugin` 子命令解析把英文文档段落当子命令 → 收紧正则 + 黑名单

### 关键认知（PS 5.1 编码矩阵）

写 .ps1 需 BOM；读无 BOM 文件需 -Encoding UTF8；写 config.toml / AGENTS.md /
manifest 禁 BOM（下游解析器禁止）。

## [0.7.3] - 2026-09-02

> v0.7.2 的 Windows 真机紧急修复。

### Fixed

- 5 个 .ps1 文件首部加 UTF-8 BOM（PS 5.1 对无 BOM .ps1 按 ANSI 解析，中文
  乱码破坏引号配对级联解析错误——v0.7.2 统一 BOM-less 对 .ps1 是过度修正）；
  Write-FileNoBom 函数注释加固（仅用于下游禁 BOM 的文件）

## [0.7.2] - 2026-09-02

> Windows 兼容修复轮（此前从未执行级验证）。

### Fixed（Windows 硬故障）

- 移除全部 `#Requires -Version 7.0`（PS 5.1 直接拒绝执行）；唯一 PS 7+ 三元
  运算符改 if 表达式
- PS 5.1 `Set-Content -Encoding utf8` 写 BOM 损坏 config.toml（TOML 禁 BOM）→
  WriteAllText BOM-less；Add-Content 默认 OEM 编码损坏中文 → UTF8 读 +
  BOM-less 写
- init-project.py 子进程 `python3` 在 Windows 静默失败（官方安装器只有
  python.exe / py.exe）→ 新增 `_resolve_python()` 跨平台探测链；无 Git Bash
  时崩溃 → 按平台分发 + try/except 降级 warn；git author 的 USER →
  USER/USERNAME 回退

### Added

- `scripts/ps/install-git-hooks.ps1`（PowerShell 版 git hooks 安装器，与 bash
  版对称：PATH 兜底 + 缺失守卫 + 退出码兜底）

### Changed

- init 输出指引按平台分支（Windows 用 notepad / powershell）；init-project.ps1
  加固（Python 探测链 / -Python 参数）；Python 探测链按平台守卫（Windows 不试
  Unix 绝对路径）；指引文本统一 `powershell -ExecutionPolicy Bypass -File`

## [0.7.1] - 2026-09-02

> 用户实测反馈第 2 轮 + 深度审查轮（决策记录：ADR-008）。

### Added

- init 时把 `.specflow/` 写入已存在的 `.gitignore`（`ensure_specflow_gitignore`
  幂等非破坏追加——此前 gitignore.tpl 仅在 .gitignore 不存在时落地，真实项目
  几乎都有）

### Fixed

- PreToolUse 白名单豁免改**目标级**判定（此前整段文本级，`cat .env.example
  .env` 会串门放行 `.env`）；三处路径层 RUNTIME_MARKERS 对齐（JS 侧缺 7 项）；
  SPECFLOW_PY 覆盖口径统一（hooks 与 MCP 此前忽略）；doc-parser 缓存指纹三
  盲区（变量源 / 时间变量 / env 引用键）；last-redaction.json 落盘完整脱敏正文

### Changed

- init 收尾指引诚实化（git hooks 已是真门禁）；运行不再写 `__pycache__`
  （PYTHONDONTWRITEBYTECODE=1 全启动点 + ast.parse）；sf.sh 帮助补全子命令

## [0.7.0] - 2026-09-02

> 用户实测反馈修复轮（macOS 真机 v0.6.0 三项反馈 + 顺带实锤 1 个隐藏 P0）。
> 决策记录：ADR-007。

### Changed

- **项目级目录统一 `.specflow/`**（原 `.codex-plugin/` + `.codex/` 双目录）；
  三处同语义路径层（sfpaths.py / common.mjs / sf-paths.js，新布局优先 + legacy
  回退）；旧项目重跑 init 自动迁移（非破坏）；全局默认配置
  `~/.codex-plugin/` → `~/.specflow/`；不改名边界：插件树
  `.codex-plugin/plugin.json` 与项目 `.codexignore`
- PreToolUse 拒绝理由列出具体被拦截目标（`*.log → /path/app.log`，最多 3 条）

### Fixed

- Python 探测链加固（PATH → Unix 绝对路径 → py；此前兜底 py 是 Windows 专属，
  macOS GUI git 受限 PATH 全落空报 command not found）；烧录的 git hook 补
  PATH；解释器缺失输出可读错误 + SPECFLOW_PY 逃生口（git hook 场景放行）
- 【隐藏 P0】sf.sh git-* 动作名不匹配（原样传 `git-pre-commit` 给只认
  `pre-commit` 的 git-hooks.py）→ 剥前缀 + 退出码兜底

## [0.6.0] - 2026-09-02

> 外围路线全量落地。决策记录：ADR-006。

### Added

- **事件总线**（events.py + events.mjs 双语言写 `{ts,type,payload}`；发射方：
  todo/workflow/session/git hooks/test_run/doc_version；`sf.sh events` 查看器；
  滚动 500 行）
- **git hooks 真跑**（git-hooks.py 替代 v0.4.0 提示性桩）：pre-commit = 高敏
  阻塞 + lint 警告 + 配置测试阻塞 + STRICT 标记；post-checkout/merge = 依赖
  变更检测 + todo 刷新；插件故障一律放行
- **真实测试执行器**（test-executor.json：command/timeout/stages/
  run_on_advance/run_on_commit）；advance 真跑测试失败/超时阻塞；
  SPECFLOW_SKIP_TESTS=1 跳过
- **跨 CLI 适配器**（adapters/ 5 个，`--target/--all/--interactive`；v1.2.3
  已移除）
- **doc-version.py**（show/bump/init/check/bump-outputs + advance 自动 minor
  bump）；**引导式初始化**（--guided 8 问，非交互等价参数，答案落 vars.yaml +
  test-executor.json）；**规则单源 rules/sensitive-rules.json**（12 条
  high/low + CARD Luhn，JS/Python 运行时同加载，缺失 fail-loud）；
  Go/Java spec.md；config.default.md 团队基线；A4 深度扫描（docs_tree /
  top_churn_files / CI / coverage 检测）

### Changed

- todo-scanner：mtime 增量缓存 + Python AST 级扫描（tokenize，字符串不误报）；
  doc-parser：schema 校验（默认 warning）+ yaml/toml 导出 + mtime 缓存；
  sanitize.py 改加载规则单源（--severity 分级，文案统一 `<SECRET:*>`，退出码
  3 = 规则源缺失）；PowerShell 全量对齐

## [0.5.0] - 2026-09-02

> macOS 真实环境实测修复版（bash 3.2 + BSD awk + 真实 codex CLI）。
> 决策记录：ADR-005。

### Fixed

- awk 版本比较语法错误（GNU/BSD 文法均不接受）→ `ver_to_int` 纯 bash；
  `codex plugin install` 子命令不存在 → 安装器改官方流（marketplace 注册 +
  子命令探测 + /plugins 指引）；bash 3.2 全角字符变量名崩溃（`$VAR（` →
  `${VAR}（`，全仓扫描清零）

## [0.4.0] - 2026-09-02

> v0.3.2 bug 清零 + 虚假声明修正 + 五条主链路接线闭环（实现度约 55% → 80%）。

### Fixed

- **P0 契约断裂**：doc-parser 新增 config_flat 扁平视图（嵌套/扁平两视图同源，
  get_config_key 永远 undefined 的问题）；build_variables 合并顺序修复
  （env 基座 → env-scan → 全局 vars → 项目 vars 逐层覆盖）；todo-scanner 行内
  尾随标记漏扫修复
- **P1**：depends 元数据误报 issue_ref；next_id 滞后一拍；单选多 (x) 取第一个
  + warning；select_type 可产生 multi；hooks-state 回写 current_stage；银行卡
  规则加 Luhn 校验（时间戳/订单号不再误伤）；classic 装后补 /hooks 信任指引
- **P2 声明不实修正**：manifest.md 标 deprecated；git hooks 描述改为真实行为；
  stop.mjs 头注释；CODEX_MAX_AGENTS_HARD=1 硬拒绝

### Added

- **产出声明导入链路**（ADR-004：config.md 的 outputs 声明 + import-outputs
  子命令）；**标记 resolved 最小闭环**（advance 产出检查通过 → created 标记写
  todo-resolved.json；/todo start 依赖门控）；**default agent 自动创建**；
  loaded-sections.json 可观测；TypeScript/Python spec.md + security.md；
  7 个主线 prompts（总数 20）；已有项目扫描（project-snapshot.json +
  todo-list.md）；sensitive-rules.js 单源 + post-tool-use 脱敏改写版注入；
  context/ 运行时目录

## [0.3.1] - 2026-09-02

> 全面审计修复版：修复 8 个实测 bug 与若干走查问题。

### Fixed

- session-end 读废弃字段；post-tool-use 敏感计数缺 `g` 标志
- 卸载/升级安全：classic 复制不再 rsync --delete / rm -rf 整目录（误删用户
  自有文件）；安装清单 `.specflow-manifest` 精确摘除；prompts 同名先备份；
  不复制含占位符的模板 hooks.json
- git hooks：烧录插件绝对路径，卸载后 127 退出阻塞提交 → 加 sf.sh 缺失即放行
- todo-scanner：块注释续行与 Markdown 列表标记漏扫；.codexignore 取反白名单
  三处匹配器生效（`!.env.example`）
- init-project 版本号读 plugin.json 真实版本；mcp-lite initialize 不再无条件
  回显任意 protocolVersion

## [0.3.0] - 2026-09-02

### Added

- `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`（marketplace
  add + 插件安装成为一等路径）；`hooks/hooks.json`（Codex 原生格式，唯一
  事实源）+ 6 事件零依赖 .mjs 脚本；hooks-export.mjs；mcp-lite.js + 4 个零
  依赖纯 JS MCP server（替代 TS + npm build）；skills/specflow-workflow/
  SKILL.md；ADR-003 与仓库根 README

### Changed

- install/uninstall 重写双模式（plugin / classic 兜底）；.env.example 删除
  错误指引（Codex 认证走 codex login）

## [0.2.0] - 2026-09-01

### Added

- 设计卡片 7 份（v0.2 时代契约文档，本轮文档重构已合并重写至
  `docs/components.md`）；spec 层 2 份
  （coding-standards / security-baseline）；rules 层（team-conventions + 5 阶段
  规则）；ADR-002 与 ADR 目录；templates-project/ 初始化模板；init-project.py
  + 双轨入口；/init 命令；v0.x 需求文档体系（REQUIREMENTS / USAGE / PARSER /
  HOOKS / WORKFLOW / COMMANDS / CONVERGENCE 等——v1.2.0 已归档）

### Changed

- 文档按 C4 四层整理；阶段规则按 5 阶段拆分（未选中的阶段不进上下文）；
  `[affects]` 字段作废（禁止跨文件）；标记 in_progress 中间态移除（收敛 3 态）

## [0.1.0] - 2026-09-01

### Added

- 初始版本：5 大能力（解析 / hooks / 流程化 / 通用化 / 附加）；6 个 MCP
  server（v0.x 形态，含后来裁撤的 feature-flag / shell-adapter）；8 个 slash
  命令；Hook 系统 5 触发点（v0.2 形态）；文档语义分层 5 层；配置即文档
  （checkbox / 标题正文 / JSON block）；4 语言栈子规则；跨 Agent 适配；
  安装/卸载脚本
