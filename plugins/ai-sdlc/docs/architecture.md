# Architecture

> ai-sdlc 插件架构概览。

## 组件

```
┌─────────────────────────────────────────────────────────────┐
│                     Codex CLI Session                        │
│                                                              │
│  6 Lifecycle Hooks (hooks/hooks.json)                        │
│    SessionStart → UserPromptSubmit → PreToolUse              │
│    [自动初始化+路由+阶段检测] [规则注入+反模式]  [门禁强制]   │
│    PostToolUse → Stop → SessionEnd                           │
│    [工件监听+推进]  [产出检查+通知]  [快照归档]                │
│                          ↕                                   │
│  State Machine (lib/stage-detector.mjs)                      │
│    + 共享库 lib/（12 领域模块经 common.mjs 桶导出, v0.13.6）  │
│    工件存在性 + git 状态 + .sdlc/state.json                   │
│    planning → design → build_plan → build_impl               │
│      → test → deploy → maintain → planning（闭环）           │
│                          ↕                                   │
│  MCP Server (mcp/sdlc-orchestrator/, 23 tools,               │
│    server-state/context/tools/index 四件套, v0.13.6)         │
│    status / workflow / advance / reset / refresh /           │
│    accept_plan / set_fix_mode / approve_release /            │
│    set_change_ticket / set_stage / new_cycle / cycle_list /  │
│    task_* ×4 / loop_resolve / session_scope /                │
│    self_review / audit / events / quick_task /                │
│    register_prompts（v0.13.2 起自动注册，显式通道）            │
│                          ↕                                   │
│  Env Guard (lib/env.mjs, v0.13.2)                            │
│    运行环境画像（能力探测：bash/WSL/PowerShell）              │
│    SessionStart 注入画像 · PreToolUse 拦截注定失败的          │
│    .sh/.ps1 调用并给出孪生脚本/MCP 替代                       │
│                          ↕                                   │
│  Turn-End Notifier (lib/notify.mjs + lib/notify.ps1, v0.11.0)│
│    Stop hook → 防噪判定 → 系统弹窗+声音                       │
│    (osascript / PowerShell Toast / notify-send, 脱钩执行)     │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                    Project Repository                        │
│  AGENTS.md                    （机构知识，进 git）            │
│                                                              │
│  .sdlc/                        （工作区，gitignore 托管块）   │
│  ├── artifacts/               （阶段工件——任务中间产物，     │
│  │     intent.md spec.md plan.md REVIEW.md   不入版本控制）  │
│  ├── archive/                 （周期/任务归档，cycle-meta）   │
│  ├── state.json / hooks-state.json / session-map.json        │
│  ├── tasks.json / cycles.json / tasks/<id>/                  │
│  ├── sessions/                （会话快照，保留 50 个）        │
│  ├── bands.yaml               （闭环节奏配置，白名单提交）    │
│  ├── custom/                  （DIY 配置，白名单提交）        │
│  └── events.jsonl / hook-audit.json                          │
└─────────────────────────────────────────────────────────────┘
```

## 代码组织（v0.13.6 模块分层）

两个曾经的巨型文件按领域拆分，依赖自上而下分层、无环。**导入面不变**：
hooks、MCP 的 ESM 桥与全部测试仍只 import `lib/common.mjs`（桶显式再导出）。

### hooks/scripts/lib/（12 领域模块 + 桶）

```
common.mjs（桶，唯一公共导入面——只再导出，无实现）
├─ L0 paths.mjs      插件/项目路径、scope 构造、ARTIFACT_CANDIDATES
├─ L0 util.mjs       stdin/JSON（BOM 安全）、hook 输出、文件小工具、id 归一化
├─ L1 atomic.mjs     原子写底座（O_EXCL + rename）+ 跨进程锁 mutateJsonFile
├─ L2 state.mjs      defaultState/isEngaged + scope 感知状态 IO + mutate 封装
├─ L2 audit.mjs      hook-audit.json（锁内合并，上限 500）+ events.jsonl 滚动
├─ L3 bootstrap.mjs  首次使用自动初始化（state 落盘 + ignore 托管块）
├─ L3 quicktasks.mjs 临时任务队列（输入分流，硬上限 100）
├─ L3 prompts.mjs    /prompts: 手册注册（register/ensure/opt-out）
├─ L3 mcplink.mjs    MCP 会话票据（FIFO 认领）+ 启动器指针
├─ L3 cycles.mjs     周期归档（归档轮转 + cycle-meta）+ 新周期 + 会话快照
├─ L4 testgate.mjs   测试门禁 + 修复循环（依赖 cycles：new-intent 决策归档）
└─ L4 tasks.mjs      任务索引 + 会话亲和（session-map LRU）+ resolveScope 路由
                       （依赖 cycles：closeTask 归档）
既有同目录模块：env.mjs（环境画像/脚本护栏）、stage-detector.mjs（阶段状态机）、
notify.mjs/.ps1（回合结束通知）——未参与本轮拆分。
```

