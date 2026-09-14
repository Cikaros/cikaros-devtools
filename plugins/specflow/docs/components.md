# specflow 组件参考（Components）

> 组件级契约参考：每个核心组件的职责、接口、边界与故障模式。
> 依据 v1.2.4 代码实测编写（历史设计卡片已于本轮文档重构合并）。
> CLI 入口统一为 `sf.sh <cmd>` / `sf.ps1 <cmd>`（插件安装后位于
> `~/.codex/plugins/specflow/scripts/`）。

## 总览

```
specflow/
├── hooks/scripts/          ← 6 个 Codex 原生 hook + lib（common / merge-engine / events）
├── scripts/lib/            ← 11 个 Python 库（doc-parser / env-scanner / todo-scanner /
│                              workflow-state / git-hooks / doc-version / events / sanitize /
│                              sfpaths / init-project / hooks-export）
└── mcp/                    ← 4 个零依赖 Node MCP server（mcp-lite.js 底座）
    ├── config-reader（7 工具）
    ├── env-scanner（5 工具）
    ├── hook-orchestrator（11 工具）
    └── privacy-guard（3 工具）
```

## 1. doc-parser.py — Markdown 配置解析器

- **职责**：Markdown 配置 → 结构化数据的唯一解析器（ADR-002「Markdown 即配置」）。
  支持 frontmatter、5 种 checkbox 形式、单选、`{{var}}`/`{{var|default}}` 变量占位、
  `codex:json` block。
- **CLI**：`sf.sh parse <file>`（`--format json|yaml|toml` / `--stage` / `--section` /
  `--key` / `--resolve-vars` / `--vars-file`）
- **变量合并**（实际生效层）：os.environ 基座 < `~/.specflow/vars.yaml` < 项目
  `vars.yaml`；`{{now}}`/`{{today}}` 恒为实时值（不进缓存）
- **消费方**：config-reader MCP、session-start hook、`workflow import-outputs`
- **边界**：不写回源文件；不执行 hook；不做业务语义校验（schema 校验仅告警，
  `--strict-schema` 升级 error）
- **故障模式**：单行解析失败不阻塞（errors 数组留痕）；缓存按 mtime 失效

## 2. env-scanner.py — 环境扫描器

- **职责**：扫描项目环境（OS / shell / 语言栈 / 工具链可用性 / git 状态），
  产出 env-scan.json（session-start 消费）与已有项目的 project-snapshot.json
  （目录树 / 依赖清单 / 文档盘点 / git top-churn / CI 与覆盖率配置探测）。
- **CLI**：`sf.sh scan [path]`
- **边界**：只读本地文件与 `--version` 探测，不调外部 API，不缓存敏感信息
- **故障模式**：git 缺失时 git 字段为 null（不失败）

## 3. todo-scanner.py — 标记扫描器

- **职责**：扫描 `TODO#NNN / FIXME#NNN` 标记（1-6 位数字，允许 `// # *` 前缀），
  维护 3 态状态机（created → resolved → deleted，无 in_progress）。
- **CLI**：`sf.sh todo [path]`（`--format json|md|summary` / `--incremental` /
  `--paths` / `--exclude` / `--check-start` / `--no-cache`）
- **状态推断**：注释消失 → deleted；id 在 todo-resolved.json（workflow advance
  写入）→ resolved；其余 created。元数据 `[agent:x] [depends:…] [priority:…]`；
  依赖环 DFS 检测；同 id 多文件告警；`[affects]` 已废弃（v1.2.0 起告警）
- **扫描边界**：src/tests/lib/scripts/docs + 项目根；Python 文件 tokenize AST 级
  （字符串字面量不误报），其他语言引号感知行内注释扫描；mtime+size 指纹缓存
  （todo-cache.json，SCANNER_VERSION=2 失效）
- **故障模式**：ID 由 `.specflow/todo.version` 自增（先 bump 后取 next_id）

## 4. workflow-state.py — 工作流状态机

- **职责**：内置 5 阶段（req-analysis → arch-design → coding → review → testing）
  状态机；阶段状态 5 态（pending/in_progress/completed/blocked/skipped）；
  多 Agent 并行（每 agent 独立阶段状态，上限 5）。
