# ai-sdlc — 插件使用说明

> 插件作者：Cikaros（https://github.com/Cikaros）
> 所属 marketplace：`cikaros-devtools`
> 版本：v0.13.1
> 理论来源：Anthropic《AI-Native SDLC playbook》（方法学出处，非运行时依赖）

## 这是什么

**ai-sdlc** 把 Anthropic《AI-Native SDLC playbook》翻译成可执行的 Codex 插件。

核心设计：每个 SDLC 阶段以一个**工作区工件**结束（intent.md → spec.md →
plan.md → diff+tests → PR → incident），下一阶段读取该工件开始。插件通过 6 个
Codex 原生生命周期 hook 自动检测当前工件状态、推进阶段、按需注入对应
规则/技能/模板——**用户无需显式 @ 插件或手动 slash 命令即可走完整套流程**。

**输入分流（v0.12.0）**：每条用户输入先三分类（标准 `rules/triage.md`）——
**需求/ISSUE** 统一走 SDLC 流程；**补充信息**（澄清/Open questions 回答/约束补充）
融入当前阶段工件，不另开流程；**临时任务**（一次性小事）不走流程、不落 SDLC
工件——周期进行中时登记到 `.sdlc/quick-tasks.json` 队列（MCP `quick_task`），
**待周期走完后统一处理，二者不混淆**；无进行中周期则直接处理。
SessionStart 注入完整分流协议，UserPromptSubmit 每回合轻量提醒，Stop 在队列
非空时提示排队/待处理状态。

**命令体系（v0.13.0 迁移）**：官方 Codex CLI 不支持插件自定义 slash 命令
（未知 `/xxx` 会被 CLI 拒绝、不会提交给模型），v0.12.0 前文档中的 `/sdlc-*`
命令已全部移除，替代为三层：① **自然语言即命令**（主通道）——SessionStart
注入「意图→工具映射表」，用户说意图、agent 调 MCP 工具；② **MCP 工具**——
唯一受控写通道（服务端校验）；③ **官方 `/prompts:<name>`**（可选逃生口）——
把 18 份操作手册注册到用户 prompts 目录后可用 `/prompts:sdlc-quick` 等形式
调用；注册已零操作化（v0.13.2）：SessionStart 自动注册/刷新（升版自愈；MCP server 经 .mcp.json 内联 bootstrap 自定位启动（v0.13.3 四级解析链，修复真实安装下相对路径不可达）；
显式卸载写 opt-out 标记后不再自动恢复；`SDLC_PROMPTS_AUTO=off` 总关），
手动刷新/卸载可用 MCP `register_prompts` 或 `scripts/sh/install-prompts.sh`
（macOS/Linux）/ `scripts/ps/install-prompts.ps1`（Windows）。配套 hook 层
环境自检（SessionStart 注入 shell 能力画像）+ PreToolUse 跨平台脚本护栏
（能力感知拦截注定失败的 .sh/.ps1 调用并给出替代）。

工件生命周期与多任务隔离（标准见 `docs/lifecycle.md`）：工件（intent/spec/plan/
REVIEW）是任务推进的中间产物，存 `.sdlc/` 工作区**不入版本控制**——**永不
自动删除**，会话结束只存档快照；周期结束归档轮转到 `.sdlc/archive/`；多会话/
多任务经作用域路由 + 会话亲和 + 任务隔离工作区三层机制隔离（MCP `task_*`、
`new_cycle`，自然语言即可触发）。首次使用的项目由 SessionStart 自动初始化（state 引导 +
`.gitignore`/`.codexignore` 托管块），无需手动 init。

## 六阶段闭环

```
Planning → Design → Build → Test → Deploy → Maintain → (回到 Planning)
 intent.md  spec.md  plan.md  test-pass  pr-merged  新 intent.md
```

每个阶段工件落地（写入 `.sdlc/artifacts/` 或任务目录）后，PostToolUse hook
自动检测并推进到下一阶段。

## 核心能力

1. **工件驱动状态机**（`hooks/scripts/lib/stage-detector.mjs`）
   - 扫描已存在的 intent.md / spec.md / plan.md / REVIEW.md / AGENTS.md（多候选路径）
   - 结合 git 状态（分支、diff）+ `.sdlc/state.json` 推导当前阶段（7 个状态，
     build 分 3a 计划 / 3b 实施两个子阶段）
   - `plan.md` 需工程师显式接受（`accept_plan`）才推进实施