### mcp/sdlc-orchestrator/（四件套）

```
index.js         薄入口：装配 runMcpServer（版本声明于此；bootstrap 拉起点）
server-state.js  进程级可变上下文 S 容器（lifecycle / ARTIFACT_CANDIDATES /
                 pinnedSession / currentScope / scopeBindingInfo——跨文件共享
                 的模块级可变状态收敛一处，属性赋值语义不变）
context.js       ESM 生命周期桥（common.mjs 单源）+ 会话票据 pin + 四级作用域
                 路由 + scope 感知状态 IO（X-lock 经桥同锁）+ 工件扫描/阶段检测
tools.js         23 个工具实现 + 工具定义表 + callTool 分发（新增工具三处
                 同文件就近维护：实现函数 / tools 表条目 / callTool 分支）
```

设计动机：v0.13.6 之前 common.mjs（1865 行）与 index.js（1365 行）承载全部
领域逻辑，任何修改都要在超长文件内定位上下文；拆分后每个模块 73–382 行、
职责单一、头注释即导读。行为零变更由 7 套测试回归背书（triage 71 /
regression 16 / round1 35 / round2 37 / round3 18 / round6 25 / smoke 8 场景）。

## 数据流

### 1. SessionStart（会话启动）

```
Codex 启动会话
  → session-start.mjs 读取 stdin JSON（cwd / session_id / source）
  → ensureProjectBootstrap（v0.10.0 幂等：state.json 全 schema +
     .gitignore/.codexignore 托管块；首次使用时注入声明）
  → resolveScope()（四级作用域路由，见 lifecycle.md §4.1）
  → 写 MCP 会话票据（.sdlc/mcp-bind-queue/）
  → detectStage()：工件扫描（多候选路径）+ state.json（override 优先）+ git 状态
  → 防回归守卫（保存阶段更靠后时保留）
  → 写 state.json / hooks-state.json（session_id 变化时重置注入去重）
  → additionalContext 注入：首次使用声明 + 工作空间 + 当前阶段 + 工件清单
     + 缺失工件 + 资源索引
```

### 2. UserPromptSubmit（用户输入）

```
用户输入 prompt
  → 每回合分流提醒 + 阶段规则按需注入；MCP 首次调用置 engaged（v0.13.0）
  → 反模式检测（正则匹配 prompt 文本）→ 直接注入警告
  → 阶段规则首次注入（hooks-state.injected_files 去重，40 行/1600 字符截断）
  → 缺失工件提醒 + 阶段语义提示 + 工件读取建议
  → Open questions / fix_loop 每回合提醒
  → token 预算检查（单次 2000 字符 / 累计 8000 估算 tokens）
  → hooks-state 落盘 last_prompt_at（v0.11.0：回合起点，Stop 通知的时长依据）
```

### 3. PreToolUse（工具调用前）

```
agent 调用 Bash / Edit / Write / apply_patch / MultiEdit
  → 文件分级（运行时状态 / 文档 / 机构知识 / 规格 / 归档 / 代码）
  → 规则匹配（详见 write-policy.md 矩阵）：
      规则 0   写运行时状态（含 *.tmp/*.lock） → 任何阶段 block
      规则 0b  fix_loop 中写代码 / 非测试 Bash → block
      规则 0c  工作区外新建阶段工件 → warn（落位护栏，v0.10.0）
      规则 1   build_plan 写代码 / 非只读 Bash → block*
      规则 2   build_impl + in_fix_mode 写测试 → block
      规则 3   deploy 无工单写迁移 → block
      规则 4   deploy 无授权跑生产部署命令 → block
      规则 4b  未通过测试 push/PR → block*
      规则 5   机构知识 / 规格漂移 / 归档 → warn
  → block: exit 2 + stderr 原因；warn: additionalContext；allow: {}
```

