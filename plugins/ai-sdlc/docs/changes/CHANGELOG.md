# Changelog — ai-sdlc

所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，
版本遵循 [Semantic Versioning](https://semver.org/)。仓库级发行版历史见仓库根
`CHANGELOG.md`（ai-sdlc 各版本与仓库 v1.3.x+ 发行版对应关系见其版本矩阵）。

## [Unreleased]

## [0.13.13] — 2026-09-11

> Approval-Wait Notification Round（审批等待通知轮次）。用户实测反馈：Codex
> 的工具审批弹窗（`1. Yes, proceed (y)` / `2. No, and tell Codex what to do
> differently (esc)`）出现在**回合进行中**——任务静默暂停，而用户不知道；
> Stop hook 的回合结束通知只覆盖「agent 主动结束回合」，mid-turn 审批等待
> 是 v0.11.0 通知体系在 notify.mjs 头注里诚实披露的盲区（hooks 六事件无
> 「等待审批」时刻）。本轮以**预测式信号**补上：网络/端口类命令（沙盒默认
> 拦截 → 必触发审批或拒绝）在 PreToolUse 放行时发 alert 级桌面通知把人
> 叫回；在场窗口降噪防连续审批打扰。仓库同步 v1.13.13。

### Added

- **审批等待通知（approval-wait，lib/notify.mjs）**：`buildApprovalWaitNotification`
  （标题「ai-sdlc · 等待你的批准」+ 正文含 y/esc 操作提示 + 所需权限类别
  （网络访问/端口监听）+ 命令预览）与 `notifyApprovalWait` 编排入口
  （PreToolUse 规则 0f 同判定点接线）——alert 级分发（needs-input 同类
  提示音 Funk，用户动作必需）；结果进审计 `detail.approval_notify`
  （`via:xxx` / `presence-window` / `approval-off` / `disabled`）可排障
- **在场窗口降噪（presence window）**：PostToolUse 在网络/端口命令**完成**时
  （无论成败——成功=用户刚批准或自动放行；被拒=用户刚拒绝或沙盒自动拒绝）
  刷新 `hooks-state.netport_last_exec_at`；PreToolUse 通知在窗口内
  （`SDLC_NOTIFY_APPROVAL_PRESENCE`，默认 120s；0=每次都通知）静默——
  刚交互过 = 人在终端不重复打扰，窗口外的等待重新通知（人可能又离开）。
  与规则 0f 的 agent 教育文案去重**相互独立**（文案面向 agent 每会话一次；
  通知面向用户按在场窗口）
- **配置面**：`SDLC_NOTIFY_APPROVAL`（默认 on，`off` 整类关闭审批等待通知）+
  `SDLC_NOTIFY_APPROVAL_PRESENCE`（在场窗口秒数）——与既有 SDLC_NOTIFY_*
  同惯例，零配置可用
- **会话接管语义**：`netport_last_exec_at` 列入会话级状态（state.mjs /
  user-prompt-submit / post-tool-use 三处接管重置对象同步）——旧会话的
  在场记录不抑制新会话首个网络/端口命令的审批通知

### 设计边界（诚实披露）

- 审批弹窗何时出现由 approval_policy 决定（插件不可见）——预测式信号覆盖
  网络/端口类命令（默认沙盒下必触发审批或拒绝，高置信）；非网络命令在
  严格审批策略（untrusted 全询问）下的弹窗仍不可预测（已知盲区）
- 自动放行策略下可能出现假阳性（在场窗口把连续假阳性压缩到每窗口至多一次；
  不受打扰可 `SDLC_NOTIFY_APPROVAL=off`）；CLI 未来提供 Notification 类事件
  时预测层可即时退役（hooks.json 增一条目即可）

## [0.13.12] — 2026-09-11

> Sandbox Authorization & Controlled Playwright Setup Round（沙盒授权与
> Playwright 受控环境轮次）。用户反馈两问题：① curl 等网络访问、dev server
> 等端口占用命令每次都被 Codex 沙盒拦截——agent 不知道应向用户请求授权
> 提权，而是反复重试或绕路；② 本地环境一般没有 Playwright 相关依赖，
> 希望插件内置下载机制且由用户抉择是否下载（备选自行驱动本机 Chrome）。
> 本轮交付：沙盒授权三层联动 + setup-playwright.mjs 受控安装协议。
> 仓库同步 v1.13.12。

### Added

- **沙盒授权三层联动（优化①）**：Codex 沙盒默认拒网络/端口是平台安全机制
  （非插件门禁），插件不拦截合法网络命令，而是教育 agent 被拒时采取正确
  动作（向用户呈报命令/目的/所需权限，请求授权提权运行；勿重试勿绕过）：
  - **预防层（PreToolUse 规则 0f，warn 级）**：网络访问/端口监听类命令
    （curl/wget/包管理器 install/git clone・fetch・pull・push/gh/docker…
    与 npm run dev/vite/uvicorn 等）放行前注入授权应对协议
    （additionalContext，每会话去重一次，hooks-state.sandbox_protocol_shown
    会话级标记，接管重置语义与 token 计数一致）
  - **证据层（PostToolUse）**：Bash 失败输出命中特征才记录——强特征
    （network access is disabled / sandbox denied / seatbelt / landlock /
    requires approval）任意命令即记；弱特征（EPERM/EACCES/ENOTFOUND/
    ETIMEDOUT/permission denied…）仅网络/端口类命令记（防普通文件权限
    误报）→ hooks-state.sandbox_denied + events.jsonl `sandbox_denied`
    审计事件
  - **提醒层（UserPromptSubmit 1f）**：PostToolUse 是 async hook 输出不进
    上下文——拒绝信息经 hooks-state 中转，下回合注入针对性提醒（命令/
    特征/请求授权指引/Playwright 环境协议指引），呈现一次即清除（每条
    拒绝恰好提醒一回合，不累积噪音）；token 预算超额时列入 essentials
    保留（授权请求与门禁类交互同级）
- **setup-playwright.mjs 受控安装协议（优化②）**：新增 CLI 入口
  （hooks/scripts/setup-playwright.mjs + lib/playwright-env.mjs 纯函数库）：
  - `--check`：只读环境检测——包管理器（lockfile 证据链：pnpm/yarn/bun/
    npm）/ @playwright/test 依赖 / 浏览器缓存目录（PLAYWRIGHT_BROWSERS_PATH
    + 三平台默认落点，chromium 族识别）/ 本机 Chrome・Edge 探测（三平台
    PATH + 固定落点）+ 三安装选项报告（人读 + JSON 尾行，可直接转述用户）
  - `--install <full|chrome|skip> --yes`：受控执行。`--yes` 是用户已明确
    选择的**显式凭证**——缺省拒绝执行退出 1（agent 未经询问就安装被脚本
    层强制拦截，与 SKILL 协议双保险）。full=装包+下载 Chromium；
    chrome=仅装 npm 包（config `channel:'chrome'|'msedge'` 复用本机浏览器，
    **零浏览器下载**——网络受限环境最优解）；skip=零网络降级指引
    （既有套件满足门禁 / chrome --headless CLI 辅助取证不满足门禁）
  - 幂等步骤裁剪：已装包跳过装包、缓存已有 chromium 跳过下载；执行
    spawnSync(stdio inherit) 沙盒拒绝输出直接透传，失败打印授权应对指引
  - 规则 1b 受控探测豁免：plan 模式白名单放行 `--check`/`--help` 精确
    路径形态（评估前端测试方案的合法探测）；`--install` 不豁免——写
    package.json + 网络下载属带副作用操作，Stage 3b 起才合法
- **SessionStart 注入「沙盒与权限」协议段**：会话级教育（平台机制说明 +
  被拒三要素呈报 + Playwright 环境协议入口）；意图→工具映射表后注入
- **frontend-e2e 技能 §3 重写为三步协议**：--check 只读检测 → 报告+三选项
  呈报用户等待抉择 → --install --yes 受控执行；沙盒授权说明（含 webServer
  端口场景）与离线降级路径保留强化；playwright.config.ts.tpl 注释增强
  （channel 行升级为「本机浏览器备选通道」正式选项 + webServer 沙盒说明）

### Fixed

- **被拒测试命令误计为测试失败**：`npx playwright test` 因沙盒拒网络/端口
  而失败（命令根本没跑起来）此前照常计入 test_runs + fix_rounds——fix_loop
  会误判「代码有问题」把 agent 引向修不存在的 bug。修复：PostToolUse 测试
  计数前先做沙盒拒绝检测，命中则只留 `test_sandbox_denied_not_counted`
  事件不计数不进失败轮次（宁缺勿假，与 v0.13.4 证据门槛同理念）

## [0.13.11] — 2026-09-10

> Plan-Acceptance Channel & Lifecycle Memory Round（plan 接受通道与生命周期
> 记忆轮次）。用户实测反馈：plan 已产出等待接受，用户说「接受」后 agent
> 直接尝试修改业务代码被门禁拦截（上下文压缩后丢失「需先调 accept_plan
> 记录接受」的记忆）；随后 `rg -n "accept_plan|plan_accepted|accept-plan"
> … | head -80` 排查命令又被引号内 `|` 误切分误拦；且该会话未暴露
> mcp__sdlc-orchestrator__* 工具、无 CLI 回退通道——三条链合成死锁。
> 本轮打通全链：每回合生命周期记忆锚点 + 接受意图识别 + MCP/CLI 双通道 +
> Bash 门禁引号感知词法。仓库同步 v1.13.11。

### Fixed

- **Bash 门禁引号感知（用户实测误报）**：`bashWriteViolation` /
  `shellWriteTargets` 的链式拆段对整串 `split(/&&|\|\||;|\||\n/)`——引号内
  的 `|`（rg/grep 正则交替模式）被当成管道分隔符，产生「非只读命令段
  （plan_accepted）」确凿误报（v0.13.9 的 heredoc 载荷剥离未覆盖本形态）。
  修复：新增 shell 词法工具族（`quoteSpans` 引号区段识别 / `splitShellSegments`
  引号感知切分 / `substitutionProbe` 命令替换探针 / `findRedirects` 引号感知
  重定向扫描）——引号内 `| > $ \` 是字面文本；单引号内与转义形态的
  `$()`/反引号不执行（放行）；双引号内与裸位置仍会真实执行（保持拦截）；
  转义形态 `\|` `\<` 同样字面化。修复的误报形态：`rg "a|b|c" | head`、
  `rg "pattern > word" f`、`rg '\$\(' f`、`grep -E "foo|bar" f | sort`。
- **引号包裹写目标逃逸（预存漏判，同轮修复）**：`> ".sdlc/state.json"` 与
  `rm '.sdlc/state.json'` 此前因提取 token 含引号字符而逃逸规则 0e 的
  RUNTIME_STATE 锚定正则；`>&file`（双流写）被全局 `\d*>&` 剥离规则一并
  吞掉。修复：`findRedirects` 引号外操作符定位 + 目标 token 整段纳入后
  `stripQuotes` 剥引号 + `>&` 后非纯数字按文件目标处理——三个逃逸向量
  全部真实命中拦截。
- **plan 等待接受期无回合级锚点（死锁根因 1）**：UserPromptSubmit 有
  awaiting_answers（1b）与 fix_loop（1c）的每回合提醒，唯独
  awaiting_acceptance 没有——上下文压缩后 agent 丢失「plan 已产出、等待
  工程师接受、接受后才能改代码」的记忆。修复：新增 1e 每回合提醒（不进
  去重），含**接受意图识别**（保守高精度：纯肯定词/接受动词短语/否定守卫
  ——「不接受」「同意之前先补测试」「暂缓」均不误判）：用户说「接受」时
  注入明确指令「立即调用 MCP accept_plan」+ MCP 不可用时的 CLI 回退通道。
- **MCP 工具不可用时无记录接受的通道（死锁根因 2）**：会话未暴露
  mcp__sdlc-orchestrator__* 工具时，手改 state.json 被规则 0 拦截、Bash
  通道被 plan 模式白名单拦截——agent 无合法路径记录用户的显式接受。
  修复：新增受控 CLI 入口 `hooks/scripts/accept-plan.mjs`（与 MCP
  toolAcceptPlan 完全同语义：锁内幂等重验推进 build_plan→build_impl +
  plan_accepted 事件留痕 via:cli:accept-plan + 审计）+ `sdlc.sh accept`
  子命令；PreToolUse 规则 1b 对两种**精确路径**形态段级豁免（插件安装根
  路径匹配，防伪造；仅 accept 豁免——advance/reset 可跳门禁不豁免仍拦；
  豁免段链接其他违规段仍拦）。

### Added

- **生命周期状态条（每回合记忆锚点，0b）**：UserPromptSubmit 每回合注入
  紧凑两行「当前阶段（子阶段）· 任务隔离/闭环数 + 下一步：阶段特定动作
  （门禁类 substage/fix_loop/in_fix_mode 优先覆盖）」——上下文压缩后
  agent 仍可从本条恢复「现在在哪、卡在哪、下一步做什么」。token 预算
  超额时与门禁类提醒同保留（essentials 过滤补 `### 生命周期` /
  `### ⏸️ plan.md` 前缀）；门禁分支按 v0.13.10 有效阶段语义守卫（检测值
  即有效阶段才呈现）。
- **意图→工具映射表补人工门禁三行**（SessionStart）：「接受/同意/批准
  这个计划」→ `accept_plan`（含 CLI 回退）、「批准发布/生产上线」→
  `approve_release`、「迁移工单号是 XXX」→ `set_change_ticket`——此前
  映射表恰好缺 plan 接受这个最高频人工门禁意图。
- **MCP accept_plan 事件留痕**：`plan_accepted` 事件（via:mcp:accept_plan）
  ——与 CLI 回退通道同事件名，审计链可区分经哪条通道接受（历史无事件，
  接受只留 state 时间戳不可追溯）。
- `sdlc.sh accept` 子命令（POSIX 便捷包装，内部调 accept-plan.mjs）。
- 开发侧测试基建：`verify-accept-flow.mjs`（46 断言：死锁链复现→1e 提醒
  →意图识别→CLI 接受→门禁解除→幂等/边界 + 状态条各阶段呈现 + 意图识别
  24 边界）+ `verify-bash-gate.mjs` 扩展 18 断言（v0.13.11 引号感知 +
  受控豁免段）+ triage 场景 29（16 断言全链防回归）。

### Changed

- 规则 1 / 1b / 0 拦截文案补 CLI 回退通道与引号语义说明（含插件安装根
  实际路径，agent 被拦后可直接照抄通道命令）；Stop 人工关卡 build_plan
  行同补。
- MCP index.js / hooks.json / plugin.json / marketplace.json / 4 安装器
  版本同步 v0.13.11 / v1.13.11。

## [0.13.10] — 2026-09-10

> Full-Flow E2E Simulation Round（全流程模拟排错轮次）。构建端到端模拟器
> 走完一次真实会话全链（冷启动→分流→七阶段推进→门禁→闭环→归档→任务隔离），
> 对链上每步输出与每段注入提示双重断言，修复暴露的 5 类真实缺陷。仓库同步
> v1.13.10。

### Fixed

- **全新项目阶段误跳（P1）**：插件 bootstrap 自建的未提交 `.gitignore` /
  `.codexignore`（porcelain `??`）被 `gitHasUncommittedDiff` 计入业务
  diff——plan.md 落地后 detectStage 误判 Stage 4 TEST：① 规则 1（plan
  模式禁改代码）以 detection.stage 判定，误跳后门禁在「plan 写完到接受
  之间」静默失效；② Stop 错报「测试未通过」+ 错误人工关卡（test 的 CI
  关卡而非 build_plan 的工程师接受关卡）。修复：`??` 状态的根级
  .gitignore/.codexignore/.gitattributes 不计入 diff（已提交后的真实
  修改仍计入）。
- **部署/修复门禁提交后跌落（P1）**：git diff 是瞬态的——测试通过并提交
  后检测跌回 build_impl（保存值仍在 test/deploy）。规则 3（无工单禁改
  迁移）/ 规则 4（无授权禁生产部署）/ 规则 2（修复期禁改测试）只看
  detection.stage，在「已提交」窗口静默失效（规则 4b push 门禁 v0.7.0
  已用并集语义，三处漏改）。修复：统一 `stageSet = {state.current_stage,
  detection.stage}` 并集判定（任一侧命中即拦，宁严勿漏）；Stop 的测试
  门禁提醒同改。
- **SessionStart 守卫显示自相矛盾（P1）**：守卫生效（保存阶段更靠后）时，
  注入的「检测来源/子阶段」仍取 detection 的另一阶段签名——实测产出
  「Stage 6 — Maintain + 子阶段 implementation + 来源 plan+accepted」
  矛盾注入。修复：守卫生效时统一呈现 `stage-guard(saved-newer)` 来源
  说明（含原始检测值供排障）并抑制检测子阶段；hooks-state 的
  current_substage/stage_source 同源修正；审计补 stage_guard 明细。
- **Stop/UserPromptSubmit 阶段呈现不一致（P1）**：两 hook 直接用
  detection.stage 决定规则注入/产出检查/人工关卡/下一阶段预览/通知文案
  ——提交后 deploy 阶段的回合被注入 build_impl 规则、Stop 报错误关卡。
  修复：与 session-start 守卫同语义的「有效阶段 = 检测值与保存值中更靠后
  者」（override 永远优先）；awaiting_answers 门禁保持 detection 判定
  （该窗口检测值权威）。
- **悬空模板引用（P1）**：资源索引的工件模板行拼接
  `templates/${artifact}.tpl` 对非文件产物生成不存在的路径
  （test-pass.tpl / pr-merged.tpl / incident→intent.md.tpl / diff.md.tpl）
  ——agent 按图索骥 ENOENT。修复：按该阶段 produces 中真实存在模板的
  文件工件注入（planning/design/build_plan/maintain 命中各自模板，
  其余阶段省略该行）。
- **Stop 排队提醒不列条目（P2）**：周期进行中只报「N 条排队」不列内容
  ——文案自己要求「回复用户时请转达排队状态」，agent 无从转达。修复：
  排队分支同样列出 ≤5 条消毒条目（▶️ in_progress / • queued）。
- **MCP session_scope bind 缺参文案（P3）**：`bind 需要session_id 参数`
  缺空格；多处注释错别字（自意→自动/自愈、兑底→兜底）。

### Added

- `scripts/e2e-fullflow.mjs`（开发侧测试基建，40 断言/8 幕）：端到端模拟
  一次完整会话——冷启动注入/输入分流/Open questions 门禁/跨会话记忆/
  反模式警告/plan 模式门禁/测试失败循环/loop_resolve 双路径/部署门禁/
  maintain 闭环归档/quick_task 全生命周期/任务隔离模式（含 rule 2 与
  fix_loop）/MCP 只读工具面文案快照；每段注入文本做静态质量校验
  （引用资源存在性/工具名存在性/废弃命令话术/阶段-来源一致性）。

### Verified

- 全量回归：round1 35 + round2 37 + round3 18 + round6 25 + triage 98 +
  regression 16 + smoke 8 场景 + verify-bash-gate 18 + **e2e-fullflow 40**
  全绿（九套）。

## [0.13.9] — 2026-09-10

> Bash Gate Accuracy Round（Bash 门禁准确性轮次）。修复用户实测的 plan
> 模式四连误报与 spec.md 落位指引漂移。仓库同步 v1.13.9。

### Fixed

- **plan 模式 Bash 只读门禁四类误报**（规则 1b，v0.4.0 遗留）：
  - `sed -n '520,820p' <file>`（行段读取，纯 stdout）被「非只读命令段」
    误拦 → sed 读形态白名单（无 `-i`/`--in-place` 且脚本无 `w` 写命令）；
    `sed -i` 就地编辑与 `sed 'w file'` 仍拦
  - `apply_patch <<'PATCH' ... Add File: plan.md`（plan 阶段本职产出通道）
    被「命令替换/非只读段」误拦——两重根因：① markdown 载荷中的反引号
    （代码 span）被整串扫描误判为 shell 命令替换；② apply_patch 不在只读
    白名单。修复：quoted heredoc 载荷剥离（`<<'X'` 标记位于行尾时载荷是
    纯数据，不参与语法检查；unquoted 载荷 `$` 展开是真实风险，保持整串
    检查）+ apply_patch 载荷目标经 classifyFile 分类——文档/spec 类放行
    （与规则 1 工具通道语义对齐），业务代码类拦截并具名
  - `printf '...' > plan.md`（文档目标重定向）被一刀切拦——工具通道
    （Write/Edit/apply_patch）按目标分类放行文档、Bash 通道却全拦，通道间
    语义不一致。修复：plan 模式下重定向目标全部为文档/spec/未知类时放行，
    任一代码类拦截并具名；fix_loop 中断期（规则 0b）保持严格不放宽
  - `cat x 2>/dev/null`（stderr 抑制）被 `2>file` 规则误拦 → `/dev/null`
    汇豁免（两模式一致）
- **spec.md/plan.md 落位指引漂移**（问题 1）：v0.10.0 工作区约定只更新了
  planning 规则（intent.md），design/build 两处漏网——`rules/stage-design.md`
  仍写「默认：根目录 `spec.md`」直接引导 agent 违反约定（intent.md 正确
  而 spec.md 落根目录的根因）。修复：stage-design / stage-build /
  sdlc-design SKILL 落位指引统一为 `.sdlc/artifacts/`（存量根目录兼容
  话术与 planning 对齐；规则 0c 落位护栏本就存在，此前被过时规则文本压过）
- **拦截文案可用性**：`command.slice(0, 120)` 截断遮蔽违规证据（用户报告
  「不确定命令是否完整」——`>` 在截断点之后不可见）→ 展示上限提至 300
  字符，违规原因具名化（重定向/载荷目标点名）。

### Added

- READONLY_PREFIXES 白名单补 stdout-only 工具：`echo` / `printf` / `sort`
  / `uniq` / `cut` / `diff` / `nl`（无重定向时零副作用）。
- `splitHeredoc` / `extractRedirectTargets` 提取为独立函数（shellWriteTargets
  复用同一重定向正则，单一事实源）。

### Verified

- 全量回归：round1 35 + round2 37 + round3 18 + round6 25 + triage 98
  （新增场景 26：四连拦截复现修复断言 10 项 + 落位指引文本断言 3 项）+
  regression 16 + smoke 8 场景全绿；另 verify-bash-gate.mjs 18 断言专项
  （防回归边界：sed -i/sed w/载荷改代码/重定向写代码/链尾 rm/规则 0e
  运行时状态/fix_loop 严格模式全部保持拦截）。

## [0.13.8] — 2026-09-10

> macOS Notification Interaction Round（macOS 通知交互轮次）。修复用户
> 实测反馈的两个缺陷：通知无声（起不到提示效果）、点击通知打开
> Script Editor。仓库同步 v1.13.8。

### Fixed

- **macOS 通知无声**：旧实现弹窗与声音一体（`display notification ...
  sound name`）——通知中心对 osascript 类宿主的声音播放不可靠，实测
  静默。重构为**两通道解耦**：弹窗照常，声音改由 `afplay` 独立派发
  （直接音频输出，完全绕过通知中心）——必达；通知不再带 `sound name`
  （避免双声竞态）。通知中心即使关掉本 app 的通知，声音仍会响。
- **点击通知打开 Script Editor**：osascript CLI 执行的通知宿主归属
  AppleScript Editor bundle，系统「激活通知来源 app」的默认动作即打开
  它。修复：**自托管 applet 宿主**——首次通知时 detached bootstrap
  （`notify-mac-setup.mjs`）用系统自带 `osacompile` 惰性生成
  `ai-sdlc-notifier.app`（`$CODEX_HOME/sdlc-notifier/`；LSUIElement
  agent 无 Dock 图标/无窗口；bundle id 归一 `dev.cikaros.ai-sdlc-notifier`；
  通知中心显示名 ai-sdlc）。`display notification` 由 applet 执行——
  宿主即本 applet，点击通知只激活它（run handler 无 argv 静默退出），
  **什么都不打开**。降级链 applet → applet-bootstrap（首条通知延迟
  ~0.5s）→ osascript 直发（保底，仅系统组件异常时触达）。

### Added

- **needs-input 专属提示音**（交互优化）：等待用户决策/回答的通知用
  `SDLC_NOTIFY_SOUND_MAC_ALERT`（默认 Funk，更醒目）与普通回合完成
  （默认 Glass）区分紧急度——「等你决策」比「回合完成」更值得被打断。
- **applet 升版自愈**：Info.plist 版本标记（CFBundleGetInfoString，版本
  自读 plugin.json 单一事实源）不匹配即重新生成；mkdtemp + rename 原子
  落位防并发双写。缓存于用户级 `$CODEX_HOME/sdlc-notifier/`（跨项目
  复用，与 prompts 注册同哲学）。

### Verified

- 全量回归：round1 35 + round2 37 + round3 18 + round6 25 + triage 85
  （新增场景 25：applet 源码结构 / Info.plist 补丁幂等与 BundleId 归一 /
  降级链与双音分流 / 路径覆盖 / 执行代码无 sound name 双声竞态）+
  regression 16 + smoke 8 场景全绿。

## [0.13.7] — 2026-09-10

> Codex Alignment Round（Codex 对齐轮次）。修复用户实测反馈的启动警告：
> `clamping SessionEnd hook timeout to 3s in .../ai-sdlc/<ver>/hooks/hooks.json`。
> 根因是 Codex 对 SessionEnd 事件有 3s 硬上限，而本插件配置了 10s。
> 仓库同步 v1.13.7。

### Fixed

- **hooks.json SessionEnd `timeout` 10s → 3s**：Codex hooks engine
  （codex-rs `hooks/src/engine/discovery.rs` 的 `normalize_command_hook`）对
  SessionEnd/Interrupt 事件的超时硬上限为 `SESSION_END_MAX_TIMEOUT_SEC = 3`
  （不配默认 1s；其余事件默认 600s 无上限）——配置超过 3s 会被钳制并在
  Codex 启动时打一条警告。修复后警告消失，且显式 3s 比省略字段时的默认
  1s 多留两倍余量。实测 session-end.mjs 全流程约 55ms（含状态读 + 原子写
  + 事件/审计锁），3s 预算充裕；写入全部原子（O_EXCL + rename），极端
  情况下被杀也只是丢当次快照、不损坏状态。

### Verified

- 全量回归：round1 35 + round2 37 + round3 18 + round6 25 + triage 71 +
  regression 16 + smoke 8 场景全绿（triage 新增 SessionEnd 超时上限静态
  断言，防止未来被调回 >3）。

## [0.13.6] — 2026-09-10

> Code-Organization Round（代码组织轮次）。行为零变更的内部重构——最终排查
> 7 套测试全绿后，对两个巨型文件做领域分层拆分，降低后续维护的导航成本。
> 仓库同步 v1.13.6。

### Changed

- **hooks/scripts/lib/common.mjs（1865 行单体）拆分为 12 个领域模块 + 桶导出**：
  L0 `paths.mjs`（路径/作用域/ARTIFACT_CANDIDATES）、L0 `util.mjs`（stdin/JSON
  BOM 安全/文件工具/id 归一化）、L1 `atomic.mjs`（原子写底座 + 跨进程锁
  `mutateJsonFile`）、L2 `state.mjs`（状态机 schema + 状态 IO + mutate 封装）、
  L2 `audit.mjs`（审计 + 事件总线滚动）、L3 `bootstrap.mjs` / `quicktasks.mjs` /
  `prompts.mjs` / `mcplink.mjs` / `cycles.mjs`、L4 `testgate.mjs` / `tasks.mjs`。
  依赖自上而下分层无环；`common.mjs` 重构为桶（barrel）显式再导出全部符号
  （含原 5 个内部函数升为导出：readTextBomSafe / safeSessionId /
  writeJsonExclusive / atomicWriteFileExclusive / tryAuditLock）——hooks、
  MCP ESM 桥、测试的导入面自 v0.5.0 起保持不变，零调用方改动。修复过程中
  发现并修正 1 处拆分期缺陷：bootstrap.mjs 漏导入 `resolve`（首轮测试
  暴露，静态检查器补齐全部模块导入完整性）。
- **mcp/sdlc-orchestrator/index.js（1365 行单体）拆分为四件套**：
  `server-state.js`（进程级可变上下文 S 容器——pinnedSession / currentScope /
  scopeBindingInfo / lifecycle / ARTIFACT_CANDIDATES 五个跨文件共享的模块级
  可变变量收敛为单一容器，属性赋值 = 原变量重赋值，语义不变）、`context.js`
  （ESM 生命周期桥 + 会话票据 pin 与四级作用域路由 + scope 感知状态 IO +
  工件扫描/阶段检测 + scopeInfo）、`tools.js`（23 个工具实现 + 工具定义表 +
  `callTool` 分发——新增工具三处同文件就近维护）、`index.js`（薄入口装配，
  bootstrap 拉起点与 `.mcp.json` 引用不变）。修复过程中发现并修正 2 处拆分期
  缺陷：状态前缀双重替换（S.S.）与 tools.js 漏引用 S.ARTIFACT_CANDIDATES
  （端到端 task_create/status 冒烟暴露）。
- **头注释与元数据描述瘦身**：common.mjs / MCP index.js 内嵌的完整版本历史
  （各约 70 行）收敛为模块职责说明 + CHANGELOG 指针（版本历史唯一权威在
  本文件，消除双源漂移）；plugin.json / hooks.json / marketplace.json 的
  description 此前逐版累积（plugin.json 达 5446 字符）——收敛为价值主张 +
  近三版摘要 + CHANGELOG 指针；hooks.json statusMessage 补 v0.13.6 标记。
- **文档同步**：插件 README 文件结构图（lib/ 13 文件 + mcp/ 6 文件）、
  architecture.md 新增「代码组织」模块分层图、AGENTS/lifecycle/usage-guide/
  write-policy/mcp README/spec/install-prompts 脚本头注中的 common.mjs 实现
  落位引用全部指向新模块（经桶导出的导入面不变）。

### Verified

- 全量回归零行为变更：round1 35/35 + round2 37/37 + round3 18/18 +
  round6 25/25 + triage 71/71 + regression 16/16 + smoke 8 场景全绿。
  round6 两处静态断言同步指向新落位（锁基建 atomic.mjs/state.mjs、MCP 端
  BOM 剥离/原子写 context.js）；triage/smoke 版本断言同步 0.13.6。
- MCP 端到端：bootstrap → index.js 拉起 → initialize 握手返回 0.13.6、
  tools/list 23 个、task_create/status 会话路由正常。

## [0.13.5] — 2026-09-10

> Cross-Process Concurrency Round（跨进程并发安全轮次）。迭代协议 Round 6——
> 排查角度全面换新（跨进程写冲突 / BOM 容错 / 原子写失败回退 / 磁盘可控内容
> 的上下文注入面），共修复 4 个真实缺陷（1×P1 + 3×P2）。仓库同步 v1.13.5。

### Fixed

- **跨进程读-改-写竞态（P1）**：state.json / tasks.json / quick-tasks.json /
  session-map.json / cycles.json 的全部「读→改→写」此前无锁——v0.13.4 的审计锁
  只覆盖 hook-audit.json。MCP server（常驻进程）与 hook 进程（每次工具调用
  spawn）在 Codex 并行工具调用、双会话同项目场景下后写者用旧快照覆盖前写者：
  丢阶段推进、丢 sdlc_engaged、丢队列条目、丢会话绑定（测试实测：无锁路径
  10 并发丢 3/10 字段）。修复：common.mjs 新增 `mutateJsonFile`（O_EXCL
  lockfile 泛化审计锁：锁内 读→改→原子写，降级语义与审计锁一致——丢单次
  合并不丢文件，绝不死锁）；hooks 四文件（post-tool-use 最终合并 /
  session-start 防回归回写 / user-prompt-submit hooks-state（含会话接管语义））
  与 MCP 八个状态工具 + 指针恢复全部经同一把锁（MCP 经 ESM 桥复用
  common.mjs，两端同源）；advanceStage / toolAdvance 推进写入锁内幂等重验
  （cur=next 时跳过，防双重推进回写旧 previous_stage）。修复后 10 并发
  10/10 存活（阴性对照证明测试区分力）。
- **JSON 读取不剥 UTF-8 BOM（P2）**：Windows 工具链（编辑器 / PowerShell 5.1
  Out-File）写入 BOM 后 JSON.parse 全抛异常 → readCodexState 返回 null →
  状态静默清零（engaged 丢、阶段回 planning、队列丢失、门禁误报）。修复：
  safeJsonParse 内剥 BOM + readTextBomSafe 应用于 readCodexState /
  readGlobalJson（hooks 端）；MCP 端 stripBomCjs 应用于 readTaskIndex /
  readState / readHooksState / audit 读取。
- **atomicWriteCjs 危险回退（P2）**：MCP 端原子写在 O_EXCL/rename 失败后回退
  writeFileSync 直写目标——跟随目标符号链接（重开 v0.9.0 刚关闭的任意写
  攻击面）+ 非原子（半写可读）；Windows 目标被并发进程占用（杀毒/索引/
  并发读者致 rename 失败）时真实可达；hooks 端无此回退（两端口径不一致）。
  修复：删除回退，失败返回 false（对齐 hooks 侧 writeJsonExclusive 语义）。
- **Stop 注入的队列字段未消毒（P2）**：stop.mjs 把 quick-task 的 `t.desc` /
  `t.id` 原样拼进注入上下文——克隆仓库投毒 quick-tasks.json 后 desc 含换行
  可伪造「- 」开头的 hook 指令行（上下文注入），id 含反引号可逃逸行内代码
  包裹。修复：注入点消毒（控制字符/换行折叠 + 「- [xxx]」指令模式中和 +
  cap 160；id 白名单 [A-Za-z0-9_-]）；MCP set_change_ticket / set_stage
  note 顺带消毒。

### Testing

- 新增 round6-audit.mjs（25 断言，含阴性对照：无锁 RMW 丢 3/10 字段 vs 锁路径
  10/10 存活——修复有效性有对照证据）；既有 6 套全量回归：round1 35/35 +
  round2 37/37 + round3 18/18 + triage 71/71 + regression 16/16 + smoke 全绿。

## [0.13.4] — 2026-09-10

> Robustness Round（健壮性轮次）。按迭代协议执行 5 轮「全量排查 → 记录 →
> 修复 → 回归」：Codex plugin 难以通过真实使用发现缺陷，本轮全部经单元测试与
> 插桩测试（进程级 spawn + stdout/stderr/exit code/副作用捕获 + fuzz 注入 +
> MCP 协议序列 + 并发竞态）定位。共修复 7 个真实缺陷（3×P1 安全/门禁 +
> 1×P1 flaky + 1×P2 协议 + 1×P3 边界 + 1×P1 测试证据门槛）。仓库同步 v1.13.4。

### Fixed

- **Windows 反斜杠路径逃逸写保护（4 形态，P1）**：`C:\Users\x\.sdlc\state.json`、
  `.\.sdlc\state.json`、`.sdlc\state.json` 等反斜杠风格路径不匹配任何 `/` 分隔
  的路径正则——Edit 通道与规则 0e shell 写通道全部逃逸。修复：pre-tool-use.mjs
  新增 normSep（`\`→`/` 规范化），在 classifyFile 入口与 RUNTIME_STATE.test
  内部统一生效（全部 7 类路径正则自动覆盖；POSIX 反斜杠文件名极罕见，兼容
  收益远大于误判风险）
- **测试证据门槛漏洞（P1）**：PostToolUse 的 tool_response 缺失 exit_code 与
  success 时 exitCode 回退 0（视为通过）并计数——空响应事件虚增 test_runs、
  置 test_pass=true，「未测试禁 push/PR」门禁可被误置绕过。修复：hasExitEvidence
  门槛（exit_code 或 success 其一存在才计数），无证据仅事件留痕
  （test_evidence_missing，宁缺勿假）
- **并发审计间歇丢条目（P1，flaky）**：v0.10.0 的 appendAudit 锁只尝试 2 次
  （微秒级间隔）——锁被持的毫秒窗口内竞争者降级为无锁直写，读-改-写互盖
  （实测 10 并发约 1/6 概率丢 1 条）。修复：tryAuditLock 退避重试
  （16×6ms ≈ 96ms 预算，Atomics.wait 同步等待零依赖）把竞争窗口压缩到可忽略；
  超预算仍降级直写（保留「丢单条不丢文件」兜底，不死锁）——修复后 10 连跑
  0 丢失
- **MCP stdio 协议行为（P2）**：超长行（>1MB）drop 与非法 JSON 行均静默丢弃
  ——等待该请求的客户端挂等到超时。修复：分别回 JSON-RPC 规范错误
  （id:null -32600 request too large / -32700 Parse error）

### Changed

- quick-task 队列硬上限（P3 边界）：非终态（queued/in_progress）达到
  QUICK_TASKS_LIMIT=100 时拒绝新登记（返回 error 提示先处理/drop）——
  修复「无终态可裁时队列无界增长」（queued 永不裁剪的设计保留）
- 测试基建沉淀：`scripts/hook-harness.mjs`（通用 hook 插桩运行器：spawn 进程 +
  超时 SIGKILL + stdout/stderr/exit/时长捕获）与 `scripts/round1/2/3-audit.mjs`
  （35+37+18 断言的三轮排查套件：fuzz 矩阵/函数级单元/MCP 23 工具冒烟/
  状态机闭环全链路/并发竞态），可复跑回归

## [0.13.3] — 2026-09-10

> MCP Launcher Chain Fix + Shell Write-Channel Hardening（MCP 启动链修复 +
> shell 写通道加固）。修复两个真实缺陷：其一（关键）：插件 `.mcp.json` 相对
> 路径在真实安装下 ENOENT，MCP server 从未真正启动过（openai/codex#19582/
> #22842：Codex 以用户启动目录为插件 MCP 子进程 cwd、相对 args 按该 cwd
> 解析、不插值 `${VAR}`、不注入 PLUGIN_* 环境变量）；其二（安全）：运行时
> 状态写保护只覆盖 Edit/Write/apply_patch 的 file_path 通道，`echo ... >
> .sdlc/state.json` 经 Bash 重定向可绕过。仓库同步 v1.13.3。

### Added

- **`.mcp.json` 内联 bootstrap（`node -e` 自定位引导）**：四级解析链
  `SDLC_PLUGIN_ROOT` env > `.sdlc/mcp-launcher.json` 指针（防投毒：指针
  plugin_root 必须位于 `CODEX_HOME/plugins` 之内）> `CODEX_HOME/plugins`
  两层扫描（`<plugin>` 与 `<marketplace>/<plugin>` 布局）> cwd 回退；
  `SDLC_BOOTSTRAP_PROBE=1` 探针模式输出解析结果（测试/诊断用，不启动
  server）；代码 JSON 安全（单引号/无反斜杠/无双引号）
- **`common.mjs` `writeMcpLauncherPointer()`**：SessionStart 幂等写启动器
  指针（原子写；plugin_root/project_root/plugin_version——版本自读
  `.codex-plugin/plugin.json` 单一事实源；project_root 供诊断）
- **PreToolUse 规则 0e（shell 写通道加固）**：`shellWriteTargets()` 提取
  Bash 写形态目标（重定向目标 + tee/rm/truncate/shred 全参数 + cp/install
  目标参数 + mv 全参数（源被移走同样破坏信任锚）+ dd `of=`），命中
  RUNTIME_STATE 即 block，文案含受控接口替代指引；engagement 无关（信任
  锚点保护与规则 0 同级）
- SessionStart 注入：指针写入失败时一行修复提示（重启会话/设
  `SDLC_PLUGIN_ROOT`）+ `mcp_launcher_write_failed` 事件留痕；审计 detail
  增 `mcp_launcher`；PreToolUse 审计 detail 增 `shell_state_guard`

### Fixed

- **关键：插件 MCP server 在真实安装下从未启动**——`.mcp.json` 相对路径
  形式 `["./mcp/sdlc-orchestrator/index.js"]` 按 MCP 子进程 cwd（用户启动
  目录）解析，真实安装下 ENOENT（openai/codex#19582/#22842）；本地开发
  场景（cwd=插件根）侥幸可用掩盖了该缺陷。内联 bootstrap 修复后本地与
  真实安装行为一致，端到端 initialize 握手验证通过
- **安全：shell 重定向绕过运行时状态写保护**——规则 0 只覆盖
  Edit/Write/apply_patch 通道，`echo '{"sdlc_engaged":true}' >
  .sdlc/state.json` 或 `cat x | tee .sdlc/session-map.json` 可自我授权/
  污染隔离/伪造票据/篡改 MCP 启动指针；规则 0e 补齐该通道（读取形态
  cat/ls/rg/grep 不受影响，误提取无害——非运行时路径不命中）
- **一致性：RUNTIME_STATE_RES 与 `.codexignore` 托管块清单漂移**——
  `events.jsonl` / `hook-audit.json` / `session-end.json` /
  `prompt-trace.json` 在 `.codexignore` 声明为运行时文件（不进模型上下文）
  但 PreToolUse 未拦截（伪造 events/audit = 污染审计链）；本版对齐

### Changed

- MCP server 版本 0.13.3（`runMcpServer.version`）；`hooks.json`
  description/statusMessage、`.codex-plugin/plugin.json`（version +
  description v0.13.3 段）、`.agents/plugins/marketplace.json`（描述段）、
  4 个 marketplace 安装器（v1.13.3）、`install-prompts.sh`/`install-prompts.ps1`
  头注同步
- `docs/architecture.md` 新增「MCP 启动链（v0.13.3）」章节（背景 issue、
  四级解析链、防投毒设计、探针诊断）；`docs/write-policy.md` 补规则 0e；
  `docs/usage-guide.md` / `docs/lifecycle.md` / `AGENTS.md` / 双 README
  版本矩阵同步

## [0.13.2] — 2026-09-10

> Hook-Level Environment Guard & Zero-Action Registration（hook 层环境自检 +
> 跨平台脚本护栏 + 零操作自动注册）。v0.13.1 把注册收敛到了 Node fs 单一
> 事实源，但注册动作本身仍需用户开口或跑脚本；同时 sh/ps1 双轨脚本在错误
> 平台上被调用时会直接报错。本版把「环境判定 + 注册动作 + 失败预防」全部
> 上收到 hook 层运行时自检——使用者零操作、误调用零报错。仓库同步 v1.13.2。

### Added

- **`hooks/scripts/lib/env.mjs`（新模块，零依赖纯函数）**：运行环境画像
  `detectEnvironment()`——平台 + POSIX shell 可用性（非 Windows 恒 true；
  Windows 扫描 PATH 上 bash.exe/sh.exe/wsl.exe + Git for Windows 常见落点
  `%ProgramFiles%\Git\bin\bash.exe` 等）+ PowerShell 可用性（Windows 恒 true；
  非 Windows 扫描 pwsh）。能力感知而非 OS 一刀切：装了 Git Bash/WSL 的
  Windows 照常跑 `.sh`，装了 pwsh 的 macOS/Linux 照常跑 `.ps1`
- **PreToolUse 跨平台脚本护栏（规则 0d）**：拦截「注定失败」的脚本调用
  （bash/sh/zsh/dash/ash/wsl 启动器、段首直接执行 `.sh`、`source`，或
  powershell/pwsh 启动器、段首直接执行 `.ps1`——按命令段拆分与 env 前缀/
  sudo 剥离判定），block 文案含精确替代：插件脚本自动映射孪生
  （`scripts/sh/x.sh` ↔ `scripts/ps/x.ps1`，孪生存在才推荐）+ MCP 免 shell
  通道 + 安装缺失运行时指引。只拦执行形态（`cat`/`ls`/`grep` 读取 `.sh`
  路径不误伤）；与 engagement 无关（纯错误预防）；触发进审计
  `detail.script_guard` + `detail.env`
- **SessionStart 环境画像注入**：一行摘要（如 `Linux · bash/sh ✓ ·
  PowerShell ✗`）+ 仅本机确实不可用的约束行（「勿执行 .sh/.ps1——等价
  能力用 …」）；全可用时仅摘要行。画像进审计 `detail.env`
- **手册零操作自动注册（`common.ensurePromptsRegistered`）**：SessionStart
  自检——缺失或与插件当前版本不一致（升版）即差量刷新（只写 `sdlc-*`，
  不碰用户其他 prompts；成本 ≤ 2N 次 readFileSync）；已注册且无变化静默
  跳过。**opt-out 语义**：显式卸载（`removePromptManuals`）在目标目录写
  `.sdlc-prompts-optout` 标记，此后不再自动恢复；显式 `register` 清除标记；
  `SDLC_PROMPTS_AUTO=off` 总关（与 `SDLC_NOTIFY=off` 同惯例）。自动注册
  进审计 `detail.prompts_auto` 与事件流 `prompts_auto_registered`
- sh/ps1 脚本同步 opt-out 语义（`--remove`/`-Remove` 写标记、安装清标记）
  与 v0.13.2 头注（自动注册为默认、脚本为手动/离线/CI 便利品）

### Changed

- **MCP `register_prompts` 重定位为显式通道**（第 23 个工具不变）：日常注册
  已由 SessionStart 自动完成——本工具用于强制刷新 / 自定义 `dir` / 卸载；
  `remove` 返回值与提示说明 opt-out 标记语义；`register` 说明标记清除与
  自动注册恢复。工具描述同步（触发词更新为「刷新操作手册到最新版本/
  卸载/看注册状态」）
- SessionStart：v0.13.1 的「未注册→一行指引（引导用户手动注册）」路径替换
  为自动注册 + 一行透明声明（已注册/已刷新 + 卸载与关闭方式）；skipped/
  opted-out/disabled/no-source 静默（尊重用户选择，省 token）
- 18 份操作手册「调用方式」块同步零操作话术（自动注册为默认；手动刷新/
  卸载为备选；平台脚本误调用会被护栏拦截并给出替代）

### Fixed

- （预防性）裸 Windows 调用 `install-prompts.sh`、无 pwsh 的 macOS/Linux
  调用 `install-prompts.ps1` 此前会直接报错——现在被护栏前置拦截并给出
  等价替代，杜绝使用者面对晦涩的平台报错

## [0.13.1] — 2026-09-10

> 注册跨平台化（Cross-Platform Prompts Registration）+ v0.13.0 遗留修复。
> v0.13.0 的官方 `/prompts:<name>` 注册桥只有 bash 脚本——Windows 原生不可
> 达。本版把注册逻辑收敛到 Node fs 单一事实源，会话内三平台一致；shell 脚本
> 降级为平台便利品。同时修复 v0.13.0 的「意图→工具映射」悬空引用（文档与
> 注入文案两处引用了从未实际注入的映射表）。仓库同步 v1.13.1。

### Added

- **MCP `register_prompts` 工具（第 23 个）**：官方 `/prompts:sdlc-<名>` 调用
  形式的手册注册主通道——`register`（幂等安装/刷新）/ `remove`（卸载，只删
  本插件注册的 `sdlc-*.md`）/ `list`（注册状态）；目标目录默认
  `~/.codex/prompts`（`SDLC_PROMPTS_DIR` 可覆盖，`dir` 参数可显式指定）。
  用户自然语言「注册操作手册」即触发，agent 调工具完成——macOS/Linux/
  Windows 行为完全一致。注册/卸载事件留痕 `events.jsonl`（审计可溯）
- `common.mjs` 注册模块：`listPromptManuals`（动态扫描源目录，升版新增手册
  自动生效）/ `promptsRegisterStatus` / `registerPromptManuals` /
  `removePromptManuals`——hooks 与 MCP 经 ESM 桥共用的单一事实源
- **`scripts/ps/install-prompts.ps1`**：Windows PowerShell 等价脚本
  （`-Remove` / `-List` / `-Dir`；PS 5.1 兼容，UTF-8 BOM + CRLF）——
  手动/离线场景的平台便利品，语义与 sh 版和 MCP 工具完全对齐
- SessionStart 官方 `/prompts:` 注册状态自检：未注册 → 注入一行跨平台指引
  （MCP 主通道 + 平台脚本备选）；已注册 → 静默（省 token）；注册计数进
  hook 审计 `detail.prompts_registered`

### Fixed

- **「意图→工具映射」悬空引用**（v0.13.0 遗留）：SessionStart 注入文案两处
  引用「详见下方/见上方意图→工具映射」，但映射表从未实际注入——v0.13.0
  的核心卖点「自然语言即命令」在会话内缺少落地锚点。本版补注入 8 行真实
  映射表（意图示例 ↔ MCP 工具），首用声明与治理段的引用自此成立

### Changed

- `install-prompts.sh` 重定位为 macOS/Linux 平台便利品：头部注释更新跨平台
  指引（Windows 用 ps1 或会话内 MCP 工具，免 shell）；名单注释标注三处
  同源（sh 数组 / ps 动态扫描 / Node 动态扫描）
- 18 份 prompts/ 手册「调用方式」块：注册指引从单一 sh 脚本改为
  register_prompts（跨平台，推荐）+ sh/ps1 平台备选
- 文档同步：AGENTS（三层通道注册方式）/ README（插件 + 仓库根）/
  usage-guide（意图表 + MCP 工具表 +1）/ MCP README（23 工具 + register_prompts
  段）/ architecture / lifecycle；plugin.json 0.13.1 + keywords/capabilities
  （cross-platform-prompts）；hooks.json / marketplace.json 描述同步；
  4 个 marketplace 安装器版本号 v1.13.1

## [0.13.0] — 2026-09-10

> 命令体系迁移（Command Migration）：官方 Codex CLI 不支持插件自定义 slash
> 命令（未知 `/xxx` 会被 CLI 直接拒绝、不提交给模型）——v0.12.0 及之前文档中
> 的 18 个 `/sdlc-*` 命令在官方 CLI 下不可达，UserPromptSubmit 内的 4 个命令
> 解释器实为死代码。本版移除死代码并把交互迁移到官方支持的通道：**自然语言
> →MCP 工具（主通道）** + **官方 `/prompts:<name>`（可选逃生口）**。
> 仓库同步 v1.13.0。

### Removed

- `user-prompt-submit.mjs` 内 4 个 slash 命令解释器（`/sdlc-task`、
  `/sdlc-new-cycle`、`/sdlc-loop-resolve`、`/sdlc-quick`，约 170 行）与
  `isSlashCommand` 体系——官方 CLI 下未知 slash 命令不会到达 hook；等价
  能力全部由 MCP 编排器工具提供（task_* / new_cycle / loop_resolve / quick_task）
- 全部运行时注入文案、规则、技能、手册与文档中的 /sdlc-* 命令话术

### Changed

- **交互主通道改为「自然语言即命令」**：SessionStart 注入「意图→工具映射表」
  （临时任务 / 任务 / 周期 / 循环决策 / 阶段控制等意图 ↔ quick_task / task_* /
  new_cycle / loop_resolve / advance…），UserPromptSubmit 每回合分流提醒同步
  改为自然语言话术（quick_task 触发示例）
- **prompts/ 18 份手册重定位**：从「slash 命令手册」改为「操作手册」——正文
  改为自然语言触发示例 + MCP 工具映射；quick / task / loop-resolve / cycle
  四份生命周期手册重写，其余 14 份更新标题与调用说明
- `stage-detector.mjs` 的 `stage.prompt` 字段从命令名改为手册路径
  （缺失工件提醒指向 `prompts/<名>.md`）
- **sdlc_engaged 显式参与置位迁移**：工件写入（PostToolUse）+ 任务创建 +
  MCP 首次调用（新增 `markEngagedOnce`，替代原 slash 命令置位路径）
- MCP `quick_task` 工具描述更新（用户侧等价 = 自然语言示例）
- 文档全面同步：AGENTS / README（插件 + 仓库根）/ usage-guide（命令表 →
  自然语言意图表 + 手册表 + `/prompts:` 注册说明）/ lifecycle / write-policy /
  architecture / MCP README / hooks.json / plugin.json / marketplace.json /
  sdlc.sh / init-project.sh

### Added

- `scripts/sh/install-prompts.sh`：官方 `/prompts:<name>` 桥——把 18 份操作
  手册注册到用户 prompts 目录（`~/.codex/prompts/sdlc-<名>.md`，前缀防撞名），
  注册后可用 `/prompts:sdlc-quick` 等官方形式调用；幂等，支持
  `--remove` / `--list` / `--dir <path>`


## [0.12.0] — 2026-09-10

> 输入分流（Input Triage）：用户输入三分类——需求/ISSUE 统一走 SDLC 流程、
> 补充信息融入当前周期工件、临时任务不走流程（周期进行中登记排队，周期走完
> 后统一处理，二者不混淆）。附 SKILL/规则一致性修复轮。仓库同步 v1.12.0。

### Added

- **输入分流规则（`rules/triage.md`）**：每条用户输入先三分类再行动——
  **REQ 需求/ISSUE**（将产出交付物）→ 走 SDLC 流程；**SUPP 补充信息**
  （澄清 / Open questions 回答 / 约束补充）→ 融入当前阶段工件，不另开流程；
  **QUICK 临时任务**（一次性小事）→ 不走流程。含判定优先级、混合输入拆分、
  拿不准先问、五条硬约束与反模式（把临时任务做进周期 diff = 审计链污染）
- **临时任务队列（common.mjs + `.sdlc/quick-tasks.json`）**：
  - 全局存储（与 tasks.json 同级）——不随任务作用域隔离，切任务/开新周期
    不丢队列；状态机 queued → in_progress → done / queued → dropped（终态
    不可变更）；上限 100 条，只裁最旧终态条目（排队中永不丢）
  - 受控修改（agent 禁改，PreToolUse block）：用户命令 `/sdlc-quick`（hook
    内联执行）与 MCP `quick_task` 工具（agent 侧）两条通道；变更写
    events.jsonl 留痕（quick_task_added / quick_task_updated）
  - **排队语义（不混淆原则）**：周期进行中（工作区存在 intent/spec/plan）
    提出的临时任务只登记不执行，**待周期走完后统一处理**——处理内容不得
    混入当前周期工件或 diff；用户显式要求提前（`/sdlc-quick run <id>`）可
    立即处理，但仍不落周期工件
- **`/sdlc-quick` 命令（`prompts/quick.md`，第 18 个 slash 命令）**：
  `add <描述> | list | run <id> | done <id> [备注] | drop <id>`——含分类
  速查表（与 /sdlc-task 的边界：临时队列 vs 需求隔离）
- **MCP `quick_task` 工具（第 22 个工具）**：action = add/list/run/done/drop，
  返回排队计数与 scope 诊断；`PreToolUse` 拦截文案与 write-policy 增加
  quick-tasks.json 通道说明
- **三重防遗忘注入**：
  - SessionStart：完整分流协议（~6 行）+ 队列状态（周期内→排队中；
    空闲→现在可处理）
  - UserPromptSubmit：每回合轻量分流提醒（三分类指引 + 队列计数 + 周期
    状态；token 预算超额时与反模式/门禁提示同为保留项）
  - Stop：队列非空时按周期状态注入「排队中（须向用户转达）」/「待处理
    （本回合可逐条处理）」
- 6 个阶段 SKILL 增加「输入分流边界」段（各阶段对补充信息/临时任务的
  处理边界；sdlc-maintain 明确周期归档后为队列统一处理时机）

### Fixed

- **sdlc-planning SKILL 与 v0.10.0 工作区化的矛盾**：description 与正文仍写
  「提交到版本控制的 intent.md」——实际 v0.10.0 起工件写入 `.sdlc/artifacts/`
  不入版本控制；改为「写入约定工作区 .sdlc/artifacts/intent.md（不入版本
  控制）」
- **rules/stage-planning.md 过时落位约定**：「默认：根目录 intent.md /
  跨仓库 intent 仓库」→ v0.10.0 约定（默认 `.sdlc/artifacts/`，任务模式任务
  目录，存量根目录兼容）；治理段「git log 修订历史」→ 审计链（工件头部 +
  hook-audit 事件流 + 周期归档索引）
- **sdlc-maintain SKILL 归档路径错误**：「自动归档轮转（docs/sdlc/archive/）」
  → 默认 `.sdlc/archive/`（docs/sdlc/archive 仅显式选项）

### Changed

- `/sdlc-intent` prompt 增加输入分流前置声明（先确认输入属需求/ISSUE 类）
- `.codexignore` 托管块纳入 `.sdlc/quick-tasks.json`（不入模型上下文）
- hooks.json 状态消息、AGENTS/README/docs（usage-guide/lifecycle/write-policy）
  同步 v0.12.0 语义与计数（18 命令 / 22 工具 / 7 规则）

## [0.11.0] — 2026-09-09

> 回合结束通知（任务完成 / 需用户决策或回答时系统弹窗+声音，macOS / Windows /
> Linux）。仓库同步 v1.11.0。

### Added

- **回合结束通知（lib/notify.mjs + lib/notify.ps1）**：Stop hook 在回合结束时
  发系统弹窗 + 声音把使用者叫回终端——最大化 agent 工作期间的等待时间利用
  - 两类通知：**needs-input**（fix_loop 修复循环中断 / Open questions 待回答
    ——无用户输入即不推进，总是通知，不受阈值约束）与 **turn-end**（普通完成，
    受 `SDLC_NOTIFY_MIN_SECONDS` 防噪阈值约束，默认 10s：长任务必达、
    终端前快答不扰；无时长记录按保守策略通知）
  - 分发链（零依赖、fire-and-forget：detached + unref，异步失败静默不扰
    hook）：自定义命令 `SDLC_NOTIFY_CMD`（`{title}`/`{body}` 模板 + 子进程
    `SDLC_NOTIFY_TITLE`/`SDLC_NOTIFY_BODY` env）→ macOS `osascript`（弹窗+
    声音一体，纯声音 `afplay`，音名白名单校验防路径注入）→ Windows
    `powershell.exe -File notify.ps1`（Toast + 默认提示音；argv 传参无注入面；
    降级 msg.exe / SystemSounds）→ Linux `notify-send` + `canberra-gtk-play`
  - 配置（env，与 `SDLC_MAX_FIX_ROUNDS` 同一惯例）：`SDLC_NOTIFY` /
    `SDLC_NOTIFY_POPUP` / `SDLC_NOTIFY_SOUND` / `SDLC_NOTIFY_MIN_SECONDS` /
    `SDLC_NOTIFY_SOUND_MAC` / `SDLC_NOTIFY_CMD`——零配置默认全开
  - UserPromptSubmit 落盘 `hooks-state.last_prompt_at`（回合起点，时长依据）；
    通知结果进审计 `detail.notify`（notified / kind / reason / duration_ms，
    「为什么没通知」可排障）；SessionStart 首次使用声明追加通知说明
  - needs-input 判定与 stop.mjs 注入门禁同一表达式——不维护第二套判定
  - 设计边界（诚实披露）：Codex CLI 原生工具审批弹窗发生在回合进行中
    （六事件无对应时刻），插件层不可感知；本通知覆盖「agent 主动结束回合」
    这一确定可观测时刻（标准见 docs/lifecycle.md §3.2）

## [0.10.0] — 2026-09-09

> 工件工作区化 + 首次使用自动初始化 + 设计一致性修复轮。仓库同步 v1.10.0。

### Added

- **首次使用自动初始化（ensureProjectBootstrap，幂等）**：sdlc 自行监测并初始化
  首次使用的项目——首个会话（SessionStart）即完成 state.json 全 schema 落盘 +
  `.gitignore`/`.codexignore` 托管块追加，并注入「已自动初始化」声明；工件写入
  （PostToolUse）与 `/sdlc-*` 命令（UserPromptSubmit）时幂等补齐（治愈后装 git
  / 老版本初始化的存量项目）
  - 新增 `hooks/scripts/bootstrap-project.mjs` CLI 入口（init-project.sh 与
    sdlc.sh 复用，与 hook 同一实现——单一事实源）
  - `.gitignore` 托管块采用「忽略 `.sdlc/*` + 白名单（bands.yaml / custom/ /
    hooks/）」：未来新增运行时文件默认被忽略，团队共享配置仍进版本控制
  - `.codexignore` 托管块只列运行时文件（不含 artifacts/ 与 tasks/——
    工件必须可被 agent 读写；修复 v0.9 init 脚本列 artifacts/ 的自相矛盾）
- **工件工作区化**：intent/spec/plan/REVIEW 统一落 `.sdlc/artifacts/`
  （任务隔离模式 `.sdlc/tasks/<id>/`）——工件是任务推进的中间产物，**不进
  版本控制**；任务/周期结束归档到 `.sdlc/archive/`（不删除）
  - 周期归档默认目录 `docs/sdlc/archive` → `.sdlc/archive`（显式传
    `docs/sdlc/archive` 仍可迁回仓库内归档——需要 PR 可审查归档链的团队）
  - PreToolUse 新增工件落位护栏（规则 0c）：在 `.sdlc/` 外**新建**阶段工件时
    warn 提示工作区路径；存量根目录工件更新静默放行（legacy 兼容）
  - prompts / rules / spec 同步：工件落位与溯源以 cycle-id 取代 commit-sha
    （工件不入 git 后 sha 不可解析）
- `common.defaultState()` 全量默认状态机 schema（单一事实源）、
  `common.isEngaged()` 工作流参与判定统一、`common.ARTIFACT_CANDIDATES`
  工件候选路径单源（hooks / MCP / 归档共用）

### Changed

- init-project.sh 退化为「可选的手动初始化」：核心引导委托 bootstrap-project.mjs；
  REVIEW.md 模板复制目标根目录 → `.sdlc/artifacts/`；移除 `--guided` 死参数
- sdlc.sh status/workflow/advance 首次使用自动初始化（不再报错要求先跑
  init-project.sh）
- SessionEnd hook 超时 3s → 10s（快照文件 IO 余量）

### Fixed

- **engagement 判定三处不一致**：pre-tool-use（7 字段）/ post-tool-use（6 字段，
  漏 change_ticket）/ stop（6 字段，漏 change_ticket）——统一至 `isEngaged()`
  （设过变更工单的项目此前在 push 门禁与循环置位处会得出相反结论）
- **`deploy_approved` 死字段退役**：无任何置 true 的代码路径，但 hooks 侧
  advanceStage 重置它而 MCP 侧重置 `release_approval`（真值）——三处推进实现
  统一重置 `release_approval`；init/reset/new-task 状态模板不再写死字段
- **MCP `reset` 字段缺失**：此前缺 in_fix_mode / change_ticket /
  release_approval / test 门禁字段 / intent 门禁字段——补全为全量 schema
- **session-start 局部默认状态**：残缺模板（缺 v0.5–v0.9 字段）→
  `defaultState()` 全量
- **init-project.sh .codexignore 块过时**：缺 v0.5+ 运行时文件
  （session-map/tasks/cycles/sessions/mcp-bind-queue）且误列 `.sdlc/artifacts/`
  → 由 bootstrap 托管块取代
- **appendAudit 并发丢条目**：读-改-写加锁（O_EXCL lockfile + 过期锁清理 +
  兜底直写；`.lock` 纳入 PreToolUse 运行时状态保护）
- **ARTIFACT_CANDIDATES 三份拷贝漂移风险**：stage-detector / MCP /
  归档候选表收敛至 common.mjs 单源
- uninstall.sh 日志版本串 v1.8.0 滞后（仓库级修复，随 v1.10.0 生效）
- prompts/reset.md 误引 specflow 的 `templates-project/` 预设

## [0.9.0] — 2026-09-08

> 反检测 + 安全加固轮。仓库同步 v1.9.0；specflow v1.2.4。

### Added

- **frontend-e2e 反检测能力**（保障被测站点带机器人检测时 E2E 可用）：
  - `references/anti-detection.md`：症状判别（挑战页/403/headless-only-fail/
    OAuth 拒绝）→ L1 原生加固（零依赖：真实 UA + locale/timezone 一致性 +
    init scripts 抹 `navigator.webdriver`/plugins/languages/WebGL 位 +
    `--disable-blink-automation`）→ L2 真实 Chrome 通道（`channel: 'chrome'`）→
    L3 playwright-extra + stealth 插件的升级阶梯；行为层加固（workers=1 /
    storageState 登录收敛）；指纹自检用例；**合规硬边界**（仅限自有/授权目标、
    禁止第三方反爬绕过、不弱化断言）
  - `references/stealth.fixture.ts`：L1（覆写 context fixture）/ L3（覆写
    browser fixture）可运行模板
  - SKILL.md 新增 §8 反检测；反模式补 2 条（没确诊就上 stealth / 反检测同时
    放室断言）；playwright.config.ts.tpl 反检测可选段；debug-ci.md 拦截排查条目
    + CI 零售 Chrome 要点
  - lifecycle.md §2.7 反检测子节（门禁协作语义：命令形态不变、计数/签名/熔断
    照常、fix_loop 期间装 stealth 依赖先 loop-resolve）

### Fixed

- S1 原子写符号链接预植入防御（高危）：随机后缀 tmp + O_EXCL + rename 不跟随
  符号链接；PreToolUse 运行时状态保护扩展 `.sdlc/**/*.tmp`
- S2 session-map 键归一化（`__proto__`/`constructor`/`prototype` 中和）
- S3 `isTestCommand` shell -c 引号感知负载提取（`bash -c "npm test"` 计入；
  引号内伪证不命中）
- S4 mcp-lite.js 单行 1 MiB 长度护栏
- S5 install.sh 内嵌脚本 argv 传参（路径注入封堵）；sdlc.sh cmd_audit 同修
- S7 events.jsonl 2 MiB 滚动截断（保留 5000 行 + 留痕）

## [0.8.0] — 2026-09-08

> 前端 E2E 测试技能轮（对应仓库发行版 v1.8.0）：给 SDLC plugin 追加基于
> Playwright 的前端测试 SKILL。新增测试 `scripts/test-skills.mjs`。

### Added

- **frontend-e2e 能力技能**（`skills/frontend-e2e/`）：SKILL.md（触发条件 /
  栈识别 / 引导安装（Stage 3b 起）/ 用例规范（data-testid 优先、web-first 断言、
  零时间等待、用例隔离）/ 标准命令与证据粘贴 / `toHaveScreenshot` 视觉闭环 /
  失败调试（trace 取证优先）/ CI 集成 / 反模式）+ references ×3（config 模板 /
  示例用例 / 调试 CI 速查）
- **6 个阶段技能实体交付**（`skills/sdlc-*/SKILL.md`）：rules/stage-*.md 的
  可执行摘要；修复全部悬空引用（plugin.json / stage-detector / SessionStart
  索引 / AGENTS.md）
- **`isTestCommand` Playwright 全形态识别**：显式（npx/pnpm/yarn/bunx + dlx/
  exec + @playwright/test）+ 裸两词（含 .bin 路径前缀归一化）+ 脚本约定
  （run e2e / test:e2e / e2e:* 变体）；工具命令（install/codegen/show-report/
  show-trace）与字面量（echo/grep）不命中
- **失败签名 Playwright 扩展**：`✘ N [browser] › …` / `Error: expect` 断言行
- SessionStart 资源索引在 build_impl/test 阶段注入能力技能提示行；
  lifecycle.md §2.7 协作语义权威标准；usage-guide 技能章节；stage-test 规则与
  test 命令的前端路径

### Fixed

- **门禁字面量绕过加固**：整串匹配前剥离引号字面量，`echo "npm run e2e"` /
  `git commit -m "…make test…"` 不再被计为测试执行（存量缺陷：可伪造
  `test_pass` 绕过 push 门禁）

### Changed

- 版本 0.7.0 → 0.8.0（plugin.json / MCP server / AGENTS.md / README /
  hooks.json）；marketplace 描述同步

## [0.7.0] — 2026-09-08

> 测试门禁 + 修复循环中断轮（对应仓库发行版 v1.7.0）。用户实测反馈：SDLC 缺乏
> 强制测试——应当在 plan 完成后进行测试，有问题进入下一个 intent；循环问题应
> 中断询问用户。新增测试 `scripts/test-testgate-fixloop.mjs`（66 用例）。

### Added

- **测试门禁**（详见 `docs/lifecycle.md` §2.6）：
  - `test_runs` 计数：实施后从未跑测试时 Stop 注入「实施未验证」+ 机械证据要求
  - PreToolUse 规则 4b：build_impl/test 阶段（保存值与检测值并集）且
    `test_pass=false` → `git push` / `gh pr create` block；文案含逃生通道
- **失败签名与历史**：`extractTestFailureSignature()`——多框架失败行提取 +
  归一化（数字/耗时/ANSI 剥离，sha1 截 12 位）；`test_failures`（上限 50）+
  `fix_rounds`
- **修复循环中断（Fix Loop Guard）**：`detectFixLoop()` 双规则——R1 签名窗口
  重复 ≥2（A→A / A→B→A / 跨周期）、R2 轮次 ≥ `maxFixRounds()`（默认 3，env
  `SDLC_MAX_FIX_ROUNDS`）→ `fix_loop` 置位 → 代码写入阻断（文档/测试命令放行）+
  三处提醒 → 用户四决策；测试真实通过自动解除
- **`resolveFixLoop()` + `/sdlc-loop-resolve` 命令 + MCP `loop_resolve` 工具**：
  retry / new-intent（调 newCycle 归档轮转，失败历史跨周期保留）/ manual /
  escalate；决策留痕 + audit + 事件
- **MCP status `test_gate` 诊断段**：test_pass/test_runs/fix_rounds/
  last_test_exit_code/fix_loop/最近 3 条失败摘要
- **测试命令识别扩充**：pnpm/yarn/bun test、vitest、npx runners、python -m、
  py.test、cargo nextest、dotnet/deno/gradlew test、mvn surefire；
  jest/vitest/mocha/karma 仅作段首词（防 `build:jest-xxx` 误伤）；Bash 工具名
  兼容 `shell`/`Shell`
- lifecycle.md §2.6 权威标准；prompts/loop-resolve.md 新命令

### Changed

- `newCycle()`：`test_failures` 跨周期保留；`fix_rounds`/`fix_loop`/`test_runs`
  按周期重置；`createTask()` 初始状态含 v0.7.0 字段
- AGENTS.md 门禁表、README 设计原则、usage-guide 命令表、MCP README、hooks.json
  同步

### Fixed

- PostToolUse 合并段：`fix_loop` 以内存值优先（null 显式生效）——防旧盘值覆盖
  刚置位/清零的中断标记
- gitStatusPorcelain 首行错位（存量）：整串 trim 剥掉首行前导空格 → 首行路径
  错位，纯插件状态变更被误判为业务 diff（maintain 检测失效）；逐行 trim 修复
- fix_loop 误伤面：置位与门禁补 engagement 门控（未参与仓库降级 warn）
- fix_loop Bash 绕过：非只读非测试命令在 fix_loop 期间 block（`echo >` /
  `git commit` / `npm install` 等绕过路径封堵）
- 弱签名 exit code 归一化误伤（exit 1/exit 2 曾得同签名）；`isTestCommand`
  抽取为 common.mjs 单一事实源

## [0.6.0] — 2026-09-08

> 交互闭环 + 会话隔离轮（对应仓库发行版 v1.6.0）：Intent Open questions 交互
> 门禁（提问必须等待发起者回答）、MCP 会话上下文隔离（票据配对）。
> 新增测试 `scripts/test-intent-qa.mjs` + `scripts/test-mcp-isolation.mjs`。

### Added

- **Intent Open questions 交互闭环**（详见 `docs/lifecycle.md` §2.5）：
  - `parseOpenQuestions()`：解析 `## Open questions`，识别未回答条目
    （`- [x]` / `~~删除线~~` / 行尾 `[resolved]`/`[answered]` 视为已回答）
  - PostToolUse 门禁：未回答条目存在 → 不推进，停在 `planning/awaiting_answers`；
    maintain 闭环新写的 incident intent.md 同样受门禁约束
  - 提醒层三处注入：Stop（问题清单）+ SessionStart（跨会话遗留）+
    UserPromptSubmit（每回合精简提醒）
  - detectStage 双侧：intent.md 存在 + 未回答 → `planning/awaiting_answers`
  - `prompts/intent.md` 重写交互协议（先逐条提问 → 结束回合等待回答 → 答案
    融入后才写文件）；`rules/stage-planning.md` 硬约束 5 + 反模式（自问自答）；
    `templates/intent.md.tpl` 已回答标记约定
- **MCP 会话上下文隔离**（详见 `docs/lifecycle.md` §4.5）：
  - 票据机制：`writeMcpBindTicket()`（SessionStart 写
    `.sdlc/mcp-bind-queue/`）+ `claimMcpBindTicket()`（FIFO 原子认领：rename
    抢占；并发进程唯一成功；清理 >10 分钟孤儿票）
  - MCP 路由重构：`routeScope()` 每次调用前统一解析——`task_id` 显式 >
    env `SDLC_TASK` > pinned 会话绑定（动态查 session-map）> 全局指针（v0.5
    兼容回退）> legacy
  - 写侧隔离：pinned 会话下 `task_create` 只绑会话；`task_switch` 默认只切
    会话绑定（`global: true` 才切全局）
  - 新工具 `session_scope`（show/bind/unbind）；status 新增 `scope_binding`
    段与 `intent_awaiting_answers` / `intent_open_questions` gates；暴露
    `substage`
- **写保护扩展**：`.sdlc/mcp-bind-queue/**` 纳入运行时状态保护（伪造票据 =
  冒充会话路由）

### Fixed

- **门禁 hold 缺字段**：hold 路径显式维持 `planning`（此前 advanceStage 被跳过，
  state.json 缺 current_stage）
- **门禁标记被合并覆盖**：门禁字段以本 hook 内存值优先（旧盘值不再覆盖
  `intent_awaiting_answers`）

### Compatibility

- 已有无 Open questions 的 intent.md 行为不变；含未回答问题的 intent.md 阶段
  显示从 design 修正为 planning/awaiting_answers（语义修正）；CI/env
  `SDLC_TASK` 行为不变；无票据 MCP 进程回退全局指针路由（v0.5 行为）

## [0.5.1] — 2026-09-08

> 深度审计修复轮（对应仓库发行版 v1.5.1）：2 项高危（真实 Codex 环境下状态机
> 主路径失效、plan 门禁窗口期失效）+ 1 项阶段回归污染 + 5 项一致性缺陷。
> 回归 `scripts/test-bugfix-v151.mjs` 21 用例。

### Fixed — 高危

- **apply_patch 状态机失明**：PostToolUse 此前只识别 `file_path`/`path`，不解析
  apply_patch 的 `tool_input.patch`——真实环境下工件写入不触发阶段推进 /
  sdlc_engaged 置位 / maintain 闭环归档。现提取 patch 内 Add/Update 目标
  （Delete/Move 不算创建）并逐一校验落地存在性
- **plan 待接受窗口期门禁失效**：detectStage 缺「plan.md 已写、未被接受、尚无
  实施 diff」分支 → plan 模式代码门禁在工程师接受前静默失效。现返回
  `build_plan/awaiting_acceptance`
- **session-start 阶段回归污染**：检测值无条件覆盖保存值 → git 状态瞬态令
  保存阶段静默回退。现加防回归守卫（override 优先；保存阶段更靠后时保留，
  写 stage_guard_applied 事件）

### Fixed — 一致性与健壮性

- PostToolUse 乱序自举（state.json 缺失时自举 planning）；会话快照清理改按
  mtime 淘汰（跨会话公平）；审计与 MCP 状态写入原子化（tmp+rename）；MCP
  accept_plan 即时推进（与工具描述一致）；归档目录名与 cycles.json id 单
  stamp（防跨秒不一致）

### Fixed — CLI

- sdlc.sh `advance`：去除死路径检查；门禁语义对齐 advanceStage；错误输出不再
  被吞。`reset`：真正保留 artifact_history 与 cycle_count（此前实际清空）

## [0.5.0] — 2026-09-07

> 工件生命周期与多会话/多任务隔离（对应仓库发行版 v1.5.0）。新增权威标准文档
> `docs/lifecycle.md`（与 hook 代码语义一一对应）。

### Added — 工件生命周期

- **周期归档轮转 `new_cycle`**：`/sdlc-new-cycle [归档目录]` 命令 + MCP
  `new_cycle` 工具。归档当前周期工件到 `docs/sdlc/archive/<cycle-id>/`（附
  cycle-meta.json）；状态机重置 planning、cycle_count+1、engagement 保持
- **工件永不自动删除**：SessionEnd 仅写 scope 快照 + 项目级会话快照
  `.sdlc/sessions/`（保留最近 50 个）
- **maintain 闭环自动归档**：Stage 6 写出新 intent.md 时 PostToolUse 自动归档
  旧周期 spec/plan/REVIEW（keep intent.md），advanceStage(maintain→planning)
  打通（v0.4.0 中该路径为 hook 侧死代码）
- **`set_stage` MCP 工具**：受控阶段回退/钉住（override 下次推进自动解除）
- **`cycle_list` MCP 工具** + `.sdlc/cycles.json` 全局周期索引（最近 200 条）

### Added — 多会话/多任务隔离

- **四级作用域路由 `resolveScope()`**：env SDLC_TASK > session-map 绑定 >
  resume 续绑 > legacy；六个 hook 全部 scope 感知
- **任务隔离工作区** `.sdlc/tasks/<id>/`：`/sdlc-task new|switch|list|close|unbind`
  + MCP `task_create/switch/list/close`（CJS→ESM 桥复用 common.mjs 单一事实源）
- **会话亲和 session-map.json**（LRU 200）：新会话不自动吸附活跃任务（防污染）；
  SessionStart 注入活跃任务清单与切换指引
- **跨会话接管检测**：session_id 变化时重置注入去重与 token 计数
- **原子写**：writeCodexState/writeGlobalJson 改 tmp+rename

### Fixed

- **reset 无法开启新周期**：语义二分——`reset` = 完整退出（不清工件）、
  `new_cycle` = 迭代延续；prompt 与工具描述均明确指引
- **stage_override 粘死**：advanceStage 成功后清除（此前永不清除）；新建任务
  即参与工作流（sdlc_engaged 置位）

### Security

- 运行时状态 block 扩展：`.sdlc/tasks/<id>/{state,hooks-state,task}.json`、
  `.sdlc/{session-map,cycles,tasks}.json`、`.sdlc/sessions/*.json`；周期归档
  目录 → warn

### Compatibility

- legacy 模式（无任务）行为与 v0.4.0 完全一致；任务模式 opt-in；代码工作区
  不做隔离（如实声明）——同仓库并行多任务请配 git 分支

## [0.4.0] — 2026-09-07

> 文档写入保护策略标准化（对应仓库发行版 v1.4.0）。响应用户反馈「hook 阻止
> 文件写入（包括文档）」：按 playbook 语义把门禁重新设计为「代码不可变、文档
> 可写」三层模型。权威标准 `docs/write-policy.md`。

### Fixed

- **plan 模式过度拦截**：旧版 Stage 3a 黑名单式拦截（除 `plan.md`/`docs`/
  `.sdlc/` 外全部 block），文档无法编辑。新版白名单式放行：仅拦**业务代码类**，
  文档类任意阶段可编辑
- **无关仓库误拦**：含 `spec.md` 而无 `plan.md` 的普通仓库被硬拦 → 新增
  `sdlc_engaged` 参与标记，未参与项目 block 降级 warn
- **新分支阶段检测失效**（存量 bug）：unborn branch 上 `git rev-parse`
  exit 128 → 优先 `git branch --show-current`

### Security（Bash 门禁加固 + 状态防篡改）

- 链式命令绕过（拆段逐段校验）；重定向写文件（`>`/`>>`/`2>file` 视为写）；
  命令替换（`$(...)`/反引号一律拦）；apply_patch 路径盲区（解析全部目标）；
  运行时状态防篡改（`.sdlc/state.json` 等任何阶段 block——agent 手改等于
  自我授权，状态变更仅走 hook 与 MCP 受控工具）

### Added

- `docs/write-policy.md` 权威标准；规格漂移提醒（build/test/deploy 改
  spec.md → warn）；只读白名单扩充；`find` 破坏性参数排除；MCP `reset`
  同步清除 `sdlc_engaged`

## [0.3.0] — 2026-09-07

> Codex 全面适配轮（对应仓库发行版 v1.3.1）：清除全部 Claude 专属机制引用，
> 机构知识工件与非交互调用统一为 Codex 约定。Anthropic playbook 仍作为方法学
> 出处注明（非运行时依赖）。

### Changed

- **机构知识工件 CLAUDE.md → AGENTS.md**：模板重命名 + 检测器 AGENTS.md 优先、
  遗留 CLAUDE.md 回退兼容；init-project 默认创建 AGENTS.md（遗留 CLAUDE.md 保留
  并提示）
- **非交互调用 `claude -p` → `codex exec`**：CI 评估模板安装包
  `@anthropic-ai/claude-code` → `@openai/codex`；bands.yaml
  `claude_invocation` → `codex_invocation`；production-gate 安装位置适配
- 门禁与提示文案、rules/skills/prompts/spec 全量去 Claude 化
- MCP self_review 产物键名改 Codex/AGENTS.md 语义；文档计数修正（slash 命令
  实为 14 个）

### Compatibility

- 已初始化项目无需迁移（遗留 CLAUDE.md 仍被识别）；state.json 结构不变

## [0.2.0] — 2026-09-07

> 安装流程重构轮（对应仓库发行版 v1.3.0）：落地两步安装流程，移除插件级
> install/uninstall 脚本与 classic 模式。

### Changed

- 移除插件级 `scripts/sh/{install,uninstall}.sh`；config.toml 与 hooks.json
  描述移除 classic 模式；AGENTS.md / README / usage-guide 安装章节改为两步流程
- 仓库根目录新增 `scripts/{sh,ps}/{install,uninstall}.{sh,ps1}`（marketplace
  注册/移除，幂等）

### Migration

- 旧版用户：仓库根 `bash scripts/sh/install.sh` 注册 marketplace → codex 会话
  内 `/plugins` 启用 ai-sdlc；项目级 `.sdlc/` 不受影响

## [0.1.0] — 2026-09-07

### Added

- **Initial release**：把 Anthropic《AI-Native SDLC playbook》翻译成可执行的
  Codex 插件
- 6 个 Codex 原生生命周期 hooks（SessionStart 工件扫描+阶段检测+资源索引 /
  UserPromptSubmit 规则按需注入+反模式警告 / PreToolUse 阶段门禁强制 /
  PostToolUse 工件监听+自动推进+测试通过检测 / Stop 产出检查+人工关卡提示 /
  SessionEnd 会话快照归档）
- 工件驱动状态机（stage-detector.mjs）：基于文件存在性 + git 状态自动判定阶段
- 6 个阶段技能 + 12 个 slash 命令（/sdlc-*）
- 1 个 MCP 编排器（sdlc-orchestrator）含 12 个工具（status / workflow /
  advance / reset / refresh / accept_plan / set_fix_mode / approve_release /
  set_change_ticket / self_review / audit / events）
- 6 份阶段规则 + 审查策略；6 份工件模板（intent/spec/plan/REVIEW/CLAUDE/
  bands.yaml）+ 配套模板（evals.json / agent-evals.yml / production-gate.sh）；
  2 份基线规范（sdlc-baseline / artifact-contract）
- 安装器（plugin + classic 双模式）；项目初始化器（幂等创建 .sdlc/ + 模板）；
  CLI 入口（status/workflow/advance/reset/audit/events/doctor）
- 零依赖：纯 Node 18+，无 npm 依赖，离线运行

### Design Principles

工件驱动（阶段判定基于文件存在性）/ 零显式注入 / 门禁即代码（PreToolUse 强制）/
闭环（maintain 产出新 intent.md 自动回到 planning）/ 审计追踪（工件链 + hook
审计 + 事件流）
