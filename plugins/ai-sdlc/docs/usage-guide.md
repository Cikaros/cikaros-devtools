# Usage Guide — ai-sdlc 使用指南

## 安装

> 安装流程为两步：先在仓库根目录注册 marketplace，再在 codex 会话内 `/plugins`
> 启用 plugin。本插件目录下不提供独立的 install/uninstall 脚本。

**第 1 步：注册 marketplace（仓库根目录运行）**

```bash
bash scripts/sh/install.sh                                        # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\ps\install.ps1   # Windows
```

可选参数：`--yes` / `-Yes` 跳过确认；`--status` / `-Status` 仅查询。

**第 2 步：在 codex 会话内启用 plugin**

1. 进入 codex 会话
2. `/plugins` 浏览 `cikaros-devtools` marketplace
3. 选择并启用 `ai-sdlc`
4. `/hooks` 审查并信任 ai-sdlc 的 hooks

**卸载 marketplace**：仓库根目录 `bash scripts/sh/uninstall.sh` /
`powershell -File scripts\ps\uninstall.ps1`（卸载前先在 `/plugins` 内停用 ai-sdlc）。

## 项目初始化

**自动（默认，v0.10.0）**：无需手动 init——启用插件后直接在项目里启动 codex
会话，SessionStart hook 自动完成初始化（`.sdlc/state.json` 全 schema +
`.gitignore`/`.codexignore` 托管块——`.sdlc/` 运行时与工件不入版本控制）并注入
声明；`sdlc.sh status` 等 CLI 首次使用同样自动引导。

**手动（可选，预置模板）**：

```bash
cd ~/your-project
bash ~/.codex/plugins/ai-sdlc/scripts/sh/init-project.sh
# 可选：--with-git-hooks 安装 git pre-commit hook
```

初始化生成（幂等不覆盖）：`.sdlc/state.json`（运行时状态，全 schema）、
`.sdlc/bands.yaml`（闭环节奏配置，建议提交）、`.sdlc/artifacts/`（工件工作区）、
`.sdlc/archive/`（归档区）、`.sdlc/custom/`（DIY 自定义：skills / rules /
templates 覆盖，建议提交）、`.sdlc/artifacts/REVIEW.md`（审查策略模板）、
`AGENTS.md`（Codex 机构知识模板，若不存在）、`.gitignore` / `.codexignore`
（托管块）。

## 典型工作流（零显式注入）

### 场景 1：从想法到生产（完整闭环）

```
用户: "我们想加一个理赔状态自助查询功能"

[SessionStart] 自动初始化 + 扫描工作区：无 intent.md → planning；注入资源索引 + 缺失工件提示
[UserPromptSubmit] 首次进入 planning → 注入阶段规则摘要
Codex 生成 .sdlc/artifacts/intent.md → [PostToolUse] 推进到 design
  （若 intent.md 含未回答 Open questions → 停在 planning/awaiting_answers，
   对话中逐条提问，答案融入文件后自动推进）

用户: "请基于 intent.md 生成 spec.md" → Codex 生成并写入工作区 → 推进到 build_plan
用户: "进入 plan 模式，基于 spec.md 生成 plan.md" → Codex 生成 .sdlc/artifacts/plan.md
  （PostToolUse 不自动推进——等待工程师显式接受；每回合注入「等待接受」
   提醒与生命周期状态条，上下文压缩后 agent 仍记得下一步）
用户: "接受" → [UserPromptSubmit] 检测到接受意图 → 提示 agent 调
  mcp__sdlc-orchestrator__accept_plan → plan_accepted → 推进到 build_impl
  （MCP 工具未随会话暴露时：`bash …/sdlc.sh accept` 受控 CLI 回退，
   同锁同语义可审计——v0.13.11）

用户: "实施 plan.md"
[PreToolUse] build_impl 阶段允许编辑业务代码
Codex 按 plan.md 实施，跑 make test 通过
  → [PostToolUse] test_pass=true → 推进到 test

用户: "创建 PR" → gh pr create ... → [PostToolUse] 推进到 deploy
[PreToolUse] deploy 阶段：改迁移需 change_ticket；生产部署需 release_approval
用户: "mcp__sdlc-orchestrator__approve_release({ approver: 'alice' })"
Codex: gh pr merge --squash → [PostToolUse] last_deployed_at → 推进到 maintain

用户: "部署后监控发现 5xx 率突增" → Codex 诊断，写新 intent.md（工作区）
  → [PostToolUse] 旧周期归档 + 闭环回 planning（cycle_count++）
```