### 4. PostToolUse（工具调用后，异步）

```
agent 完成 Bash / Edit / Write / apply_patch
  → 工件文件落地检测（file_path 或 patch 内 Add/Update 目标，存在性校验）
      intent.md → planning 推进；spec.md → design 推进；
      REVIEW.md → deploy 推进；plan.md 需 plan_accepted
  → 首次工件写入置位 sdlc_engaged 时幂等补齐项目引导（v0.10.0）
  → intent.md 有未回答 Open questions → hold 在 planning/awaiting_answers
  → 测试命令识别（isTestCommand：多框架 + Playwright 全形态 + shell -c 引号负载）
      exit 0 → test_pass=true；失败 → 记录签名 + fix_rounds++ + 循环检测
  → git push / gh pr create → test→deploy；git merge / gh pr merge +
      release_approval → deploy→maintain
  → maintain 中新写 intent.md → 旧周期归档 + 闭环回 planning（cycle_count++）
  → 状态合并写回（门禁字段内存值优先）+ events.jsonl + hook-audit.json
```

### 5. Stop（agent 报告完成前）

```
stop.mjs 读取 stdin JSON
  → fix_loop 呈报提醒 / 测试门禁提醒（test_runs=0 或失败未收敛）
  → Open questions 门禁（列出问题清单）
  → 阶段产出检查（各阶段必需工件 / test_pass / last_deployed_at）
  → 人工关卡提示（产品负责人审查 intent/spec、工程师接受 plan、
      发布管理员授权部署、服务所有者分诊触发队列）
  → 下一阶段预览
  → 回合结束通知（v0.11.0，lib/notify.mjs）：needs-input（fix_loop/
      awaiting_answers，必达）或 turn-end（达防噪阈值）→ 系统弹窗+声音
      （脱钩 spawn，结果进审计 detail.notify）
```

### 6. SessionEnd（会话结束）

```
  → 写 scope 内 session-end.json + 项目级 .sdlc/sessions/<id>-<stamp>.json
    （保留最近 50 个，按 mtime 淘汰最旧）+ 事件与审计
```

> 超时约束：Codex 对 SessionEnd 有 3s 硬上限（见设计决策「为什么 SessionEnd
> 超时是 3 秒」），hooks.json 配置 `timeout: 3`，实测全流程 ~55ms。

## 状态机

```
planning ◄──────────────┐ 默认 / 闭环回到
  intent.md              │
  │ intent.md created    │ 新 intent.md created
  ▼                      │ (cycle_count++)
design                   │
  spec.md                │
  │ spec.md created      │
  ▼                      │
build_plan ◄─ PreToolUse: 禁改代码        │
  plan.md                │
  │ plan_accepted (MCP)  │
  ▼                      │
build_impl ◄─ PreToolUse: in_fix_mode 禁改测试
  diff+tests             │
  │ test command exit 0  │
  ▼                      │
test                     │
  test-pass              │
  │ gh pr create / push  │
  ▼                      │
deploy ◄─ PreToolUse: 迁移需工单/生产需授权
  pr-merged              │
  │ merge + release_approval
  ▼                      │
maintain ────────────────┘
  incident → 新 intent.md → 归档旧周期
```

## 设计决策

**为什么用文件存在性而不是显式状态？**
playbook 的核心洞察：**工件链 = 审计追踪**。文件存在性是阶段进度最可靠的证据
——不依赖会话状态、用户输入或网络。防回归守卫与 state.json 保存值弥补 git 状态
的瞬态性。

**为什么 hooks 而不是命令？**
命令需要用户显式调用——违反「零显式注入」承诺。hooks 在生命周期的固定点
自动触发。v0.13.0 起官方 CLI 不支持自定义 slash 命令，交互统一为自然语言→
MCP 工具（SessionStart 注入意图→工具映射）；偏好显式调用的用户可把 18 份
prompts/ 操作手册注册到用户 prompts 目录，用官方 `/prompts:<name>` 调用——
**v0.13.2 起注册本身也零操作**（SessionStart 自动注册/刷新，升版自愈；
卸载 opt-out；`SDLC_PROMPTS_AUTO=off` 总关），手动刷新/卸载经 MCP
`register_prompts`（Node fs，三平台一致）或 sh/ps1 平台脚本（语义同源，
hooks/scripts/lib/ 模块群经 common.mjs 桶导出，单一事实源）。

