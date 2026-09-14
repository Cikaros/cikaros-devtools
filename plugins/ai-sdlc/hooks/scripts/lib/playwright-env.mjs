/**
 * playwright-env.mjs — Playwright 环境探测与受控安装支持（v0.13.12）
 * 分层：L0 纯函数层（依赖：node:fs / node:path 只读探测；零副作用）
 *
 * 背景（用户需求）：本地环境一般没有 Playwright 相关依赖，直接让 agent 现场
 *   `npm install` 下载既越权（装不装应由用户抉择）又易被 Codex 沙盒拦网络。
 *   本模块为受控安装入口 setup-playwright.mjs 提供：
 *
 *   ① detectPackageManager(projectRoot) —— lockfile 探测包管理器
 *   ② readPlaywrightDeps(projectRoot) —— package.json 依赖检查
 *   ③ detectBrowsersCache(env) —— Playwright 浏览器缓存目录探测（只读）
 *   ④ detectSystemBrowsers(env) —— 本机 Chrome / Edge 探测（channel 备选通道）
 *   ⑤ buildEnvReport(projectRoot, env) —— 汇总报告 + 三安装选项（A 完整 /
 *      B 本机 Chrome 零浏览器下载 / C 跳过）
 *   ⑥ installCommands(plan, pm) —— 按选项生成对应安装命令（供执行层 spawn）
 *
 * 设计约束：
 *   - 全部只读（existsSync / readFileSync / PATH 扫描），--check 可在任何
 *     阶段运行（plan 模式白名单豁免的就是 --check 语义）
 *   - 平台三覆盖：缓存目录与浏览器落点按 darwin / win32 / linux 分别处理
 *   - 误报方向：探测不到 = 如实报 null（agent 呈报用户，由用户抉择），
 *     不猜测、不静默降级
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 插件根（hooks/scripts/lib/ 上溯 3 级；与 common.mjs / env.mjs 同构） */
export const SELF_ROOT = resolve(__dirname, '..', '..', '..');

const PATH_SEP = process.platform === 'win32' ? ';' : ':';

