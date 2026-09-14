# 工件生命周期与多任务隔离标准（Lifecycle & Isolation Policy）

> ai-sdlc v0.5.0 起生效（v0.6.0 提问闭环、v0.7.0 测试门禁与循环中断、v0.8.0/v0.9.0
> frontend-e2e 与反检测、v0.9.0 安全加固、v0.10.0 工件工作区化与首次使用自动
> 初始化、v0.11.0 回合结束通知、**v0.12.0 输入分流与临时任务队列**递增修订）。
> 本文件是**工件生命周期管理的权威标准**：
> intent/spec/plan 等工件何时创建、何时归档、是否删除、是否入版本控制；多会话/
> 多任务如何隔离。hook 代码（`hooks/scripts/lib/` 模块群 tasks.mjs 的 resolveScope/
> newCycle/archiveCycleArtifacts/ensureProjectBootstrap/addQuickTask/updateQuickTask
> 与 `lib/notify.mjs`）是
> 本标准的可执行形式，两者语义一一对应。配套的写入权限标准见
> `docs/write-policy.md`；输入分流的分类标准见 `rules/triage.md`。

## 并发与多会话安全（v0.13.5）

- 共享状态文件（state.json / tasks.json / quick-tasks.json / session-map.json /
  cycles.json）的读-改-写全部经 `mutateJsonFile`（lib/atomic.mjs）跨进程锁
  （O_EXCL lockfile + 退避重试 + 降级直写兜底）——hooks 进程与 MCP 常驻进程
  共用同一把锁（MCP 经 ESM 桥），Codex 并行工具调用 / 双会话同项目不再
  互盖丢更新（阶段推进 / sdlc_engaged / 队列条目 / 会话绑定）。
- 推进类写入锁内幂等重验：并发 advance 只有一次生效（cur=next 直接跳过）。
- JSON 读取剥 UTF-8 BOM：Windows 工具链保存过的状态文件不再静默读空。
- Stop hook 注入的队列字段（desc/id）注入前消毒（防克隆仓库投毒伪造指令行）。
- 详见 docs/architecture.md「为什么共享状态要跨进程锁」。


## 1. 三个核心问题

**Q1：会话结束后，生成的 intent / spec / plan 会被删除吗？**
**不会，永远不会（自动删除是明确禁止的反模式）。** 工件是任务推进的中间产物
与审计追踪载体（`intent.md → spec.md → plan.md → diff+tests → PR →
incident.md`），删除等于销毁审计链。SessionEnd 只做三件事：写 scope 内
session-end.json 快照、把会话快照存档到 `.sdlc/sessions/`（保留最近 50
个）、累计统计。**工件本体不动。**

**Q2：工件进版本控制吗？任务结束后怎么处理？**
**不进版本控制（v0.10.0 起默认）。** 工件是任务推进的中间产物而非治理交付物
——留在 `.sdlc/` 工作区（`.gitignore` 托管块自动忽略）；**任务结束只需归档**：
周期结束（新需求/下一轮迭代）用 `new_cycle`，任务完结用 `task_close`，
旧工件被**移动**（而非删除）到 `.sdlc/archive/<cycle-id>/`，阶段机重置回
planning，`cycle_count` +1。下一轮迭代在干净的工作区重新产出，历史周期完整
保留在归档区（本地审计链；需要 PR 可审查的归档链时，可显式传
`docs/sdlc/archive` 迁回仓库内）。

**Q3：多会话/多任务之间会不会互相污染？**
v0.4.0 及以前会（项目级单例状态，多会话互相覆盖）。v0.5.0 起通过三层机制实现
有效隔离：作用域路由 + 会话亲和 + 任务隔离工作区（见第 4 节）。

## 2. 生命周期总览

```
            会话边界                        周期边界
┌────────────────────────────┐   ┌────────────────────────────┐
│ SessionStart: 作用域路由    │   │ new_cycle / maintain 闭环   │
│   ↓ 工件驱动阶段检测        │   │   ↓ 归档 intent/spec/plan/  │
│ 工作期间: 工件写入/推进      │   │      REVIEW → archive/<id>/ │
│   ↓ 门禁(PreToolUse)        │   │   ↓ 状态机重置 planning     │
│ SessionEnd: 快照存档        │   │   ↓ cycle_count +1         │
│   （工件不动,永不删除）      │   │   （新周期在干净工作区开始） │
└────────────────────────────┘   └────────────────────────────┘
```

### 2.1 工件状态机

| 状态 | 位置 | 进入条件 | 离开条件 |
|------|------|---------|---------|
| 活动（active） | `.sdlc/artifacts/`（任务模式：任务目录） | agent 在对应阶段创建 | 周期/任务结束被归档 |
| 已归档（archived） | `.sdlc/archive/<cycle-id>/`（默认，不入版本控制） | new_cycle / maintain 闭环 / task_close | 永不自动离开（审计链） |
| 存量（legacy，兼容） | 项目根 / docs/ | v0.9 及以前的项目遗留 | 检测/更新兼容；新工件应入工作区 |

归档目录选择：`.sdlc/archive/`（**默认**——工作区外，gitignore 托管块忽略）或
`docs/sdlc/archive/`（显式指定——留在仓库内，适合要 PR 可审查归档链的治理团队）。

### 2.2 周期（Cycle）计数与索引

- `state.cycle_count`：已完成周期数（scope 级：任务各自计数）
- `state.cycle_id`：当前活动周期标识（`cycle-001` 格式）
- `.sdlc/cycles.json`：全局周期索引（最近 200 条）：周期号、任务、最终阶段、
  归档目录、工件清单、原因、结束时间；归档目录内 `cycle-meta.json` 为完整元数据

### 2.3 开启新周期的三种方式

| 方式 | 触发者 | 语义 |
|------|-------|------|
| `new_cycle {archive_dir?}`（MCP；用户自然语言「开新周期」） | 用户 | 显式开启下一轮迭代 |
| `mcp__sdlc-orchestrator__new_cycle` | agent（MCP 工具） | 同上，受控通道 |
| maintain 闭环自动归档 | PostToolUse hook | Stage 6 写出**新 intent.md** 时，旧周期 spec/plan/REVIEW 自动归档，新 intent 保留为下一周期起点，阶段回 planning |

> maintain 自动闭环是必需的：若不归档，旧工件会让阶段检测永远判在后期阶段，
> 新周期无从启动（v0.4.0 的实际缺陷，v0.5.0 修复）。

### 2.4 需求变更（周期内回退）

周期**内**的需求变更不需要开新周期——回到设计阶段改规格即可：

```
mcp__sdlc-orchestrator__set_stage({ stage: "design", note: "需求变更：..." })
```

`set_stage` 受控地设置 `stage_override`（下次推进自动解除）。更新 spec.md 后流程
正常向前推进。

### 2.5 Intent 提问闭环（Open questions 交互门禁）

问题：agent 写完含 Open questions 的 intent.md 后立即推进 Stage 2——开放问题
从未给发起者回答机会，变成「agent 自说自话」的装饰章节。