**为什么能力探测而不是按 OS 一刀切？**（v0.13.2 env.mjs）
裸 Windows 跑 `.sh` 会报错，但装了 Git Bash/WSL 的 Windows 跑 `.sh` 完全
正常；macOS/Linux 装了 pwsh 也能跑 `.ps1`。按 OS 判断会误伤真实环境，
按文件扩展名判断同样不准。hook 层在运行时探测真实能力（PATH 扫描 +
常见落点，< 1ms）——SessionStart 把「本机不可用的脚本形态」直接告知
agent，PreToolUse 兑底拦截注定失败的调用并给出孪生脚本/MCP 免 shell
替代：错误在前端被拦下，而不是留给用户看晦涩报错。

**为什么 .mcp.json 是内联 bootstrap 而不是相对路径？**（v0.13.3 MCP 启动链）
Codex spawn 插件 MCP 子进程时以**用户启动目录**为 cwd，`.mcp.json` 的相对
args 按该 cwd 解析，且不插值 `${VAR}`、不注入 `PLUGIN_*` 环境变量
（openai/codex#19582 实测、#22842 确认）——相对路径
`./mcp/sdlc-orchestrator/index.js` 在真实插件安装下 ENOENT，MCP server
根本起不来（本地开发 cwd=插件根的场景侥幸可用，掩盖了该缺陷）。
方案：`.mcp.json` 改为 `node -e <内联 bootstrap>`（约 1230 字符单行，
JSON 安全：单引号、无反斜杠、无双引号免转义），自定位插件根后
`require(<plugin_root>/mcp/sdlc-orchestrator/index.js)`（被 require 的
index.js `__dirname` 自定位依旧成立，零改动）。四级解析链：

| 优先级 | 解析源 | 说明 |
|---|---|---|
| 1 | `SDLC_PLUGIN_ROOT` env | 显式覆盖（用户/CI 诊断通道） |
| 2 | `.sdlc/mcp-launcher.json` 指针 | SessionStart hook 幂等写入（原子写 + 版本自读 plugin.json）；**防投毒**：指针指向的 plugin_root 必须位于 `CODEX_HOME/plugins` 之内才采信 |
| 3 | `CODEX_HOME/plugins` 两层扫描 | 兜底：`plugins/<plugin>` 与 `plugins/<marketplace>/<plugin>` 两种布局 |
| 4 | 进程 cwd | classic 回退（cwd=插件根的本地开发布局） |

全部落空 → stderr 一行修复指引 + exit 1。`SDLC_BOOTSTRAP_PROBE=1`
探针模式只输出解析结果不启动 server（测试/诊断）。指针文件
`mcp-launcher.json` 受 PreToolUse 写保护（RUNTIME_STATE_RES）——它是
MCP 加载路径的锚点，agent 篡改 = 重定向 MCP server 加载路径（配合防投毒
校验双保险）。SessionStart 写指针失败不阻塞会话：注入一行修复提示 +
事件留痕（MCP 不可用可自愈：重启会话重写指针）。

**为什么共享状态要跨进程锁？**（v0.13.5 并发模型）
插件有三类并发写者：hook 进程（每次工具调用 spawn 一个、生命周期毫秒级）、
MCP server（常驻进程）、Codex 并行工具调用（一次响应可同时发出 Bash 与 MCP
调用 → 两类写者真正同时运行）。原子写只防「读到半写文件」，防不了两个进程
都读到合法旧值、各自修改、后写者覆盖前写者——v0.13.4 的审计锁只覆盖
hook-audit.json，state.json / tasks.json / quick-tasks.json / session-map.json /
cycles.json 的读-改-写全部裸奔（实测 10 并发丢 3/10 字段）。
方案：`lib/atomic.mjs mutateJsonFile` 把审计锁机制（O_EXCL lockfile + 过期清理 +
退避重试 + 降级直写兜底）泛化到任意状态文件——hooks 侧直接调用，MCP 侧经
ESM 桥调用同一函数（两端同一把 `<file>.lock`）。锁序无嵌套（所有 mutator
内不再获取其他锁），降级语义与审计锁一致：极端竞争超预算 → 无锁执行
（丢单次合并不丢文件），绝不死锁。推进类写入（advanceStage / toolAdvance）
锁内幂等重验：并发推进只有一个生效，第二个看到 cur=next 直接跳过。
`.lock` / `.tmp` 文件受 PreToolUse 运行时状态保护（v0.10.0 起的既有覆盖），
agent 无法删除持有中的锁破坏互斥。