### 场景 2：bug 修复

```
用户: "修复登录页 500 错误"
[SessionStart] plan.md 已存在 → build_impl
用户: "先写一个失败的测试重现 bug" → Codex 写测试并确认失败
用户: "mcp__sdlc-orchestrator__set_fix_mode({ enabled: true })"
[PreToolUse] 现在 Edit/Write 测试文件会被 block
Codex 修代码（不修测试），跑 make test 通过
用户: "mcp__sdlc-orchestrator__set_fix_mode({ enabled: false })"
Codex 提交修复 + 更新 plan.md
```

### 场景 3：排障

```
用户: "看一下 SDLC 状态"        → status：当前阶段 + 工件清单 + 缺失项 + scope_binding
用户: "看看最近的审计日志"      → audit：最近 20 条 hook 审计
状态不对 → "重置但保留历史"     → reset({ keep_history: true }) → status 验证
```

## 工件生命周期与多任务隔离

三问三答（完整标准见 `docs/lifecycle.md`）：

1. **会话结束会删除 intent/spec/plan 吗？** 不会——工件永不自动删除，
   SessionEnd 只存档会话快照（保留最近 50 个）。
2. **工件进版本控制吗？** 不进（v0.10.0 起默认）——工件是任务推进的中间
   产物，存 `.sdlc/` 工作区（gitignore 托管块自动忽略）；**任务结束只需归档**：
   会话内说「开新周期/收尾这个任务」（`new_cycle` 或 `task_close`）归档到
   `.sdlc/archive/`（移动而非删除），阶段机重置 planning、cycle+1；maintain
   写出新 intent.md 时自动完成闭环归档。**不要用 reset 迭代**——它不清旧工件，
   阶段检测会被旧工件污染。
3. **多会话/多任务会互相污染吗？** 不会——四级作用域路由 + 任务隔离工作区；
   MCP 侧会话票据配对，详见 docs/lifecycle.md §4.5。并行多需求：每需求说
   「并行开个新任务做 X」（`task_create`，建议每任务配 git 分支——隔离的是
   工件与状态，不是源码工作树）。新会话默认不吸附任务（防污染），显式说
   「切到任务 X」（`task_switch`）切换。

## 回合结束通知与审批等待通知（v0.11.0；v0.13.13 扩展）

任务完成或 Codex 需要你决策/回答时，插件发**系统弹窗 + 声音**把人叫回终端——
长任务必达、快答不扰（终端前的快速问答回合不提醒，默认阈值 10 秒）。两类
「必须等你」的门禁状态**总是通知**（不受阈值约束）：修复循环中断（等你决策后 agent 调 `loop_resolve`）、Open questions 待回答。

**审批等待通知（v0.13.13，用户实测反馈）**：Codex 的工具审批弹窗
（`1. Yes, proceed (y)` / `2. No, and tell Codex what to do differently (esc)`）
出现在回合进行中——任务静默暂停而你不知道。插件在网络/端口类命令（curl /
npm install / dev server 等——沙盒默认拦截，必触发审批或拒绝）放行前发
**alert 级通知**（「等待你的批准」+ y/esc 操作提示 + 命令预览，Funk 醒目音）
把你叫回。降噪：命令刚执行过（你刚批准/拒绝过 = 人在终端）后 120 秒内
不重复打扰；自动放行策略下若嫌误报可 `SDLC_NOTIFY_APPROVAL=off` 整类关闭。

零配置可用（默认全开）；环境变量按需调整：

