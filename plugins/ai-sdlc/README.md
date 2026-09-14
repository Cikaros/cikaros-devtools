# ai-sdlc — AI-Native SDLC Plugin for Codex

> 把 Anthropic《AI-Native SDLC playbook》（方法学出处，非运行时依赖）翻译成可执行的
> Codex 插件。**核心目标**：无需用户显式注入任何信息即可走完 SDLC 全流程。
> 版本：v0.13.13 · 所属 marketplace：`cikaros-devtools` · 作者：Cikaros

## 为什么

Anthropic《AI-Native SDLC playbook》提出把传统 SDLC 的 6 个阶段
（Plan / Design / Build / Test / Deploy / Maintain）重构为由 AI 驱动的闭环：每个
阶段以一个工件结束，下一阶段读取该工件开始。playbook 是文档，不是代码——
**ai-sdlc** 把它翻译成可执行实现：

- **6 个 Codex 原生生命周期 hooks** 自动检测工件状态、推进阶段、注入规则
- **工件驱动状态机**——按工作区中已存在的 intent.md / spec.md / plan.md + git
  状态自动判定当前阶段
- **零显式注入**——不需要 @ 插件，自然语言提问即可（v0.13.0 起官方 CLI 不支持自定义 slash 命令，全部意图经「意图→工具映射」路由到 MCP 工具）；偏好显式调用可把
  18 份操作手册注册到用户 prompts 目录后用官方 `/prompts:sdlc-<名>` 调用——**v0.13.2
  起会话启动自动注册/刷新（零操作，升版自愈；卸载可 opt-out）**，手动刷新/卸载用
  MCP `register_prompts` 或 sh/ps1 平台脚本
- **MCP 启动链自定位（v0.13.3）**——`.mcp.json` 内联 bootstrap 四级解析链（`SDLC_PLUGIN_ROOT` > SessionStart 启动器指针（防投毒校验）> `CODEX_HOME/plugins` 扫描 > cwd），修复真实安装下相对路径 ENOENT 致 MCP server 起不来（openai/codex#19582/#22842）；PreToolUse 规则 0e 加固 shell 写通道（重定向/tee/mv 触碰运行时状态一律拦截，读取不误伤）。
- **hook 层环境自检 + 跨平台脚本护栏（v0.13.2）**——SessionStart 运行时探测真实
  shell 能力（bash/WSL/PowerShell）并注入环境画像；PreToolUse 能力感知拦截「注定
  失败」的脚本调用（裸 Windows 跑 .sh / 无 pwsh 的 macOS 跑 .ps1）并给出精确替代
  （ps1/sh 孪生脚本或 MCP 免 shell 通道），装了 Git Bash/WSL/pwsh 的环境不误伤
- **首次使用自动初始化**——插件自行监测新项目：首个会话即建 state 引导 +
  `.gitignore` 托管块，无需手动 init
- **工件工作区化**——intent/spec/plan/REVIEW 是任务推进的中间产物，存
  `.sdlc/` 工作区不进版本控制，任务/周期结束归档到 `.sdlc/archive/` 即可
- **Intent 提问闭环**——Open questions 必须先呈现给发起者并等待回答，未回答不推进
- **输入分流（v0.12.0）**——每条用户输入先三分类：需求/ISSUE 统一走 SDLC 流程；
  补充信息融入当前周期工件；临时任务不走流程——周期进行中登记 `quick_task` 队列
  队列**待周期走完后统一处理（二者不混淆）**，无周期则直接处理；分类协议由
  SessionStart 注入、每回合轻量提醒、Stop 防遗忘提醒三重保障
- **MCP 会话隔离**——多会话各自 spawn 的 MCP 进程票据配对，路由互不踩踏
- **测试门禁**——实施后必须真实测试；未通过不得 push / 提 PR / 报告完成
- **修复循环中断**——同失败签名重复（A→A / A→B→A）或轮次超限时阻断自动修复，
  交由用户四决策（retry / new-intent / manual / escalate）
- **frontend-e2e 技能**——Playwright 前端 E2E：标准命令计入 `test_runs`、
  `toHaveScreenshot` 视觉闭环、失败进循环熔断；内置反检测阶梯（L1 原生加固 →
  L2 真实 Chrome → L3 stealth，合规硬边界：仅限自有/授权目标、只改指纹不弱化断言）
- **回合结束通知**——任务完成或需要你决策/回答时系统弹窗+声音叫你回来
  （macOS / Windows / Linux，长任务必达、快答不扰；`SDLC_NOTIFY=off` 可关，
  详见 `docs/usage-guide.md`）

## 设计原则

1. **工件驱动**：阶段判定基于文件存在性 + git 状态，不依赖会话记忆；工件存
   `.sdlc/` 工作区（任务中间产物，不入版本控制）