**为什么 JSON 读取要剥 BOM？**（v0.13.5 W-bom）
状态文件由插件自己写入（无 BOM），但用户侧 Windows 工具链（编辑器查看后
保存 / PowerShell 5.1 Out-File）会在文件头写入 UTF-8 BOM——JSON.parse 对
BOM 直接抛异常，读侧容错把状态读成 null：sdlc_engaged 静默丢失、阶段回
planning、门禁误报。防御成本一行（charCodeAt(0) === 0xFEFF → slice(1)），
hooks 端（safeJsonParse / readCodexState / readGlobalJson）与 MCP 端
（readTaskIndex / readState / readHooksState / audit）全部覆盖。

**为什么注入前要消毒磁盘可控字段？**（v0.13.5 I-inject）
`.sdlc/` 可能随仓库分发（克隆即落地）——quick-tasks.json 的 desc/id 属
「磁盘可控内容」：换行可伪造「- 」开头的 hook 指令行（在注入上下文里冒充
插件指令），反引号可逃逸行内代码包裹。stop.mjs 注入队列字段前统一消毒：
控制字符/换行折叠为空格 + 「- [xxx]」指令模式中和 + 长度截断 + id 白名单
[A-Za-z0-9_-]——投毒内容保留可读性（提醒功能不受损）但无法伪造指令结构。

**为什么 SessionEnd 超时是 3 秒？**（v0.13.7 Codex 对齐）
Codex hooks engine（codex-rs `hooks/src/engine/discovery.rs` 的
`normalize_command_hook`）对 SessionEnd/Interrupt 事件有硬上限
`SESSION_END_MAX_TIMEOUT_SEC = 3`（不配默认 1s，且低于 app-server 关停
超时——SessionEnd 在关停窗口内同步执行）；配置超过 3s 会被钳制并在启动时
打警告 `clamping SessionEnd hook timeout to 3s`，其余事件默认 600s 无上限。
v0.13.6 及以前本插件误配了 10s，导致每次启动 Codex 都警告一次。实测
session-end.mjs 全流程约 55ms（含多次状态读 + 原子写 + 事件/审计锁），
3s 预算留有量级余量；写入全部原子（O_EXCL + rename），极端情况下 3s 被杀
也只是丢当次快照、不损坏状态。**注意：不能把该值调回 >3**（会重新触发
启动警告）；specflow 插件同字段自始就是 3。

**为什么门禁用「保存值∪检测值」的并集阶段判定？**（v0.13.10 全流程模拟排错）
git diff 是瞬态的：测试通过并提交后，基于「有 diff」的 test/deploy 检测跌回
build_impl（plan+accepted），但保存值（state.current_stage）仍在 test/deploy。
若门禁只看检测值，规则 3（迁移工单）/ 规则 4（生产授权）/ 规则 2（修复期
禁改测试）会在「已提交」窗口静默失效——恰是 agent 准备部署动作的时刻。
规则 4b（push 门禁）v0.7.0 已采用并集（`new Set([state.current_stage,
detection.stage])`），v0.13.10 把 2/3/4 与 Stop 测试门禁提醒统一到同一语义：
任一侧命中即拦（宁严勿漏）。显示侧（SessionStart/Stop/UserPromptSubmit 的
阶段呈现）则相反——用「有效阶段 = 检测值与保存值中更靠后者」，保证注入的
阶段/人工关卡/下一阶段预览与真实所处阶段一致；守卫生效时来源行显示
`stage-guard(saved-newer)`（含原始检测值供排障），不再混显另一阶段的
子阶段（实测曾产出「Stage 6 Maintain + 子阶段 implementation」矛盾注入）。