| 环境变量 | 默认 | 说明 |
|------|------|------|
| `SDLC_NOTIFY` | on | 总开关；`off` / `0` / `false` / `no` 任一即关 |
| `SDLC_NOTIFY_POPUP` | on | 只关弹窗（保留声音）设 `off` |
| `SDLC_NOTIFY_SOUND` | on | 只关声音（保留弹窗）设 `off` |
| `SDLC_NOTIFY_MIN_SECONDS` | 10 | 防噪阈值（秒）；`0` = 每回合都通知 |
| `SDLC_NOTIFY_SOUND_MAC` | Glass | macOS 提示音名·普通回合完成（系统提示音白名单校验） |
| `SDLC_NOTIFY_SOUND_MAC_ALERT` | Funk | macOS 提示音名·需要你的决策/回答与审批等待（更醒目，白名单校验；v0.13.8） |
| `SDLC_NOTIFY_CMD` | — | 自定义通知命令（优先于内置链路），`{title}` / `{body}` 占位；子进程另可从 `SDLC_NOTIFY_TITLE` / `SDLC_NOTIFY_BODY` 环境变量取值（免引号转义） |
| `SDLC_NOTIFY_APPROVAL` | on | 审批等待通知类开关（v0.13.13）；`off` 整类关闭 |
| `SDLC_NOTIFY_APPROVAL_PRESENCE` | 120 | 在场窗口秒数；`0` = 每次审批等待都通知 |

平台实现（均零依赖、脱钩执行、失败静默不影响 hook）：

| 平台 | 弹窗 + 声音 | 降级链 |
|------|------|------|
| macOS | applet 宿主弹窗（`ai-sdlc-notifier.app`，首次自动生成）+ `afplay` 独立声音（v0.13.8：点击通知不再打开 Script Editor，声音必达） | applet 未就绪 → detached 生成后首弹 → `osascript` 直发（保底）；通知被系统关掉时声音仍会响 |
| Windows | PowerShell 5.1 Toast（通知中心 + 默认提示音，`notify.ps1`） | 旧系统 → `msg.exe` 弹窗 → `SystemSounds` 声音 |
| Linux | `notify-send` + `canberra-gtk-play`（尽力而为） | 组件缺失静默跳过 |

自定义示例（如终端专用工具）：

```bash
# macOS terminal-notifier
export SDLC_NOTIFY_CMD="terminal-notifier -title '{title}' -message '{body}' -sound Glass"
# 或自写脚本（免引号转义取值）
export SDLC_NOTIFY_CMD="my-notify.sh --title \"$SDLC_NOTIFY_TITLE\" --body \"$SDLC_NOTIFY_BODY\""
```

通知行为（是否发、为何没发：`disabled` / `below-min-duration` / 分发失败）记录在
`.sdlc/hook-audit.json` 的 `detail.notify` 字段；审批等待通知记录在
`detail.approval_notify`（`via:xxx` / `presence-window` / `approval-off` /
`disabled`），均可排障。边界说明：Codex CLI 原生的工具审批弹窗发生在回合
进行中（hooks 六事件无对应时刻），插件层无法直接感知——v0.13.13 起以
**预测式信号**近似覆盖（网络/端口命令必触发审批或拒绝，通知高置信）；
非网络命令在其他审批策略（如 untrusted 全询问）下的弹窗仍不可预测（已知
盲区）。

## 显式操作参考

### 自然语言意图（主通道，v0.13.0）

官方 Codex CLI 不支持插件自定义 slash 命令（未知 `/xxx` 会被 CLI 直接拒绝，
不会提交给模型）——所有操作用自然语言表达，agent 按会话注入的
「意图→工具映射表」调 MCP 工具落地：