- **CLI**：`sf.sh workflow <cmd>`——status / advance / goto / skip / reset / block /
  create-agent / delete-agent / list-agents / history / import-outputs / test-run
- **advance 行为**：产出检查（config.md 声明的 outputs，required 缺失 → blocked，
  写 output-check.json）→ 真实测试门禁（test-executor.json：command/stages/
  run_on_advance/timeout；失败/超时 blocked；`SPECFLOW_SKIP_TESTS=1` 跳过；
  v1.2.4 护栏：command 非空字符串且 ≤2000 字符）→ 通过则该 agent 名下 created
  标记写入 todo-resolved.json + 产出文档 minor bump → 进入下一阶段
- **状态文件**：`.specflow/workflow-state/{global.json, agents/<id>.json}`；
  history 截 100 条；fcntl 文件锁（Windows no-op）
- **边界**：不执行 hook；不读源码内容；default agent 缺失时自动创建（非 default
  不自动，防 typo）

## 5. git-hooks.py — git 门禁

- **职责**：pre-commit / post-checkout / post-merge 三钩子的真实逻辑
  （`sf.sh git-*` 动作名剥 `git-` 前缀后传入）。
- **pre-commit**：暂存文本文件（TEXT_EXTS 白名单，单文件 ≤512KB）跑
  `sanitize_text(severity='high')`，high 命中**退出码 1 拒绝提交**
  （`SPECFLOW_PRECOMMIT_SANITIZE=0` 跳过）；lint 探测（警告不阻塞）；
  run_on_commit=true 时跑测试（失败阻塞）；`SPECFLOW_PRECOMMIT_STRICT=1` 时
  created 标记阻塞（默认警告）。报告落 precommit-report.json
- **post-checkout / post-merge**：依赖文件变更检测 + todo 状态刷新
- **边界（A7 原则）**：插件自身故障一律放行（内部错误退出码 ≥2 → 放行，绝不
  阻塞 git；Python 缺失时放行）

## 6. sanitize.py — 脱敏（Python 镜像）

- **职责**：加载规则单源 `rules/sensitive-rules.json`（12 条：8 high / 4 low）做
  文本脱敏——与 `mcp/lib/sensitive-rules.js` 双端同构（regex 取 JS/Python 公共
  子集），测试套件有规则对齐用例防漂移。
- **CLI**：`sf.sh sanitize <file>`（`--severity high|low` / `--format text|json|
  md|summary` / `--audit`）
- **边界**：规则源缺失 → RuntimeError（fail-loud，退出码 3）；银行卡规则过 Luhn
  （13-16 位数字候选，防时间戳/订单号误伤）；替换文案 `<SECRET:*>` 风格

## 7. 其余 Python 库

| 库 | 职责 |
|----|------|
| doc-version.py | 文档版本管理（frontmatter version + last_modified + `.version` 侧车）：`sf.sh doc-version show/bump[--major/--minor/--patch]/init/check/bump-outputs`；advance stage_exit 自动 minor bump |
| events.py | 事件总线（与 hooks/scripts/events.mjs 双语言写同一 events.jsonl：`{ts, type, payload}`）；500 行滚动（超限保留 400）；12 个已登记类型；`sf.sh events [N\|--json]` 查看 |
| sfpaths.py | 路径层：`.specflow/` 新布局优先、legacy（`.codex-plugin/`/`.codex/`）回退；RUNTIME_MARKERS 22 项与 common.mjs / sf-paths.js 三处一致（ADR-008 D3 契约） |
| init-project.py | 项目初始化（12 模板渲染 + 目录骨架 + .codexignore + git hooks 安装 + 旧布局迁移 + project-snapshot）；`--guided` 8 问落 vars.yaml + test-executor.json |
| hooks-export.mjs | hooks.json 导出参考文件（替换 `${PLUGIN_ROOT}` 为绝对路径，幂等；v1.3.0+ 不再写 ~/.codex/hooks.json） |

## 8. hooks/scripts/lib — hook 公共库

