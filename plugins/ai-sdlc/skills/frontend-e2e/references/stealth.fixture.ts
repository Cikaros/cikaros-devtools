// stealth.fixture.ts — frontend-e2e 技能反检测 fixture 模板
//
// 用法：复制到 e2e/fixtures/stealth.fixture.ts（或项目习惯的位置），按需
// 取 L1 或 L3 其中一段（两段同时用没有叠加收益——L3 的 stealth 插件已覆盖
// L1 的 init script 位）。合规边界与症状判别见 references/anti-detection.md。
//
// 设计约定：
//   - 只覆写「指纹」，不覆写断言与选择器——反检测不是弱化验证
//   - 模板保持与 @playwright/test 的 fixture 链兼容（browser → context → page），
//     其余能力（trace / screenshot / baseURL / webServer）全部沿用 playwright.config.ts
//   - 运行命令仍是 `npx playwright test`——门禁识别与计数不受影响
//

// ═══════════════════════════════════════════
// L1 · 原生加固（零依赖）：覆写 context fixture
// ═══════════════════════════════════════════
// 适用：WAF 浅层指纹检查。只做三类事：真实 UA / 一致的 locale+timezone /
// init script 抹除 headless 判别位。逐段可裁剪——注入面越大越容易成为新指纹。
//
// import { test as base, expect, devices } from '@playwright/test';
//
// const test = base.extend({
//   context: async ({ browser }, use) => {
//     const context = await browser.newContext({
//       // [TODO] 换成本目标环境真实用户主流 UA（与 devices 档案一致，别自相矛盾）
//       userAgent:
//         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
//         '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
//       ...devices['Desktop Chrome'],          // 真实 viewport / deviceScaleFactor / touch
//       locale: 'zh-CN',                        // [TODO] 与目标用户群一致
//       timezoneId: 'Asia/Shanghai',
//     });
//     await context.addInitScript(() => {
//       // —— 以下每段独立成条，按 trace 确诊的检测点裁剪 ——
//
//       // ① navigator.webdriver（最廉价的检测位）
//       Object.defineProperty(navigator, 'webdriver', {
//         get: () => undefined, configurable: true,
//       });
//
//       // ② navigator.plugins（headless 恒为 0；造一个合理长度即可）
//       Object.defineProperty(navigator, 'plugins', {
//         get: () => [1, 2, 3, 4, 5].map(() => ({})),
//         configurable: true,
//       });
//
//       // ③ navigator.languages（与 context locale 一致）
//       Object.defineProperty(navigator, 'languages', {
//         get: () => ['zh-CN', 'zh', 'en'], configurable: true,
//       });
//
//       // ④ WebGL vendor/renderer（headless 的 SwiftShader 特征）
//       const getParameter = WebGLRenderingContext.prototype.getParameter;
//       WebGLRenderingContext.prototype.getParameter = function (parameter) {
//         if (parameter === 37445) return 'Intel Inc.';            // UNMASKED_VENDOR_WEBGL
//         if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
//         return getParameter.call(this, parameter);
//       };
//
//       // ⑤ chrome.runtime（真实 Chrome 有、headless 无）
//       // @ts-expect-error —— window 上不存在该类型的运行时鸭子类型
//       window.chrome = window.chrome || { runtime: {}, app: { isInstalled: false } };
//     });
//     await use(context);
//     await context.close();
//   },
// });
// export { test, expect };

// ═══════════════════════════════════════════
// L3 · playwright-extra + stealth 插件：覆写 browser fixture
// ═══════════════════════════════════════════
// 适用：企业级 bot 防护（DataDome / PerimeterX 级别），且 L1+L2 组合仍被拦。
// 前置：npm install -D playwright-extra puppeteer-extra-plugin-stealth
// 注意：playwright-extra 须与项目 playwright 版本兼容（升级时同步升）。
// 别忘了 L2 的 channel: 'chrome'（真实浏览器本体）——穿着 stealth 露着
// Chrome-for-Testing 的本体指纹是常见翻车点。
//
// import { test as base, expect } from '@playwright/test';
// import { chromium as chromiumExtra } from 'playwright-extra';
// import StealthPlugin from 'puppeteer-extra-plugin-stealth';
//
// chromiumExtra.use(StealthPlugin());
//
// const test = base.extend({
//   browser: async ({ }, use) => {
//     const browser = await chromiumExtra.launch({
//       channel: 'chrome',          // L2：真实浏览器本体（CI 需预装 google-chrome-stable）
//       headless: true,
//     });
//     await use(browser);
//     await browser.close();
//   },
// });
// export { test, expect };

// 模板本身不导出任何东西——取消注释你要的那一段后再引用。
// 保持本文件为注释态可作为「反检测选项存在」的文档锚点，不引入任何依赖。
export {};