机制（与 plan.md 的 accept 门禁同构）：

1. **协议层**（`prompts/intent.md`）：识别出未知后，先在对话中逐条提出问题，
   **结束回合等待发起者回答**，答案融入后才写/更新 intent.md；仅发起者明确表示
   暂不回答的问题才留在 Open questions 章节
2. **门禁层**（`post-tool-use.mjs`）：intent.md 落地时解析 `## Open questions`
   ——存在未回答条目 → 不推进，阶段停在 `planning / awaiting_answers`
3. **提醒层**（三处注入）：Stop（列出问题清单）+ SessionStart（跨会话遗留）+
   UserPromptSubmit（每回合精简提醒，不进去重）
4. **闭环**：发起者回答 → agent 更新 intent.md → 重新解析 → 全部已解决 → 自动推进

**已回答标记约定**（与 templates/intent.md.tpl 对齐）：移除条目（推荐）；或
`- [x] 问题` / `~~问题~~` / 行尾 `[resolved]` / `[answered]`（保留审计痕迹）；
模板占位符（`<`、`例如`）不计入。

**逃生通道**：发起者明确跳过 → MCP `advance`（`force=true`，用户明确同意后 agent 调用）；
建议遗留条目标 `(deferred)` 留痕。maintain 闭环新写的 incident intent.md 同样受
门禁约束（归档照旧发生）；已有无问题的 intent.md 行为不变。

### 2.6 测试门禁与修复循环中断（Test Gate & Fix Loop Guard）

问题：SDLC 缺乏强制测试环节——plan 接受并实施后，agent 可能不跑任何测试就
push / 提 PR / 报告完成；测试失败后也没有迭代闭环。

机制（三层，与其他门禁同构；**全部以「已参与工作流」为前提**——普通仓库调试时
连续失败是常态，中断门禁与测试 push 门禁对未参与项目降级为 warn）：

#### 第一层 · 测试门禁（必须真实测试）

- **计数**：测试命令真实执行（`common.isTestCommand` 单一事实源：make test /
  npm/pnpm/yarn/bun test / pytest / cargo test / go test / jest / vitest / mocha /
  gradle / dotnet 等 + Playwright 全形态，见 §2.7；Bash/shell 工具名均兼容）→
  `test_runs++`；退出码 0 → `test_pass=true`
- **Push/PR 门禁**：`build_impl`/`test` 阶段（保存值与检测值取并集，防 diff 提交
  后检测跌回漏拦）且 `test_pass=false` 时，`git push` / `gh pr create` 一律 block
- **完成提醒**：实施后 `test_runs=0` → Stop 强提醒「实施未验证，报告完成前必须
  运行测试」+ 粘贴原始输出的机械证据要求
- **逃生通道**：项目无测试套件 → 补最小冒烟测试，或经用户明确同意后 MCP `advance`

#### 第二层 · 失败 → 修复或下一个 intent 迭代

测试失败（exit ≠ 0）时记录**失败签名**（`test_failures`）并计数（`fix_rounds`）。
签名从测试输出提取失败行（多框架通用，含 Playwright list 报告器格式），归一化
剥离数字/耗时/ANSI 色码——**同一问题重复出现得到同一签名**。

失败的两条正路（由提醒层引导，不强制选择）：

- **就地修复（首选）**：小问题修代码重跑（`in_fix_mode` 禁改测试的保护照旧生效）；
  通过 → `fix_rounds` 清零（失败历史保留）
- **intent 迭代**：失败暴露需求/设计缺口 → MCP `new_cycle` 归档当前周期，
  把失败测试作为 incident 写入新的 intent.md

#### 第三层 · 循环中断（防 A→B→A 死循环）

**触发规则**（任一命中即置位 `state.fix_loop`）：

- **R1 同签名重复**：最近 5 次失败窗口内同一签名 ≥2 次——涵盖 A→A（相邻重复）与
  A→B→A / A→B→C→A（振荡）。**跨周期有效**：`new-cycle` 后 `test_failures` 历史保留
  ——迭代没有解决问题就是循环，不能无休止迭代下去
- **R2 轮次超限**：同周期连续失败 ≥ `maxFixRounds()`（默认 3；环境变量
  `SDLC_MAX_FIX_ROUNDS` 可调）——失败未见收敛

**中断行为**（置位后自动生效）：

- PreToolUse **阻断业务代码写入**（文档放行——写新 intent.md/更新 plan 是合法
  逃生路径）；Bash 同步加固：非只读且非测试的命令一律 block（只读命令与测试命令
  放行，允许重跑取证）
- Stop + UserPromptSubmit + SessionStart 三处提醒：**停止自动修复，向用户呈报循环
  证据并等待决策**
- `test_failures` / `hook-audit.json` / 事件流（`fix_loop_detected`）留痕

**用户决策通道**（MCP `loop_resolve`；用户自然语言如「重试一轮」「我自己来修」即触发）：

| 决策 | 效果 | 适用 |
|------|------|------|
| `retry` | 轮次计数重置再修一轮；**同失败再现立即再中断**（连续确认防死循环） | 用户判断接近解决 |
| `new-intent` | 归档当前周期（cycle+1），失败作为 incident 进下一个 intent 迭代 | 需求/设计缺口 |
| `manual` | 用户接管修复，agent 转只读协助 | 需要人类判断 |
| `escalate` | 记录升级决策，汇总证据呈报更高层 | 超出会话能力 |

**自动解除**：测试真实通过 → fix_loop 清除（`fix_loop_cleared` 事件）。
**不得**为解除而跳过/删除/弱化失败测试——那不是通过，是表演。

**状态字段速查**（全部位于 scope 内 state.json，受运行时状态写保护）：

| 字段 | 语义 | 周期重置 | 跨周期保留 |
|------|------|----------|------------|
| `test_runs` | 本周期测试真实执行次数 | ✔ | ✘ |
| `test_pass` | 最近一次测试是否通过 | 进入 test 阶段时重置 | ✘ |
| `fix_rounds` | 本周期连续失败轮次 | ✔（通过/new-cycle 清零） | ✘ |
| `test_failures` | 失败历史（签名/摘要/周期，上限 50） | ✘ | ✔（循环检测窗口） |
| `fix_loop` | 循环中断标记（含 kind/rounds/window/hint） | new-cycle 清除 | ✘ |
| `fix_loop_resolutions` | 历次决策留痕 | ✘ | ✔ |

### 2.7 前端 E2E 测试技能（frontend-e2e）

**定位**：与 6 个阶段技能（按阶段触发）不同，frontend-e2e 是**能力技能**——在
build_impl / test 阶段涉及前端改动时启用，SessionStart 资源索引在这两个阶段注入
提示行。补齐「改 UI 的周期里 Stage 4 真实测试」的标准路径：单元测试拦不住用户
行为层回归，人工目测无机械证据。

**与测试门禁的协作语义**（单一事实源 `common.isTestCommand`）：

