# 文档写入保护策略（Write Protection Policy）

> ai-sdlc v0.4.0 起生效（v0.5.0 任务隔离扩展、v0.6.0 票据队列扩展、v0.9.0 tmp
> 兜底扩展、**v0.10.0 工件落位护栏与 .lock 扩展**）。本文件是 PreToolUse 门禁的**权威标准**：哪些文件允许编辑、哪些不允许、
> 在什么条件下不允许。hook 代码（`hooks/scripts/pre-tool-use.mjs`）是本策略的
> 可执行形式，两者语义一一对应。

> v0.13.5 并发写序：插件侧对共享状态文件（state.json / tasks.json /
> quick-tasks.json / session-map.json / cycles.json / hook-audit.json）的
> 全部读-改-写经跨进程 O_EXCL 锁（`<file>.lock`）串行化——hooks 进程与
> MCP 常驻进程同锁同源（lib/atomic.mjs mutateJsonFile，经 ESM 桥复用）。`.lock` / `.tmp`
> 同属 PreToolUse 运行时状态保护范围（agent 禁改禁删）。

## 1. 设计原则

Anthropic《AI-Native SDLC playbook》对门禁的原始要求是约束**代码**，而不是约束**文档**：

- "Codex 在工程师接受计划前无法编辑代码"——约束对象是业务代码
- "设计评审发生在任何代码生成之前——此时改变方向只是编辑文档的问题"——编辑文档
  正是计划/设计阶段的正当操作，是这些阶段的**本职产出**
- "修复代码的代理不能削弱对该代码的检查"——约束对象是测试代码
- 机构知识（AGENTS.md 等）的修改应经代码所有者审查——提醒而非阻断