**为什么未提交的 .gitignore 不算业务 diff？**（v0.13.10）
ensureProjectBootstrap 在全新项目首会话自建 `.gitignore`/`.codexignore`
托管块——它们以未跟踪（porcelain `??`）形态出现在 git status。若计入
hasDiff，plan.md 落地后 detectStage 直接误判 Stage 4 TEST：规则 1（plan
模式禁改代码）按 detection.stage 判定而失效，Stop 错报测试门禁与错误
人工关卡。过滤面精确到「根级 + `??` 状态 + 三个忽略文件名」——用户对已
跟踪 .gitignore 的真实修改（` M`）仍计入 diff。这是 E2E 模拟器（scripts/
e2e-fullflow.mjs）暴露并回归锁定的缺陷。

**为什么 PreToolUse 而不是事后审计？**
playbook："skills 使违规罕见，hooks 使其几乎不可能"。事后审计只能发现问题，
PreToolUse 能阻止问题（plan 模式禁改代码、修复期禁改测试是硬约束）。

**为什么 MCP server 而不是直接读文件？**
某些操作需要**显式的人工关卡**（playbook 治理要求）：工程师接受 plan.md
（`accept_plan`）、发布管理员授权（`approve_release`）、变更工单（`set_change_ticket`）。
这些操作需要记录接受者身份与时间戳，MCP 工具提供受控接口与审计。

**为什么零依赖？**
插件运行在用户机器上，网络受限。零 npm 依赖：安装快、离线可用、无供应链风险；
Node 18+ 内置 API 足够（含原子写 O_EXCL、crypto 随机后缀、stdio 行分帧）。

**为什么通知在 Stop hook 而不是独立进程常驻监听？**
回合结束是 hooks 事件流中唯一确定可观测的「控制权交还用户」时刻；常驻进程
（轮询事件总线）与之相比要新增生命周期管理、资源占用与卸载清理，换不来
更早的触发。通知子进程全部脱钩（detached + unref），hook 本身零阻塞；
防噪阈值近似「人在终端前」（快速问答不提醒），避免跨平台焦点检测的
权限与可靠性债务。详见 lifecycle.md §3.2。

**为什么 macOS 通知用 applet 宿主 + afplay 双通道？**（v0.13.8 通知交互重构）
用户实测暴露旧实现两个缺陷：① `display notification ... sound name` 的
声音经常不响——通知中心对 osascript 类宿主的声音播放不可靠（依赖 app
通知注册策略，实测静默）；② 点击通知会打开 Script Editor——osascript CLI
执行的通知，宿主归属 AppleScript Editor bundle，系统「激活通知来源 app」
的默认动作即打开它。重构为两通道解耦：
- **弹窗通道**：用系统自带 `osacompile` 惰性生成自托管 applet
  （`$CODEX_HOME/sdlc-notifier/ai-sdlc-notifier.app`，LSUIElement agent
  无 Dock 图标/无窗口；bundle id 归一 `dev.cikaros.ai-sdlc-notifier`），
  `display notification` 由 applet 进程执行——宿主即本 applet，点击通知
  只激活它（run handler 无 argv 静默退出），什么都不打开。版本标记写入
  Info.plist（CFBundleGetInfoString，版本自读 plugin.json 单一事实源），
  升版自愈重生成；mkdtemp + rename 原子落位防并发双写。降级链
  applet → detached bootstrap（首条通知延迟 ~0.5s）→ osascript 直发
  （保底，接受 Script Editor 行为——仅系统组件异常时触达）。
- **声音通道**：`afplay` 独立派发（直接音频输出，完全绕过通知中心），
  必达；通知本身不带 `sound name`（避免与 afplay 双声竞态）。needs-input
  类用专属音（默认 Funk）与 turn-end（默认 Glass）区分紧急度——
  「等你决策」比「回合完成」更值得被打断。
生成/执行全在脱钩子进程（notify-mac-setup.mjs），Stop hook 主流程零阻塞；
通知链路不依赖 .sdlc/ 状态体系（notify.mjs 仅 node 内置），通知是尽力而为。
Windows Toast 未配置激活动作（点击仅消掉通知），Linux notify-send 同理
——三平台点击行为均无异常窗口。