| 命令形态 | 门禁识别 | 说明 |
|---------|---------|------|
| `npx/pnpm/yarn/bunx playwright test`（含 `dlx`/`exec` 前缀） | ✔ 计入 `test_runs` | 技能首选标准命令 |
| 裸 `playwright test`（含 `./node_modules/.bin/` 路径前缀） | ✔ | PATH 直达场景 |
| `npm/pnpm/yarn/bun run e2e` / `test:e2e`（含 `e2e:*` 变体） | ✔ | 脚本约定场景 |
| `playwright install` / `codegen` / `show-report` / `show-trace` | ✘ | 工具命令，**不计为测试执行**——install 后必须真实跑一次测试才算数 |
| `bash -c "npm test"` / `sh -lc 'npx playwright test'`（引号负载，≤2 层嵌套） | ✔ | v0.9.0 引号感知负载提取；引号内伪包装（`echo 'bash -c "npm test"'`）不提取 |
| `echo playwright test` / `git commit -m "…make test…"` 等字面量 | ✘ | 段首词纪律 + **引号字面量剥离**（字符串字面量不得计为测试执行，防伪造 `test_pass`） |

**失败签名**：Playwright 失败输出（list 报告器 `✘ N [browser] › …` / 汇总编号条目 /
`Error: expect` 断言行）进入签名提取 → 同一 E2E 失败重跑同签名（循环熔断 R1 可
命中），不同用例失败不同签名。证据运行使用默认/list/line/dot 报告器——json/none
报告器丢失失败行会退化为弱签名。

**循环熔断照常生效**：同一 E2E 用例反复红或红绿振荡 → `fix_loop` 置位 → 代码写入
阻断 → 用户四决策。技能 §8 要求的调试路径（trace 取证 → 单用例复现 → 修代码不修
测试）正是熔断所期望的工作方式。

**视觉闭环**：spec.md 带 mock 的周期用 `toHaveScreenshot` 机械化「截图与 mock 对比」；
`--update-snapshots` 仅限 spec 明确变更视觉基线——为让失败消失而刷基线等同修改
测试使其通过（Stage 4 反模式）。

**自定义**：项目自有技能放 `.sdlc/custom/skills/<name>/SKILL.md`（Codex 加载，
与内置技能叠加不覆盖）；frontend-e2e 的行为约定见其 SKILL.md 与 references
（配置模板 / 示例用例 / 调试与 CI 速查 / 反检测指南 / stealth fixture 共 5 份）。

**反检测（anti-detection）**：被测目标带 Cloudflare/DataDome/reCAPTCHA 或 OAuth
反自动化页面时，Playwright 默认指纹（`HeadlessChrome` UA、`navigator.webdriver=true`、
plugins=0、SwiftShader WebGL）会让用例卡在挑战页——属「测试无法进行」的环境问题，
非实现缺陷。权威标准：`skills/frontend-e2e/references/anti-detection.md`（症状判别 →
L1 原生加固（零依赖：真实 UA + locale/timezone 一致性 + init scripts 抹指纹位 +
`--disable-blink-automation`）→ L2 真实 Chrome 通道（`channel: 'chrome'`）→
L3 playwright-extra + stealth 插件，最少侵入优先逐层验证）。

硬边界（与门禁语义同源）：

- **合规**：仅限自有/授权测试目标；禁止用于第三方站点反爬绕过/抓取/ToS 违反
- **不弱化断言**：反检测只改浏览器指纹，断言语义一寸不让；借此放室断言 = 伪造证据
  （测试门禁对反检测运行一视同仁——命令形态不变，计数/签名/熔断照常生效）
- **依赖安装的时序**：`npm install -D playwright-extra puppeteer-extra-plugin-stealth`
  是安装命令（不计入 test_runs）；fix_loop 中断期间被 Bash 门禁拦截属设计行为——
  先经用户决策调 MCP `loop_resolve` 解除再装
- **环境性失败呈报**：挑战页导致的失败签名相近，若因此连续熔断，呈报时明确
  「疑似环境性拦截，非实现缺陷」，按 anti-detection.md §4 诊断而非反复重跑

### 2.8 输入分流与临时任务队列（Input Triage，v0.12.0）

**定位**：用户输入进入 SDLC 前的第一道分流。**需求/ISSUE 统一走 SDLC 流程；
补充信息融入当前周期工件；临时任务不走流程**——三类内容互不混淆。分类标准
（判定特征、优先级规则、混合输入处理）见 `rules/triage.md`，本节定义其运行时
载体与时机语义。

**三分类的执行路径**：

| 类别 | 判定特征 | 执行 |
|------|---------|------|
| 需求/ISSUE | 新功能/缺陷/改进，将产出交付物 | SDLC 六阶段（intent → … → incident） |
| 补充信息 | 对当前周期的澄清 / Open questions 回答 / 约束补充 | 融入当前阶段工件（intent/spec/plan 对应章节），不新开流程 |
| 临时任务 | 一次性小事（查资料/解释代码/改文档措辞），与当前需求无交付物级关联 | 无周期→直接处理不落工件；周期进行中→**登记排队** |

**临时任务队列（quick-tasks）运行时语义**：

- **存储**：全局 `.sdlc/quick-tasks.json`（与 tasks.json 同级；不随任务作用域
  隔离——切任务/开新周期不丢队列）。条目 `{id, desc, status, created_at,
  scope, session_id}`；状态机 `queued → in_progress → done` / `queued →
  dropped`（终态不可再变更）；上限 100 条，超出只裁最旧终态条目
  （queued/in_progress 永不丢）
- **受控修改**：队列是运行时状态（PreToolUse block，agent 禁改）——写入只经
  一条受控通道：MCP `quick_task` 工具（action：add/list/run/done/drop）。用户
  入口为自然语言（「记个临时任务」「看队列」「马上做」「做完了」），agent 按会
  话注入的意图→工具映射调用；v0.13.0 前存在的 `/sdlc-quick` 命令已随自定义
  slash 命令体系移除（官方 CLI 不支持，UserPromptSubmit 解释器为死代码，已删）。
  所有变更写 `events.jsonl`（quick_task_added / quick_task_updated）留痕
- **排队时机（准确语义）**：「周期进行中」= 当前 scope 工作区存在
  intent.md / spec.md / plan.md 之一（未归档）。此时临时任务只登记不执行，
  **待周期走完后统一处理**——处理内容不得混入当前周期工件或 diff（审计链
  不污染，二者不混淆）
- **处理时机**：周期结束（maintain 闭环归档 / `new_cycle` / `task_close`）
  后工作区回到干净状态——SessionStart / UserPromptSubmit / Stop 三处 hook
  检测「队列非空 + 无进行中周期」即注入待处理提醒，逐条 `run → 处理 → done`
- **用户显式优先**：用户明确要求提前处理某条（"现在先查这个报错"）→
  `quick_task({action: "run", id})` 标记 in_progress 后立即处理——**仍不走 SDLC 流程、
  不落周期工件**；处理完 `done` 并回到周期原阶段
