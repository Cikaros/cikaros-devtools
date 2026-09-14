# frontend-e2e — 调试与 CI 速查

> 本文件是 SKILL.md §9/§10 的展开参考，调试卡壳或配置 CI 时读取。
> 反检测（机器人检测拦截）不在本速查范围内——见 references/anti-detection.md。

## 1. 调试命令速查

| 场景 | 命令 | 说明 |
|------|------|------|
| 看失败 trace | `npx playwright show-trace test-results/<case>/trace.zip` | 逐帧 DOM/网络/控制台/耗时；config 已设 `on-first-retry` 自动采集 |
| 交互式调试 | `npx playwright test --ui` | 时间旅行、watch 模式、逐用例树 |
| 单步调试器 | `npx playwright test --debug` | Playwright Inspector，步进每条指令 |
| 只跑失败用例 | `npx playwright test --last-failed` | 修复后最小回归 |
| 按标题过滤 | `npx playwright test --grep "提交表单"` | 用例标题即过滤契约（命名规范的价值） |
| 单浏览器 | `npx playwright test --project=chromium` | 排除浏览器矩阵噪声 |
| 看报告 | `npx playwright show-report` | 本地 HTML 报告（注意：不计入测试执行） |

## 2. trace 文件在哪个

- `trace: 'on-first-retry'`（模板默认）：失败用例第一次重试时采集
- 落点：`test-results/<spec-name>-<title>-chromium/trace.zip`（`outputDir` 配置）
- CI 中把 `test-results/` 整目录作为 artifact 上传，失败 PR 附 trace 链接——
  审查者不用复现就能看现场（机械证据原则）

## 3. 常见失败模式与定位

| 症状 | 大概率原因 | 取证路径 |
|------|-----------|---------|
| `locator.waitFor: Timeout` 但人工看页面正常 | 选择器指向错误元素/竞态未走断言重试 | trace 的 before/after DOM 快照对比 |
| CI 红、本地绿 | 资源争抢/时区/环境变量/`localhost` 差异 | CI 用 `workers:1` + `video: 'retain-on-failure'` 复现 |
| 全绿但页面白屏 | 断言过弱（只断 URL 不断内容） | 补 `getByTestId('app-root')` 可见性断言 |
| 间歇性 flaky | 时间等待/未隔离的用例依赖 | 检查 `waitForTimeout`/共享 storageState |
| 断言超时但 trace 截图是「Checking your browser…」挑战页/403 | **机器人检测拦截**（非实现 bug）：WAF/Cloudflare/DataDome 识别了 Playwright 默认指纹 | ① trace 网络面板看 403 response headers（`cf-mitigated`/`x-ddos` 等）确认拦截方 ② 按反检测阶梯加固（见 `references/anti-detection.md` §1 症状判别 → L1→L2→L3 逐层验证 + §4 指纹自检用例） |
| 有头模式能过、headless 全挂 | headless 指纹（UA 含 `HeadlessChrome`、`navigator.webdriver=true`、plugins=0） | 反检测 L1（UA/init scripts）→ 仍挂再上 L2（`channel: 'chrome'`） |
| OAuth 登录页（Google/微软）直接拒绝或循环跳转 | 登录提供商的反自动化（极常见） | 反检测 L2 起步 + 登录收敛到 setup spec + storageState |

## 4. CI 配置要点（GitHub Actions 示例）

```yaml
# .github/workflows/e2e.yml
name: e2e
on:
  pull_request:
    paths:
      - 'e2e/**'            # 与持续评估口径一致：套件本身变更必须回归
      - 'src/**'
      - 'playwright.config.ts'
      - 'AGENTS.md'          # 配置引导代理的文件变更值得回归（Stage 4 规则）
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()        # 失败才上传，省存储
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 14
```

要点：

1. `--with-deps`：连系统依赖（字体/编解码库）一起装，避免 CI 缺字体导致截图全差异
2. 浏览器缓存：`~/.cache/ms-playwright` 可加 `actions/cache`（提速 1-2 分钟）
3. `CI=true` 是模板差异化开关（新起 webServer / workers=1 / 重试 2 次）自动生效
4. 失败 artifact 保留 14 天：trace 会过期，事件复盘请归档关键 trace（Stage 6 的
   incident 流程）
5. CI 需要 L2 反检测通道（真实 Chrome）时：`npx playwright install chromium` 换成
   安装零售 Chrome（`browser-actions/setup-chrome@v3` 或 apt 装 `google-chrome-stable`），
   config 里 `channel: 'chrome'` 会自动定位；详见 `references/anti-detection.md` §2 L2
