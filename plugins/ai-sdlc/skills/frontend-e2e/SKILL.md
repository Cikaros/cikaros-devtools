---
name: frontend-e2e
description: >-
  基于 Playwright 的前端端到端（E2E）测试技能。何时使用：改动了 UI（页面/组件/路由/样式/交互）
  且需要真实测试证据时；前端项目需要从零建立 E2E 套件时；Stage 4 Test 需要对前端功能做验证、
  或测试门禁要求「实施后必须真实测试」而项目只有前端时；spec.md 含 UI mock 需要「视觉闭环」
  对比时。覆盖：环境检测与受控安装（setup-playwright.mjs --check 三选项，v0.13.12：
  安装与否由用户抉择，含本机 Chrome 零浏览器下载通道；Codex 沙盒网络/端口拦截的
  授权应对）、项目栈识别、playwright.config 生成、用例编写规范
  （选择器策略/web-first 断言/用例隔离）、标准运行命令与证据粘贴、失败调试（trace/截图）、
  CI 集成，反检测（anti-detection：WAF/机器人检测环境下的可用性保障，L1 原生
  加固→L2 真实 Chrome→L3 playwright-extra stealth 升级阶梯 + 合规边界），以及与
  ai-sdlc 测试门禁、修复循环中断（fix_loop）的协作语义。
---

# frontend-e2e — Playwright 前端 E2E 测试技能

本技能把「前端改动必须有真实测试证据」落成可执行流程。ai-sdlc 的测试门禁
（v0.7.0+）要求：plan 接受并实施后必须真实运行测试，未通过不得 `git push` /
`gh pr create` / 报告完成。对前端项目，本技能就是那条「真实测试」的标准路径——
PostToolUse hook 会自动识别本技能规定的标准命令并记录测试执行（通过/失败/轮次），
失败签名进入修复循环检测，无需任何额外操作。

## 1. 何时使用本技能

满足以下任一条件即应使用：

- **改了 UI**：本次周期（plan.md 的 Files that change）包含页面/组件/路由/样式/前端交互逻辑
- **测试门禁要求**：处于 Stage 3b/4，`state.test_pass` 尚未置位，项目是前端项目
  （有 `package.json` 且为 Web 应用）或全栈项目的前端部分
- **视觉闭环**：spec.md 带 UI mock / 设计稿，需要机械化的「截图与 mock 对比」
  （替代人工目测，见 §7）
- **建立套件**：前端项目还没有任何一条命令可跑的 E2E 测试（门禁要求先补最小冒烟测试）

**不适用**：纯后端/CLI/库项目（用 pytest/jest/vitest 等原生套件）；纯 CSS 微调且无
交互变化时至少跑一次既有冒烟用例确认页面可渲染。

## 2. 前置检查（先看再动）

按顺序确认，避免在错误前提上引导：

1. **环境就绪度**：跑 `node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --check`
   （只读，任何阶段可运行）——`@playwright/test` 已装且浏览器可用（缓存或本机
   Chrome/Edge）→ 跳到 §4 直接写用例/运行；未就绪 → 按 §3 三步协议呈报用户抉择。
2. **栈与端口**：读 `package.json` 的 `scripts.dev`/`scripts.start` 推断启动命令与端口
   （Vite/Next/CRA/webpack-dev-server…）；config 的 `webServer` 会按此自动拉起，
   **用例不依赖开发者手动起服务器**（端口监听受 Codex 沙盒约束，见 §3 沙盒授权）。
3. **基线分支**：测试新功能前，确认目标 URL/路由确实存在于当前分支（对照 plan.md
   的 Files that change），避免写出「对不存在的页面断言」的假失败。

## 3. 环境检测与受控安装（Bootstrap，一次性，v0.13.12）

本机通常没有 Playwright 相关依赖——**安装与否由用户抉择**，agent 不得自作主张
直接 `npm install`。标准三步协议：

**第一步 · 只读检测**（任何阶段可跑，plan 模式白名单已豁免该命令形态）：

```bash
node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --check
```

输出环境报告：包管理器（lockfile 探测）/ `@playwright/test` 是否已装 /
浏览器缓存目录（`~/.cache/ms-playwright` 等平台默认）/ 本机 Chrome・Edge
探测结果 / 三个安装选项。报告可直接转述给用户。

**第二步 · 呈报等待抉择**——把报告与三选项转述给用户，**等用户明确选择**：

| 选项 | 网络需求 | 说明 |
|------|---------|------|
| A `--install full` | 较大（Chromium 约 100–170MB + npm 包） | 装包并下载 Chromium 本体，开箱即用 |
| B `--install chrome` | 小（仅 npm 包几 MB，**零浏览器下载**） | 复用本机 Chrome/Edge：config 设 `channel:'chrome'`（或 `'msedge'`），测试语义与 Chromium 完全一致，门禁照常识别 |
| C `--install skip` | 零 | 不装。改用项目既有测试套件满足门禁，或本机 Chrome CLI 自助取证（见下方降级路径） |

