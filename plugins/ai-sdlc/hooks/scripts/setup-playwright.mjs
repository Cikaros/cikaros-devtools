#!/usr/bin/env node
/**
 * setup-playwright.mjs — Playwright 受控安装 CLI（v0.13.12）
 *
 * 背景（用户需求）：本地环境一般没有 Playwright 相关依赖。直接让 agent 现场
 *   `npm install -D @playwright/test && npx playwright install chromium` 有两个
 *   问题：① 装不装、装什么，应当**由用户抉择**（agent 不得自作主张拉取上百 MB
 *   的浏览器二进制）；② 安装命令需要网络访问，Codex 沙盒默认拒绝——agent 应
 *   请求用户授权提权运行，而不是反复重试或绕过。
 *
 * 三步协议（skills/frontend-e2e/SKILL.md §3 的机器侧落点）：
 *   第一步  node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --check [project-root]
 *           只读检测：包管理器 / @playwright_test / 浏览器缓存 / 本机 Chrome・Edge。
 *           **plan 模式（Stage 3a）白名单已豁免本形态**（isControlledProbeSeg）
 *   第二步  agent 把报告 + 三选项（A full / B chrome / C skip）呈报用户，等待抉择
 *   第三步  node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs
 *             --install <full|chrome|skip> --yes [project-root]
 *           受控执行。`--yes` 是用户已明确选择的**显式凭证**——缺省时脚本拒绝
 *           执行退出 1（防 agent 未经询问就安装；这是「交由用户抉择」的强制点）
 *
 * 通道与豁免语义（pre-tool-use.mjs）：
 *   - --check / --help：规则 1b plan 模式豁免（只读探测）
 *   - --install：不豁免——plan 模式仍拦（写 package.json + 网络下载属带副作用
 *     操作，Stage 3b 起才合法）；执行时走 spawnSync(stdio inherit)，Codex 沙盒
 *     的拒绝输出直接透传可见
 *
 * 网络失败指引：安装子命令失败且输出含网络失败特征时，打印沙盒授权应对协议
 *   （与 lib/sandbox.mjs 的注入文案同源语义），exit code 透传不吞。
 *
 * 幂等性：已装 @playwright/test 跳过装包；缓存已有 chromium 跳过下载
 *   （installCommands 的步骤裁剪）——重复执行无害。
 *
 * 输出：--check 人读报告（可直接转述给用户）+ 末行 JSON（程序可读）；
 *   --install 执行结果 + 末行 JSON。退出码：0 成功 / 1 协议或参数错误 /
 *   子命令失败码透传。
 */
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildEnvReport, installCommands, detectPackageManager, SELF_ROOT,
} from './lib/playwright-env.mjs';
import { netPortKind, sandboxWarnText } from './lib/sandbox.mjs';

const USAGE = `setup-playwright — Playwright 受控安装（v0.13.12）

用法：
  node setup-playwright.mjs --check [project-root]
      只读环境检测（包管理器 / @playwright/test / 浏览器缓存 / 本机 Chrome・Edge
      + 三个安装选项）。任何阶段可运行；plan 模式白名单已豁免。
  node setup-playwright.mjs --install <full|chrome|skip> --yes [project-root]
      受控安装。full=装包+下载 Chromium；chrome=仅装包（复用本机 Chrome/Edge，
      零浏览器下载）；skip=跳过（输出降级指引）。
      --yes = 用户已明确选择的凭证（必须显式传，缺省拒绝执行）。
  node setup-playwright.mjs --help

协议：安装选项必须先经用户抉择（--check 报告呈报三选项）——agent 不得未经
询问直接 --install。`;

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const flagValue = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

// 参数解析：--check / --install <choice> --yes / --help；非旗标首参视为 project-root
function parseArgs() {
  const mode = hasFlag('--check') ? 'check'
    : hasFlag('--install') ? 'install'
    : (hasFlag('--help') || hasFlag('-h') ? 'help' : null);
  const choice = flagValue('--install');
  const positional = args.filter(a => !a.startsWith('-')
    && a !== choice && a !== flagValue('--install'));
  const projectRoot = positional.length > 0 ? resolve(positional[0]) : process.cwd();
  return { mode, choice, yes: hasFlag('--yes'), projectRoot };
}

const parsed = parseArgs();

if (parsed.mode === 'help' || parsed.mode === null) {
  process.stdout.write(USAGE + '\n');
  process.exit(parsed.mode === 'help' ? 0 : 1);
}

const envReport = buildEnvReport(parsed.projectRoot);