| 你说（示例） | agent 调用 | 用途 |
|------|------|------|
| 「看一下 SDLC 状态/进度」 | `status` | 当前阶段 + 工件清单 + 缺失项 |
| 「看看 6 阶段全景图」 | `workflow` | 全景 + 当前进度 |
| 「接受这个计划，开始实施」 | `accept_plan` | 工程师接受 plan.md（等待接受期每回合注入提醒 + 接受意图识别；MCP 工具不可用时受控 CLI 回退 `sdlc.sh accept`——v0.13.11） |
| 「授权发布，我是发布管理员」 | `approve_release` | 生产部署授权 |
| 「变更工单号是 CHG-123」 | `set_change_ticket` | 迁移/部署门禁放行 |
| 「强制推进/回设计阶段」 | `advance` / `set_stage` | 绕过自动检测 |
| 「状态坏了，重置但保留历史」 | `reset` | 完整退出语义（不移动工件） |
| 「开新周期/下一轮迭代」 | `new_cycle` | 归档旧工件（不删除）→ 重置 → cycle+1 |
| 「并行开个新任务/切任务/收尾任务」 | `task_create` / `task_switch` / `task_close` | 多任务隔离 |
| 「循环问题再修一轮/我自己来/升级处理」 | `loop_resolve` | 修复循环决策（retry/new-intent/manual/escalate） |
| 「记个临时任务/看队列/马上做/做完了」 | `quick_task` | 临时任务队列（add/list/run/done/drop） |
| 「刷新操作手册到最新版/卸载 prompts 手册/看注册状态」 | `register_prompts` | 官方 `/prompts:sdlc-<名>` 调用形式的手册注册（v0.13.2 起会话启动自动注册，本工具用于显式刷新/卸载） |
| 「看最近审计/事件流」 | `audit` / `events` | hook 审计与事件流 |

### 操作手册（prompts/，18 份）

| 手册 | 对应意图 |
|------|------|
| `intent` / `spec` / `plan` / `build` / `test` / `deploy` / `maintain` | 6 阶段执行步骤与模板用法（agent 按需读取） |
| `status` / `workflow` / `advance` / `reset` / `audit` | 控制与诊断 |
| `init` / `review` | 初始化（自动，一般无需）/ AI 自审 PR |
| `cycle` / `task` / `loop-resolve` / `quick` | 生命周期与输入分流 |

> 偏好显式调用可把 18 份手册注册到用户 prompts 目录（`~/.codex/prompts/
> sdlc-<名>.md`），之后用官方 `/prompts:sdlc-quick` 等形式调用——这是官方
> CLI 唯一支持的自定义调用形式。**注册已零操作化（v0.13.2）**：会话启动时
> SessionStart 自动注册/刷新（升版后手册自动更新到最新版；无需任何指令）；
> 显式卸载说「卸载 prompts 手册」→ MCP `register_prompts({action:"remove"})`
> （卸载后写入 opt-out 标记，不再自动恢复）；重新注册即清除标记。手动/离线/
> CI 场景可运行 `scripts/sh/install-prompts.sh`（macOS/Linux）或
> `scripts/ps/install-prompts.ps1`（Windows）——语义与自动注册同源
> （lib/prompts.mjs 单一事实源，经 common.mjs 桶导出）；`SDLC_PROMPTS_AUTO=off` 可关闭自动注册。

### shell 写通道加固（v0.13.3，规则 0e）

经 Bash 重定向/写命令（`>`、`>>`、`tee`、`rm`、`mv`、`cp` 目标、`dd of=`）触碰 `.sdlc/` 运行时状态文件（state.json / session-map.json / quick-tasks.json / mcp-launcher.json / events.jsonl / hook-audit.json 等）会被 PreToolUse 一律拦截——这些文件是门禁与隔离的信任锚点，绕过受控接口直接写等于自我授权或污染隔离；读取形态（`cat`/`ls`/`rg`）不受影响。修复通道：MCP 工具（自然语言即触发）或用户在编辑器中直接修改。

### 跨平台脚本护栏（v0.13.2，hook 层环境自检）

插件同时携带 sh（macOS/Linux）与 ps1（Windows）两套脚本，仅凭扩展名或 OS
判断会误伤真实环境（Windows 装了 Git Bash/WSL 时 .sh 完全可用，反之裸
Windows 跑 .sh 必报错）。v0.13.2 起由 hook 层在**运行时探测真实能力**：