**第三步 · 受控执行**（用户选择后）：

```bash
node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --install <full|chrome|skip> --yes
```

`--yes` 是用户抉择的显式凭证——脚本无 `--yes` 时拒绝执行（防 agent 未经询问
就安装）。幂等：已装包/缓存已有浏览器会自动跳过对应步骤，重复执行无害。

注意事项：

- **沙盒授权**：安装命令需要网络访问，Codex 沙盒默认拒绝（首次网络命令前
  hook 会注入授权应对协议；真实被拒时下回合会收到针对性提醒）。被拒时不要
  重试或绕过——向用户呈报命令与目的，请求授权提权运行。
- **时机**：`--install` 属带副作用命令（写 package.json + 网络），只能在
  **Stage 3b（build_impl）及之后**执行——plan 模式（Stage 3a）下只放行
  `--check` 只读形态，`--install` 会被拦截（这是设计行为）。
- `npx playwright install` 与 `setup-playwright.mjs --install` **都不是测试
  命令**，不会被门禁记为测试执行（见 §6）；真正计数的只有 §6 的标准运行命令。
- 无网络/离线环境（用户拒绝授权且无本机浏览器）：如实报告并降级——改用
  项目内已有的其他测试套件满足门禁，**不得**伪造 Playwright 运行结果。
  零依赖辅助取证：本机 Chrome 可用 `chrome --headless --screenshot` /
  `--dump-dom` 自助验证页面可渲染（仅作辅助证据，不满足门禁的
  `test_runs` 计数）。
- 被测站点带机器人检测（WAF/Cloudflare/OAuth 反自动化）时：安装本体不变，
  另按 §8 反检测阶梯加固运行环境（L1 零依赖起步，勿盲目引入 playwright-extra）。

然后生成配置：复制 `references/playwright.config.ts.tpl` 到项目根，按注释修改
`webServer.command` / `baseURL` / 项目浏览器列表。选项 B 的用户在 `projects`
里启用 `channel: 'chrome'`（模板注释有现成行）。该模板已预设：

- `webServer` 自动起开发服务器、测试结束自动回收（`reuseExistingServer: !process.env.CI`）
- 失败自动重试 1 次（CI 2 次），重试时自动开启 **trace 采集**（调试金钥匙，§8）
- CI 与本地的差异化默认值（workers/截图/trace 策略）
- `webServer` 端口监听同样受 Codex 沙盒约束——首次起服务被拒时按沙盒协议
  请求用户授权（与网络访问同机制）

## 4. 用例编写规范

新用例从 `references/e2e-example.spec.ts` 起步（含冒烟 + 工作流两种范型）。硬规则：

1. **选择器优先级**：`data-testid`（稳定契约）> 可访问性角色与名称 `getByRole` /
   `getByText` > 语义化 CSS（`#app .submit`）。**禁止**依赖 class 名、动态生成的
   自动 class（Tailwind/CSS-in-JS 产物）、DOM 位置路径——它们是重构断头台。
   页面缺 `data-testid` 时，优先给页面**补上**（这属于测试基建改动，计入 diff）。
2. **web-first 断言**：一律使用 `await expect(locator).toBeVisible()` 等自动重试断言；
   **禁止** `page.waitForTimeout(ms)`、`await new Promise(r => setTimeout(r, N))` ——
   时间等待制造假绿与超慢套件，竞态问题交给断言重试机制。
3. **用例隔离**：每个用例独立可跑（单跑/乱序/并行都通过）；需要登录态等前置数据时，
   用 `storageState` 或 beforeEach 重建，**不依赖**其他用例的执行顺序或落盘副作用。
4. **断言最小充分**：断言用户可感知的行为（文本可见/URL 跳转/元素状态/截图一致），
   不断言实现细节（内部 state、DOM 结构）。一次失败应能直接指出哪个用户行为坏了。
5. **codegen 仅作草稿**：`npx playwright codegen` 录制的脚本必须按上述规范人工
   审查改写（它默认用 class/text 选择器且常带硬等待），**不得**原样提交。

## 5. 目录与命名约定

```
e2e/                        # 或 tests/e2e/（跟随项目既有习惯）
  smoke.spec.ts             # 冒烟：首页可渲染、核心路由可达（最小套件，门禁底线）
  <feature>.spec.ts         # 按功能域拆分，与 plan.md 的功能点对应
playwright.config.ts        # 项目根
```