2. **6 个 Codex 原生生命周期 hooks**（`hooks/hooks.json`）
   - **SessionStart**：首次使用自动初始化（幂等引导）→ 作用域路由 → 写 MCP
     会话票据 → 工件扫描 + 阶段自动检测 →
     注入工作空间提示 + 输入分流协议 + 资源索引（additionalContextLimit 4000 内）
   - **UserPromptSubmit**：**每回合输入分流提醒**（v0.12.0：三分类指引 +
     队列状态；v0.13.0：话术统一为自然语言→MCP 工具）+ 阶段规则按需注入
     （首次去重，40 行 / 1600 字符截断）+ 反模式警告 +
     缺失工件提示 + Open questions 每回合提醒 + fix_loop 每回合提醒（token 预算：
     单次 2000 字符、累计 8000 估算 tokens）
   - **PreToolUse**：三层门禁强制（文件分级 + 阶段门禁 + Bash 只读约束，见
     「阶段门禁」表）
   - **PostToolUse**：工件文件监听 + 阶段自动推进（含 apply_patch patch 目标解析）+
     测试执行记录（签名/轮次/循环检测，Playwright 全形态命令识别）+ PR/merge 检测 +
     maintain 闭环归档
   - **Stop**：fix_loop 呈报 + 测试门禁提醒 + Open questions 门禁 + 临时任务
     队列提醒（v0.12.0：周期内→排队中，空闲→待处理）+ 阶段产出检查 +
     人工关卡提示 + 下一阶段预览 + 回合结束通知（任务完成/需用户决策或回答时
     系统弹窗+声音；面向终端外的使用者，与注入上下文无关）
   - **SessionEnd**：会话快照归档（`.sdlc/sessions/`，保留最近 50 个）

3. **7 个技能**（`skills/`）
   - 阶段技能 ×6：sdlc-planning / sdlc-design / sdlc-build / sdlc-test / sdlc-deploy /
     sdlc-maintain（描述何时触发、做什么、不做什么、门禁与反模式）
   - 能力技能 ×1：frontend-e2e（Playwright 前端 E2E + 反检测阶梯；references ×5：
     config 模板 / 示例用例 / 调试 CI 速查 / 反检测指南 / stealth fixture，
     详见 `docs/lifecycle.md` §2.7）

4. **18 份操作手册**（`prompts/`，v0.13.0 起重定位）
   - 阶段类：intent / spec / plan / build / test / deploy / maintain
   - 控制类：status / advance / reset / workflow / audit
   - 初始化：init；审查：review
   - 生命周期：cycle（周期归档轮转）/ task（多任务隔离）/ loop-resolve（修复
     循环决策）
   - 输入分流：quick（临时任务队列，v0.12.0）
   - 用法：agent 按需读取（用户自然语言驱动）；偏好显式调用可把手册注册到
     用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用——v0.13.2 起会话
     启动自动注册/刷新（零操作，升版自愈；卸载后不再自动恢复）；手动刷新/
     卸载：MCP `register_prompts` 或 sh/ps1 平台脚本

5. **1 个 MCP 编排器**（`mcp/sdlc-orchestrator/`，23 个工具）
   - status / workflow / advance / reset / refresh / accept_plan / set_fix_mode /
     approve_release / set_change_ticket / set_stage / new_cycle / cycle_list /
     task_create / task_switch / task_list / task_close / loop_resolve /
     session_scope / self_review / audit / events / quick_task（v0.12.0 输入分流）/
     register_prompts（v0.13.1 官方 /prompts: 手册注册，跨平台；v0.13.2 起
     SessionStart 自动注册，本工具为显式刷新/卸载通道）
   - **会话上下文隔离**：每个 Codex 会话 spawn 独立 MCP 进程，首次调用认领
     SessionStart 票据 → 按会话的 session-map 绑定路由；status 报告 `scope_binding`；
     异常时 `session_scope` 纠正或工具显式传 `task_id`
   - 生命周期实现经 CJS→ESM 桥复用 hooks/scripts/lib/ 模块群（common.mjs 桶导出，单一事实源；v0.13.6 分层见 docs/architecture.md「代码组织」）

6. **7 份阶段/分流规则 + 9 份模板**（`rules/` + `templates/`）
   - 工件模板：intent.md.tpl / spec.md.tpl / plan.md.tpl / REVIEW.md.tpl /
     AGENTS.md.tpl / bands.yaml.tpl
   - 配套：evals.json.tpl（评估套件）/ agent-evals.yml.tpl（CI 配置，codex exec）/
     production-gate.sh.tpl（生产门禁钩子）

## 安装

> 安装流程为两步：先在仓库根目录运行 marketplace 安装器注册整个
> `cikaros-devtools` marketplace，再在 codex 会话内通过 `/plugins` 自行决定是否
> 启用本 plugin。本插件目录下不提供独立的 install/uninstall 脚本。

**第 1 步：注册 marketplace（仓库根目录运行）**

```bash
bash scripts/sh/install.sh                                        # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\ps\install.ps1   # Windows
```