- **SessionStart 环境画像注入**：平台 + POSIX shell / PowerShell 可用性（
  PATH 扫描 + Git Bash/WSL 常见落点探测，单次 < 1ms）；本机不可用的脚本
  形态直接告知 agent 勿调用（如「本机无 bash：勿执行 .sh——等价用
  scripts/ps/*.ps1 或 MCP 工具」）
- **PreToolUse 能力感知护栏**：拦截「注定失败」的脚本调用（bash/sh/wsl
  启动器、直接执行 .sh，或 powershell/pwsh、直接执行 .ps1）并给出精确
  替代——插件脚本会自动映射孪生（`scripts/sh/x.sh` ↔ `scripts/ps/x.ps1`，
  孪生存在才推荐），其余给 MCP 免 shell 通道（Node fs 三平台一致）
- **能力感知而非 OS 一刀切**：装了 Git Bash/WSL 的 Windows 照常跑 .sh，
  装了 pwsh 的 macOS/Linux 照常跑 .ps1；只拦探测确认不可用的调用
- **误伤面最小化**：只拦执行形态；`cat`/`ls`/`grep` 读取 .sh 路径、
  `node *.mjs` 等跨平台命令不受影响

环境画像与护栏触发均进 hook 审计（`detail.env` / `detail.script_guard`）；
注册事件留痕 `events.jsonl`（`prompts_auto_registered`）。

### MCP 工具（23 个，前缀 `mcp__sdlc-orchestrator__`）

| 工具 | 用途 |
|------|------|
| `status` | 查询当前状态（含 scope_binding、test_gate 诊断段） |
| `workflow` | 6 阶段全景图 |
| `advance {from, force?}` | 强制推进 |
| `reset {keep_history?}` | 重置状态（默认保留历史） |
| `refresh` | 强制重新检测阶段 |
| `accept_plan` | 工程师接受 plan.md |
| `set_fix_mode {enabled}` | 进入/退出修复模式 |
| `approve_release {approver}` | 发布管理员授权生产部署 |
| `set_change_ticket {ticket_id}` | 设置变更工单号 |
| `set_stage {stage, note?}` | 受控阶段回退/钉住（需求变更回 design） |
| `new_cycle {archive_dir?, keep_history?}` | 开启新迭代周期（归档 + 重置） |
| `cycle_list` | 查询周期归档历史 |
| `task_create {name, note?}` | 创建隔离任务工作区（会话绑定，不动全局指针） |
| `task_switch {task_id, global?}` | 切换任务（默认只切会话绑定） |
| `task_list` | 任务清单 |
| `task_close {task_id, archive?}` | 关闭任务（默认归档工件） |
| `loop_resolve {decision, note?, task_id?}` | 修复循环中断决策（自然语言「重试一轮/我自己来修」即触发） |
| `session_scope {action?, session_id?}` | MCP 会话身份诊断/绑定/解绑 |
| `self_review` | AI 自审 PR |
| `quick_task {action, desc?, id?, note?}` | 临时任务队列（v0.12.0 输入分流）：`add` / `list` / `run` / `done` / `drop`（自然语言「记个临时任务/看队列」即触发；周期进行中登记排队，周期走完后处理） |
| `register_prompts {action?, dir?}` | 官方 `/prompts:` 手册注册（v0.13.2 起日常已自动化）：`register` 幂等安装/刷新（清除 opt-out 标记）/ `remove` 卸载（写标记，不再自动恢复）/ `list` 查看状态；默认目标 `~/.codex/prompts`（`SDLC_PROMPTS_DIR` 可覆盖）——显式刷新/自定义目录/卸载的跨平台通道（Node fs，免 shell） |
| `audit {limit?}` | 查看审计日志（上限 100） |
| `events {limit?}` | 查看事件流（上限 100） |

### CLI 命令（macOS/Linux；Windows 在会话内用 MCP 工具等价替代）

```bash
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh status
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh workflow
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh advance <stage>
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh accept
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh reset
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh audit [N]
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh events [N]
bash ~/.codex/plugins/ai-sdlc/scripts/sh/sdlc.sh doctor

# Playwright 受控环境协议（v0.13.12，三平台一致）
node ~/.codex/plugins/ai-sdlc/hooks/scripts/setup-playwright.mjs --check [项目根]
node ~/.codex/plugins/ai-sdlc/hooks/scripts/setup-playwright.mjs --install <full|chrome|skip> --yes [项目根]
```

> CLI 是只读便利品；状态/推进/审计的跨平台主通道是 MCP 工具（`status` /
> `workflow` / `advance` / `reset` / `audit` / `events`，Node 实现，三平台一致）。
> 例外：`accept`（v0.13.11）是**受控写通道**——与 MCP `accept_plan` 同锁同语义
> （锁内幂等推进 build_plan→build_impl + plan_accepted 事件留痕
> via:cli:accept-plan），MCP 工具未随会话暴露时 agent 记录工程师显式接受的
> 唯一合法 Bash 通道（PreToolUse 规则 1b 对精确路径豁免；Windows 等价形态
> `node …/hooks/scripts/accept-plan.mjs [项目根]`）。仅 accept 豁免——
> advance/reset 可跳过产出与门禁检查，plan 模式仍拦。
> 手册注册 v0.13.2 起会话启动自动完成（见上方「操作手册」段）；误在无 bash 的
> Windows 上跑 sh 脚本（或无 pwsh 的 macOS/Linux 上跑 ps1）会被 PreToolUse
> 跨平台护栏拦截并给出等价替代（见上方「跨平台脚本护栏」段）。
>
> `setup-playwright.mjs`（v0.13.12）：`--check` 只读检测（包管理器/
> @playwright/test/浏览器缓存/本机 Chrome・Edge + 三选项报告，任何阶段可跑，
> plan 模式白名单已豁免）；`--install <full|chrome|skip> --yes` 受控安装
> （`--yes` = 用户已明确选择的凭证，缺省拒绝执行）。**安装与否由用户抉择**
> ——agent 先呈报报告等选择再执行；安装命令需要网络，Codex 沙盒拒时按
> 三层联动协议向用户请求授权（见下方「沙盒与权限」段）。

## 技能（skills/）

插件自带两类技能，Codex 按 SKILL.md 的 description 匹配自动启用（无需任何命令）：

| 类别 | 目录 | 触发 |
|------|------|------|
| 阶段技能 ×6 | `skills/sdlc-{planning,design,build,test,deploy,maintain}/SKILL.md` | 阶段推进到对应 Stage 时（SessionStart 资源索引逐阶段提示） |
| 能力技能 ×1 | `skills/frontend-e2e/`（Playwright + 反检测，references ×5） | build_impl / test 阶段涉及前端改动时 |

### 前端 E2E 技能（frontend-e2e）速览

```bash
npx playwright test     # 标准命令——被测试门禁识别，计入 test_runs；通过 → test_pass=true
```

要点：

- 环境检测与受控安装（v0.13.12）：`node …/setup-playwright.mjs --check` 只读探测
  → 报告+三选项呈报用户 → `--install <full|chrome|skip> --yes` 受控执行（详见
  `docs/lifecycle.md` §2.12）。**安装与否由用户抉择**；本机 Chrome 通道
  （`channel:'chrome'`）零浏览器下载，网络受限环境优先考虑
- `--install` 与 `npx playwright install` 一样只能在 Stage 3b 之后执行
  （plan 模式 Bash 只放行只读命令——`--check` 是白名单豁免的唯一形态）
- `playwright install` / `setup-playwright --install` / `codegen` / `show-report`
  是工具命令，**不计为测试执行**；被 Codex 沙盒拒而失败的测试命令同样不计
  （那是环境授权问题不是代码问题，v0.13.12）
- 失败输出（`✘ N [browser] › …` 编号清单）自动进入失败签名与循环熔断
- 视觉闭环：`toHaveScreenshot` 与 spec.md mock 机械对比；`--update-snapshots`
  仅限 spec 明确变更视觉基线
- 证据运行用默认/list/line/dot 报告器（json/none 会丢失败行、退化弱签名）
- `bash -c "npm test"` 等引号负载形态同样计入（v0.9.0）；引号内字面量伪证
  （`echo 'npm test'`）不会
- **反检测（v0.9.0）**：被测站点带机器人检测用例卡挑战页时，按
  `references/anti-detection.md` 阶梯加固——L1 原生（零依赖）→ L2 `channel: 'chrome'`
  → L3 playwright-extra stealth；仅限自有/授权目标，只改指纹不弱化断言
  （详见 `docs/lifecycle.md` §2.7）

## DIY 自定义

- **自定义阶段规则**：`.sdlc/custom/rules/stage-<name>.md` 覆盖内置
  `rules/stage-<name>.md`
- **自定义工件模板**：`.sdlc/custom/templates/<name>.tpl` 覆盖内置
  `templates/<name>.tpl`
- **自定义技能**：`.sdlc/custom/skills/<name>/SKILL.md` 被 Codex 加载为技能
  （与内置技能叠加，不覆盖内置）
- **自定义闭环节奏**：编辑 `.sdlc/bands.yaml`（监控指标、基线、规则、响应级别）
- **阶段手工覆盖**：在 `.sdlc/state.json` 设置 `stage_override` 字段强制使用某个
  阶段（测试或特殊情况；设为 `null` 恢复自动检测）——用户在编辑器中手工改，
  hook 不拦人类操作

## 排障

**hook 未触发**：① `/hooks` 是否信任了 ai-sdlc 的 hooks；② `~/.codex/hooks.json`
是否包含 ai-sdlc 条目；③ `bash sdlc.sh doctor` 环境自检。

**阶段判定错误**：① 工件是否在约定工作区（`.sdlc/artifacts/`；任务模式
`.sdlc/tasks/<id>/`；根目录与 docs/ 的历史落位仍可检测）；②
`.sdlc/state.json` 的 `stage_override` 是否被设置；③ `refresh` 强制重新检测；
④ 极端情况 `reset` 重置。

**门禁阻止了合法操作**：① `status` 检查当前阶段；② plan 模式阻止编辑代码 →
先生成 plan.md 并 accept_plan；③ 修复模式阻止编辑测试 → `set_fix_mode(false)`；
④ 生产门禁阻止部署 → `approve_release`。

**通知没响**：① 当前项目 `.sdlc/hook-audit.json` 查 `stop` 条目的 `detail.notify.reason`
（`below-min-duration` = 回合短于阈值属正常；`disabled` = 被环境变量关闭；
`dispatch-failed:…` = 平台组件问题）；② Windows 确认「专注助手/勿扰」未拦截
Toast；③ macOS 通知权限（系统设置 → 通知 → 脚本编辑器/osascript）；④
Linux 桌面需 notify-send；⑤ 用 `SDLC_NOTIFY_CMD` 接自己的通知工具。

**MCP server 未启动**：① `~/.codex/config.toml` 是否包含
`[mcp_servers.sdlc-orchestrator]`；② `~/.codex/plugins/ai-sdlc/mcp/sdlc-orchestrator/index.js`
是否存在；③ codex 会话内执行 `/mcp` 查看状态。

## 沙盒与权限（v0.13.12）

Codex 沙盒默认拒绝网络访问（curl / npm install / npx playwright install /
git clone…）与端口监听（dev server…）——这是**平台安全机制**，不是插件门禁。
插件的三层联动让 agent 在被拒时采取正确动作（向用户请求授权提权）而不是
反复重试或绕过：

| 层 | 你会看到什么 |
|----|-------------|
| 预防性预警 | 会话内首次网络/端口命令前，agent 收到授权应对协议提示（每会话一次） |
| 拒绝证据 | 命令失败输出命中特征时记入审计事件（`sandbox_denied`）；被拒的测试命令**不计入失败轮次**（不会误导修复循环） |
| 回合提醒 | 拒绝后的下一回合，agent 收到针对性提醒并应向你呈报：命令、目的、所需权限——**由你决定**批准提权运行或选替代方案 |

**Playwright 环境未就绪时**（本地通常没有相关依赖）：agent 会先跑只读检测
`node ~/.codex/plugins/ai-sdlc/hooks/scripts/setup-playwright.mjs --check`，
把环境报告与三个安装选项呈报给你：

- **A `--install full`**：装包 + 下载 Chromium（约 100–170MB，需网络授权）
- **B `--install chrome`**：仅装 npm 包（几 MB），复用本机 Chrome/Edge
  （config `channel:'chrome'`）——**零浏览器下载**，网络受限环境首选
- **C `--install skip`**：零网络。改用既有测试套件，或本机 Chrome
  `--headless` CLI 辅助取证（不满足测试门禁）

选择后 agent 加 `--yes` 执行（脚本无 `--yes` 拒绝运行——安装始终由你抉择）。
详细机制见 `docs/lifecycle.md` §2.12。