用例标题用「用户行为 → 预期」句式：`test('提交表单后跳转到结果页', ...)`。
plan.md 中列出的每个前端行为都应有对应用例或显式说明为何不测。

## 6. 标准运行命令与证据（门禁识别的关键）

**必须使用以下命令形态之一运行**——PostToolUse hook 按此识别并记录测试执行
（置位 `test_pass` / 计入 `test_runs` / 失败进入签名与轮次统计）：

```bash
npx playwright test                     # 首选（显式、无需脚本约定）
npm run e2e                             # 次选（要求 package.json scripts.e2e = "playwright test"）
npm run test:e2e                        # 同上，社区常见命名
playwright test                         # 已全局安装/PATH 直达时
# pnpm/yarn/bunx/pnpm exec 等价形式均可识别
```

**不会被识别为测试执行**（避免误记）：

- `npx playwright install`（装浏览器，副作用命令）
- `node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --install …`（受控安装入口，v0.13.12）
- `npx playwright codegen`（录制工具）
- `npx playwright show-report`（看报告）
- `npx playwright --help` / `--version`

另：被 Codex 沙盒拒绝而失败的测试命令（命令根本没跑起来）不计入
`test_runs` / 失败轮次（v0.13.12）——那不是测试失败，是环境授权问题；
按沙盒协议向用户请求授权后重跑即可正常计数。

报告器要求：证据运行使用默认 / `list` / `line` / `dot` 报告器——失败详情含
`✘ N [browser] › file:line › title` 编号清单，这是失败签名提取的依据；
**避免**在门禁关键运行时用 `--reporter=json` 或 `none`（失败行丢失 → 只能落到
弱签名，循环检测的分辨率下降）。

**证据粘贴**：报告任务完成前，把运行摘要的原始输出（`N passed` / `N failed` 与
失败清单）粘贴到会话中——与 `make test` 的机械证据要求一致（Stage 4 规则 2）。
跑出全绿后再考虑 `git push`（门禁在 `test_pass=true` 前会硬拦）。

常用参数速查：`--grep <title>` 只跑匹配用例；`--project=chromium` 单浏览器；
`-u`（`--update-snapshots`）仅限 §7 的基线变更场景；`--last-failed` 只跑上次失败。

## 7. UI 视觉闭环（spec mock 对比）

spec.md 带 mock/设计稿时，用截图断言机械化「实现 → 截图 → 与 mock 对比 → 调整」循环：

```ts
await expect(page).toHaveScreenshot('checkout-page.png', { maxDiffPixelRatio: 0.01 });
```

- 首次运行生成基线快照（`-`tests 目录），**提交基线进版本库**——它是团队共享的视觉契约
- 快照失败 = 实现偏离契约 → 修实现，**不是**先改快照
- `-u` 更新基线的唯一合法场景：spec.md **明确变更了**视觉设计（需求变更），且需在
  会话中说明「按 spec vN 更新视觉基线」——为让失败消失而更新基线，等同于修改
  测试使其通过，是 Stage 4 明令禁止的反模式
- 大页面/动态区域用 `locator.screenshot()` 局部快照 + `mask` 遮蔽时间戳等噪声源

## 8. 反检测（WAF / 机器人检测环境下的可用性保障）

被测站点带机器人检测（Cloudflare/DataDome/reCAPTCHA，或 OAuth 提供商的反自动化
页面）时，Playwright 默认指纹（`HeadlessChrome` UA、`navigator.webdriver=true`、
plugins=0、SwiftShader WebGL 等）会让用例卡在挑战页——这不是实现 bug，是
**测试无法进行**。按分层阶梯加固（详见 `references/anti-detection.md`）：

- **L1 原生加固（零依赖，首选）**：真实 UA + 一致的 locale/timezone/设备档案 +
  init script 抹除 headless 判别位 + `--disable-blink-automation=AutomationControlled`。
  模板：`references/stealth.fixture.ts` 的 L1 段（覆写 context fixture）。
- **L2 真实浏览器通道**：`channel: 'chrome'` 用本机/CI 安装的零售 Chrome 替代
  Chrome-for-Testing 本体（系统性指纹差异消失）；登录准备可用
  `launchPersistentContext`（注意与用例隔离的边界）。
- **L3 playwright-extra + stealth 插件**：企业级 bot 防护场景；覆写 browser
  fixture（模板 L3 段），注意版本配对与 CI 预装 Chrome。
- **行为层**（所有层级）：workers=1 起步、登录收敛到 setup spec + storageState，
  别让每条用例都现场过一次登录页。