- **防遗忘三重提醒**：SessionStart（会话恢复时注入完整分流协议 + 队列状态）、
  UserPromptSubmit（每回合轻量提醒：三分类指引 + 队列计数 + 周期状态）、
  Stop（队列非空时按周期状态注入「排队中/待处理」提醒——agent 须向用户转达）

**与相近机制的边界**：

- **不等于 task（多任务隔离）**：task 是并行**需求**的隔离（完整状态机+工件空间）；
  quick 是**无交付物小事**的排队（无工件、无门禁语义）
- **不等于 Open questions 回答**：那是**补充信息**——直接融入 intent.md
  （awaiting_answers 门禁据此解除），不进队列
- **不等于需求变更**：改变交付物的输入是 REQ——按 2.4 的周期内回退处理

**操作手册注册（官方 `/prompts:` 桥，v0.13.1 跨平台化；v0.13.2 零操作化）**：
18 份 `prompts/` 手册可注册到用户 prompts 目录（`~/.codex/prompts/sdlc-<名>.md`，
前缀防撞名），之后用官方 `/prompts:sdlc-quick` 等形式调用（官方 CLI 唯一支持
的自定义调用形式）。**v0.13.2 起注册零操作化**：SessionStart 每会话调
`common.ensurePromptsRegistered` 自检——缺失或与插件当前版本不一致（升版）
即自动刷新（差量复制，只写 `sdlc-*`，不碰用户其他 prompts；成本 ≤ 2N 次
readFileSync）；已注册且无变化静默跳过。**opt-out 语义**：显式卸载（MCP
`register_prompts({action:"remove"})` 或 sh/ps1 脚本 `--remove`）在目标目录
写入 `.sdlc-prompts-optout` 标记——此后 SessionStart 不再自动恢复；显式
register（MCP/脚本）清除标记恢复自动；`SDLC_PROMPTS_AUTO=off` 总关（与
`SDLC_NOTIFY=off` 同惯例）。手动/离线/CI 通道保留：MCP `register_prompts`
工具（Node fs 单一事实源，register 幂等刷新 / remove 卸载写标记 / list
查询；事件留痕 `events.jsonl`）+ `scripts/sh/install-prompts.sh`（macOS/
Linux 便利品）+ `scripts/ps/install-prompts.ps1`（Windows 便利品，PS 5.1
兼容）。自动注册动作进 SessionStart 审计（`detail.prompts_auto`）与事件流
（`prompts_auto_registered`）。不注册不影响任何能力（自然语言即可驱动全部
功能）。

### 2.9 环境自检与跨平台脚本护栏（v0.13.2）

**定位**：hook 层监测运行环境并约束脚本调用，防止「注定失败」的命令报错
（Windows 无 bash 跑 `.sh`、无 pwsh 的 macOS/Linux 跑 `.ps1`）。**能力感知
而非 OS 一刀切**——探测确认可用即放行（装了 Git Bash/WSL 的 Windows 照常
跑 `.sh`；装了 pwsh 的 macOS/Linux 照常跑 `.ps1`）。

**机制**（实现：`hooks/scripts/lib/env.mjs`，零依赖纯函数）：

- **环境画像（detectEnvironment）**：平台 + POSIX shell 可用性（非 Windows
  恒 true；Windows 扫描 PATH 上 bash.exe/sh.exe/wsl.exe + Git for Windows
  常见落点 `%ProgramFiles%\Git\bin\bash.exe` 等）+ PowerShell 可用性
  （Windows 恒 true——powershell.exe 全系预装；非 Windows 扫描 pwsh）。
  全部 existsSync，单次 < 1ms，每 hook 进程独立调用
- **SessionStart 注入**：一行画像摘要（`Linux · bash/sh ✓ · PowerShell ✗`）
  + 仅本机确实不可用的约束行（「勿执行 .sh/.ps1——等价能力用 …」）；全可用
  时只有摘要行。画像进审计 `detail.env`
- **PreToolUse 护栏（规则 0d）**：Bash 命令按 `&&/||/;/|/换行` 拆段，段首
  token 剥离 env 前缀与 sudo 后判定——POSIX 启动器（bash/sh/zsh/dash/ash/
  wsl）或段首 `.sh` 且无 POSIX shell → block；PowerShell 启动器
  （powershell/pwsh）或段首 `.ps1` 且无 PowerShell → block。拦截文案含
  精确替代：插件脚本自动映射孪生（`scripts/sh/x.sh` ↔ `scripts/ps/x.ps1`，
  孪生存在才推荐）+ MCP 免 shell 通道 + 安装缺失运行时的指引。触发进审计
  `detail.script_guard`。与 engagement 无关（纯错误预防，非工作流门禁）
- **误伤边界**：只拦执行形态——`cat`/`ls`/`grep` 读取 `.sh` 路径、`node
  *.mjs` 等跨平台命令不拦；`env FOO=1 bash x.sh`、`sudo bash x.sh` 正确
  判定（剥前缀后仍按 bash 拦）

**notify.mjs 先例**：回合结束通知早已按平台分发（osascript / PowerShell
toast / notify-send，spawn 直调不经 shell）——环境自检体系与之互补：通知
层管「输出」，护栏层管「输入」（agent 发起的 shell 调用）。

### 2.10 MCP 启动器指针（v0.13.3）

SessionStart 把插件根/项目根写入 `.sdlc/mcp-launcher.json`（幂等原子写 + 版本自读
plugin.json），供 `.mcp.json` 内联 bootstrap（`node -e` 自定位引导）解析——
Codex 以用户启动目录为插件 MCP 子进程 cwd、相对 args 按该 cwd 解析且不插值
`${VAR}`（openai/codex#19582/#22842），相对路径形式在真实安装下 ENOENT。
四级解析链：`SDLC_PLUGIN_ROOT` env > 本指针（防投毒：必须位于
`CODEX_HOME/plugins` 之内才采信）> `CODEX_HOME/plugins` 两层扫描 > cwd。
指针受 PreToolUse 写保护（RUNTIME_STATE_RES，含 shell 写通道规则 0e）；
写入失败不阻塞会话（注入修复提示行 + 事件留痕，重启会话自愈重写）。
详见 architecture.md「为什么 .mcp.json 是内联 bootstrap」。

### 2.11 plan 接受通道与生命周期记忆锚点（v0.13.11）

问题（用户实测死锁链）：plan.md 产出后处于 `build_plan / awaiting_acceptance`，
用户说「接受」，但——① 上下文压缩后 agent 丢失「需先调 accept_plan 记录接受、
接受后才能改代码」的记忆，直接 apply_patch 业务代码被规则 1 拦；② agent 转而
用 `rg "accept_plan|plan_accepted|accept-plan" | head` 排查，又被引号内 `|`
误切分误拦（write-policy §4.1 引号感知修复）；③ 该会话未暴露
mcp__sdlc-orchestrator__* 工具且无 CLI 回退——手改 state.json 被规则 0 拦，
三条链合成死锁。本节定义接受通道与回合级记忆锚点。

**双通道记录接受（同一语义，同一把锁）**：

