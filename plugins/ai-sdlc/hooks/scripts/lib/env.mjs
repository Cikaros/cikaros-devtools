/**
 * env.mjs — ai-sdlc 运行环境画像与跨平台脚本护栏（v0.13.2，零依赖，Node 18+）
 *
 * 背景：插件同时携带 sh（macOS/Linux）与 ps1（Windows）两套脚本。仅凭文件
 * 扩展名或 OS 一刀切会误伤真实环境（Windows 装了 Git Bash/WSL 时 .sh 完全
 * 可用；macOS/Linux 装了 pwsh 时 .ps1 也可用）——v0.13.2 起由 hook 层在
 * **运行时探测真实能力**，按能力放行/拦截：
 *
 *   ① detectEnvironment()：平台 + POSIX shell / PowerShell 可用性探测
 *      （PATH 扫描 + Windows 常见 Git Bash/WSL 落点探测，全部 existsSync，
 *      单次 < 1ms；每个 hook 进程独立调用一次，无需缓存）
 *   ② scriptPlatformViolation(command, profile)：纯函数，判定命令中是否存在
 *      「本环境注定失败」的脚本执行段（bash/sh/wsl 启动器、直接执行 .sh、
 *      powershell/pwsh 启动器、直接执行 .ps1）。只匹配**执行**形态——
 *      cat/ls/grep 等读取 .sh 路径不误伤
 *   ③ scriptGuardMessage(violation, profile)：拦截文案 + 精确替代方案
 *      （插件脚本的 ps1/sh 孪生映射存在时优先推荐；否则 MCP 免 shell 通道）
 *   ④ envSummaryLine / envConstraintLines：SessionStart 注入用摘要行
 *
 * 设计原则（与插件整体一致：准确 > 规范 > 快速 > 高效 > 精简）：
 *   - 能力感知而非 OS 盲判：Windows + Git Bash → .sh 放行；Linux + pwsh →
 *     .ps1 放行；拦截只发生在「探测确认不可用」时
 *   - 误伤面最小化：不碰非执行形态；node *.mjs / 任意跨平台命令不受影响
 *   - 纯函数可测：scriptPlatformViolation 接受注入的合成 profile，
 *     测试无需真实切换平台（test-triage.sh 场景 20）
 */

import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 插件根（hooks/scripts/lib/ 上溯 3 级；与 common.mjs 同构自定位，保持本模块零耦合） */
const SELF_ROOT = resolve(__dirname, '..', '..', '..');

const PATH_SEP = process.platform === 'win32' ? ';' : ':';

/** PATH 扫描（Windows 的 PATH 变量名大小写不保证，两个都查） */
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

/**
 * 运行环境画像（每个 hook 进程调用一次，成本 = 数个 existsSync）。
 *   hasPosixShell：macOS/Linux 恒 true（/bin/sh 必有）；Windows 探测
 *   bash.exe / sh.exe / wsl.exe（PATH + Git for Windows 常见落点）。
 *   hasPowerShell：Windows 恒 true（powershell.exe 全系预装）；
 *   macOS/Linux 探测 pwsh（微软官方跨平台发行版）。
 * @param {object} [env] 环境变量（默认 process.env；测试可注入）
 * @returns {{platform,platformLabel,isWindows,isMacOS,isLinux,hasPosixShell,posixShellVia,hasPowerShell,powerShellVia}}
 */