该脚本只做 `codex plugin marketplace add`，幂等可重复执行。可选 `--yes` 跳过确认、
`--status` 仅查询；移除用 `scripts/sh/uninstall.sh` / `scripts/ps/uninstall.ps1`。

**第 2 步：在 codex 会话内启用 plugin**

1. 进入 codex 会话
2. `/plugins` 浏览 `cikaros-devtools` marketplace
3. 选择并启用 `ai-sdlc`
4. `/hooks` 审查并信任 ai-sdlc 的 hooks

## 项目初始化

**自动（默认）**：启用插件后直接在项目里启动 codex 会话——SessionStart hook
自动完成初始化（`.sdlc/state.json` 全 schema + `.gitignore`/`.codexignore`
托管块）并注入声明；`sdlc.sh status` 等 CLI 首次使用同样自动引导。

**手动（可选，预置模板）**：

```bash
cd ~/your-project
bash ~/.codex/plugins/ai-sdlc/scripts/sh/init-project.sh
# 可选：--with-git-hooks 安装 git pre-commit hook（Makefile 存在则 make lint，
#       阻止暂存 *.env* / *secret* 文件）
```

**注册操作手册（可选，启用官方 `/prompts:` 调用）**：

**默认（v0.13.2 起零操作）**：会话启动时 SessionStart 自动注册/刷新 18 份
手册到 `~/.codex/prompts`（升版后自动更新；无需任何指令）。显式卸载：会话
内说「卸载 prompts 手册」→ MCP `register_prompts({action:"remove"})`——
卸载后写入 opt-out 标记，不再自动恢复；重新注册（说「注册操作手册」）即
清除标记。`SDLC_PROMPTS_AUTO=off` 可关闭自动注册。

手动/离线/CI 场景（平台脚本，语义同源）：

```bash
bash ~/.codex/plugins/ai-sdlc/scripts/sh/install-prompts.sh   # 注册 18 份手册（macOS/Linux）
bash ~/.codex/plugins/ai-sdlc/scripts/sh/install-prompts.sh --remove  # 卸载
powershell -ExecutionPolicy Bypass -File ~\.codex\plugins\ai-sdlc\scripts\ps\install-prompts.ps1        # Windows 注册
powershell -ExecutionPolicy Bypass -File ~\.codex\plugins\ai-sdlc\scripts\ps\install-prompts.ps1 -Remove  # Windows 卸载
```

注册后会话内可用 `/prompts:sdlc-quick`、`/prompts:sdlc-status` 等调用操作
手册（官方 CLI 唯一支持的自定义调用形式）。不注册也不影响任何能力——自然
语言即可驱动全部功能。

初始化生成（幂等不覆盖）：`.sdlc/`（state.json + bands.yaml + artifacts/ 工作区 +
archive/ 归档区 + custom/{skills,rules,templates}）、`.sdlc/artifacts/REVIEW.md`、
`AGENTS.md`（Codex 机构知识工件，若 AGENTS.md 与 CLAUDE.md 均不存在）、
`.gitignore`/`.codexignore`（托管块——`.sdlc/` 运行时与工件不入版本控制，
bands.yaml / custom/ 留在版本控制）。

## 零显式注入工作流

**核心承诺**：用户不需要 @ 插件，不需要 slash 命令。

典型会话：

1. 用户启动 codex 会话 → SessionStart hook 自动初始化并检测：工作区无
   intent.md → 当前阶段 = planning
2. 用户输入："我们想加一个理赔状态自助查询功能"
3. UserPromptSubmit hook 注入：阶段规则（首次）+ 缺失工件提示（intent.md）
4. Codex 生成 `.sdlc/artifacts/intent.md` → PostToolUse 检测到 → 自动推进到
   design 阶段
   （若 intent.md 含未回答 Open questions，停在 planning/awaiting_answers，
   待发起者回答后推进）
5. 用户下一条提问，hook 注入 design 阶段规则 + 缺失工件（spec.md）……如此循环
   到 maintain → 闭环回到 planning

**手工干预入口**（可选，自然语言即可，agent 会调对应 MCP 工具）：

- 「看一下 SDLC 进度」→ `status`
- 「强制推进到设计阶段」→ `advance` / `set_stage`（绕过自动检测）
- 「接受这个计划」→ `accept_plan`（工程师显式接受 plan.md）
- 「授权发布」→ `approve_release`（发布管理员授权生产部署）

## 工件契约

| 阶段 | 产物 | 接受者 | 触发下一阶段 |
|------|------|--------|--------------|
| 1 Planning | `intent.md` | 产品负责人 | Stage 2 |
| 2 Design | `spec.md` | 产品负责人 + 策略所有者 | Stage 3a |
| 3a Build/Plan | `plan.md` | 工程师（显式 accept） | Stage 3b |
| 3b Build/Impl | diff + tests | 工程师 + CI | Stage 4 |
| 4 Test | test-pass + eval suite | CI | Stage 5 |
| 5 Deploy | PR merged | 代码所有者 + 发布管理员 | Stage 6 |
| 6 Maintain | 新 `intent.md`（闭环） | 服务所有者 | 回到 Stage 1 |