| 通道 | 形态 | 适用 |
|------|------|------|
| MCP 工具 | `mcp__sdlc-orchestrator__accept_plan` | 正常路径（MCP server 随会话启动） |
| 受控 CLI | `bash <插件根>/scripts/sh/sdlc.sh accept` 或 `node <插件根>/hooks/scripts/accept-plan.mjs [项目根]` | MCP 工具未暴露时的回退（规则 1b 对精确路径段级豁免，见 write-policy §4.2） |

两通道完全同语义：`state.plan_accepted=true` + 锁内幂等重验推进
`build_plan → build_impl`（并发不双推进）+ `plan_accepted` 事件留痕
（`via: mcp:accept_plan` / `via: cli:accept-plan`——审计链可区分通道）。
CLI 同样幂等（重复接受只刷新时间戳不重复推进）、无 plan.md 时报错退出 1。
**仅 accept 语义豁免**——`sdlc.sh advance/reset` 可跳过产出/门禁检查，
不接受经 Bash 通道代劳，plan 模式仍拦。

**生命周期记忆锚点（UserPromptSubmit 每回合注入，不进去重）**——上下文压缩
后 agent 从这三段注入即可恢复「现在在哪、卡在哪、下一步做什么」：

1. **生命周期状态条（0b）**：紧凑两行——当前阶段（子阶段）· 任务隔离/闭环数 +
   下一步动作（门禁类 substage / fix_loop / in_fix_mode 优先覆盖默认提示；
   检测值即有效阶段才呈现门禁，与 v0.13.10 有效阶段语义一致）。token 预算
   超额时与门禁类提醒同保留（essentials 过滤）
2. **plan 等待接受提醒（1e）**：`awaiting_acceptance` 窗口每回合注入——
   本阶段禁改业务代码 + 接受通道（MCP + CLI 回退）+ 修订/否定路径；与 1b
   （awaiting_answers）/1c（fix_loop）同为交互门禁的回合级锚点
3. **接受意图识别（1e 内嵌）**：用户说「接受/同意/批准/OK 开始」类短消息时，
   注入明确指令「立即调用 MCP accept_plan（不可用时 CLI 回退）」。保守高精度
   策略：否定/暂缓/修改语义一律不判接受（「不接受」「同意之前先补测试」
   「暂缓」均回退通用提醒）——误报代价是未经批准的阶段推进，漏报只是回退
   到通用提醒，agent 仍能自行连接上下文

配套：SessionStart 意图→工具映射表含「接受/同意/批准这个计划」→ accept_plan
（含 CLI 回退）、「批准发布/生产上线」→ approve_release、「迁移工单号」→
set_change_ticket 三行人工门禁意图（v0.13.11 前映射表恰好缺 accept——压缩后
连锚点表都找不到接受通道）；Stop 人工关卡与 PreToolUse 规则 1/1b 拦截文案均
给出双通道。

### 2.12 Codex 沙盒授权协作与 Playwright 环境协议（v0.13.12）

问题（用户实测）：curl 等网络访问命令、dev server 等端口监听命令被 Codex
沙盒拒绝——这是**平台安全机制**（sandbox 默认禁网络/禁端口绑定），非本插件
门禁。agent 被拒后的正确动作是「向用户呈报命令与目的，请求授权提权运行」，
而不是反复原样重试或尝试绕过沙盒。同时：本地环境一般没有 Playwright 相关
依赖，现场裸跑 `npm install` 既越权（装不装应由用户抉择）又易撞沙盒网络拦截。

**沙盒授权三层联动**：

| 层 | 触发点 | 行为 |
|----|--------|------|
| 预防性预警（PreToolUse 规则 0f） | 网络访问/端口监听类命令放行前 | 注入授权应对协议（warn/additionalContext，每会话去重一次，hooks-state.sandbox_protocol_shown）：被拒特征 + 呈报三要素（命令/目的/权限）+ 替代方案指引 |
| 拒绝证据（PostToolUse） | Bash 失败输出命中特征 | 强特征（network access is disabled / sandbox denied / seatbelt / landlock / requires approval）任意命令即记；弱特征（EPERM/EACCES/ENOTFOUND/ETIMEDOUT…）仅网络/端口类命令记 → hooks-state.sandbox_denied + events.jsonl 审计事件。**被拒的测试命令不计 test_runs / 失败轮次**（沙盒拒绝 ≠ 测试失败，计入会误导 fix_loop） |
| 回合提醒（UserPromptSubmit 1f） | 下回合检测到 sandbox_denied | 注入针对性提醒（命令/特征/请求授权指引），呈现一次即清除——每条拒绝恰好提醒一回合，不累积噪音 |
| **用户召回（PreToolUse，v0.13.13）** | 同预防层判定点：网络/端口命令放行时 | **审批等待通知**（approval-wait，alert 级桌面通知把人叫回终端选 y/esc——用户实测：审批弹窗期间任务静默暂停而用户不知情）。在场窗口降噪：PostToolUse 在网络/端口命令完成时刷新 `hooks-state.netport_last_exec_at`，默认 120s 内静默（刚批准/拒过 = 人在终端）。详见 §3.2 |

特征命令识别（lib/sandbox.mjs netPortKind）：引号感知段级匹配——网络类
（curl/wget/包管理器 install/git clone・fetch・pull・push/gh/docker pull…
含 setup-playwright.mjs --install 的子命令）与端口类（npm run dev/start/
preview/serve、npx vite/next…、python -m http.server、uvicorn…）。引号内的
`curl` 是搜索模式字面量不误报。SessionStart 注入「沙盒与权限」协议段作
会话级教育。

**Playwright 环境协议（frontend-e2e 技能 §3 的机器侧落点）**：

1. `node <插件根>/hooks/scripts/setup-playwright.mjs --check`——只读检测
   （包管理器 lockfile 探测 / @playwright/test 依赖 / 浏览器缓存目录 /
   本机 Chrome・Edge），任何阶段可跑（plan 模式白名单豁免该形态）
2. agent 把报告 + 三选项呈报用户等待抉择：**A** full（装包 + 下载 Chromium
   ~100–170MB）/ **B** chrome（仅装 npm 包，config `channel:'chrome'|'msedge'`
   复用本机浏览器，零浏览器下载）/ **C** skip（零网络，走降级路径）
3. `node <插件根>/hooks/scripts/setup-playwright.mjs --install <full|chrome|skip>
   --yes`——`--yes` 是用户抉择的显式凭证，缺省拒绝执行（exit 1）。幂等：
   已装/已缓存的步骤自动跳过。--install 属带副作用操作（写 package.json +
   网络），plan 模式仍拦、Stage 3b 起合法；执行时 Codex 沙盒拒网络则按
   三层联动协议请求授权。skip 降级：改用既有测试套件满足门禁或本机 Chrome
   CLI 自助取证（`chrome --headless --screenshot`，仅辅助证据不满足门禁），
   不得伪造测试结果

## 3. 会话生命周期（Session）