**为什么 plan 接受需要 CLI 回退通道？**（v0.13.11 接受通道轮）
用户实测死锁链：会话未暴露 mcp__sdlc-orchestrator__* 工具（MCP server 未随
会话启动）时，记录「工程师已接受 plan」没有任何合法路径——手改
`.sdlc/state.json` 被规则 0 拦截（信任锚点保护，正确），Bash 通道被 plan
模式只读白名单拦截（accept 是写语义，也正确）——两个正确的门禁合成了
死锁。设计取舍：
- **回退而非放行**：不给 agent 写 state 的口子（自我授权风险不变），而是
  新增一个**语义受限**的受控入口（accept-plan.mjs）——只做一件事
  （置位 + 推进），走与 MCP 工具完全相同的 mutateCodexState 锁与幂等重验，
  事件留痕 `via: cli:accept-plan` 与 MCP 通道（`via: mcp:accept_plan`）同
  事件名可审计。威胁模型与 MCP 工具一致：两者都信任 agent 只在用户明确
  表达接受后调用（行为约束，非技术约束）。
- **豁免面最小**：PreToolUse 规则 1b 只对两种**精确路径**形态段级豁免
  （`node <PLUGIN_ROOT>/hooks/scripts/accept-plan.mjs` /
  `bash <PLUGIN_ROOT>/scripts/sh/sdlc.sh accept`）——路径必须等于插件安装根
  （防伪造同路径名脚本）；仅 accept 子命令（advance/reset 可跳过产出与门禁
  检查，不接受经 Bash 通道代劳）；豁免是段级的（`accept && rm -rf x` 仍拦
  在 rm 段）；fix_loop 中断期（规则 0b）不传豁免（中断期等待用户决策，
  语义不兼容）。
- **为什么不是 hook 自动接受**：UserPromptSubmit 检测到「接受」时直接写
  state？自然语言理解属于 agent（「不接受」「同意之前先补测试」的正则
  判别不可靠）；hook 误判的代价是静默的阶段推进。hook 只做**提示**
  （保守高精度意图识别 → 注入明确指令），状态变更由受控入口落地——
  判定与执行分离。

**为什么每回合注入生命周期状态条？**（v0.13.11 记忆锚点轮）
长会话的上下文压缩会冲掉一次性注入（阶段规则/阶段语义/意图→工具映射都是
首入去重的），agent 在压缩后丢失「现在在哪、卡在哪、下一步做什么」——
用户实测正是因此卡死在 plan 接受门禁。三个设计点：
- **每回合而非按需**：去重注入对压缩无免疫力；状态条不进去重、每回合
  注入（~60 token），是唯一可靠的跨压缩记忆锚点。门禁类提醒
  （awaiting_answers/fix_loop/awaiting_acceptance）同理每回合注入——
  v0.6.0/v0.7.0 已为前两者建立该模式，v0.13.11 补齐第三者并把位置记忆
  泛化到全阶段。
- **紧凑两行而非完整状态**：位置（阶段+子阶段+scope+闭环数）+ 下一步
  （门禁优先）。完整状态有 MCP status 工具，注入面按 token 预算约束
  （SINGLE/CUMULATIVE_LIMIT）；essentials 过滤把状态条与门禁提醒列为
  超额保留项——预算再紧，记忆锚点不丢。
- **门禁分支按有效阶段守卫**：状态条的 awaiting_* 提示只在检测值即有效
  阶段时呈现（v0.13.10 并集语义）——保存值更靠后（提交后检测跌回）时
  按 saved 阶段的下一步呈现，不产生「deploy 阶段却提示等接受」的矛盾注入。

**为什么沙盒授权要三层联动而不是单一拦截？**（v0.13.12 沙盒协作轮）
Codex 沙盒拦截网络/端口是**平台机制**，插件无法也不应替沙盒做决定——能做
的是让 agent 在正确的时机采取正确的动作（请求用户授权）。三层各司其职：
- **预防（PreToolUse 规则 0f）**：网络/端口命令放行前注入应对协议
  （每会话去重一次）。warn 而非 block——命令本身合法（Stage 3b 装
  依赖/起 dev server 是本职操作），拦了反而制造死锁；agent 需要的是
  「被拒后怎么办」的先验知识，不是事前禁止。
- **取证（PostToolUse）**：失败输出命中特征才记 sandbox_denied——
  预防层覆盖不了未知形态（新包管理器/新 dev server 命令形态），证据层
  兜底。关键副产物：**被拒的测试命令不计失败轮次**——沙盒拒绝是环境
  授权问题不是代码问题，计入会把 fix_loop 引向「修不存在的 bug」。
