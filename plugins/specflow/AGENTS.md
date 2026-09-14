# specflow — 插件使用说明

> 插件作者：Cikaros（https://github.com/Cikaros）
> 所属 marketplace：`cikaros-devtools`（Cikaros 出品的 Codex 开发工具集）
> 版本：v1.2.4

## 插件能力（8 大维度）

1. **解析能力**（doc-parser.py）— Markdown 配置 → 结构化数据（frontmatter +
   checkbox + codex:json block）
2. **Hook 能力**（hooks/hooks.json + 6 个 .mjs 脚本）— 6 个 Codex 原生生命周期
   事件自动触发
3. **流程化能力**（workflow-state.py）— 多 Agent 并行 + 阶段状态机 + 产出检查 +
   真实测试门禁
4. **通用化能力**（spec/ + rules/）— 语言无关规范 + 阶段规则 + 13 语言 × 5 文档模板
5. **附加能力** — 产出检查 + 事件总线 + 文档版本化 + 隐私脱敏 + git hooks 门禁
6. **智能提示机制** — SessionStart 资源索引 + UserPromptSubmit 按需注入 + 反模式
   直接警告
7. **错误知识库** — 双源匹配 + 自动捕获 + MCP 工具记录/查询
8. **DIY 合并引擎** — 6 维度自定义（接线状态见下文「DIY 自定义」）

## 安装

> 安装流程为两步：先在仓库根目录运行 marketplace 安装器注册整个
> `cikaros-devtools` marketplace，再在 codex 会话内通过 `/plugins` 自行决定是否
> 启用本 plugin。本插件目录下不提供独立的 install/uninstall 脚本。

**第 1 步：注册 marketplace（仓库根目录运行）**

- macOS / Linux：`bash scripts/sh/install.sh`
- Windows：`powershell -ExecutionPolicy Bypass -File scripts\ps\install.ps1`

该脚本只做 `codex plugin marketplace add`，幂等可重复执行。`--status` 查询，
`scripts/sh/uninstall.sh` / `scripts/ps/uninstall.ps1` 移除。

**第 2 步：在 codex 会话内启用 plugin**

1. 进入 codex 会话
2. `/plugins` 浏览 `cikaros-devtools` marketplace
3. 选择并启用 `specflow`
4. `/hooks` 审查并信任 specflow 的 hooks

**项目初始化（启用 plugin 后）**：本插件目录下的 `scripts/sh/init-project.sh` /
`scripts/ps/init-project.ps1` 是项目级初始化器，由用户在自己项目内运行。

## 调用方式

- **Slash 命令（20 个）**：/new-feature /bugfix /design-* /unit-test /
  integration-test /setup-specflow /todo /workflow /agent /sanitize /config /
  req-analysis /arch-design /coding /review /testing
- **MCP 工具（4 server 共 26 个）**：
  - `mcp__hook-orchestrator__*`：on_session_start / on_subdir_enter /
    on_prompt_receive / on_tool_before / on_tool_after / get_hook_status /
    get_audit_log / list_pending_errors / record_error / dismiss_error /
    list_error_kb（11 个；on_* 系列为排障用手动触发副本）
  - `mcp__config-reader__*`：get_config / get_config_key / list_keys /
    get_config_flat / get_config_sources / set_config_key / audit_log（7 个）
  - `mcp__env-scanner__*`：get_env_summary / get_lang_stack / get_toolchain /
    check_tool / rescan（5 个）
  - `mcp__privacy-guard__*`：read_file_redacted / scan_output / redact_output
    （3 个）
- **脚本**（插件安装后位于 `~/.codex/plugins/specflow/scripts/`）：
  - macOS / Linux：`bash ~/.codex/plugins/specflow/scripts/sh/sf.sh <subcommand>`
  - Windows：`powershell -ExecutionPolicy Bypass -File
    ~/.codex/plugins/specflow/scripts/ps/sf.ps1 <subcommand>`
  - 子命令：`doctor` / `scan` / `todo` / `parse` / `workflow` / `sanitize` /
    `events` / `doc-version` / `init` / `session-start` / `hooks-export` /
    `config show` / `config validate` / `git-pre-commit` / `git-post-checkout` /
    `git-post-merge`