| 事件 | 行为 |
|------|------|
| **SessionStart** | **首次使用自动初始化**（幂等引导：state.json 全 schema + `.gitignore`/`.codexignore` 托管块；首次时注入声明）→ 作用域路由（见 4.1）→ 写 MCP 会话票据（见 4.5）→ 工件驱动阶段检测 → 写 scope 内 state/hooks-state → 注入工作空间提示 + 生命周期约定 |
| 会话中途 | hooks-state 去重记录按 scope 维护；**会话接管检测**：scope 上一次由其他会话使用（session_id 不符）→ 注入去重自动重置（防跨会话污染，规则注入幂等无害） |
| **SessionEnd** | 写 scope 内 session-end.json；会话快照存档 `.sdlc/sessions/<sid>-<stamp>.json`（保留最近 50 个）；**工件永不删除** |

会话快照是项目级归档（无论 scope），记录：会话 id、起止时间、最终阶段、
scope/任务、周期、hooks 统计——跨会话审计「谁在什么时候推进了哪个任务到什么阶段」。

### 3.1 首次使用自动初始化与版本控制边界（v0.10.0）

**自监测初始化（ensureProjectBootstrap，幂等）**：插件自行检测首次使用的项目——
用户无需执行任何 init 命令：

1. `.sdlc/state.json` 缺失 → 落盘全量默认 schema（common.defaultState 单一事实源）
2. `.git` / `.gitignore` 存在 → `.gitignore` 追加**托管块**（标记定界，幂等）
3. `.codexignore` 已存在 → 追加运行时文件忽略块（不含 artifacts/——工件必须可
   被 agent 读写）

触发时机：SessionStart 每次执行（幂等，兼存量项目治愈——老版本建的 `.sdlc/`
缺忽略块时补齐）；PostToolUse（工件写入置位 engagement 时）与 UserPromptSubmit
（MCP 首次调用/工件写入置位时）同样幂等补齐（覆盖后装 git 的项目）。CLI 侧
`sdlc.sh status/workflow/advance` 与 `init-project.sh` 调用同一实现
（`bootstrap-project.mjs`）。

**版本控制边界**（.gitignore 托管块）：

```
# >>> ai-sdlc workspace (runtime + artifacts, do not commit) >>>
.sdlc/*
!.sdlc/bands.yaml
!.sdlc/custom/
!.sdlc/hooks/
# <<< ai-sdlc workspace <<<
```

- **默认被忽略**：运行时状态（state/hooks-state/session-map/tasks/cycles/
  sessions/mcp-bind-queue/events/audit）+ 工件工作区（artifacts/ tasks/）+
  归档区（archive/）——「忽略 `.sdlc/*` + 白名单例外」使未来新增的运行时文件
  默认不进版本控制（逐文件列名的清单漂移正是 v0.9 init 块过时的成因）
- **白名单例外（建议提交）**：`.sdlc/bands.yaml`（CI 闭环节奏共享）、
  `.sdlc/custom/`（DIY 配置团队共享）、`.sdlc/hooks/`（生产门禁脚本）
- 用户删除托管块后，插件会在下次会话自动补齐（自愈）；确要提交工作区内容的
  例外场景用 `git add -f`
- 需要工件归档进 PR 可审查的仓库内归档链：`new_cycle({archive_dir:"docs/sdlc/archive"})`

### 3.2 回合结束通知与审批等待通知（v0.11.0；v0.13.13 扩展审批等待）

**目标**：使用者在 agent 工作期间可以离开终端；回合结束（任务完成或 Codex
需要用户输入/决策）或**回合进行中 Codex 弹审批提示**时，用系统级信号把人
叫回来，最大化等待时间利用。

**触发语义**（Stop hook，`lib/notify.mjs`）：

| 类别 | 判定 | 防噪 | 通知内容 |
|------|------|------|------|
| needs-input | fix_loop 中断（等四决策）或 planning/awaiting_answers（等发起者回答） | **不受阈值约束**——无用户输入即不推进，必达 | 「需要你的决策」/「等待你的回答」+ 轮次/问题数 + 决策通道 |
| turn-end | 其余回合结束 | 低于 `SDLC_NOTIFY_MIN_SECONDS`（默认 10s）不打扰 | 「回合完成」+ 阶段 + 耗时 +（任务模式）scope |

**触发语义**（PreToolUse，v0.13.13 审批等待通知——用户实测反馈：审批弹窗
「1. Yes, proceed (y) / 2. No (esc)」出现在回合进行中，任务静默暂停，Stop
通知覆盖不到）：

| 类别 | 判定 | 防噪 | 通知内容 |
|------|------|------|------|
| approval-wait | 放行的 Bash 命令命中网络/端口特征（`netPortKind`——curl / npm install / dev server 等，沙盒默认拦截 → 必触发审批或拒绝） | 在场窗口：`SDLC_NOTIFY_APPROVAL_PRESENCE`（默认 120s）内静默 | 「等待你的批准」+ y/esc 操作提示 + 所需权限类别 + 命令预览 |

- 在场窗口依据 `hooks-state.netport_last_exec_at`（PostToolUse 在网络/端口
  命令**完成**时刷新——无论成败：成功=用户刚批准或自动放行；被拒=用户刚
  拒绝或沙盒自动拒绝）——刚交互过 = 人在终端，不重复打扰；窗口外的等待
  重新通知（人可能又离开了）
- 与规则 0f 的 agent 教育文案去重**相互独立**：文案面向 agent 每会话一次
  即可；通知面向用户按在场窗口去重
- alert 级分发（needs-input 同类提示音 Funk——用户动作必需）；结果进审计
  （`detail.approval_notify`：via:xxx / presence-window / approval-off /
  disabled）
- 会话接管重置同 sandbox 字段语义（旧会话在场记录不抑制新会话首通知）

- 回合时长 = Stop 时刻 − `hooks-state.last_prompt_at`（UserPromptSubmit 每次落盘）；
  无记录（未经用户输入的回合）按保守策略通知
- needs-input 判定与 stop.mjs 注入门禁**同一表达式**（fix_loop && isEngaged /
  awaiting_answers）——不维护第二套判定，两处永保一致
- 通知结果进审计（`hook-audit.json` 的 `detail.notify`：notified / kind /
  reason / duration_ms）——「为什么没通知」可排障

**分发链**（全部 fire-and-forget：detached + stdio ignore + unref，绝不阻塞
hook；异步失败静默——通知是尽力而为，永不影响主流程与退出码）：

1. `SDLC_NOTIFY_CMD` 自定义命令（`{title}` / `{body}` 模板；子进程另获
   `SDLC_NOTIFY_TITLE` / `SDLC_NOTIFY_BODY` env，规避引号转义）