- **提醒（UserPromptSubmit 1f）**：PostToolUse 是 async hook，输出不进
  上下文——拒绝信息必须经 hooks-state 中转，下回合注入并呈现一次即
  清除。每条拒绝恰好提醒一回合：不重复打扰，也不在压缩中丢失
  （回合级注入与 0b/1e 同为压缩免疫锚点）。
误报方向权衡：弱特征（EPERM/ENOTFOUND…）仅网络/端口类命令记——普通文件
权限错误不进沙盒提醒；引号内的 `curl` 是搜索模式不触发预警（词法引号
感知与 v0.13.11 bash 门禁同款语义）。

**为什么 Playwright 安装要受控脚本 + 用户抉择？**（v0.13.12 环境协议）
`npm install -D @playwright/test && npx playwright install chromium` 现场裸跑
有两个独立问题：① **越权**——下载 100–170MB 浏览器二进制是用户资源决策，
agent 自作主张不符合「人工关卡」治理理念；② **撞沙盒**——安装是网络命令，
Codex 沙盒默认拒绝，agent 缺引导时易陷入重试循环。设计：
- **--check / --install 分离**：检测只读（任何阶段可跑，plan 模式白名单
  豁免），安装带副作用（Stage 3b 起）。agent 能在 plan 阶段评估测试方案
  却不能提前装依赖——与 plan 门禁的阶段语义精确对齐。
- **--yes 显式凭证**：脚本层面强制「用户已抉择」——agent 忘记询问时
  脚本拒绝执行（exit 1），双保险（SKILL 协议 + 脚本强制）。
- **chrome 备选通道**：本机 Chrome/Edge 经 `channel:'chrome'|'msedge'`
  复用（Playwright 官方机制），零浏览器下载——网络受限环境的最优解；
  测试语义与门禁识别完全不变（与 anti-detection L2 通道同一机制，
  双重价值）。skip 降级明示「不满足门禁」的边界：chrome --headless CLI
  取证只是辅助证据，防伪造 test_pass。
- **幂等步骤裁剪**：已装包跳装包、缓存已有 chromium 跳过下载——
  重复执行无害，失败重跑不重复付费。

**为什么审批等待通知用预测式信号而不是等审批事件？**（v0.13.13 通知轮）
用户实测反馈：Codex 审批弹窗（`1. Yes, proceed (y) / 2. No (esc)`）出现在
**回合进行中**——任务静默暂停，而 Stop hook 只在回合结束时通知——这是
v0.11.0 通知体系留在 notify.mjs 头注里的已知盲区（hooks 六事件无
「等待审批」时刻）。设计选择：
- **预测式而非感知式**：审批弹窗何时出现由 approval_policy 决定（插件
  不可见），但网络/端口类命令在默认沙盒（workspace-write）下**必然**
  触发审批或拒绝——PreToolUse 命中 netPortKind 即发通知，置信度足够高
  且时机正确（hooks 完成后弹窗才出现）。on-failure 流程下通知略早于
  弹窗（命令先在沙盒内跑失败再问）——可接受，人被叫回的语义不变。
- **在场窗口而非去重表**：审批等待没有自然终止时刻（用户不答就永远
  挂着），「同一命令只通知一次」会在 agent 重试同命令时漏掉真实等待。
  PostToolUse 在网络/端口命令**完成**时（无论成败）刷新
  `netport_last_exec_at`——刚完成 = 用户刚在弹窗上选过（y 或 esc，人在
  终端）或该环境自动放行（无弹窗，同时压制前一次预测的假阳性）；窗口
  外的新等待重新通知（人可能又走了）。比命令哈希去重更贴近「人在不在」
  这个本质变量。
- **与 agent 教育文案去重解耦**：规则 0f 文案面向 agent（每会话一次
  足够——记住协议即可）；通知面向用户（按在场窗口）——两套受众两套
  防噪，不共享去重状态。
- **诚实披露残余盲区**：非网络命令在严格审批策略（untrusted 全询问）
  下的弹窗不可预测；自动放行策略下有假阳性（在场窗口压缩到每窗口至多
  一次，`SDLC_NOTIFY_APPROVAL=off` 整类可关）。CLI 未来提供 Notification
  类事件时接线只需在 hooks.json 增一条目，预测层可即时退役。