export function detectEnvironment(env = process.env) {
  const isWindows = process.platform === 'win32';
  const isMacOS = process.platform === 'darwin';
  const isLinux = !isWindows && !isMacOS;

  let hasPosixShell = !isWindows;
  let posixShellVia = isWindows ? null : 'system /bin/sh';
  let hasPowerShell = false;
  let powerShellVia = null;

  if (isWindows) {
    // POSIX shell：PATH 上的 bash/sh/wsl（System32\bash.exe = WSL，天然在 PATH）
    const viaExe = findInPath('bash.exe', env) || findInPath('sh.exe', env) || findInPath('wsl.exe', env);
    if (viaExe) {
      hasPosixShell = true;
      posixShellVia = `PATH:${viaExe}`;
    } else {
      // Git for Windows 常见落点（PATH 未含 bin 的安装形态）
      const pf = env.ProgramFiles || 'C:\\Program Files';
      const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const la = env.LOCALAPPDATA || '';
      const candidates = [
        join(pf, 'Git', 'bin', 'bash.exe'),
        join(pf, 'Git', 'usr', 'bin', 'bash.exe'),
        join(pf86, 'Git', 'bin', 'bash.exe'),
        join(env.SystemRoot || 'C:\\Windows', 'System32', 'bash.exe'),  // WSL
      ];
      if (la) candidates.push(join(la, 'Programs', 'Git', 'bin', 'bash.exe'));
      for (const c of candidates) {
        if (existsSync(c)) { hasPosixShell = true; posixShellVia = c; break; }
      }
    }
    // PowerShell：Windows 全系预装 powershell.exe（无需探测）
    hasPowerShell = true;
    powerShellVia = 'powershell.exe（Windows 预装）';
  } else {
    const pwsh = findInPath('pwsh', env) || findInPath('pwsh.exe', env);
    if (pwsh) { hasPowerShell = true; powerShellVia = `PATH:${pwsh}`; }
  }

  return {
    platform: process.platform,
    platformLabel: isWindows ? 'Windows' : isMacOS ? 'macOS' : 'Linux',
    isWindows, isMacOS, isLinux,
    hasPosixShell, posixShellVia,
    hasPowerShell, powerShellVia,
  };
}

// ─────────────────────────────────────────────
// 脚本平台护栏（纯函数）
// ─────────────────────────────────────────────