| 模块 | 职责 |
|------|------|
| common.mjs | 智能注入（smartInject/smartInjectV2：反模式 67 条 + 语言关键词 13 语言 + 阶段关键词 5 阶段 + token 预算）、工具链检测（浅层 2 级递归）、错误知识库匹配（matchPattern：exact/regex/fuzzy-Levenshtein + detectErrorInOutput + pending 管理）、Python 探测链、资源索引构建（约 1833 字符） |
| merge-engine.mjs | DIY 合并引擎：六维度装载（stages/languages/antiPatterns/hookRules/errorKbConfig/mcpTools）+ 校验 + 告警；内置反模式经引擎传入（merged-config 单一事实源，v1.1.1 P0-2） |
| events.mjs | 事件总线 JS 侧（appendEvent/readEvents，常量与 events.py 一致） |

## 9. MCP servers（4 个，Node 零依赖，mcp-lite.js 底座）

> 手动启动：`node mcp/<name>/index.js`；插件模式由 `.mcp.json` 自动拉起
>（hook-orchestrator 的 cwd 为插件根，项目目录取 SPECFLOW_PROJECT_ROOT 或
> process.cwd）。协议：JSON-RPC 2.0 按行分帧，protocolVersion `2024-11-05`，
> 单行 >1 MiB 拒绝解析（v1.2.4 行长护栏）。仓库 v1.3.0+（specflow v1.2.2+）
> 已移除 classic 安装模式。

### 9.1 config-reader（7 工具）

- **职责**：把 doc-parser.py 包装为 MCP 查询服务——解析后的 `.specflow/config.md`
  （旧项目回退 `.codex-plugin/`）配置查询。
- **工具**：`get_config` / `get_config_key`（dotted key，嵌套回退）/ `list_keys`
  （前缀过滤）/ `get_config_flat` / `get_config_sources` / `set_config_key`
  （只返回编辑指引，不写文件）/ `audit_log`（恒空）。
- **资源**：`config://current` / `config://project-md`。
- **边界**：无状态不写配置；业务语义不校验。

### 9.2 env-scanner（5 工具）

- **职责**：环境摘要查询（内部 subprocess 调 Python env-scanner.py，探测链
  SPECFLOW_PY → python3 → python → py -3）。
- **工具**：`get_env_summary`（refresh 可选）/ `get_lang_stack` / `get_toolchain` /
  `check_tool` / `rescan`。
- **资源**：`env://summary` / `env://lang-stack`。**60s 结果缓存**（rescan 跳过）。
- **故障模式**：git 缺失时 git 字段 null。

### 9.3 hook-orchestrator（11 工具）

- **职责**：手动触发 hook 等价逻辑的**排障副本** + 错误知识库记录闭环的 MCP 面。
  正常会话由 6 个 .mjs hook 自动执行，本 server 仅排障与 KB 记录。
- **工具**：
  - 排障组：`on_session_start` / `on_subdir_enter` / `on_prompt_receive` /
    `on_tool_before` / `on_tool_after`（简化复刻：阶段关键词仅中文子集、黑名单为
    子串匹配旧语义——与真实 hook 有差异，勿当等价）/ `get_hook_status` /
    `get_audit_log`（内存态截 200 条）
  - 错误知识库组（闭环）：`list_pending_errors` / `record_error`（pattern/cause/fix
    必填；带 pending_file 时确认并清空 pending）/ `dismiss_error` / `list_error_kb`
    （lang 可选过滤）
- **资源**：`hooks://hooks-json` / `hooks://status` / `hooks://audit`。

### 9.4 privacy-guard（3 工具）

- **职责**：敏感信息检测与脱敏（直接使用 `mcp/lib/sensitive-rules.js`，规则单源
  `rules/sensitive-rules.json` 12 条，与 Python sanitize.py 同构）。
- **工具**：`read_file_redacted`（读取并自动脱敏；命中 .codexignore 黑名单拒绝
  读取）/ `scan_output`（只检测不改写，verdict：SENSITIVE_HIGH / SENSITIVE_LOW /
  CLEAN）/ `redact_output`（改写返回）。
- **故障模式**：规则源读取失败 fail-loud（抛错）。