// ═══════════════════════════════════════════════════════════
// --check：只读检测报告（人读 + JSON 尾行）
// ═══════════════════════════════════════════════════════════
if (parsed.mode === 'check') {
  const r = envReport;
  const L = [];
  L.push('[ai-sdlc] Playwright 环境检测（只读，未做任何修改）');
  L.push(`项目根：${parsed.projectRoot}`);
  L.push(`包管理器：${r.package_manager.pm}（${r.package_manager.via}）`);
  L.push(`@playwright/test：${r.deps.has_test_pkg ? `已安装 ${r.deps.version || ''}`.trim() : '未安装'}`);
  L.push(`浏览器缓存（${r.browsers_cache.dir}）：${r.browsers_cache.exists
    ? (r.browsers_cache.chromium ? `已有 chromium${r.browsers_cache.families.length > 1 ? `（含 ${r.browsers_cache.families.join(' / ')}）` : ''}` : `存在但无 chromium（${r.browsers_cache.families.join(' / ') || '空'}）`)
    : '不存在'}`);
  L.push(`本机 Chrome：${r.system_browsers.chrome ? r.system_browsers.chrome : '未检测到'}`);
  L.push(`本机 Edge：${r.system_browsers.edge ? r.system_browsers.edge : '未检测到'}`);
  L.push(`环境就绪度：${r.ready ? '✅ ' : '❌ '}${r.ready_detail}`);
  L.push('');
  L.push('安装选项（**请把以上报告与本表转述给用户，等待用户抉择**——不得未经询问直接安装）：');
  for (const o of r.options) {
    L.push(`  ${o.label}`);
    L.push(`    网络：${o.net}`);
    L.push(`    ${o.desc}`);
  }
  L.push('');
  L.push(`用户选择后执行：node ${SELF_ROOT}/hooks/scripts/setup-playwright.mjs --install <full|chrome|skip> --yes`);
  L.push('（沙盒提示：安装命令需要网络访问，Codex 沙盒默认拒绝——被拒时向用户请求授权提权运行，勿重试勿绕过）');
  process.stdout.write(L.join('\n') + '\n');
  process.stdout.write(JSON.stringify({
    ok: true, mode: 'check', project_root: parsed.projectRoot,
    package_manager: r.package_manager.pm,
    has_test_pkg: r.deps.has_test_pkg,
    browsers_cache: { exists: r.browsers_cache.exists, chromium: r.browsers_cache.chromium },
    system_chrome: !!r.system_browsers.chrome, system_edge: !!r.system_browsers.edge,
    ready: r.ready,
    options: r.options.map(o => o.id),
  }) + '\n');
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════
// --install：受控执行（--yes 为用户抉择凭证）
// ═══════════════════════════════════════════════════════════
const VALID_CHOICES = ['full', 'chrome', 'skip'];

if (!VALID_CHOICES.includes(parsed.choice)) {
  process.stderr.write(`[ai-sdlc] --install 需要选项参数 <${VALID_CHOICES.join('|')}>\n\n${USAGE}\n`);
  process.exit(1);
}
if (!parsed.yes) {
  process.stderr.write(
    '[ai-sdlc] setup-playwright 拒绝执行：缺少 --yes。\n' +
    '安装选项必须先经**用户明确抉择**（先跑 --check 把环境报告与三选项呈报用户），\n' +
    '用户选择后再加 --yes 执行。agent 不得未经询问直接安装。\n');
  process.exit(1);
}

const pmInfo = detectPackageManager(parsed.projectRoot);
const plan = installCommands(parsed.choice, pmInfo, envReport);

process.stdout.write(`[ai-sdlc] setup-playwright --install ${parsed.choice}（用户已抉择）\n`);
process.stdout.write(`项目根：${parsed.projectRoot} · 包管理器：${pmInfo.pm}\n`);

if (plan.skip_reason) {
  process.stdout.write(`跳过安装：${plan.skip_reason}\n`);
  process.stdout.write(JSON.stringify({ ok: true, mode: 'install', choice: parsed.choice, executed: [], skipped: true }) + '\n');
  process.exit(0);
}
if (plan.steps.length === 0) {
  process.stdout.write('环境已就绪（依赖与浏览器均已可用），无需执行任何安装命令。\n');
  process.stdout.write(JSON.stringify({ ok: true, mode: 'install', choice: parsed.choice, executed: [], skipped: false, already_ready: true }) + '\n');
  process.exit(0);
}

// 逐命令执行：stdio inherit（Codex 沙盒拒绝输出直接透传）；失败扫描网络特征 → 授权指引
const executed = [];
let failed = null;
for (const step of plan.steps) {
  process.stdout.write(`\n▶ 执行：${step.cmd}\n  （${step.note}）\n`);
  // 网络类命令预警（与 PreToolUse 规则 0f 同源文案——脚本子进程不经 hook，就地提示）
  if (netPortKind(step.cmd) === 'network') {
    process.stdout.write(sandboxWarnText(step.cmd, 'network', SELF_ROOT) + '\n');
  }
  const child = spawnSync(step.cmd, { shell: true, stdio: 'inherit', cwd: parsed.projectRoot });
  const code = child.status === null ? 1 : child.status;
  executed.push({ cmd: step.cmd, exit_code: code });
  if (code !== 0) {
    failed = { cmd: step.cmd, exit_code: code };
    process.stdout.write(
      `\n[ai-sdlc] 命令失败（exit ${code}）。若输出含网络/沙盒拒绝特征（network access is disabled /\n` +
      `sandbox denied / EPERM / EACCES / ENOTFOUND …）：这是 Codex 沙盒的网络拦截——请向用户呈报\n` +
      `该命令与目的，请求授权提权运行后重试；不要改写命令绕过沙盒。\n`);
    break;
  }
}

process.stdout.write('\n' + JSON.stringify({
  ok: !failed, mode: 'install', choice: parsed.choice, executed,
  failed: failed || undefined,
}) + '\n');
process.exit(failed ? failed.exit_code : 0);