因此 v0.4.0 之前的实现（plan 模式下除 `plan.md`/`docs/`/`.sdlc/` 外一律 block，
连 README.md、CHANGELOG.md、design/*.md 等文档也被拦）属于**过度拦截**，v0.4.0 起
按以下三层模型纠正。

## 2. 第一层：文件分级（任何阶段生效）

| 级别 | 类别 | 覆盖范围 | 写入行为 |
|------|------|---------|---------|
| 🟢 | 文档类 | `*.md` `*.markdown` `*.txt` `*.rst` `*.adoc` `*.org` `*.tex` 等纯文档扩展名；无扩展名的 `README`/`CHANGELOG`/`LICENSE`/`CONTRIBUTING` 等已知文档名 | **放行**（任何阶段，包括 plan 模式） |
| 🟢 | 插件工作区 | `.sdlc/` 下除状态文件外的一切（`bands.yaml` 自定义、`artifacts/` 工件、`tasks/<id>/`、`custom/` 等） | **放行**（工作区不入版本控制，见 lifecycle.md §3.1） |
| 🟡 | 机构知识类 | `AGENTS.md` / `CLAUDE.md` / `REVIEW.md` / `CURSOR.md` / `copilot-instructions.md`（按文件名匹配，任意目录） | **放行 + warn**（提示走所有者审查/PR 流程） |
| 🟡 | 阶段规格类 | `spec.md` / `intent.md` / `plan.md`——在 **build/test/deploy 阶段被编辑**时 | **放行 + warn**（需求漂移提示：需求变更应回 design 阶段走变更流程并同步 plan.md） |
| 🔴 | 运行时状态类 | `.sdlc/state.json`、`hooks-state.json`、`merged-config.json`、`session-map.json`、`cycles.json`、`tasks.json`、`quick-tasks.json`（v0.12.0 临时任务队列）、`mcp-launcher.json`、`session-end.json`、`prompt-trace.json`、`hook-audit.json`、`events.jsonl`（v0.13.3 与 .codexignore 托管块对齐）、`.sdlc/tasks/<id>/{state,hooks-state,task}.json`、`.sdlc/sessions/*.json`、`.sdlc/mcp-bind-queue/**`、**`.sdlc/** 下任意 `*.tmp` 与 `*.lock`** | **block（任何阶段、任何项目；v0.13.3 起同时覆盖 Edit/Write 通道与 shell 重定向/写命令通道）** |
| 🟡 | 工件落位护栏（v0.10.0） | 在 `.sdlc/` 工作区外**新建** `intent.md`/`spec.md`/`plan.md`/`REVIEW.md`（存量同名工件更新除外） | **放行 + warn**（提示写入 `.sdlc/artifacts/`——工件是任务中间产物，不入版本控制） |
| 🟡 | 周期归档类 | `.sdlc/archive/**`（默认）、`docs/sdlc/archive/**`（历史兼容） | **放行 + warn**（审计链：改写历史应说明原因） |
| 🔵 | 业务代码类 | 源代码（js/ts/py/go/rs/java/…）、构建清单（package.json/Cargo.toml/Makefile/Dockerfile/…）、运行时配置（toml/yaml/ini/env/json/…）、脚本（sh/ps1/bat）、SQL、迁移 | **受第二层阶段门禁约束** |
| ⚪ | 未识别类 | 无扩展名杂项、图片、二进制等 | plan 模式下**放行**（白名单式拦截原则：只拦已知代码类，不拦未知） |

**为什么 `.sdlc/state.json` 一律禁止 agent 编辑？** 它是门禁的信任锚点——
`plan_accepted` / `test_pass` / `release_approval` / `change_ticket` 等授权标志全部
存放于此。agent 若能手工编辑它，就等于**自我授权**绕过全部阶段门禁。隔离索引
（`session-map.json` / `tasks.json` / `cycles.json`）同样 block：agent 改写等于污染
隔离（生命周期标准见 `docs/lifecycle.md`）；`quick-tasks.json`（临时任务队列）block：
agent 手改等于伪造排队状态——经 MCP `quick_task` 受控修改（用户亦可在编辑器中直接改）。因此状态变更只能通过受控通道：

1. **hook 自动维护**（stage-detector / post-tool-use，直接 fs 写入，不经工具调用管道）
2. **MCP 受控工具**（`accept_plan` / `set_fix_mode` / `approve_release` /
   `set_change_ticket` / `set_stage` / `new_cycle` / `task_*` / `quick_task`，语义明确、留有审计记录）

用户本人仍可在编辑器中直接手工编辑（人类操作不经过 agent 工具调用，hook 不拦截）。

**v0.13.3 补齐 shell 写通道（规则 0e）**：上述 block 此前只覆盖
`Edit`/`Write`/`apply_patch`/`MultiEdit` 的 `file_path`/`patch` 通道，
`echo ... > .sdlc/state.json`、`cat x | tee .sdlc/session-map.json`、
`mv .sdlc/mcp-launcher.json /tmp` 等经 Bash 的写形态可绕过——对运行时状态
而言同样等于自我授权/污染隔离/伪造票据/篡改 MCP 启动指针。PreToolUse 规则 0e
用 `shellWriteTargets()` 提取 Bash 命令的写形态目标（重定向 `>`/`>>`/`2>`
目标；`tee`/`rm`/`truncate`/`shred` 全部文件参数；`cp`/`install` 目标参数；
`mv` 全参数（源被移走同样破坏信任锚）；`dd of=`），命中运行时状态即 block。
**读取形态不受影响**（`cat`/`ls`/`rg`/`grep` 不提取）；误提取无害（引号内
`>` 等形态可能多判出路径，非运行时路径不命中不产生任何影响）。

## 3. 第二层：阶段门禁（仅约束 🔵 业务代码类）

### 3.1 工作流参与判定（sdlc_engaged）

**硬拦截（block）只对显式参与 ai-sdlc 工作流的项目生效**，防止"仓库里恰好有
`spec.md` 文件"的无关项目被误拦（v0.4.0 前的真实痛点）。

参与证据（任一命中即视为已参与 `sdlc_engaged`）：

| 证据 | 置位时机 |
|------|---------|
| `state.sdlc_engaged = true` | agent 写入 intent.md / spec.md / plan.md / REVIEW.md 任一工件（PostToolUse 置位）；MCP 首次调用（v0.13.0，替代原 slash 命令置位）；创建任务 |
| `state.plan_accepted` / `in_fix_mode` / `release_approval` / `deploy_initialized` | 只能由 MCP 受控工具设置，本身即参与证据 |
| `state.stage_override` | 用户手工钉住阶段 = 显式参与 |

**未参与的项目**：所有 block 级门禁自动降级为 warn（提醒 + 放行），并在提醒文本中
告知如何启用或如何消除提醒。

### 3.2 阶段 × 类别 × 行为矩阵

| 阶段 | 门禁 | 匹配条件 | engaged | 未 engaged |
|------|------|---------|---------|-----------|
| Stage 3a build_plan | plan 模式禁改代码 | 写操作 + 🔵 业务代码类 | **block** | warn |
| Stage 3a build_plan | Bash 只读约束 | 非只读 Bash 命令（见 4.2 白名单） | **block** | warn |
| Stage 3b build_impl | 修复期禁改测试 | `in_fix_mode=true` + 写 `*_test.*` / `*.spec.*` / `tests/`（阶段并集） | **block**（in_fix_mode 本身即参与证据） | — |
| Stage 3b/4 | 测试门禁 | `git push` / `gh pr create` 且 `test_pass=false`（保存/检测阶段并集） | **block** | warn |
| Stage 5 deploy | 迁移需变更工单 | 写 `migrations/` / `terraform/` / `*.sql` / `*.tf` 且无 `state.change_ticket`（阶段并集） | **block** | — |
| Stage 5 deploy | 生产部署授权 | Bash 含 `deploy`+`production` 且无 `state.release_approval`（阶段并集） | **block** | — |
| 任意（fix_loop 置位） | 修复循环中断 | 写 🔵 业务代码类 + 非只读非测试的 Bash（测试/只读命令豁免——取证需要） | **block** | — |
| 任意阶段 | 运行时状态保护 | 写 `.sdlc/state.json` 等 | **block** | **block** |
| 任意阶段 | 机构知识提醒 | 写 `AGENTS.md` 等 | warn | warn |
| build/test/deploy | 规格漂移提醒 | 写 `spec.md` | warn | warn |

plan 模式下仍被放行的典型写入：`plan.md`（本职产出）、`README.md`、
`CHANGELOG.md`、`docs/**`、`design/*.md`、ADR、会议纪要、`.sdlc/` 自定义配置。

**「阶段并集」判定（v0.13.10）**：上表阶段匹配取 `保存值 ∪ 检测值`
（`new Set([state.current_stage, detection.stage])`，任一侧命中即拦）。
原因：git diff 是瞬态的——测试通过并提交后检测跌回 build_impl 而保存值
仍在 test/deploy，仅看检测值会让迁移工单/生产授权/修复期测试保护在「已
提交」窗口静默失效（规则 4b push 门禁 v0.7.0 已用并集，v0.13.10 把规则
2/3/4 与 Stop 测试门禁提醒统一到同一语义）。配套的「有效阶段」显示约定
（SessionStart/Stop/UserPromptSubmit 按检测值与保存值中更靠后者呈现）
见 `docs/architecture.md` 设计决策「为什么门禁用并集阶段判定」。

## 4. 第三层：Bash 只读约束与加固

### 4.1 v0.4.0 修复的三个绕过漏洞

| 漏洞 | 旧版行为 | 新版行为 |
|------|---------|---------|
| 链式命令绕过 | `git status && rm -rf x` 以只读前缀开头 → 整串放行 | 按 `&&` / `||` / `;` / `|` / 换行**拆段逐段校验**，任一段非只读即拦截 |
| 重定向写文件 | `cat a > b`（以只读 cat 开头）→ 放行，实际写 b | 检测 `>` / `>>` / `2>file` 输出重定向 → 视为写操作拦截（fd 合并 `2>&1` 安全放行） |
| 命令替换 | `$(rm -rf x)` / 反引号内嵌任意命令 → 未检测 | 含 `$(...)` 或反引号 → 拦截（无法静态判定副作用；quoted heredoc 载荷已剥离——markdown 反引号是数据不是代码，v0.13.9；**单引号内与转义形态的字面 `$(`/反引号不执行——放行，v0.13.11**；双引号内与裸位置仍会真实执行——保持拦截） |
| 误伤只读形态（v0.13.9 修复） | `sed -n '520,820p' f`（纯读取）被拦；`cat x 2>/dev/null`（stderr 抑制）被拦；`apply_patch <<'PATCH'` 写 plan.md（本职产出）被拦 | sed 无 `-i` 且脚本无 `w` 命令 = 只读段放行；`/dev/null` 汇豁免；apply_patch heredoc 载荷目标经 classifyFile 分类——文档/spec 类放行（与规则 1 工具通道语义对齐），代码类拦截并具名 |
| 文档目标 Bash 写通道（v0.13.9） | `printf '...' > plan.md` 在 plan 模式被一刀切拦（工具通道却放行——通道间语义不一致） | plan 模式（规则 1b）重定向目标全部为文档/spec/未知类时放行；任一代码类拦截并具名。fix_loop 中断期（规则 0b）保持严格：任何写形态一律拦 |
| **引号内语法误判（v0.13.11 修复）** | `rg -n "a\|b\|c" … \| head -80` 的搜索模式内 `\|` 被当成管道切分 → 「非只读命令段」确凿误报；`rg "pattern > word" f` 引号内 `>` 被当重定向；引号包裹写目标（`> ".sdlc/state.json"` / `rm '.sdlc/state.json'`）因 token 含引号字符逃逸规则 0e 锚定正则；`>&file` 双流写被 fd 合并剥离规则吞掉 | 全部语法检查升级为**引号感知 shell 词法**（quoteSpans/splitShellSegments/substitutionProbe/findRedirects）：引号内 `\| > $ \`` 是字面文本；引号外操作符才切分/重定向/替换；引号包裹的目标 token 剥引号后真实提取——三个预存逃逸向量全部命中拦截 |
| **沙盒拒绝误计为测试失败（v0.13.12 修复）** | `npx playwright test` 因 Codex 沙盒拒网络/端口而失败（命令根本没跑起来）→ 计入 test_runs + fix_rounds → fix_loop 误判「代码有问题」 | PostToolUse 先做沙盒拒绝检测（失败输出命中 network access is disabled / sandbox denied / EPERM / ENOTFOUND 等特征）→ 被拒的测试命令不计数不进失败轮次，改记 sandbox_denied 事件 + hooks-state（下回合 UserPromptSubmit 注入授权应对提醒） |

### 4.2 只读白名单（逐段匹配命令前缀）

```
git status / log / diff / show / branch / rev-parse / remote / ls-files /
  describe / stash list / blame / shortlog / grep
ls / cat / head / tail / rg / grep / find / pwd / cd / which / command -v /
  whoami / id / wc / tree / file / stat / du / df / date / env / printenv /
  uname / arch / hostname
make help / make -n / make --dry-run
npm run help / npm ls / npm --version / npx --version
node|deno|bun|python|python3|cargo|rustc|go|java|git|pip|pip3|ruby|php|perl
  -v / -V / --version
go version / cargo --help / rustc --version
echo / printf / sort / uniq / cut / diff / nl（stdout-only，无重定向时零
  副作用；有重定向先被重定向检查拦下，v0.13.9）
sed 读形态：无 -i / --in-place 且脚本无 w 写命令（如 sed -n '520,820p' f，
  v0.13.9——sed -i 就地编辑与 sed 'w file' 仍拦）
```

注意：

- `find` 段含 `-delete` / `-exec` / `-execdir` 等破坏性参数时仍拦截
- 管道两侧均须只读（`cat a | grep x` 放行，`cat a | xargs rm` 拦截）
- **引号内的 `| > $ \`` 是搜索模式字面量不是语法（v0.13.11 引号感知词法）：
  `rg "a|b|c" f | head` 放行、`rg 'pattern > word' f` 放行、`rg '\$\(' f` 放行；
  转义形态 `\|` `\<` 同样字面化。未闭合引号 → 余下全部视为字面（该命令本身
  是 shell 语法错误不会执行，保守方向）
- 运行测试（`make test` / `npm test` / `pytest`）**不在** plan 模式白名单内——
  测试可能执行任意代码并产生构建产物，请先接受 plan.md 再运行
- `2>/dev/null` / `>/dev/null`（输出丢弃）不计为写目标（v0.13.9）；`2>&1`
  fd 合并历史行为不变
- quoted heredoc（`<<'EOF'`）载荷是纯数据不参与语法检查；unquoted（`<<EOF`）
  载荷保留整串检查（`$` 展开是真实执行风险）
- plan 模式下文档目标写形态放行（apply_patch heredoc / 重定向到 plan.md 等
  文档路径）；**业务代码目标**（含 /tmp 等盘上任意 .js/.py 等）仍拦——见
  上方「文档目标 Bash 写通道」行
- **受控接受通道豁免（v0.13.11，仅规则 1b）**：plan 等待接受期的两种**精确
  路径**形态段放行（`node <插件根>/hooks/scripts/accept-plan.mjs [项目根]` /
  `bash <插件根>/scripts/sh/sdlc.sh accept`）——MCP 工具未随会话暴露时 agent
  记录工程师显式接受的唯一合法 Bash 通道（与 MCP accept_plan 同锁同语义
  可审计）。路径必须等于插件安装根（防伪造同路径名脚本）；**仅 accept
  子命令豁免**——advance/reset 可跳过产出/门禁检查，不接受经 Bash 通道
  代劳，仍拦；豁免段链接其他违规段仍拦（段级豁免非整命令豁免）；fix_loop
  中断期（规则 0b）不传该豁免，行为不变
- **受控探测通道豁免（v0.13.12，仅规则 1b）**：plan 模式下
  `node <插件根>/hooks/scripts/setup-playwright.mjs --check`（及 `--help`/
  `-h` 形态）段放行——只读环境检测（包管理器/依赖/浏览器缓存/本机
  Chrome），评估前端测试方案的合法探测。路径必须等于插件安装根；
  **`--install` 不豁免**（写 package.json + 网络下载属带副作用操作，
  Stage 3b 起才合法，plan 模式仍拦）
- **沙盒授权预警（v0.13.12，规则 0f，warn 级非拦截）**：网络访问/端口监听
  类命令（curl / npm install / npx playwright install / dev server…）放行时
  注入 Codex 沙盒授权应对协议（每会话去重一次）——这是平台安全机制的
  教育性提示，不拦截命令本身。配套证据层（PostToolUse 拒绝检测）与
  提醒层（UserPromptSubmit 1f）见 docs/lifecycle.md §2.12。
  v0.13.13 同判定点另发**审批等待通知**（approval-wait，alert 级桌面通知
  把用户叫回终端选 y/esc——审批弹窗出现在回合进行中，任务静默暂停而
  用户不知情；在场窗口降噪默认 120s，`SDLC_NOTIFY_APPROVAL=off` 可整类
  关闭）——通知面向用户，与面向 agent 的教育文案去重相互独立

### 4.3 apply_patch 路径解析

PreToolUse 会解析 `apply_patch` patch 文本中的全部目标路径（`*** Add File:` /
`*** Update File:` / `*** Delete File:` / `*** Move to:` / `*** Copy to:`）并逐一按
第一层分类校验。`MultiEdit` 与 `shell`/`Shell` 工具名同样被防御性兼容识别。

## 5. 逃生通道（如何解除门禁）

按侵入性从低到高：

1. **推进流程**：生成 `plan.md` → `mcp__sdlc-orchestrator__accept_plan` 接受 →
   进入 Stage 3b 后代码写入自动解禁（门禁的本来设计）
2. **钉住阶段**：用户手工在 `.sdlc/state.json` 设置 `stage_override`（编辑器中直接
   改，hook 不拦人类操作），或用 MCP `set_stage` / `reset`
3. **解除修复循环中断**：测试真实通过（自动）/ 用户
   MCP `loop_resolve({decision:...})`（详见 docs/lifecycle.md §2.6）/ MCP `reset`
   或删除 `.sdlc/`
4. **重置工作流**：`mcp__sdlc-orchestrator__reset`（同时清除 `sdlc_engaged`，硬门禁
   降级回 warn）或 MCP `reset`
5. **彻底退出**：删除项目根的 `.sdlc/` 目录（所有门禁回到"未参与"状态）；或在
   Codex 中卸载/禁用 ai-sdlc 插件

## 6. FAQ

**Q：为什么 plan 模式还允许写文档？playbook 不是说"不能编辑文件"吗？**
A：playbook 约束的是工程师接受计划前 agent 不能动**代码库**；而 plan 模式的产出物
本身就是 `plan.md` 及配套设计文档。门禁若连文档都拦，计划阶段就无法工作。本策略把
「代码不可变、文档可写」作为标准语义。

**Q：我在一个与 ai-sdlc 无关的仓库里，为什么还收到 warn？**
A：阶段检测发现 `spec.md` 存在而 `plan.md` 不存在（很多普通项目有 `docs/spec.md`）。
项目未参与工作流，门禁已降级为纯提醒。删除 `.sdlc/` 目录即可消除。

**Q：block 提示里让我调用的 MCP 工具不存在？**
A：MCP 服务器需在 Codex 配置中启用 ai-sdlc 的 `sdlc-orchestrator`。若不打算使用
工作流，请走第 5 节的逃生通道。

**Q：spec.md 在 design 阶段会被拦吗？**
A：不会。design 阶段写 `spec.md` 是本职产出（放行无警告）；warn 只在
build/test/deploy 阶段编辑 `spec.md` 时出现（需求漂移提醒）。