2. **零显式注入**：SessionStart 自动检测阶段并完成首次初始化，
   UserPromptSubmit 按需注入规则
3. **门禁即代码**：plan 模式禁改业务代码（文档可写）、修复期禁改测试、生产部署需
   授权、运行时状态一律禁改——PreToolUse 强制（详见 `docs/write-policy.md`）
4. **闭环 + 生命周期**：maintain 产出新 intent.md → 旧周期归档（不删除，
   `.sdlc/archive/`）→ 回到 planning；迭代用 `new_cycle`，并行用
   `task_create`（自然语言触发，详见 `docs/lifecycle.md`）
5. **测试与循环防护**：未测试 push 硬拦、失败签名循环检测与用户决策通道
   （详见 `docs/lifecycle.md` §2.6）
6. **审计追踪**：工件链 + hook 审计 + 事件流
7. **零依赖**：纯 Node 18+，无 npm 依赖，离线运行

## 六阶段闭环

```
① Planning ──► ② Design ──► ③ Build ──► ④ Test
  intent.md      spec.md      plan.md     test-pass
                                                 │
⑥ Maintain ◄── ⑤ Deploy ◄──────────────────────┘
  incident        pr-merged
    │
    └─► 写新 intent.md ──► 回到 ①（cycle_count+1）
```

## 快速开始

```bash
# 1. 仓库根目录注册 marketplace（只做 marketplace add）
bash scripts/sh/install.sh

# 2. codex 会话内：/plugins 浏览 cikaros-devtools → 启用 ai-sdlc → /hooks 信任 hooks

# 3. 直接进入你的项目启动 codex 会话——无需手动初始化：
#    SessionStart hook 自动完成首次初始化（state 引导 + gitignore 托管块）
#    并注入「已自动初始化」声明；任意提问即可
```

> 手动预置模板（可选）：`bash ~/.codex/plugins/ai-sdlc/scripts/sh/init-project.sh`
> （复制 bands.yaml / REVIEW.md / AGENTS.md 模板；核心引导与 hook 自动初始化同源）。
> 安装/卸载脚本位于仓库根 `scripts/`，仅负责 marketplace 注册/移除；plugin 启用由
> 用户在 codex 会话内 `/plugins` 决定。

## 文件结构