**合规硬边界**：仅限自有/授权测试目标；禁止用于第三方站点反爬绕过/抓取/
ToS 违反；反检测不改变断言语义（不得借此弱化验证）；fix_loop 中断期间装
stealth 依赖会被 Bash 门禁拦截——先经用户决策调 MCP `loop_resolve` 解除。门禁对反检测
运行一视同仁：命令形态不变（`npx playwright test`），计数/签名/熔断照常。

**先确诊再上手段**：失败先看 trace（截图是挑战页 = 检测问题；正常页面但
元素不在 = 选择器/实现问题）。症状判别表与指纹自检用例见
`references/anti-detection.md` §1/§4。

## 9. 失败调试（替代盲目重试）

**先取证，再修复**——这正是修复循环中断（fix_loop）设计所期望的工作方式：

1. **trace**：config 已设 `trace: 'on-first-retry'`，失败重试自动留 trace。查看：
   `npx playwright show-trace test-results/<...>/trace.zip` —— 逐帧 DOM 快照、
   网络、控制台、每步耗时，一次看完失败现场。
2. **UI 模式**：`npx playwright test --ui` 交互式时间旅行调试，适合本地定位。
3. **单用例复现**：`npx playwright test --grep "提交表单后跳转"` 最小化爆炸半径。
4. **修代码不修测试**（Stage 4 硬约束）：失败优先怀疑实现；确证测试本身写错
   （选择器指向已重构元素等）才修测试，且如实说明。`in_fix_mode` 期间
   PreToolUse 会硬拦对测试文件的修改。
5. **循环熔断语义**：同一失败签名重复出现（A→A / A→B→A，含跨周期 intent 迭代后
   再现）或连续失败轮次超限（默认 3）时，插件自动置位 `fix_loop` 并阻断业务代码
   写入——此时**停止自动修复**，向用户呈报失败历史与已尝试方向，等待
   决策：MCP `loop_resolve({decision:"retry|new-intent|manual|escalate"})`。测试真实通过自动解除。
   **不得**为解除中断而跳过/删除/弱化失败用例（`test.skip()`、删 spec、放室断言）。

## 10. CI 集成

把 E2E 纳入持续评估（与 `templates/agent-evals.yml.tpl` 的触发口径一致：
AGENTS.md / .codex/** / .sdlc/** / **e2e/**/** 变更触发回归）：

- CI 中 `npx playwright install --with-deps chromium` 缓存浏览器（`~/.cache/ms-playwright`）
- `webServer` 在 CI 会自动起独立服务器（`reuseExistingServer: !process.env.CI`）
- 证据链：CI check runs 汇总 `N passed`；trace/失败截图作为 artifact 保留
  （`playwright.config.ts.tpl` 的 `outputDir` 注释有保留策略）

## 11. 反模式

- ❌ 用 `waitForTimeout` 糊弄竞态——假绿今天绿，明天红
- ❌ class/自动生成 class 选择器——下次重构全红，红多了大家就不看红了
- ❌ codegen 脚本不审查直接提交
- ❌ 门禁关键运行用 json/none 报告器——失败证据丢给弱签名
- ❌ 为了 `test_pass=true` 跑 `--grep` 只挑绿的用例——那不是测试，那是表演；
  全量套件（或 plan.md 覆盖口径下的完整子集）必须绿
- ❌ `-u` 刷基线让视觉失败消失（除 spec 明确变更基线）
- ❌ `playwright install` 当成「跑过了测试」——安装不计入 `test_runs`
- ❌ fix_loop 置位后继续自动改代码——先呈报，等用户四决策
- ❌ 前端改动只跑单元测试不跑 E2E——用户行为层的回归只有 E2E 拦得住
- ❌ 没确诊就上 stealth——先用 trace 分清业务 bug 与环境拦截（技能 §8）
- ❌ 反检测的同时放室断言——那是把「测试」变成「表演」

## 相关资源（本技能目录内，按需读取）

- `references/playwright.config.ts.tpl` — 带注释的配置模板（webServer/重试/trace/CI 差异）
- `references/e2e-example.spec.ts` — 冒烟 + 工作流范型示例（选择器与断言规范示范）
- `references/debug-ci.md` — 调试命令速查与 CI 配置要点（含机器人检测拦截排查）
- `references/anti-detection.md` — 反检测权威指南（症状判别/L1-L3 升级阶梯/合规边界/指纹自检）
- `references/stealth.fixture.ts` — L1/L3 可运行 fixture 模板（按需取消注释一段）

## 相关插件资源

- `rules/stage-test.md` — Stage 4 权威规则（反馈循环/门禁/修复路径）
- `docs/lifecycle.md` §2.6/§2.7 — 测试门禁与循环中断标准、本技能协作语义
- `prompts/test.md` — Stage 4 测试操作手册
- `templates/agent-evals.yml.tpl` — CI 触发口径参考