2. macOS（v0.13.8 重构，弹窗与声音两通道解耦）：
   - **弹窗**：自托管 applet（`ai-sdlc-notifier.app`）作为
     `display notification` 的宿主——首次通知时由 detached bootstrap
     （`notify-mac-setup.mjs`）用系统自带 `osacompile` 惰性生成于
     `$CODEX_HOME/sdlc-notifier/`（LSUIElement agent：无 Dock 图标、无
     窗口；bundle id `dev.cikaros.ai-sdlc-notifier`，版本标记对齐
     plugin.json，升版自愈重生成）。点击通知只激活本 applet（无参数
     运行即静默退出）——**不再打开 Script Editor**；降级链
     applet → applet-bootstrap → osascript 直发（保底，点击行为回
     Script Editor，仅在 osacompile 等系统组件异常时触达）
   - **声音**：`afplay` 独立派发（直接音频输出，不经通知中心——
     `sound name` 在 osascript 类宿主上经常静默不可靠）；needs-input
     类用专属音（`SDLC_NOTIFY_SOUND_MAC_ALERT`，默认 Funk）与 turn-end
     （`SDLC_NOTIFY_SOUND_MAC`，默认 Glass）区分紧急度；通知中心若把
     本 app 的通知关掉，弹窗不显示但声音仍会响（双通道容错）
3. Windows：`powershell.exe -File notify.ps1`（参数走 argv 不经 -Command，
   无注入面；Toast + 默认提示音，降级 msg.exe / SystemSounds；Toast
   未配置激活动作——点击仅消掉通知，无异常窗口打开）
4. Linux：`notify-send` + `canberra-gtk-play`（尽力而为）

**设计边界（诚实披露）**：Codex CLI 原生的工具审批弹窗发生在回合进行中，
hooks 六事件无对应时刻，插件层无法直接感知。v0.13.13 起以**预测式信号**
近似覆盖：网络/端口类命令（沙盒默认拦截 → 必触发审批或拒绝）在 PreToolUse
放行时通知。已知盲区：非网络类命令在其他审批策略（如 untrusted 全询问）
下的弹窗不可预测；自动放行策略下可能出现假阳性（在场窗口把连续假阳性压
缩到每窗口至多一次；不受打扰可 `SDLC_NOTIFY_APPROVAL=off` 整类关闭）。
焦点检测（终端是否前台）跨平台不可靠且部分实现需要辅助功能权限，故以
时长阈值/在场窗口近似「人在终端前」——快速问答回合不提醒即视为用户在场。
CLI 未来若提供 Notification 类事件，接线只需在 hooks.json 增一条目。

## 4. 多会话/多任务隔离

### 4.1 作用域路由（Scope Routing，四级优先级）

```
1. env SDLC_TASK        CI/脚本/多终端显式指定（最高优先级，任务须存在）
2. session-map 绑定      本会话此前绑定过任务 → 自动恢复（含 resume 场景续绑）
3. resume 续绑           SessionStart source=resume + 存在活跃任务 → 续绑活跃任务
4. legacy               项目默认空间（项目根工件 + .sdlc/ 状态，v0.4.0 行为）
```

**关键设计：新会话（startup/clear）不自动吸附活跃任务。** 防污染的核心——session A
在做 task-1 时，session B 启动默认工作在项目默认空间，互不可见、互不干扰；B 想协作
才显式说「切到任务 X」（`task_switch`）。SessionStart 会注入当前活跃任务清单与切换指引。

### 4.2 隔离边界

| 资源 | legacy 模式 | task 模式 | 隔离保证 |
|------|------------|-----------|---------|
| state.json（状态机/门禁/周期） | `.sdlc/state.json` | `.sdlc/tasks/<id>/state.json` | ✅ 任务间完全隔离 |
| 工件（intent/spec/plan/REVIEW） | `.sdlc/artifacts/`（存量根目录兼容检测） | `.sdlc/tasks/<id>/`（查找优先） | ✅ 任务间完全隔离 |
| hooks-state（注入去重） | `.sdlc/hooks-state.json` | `.sdlc/tasks/<id>/hooks-state.json` | ✅ + 跨会话接管重置 |
| hook-audit / events | `.sdlc/` | 任务目录 | ✅ 任务级审计流 |
| session-map / tasks.json / cycles.json | `.sdlc/`（全局） | 同左（全局） | 🔒 agent 禁改（block） |
| 会话快照 | `.sdlc/sessions/` | 同左（全局） | 项目级审计 |
| **业务代码工作区** | 仓库工作树 | 仓库工作树（同） | ⚠️ **不隔离**（见下） |

**代码工作区不隔离（如实声明）**：任务隔离的是 SDLC 工件与状态，不是源代码工作树。
同仓库并行多任务时，请为每个任务配 git 分支（每任务一分支也是 Stage 4/5 检测分支
条件的自然前提）。跨仓库场景应使用独立克隆。

### 4.3 会话亲和（Session Affinity）

- 绑定记录：`.sdlc/session-map.json`，`{ <session_id>: { task_id, bound_at } }`，
  LRU 上限 200 条
- 绑定动作：`task_create` / `task_switch`（写 session-map + tasks.json 活跃指针）
- 解绑动作：会话解绑或关闭绑定任务时自动解绑
- MCP 侧（v0.6.0 起）：每个 Codex 会话 spawn 独立 MCP 进程，通过会话票据认领实现
  同样的会话亲和（见 4.5）；两会话各自绑定不同任务时，MCP 路由互不可见

### 4.4 并发写安全

- 所有状态写入采用**原子写**（v0.9.0 起：`<file>.<pid>.<随机8hex>.tmp` + `O_EXCL`
  创建 + rename）：并发会话不会读到半写 JSON，且每个进程的 tmp 名必然不同——
  v0.5.1 共享固定名 tmp 的数据交叉竞态一并消除
- **符号链接预植入防御（v0.9.0）**：tmp 名不可预测 + `O_EXCL` 拒绝跟随已存在
  文件/符号链接 + rename 只替换目录项——封锁「实施阶段植入
  `.sdlc/state.json.tmp → 任意文件` 符号链接，等 hook 原子写跟随」的写保护绕过链；
  PreToolUse 运行时状态保护同步扩展 `.sdlc/**/*.tmp` 兜底。审计文件与 MCP 侧状态
  写同样原子化（MCP 侧 rename 失败时降级直写并留痕——hooks 侧无此回退）
- hooks 为串行进程调用，同会话内无并发；**跨会话并发操作同一任务**属于协作场景
  （用户自觉），state 读写为「读-改-写」，后写者胜并留有审计记录；审计写入经
  锁内读-合并-写（v0.10.0），并发 hook 收尾不互盖条目
- 工件级冲突（两会话同时写同一 spec.md）：工作区工件不入 git，以文件系统与锁
  为准；同一周期内的协作建议串行或分任务
- 其他上限：hook-audit 500 条、test_failures 50 条、cycles.json 200 条、
  会话快照 50 个、session-map LRU 200、票据孤儿 10 分钟清理、events.jsonl
  超 2 MiB 滚动（保留最近 5000 行）

### 4.5 MCP 会话上下文隔离

问题：stdio MCP 协议不携带会话标识——v0.5 的 MCP 路由用全局 `tasks.json.
active_task_id` 指针，多会话各自 spawn 的 MCP 进程共享同一指针，读写互相踩踏。