详见 `spec/artifact-contract.md`。

## 阶段门禁（PreToolUse hook 强制）

完整标准见 `docs/write-policy.md`（文档写入保护策略）与 `docs/lifecycle.md`
（工件生命周期与隔离标准）。核心语义：**代码不可变、文档可写、状态与隔离索引不可碰**。

| 阶段 | 门禁规则 | 触发条件 | 行为 |
|------|---------|---------|------|
| * | 运行时状态与隔离索引保护 | Edit/Write `.sdlc/` 下 state/hooks-state/session-map/tasks/cycles/sessions/mcp-bind-queue 等及任意 `*.tmp`/`*.lock` | block（任何阶段/项目） |
| 1 planning | Intent Open questions 门禁 | intent.md 含未回答条目 → 停在 planning/awaiting_answers | hold（文件可写，阶段不推进） |
| * | 工件落位护栏（v0.10.0） | 在 `.sdlc/` 外**新建** intent/spec/plan/REVIEW（存量同名工件更新除外） | warn（提示工作区路径） |
| * | 周期归档审计链 | Edit/Write `.sdlc/archive/**`、`docs/sdlc/archive/**`（历史兼容） | warn |
| 3a build_plan | 禁改业务代码 | 写操作目标为**代码类** | block* |
| 3a build_plan | Bash 仅允许只读命令 | 非只读段 / 输出重定向 / 命令替换（逐段校验） | block* |
| 3a build_plan | 规格漂移提醒 | Edit/Write `spec.md` | warn |
| 3b build_impl | 修复期禁改测试 | `in_fix_mode=true` + 写测试文件 | block |
| 5 deploy | 修改迁移需工单 | 写 migrations/ / *.tf / *.sql 且无 change_ticket | block |
| 5 deploy | 生产部署需授权 | Bash 含 deploy+production 且无 release_approval | block |
| 3b/test | 测试门禁 | `git push` / `gh pr create` 且 `test_pass=false` | block* |
| *（fix_loop） | 修复循环中断 | 同失败签名重复或轮次超限 → 代码写入 + 非只读非测试 Bash 均阻断；MCP `loop_resolve` 决策或测试通过解除 | block |
| * | 机构知识编辑 | Edit/Write AGENTS.md / CLAUDE.md / REVIEW.md | warn |

\* 标 block\* 的规则在**未参与工作流**的项目（`sdlc_engaged` 未置位且无任何 MCP
状态位）自动降级为 warn——防止仅有 `spec.md` 的无关仓库被误拦。参与判定与逃生通道
见 write-policy.md 第 3.1、5 节。

## 依赖

- Node ≥ 18（hooks 与 MCP server；零 npm 依赖）
- Python 3（CLI 工具可选；缺失时降级）
- Codex CLI ≥ 0.142（插件系统与 hooks）

## 文档

- 插件使用说明：本文件
- 文档写入保护策略：`docs/write-policy.md`（哪些文件允许/禁止编辑的权威标准）
- 工件生命周期与隔离标准：`docs/lifecycle.md`
- 使用指南：`docs/usage-guide.md`
- 架构说明：`docs/architecture.md`
- MCP 工具手册：`mcp/sdlc-orchestrator/README.md`
- SDLC 基线 / 工件契约：`spec/`
- 变更日志：`docs/changes/CHANGELOG.md`

## 命名约定

| 概念 | 名字 |
|------|------|
| marketplace 名 | `cikaros-devtools` |
| 插件名 | `ai-sdlc` |
| 运行时目录 | `.sdlc/`（任务模式：`.sdlc/tasks/<id>/`） |
| 工件工作区 | `.sdlc/artifacts/`（任务模式：任务目录）——不入版本控制 |
| 状态文件 | `.sdlc/state.json`（任务模式：任务目录内） |
| 事件流 / 审计 | `.sdlc/events.jsonl` / `.sdlc/hook-audit.json`（scope 级） |
| 临时任务队列 | `.sdlc/quick-tasks.json`（v0.12.0 输入分流；全局，agent 禁改，经 quick_task 受控修改） |
| 会话映射 / 任务索引 / 周期索引 | `.sdlc/session-map.json` / `tasks.json` / `cycles.json`（agent 禁改） |
| 会话快照 | `.sdlc/sessions/`（保留最近 50 个） |
| 周期归档 | `.sdlc/archive/`（默认，不入版本控制；显式可选 `docs/sdlc/archive/`） |