```
plugins/ai-sdlc/
├── .codex-plugin/plugin.json      ← 插件清单
├── .mcp.json                       ← MCP server 配置（sdlc-orchestrator）
├── AGENTS.md                       ← 插件使用说明（Codex 读取）
├── hooks/
│   ├── hooks.json                  ← 6 个 Codex 原生 hooks 注册
│   └── scripts/
│       ├── session-start.mjs       ← 自动初始化 + 作用域路由 + 阶段检测 + 会话票据
│       │                              + 环境画像自检 + 手册自动注册（v0.13.2）+ MCP 启动器指针（v0.13.3）
│       ├── user-prompt-submit.mjs  ← 规则按需注入 + 反模式警告
│       │                              + 输入分流提醒 + 队列状态（v0.12.0/v0.13.0）
│       │                              + 生命周期状态条/等待接受提醒/接受意图识别（v0.13.11）
│       │                              + 沙盒拒绝回合提醒 1f（v0.13.12）
│       ├── pre-tool-use.mjs        ← 三层门禁强制 + 工件落位护栏
│       │                              + 跨平台脚本护栏（v0.13.2 能力感知）+ shell 写通道加固（v0.13.3 规则 0e）
│       │                              + 引号感知 shell 词法（v0.13.11）+ 受控接受 CLI 豁免
│       │                              + 沙盒授权预警规则 0f + 受控探测豁免（v0.13.12）
│       ├── post-tool-use.mjs       ← 工件监听 + 阶段推进 + 测试/PR/merge 检测
│       │                              + 沙盒拒绝证据检测/被拒测试不计数（v0.13.12）
│       │                              + 审批等待通知在场窗口刷新（v0.13.13）
│       ├── stop.mjs                ← 产出检查 + 门禁提醒 + 临时任务队列提醒
│       │                              + 回合结束通知 + 预览
│       ├── session-end.mjs         ← 会话快照归档
│       ├── bootstrap-project.mjs   ← 项目引导 CLI（自动初始化同源入口）
│       ├── accept-plan.mjs         ← 受控接受 CLI（v0.13.11：与 MCP accept_plan 同锁同语义；MCP 工具未暴露时的回退通道）
│       ├── setup-playwright.mjs    ← Playwright 受控安装 CLI（v0.13.12：--check 只读探测 + --install 三选项需 --yes 用户抉择凭证）
│       └── lib/
│           ├── common.mjs          ← 公共库桶导出（唯一导入面；v0.13.6 模块化重构）
│           ├── paths.mjs           ← L0 路径/作用域/ARTIFACT_CANDIDATES
│           ├── util.mjs            ← L0 stdin/JSON（BOM 安全）/文件工具/id 归一化
│           ├── atomic.mjs          ← L1 原子写底座 + 跨进程锁（mutateJsonFile）
│           ├── state.mjs           ← L2 状态机 schema + 状态 IO（read/write/mutate）
│           ├── audit.mjs           ← L2 审计（hook-audit）+ 事件总线（events.jsonl）
│           ├── bootstrap.mjs       ← L3 首次使用自动初始化（ignore 托管块）
│           ├── quicktasks.mjs      ← L3 临时任务队列（输入分流）
│           ├── prompts.mjs         ← L3 手册注册（ensurePromptsRegistered）
│           ├── mcplink.mjs         ← L3 MCP 会话票据 + 启动器指针
│           ├── cycles.mjs          ← L3 周期归档 + 新周期 + 会话快照
│           ├── testgate.mjs        ← L4 测试门禁 + 修复循环
│           ├── tasks.mjs           ← L4 任务索引 + 会话亲和 + 作用域路由
│           ├── env.mjs             ← 运行环境画像 + 跨平台脚本护栏（v0.13.2 纯函数）
│           ├── sandbox.mjs         ← 沙盒授权协作（v0.13.12：网络/端口命令特征 + 拒绝特征 + 注入文案）
│           ├── playwright-env.mjs  ← Playwright 环境探测纯函数（v0.13.12：包管理器/依赖/缓存/本机浏览器）
│           ├── notify.mjs          ← 回合结束通知 + 审批等待通知 v0.13.13（配置/构建/分发，fire-and-forget；在场窗口降噪）
│           ├── notify-mac-setup.mjs ← macOS 通知宿主 applet 惰性生成（v0.13.8，免 Script Editor）
│           ├── notify.ps1          ← Windows 通知端（Toast + 降级链，PowerShell 5.1）
│           └── stage-detector.mjs  ← 状态机核心
├── mcp/
│   ├── lib/mcp-lite.js             ← MCP 协议子集实现（行长护栏 1 MiB）
│   └── sdlc-orchestrator/
│       ├── index.js                ← 薄入口装配（bootstrap 拉起点；版本声明）
│       ├── server-state.js         ← 进程级可变上下文 S 容器（v0.13.6 拆分）
│       ├── context.js              ← ESM 桥 + 会话票据 pin/作用域路由 + 状态 IO + 阶段检测
│       ├── tools.js                ← 23 个 MCP 工具实现与定义（quick_task v0.12.0 / register_prompts v0.13.1）
│       └── README.md               ← 工具手册
├── prompts/                        ← 18 份操作手册（quick/task/cycle/loop-resolve 等，可注册为官方 /prompts: 形式）
├── skills/                         ← 7 个技能
│   ├── sdlc-{planning,design,build,test,deploy,maintain}/SKILL.md
│   └── frontend-e2e/               ← Playwright E2E + 反检测（references ×5）
├── rules/                          ← 6 份阶段规则 + review-policy.md + triage.md
│                                      （triage.md = 输入分流规则，v0.12.0）
├── templates/                      ← 9 份模板（intent/spec/plan/REVIEW/AGENTS/
│                                      bands.yaml + evals/agent-evals/production-gate）
├── spec/                           ← sdlc-baseline.md + artifact-contract.md
├── scripts/
│   ├── sh/
│   │   ├── init-project.sh         ← 项目级初始化器
│   │   ├── sdlc.sh                 ← CLI 入口（status/workflow/advance/audit/…）
│   │   └── install-prompts.sh      ← 手册注册（macOS/Linux 便利品；自动注册为主，
│   │                                  语义与 MCP register_prompts 同源）
│   └── ps/
│       └── install-prompts.ps1     ← 手册注册（Windows 便利品，v0.13.1 跨平台补齐；
│                                      误跑不匹配平台会被护栏拦截）
└── config.toml                     ← 参考（classic 模式已移除）
```

## 与 specflow 的关系

| 插件 | 定位 | 工作流模型 |
|------|------|-----------|
| specflow | 结构化文档驱动的工程化工作流 | 阶段状态机 + 标记驱动 TODO + 反模式检测 |
| ai-sdlc | Anthropic playbook 的可执行实现 | 工件驱动状态机 + 闭环 + 阶段门禁 |

两者可共存于同一项目（`.specflow/` 与 `.sdlc/` 平级）。specflow 偏工程化细节
（语言规范、TODO 标记、错误知识库），ai-sdlc 偏 SDLC 全流程编排。

## 依赖

- Node ≥ 18（hooks 与 MCP server；零 npm 依赖）
- Python 3（CLI 工具可选；缺失时降级）
- Codex CLI ≥ 0.142（插件系统与 hooks）

## License

MIT
