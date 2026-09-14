// playwright.config.ts — frontend-e2e 技能配置模板
//
// 用法：复制到项目根目录为 playwright.config.ts，按 [TODO] 标注处修改。
// 该模板已内置 ai-sdlc 测试门禁协作所需的默认策略：
//   - webServer 自动起开发服务器（用例不依赖手动起服务，CI 可复现）
//   - 失败重试 + on-first-retry trace 采集（调试取证，见技能 §8）
//   - CI/本地差异化默认值
// 修改后无需通知插件——门禁只认运行命令形态（npx playwright test 等），不解析本文件。
//
import { defineConfig, devices } from '@playwright/test';

/**
 * 环境与目录约定。CI 环境变量由你的 CI 平台注入（GitHub Actions 自带 CI=true）。
 * @see https://playwright.dev/docs/test-configuration
 */
const isCI = !!process.env.CI;

export default defineConfig({
  // 测试目录：默认 e2e/；跟随项目既有习惯可改 tests/e2e/
  testDir: './e2e',

  // 断言超时：web-first 断言的重试窗口（5s 是多数 SPA 的安全值；慢环境调大）
  expect: { timeout: 5_000 },

  // 完整超时：单用例含 webServer 启动等待的上限
  timeout: 30_000,

  // 并行：本地全并行提速；CI 从 1 worker 起步避免资源争抢导致的假失败
  fullyParallel: !isCI,
  workers: isCI ? 1 : undefined,

  // 失败重试：本地 1 次 / CI 2 次；重试触发 trace 采集（use.trace: 'on-first-retry'）
  retries: isCI ? 2 : 1,

  // 报告器：list 适合人读与门禁证据粘贴（失败编号清单是签名提取依据）。
  // 不要改为 json/none——门禁失败签名会退化为弱签名（技能 §6）。
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',

  // 产物目录：trace/失败截图/视频落点；CI 中建议作为 artifact 上传
  outputDir: 'test-results',

  use: {
    // [TODO] 基础 URL：与 webServer.port 对齐
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',

    // 每用例独立上下文（默认即隔离态；登录态复用见 storageState）
    trace: 'on-first-retry',          // 失败取证金钥匙
    screenshot: 'only-on-failure',    // 失败自动截图（证据链）
    video: 'off',                     // 按需开启：'retain-on-failure'

    // ── 反检测可选加固（L1/L2，零依赖）────────────────────────
    // 被测站点带机器人检测（WAF/Cloudflare/OAuth 反自动化）时再启用；
    // 合规边界与 L1→L3 完整阶梯见 references/anti-detection.md。
    // 只改指纹不改断言；运行命令不变，门禁计数照常。
    //
    // launchOptions: {
    //   args: ['--disable-blink-automation=AutomationControlled'],  // L1：去自动化标记
    //   // channel: 'chrome',                                       // L2：真实零售 Chrome
    // },
    // userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    //   + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',      // L1：去 HeadlessChrome 标记
    // locale: 'zh-CN',                                              // L1：指纹一致性（三件套）
    // timezoneId: 'Asia/Shanghai',
    // ─────────────────────────────────────────────────────────
  },

  projects: [
    // 默认只跑 chromium（性价比最高）；跨浏览器矩阵按需解注释
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // 本机浏览器备选通道（v0.13.12，setup-playwright.mjs --install chrome 配套）：
    // 复用本机安装的零售 Chrome/Edge，**零浏览器下载**——测试语义与 Chromium
    // 完全一致，门禁照常识别。网络受限/沙盒环境优先考虑此通道。
    // 反检测视角（L2）它还能消除 HeadlessChrome 系统性指纹差异，详见
    // references/anti-detection.md 与 references/stealth.fixture.ts。
    // { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    // { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'msedge' } },
    // { name: 'firefox',   use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit',    use: { ...devices['Desktop Safari'] } },
    // 移动视口回归（响应式断点验证）
    // { name: 'mobile',    use: { ...devices['Pixel 7'] } },
  ],

  // 开发服务器自动管理：测试前拉起、结束后回收。
  // reuseExistingServer: 本地复用已在跑的 dev server（热更新状态下跑测试更快），CI 强制新起。
  // 注意（v0.13.12）：dev server 的端口监听在 Codex 沙盒下默认被拒——首次运行被拒
  // 时按沙盒协议向用户呈报命令与目的请求授权提权（勿重试勿绕过）；授权后重跑即可。
  webServer: {
    // [TODO] 项目启动命令：读 package.json scripts.dev / scripts.start
    command: 'npm run dev',
    // [TODO] 与 command 实际监听端口一致（且与 use.baseURL 对齐）
    port: 5173,
    reuseExistingServer: !isCI,
    timeout: 120_000,   // 冷启动（依赖安装/首次构建）给足窗口
    stdout: 'ignore',   // 服务器日志不污染测试输出；排障时可改 'pipe'
  },
});