## 项目初始化

```
sf.sh init                              # 基础初始化
sf.sh init --guided                     # 8 问引导式（名称/作者/类型/语言/包管理/测试/阶段/严格度）
sf.sh init --type web                   # 项目类型：web / api / cli / library / monorepo
```

初始化生成：`AGENTS.md`、`.specflow/`（config.md + 运行时状态 + DIY 自定义目录
hooks/languages/rules/error-kb/error-kb-pending）、`docs/`、`.codexignore`、
git hooks。

## 会话生命周期（Codex 原生 hooks）

1. **SessionStart** → 环境扫描 + 配置解析 + 标记扫描 + 工作流状态恢复 + 合并引擎
   执行；智能提示：只注入资源索引（约 2KB），不注入大段内容
2. **UserPromptSubmit** → smartInjectV2 智能分析：反模式警告（直接注入，语言过滤
   避免跨语言误报）+ 阶段规则（首次注入后去重，截 40 行/1600 字符）+ 语言资源
   （只提示路径不注入）+ 工具链关联 + 自定义反模式（merged-config.json）
3. **PreToolUse**（Bash|apply_patch|Edit|Write）→ .codexignore 黑名单拦截
   （glob 语义 + 路径基名匹配）+ 自定义 deny/warn 规则
4. **PostToolUse**（异步）→ 敏感信息检测 + 脱敏改写 + 错误知识库双源匹配 +
   未匹配错误自动捕获 pending
5. **Stop**（异步）→ 刷新 TODO 状态 + 检查 pending 错误并提示用户
6. **SessionEnd** → 归档会话状态

审计流水：`.specflow/hook-audit.json`（保留 500 条）。token 预算：单次注入
2000 字符上限，累计 8000 估算 tokens（超额时优先保留反模式警告）。

## 标记驱动

任务 = 代码注释 `//TODO#NNN` / `//FIXME#NNN`：

- 3 态：created → resolved → deleted（无 in_progress）
- 元数据：`[agent:x]` `[depends:TODO#NNN]` `[priority:high|medium|low]`
- 单文件限定：每个标记只改一个文件（同 id 跨文件告警）
- 自动判定 resolved：阶段推进时产出检查通过 → 该 agent 名下 created 标记写入
  todo-resolved.json → todo-scanner 合并判定
- git 门禁：`SPECFLOW_PRECOMMIT_STRICT=1` 时暂存文件含 created 标记拒绝提交
  （默认仅警告）

## DIY 自定义（合并引擎）

6 个维度可自定义（完整规范见 `docs/requirements/DIY-ARCHITECTURE.md`）。
合并引擎在 SessionStart 执行一次，结果缓存到 `.specflow/merged-config.json`；
格式错误自动降级内置 + 告警。

| 维度 | 文件 | 接线状态 |
|------|------|---------|
| 反模式 | `.specflow/anti-patterns.json` | ✅ UserPromptSubmit 消费（追加去重） |
| hook 规则 | `.specflow/hooks/{pre,post}-tool-use.json` | ✅ 对应 hook 消费（deny/warn） |
| 阶段/工作流 | `.specflow/stages.md` + `.specflow/rules/stage-<name>.md` | ⚠️ 已装载校验，暂无运行时消费方（阶段检测为内置 5 阶段） |
| 语言规则 | `.specflow/languages/<lang>/` | ⚠️ 同上（仅观测计数） |
| 知识库 | `.specflow/error-kb-config.json` | ⚠️ 同上（匹配策略以每份 KB 文件 frontmatter 为准） |
| MCP 工具 | `.specflow/mcp-tools.json` | ⚠️ 同上（未注册到 hook-orchestrator） |

## 更多文档

- 使用指南：`docs/guides/usage-guide.md`（由浅入深全覆盖）
- 错误知识库：`docs/guides/error-kb.md`
- 组件参考：`docs/components.md`（hooks/Python 库/MCP server 组件契约）
- MCP 概览：`mcp/README.md`
- 设计决策：`docs/decisions/`（ADR-001~009）
- DIY 架构：`docs/requirements/DIY-ARCHITECTURE.md`
- 变更日志：`docs/changes/CHANGELOG.md`
