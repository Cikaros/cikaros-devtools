# 反检测（Anti-Detection / Stealth）——保障被测站点带机器人检测时的 E2E 可用性

> 适用场景：被测目标**属于你或你获得测试授权**（自有 staging/prod 站、公司 SSO、
> 挂在 WAF 后的内部环境）。目标部署了 Cloudflare / DataDome / PerimeterX /
> Akamai / reCAPTCHA 等 bot 检测，导致 Playwright 默认指纹被识别——用例在
> 挑战页（403 / "Checking your browser" / 人机验证）卡死或只在有头模式通过。
> **本指南解决的是「测试无法进行」，不是「绕过站点防护去抓数据」。**

## 0. 合规硬边界（先读，违反即停）

1. **只对自有/授权目标使用**。反检测的全部技术手段仅用于让你自己的 E2E
   测试能跑通你自己的站点/授权环境。
2. **禁止用于第三方站点**：不得用本技能的任何配置去绕过他人站点的反爬
   防护、抓取数据、规避服务条款或访问控制——那是滥用，不是测试。
3. **不得弱化断言**：反检测改变的是「浏览器指纹」，不改变「验证什么」。
   `toBeVisible()`、`toHaveURL()` 等断言语义一寸不让。用反检测「让挑战页
   出现得少一点」可以；用它「把断言改成只要页面有响应就算过」是伪造证据
   ——测试门禁（test_pass / fix_loop）语义对反检测一视同仁。
4. **留痕**：启用 L2/L3 时在 plan.md 或 spec.md 里写一行说明（目标环境的
   WAF 类型 + 选择的层级），让审查者知道这不是悄悄改配置。

## 1. 症状判别（先确诊，再上手段）

| 症状 | 典型原因 | 对应层级 |
|------|----------|----------|
| 403 / 1020 / "Checking your browser…" 卡住 | WAF 识别 `HeadlessChrome` UA 或 `navigator.webdriver=true` | L1 起步 |
| 本地有头能过、CI headless 挂 | headless 指纹（UA 标记 / CDP 特征） | L1→L2 |
| OAuth 登录页（Google/微软）直接拒绝 | 登录页反自动化（极常见，非你站点的问题） | L2 起步 |
| 前几条用例能过、批量并行全挂 | 行为特征（无鼠标轨迹 / 瞬时跳转） | L1 + 降并行 |
| `Error: expect(locator).toBeVisible()` 但 trace 截图是挑战页 | 被拦的不是断言，是导航 | 任一层 + §4 诊断 |

确诊手段：失败后先看 **trace**（`npx playwright show-trace …`）——截图是挑战页
= 检测问题；截图是正常页面但元素不在 = 选择器/实现问题。**别把业务 bug
误诊成检测拦截而乱上 stealth。**

## 2. 升级阶梯（L1 → L3，最少侵入优先，逐层验证）

**原则：能不上的层就不上。** 每升一层都增加维护成本与环境依赖；L1 是纯
配置零依赖，L3 引入两个第三方依赖。上一层的收益覆盖不了成本时不要升级。

### L1 · 原生加固（零依赖，先试这个）

三类动作，全部在 `stealth.fixture.ts`（本目录模板）的 `context` fixture 里：

1. **launch 层**（playwright.config.ts 的 `launchOptions`）：
   `args: ['--disable-blink-automation=AutomationControlled']` —— 移除自动化
   控制标记（"Chrome is being controlled…" 信息条与 `navigator.webdriver`
   的 Blink 侧暴露源）。
2. **context 层**：用**真实 Chrome 的 UA 串**覆盖默认 UA（Playwright headless
   默认 UA 含 `HeadlessChrome/xxx` —— 一行正则就能被识别）；同时钉住
   `locale` / `timezoneId` / 真实设备档案（`devices['Desktop Chrome']` 的
   viewport/deviceScaleFactor），别让指纹自相矛盾（UA 说 Windows、时区却是
   UTC、locale 是 en-US 的组合本身就是异常信号）。
3. **init script 层**（`context.addInitScript`，在页面任何脚本之前注入）：
   抹除最常用的 headless 判别位——`navigator.webdriver`、`navigator.plugins.length`
   （headless 恒为 0）、`navigator.languages`、WebGL vendor/renderer（SwiftShader
   特征）、`chrome.runtime` 缺失、`Permissions.query` 行为差异。模板里是逐条
   可勾选的独立小段，按目标站点的实际检测点裁剪——**不要无脑全开**，注入面
   越大越容易与真实浏览器行为不一致，反而成为新指纹。

适合：WAF 只做浅层指纹检查的场景（多数内部/企业环境足够）。改完重跑：
`npx playwright test`（命令形态不变，门禁照常计数）。

### L2 · 真实浏览器通道（换浏览器本体，不是换配置）

Playwright 自带的 Chromium 是 **Chrome for Testing** 构建，与零售 Chrome 的
指纹存在系统性差异（字体列表、feature 集合、某些 API 行为）。改用本机安装
的真实浏览器：

```ts
// playwright.config.ts → projects[].use
{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }
```

- 本地：需要安装 Google Chrome（`channel: 'chrome'` 自动定位；无 Chrome 时
  报错信息会列出可用 channel）。
- CI：GitHub Actions 用 `browser-actions/setup-chrome@v3` 或容器镜像安装
  `google-chrome-stable`；Playwright 会自动使用。