/** 段内首 token 归一化：剥引号、取 basename、去 .exe 后缀 */
function headTokenOf(segment) {
  const tokens = String(segment).trim().split(/\s+/);
  let i = 0;
  // 剥离环境变量前缀（FOO=bar）与 sudo（不影响待执行的解释器判定）
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || /^sudo$/i.test(tokens[i]))) i++;
  const head = (tokens[i] || '').replace(/^["']|["']$/g, '');
  const base = head.split(/[\\/]/).pop() || head;
  return base.replace(/\.exe$/i, '').toLowerCase();
}

const POSIX_LAUNCHERS = /^(bash|sh|zsh|dash|ash|wsl|git-bash)$/;
const PS_LAUNCHERS = /^(powershell|pwsh)$/;
const SOURCE_LAUNCHERS = /^(source|\.)$/;

/**
 * 判定命令是否存在「本环境注定失败」的脚本执行段。
 *   拆段规则与 pre-tool-use 的 Bash 加固一致（&& / || / ; / | / 换行）。
 *   只匹配执行形态：launcher 头（bash/sh/…/powershell/pwsh）、source、
 *   或段首 token 直接以 .sh/.ps1 结尾（./x.sh、x.ps1）。
 *   cat/ls/grep/node 等头 + .sh 路径参数 = 读取/解释执行，不在拦截面。
 * @param {string} command Bash 工具命令
 * @param {object} [profile] detectEnvironment() 结果（默认现场探测）
 * @returns {null|{kind:'sh'|'ps1', segment:string, launcher:string, head:string}}
 */
export function scriptPlatformViolation(command, profile = detectEnvironment()) {
  const c = String(command || '');
  if (!c) return null;
  const segs = c.split(/&&|\|\||;|\||\n/).map(s => s.trim()).filter(Boolean);
  for (const seg of segs) {
    const head = headTokenOf(seg);
    if (!head) continue;

    // ① POSIX shell 依赖段
    const needsPosix = POSIX_LAUNCHERS.test(head)
      || SOURCE_LAUNCHERS.test(head)     // source/. x.sh 依赖当前 POSIX shell
      || /\.sh$/i.test(head);            // 段首直接执行 .sh（./x.sh、x.sh）
    if (needsPosix && !profile.hasPosixShell) {
      return { kind: 'sh', segment: seg, launcher: head, head };
    }

    // ② PowerShell 依赖段
    const needsPs = PS_LAUNCHERS.test(head)
      || /\.ps1$/i.test(head);           // 段首直接执行 .ps1
    if (needsPs && !profile.hasPowerShell) {
      return { kind: 'ps1', segment: seg, launcher: head, head };
    }
  }
  return null;
}

/** 插件脚本的孪生映射：scripts/sh/x.sh → scripts/ps/x.ps1（孪生存在才推荐） */
function psTwinFor(segment) {
  const m = String(segment).match(/(scripts[\/\\]sh[\/\\][\w.-]+\.sh)/i);
  if (!m) return null;
  const twin = m[1].replace(/scripts[\/\\]sh[\/\\]/i, 'scripts/ps/').replace(/\.sh$/i, '.ps1');
  try { if (existsSync(join(SELF_ROOT, twin))) return twin.replace(/\\/g, '/'); } catch {}
  return null;
}

/** 反向孪生：scripts/ps/x.ps1 → scripts/sh/x.sh */
function shTwinFor(segment) {
  const m = String(segment).match(/(scripts[\/\\]ps[\/\\][\w.-]+\.ps1)/i);
  if (!m) return null;
  const twin = m[1].replace(/scripts[\/\\]ps[\/\\]/i, 'scripts/sh/').replace(/\.ps1$/i, '.sh');
  try { if (existsSync(join(SELF_ROOT, twin))) return twin.replace(/\\/g, '/'); } catch {}
  return null;
}

/** 环境画像一行摘要（注入与拦截文案共用） */
export function envSummaryLine(profile) {
  const posix = profile.hasPosixShell ? 'bash/sh ✓' : 'bash/sh ✗';
  const ps = profile.hasPowerShell ? 'PowerShell ✓' : 'PowerShell ✗';
  return `${profile.platformLabel} · ${posix} · ${ps}`;
}

/**
 * SessionStart 注入用的约束行（只列「本机确实不可用」的约束，全可用则空数组）。
 * @returns {string[]}
 */
export function envConstraintLines(profile) {
  const out = [];
  if (!profile.hasPosixShell) {
    out.push('- ⚠️ 本机无 POSIX shell：**勿执行 `.sh` / bash / sh / wsl 命令**（会报错）——等价能力用 `scripts/ps/*.ps1` 或 MCP 工具（Node fs 免 shell，三平台一致）；误调用会被 PreToolUse 自动拦截并给出替代');
  }
  if (!profile.hasPowerShell) {
    out.push('- ⚠️ 本机无 PowerShell：**勿执行 `.ps1` / powershell / pwsh 命令**（会报错）——等价能力用 `scripts/sh/*.sh` 或 MCP 工具（Node fs 免 shell）');
  }
  return out;
}

/**
 * 护栏拦截文案（含精确替代方案；供 PreToolUse block 输出）。
 * @param {{kind:'sh'|'ps1', segment:string}} violation
 * @param {object} profile detectEnvironment() 结果
 * @returns {string}
 */
export function scriptGuardMessage(violation, profile) {
  const seg = String(violation.segment || '').slice(0, 120);
  const head = [
    `[ai-sdlc] 跨平台脚本护栏：当前环境无法执行该命令段（探测确认，会直接报错）：`,
    `  ${seg}`,
    `环境画像（hook 运行时自检）：${envSummaryLine(profile)}`,
    ``,
    `替代方案（按优先级）：`,
  ];
  const body = [];
  if (violation.kind === 'sh') {
    const twin = psTwinFor(violation.segment);
    if (twin) body.push(`  1. 等价 PowerShell 脚本：\`${twin}\`（powershell -ExecutionPolicy Bypass -File …）`);
    body.push(`${twin ? '  2' : '  1'}. MCP 工具通道（Node fs 免 shell，三平台一致）——如手册注册直接调 \`register_prompts\`，状态查询调 \`status\``);
    body.push(`${twin ? '  3' : '  2'}. 如确需 bash：安装 Git for Windows（含 Git Bash）或启用 WSL 后重试`);
  } else {
    const twin = shTwinFor(violation.segment);
    if (twin) body.push(`  1. 等价 POSIX 脚本：\`${twin}\`（bash …）`);
    body.push(`${twin ? '  2' : '  1'}. MCP 工具通道（Node fs 免 shell，三平台一致）——如手册注册直接调 \`register_prompts\`，状态查询调 \`status\``);
    body.push(`${twin ? '  3' : '  2'}. 如确需 PowerShell：安装 pwsh（PowerShell for macOS/Linux）后重试`);
  }
  return [...head, ...body, ``, `本护栏按运行时能力探测放行（装了 Git Bash/WSL 的 Windows 可正常跑 .sh，装了 pwsh 的 macOS/Linux 可正常跑 .ps1），仅拦截探测确认不可用的调用。完整说明见插件 docs/usage-guide.md「跨平台脚本护栏」。`].join('\n');
}
