#!/usr/bin/env node
/**
 * notify-mac-setup.mjs — macOS 通知宿主 applet 的惰性生成与首弹（v0.13.8）
 *
 * 由 notify.mjs 的 dispatchMacOS 在 applet 未就绪时**脱钩派发**（detached +
 * stdio ignore + unref）：本进程的耗时不阻塞 Stop hook 主流程。首条通知
 * 延迟约 0.5s（osacompile 编译 + Info.plist 补丁 + 原子落位），此后所有
 * 通知走 applet 快路径（毫秒级）。
 *
 * 用法（argv）：
 *   node notify-mac-setup.mjs <title> <body>
 *
 * 流程（全程同步——detached 进程内无需异步）：
 *   1. 就绪检测：applet 可执行文件存在 + Info.plist 版本标记与 plugin.json
 *      一致（升版自愈：标记不匹配 → 重新生成，与 prompts 注册同哲学）
 *   2. 生成：mkdtemp 临时目录 → osacompile -o <tmp>/ai-sdlc-notifier.app
 *      （每行一个 -e，源码来自 notify.mjs buildAppletSource——单一事实源）→
 *      Info.plist 文本补丁（LSUIElement / DisplayName / BundleID / 版本标记，
 *      patchInfoPlist 纯函数）→ rename 原子落位（并发：rename 失败 = 已有
 *      赢家落位，直接用现成的）
 *   3. 首弹：spawnSync applet [title, body]
 *   4. 降级：生成或首弹失败 → osascript 直发（点击会打开 Script Editor——
 *      保底语义，lifecycle.md 披露；声音由 notify.mjs 主进程 afplay 独立
 *      派发，本进程不重复播放）
 *
 * 边界：本文件仅在 macOS 上被调用（dispatchMacOS 守卫 process.platform）；
 * 非 macOS 下误执行直接静默退出。零插件状态库依赖（仅 notify.mjs 的纯函数
 * 与 node 内置模块），通知链路独立于 .sdlc/ 状态体系。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  appletCacheDir, appletExecutable, appletPath, buildAppletSource, escapeAppleScript,
  notifierVersion, patchInfoPlist,
} from './notify.mjs';

const [title = 'ai-sdlc', body = ''] = process.argv.slice(2);

if (process.platform !== 'darwin') {
  // 守卫：仅 macOS 有意义（osacompile/afplay 均不存在）——静默退出
  process.exit(0);
}

/**
 * 确保 applet 就绪（幂等 + 升版自愈）。
 * @returns {boolean} applet 可执行文件是否可用
 */
function ensureApplet() {
  const exe = appletExecutable();
  const plistPath = join(dirname(exe), '..', 'Info.plist');   // Contents/Info.plist
  const wantMark = notifierVersion();
  if (existsSync(exe) && existsSync(plistPath)) {
    try {
      if (readFileSync(plistPath, 'utf8').includes(wantMark)) return true;   // 就绪
    } catch { /* 读失败视为未就绪，走重新生成 */ }
  }

  const cacheDir = appletCacheDir();
  try { mkdirSync(cacheDir, { recursive: true }); } catch { return false; }
  const tmp = mkdtempSync(join(tmpdir(), 'sdlc-notify-'));
  try {
    const tmpApp = join(tmp, 'ai-sdlc-notifier.app');
    const args = ['-o', tmpApp];
    for (const line of buildAppletSource()) args.push('-e', line);
    const compiled = spawnSync('osacompile', args, { stdio: 'ignore', timeout: 15000 });
    const tmpPlist = join(tmpApp, 'Contents', 'Info.plist');
    if (compiled.status !== 0 || !existsSync(tmpPlist)) return false;

    // Info.plist 补丁（LSUIElement 无感 agent / 显示名 / bundle id / 版本标记）
    try {
      writeFileSync(tmpPlist, patchInfoPlist(readFileSync(tmpPlist, 'utf8'), wantMark));
    } catch { /* 补丁失败用原 plist——功能可用，仅交互降级（Dock 图标闪现） */ }

    // 原子落位：并发赢家已就位时 rename 失败 → 用现成的
    try { renameSync(tmpApp, appletPath()); } catch { /* EEXIST/ENOTEMPTY：赢家已落位 */ }
    return existsSync(exe);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
  }
}

// ─────────────────────────────────────────────
// 主流程：确保宿主 → 首弹 → 保底降级
// ─────────────────────────────────────────────

let shown = false;
if (ensureApplet()) {
  const r = spawnSync(appletExecutable(), [title, body], { stdio: 'ignore', timeout: 10000 });
  shown = r.status === 0;
}
if (!shown) {
  // 保底：osascript 直发（不带 sound name——声音由主进程 afplay 独立通道）
  const as = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`;
  try { spawnSync('osascript', ['-e', as], { stdio: 'ignore', timeout: 10000 }); } catch { }
}
process.exit(0);