机制（票据配对 + 进程 pin + 写侧隔离）：

1. **票据**：SessionStart hook 每次启动向 `.sdlc/mcp-bind-queue/` 写一张会话票据
   （含 session_id；startup/resume/clear 均写，幂等）
2. **认领**：MCP 进程**首次工具调用**时从队列 FIFO 原子认领最旧一张（rename 抢占，
   并发进程只有一个成功）→ 进程内 pin 会话身份
3. **路由**：pin 后每次工具调用动态查 session-map（session_id → task_id）——
   会话绑定切换后 MCP 自动跟随；未绑定任务 → 会话在默认空间
4. **写侧**：pinned 会话下 `task_create` 只绑会话不动全局指针；`task_switch`
   默认只切会话绑定（`global: true` 才切全局指针）
5. **兜底**：所有工具接受可选 `task_id` 显式路由（最高优先）；`session_scope`
   工具可 show / bind / unbind 纠正进程配对

**路由优先级**：`args.task_id` 显式 > env `SDLC_TASK` > pinned 会话绑定 >
`active_task_id` 全局指针（无人认领时的 v0.5 兼容回退）> legacy 默认空间。

**配对原理**：每个 Codex 会话独立 spawn 一个本插件的 MCP 进程（stdio 1:1），
会话按顺序启动 → 票据按顺序入队 → MCP 进程按顺序认领。极端乱序（两会话同秒启动
且 spawn 乱序）可能错配，后果有限（可被 status 的 `scope_binding` 诊断发现 +
`session_scope bind` 或显式 `task_id` 纠正）。

**卫生**：孤儿票（会话从未调 MCP 工具 / clear 产生）由认领方 10 分钟超时清理；
票据队列受 PreToolUse 写保护（伪造票据 = 冒充其他会话的 MCP 路由，block）。

## 5. 运行时文件的写权限（与 write-policy.md 联动）

| 文件 | agent 写入 | 修改通道 |
|------|-----------|---------|
| `.sdlc/state.json`、`.sdlc/tasks/<id>/state.json` | 🔴 block | hooks / MCP 工具 / 用户编辑器 |
| `.sdlc/session-map.json`、`tasks.json`、`cycles.json` | 🔴 block（隔离索引，防污染） | hooks / MCP / 用户编辑器 |
| `.sdlc/tasks/<id>/task.json`、`hooks-state.json` | 🔴 block | hooks / MCP |
| `.sdlc/sessions/*.json`（会话快照） | 🔴 block（历史记录） | SessionEnd hook |
| `.sdlc/mcp-bind-queue/**`（会话票据） | 🔴 block（伪造 = 冒充会话路由） | SessionStart hook 写 / MCP 认领 |
| `.sdlc/**` 下其他（bands.yaml、工件、`*.tmp`/`*.lock` 等） | 见 write-policy.md 分级 | — |
| `.sdlc/tasks/<id>/intent.md` 等工件 | 🟢 放行（文档类） | agent 正常创作 |
| `.gitignore` / `.codexignore` 中的 ai-sdlc 托管块 | 🟢 hook 维护（标记定界）；agent 编辑走正常配置类分级 | 插件自愈补齐 |
| **fix_loop 中断期间的业务代码** | 🔴 block（文档/测试命令放行） | 用户决策（MCP `loop_resolve`）或测试真实通过 |
| `.sdlc/archive/**` 归档内容 | 🟡 warn（审计链，改写需说明原因） | hook/MCP 归档动作 |
| 项目根 / docs/ 下的文档 | 🟢 放行（新建阶段工件会触发落位提醒） | agent 正常创作 |

## 6. 典型场景速查

| 场景 | 操作 |
|------|------|
| 单需求走完 6 阶段后开始新需求 | 「开新周期」（`new_cycle`，旧工件归档，planning 重启） |
| 并行两个需求 | 「并行开个新任务」（各会话 `task_create`，各配 git 分支） |
| 昨天的会话继续今天的任务 | 直接恢复会话（session-map 自动恢复绑定）；或「切到任务 X」（`task_switch`） |
| 实施中发现 spec 要改 | `set_stage({ stage: "design" })` → 改 spec.md → 正常推进 |
| intent.md 有未回答的 Open questions | 在对话中向发起者提问并等待；回答后更新 intent.md → 自动推进；发起者明确跳过 → 经同意调 MCP `advance` |
| 两个会话各自驱动不同任务（MCP 隔离） | 默认隔离（票据配对）；status 的 `scope_binding` 可诊断；异常时 `session_scope bind` 或工具传 `task_id` |
| 误把 reset 当迭代入口 | 不要：reset 不清旧工件，阶段检测会立刻回到后期阶段；用 `new_cycle`（「开新周期」） |
| 任务彻底完结 | 「收尾这个任务」（`task_close`，归档工件 + 任务转 closed，目录留作审计） |
| 查询历史周期 | `mcp__sdlc-orchestrator__cycle_list` 或看 `.sdlc/cycles.json` |
| 实施完成想 push/提 PR | 先真实跑测试（未测试/未通过会被门禁拦）；项目无测试 → 补冒烟测试或经同意调 MCP `advance` |
| 测试失败暴露需求缺口 | 「开新周期」（`new_cycle`）归档当前周期，把失败作为 incident 写入新 intent.md |
| 同一失败反复出现（A→B→A） | 插件自动中断（fix_loop）→ 呈报证据等待用户决策（「重试一轮」→ `loop_resolve`） |

## 7. 反模式

- ❌ **自动删除工件**（任何 hook/脚本/agent 都不得做）——销毁审计链
- ❌ **新工件写入仓库根而非 `.sdlc/` 工作区**——污染版本控制树（PreToolUse 落位
  护栏 warn；存量项目根目录同名工件更新除外）
- ❌ **reset 当迭代入口**——不清旧工件，新周期被旧工件污染
- ❌ **新会话自动吸附活跃任务**——多会话互相污染
- ❌ **agent 手改 session-map/tasks.json/mcp-bind-queue**——污染隔离路由（block）
- ❌ **自问自答 Open questions**——问题属于发起者；agent 假设答案 = 未经确认的需求
- ❌ **伪造/改写 MCP 会话票据**——冒充其他会话的 MCP 路由（block）
- ❌ **改写归档历史不留痕**——审计链篡改（warn，说明原因）
- ❌ **未测试就 push/提 PR**——测试门禁拦截；测试是 playbook 的机械证据
- ❌ **循环中断后继续自动修**——fix_loop 期间改代码被阻断；先呈报用户等待决策
- ❌ **为解除 fix_loop 跳过/删除/弱化失败测试**——那不是通过，是表演
- ❌ **agent 手改 test_failures/fix_rounds/fix_loop**——循环证据在 state.json（block）
- ❌ **fix_loop 期间用 Bash 重定向/写类命令改代码**——与写操作类工具同拦
- ❌ **同任务多会话并发推进阶段而不自觉**——state 读-改-写后写者胜；协作请串行或分区
