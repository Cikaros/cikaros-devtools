# Changelog — cikaros-devtools

`cikaros-devtools` 是 Codex CLI 专用本地插件市场仓库，内含 `specflow` 与 `ai-sdlc`
两个插件。本文件记录**仓库级发行版本**（marketplace 安装器版本）变更；插件细粒度
历史见各自 `docs/changes/CHANGELOG.md`。格式遵循
[Keep a Changelog 1.0](https://keepachangelog.com/zh-CN/1.0.0/)。

## 版本矩阵

| 仓库发行版 | specflow | ai-sdlc | 主题 |
|-----------|----------|---------|------|
| **v1.13.13**（当前） | v1.2.4 | v0.13.13 | 审批等待通知轮次（Codex 审批弹窗 y/esc 出现在回合进行中——任务静默暂停而用户不知情：网络/端口命令放行时发 alert 级桌面通知把人叫回终端，在场窗口 120s 降噪，SDLC_NOTIFY_APPROVAL=off 可整类关闭） |
| v1.13.12 | v1.2.4 | v0.13.12 | 沙盒授权与 Playwright 受控环境轮次（三层联动：网络/端口命令预警→拒绝证据→回合授权提醒；setup-playwright.mjs 受控安装——三选项用户抉择 + 本机 Chrome 零浏览器下载通道；被拒测试命令不计失败轮次） |
| v1.13.11 | v1.2.4 | v0.13.11 | plan 接受通道与生命周期记忆轮次（引号感知 Bash 词法——搜索模式内 \| \> \$ 不再误拦；每回合生命周期状态条 + 等待接受提醒；接受意图识别直达 accept_plan，MCP 不可用时受控 CLI 回退 sdlc.sh accept） |
| v1.13.10 | v1.2.4 | v0.13.10 | 全流程模拟排错轮次（E2E 模拟器 40 断言驱动：未提交 .gitignore 污染 diff 检测/提交后门禁跌落/守卫显示矛盾/悬空模板引用/排队提醒不列条目） |
| v1.13.9 | v1.2.4 | v0.13.9 | Bash 门禁准确性轮次（plan 模式误报修复：sed -n / apply_patch heredoc / 文档重定向分类放行 + /dev/null 豁免 + 落位指引统一 .sdlc/artifacts） |
| v1.13.8 | v1.2.4 | v0.13.8 | macOS 通知交互轮次（applet 自托管宿主免 Script Editor + afplay 声音必达 + 需决策专属音） |
| v1.13.7 | v1.2.4 | v0.13.7 | Codex 对齐轮次（SessionEnd 超时 10s→3s 对齐 Codex 硬上限，消除启动 clamping 警告） |
| v1.13.6 | v1.2.4 | v0.13.6 | 代码组织轮次（common.mjs 拆 12 分层领域模块 + MCP server 拆四件套，行为零变更，全量回归通过） |
| v1.13.5 | v1.2.4 | v0.13.5 | 跨进程并发安全轮次（共享状态读-改-写跨进程锁 + BOM 容错 + 原子写回退删除 + 注入消毒） |
| v1.13.4 | v1.2.4 | v0.13.4 | 健壮性轮次（单元+插桩测试驱动：写保护路径规范化/测试证据门槛/并发审计锁/协议错误响应） |
| v1.13.3 | v1.2.4 | v0.13.3 | MCP 启动链修复（.mcp.json 内联 bootstrap + 启动器指针 + 防投毒四级解析）+ PreToolUse shell 写通道加固（规则 0e） |
| v1.13.2 | v1.2.4 | v0.13.2 | hook 层环境自检与零操作（SessionStart 环境画像 + 手册自动注册/opt-out + PreToolUse 能力感知跨平台脚本护栏） |
| v1.13.1 | v1.2.4 | v0.13.1 | 官方 /prompts: 注册跨平台化（MCP register_prompts 工具三平台一致 + ps1 补齐）+ 意图→工具映射悬空引用修复 |
| v1.13.0 | v1.2.4 | v0.13.0 | 命令体系迁移（官方无自定义 slash 命令 → 自然语言→MCP 工具 + 官方 /prompts: 桥） |
| v1.12.0 | v1.2.4 | v0.12.0 | 输入分流（需求/ISSUE 走 SDLC、补充信息融入周期、临时任务排队不混淆） |
| v1.11.0 | v1.2.4 | v0.11.0 | 回合结束通知（任务完成/需决策时系统弹窗+声音，macOS/Windows/Linux） |
| v1.10.0 | v1.2.4 | v0.10.0 | 工件工作区化（不入版本控制）+ 首次使用自动初始化 + 设计一致性修复 |
| v1.9.0 | v1.2.4 | v0.9.0 | Playwright 反检测阶梯 + 全项目安全加固（7 项修复） |
| v1.8.0 | v1.2.3 | v0.8.0 | frontend-e2e 能力技能 + 6 个阶段技能实体交付（修复悬空引用） |
| v1.7.0 | v1.2.3 | v0.7.0 | 测试门禁 + 修复循环中断（用户四决策通道） |
| v1.6.0 | v1.2.3 | v0.6.0 | Intent 提问闭环 + MCP 会话隔离 + 发布准备 |
| v1.5.1 | v1.2.3 | v0.5.1 | 深度审计修复（apply_patch 状态机失明等 9 项，2 高危） |
| v1.5.0 | v1.2.3 | v0.5.0 | 工件生命周期 + 多会话/多任务隔离 |
| v1.4.0 | v1.2.3 | v0.4.0 | 文档写入保护策略标准化（「代码不可变、文档可写」） |
| v1.3.1 | v1.2.3 | v0.3.0 | Claude→Codex 全面适配 + 安全修复，正式定版 |
| v1.3.0 | v1.2.2 | v0.2.0 | 安装流程重构：marketplace-only 注册，插件启用交由 `/plugins` |
| v1.2.x 及更早 | v1.2.1- | — | 插件级安装器时代（历史见 specflow CHANGELOG） |

## [Unreleased]

## [1.13.13] — 2026-09-11

> 审批等待通知轮次。ai-sdlc v0.13.13 同步发行。用户反馈：Codex 审批弹窗
> （`1. Yes, proceed (y)` / `2. No (esc)`）出现在回合进行中——任务静默暂停
> 而用户不知道（Stop 通知只覆盖回合结束）。本轮以预测式信号补盲：网络/端口
> 命令放行时发 alert 级桌面通知把人叫回终端，在场窗口降噪。全部原位修改，
> 无新增文件（复用 v0.13.12 的 sandbox.mjs netPortKind 判定与 notify.mjs
> 分发链）。

### 新增（详见 ai-sdlc CHANGELOG 0.13.13）

- 审批等待通知（approval-wait）：PreToolUse 规则 0f 同判定点（网络/端口命令
  特征）另发 alert 级桌面通知——「等待你的批准」+ y/esc 操作提示 + 命令预览；
  审计留痕 detail.approval_notify 可排障
- 在场窗口降噪：PostToolUse 在网络/端口命令完成时（无论成败）刷新
  hooks-state.netport_last_exec_at，默认 120s 内静默（刚批准/拒过 = 人在
  终端）；与 agent 教育文案的会话级去重相互独立
- 配置：SDLC_NOTIFY_APPROVAL（默认 on）/ SDLC_NOTIFY_APPROVAL_PRESENCE
  （默认 120s）；会话接管重置同步（旧在场不抑制新会话首通知）

## [1.13.12] — 2026-09-11

> 沙盒授权与 Playwright 受控环境轮次。ai-sdlc v0.13.12 同步发行。用户反馈：
> ① curl 等网络访问、dev server 等端口命令被 Codex 沙盒拦截后 agent 不知
> 应请求用户授权提权（反复重试/绕路）；② 本地通常无 Playwright 依赖，希望
> 插件内置下载机制且由用户抉择（备选驱动本机 Chrome）。安装器新增依赖文件
> hooks/scripts/setup-playwright.mjs + hooks/scripts/lib/sandbox.mjs +
> hooks/scripts/lib/playwright-env.mjs（+3 文件），其余全部原位修改。

### 新增（详见 ai-sdlc CHANGELOG 0.13.12）

- 沙盒授权三层联动：PreToolUse 规则 0f 网络/端口命令预警（每会话去重）+
  PostToolUse 拒绝证据检测（强/弱特征分级，写入 hooks-state 与事件流）+
  UserPromptSubmit 1f 下回合授权提醒（呈现一次即清除）
- setup-playwright.mjs 受控安装协议：--check 只读环境检测（plan 模式白名单
  豁免）→ 三选项呈报用户抉择（A full / B 本机 Chrome 零浏览器下载 / C skip）
  → --install --yes 受控执行（缺 --yes 拒绝运行）；幂等步骤裁剪
- SessionStart「沙盒与权限」协议段；frontend-e2e 技能 §3 三步协议重写；
  playwright.config.ts.tpl channel 备选通道注释增强

### 修复

- 被 Codex 沙盒拒绝的测试命令不再计入 test_runs/失败轮次（沙盒拒绝 ≠
  测试失败——此前会把 fix_loop 引向「修不存在的 bug」）

## [1.13.11] — 2026-09-10

> plan 接受通道与生命周期记忆轮次。ai-sdlc v0.13.11 同步发行。修复用户实测
> 死锁链：上下文压缩后 agent 丢失「plan 等待接受、需先调 accept_plan」记忆 →
> 直接改业务代码被拦 → rg 排查命令又被引号内 | 误切分误拦 → 会话未暴露
> MCP 工具且无 CLI 回退——无合法通道记录接受。安装器新增依赖文件
> hooks/scripts/accept-plan.mjs（+1 文件），其余全部原位修改。

### 修复（详见 ai-sdlc CHANGELOG 0.13.11）

- Bash 门禁引号感知词法：引号内的 | > $ 是搜索模式字面量不再误拦；引号
  包裹写目标真实提取（规则 0e 三个预存逃逸向量修复）
- UserPromptSubmit 新增每回合生命周期状态条 + plan 等待接受提醒（含保守
  接受意图识别）——上下文压缩后 agent 不再丢失流程记忆
- 受控 CLI 回退：`sdlc.sh accept` / `node accept-plan.mjs`（与 MCP
  accept_plan 同锁同语义可审计；规则 1b 精确路径豁免，advance/reset 不豁免）
- 意图→工具映射表补 accept_plan / approve_release / set_change_ticket
  人工门禁三行；MCP accept_plan 工具补 plan_accepted 事件留痕

## [1.13.10] — 2026-09-10

> 全流程模拟排错轮次。ai-sdlc v0.13.10 同步发行。构建 E2E 模拟器走完一次
> 真实会话全链，对链上每步输出与每段注入提示双重断言；修复暴露的 5 类真实
> 缺陷与 2 项文案细节。安装器无行为变化，仅版本号同步。

### Fixed

- **ai-sdlc 全新项目阶段误跳（P1）**：bootstrap 自建未提交 `.gitignore` 计入
  业务 diff——plan.md 落地后阶段误判 Stage 4 TEST，plan 模式改代码门禁
  静默失效、Stop 错报测试门禁与错误人工关卡。
- **ai-sdlc 部署/修复门禁提交后跌落（P1）**：规则 2/3/4 只看瞬态检测值——
  测试通过并提交后检测跌回 build_impl，迁移工单/生产授权/修复期测试保护
  在「已提交」窗口失效。统一并集阶段判定（与规则 4b 同语义）。
- **ai-sdlc 守卫与阶段呈现一致性（P1）**：SessionStart 守卫生效时不再显示
  另一阶段的来源/子阶段（实测「Stage 6 Maintain + 子阶段 implementation」
  矛盾注入）；Stop/UserPromptSubmit 按有效阶段（检测值与保存值中更靠后者）
  呈现产出检查/人工关卡/规则注入/通知文案。
- **ai-sdlc 悬空模板引用（P1）**：资源索引的工件模板行对非文件产物生成
  不存在的模板路径（test-pass.tpl / incident→intent.md.tpl 等）——改为
  produces 存在性判定，仅注入真实存在的模板。
- **ai-sdlc Stop 排队提醒不列条目（P2）**：周期进行中只报数量不列内容，
  agent 无从向用户转达——排队分支同样列出 ≤5 条消毒条目。
- MCP session_scope bind 缺参文案补空格；注释错别字修正。

### Added

- 开发侧 E2E 全流程模拟器 `scripts/e2e-fullflow.mjs`（8 幕 40 断言）：冷启动
  注入/输入分流/Open questions 门禁/跨会话记忆/反模式警告/plan 模式门禁/
  测试失败循环/loop_resolve 双路径/部署门禁/maintain 闭环归档/quick_task
  全生命周期/任务隔离模式/MCP 只读工具面；全部注入文本静态质量校验（引用
  资源与工具名存在性、废弃命令话术、阶段-来源一致性）。

### Verified

- 全量回归九套全绿：round1 35 + round2 37 + round3 18 + round6 25 +
  triage 98 + regression 16 + smoke 8 场景 + verify-bash-gate 18 +
  e2e-fullflow 40。

## [1.13.9] — 2026-09-10

> Bash 门禁准确性轮次。ai-sdlc v0.13.9 同步发行。修复用户实测的 plan 模式
> 四连误报与 spec.md 落位指引漂移，安装器无行为变化，仅版本号同步。

### Fixed

- **ai-sdlc plan 模式 Bash 门禁四类误报**：sed -n 读形态、apply_patch
  heredoc 文档载荷（markdown 反引号误判命令替换）、文档目标重定向
  （与工具通道语义对齐分类放行）、/dev/null stderr 抑制。代码目标/
  就地编辑/fix_loop 中断期严格性全部保持。
- **ai-sdlc spec.md/plan.md 落位指引统一**：design/build 规则与 sdlc-design
  技能补齐 `.sdlc/artifacts/` 工作区约定（v0.10.0 漏更新两处——
  stage-design「默认：根目录 spec.md」是 spec.md 落错位置的根因）。
- 拦截命令展示上限 120→300 字符（违规证据不再被截断遮蔽）。

### Verified

- 全量回归 7 套全绿；triage 新增场景 26（13 断言）。

## [1.13.8] — 2026-09-10

> macOS 通知交互轮次。ai-sdlc v0.13.8 同步发行。修复用户实测反馈的
> 通知无声与点击打开 Script Editor 两缺陷，安装器无行为变化，仅版本号同步。

### Fixed

- **ai-sdlc macOS 通知无声**：声音从 `display notification sound name`
  （通知中心策略不可靠）改为 `afplay` 独立通道（直接音频输出必达）；
  弹窗与声音解耦，通知中心关掉本 app 通知时声音仍会响。
- **ai-sdlc 点击通知打开 Script Editor**：osascript 直发的通知宿主归属
  AppleScript Editor。改为系统 `osacompile` 惰性生成的自托管 applet
  （`$CODEX_HOME/sdlc-notifier/ai-sdlc-notifier.app`，LSUIElement agent
  无感）作宿主——点击通知静默无动作。降级链 applet → bootstrap →
  osascript 保底。新增 needs-input 专属音（默认 Funk）区分紧急度。

### Verified

- 全量回归 7 套全绿；triage 新增场景 25（macOS 通知静态断言 8 项）。

## [1.13.7] — 2026-09-10

> Codex 对齐轮次。ai-sdlc v0.13.7 同步发行。修复用户实测反馈的 Codex 启动
> 警告（SessionEnd 超时钳制），安装器无行为变化，仅版本号同步。

### Fixed

- **ai-sdlc hooks.json SessionEnd `timeout` 10s → 3s**：Codex hooks engine
  对 SessionEnd/Interrupt 事件有 3s 硬上限（`SESSION_END_MAX_TIMEOUT_SEC`，
  codex-rs `hooks/src/engine/discovery.rs`），超过会被钳制并在每次启动时
  打警告 `clamping SessionEnd hook timeout to 3s`；其余事件默认 600s
  无上限（SessionStart 30 / UserPromptSubmit 10 / PreToolUse 10 /
  PostToolUse 15 / Stop 20 均合法不变）。实测 session-end.mjs 全流程
  ~55ms，3s 预算充裕。specflow 同字段自始为 3，不受影响。

### Verified

- 全量回归 7 套全绿；triage 新增 SessionEnd 超时上限静态断言防回归。

## [1.13.6] — 2026-09-10

> 代码组织轮次。ai-sdlc v0.13.6 同步发行。行为零变更的内部重构（最终排查
> 7 套测试全绿后执行），安装器无行为变化，仅版本号同步。

### Changed

- **ai-sdlc common.mjs（1865 行）拆为 12 个领域模块 + 桶导出**：L0 paths/util
  → L1 atomic（原子写 + 跨进程锁）→ L2 state/audit → L3 bootstrap/quicktasks/
  prompts/mcplink/cycles → L4 testgate/tasks，依赖分层无环；common.mjs 变为
  桶（barrel）显式再导出，hooks / MCP ESM 桥 / 测试导入面零改动。
- **ai-sdlc MCP server（index.js 1365 行）拆为四件套**：server-state.js
  （可变上下文 S 容器）+ context.js（桥/路由/状态 IO/检测）+ tools.js
  （23 工具实现与定义 + callTool）+ index.js（薄入口）；`.mcp.json` bootstrap
  拉起点不变，initialize 握手版本 0.13.6。
- **元数据/文档**：plugin.json / hooks.json / marketplace.json 描述瘦身
  （价值主张 + 近三版摘要 + CHANGELOG 指针）；插件 README / architecture.md /
  AGENTS.md 等 10+ 文档的模块落位引用同步；双 CHANGELOG 条目。

### Verified

- round1 35 + round2 37 + round3 18 + round6 25 + triage 71 + regression 16 +
  smoke 8 场景全部通过（行为零变更有测试背书）。

## [1.13.5] — 2026-09-10

**ai-sdlc v0.13.5 · 跨进程并发安全轮次（Cross-Process Concurrency Round）**
（迭代协议 Round 6：排查角度全面换新，修复 4 个真实缺陷——1×P1 + 3×P2）

- **跨进程读-改-写锁（P1）**：hooks 进程与 MCP 常驻进程对 state.json /
  tasks.json / quick-tasks.json / session-map.json / cycles.json 的并发
  读-改-写此前无锁（v0.13.4 审计锁只覆盖 hook-audit.json）——Codex 并行
  工具调用 / 双会话同项目时后写者覆盖前写者（丢阶段推进 / sdlc_engaged /
  队列条目 / 会话绑定）。现全部走 common.mjs `mutateJsonFile`（O_EXCL
  lockfile 泛化审计锁，hooks 与 MCP 经 ESM 桥同一把锁；推进写入锁内幂等
  重验）。测试：10 进程并发无锁丢 3/10 vs 有锁 10/10 存活（阴性对照）。
- **BOM 容错（P2）**：全部 JSON 读取（hooks 4 处 + MCP 4 处）剥 UTF-8
  BOM——Windows 工具链写入 BOM 不再把状态静默读成 null。
- **MCP 原子写回退删除（P2）**：O_EXCL/rename 失败不再回退 writeFileSync
  直写（跟随符号链接 + 半写；Windows 并发占用 rename 失败时可达）。
- **注入消毒（P2）**：Stop hook 注入的 quick-task desc/id 消毒（换行折叠 +
  指令模式中和 + id 白名单）——克隆仓库投毒 .sdlc/ 不能伪造 hook 指令行。
- 测试：round6-audit 25/25（新增）；round1 35/35 + round2 37/37 +
  round3 18/18 + triage 71/71 + regression 16/16 + smoke 全绿。

## [1.13.4] — 2026-09-10

> 仓库级发行：ai-sdlc v0.13.4（健壮性轮次——单元 + 插桩测试驱动的问题排查与修复）。
> 安装器版本同步 v1.13.4；specflow 无变更（v1.2.4）。

- **ai-sdlc v0.13.4**（5 轮迭代排查：插桩 harness 20 fuzz × 7 hooks、common.mjs
  函数级单元测试、MCP 23 工具全量冒烟、核心状态机闭环全链路、并发竞态 10 连跑）：
  - 修复 Windows 反斜杠路径逃逸写保护（4 种形态）：pre-tool-use 路径分隔符规范化
    （normSep）——classifyFile 入口 + RUNTIME_STATE.test 内部，Edit/patch 通道与
    规则 0e shell 写通道全覆盖
  - 修复测试证据门槛漏洞：PostToolUse 测试命令在 tool_response 缺失
    exit_code/success 时默认「通过」——空响应事件虚增 test_runs 并置
    test_pass=true，「未测试禁 push/PR」门禁可被误置绕过；现无证据不计数
    不置位（事件留痕 test_evidence_missing）
  - 修复并发审计间歇丢条目（flaky，10 并发约 1/6 概率丢 1 条）：tryAuditLock
    退避重试（16×6ms ≈ 96ms 预算，Atomics.wait 同步等待）——修复后 10 连跑 0 丢失
  - 修复 MCP stdio 协议行为：超长行 drop 与非法 JSON 静默丢弃 → 回规范
    JSON-RPC 错误（id:null -32600 / -32700），客户端不再挂等到超时
  - 修复 quick-task 队列无界增长：非终态（queued/in_progress）达上限 100 拒绝
    新登记（返回 error 提示先处理），不再默默膨胀
  - 测试基建沉淀：scripts/round1-3-audit.mjs（可复跑的插桩/单元/fuzz/协议/
    并发测试套件，35+37+18 断言）+ hook-harness.mjs 通用插桩运行器

## [1.13.3] — 2026-09-10

> 仓库级发行：ai-sdlc v0.13.3（MCP 启动链修复 + shell 写通道加固）。安装器
> 版本同步 v1.13.3；specflow 无变更（v1.2.4）。

- **ai-sdlc v0.13.3**：
  - 修复关键缺陷：插件 `.mcp.json` 相对路径（`./mcp/sdlc-orchestrator/index.js`）
    在真实插件安装下 ENOENT——Codex 以用户启动目录为插件 MCP 子进程 cwd、
    `.mcp.json` 相对 args 按该 cwd 解析且不插值 `${VAR}`
    （openai/codex#19582 实测、#22842 确认），MCP server 根本起不来
  - `.mcp.json` 改为 `node -e` 内联 bootstrap（自定位引导，四 24 字符单行、
    JSON 安全无转义；`SDLC_BOOTSTRAP_PROBE=1` 诊断探针模式）
  - bootstrap 四级解析链：`SDLC_PLUGIN_ROOT` env 显式覆盖 > `.sdlc/mcp-launcher.json`
    启动器指针（SessionStart 写入，防投毒校验：指针指向的 plugin_root 必须
    位于 `CODEX_HOME/plugins` 之内才采信）> `CODEX_HOME/plugins` 两层扫描兜底
    （`plugins/<plugin>` 与 `plugins/<marketplace>/<plugin>` 两种布局）> cwd
    回退（classic/本地开发布局）
  - `common.mjs` 新增 `writeMcpLauncherPointer()`：SessionStart 幂等刷新指针
    （原子写 + 版本自读 `.codex-plugin/plugin.json`）；失败不阻塞会话，注入
    修复提示行 + `mcp_launcher_write_failed` 事件留痕；审计 detail 增
    `mcp_launcher` 字段
  - `mcp-launcher.json` 纳入 PreToolUse 写保护（RUNTIME_STATE_RES）与
    `.codexignore` 托管块——防 agent 篡改 MCP 加载路径
  - **PreToolUse 新增规则 0e（shell 写通道加固）**：`shellWriteTargets()`
    从 Bash 命令提取写形态目标（重定向 `>`/`>>`/`2>` 目标 + tee/rm/truncate/
    shred/cp/install/mv/dd 文件参数），命中运行时状态一律 block——此前
    `echo ... > .sdlc/state.json` 可绕过规则 0 的 file_path 通道（自我授权/
    污染隔离/伪造票据）；读取形态（cat/ls/rg/grep）不提取不误伤；误提取
    无害（非运行时路径不命中）。审计 detail 增 `shell_state_guard` 字段
  - RUNTIME_STATE_RES 与 `.codexignore` 托管块清单对齐：补
    `events.jsonl` / `hook-audit.json` / `session-end.json` / `prompt-trace.json`
    （此前声明为运行时文件却未拦截——伪造 events/audit = 污染审计链）
  - MCP server 版本 0.13.3；smoke 测试 8 场景全绿（指针写入/深层布局指针
    命中/防投毒/扫描兜底/cwd 回退/双通道写保护/读取不误伤/端到端 initialize
    握手）

## [1.13.2] — 2026-09-10

> 仓库级发行：ai-sdlc v0.13.2（hook 层环境自检与零操作）。安装器版本同步
> v1.13.2；specflow 无变更（v1.2.4）。

- **ai-sdlc v0.13.2**：
  - 新增 `hooks/scripts/lib/env.mjs` 运行环境画像（能力感知：POSIX shell /
    PowerShell 真实可用性探测，非 OS 一刀切）
  - PreToolUse 新增跨平台脚本护栏（规则 0d）：拦截注定失败的 `.sh`/`.ps1`
    调用并给出精确替代（ps1/sh 孪生脚本或 MCP 免 shell 通道）——响应
    「仅用 sh 脚本无法同时适配 Windows 和 macOS」的跨平台诉求，误调用
    零报错
  - SessionStart 手册零操作自动注册/刷新（升版自愈；opt-out 标记 +
    `SDLC_PROMPTS_AUTO=off`）——使用者可能什么都不懂也能开箱即用
    `/prompts:sdlc-<名>`
  - MCP `register_prompts` 重定位为显式通道（强制刷新/自定义目录/卸载）
  - 详细变更见 `plugins/ai-sdlc/docs/changes/CHANGELOG.md` [0.13.2]

## [1.13.1] — 2026-09-10

> 主题：ai-sdlc 官方 `/prompts:` 手册注册跨平台化——v1.13.0 的注册桥只有
> bash 脚本（install-prompts.sh），Windows 原生不可达。注册逻辑收敛到
> Node fs 单一事实源（common.mjs），会话内说「注册操作手册」即经新增 MCP
> `register_prompts` 工具完成（macOS/Linux/Windows 一致）；新增
> `install-prompts.ps1`（Windows 脚本便利品），sh 版降级为平台便利品。
> 同时修复 v0.13.0 的「意图→工具映射」悬空引用（SessionStart 补注入真实
> 映射表）并新增注册状态 hook 自检。ai-sdlc v0.13.1；specflow 零改动。

### Added（ai-sdlc v0.13.1）

- MCP `register_prompts` 工具（第 23 个）：register（幂等安装/刷新）/
  remove（只删 sdlc-* 前缀副本）/ list；默认目标 ~/.codex/prompts
  （SDLC_PROMPTS_DIR 可覆盖）；事件留痕 events.jsonl
- `common.mjs` 注册模块（listPromptManuals / promptsRegisterStatus /
  registerPromptManuals / removePromptManuals——hooks 与 MCP 单一事实源）
- `plugins/ai-sdlc/scripts/ps/install-prompts.ps1`：Windows PowerShell 等价
  脚本（-Remove/-List/-Dir，PS 5.1 兼容 + BOM）
- SessionStart 注册状态自检（未注册→一行跨平台指引；已注册→静默）

### Fixed（ai-sdlc v0.13.1）

- v0.13.0 遗留：SessionStart 注入文案两处引用「意图→工具映射」但表格
  从未实际注入（悬空引用）——补注入 8 行真实映射表

### Changed（ai-sdlc v0.13.1）

- 18 份 prompts/ 手册与 AGENTS/README/usage-guide/MCP README/architecture/
  lifecycle 的话术同步：注册三选一（MCP 工具推荐 / sh / ps1）；
  plugin.json 0.13.1 + cross-platform-prompts；hooks/marketplace 描述同步；
  4 个 marketplace 安装器版本号 v1.13.1

### 详见

- `plugins/ai-sdlc/docs/changes/CHANGELOG.md` §0.13.1

## [1.13.0] — 2026-09-10

> 主题：ai-sdlc 命令体系迁移——官方 Codex CLI 不支持插件自定义 slash 命令
> （唯一自定义形式是 `/prompts:<prompt_name>`），v1.12.0 引入的 `/sdlc-quick`
> 等命令在官方 CLI 下不可达。交互迁移为：自然语言→MCP 工具（主通道）+
> 官方 `/prompts:` 调用（可选注册桥）。ai-sdlc v0.13.0。

### Changed（ai-sdlc v0.13.0）

- 移除 UserPromptSubmit 内 4 个 slash 命令解释器（死代码）与全部 /sdlc-*
  话术；SessionStart 改注入「意图→工具映射表」，每回合分流提醒同步自然语言化
- prompts/ 18 份手册重定位为操作手册（quick/task/loop-resolve/cycle 重写，
  其余更新）；文档全面同步（AGENTS/README/usage-guide/lifecycle 等）
- sdlc_engaged 显式参与置位迁移到「工件写入 + 任务创建 + MCP 首次调用」

### Added（ai-sdlc v0.13.0）

- `scripts/sh/install-prompts.sh`：官方 `/prompts:<name>` 桥（18 份手册注册
  到用户 prompts 目录，幂等可卸载，注册后可用 `/prompts:sdlc-quick` 调用）


## [1.12.0] — 2026-09-10

> 主题：ai-sdlc 输入分流（Input Triage）——把用户输入提炼区分为需求/ISSUE、
> 补充信息、临时任务三类：需求/ISSUE 统一走 SDLC 流程；补充信息融入当前
> 周期工件；临时任务不走流程单独处理——周期进行中提出的临时任务登记排队，
> **待周期走完后统一处理，二者不混淆**（ai-sdlc v0.12.0；specflow 零改动）。

### Added（ai-sdlc v0.12.0）

- **输入分流规则 `rules/triage.md`**：三分类判定（REQ/SUPP/QUICK）+ 优先级
  规则 + 混合输入拆分 + 硬约束（临时任务不得混入周期 diff / 补充信息不另开
  流程 / 需求不得伪装成临时任务）
- **临时任务队列 `.sdlc/quick-tasks.json`**（全局，切任务不丢；agent 禁改，
  PreToolUse block）：`/sdlc-quick add|list|run|done|drop` 用户命令 +
  MCP `quick_task` 工具两条受控通道；状态机 queued → in_progress → done /
  queued → dropped；上限 100（只裁终态）
- **三重防遗忘注入**：SessionStart 完整分流协议 + 队列状态；UserPromptSubmit
  每回合轻量提醒；Stop 队列提醒（周期内→排队中须转达用户，空闲→待处理）
- 6 个阶段 SKILL 新增「输入分流边界」段；sdlc-maintain 明确周期归档后为
  队列统一处理时机

### Fixed（ai-sdlc v0.12.0）

- sdlc-planning SKILL / rules/stage-planning.md 与 v0.10.0 工件工作区化的
  矛盾（「提交到版本控制」「默认根目录」等过时表述 → `.sdlc/artifacts/`
  工作区约定 + 审计链治理）
- sdlc-maintain SKILL 归档路径错误（docs/sdlc/archive → 默认 .sdlc/archive）

### 详见

- `plugins/ai-sdlc/docs/changes/CHANGELOG.md` §0.12.0

## [1.11.0] — 2026-09-09

> 主题：ai-sdlc 回合结束通知——任务完成或 Codex 需要用户决策/回答时，系统
> 弹窗 + 声音把使用者叫回终端，最大化 agent 工作期间的等待时间利用
> （ai-sdlc v0.11.0；specflow 零改动）。

### Added（ai-sdlc v0.11.0）

- **回合结束通知**（`hooks/scripts/lib/notify.mjs` + `notify.ps1`，Stop hook
  接线）：needs-input（修复循环中断 / Open questions 待回答——无用户输入
  即不推进，总是通知）与 turn-end（受防噪阈值约束，默认 10s：长任务必达、
  终端前快答不扰）
- 分发链零依赖且脱钩（detached + unref，失败静默不扰 hook）：自定义命令
  `SDLC_NOTIFY_CMD` → macOS osascript（afplay 兑底）→ Windows PowerShell
  Toast（argv 传参，降级 msg.exe / SystemSounds）→ Linux notify-send
- 配置面：`SDLC_NOTIFY` / `SDLC_NOTIFY_POPUP` / `SDLC_NOTIFY_SOUND` /
  `SDLC_NOTIFY_MIN_SECONDS` / `SDLC_NOTIFY_SOUND_MAC` / `SDLC_NOTIFY_CMD`
  （零配置默认全开）；通知结果进审计 `detail.notify` 可排障；
  UserPromptSubmit 落盘 `last_prompt_at`（回合时长依据）
- 文档同步：usage-guide（通知配置表 + 排障）、lifecycle §3.2（触发语义/
  分发链/设计边界）、architecture（模块图 + 设计决策）、AGENTS/README/
  plugin.json/marketplace.json/hooks.json
- 测试：`scripts/test-sdlc-v011.mjs`（55 用例：配置/构建/分发探针/门禁
  绕阈值/防噪/集成端到端）；v0.10.0 回归 39 用例通过

## [1.10.0] — 2026-09-09

> 主题：① 流程工件不入版本控制（任务中间产物，归档即可） ② sdlc 自行监测并
> 初始化首次使用的项目 ③ 全量逻辑/设计扫描修复（ai-sdlc v0.10.0）。同步完成
> 文档层重构（原 [Unreleased] 内容并入本版）。

### Added（ai-sdlc v0.10.0）

- **首次使用自动初始化**（`ensureProjectBootstrap`，幂等）：首个会话即完成
  state.json 全 schema + `.gitignore`/`.codexignore` 托管块，并注入声明；
  新增 `bootstrap-project.mjs` CLI 入口（init-project.sh / sdlc.sh / hook 同源）
- **工件工作区化**：intent/spec/plan/REVIEW 落 `.sdlc/artifacts/`（任务模式
  `.sdlc/tasks/<id>/`），不进版本控制；归档默认目录改为 `.sdlc/archive/`
  （docs/sdlc/archive 仍可显式选择）；PreToolUse 新增工件落位护栏 warn；
  工件溯源以 cycle-id 取代 commit-sha
- 单一事实源三件套：`defaultState()` 全量状态 schema / `isEngaged()` 参与
  判定 / `ARTIFACT_CANDIDATES` 候选路径（hooks / MCP / 归档共用）

### Fixed（ai-sdlc v0.10.0，设计一致性）

- engagement 判定三处不一致（pre 7 字段 / post、stop 各漏 change_ticket）
  → 统一 `isEngaged()`
- `deploy_approved` 死字段退役（无置位方；hooks 与 MCP 推进时重置字段不同）
  → 统一真值 `release_approval`
- MCP `reset` 状态 schema 残缺（缺 in_fix_mode / change_ticket /
  release_approval / test 与 intent 门禁字段）→ 全量
- session-start 局部默认状态残缺（缺 v0.5–v0.9 字段）→ `defaultState()`
- init-project.sh `.codexignore` 块过时（缺 v0.5+ 运行时文件且误列
  artifacts/）→ bootstrap 托管块取代；移除 `--guided` 死参数
- appendAudit 并发读-改-写互盖丢条目 → O_EXCL 锁 + 过期清理 + 兜底直写
  （`.lock` 纳入运行时状态保护）
- sdlc.sh status/workflow/advance 缺 state 时报错退出 → 自动初始化
- uninstall.sh 日志版本串 v1.8.0 滞后；prompts/reset.md 误引 specflow 预设

### Changed（文档层重构，不涉及运行时逻辑）

- 依据代码实测全量重写文档层：修正 ai-sdlc 版本表述（README 曾滞留 v0.6.0/
  v0.5.1）、MCP 工具计数（ai-sdlc 21 个 / specflow 26 个）、specflow
  `init --type` 实际取值与 DIY 六维度接线状态等失实处
- specflow：移除 v0.x 旧需求文档归档目录（181KB）；7 份 v0.x 组件卡合并重写为
  `docs/components.md`；4 个 MCP README 合并为 `mcp/README.md`；三份 CHANGELOG
  保留全量条目、去除铺陈
- RELEASE-CHECKLIST 路径与版本修正；ADR ×9 精简去冗、修正死链

## [1.9.0] — 2026-09-08

> 反检测 + 安全加固轮：① Playwright 融入反检测能力保障可用性 ② 修复潜在风险与漏洞。

### Added（ai-sdlc v0.9.0）

- **frontend-e2e 反检测（anti-detection）**：被测站点带机器人检测
  （Cloudflare/DataDome/reCAPTCHA/OAuth 反自动化）导致用例卡挑战页时分层加固——
  - `skills/frontend-e2e/references/anti-detection.md`：权威指南（症状判别表 /
    L1 原生加固（零依赖）→ L2 真实 Chrome 通道 → L3 playwright-extra stealth /
    行为层 / 指纹自检 / 合规硬边界 / 与门禁、循环熔断的协作语义）
  - `references/stealth.fixture.ts`：L1 与 L3 可运行 fixture 模板；
    SKILL.md 新增 §8；playwright.config.ts.tpl 反检测可选段；debug-ci.md 排查条目
  - **合规硬边界**：仅限自有/授权测试目标；只改指纹不弱化断言；测试门禁对反检测
    运行一视同仁
- lifecycle.md §2.7 反检测子节（权威标准）；命令矩阵补 shell -c 识别行

### Fixed（安全加固，7 项）

| # | 问题 | 修复 |
|---|------|------|
| S1 | 符号链接预植入 TOCTOU（高危）：固定名 tmp + `writeFileSync` 跟随符号链接，可绕过 `.sdlc/` 写保护实现任意文件写入 | 随机后缀 tmp（`<pid>.<8hex>`）+ `openSync 'wx'`（O_EXCL）+ rename 只替换目录项；PreToolUse 扩展 `.sdlc/**/*.tmp` 兜底 |
| S2 | session-map 键注入：`__proto__` 型 session_id 触发原型 setter（绑定静默丢失） | `sessionMapKey` 键归一化（bind/unbind/resolveScope/MCP 双侧；正常 UUID 无感） |
| S3 | `bash -c "npm test"` 漏判（v0.8.0 遗留） | 引号感知扫描器：只在引号外识别 shell 词并提取 -c 负载递归判定（≤2 层嵌套；引号内伪包装不提取） |
| S4 | MCP stdio 无行长上限 | 单行 JSON-RPC 超 1 MiB 拒绝解析并记 stderr（两份 mcp-lite.js 同步） |
| S5 | 安装器内嵌代码路径注入 | install.sh 内嵌 python/node 脚本改 argv 传参；sdlc.sh cmd_audit 同修 |
| S6 | specflow 测试执行器命令无护栏 | test-executor.json 的 command 须非空字符串且 ≤2000 字符（异常拒绝执行并留痕） |
| S7 | events.jsonl 无限膨胀 | 超 2 MiB 滚动截断（保留最近 5000 行 + events_rotated 留痕） |

### Changed

- 版本矩阵：仓库 v1.9.0 / ai-sdlc v0.9.0 / specflow v1.2.4；write-policy 与
  lifecycle 并发写安全段更新为 v0.9.0 加固语义

### Compatibility

- 无破坏性变更：状态文件格式不变；session-map 键归一化对正常 UUID 无感；
  原子写对外签名不变；`isTestCommand` 新增可选 depth 参数向后兼容
- 已知边界：MCP 行长护栏在 readline 缓冲层之后（防解析放大不防缓冲）；specflow
  自定义 PreToolUse 正则无执行超时（用户自担配置）；PowerShell 安装器仍无 pwsh 实测

## [1.8.0] — 2026-09-08

> 前端 E2E 测试技能轮：交付 `skills/frontend-e2e/`（标准命令计入测试门禁）并补齐
> 6 个阶段技能——此前 plugin.json / stage-detector / SessionStart / AGENTS.md /
> README 全部引用 `skills/` 但目录从未存在（悬空引用）。新增测试
> `scripts/test-skills.mjs`。

### Added（ai-sdlc v0.8.0）

- **frontend-e2e 能力技能**（Playwright）：SKILL.md（触发条件 / 栈识别 / 引导安装
  （Stage 3b 起）/ 用例编写规范 / 标准运行命令 / `toHaveScreenshot` 视觉闭环 /
  失败调试 / CI 集成 / 反模式）+ references×3（config 模板 / 示例用例 / 调试 CI 速查）
- **6 个阶段技能实体交付**（`skills/sdlc-{planning,design,build,test,deploy,maintain}/`）：
  rules/stage-*.md 的可执行摘要，SessionStart 资源索引提示路径全部真实
- **测试门禁 Playwright 命令识别**（`common.isTestCommand` 单一事实源）：
  `npx/pnpm/yarn/bunx playwright test`（含 dlx/exec 形态）、裸 `playwright test`
  （含 .bin 路径前缀）、`npm run e2e` / `test:e2e`（含 `e2e:*` 变体）；
  `playwright install/codegen/show-report` 等工具命令**不计入** test_runs
- **失败签名 Playwright 格式**：`✘ N [browser] › file:line › title` 等进入签名提取
  ——同一 E2E 失败重跑同签名（循环熔断 R1 可命中）
- SessionStart 资源索引在 build_impl/test 阶段追加 frontend-e2e 提示行；
  lifecycle.md §2.7、usage-guide 技能章节同步

### Fixed（ai-sdlc v0.8.0）

- **门禁字面量绕过**（存量缺陷）：整串匹配前剥离引号字面量——`echo "npm run e2e"`、
  `git commit -m "make test pass"` 等字符串不再计为测试执行（防伪造 test_pass）；
  漏判方向失败安全（`bash -c` 包裹形态会被多拦一次，重新裸跑即可）
- **悬空引用修复**：plugin.json `"skills"`、stage-detector skill 字段、SessionStart
  注入路径、AGENTS.md/README 声明全部指向真实目录
- **specflow 失实声明移除**（根 README + specflow plugin.json）：声称存在
  `skills/workflow/SKILL.md` 但从未存在——采用移除而非虚构的最小诚实修复

### Changed

- 版本号统一 v1.8.0 / ai-sdlc v0.8.0（specflow v1.2.3 不变）

## [1.7.0] — 2026-09-08

> 测试门禁 + 修复循环中断轮（用户实测反馈：「应当在 plan 完成后进行测试，有问题
> 进行下一个 intent；若出现循环问题则应中断询问用户，而不是持续循环下去」）。
> 新增测试 `scripts/test-testgate-fixloop.mjs`（66 用例）。

### Added（ai-sdlc v0.7.0）

- **测试门禁**：plan 接受并实施后必须真实测试——`test_runs` 计数（未跑过时 Stop
  强提醒）；build_impl/test 阶段且 `test_pass=false` 时 `git push` / `gh pr create`
  硬拦（保存/检测阶段取并集防漏）；逃生通道与 plan 接受门禁同构
- **失败记录与签名**：多框架失败行提取 + 归一化（剥数字/耗时/ANSI）→ 同一问题重复
  出现同一签名；`test_failures` 历史（上限 50）+ `fix_rounds` 轮次
- **修复循环中断（Fix Loop Guard）**：同签名最近 5 次失败窗口内 ≥2 次（A→A /
  A→B→A，**跨周期有效**）或同周期连续失败 ≥3 轮（`SDLC_MAX_FIX_ROUNDS` 可调）→
  `fix_loop` 置位 → 业务代码写入阻断（文档/测试命令放行）+ 三处提醒呈报 →
  `/sdlc-loop-resolve retry|new-intent|manual|escalate` 四决策；测试真实通过自动解除
- `/sdlc-loop-resolve` 命令 + MCP `loop_resolve` 工具 + status `test_gate` 诊断段；
  权威标准 lifecycle.md §2.6

### Changed（ai-sdlc v0.7.0）

- 测试命令识别扩充（pnpm/yarn/bun、vitest、npx runners、python -m、dotnet/deno/
  gradlew）；Bash 工具名兼容 `shell`/`Shell`
- `new_cycle`：`test_failures` 跨周期保留；`fix_rounds`/`fix_loop`/`test_runs`
  按周期重置
- stage-test 规则、AGENTS.md 门禁表、usage-guide、MCP README、hooks.json 同步

### Fixed（ai-sdlc v0.7.0）

- PostToolUse 合并段对 `fix_loop` 的覆盖隐患（内存值优先且 null 显式生效）
- **gitStatusPorcelain 首行错位**（存量 bug）：整串 trim 剥掉首行前导空格 → porcelain
  路径错位 → 纯插件状态变更被误判为业务 diff；改为逐行 trim
- **fix_loop 误伤面**：置位与门禁侧补参与证据门控（普通仓库调试连败不再被阻断）
- **fix_loop 的 Bash 绕过**：中断期间非只读且非测试命令一律 block
- 弱签名 exit code 被归一化吞掉（命令归一化 + 显式退出码后缀）

## [1.6.0] — 2026-09-08

> 交互闭环 + 会话隔离轮。新增测试 `scripts/test-intent-qa.mjs`（40 用例）+
> `scripts/test-mcp-isolation.mjs`。

### Added（ai-sdlc v0.6.0）

- **Intent Open questions 交互闭环**：开放问题写入 intent.md 即推进、从未给发起者
  回答机会——现协议层要求 agent 先逐条提问并结束回合等待回答；门禁层解析
  `## Open questions`，存在未回答条目则停在 `planning/awaiting_answers`；提醒层
  三处注入（Stop 清单 / SessionStart 遗留 / UserPromptSubmit 每回合）。已回答标记：
  移除条目或 `- [x]` / `~~删除线~~` / 行尾 `[resolved]`。逃生通道 `/sdlc-advance`
- **MCP 会话上下文隔离**：SessionStart 写会话票据（`.sdlc/mcp-bind-queue/`）→
  MCP 进程首次调用 FIFO 原子认领（rename 抢占）→ pin 会话身份 → 每次调用动态查
  session-map 路由。优先级：`task_id` 显式 > env `SDLC_TASK` > pinned 绑定 >
  全局指针（v0.5 兼容回退）> legacy；孤儿票 10 分钟清理
- **写侧隔离**：pinned 会话下 `task_create` 只绑会话；`task_switch` 默认只切会话
  绑定（`global: true` 才切全局指针）
- MCP `session_scope` 工具（show/bind/unbind）；status 输出 `scope_binding` 段
- 写保护扩展：`.sdlc/mcp-bind-queue/**` block（伪造票据 = 冒充会话路由）
- 发布准备：`docs/RELEASE-CHECKLIST.md`；根 README 版本矩阵同步

### Changed（ai-sdlc v0.6.0）

- status gates 段新增 `intent_awaiting_answers` / `intent_open_questions`；`substage`
  对外暴露
- detectStage 双侧在 intent 有未答问题时返回 `planning/awaiting_answers`
- MCP 侧统一路由（`routeScope`），`task_id` 显式参数贯通所有工具
- rules/stage-planning.md 硬约束 5（提问必须等待发起者）；templates/intent.md.tpl
  标记约定；反模式新增「自问自答 Open questions」
- lifecycle.md 新增 §2.5 与 §4.5 权威标准

### Fixed（ai-sdlc v0.6.0）

- 门禁 hold 状态缺字段（hold 路径显式维持 planning）
- 门禁标记被合并覆盖（门禁字段以本 hook 内存值优先）

### Compatibility

- 已有**无** Open questions 的 intent.md 行为不变；CI/env `SDLC_TASK` 场景不变；
  无票据 MCP 进程回退全局指针路由

## [1.5.1] — 2026-09-08

> 深度审计修复轮：v1.5.0 全量代码第二轮交叉审查，修复 9 项缺陷（2 项高危）。
> 新增回归 `scripts/test-bugfix-v151.mjs`（21 用例）。

### Fixed（ai-sdlc v0.5.1）

- **[高危] apply_patch 状态机失明**：post-tool-use 不解析 `tool_input.patch` →
  真实 Codex 环境下工件写入不触发推进/置位/归档；现解析 Add/Update 目标并逐一校验
- **[高危] plan 待接受窗口期门禁失效**：detectStage 无该分支，一路跌回 planning →
  现返回 `build_plan/awaiting_acceptance`
- **[高危] session-start 阶段回归污染**：检测值无条件覆盖保存值 → 加防回归守卫
  （保存阶段更靠后时保留）
- post-tool-use 乱序自举（状态文件缺失时自举 planning）；快照清理改按 mtime 淘汰；
  审计写入统一原子化（MCP 侧含降级回退）；MCP accept_plan 即时推进；归档双 stamp
  跨秒不一致

### Fixed（CLI）

- sdlc.sh advance 死依赖与门禁语义对齐；reset 真保留 artifact_history 与
  cycle_count（此前实际写空数组）

### 内部

- 交付目录打包卫生（清除 __pycache__，后续打包排除）

## [1.5.0] — 2026-09-07

> 工件生命周期与多会话/多任务隔离：把「工件会删除吗 / 如何反复迭代 / 多会话污染吗」
> 三问固化为可执行标准（权威文档 `plugins/ai-sdlc/docs/lifecycle.md`）。

### Added（ai-sdlc v0.5.0 — 工件生命周期）

- **周期归档轮转 `new_cycle`**：旧周期工件**移动**（非删除）到
  `docs/sdlc/archive/<cycle-id>/`（附 cycle-meta.json），阶段机重置 planning、
  cycle_count+1、engagement 保持。三通道：`/sdlc-new-cycle` 命令 / MCP `new_cycle` /
  maintain 闭环自动归档
- **工件永不自动删除**（反模式明令禁止）：SessionEnd 只存档会话快照（保留 50 个）
- **maintain 闭环打通**（v0.4.0 hook 侧为死代码）：Stage 6 写出新 intent.md 时自动
  归档旧周期
- 受控阶段回退 `set_stage`；周期历史查询 `cycle_list` + `.sdlc/cycles.json`（200 条）

### Added（多会话/多任务隔离）

- 四级作用域路由（env `SDLC_TASK` > session-map 绑定 > resume 续绑 > legacy）；
  任务隔离工作区 `/sdlc-task` + MCP `task_*`（每任务独立 state/工件/审计/去重）；
  会话亲和 session-map（LRU 200），**新会话不自动吸附活跃任务**；跨会话接管检测；
  原子写（tmp+rename）

### Fixed（ai-sdlc v0.5.0）

- **reset 无法开启新周期**：语义二分——`reset` = 完整退出（不清工件）、
  `new_cycle` = 迭代延续（归档+重置）
- `stage_override` 粘死（推进即解除）；MCP advance maintain 推进补 release 清除

### Security

- 运行时状态 block 名单扩展（任务状态/隔离索引/会话快照）；周期归档目录 warn

### Compatibility

- legacy 模式完全向后兼容；任务模式 opt-in；`.sdlc/` 新增文件建议 gitignore

## [1.4.0] — 2026-09-07

> 写入保护策略标准化：修复 PreToolUse「连文档都拦」的过度拦截，按 playbook 语义
> 重设计为「代码不可变、文档可写」三层模型（权威文档
> `plugins/ai-sdlc/docs/write-policy.md`）。

### Fixed（ai-sdlc v0.4.0）

- **plan 模式过度拦截**：旧版除 `plan.md`/`docs/`/`.sdlc/` 外全部 block（README、
  CHANGELOG、design 文档全被拦）→ 仅拦**业务代码类**，文档类任意阶段可编辑
- **无关仓库误拦**：引入 `sdlc_engaged` 参与标记（工件写入或 `/sdlc-*` 命令置位），
  未参与项目门禁降级为 warn
- **新分支阶段检测失效**（存量 bug）：unborn branch 上 `git rev-parse` exit 128 →
  优先 `git branch --show-current`

### Security（Bash 门禁三漏洞加固）

- 链式命令绕过（拆段逐段校验）；重定向写文件（`>`/`>>`/`2>file` 视为写）；
  命令替换（`$(...)`/反引号一律拦）；apply_patch 路径盲区（解析全部目标路径）；
  运行时状态防篡改（`.sdlc/state.json` 任何阶段 block）

### Added

- `docs/write-policy.md` 权威标准；规格漂移提醒（build/test/deploy 改 spec.md →
  warn）；只读白名单扩充；`sdlc_engaged` + MCP `reset` 同步清除

## [1.3.1] — 2026-09-07

> Codex 适配定版：仓库定位固化为「Codex CLI 专用插件市场」，清除全部 Claude 专属
> 机制与死代码，同步修复安全漏洞与文档失实。

### Changed

- 根 README 重写（版本矩阵 / Codex 专用声明 / 结构图）；交付物命名固定
  `cikaros-devtools`（不带版本号）；根 CHANGELOG 新建
- ai-sdlc v0.3.0：机构知识 CLAUDE.md → AGENTS.md（遗留回退兼容）；非交互调用
  `claude -p` → `codex exec`；CI 模板 `@anthropic-ai/claude-code` → `@openai/codex`；
  全量去 Claude 化；slash 命令计数修正 12 → 14

### Fixed（specflow v1.2.3）

- `.codexignore` 黑名单路径绕过（`config/.env` 带目录写法）→ 增加路径基名匹配分支
  （防误报语义不变）

### Removed（specflow v1.2.3）

- `plugins/specflow/adapters/` 跨 CLI 适配层（marketplace-only 重构后为死代码，
  且与 Codex 专用定位冲突）

## [1.3.0] — 2026-09-07

> 安装流程重构：安装/卸载脚本迁移至仓库根 `scripts/`，只做 marketplace 注册/移除；
> plugin 启用/停用交由用户在 codex 会话内 `/plugins` 决定。

### Changed

- 仓库根新增 `scripts/{sh,ps}/{install,uninstall}.{sh,ps1}`（幂等，`--yes`/`--status`）
- 两插件移除各自 install/uninstall 脚本与 classic 模式；移除 `--target`/`--all`/
  `--interactive` 跨 CLI 适配器入口

### Migration（v1.2.x → v1.3.0）

- 旧版用户：仓库根 `bash scripts/sh/install.sh` 注册 marketplace → codex 会话内
  `/plugins` 启用 → `/hooks` 信任；项目级 `.specflow/` / `.sdlc/` 不受影响