/** PATH 扫描（与 env.mjs 同款；Windows PATH 变量名大小写兼容） */
function findInPath(exe, env) {
  const raw = String(env.PATH || env.Path || '');
  for (const p of raw.split(PATH_SEP)) {
    const dir = p.trim();
    if (dir) {
      try { if (existsSync(join(dir, exe))) return join(dir, exe); } catch {}
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// ① 包管理器探测（lockfile 证据链）
// ═══════════════════════════════════════════════════════════

/**
 * lockfile → 包管理器。无 lockfile（新项目）默认 npm。
 * @param {string} projectRoot
 * @returns {{pm:'npm'|'pnpm'|'yarn'|'bun', lockfile:string|null, via:string}}
 */
export function detectPackageManager(projectRoot) {
  const root = resolve(projectRoot || process.cwd());
  const locks = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ];
  for (const [file, pm] of locks) {
    if (existsSync(join(root, file))) return { pm, lockfile: file, via: `lockfile:${file}` };
  }
  return { pm: 'npm', lockfile: null, via: 'default（无 lockfile）' };
}

// ═══════════════════════════════════════════════════════════
// ② 依赖检查（package.json 只读解析）
// ═══════════════════════════════════════════════════════════

/**
 * package.json 中 Playwright 相关依赖。
 * @param {string} projectRoot
 * @returns {{has_test_pkg:boolean, has_cli_pkg:boolean, version:string|null, package_json:string|null}}
 *   has_test_pkg：@playwright/test（写用例所需）；has_cli_pkg：playwright CLI 包
 */
export function readPlaywrightDeps(projectRoot) {
  const root = resolve(projectRoot || process.cwd());
  const pkgPath = join(root, 'package.json');
  const out = { has_test_pkg: false, has_cli_pkg: false, version: null, package_json: null };
  if (!existsSync(pkgPath)) return out;
  out.package_json = 'package.json';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
    if (deps['@playwright/test']) {
      out.has_test_pkg = true;
      out.version = String(deps['@playwright/test']);
    }
    if (deps['playwright']) {
      out.has_cli_pkg = true;
      out.version = out.version || String(deps['playwright']);
    }
  } catch { /* package.json 损坏：如实报告无依赖 */ }
  return out;
}

// ═══════════════════════════════════════════════════════════
// ③ 浏览器缓存探测（Playwright 标准缓存目录，只读）
// ═══════════════════════════════════════════════════════════

/** 平台默认缓存目录（PLAYWRIGHT_BROWSERS_PATH 显式优先） */
export function browsersCacheDir(env = process.env) {
  const explicit = String(env.PLAYWRIGHT_BROWSERS_PATH || '').trim();
  if (explicit) return explicit;
  const home = String(env.HOME || env.USERPROFILE || '');
  if (process.platform === 'darwin') return join(home, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return join(home, 'AppData', 'Local', 'ms-playwright');
  return join(home, '.cache', 'ms-playwright');
}

/**
 * 浏览器缓存探测：目录存在时列出已缓存的浏览器族（chromium-* / firefox-* /
 * webkit-* / msedge-* 等目录名前缀）。
 * @param {object} [env]
 * @returns {{dir:string, exists:boolean, chromium:boolean, families:string[]}}
 */
export function detectBrowsersCache(env = process.env) {
  const dir = browsersCacheDir(env);
  const out = { dir, exists: false, chromium: false, families: [] };
  try {
    if (!existsSync(dir)) return out;
    out.exists = true;
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
    out.families = entries.map(n => n.replace(/-\d+.*$/, '')).filter((v, i, a) => a.indexOf(v) === i);
    out.chromium = entries.some(n => /^chromium(-|$)/.test(n)) || entries.some(n => /^headless_shell(-|$)/.test(n));
  } catch { /* 无读权限等：如实报告目录不可读 */ }
  return out;
}

// ═══════════════════════════════════════════════════════════
// ④ 本机浏览器探测（channel 备选通道：'chrome' | 'msedge'）
// ═══════════════════════════════════════════════════════════

/** 各平台 Chrome / Edge 可执行文件候选路径（PATH 扫描 + 固定落点） */
export function detectSystemBrowsers(env = process.env) {
  const found = { chrome: null, edge: null };
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const la = env.LOCALAPPDATA || '';

  if (process.platform === 'darwin') {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    found.chrome = existsSync(chrome) ? chrome : findInPath('google-chrome', env);
    found.edge = existsSync(edge) ? edge : findInPath('microsoft-edge', env);
  } else if (process.platform === 'win32') {
    const chromeCandidates = [
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const edgeCandidates = [
      join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    found.chrome = chromeCandidates.find(c => existsSync(c)) || findInPath('chrome.exe', env) || null;
    found.edge = edgeCandidates.find(c => existsSync(c)) || null;
  } else {
    const chromeNames = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
    const edgeNames = ['microsoft-edge', 'microsoft-edge-stable'];
    found.chrome = chromeNames.map(n => findInPath(n, env)).find(Boolean) || null;
    found.edge = edgeNames.map(n => findInPath(n, env)).find(Boolean) || null;
  }
  return found;
}

// ═══════════════════════════════════════════════════════════
// ⑤ 汇总报告（--check 输出）与 ⑥ 安装命令生成
// ═══════════════════════════════════════════════════════════

/**
 * 环境汇总报告（--check 的数据形态；呈现层由 setup-playwright.mjs 负责）。
 * @param {string} [projectRoot]
 * @param {object} [env]
 * @returns {{package_manager, deps, browsers_cache, system_browsers,
 *   ready:boolean, ready_detail:string, options:Array<{id:'full'|'chrome'|'skip',label:string,net:string,desc:string}>}}
 */
export function buildEnvReport(projectRoot, env = process.env) {
  const pm = detectPackageManager(projectRoot);
  const deps = readPlaywrightDeps(projectRoot);
  const cache = detectBrowsersCache(env);
  const sys = detectSystemBrowsers(env);

  const ready = deps.has_test_pkg && (cache.chromium || !!sys.chrome || !!sys.edge);
  let ready_detail;
  if (deps.has_test_pkg && cache.chromium) ready_detail = `已装 @playwright/test ${deps.version || ''} 且浏览器缓存已有 chromium`.trim();
  else if (deps.has_test_pkg && (sys.chrome || sys.edge)) ready_detail = `已装 @playwright/test ${deps.version || ''}；无浏览器缓存但本机有 ${sys.chrome ? 'Chrome' : 'Edge'}（channel 通道可用）`.trim();
  else if (deps.has_test_pkg) ready_detail = '已装 @playwright/test 但无可用浏览器（选 A 下载 chromium 或 B 用本机 Chrome）';
  else ready_detail = '未安装 @playwright/test';

  const options = [
    {
      id: 'full', label: 'A · 完整安装',
      net: '需要网络（下载 Chromium 约 100–170MB + npm 包）',
      desc: '安装 @playwright/test 并下载 Chromium 本体——开箱即用，不依赖本机浏览器。',
    },
    {
      id: 'chrome', label: 'B · 本机浏览器通道（推荐优先考虑）',
      net: sys.chrome || sys.edge
        ? `需要网络（仅 npm 包几 MB；浏览器零下载——复用本机 ${sys.chrome ? 'Chrome' : 'Edge'}）`
        : '未检测到本机 Chrome/Edge——本选项不可用，请选 A 或 C',
      desc: `只安装 @playwright/test 包，配置 \`channel:'${sys.chrome ? 'chrome' : 'msedge'}'\` 复用本机浏览器运行（测试语义与 Chromium 完全一致，门禁照常识别）。`,
    },
    {
      id: 'skip', label: 'C · 跳过安装',
      net: '零网络',
      desc: '不安装任何依赖。改用项目既有测试套件满足门禁；或 chrome --headless CLI 自助取证（仅作辅助证据，不满足测试门禁的 test_runs 计数）。',
    },
  ];

  return { package_manager: pm, deps, browsers_cache: cache, system_browsers: sys, ready, ready_detail, options };
}

/**
 * 安装命令生成（受控执行层使用；**纯生成不执行**）。
 * @param {'full'|'chrome'|'skip'} choice
 * @param {{pm:'npm'|'pnpm'|'yarn'|'bun'}} pmInfo detectPackageManager 结果
 * @param {{deps:object, browsers_cache:{chromium:boolean}}} report buildEnvReport 结果
 * @returns {{steps:Array<{cmd:string, note:string}>, skip_reason:string|null}}
 *   幂等优化：已装包跳过装包步骤；缓存已有 chromium 跳过下载步骤。
 */
export function installCommands(choice, pmInfo, report) {
  const pm = (pmInfo && pmInfo.pm) || 'npm';
  const addCmd = {
    npm: 'npm install -D @playwright/test',
    pnpm: 'pnpm add -D @playwright/test',
    yarn: 'yarn add -D @playwright/test',
    bun: 'bun add -D @playwright/test',
  }[pm];
  const execCmd = {
    npm: 'npx playwright install chromium',
    pnpm: 'pnpm exec playwright install chromium',
    yarn: 'yarn playwright install chromium',
    bun: 'bunx playwright install chromium',
  }[pm];

  if (choice === 'skip') {
    return {
      steps: [],
      skip_reason: '用户选择跳过安装——按 frontend-e2e 技能 §3 的降级路径执行（既有套件满足门禁或如实报告无法测试），不得伪造测试结果。',
    };
  }
  const steps = [];
  if (!(report && report.deps && report.deps.has_test_pkg)) {
    steps.push({ cmd: addCmd, note: '安装 @playwright/test（npm 包，几 MB）' });
  }
  if (choice === 'full' && !(report && report.browsers_cache && report.browsers_cache.chromium)) {
    steps.push({ cmd: execCmd, note: '下载 Chromium 本体（约 100–170MB，需网络授权）' });
  }
  return { steps, skip_reason: null };
}