- 需要更完整指纹（canvas/WebGL/字体/音频指纹跨会话一致）时用
  `launchPersistentContext`（固定 userDataDir）——注意与用例隔离原则冲突
  （cookie/storage 跨用例残留），仅限「登录前置准备」这类专用 setup spec，
  业务用例仍走独立 context + `storageState`。

适合：L1 后仍被拦（检测深入到字体/feature 指纹）、OAuth 提供商页面。

### L3 · playwright-extra + stealth 插件（社区指纹对抗集）

前两层只消除「明显的自动化痕迹」；stealth 插件是对抗已知的整套指纹检测
（navigator 全家桶、WebGL、canvas 噪声、iframe contentWindow、CDP 泄露位等）：

```bash
npm install -D playwright-extra puppeteer-extra-plugin-stealth
```

注意三点：
- **版本配对**：`playwright-extra` 必须与项目里的 `playwright`/`@playwright/test`
  版本兼容（它包装的是同版本内核），升级 Playwright 时一起升。
- **集成方式**：@playwright/test 不能直接吃 playwright-extra 的 browser——
  需要覆写 `browser` fixture，见 `stealth.fixture.ts` 的 L3 段（`chromium.use(StealthPlugin())`
  后用 `chromium.launch` 替代默认浏览器启动）。
- **门禁语义不变**：运行命令仍是 `npx playwright test`；`npm install -D …`
  是安装命令（不计入 `test_runs`）。若在 fix_loop 中断期间执行安装会被
  Bash 门禁拦截（install 属写类命令）——先经用户决策调 MCP `loop_resolve` 解除再装。

适合：检测方是企业级 bot 防护（DataDome/PerimeterX 级别）且 L1+L2 组合
仍被拦。**外购反爬代理/打码服务不在本技能范围内**（那是把「测试」外包给
灰产，既不合规也让测试证据失去意义）。

## 3. 行为层加固（所有层级都该做的）

指纹只是检测的一半，**行为**是另一半。E2E 的「瞬时操作」本身就是机器人
特征：

- **降并行**：`workers: 1` 起步（`fullyParallel: false`）。多 worker 同时
  打同一 WAF 后的目标 = 请求速率触发限流，跟指纹无关。
- **保留 web-first 断言的节奏**：断言自动重试产生的「等待后操作」比
  `waitForTimeout` 的人为延迟更接近真实用户（且不制造假绿）。
- **登录态复用 storageState**：把「登录」收敛到一条 setup spec（可配 L2/L3），
  业务用例带着已认证的 storageState 跑——每个用例都现场过一次登录页是
  触发检测的最快方式。

## 4. 诊断方法（上了手段仍被拦时）

1. **指纹自检用例**（临时 spec，验证手段本身，跑完删除）：

   ```ts
   test('stealth 自检：关键指纹位', async ({ page }) => {
     await page.goto('/');
     const wp = await page.evaluate(() => navigator.webdriver);          // 期望 undefined/false
     const ua = await page.evaluate(() => navigator.userAgent);          // 期望不含 HeadlessChrome
     const plugins = await page.evaluate(() => navigator.plugins.length); // 期望 > 0（headless 默认 0）
     console.log({ wp, ua, plugins });
     expect(wp == null || wp === false).toBeTruthy();
     expect(ua).not.toContain('Headless');
   });
   ```

2. **trace 定位拦截点**：`trace: 'on-first-retry'` 已是模板默认；挑战页出现
   在哪个跳转（network 面板看 403 的 response headers，`cf-mitigated` /
   `x-ddos` 等头能告诉你是谁拦的）。
3. **逐层二分**：L1 无效 → 加 L2 再测 → 仍无效 → L3。同时开 L3 却连 L1 的
   UA 都没改，等于穿着盔甲露着头。
4. **换个入口**：很多「被拦」其实是 dev server 端口被 WAF 规则误伤（比如
   非标准端口 + 无域名）。跟基础设施确认 E2E 的合法入口（内网域名/测试
   host 头）常常比对抗检测有效得多。

## 5. 与测试门禁 / 循环熔断的协作（重要）

- 反检测**不改变**门禁识别与计数的任何语义：`npx playwright test` 照常
  计入 `test_runs`、失败照常进签名与轮次、A→A 振荡照常熔断。
- 挑战页导致的失败是**环境性失败**，签名往往长得很像（都是超时/非可见）——
  若因此连续熔断，呈报时明确说明「疑似环境性拦截，非实现缺陷」，
  MCP `loop_resolve({decision:"retry"})` 后按 §4 诊断，而不是反复重跑。
- 不得用 `test.skip()` / 跳过挑战页用例来「解决」检测问题（§0 合规边界 3）；
  环境问题修环境，实在修不了的在 plan.md 里如实声明覆盖范围收缩。

## 6. 反模式

- ❌ 没确诊就上 stealth——先用 trace 分清业务 bug 与环境拦截
- ❌ init script 无脑全开——注入面本身会成为新指纹
- ❌ 反检测的同时放室断言——那是把「测试」变成「表演」
- ❌ 对第三方站点用 L1-L3——合规红线，见 §0
- ❌ fix_loop 中断期间装 playwright-extra 绕着走——先解决中断决策
- ❌ 上 L3 却不改 UA——最低成本的检测位都没堵
- ❌ 每个 spec 都现场登录——用 storageState 收敛登录面
