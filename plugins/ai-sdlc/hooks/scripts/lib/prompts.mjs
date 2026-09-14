/**
 * prompts.mjs — 官方 /prompts: 操作手册注册（跨平台单一事实源）：register/status/remove/ensure（零操作自愈 + opt-out 标记）
 * 分层：L3 领域层（依赖：paths）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
  copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { PLUGIN_ROOT } from './paths.mjs';

// ─────────────────────────────────────────────
// v0.13.1 官方 /prompts: 手册注册（跨平台，单一事实源）
//   背景：v0.13.0 的注册桥只有 bash 脚本（install-prompts.sh），Windows
//   原生不可达。本模块把注册逻辑收敛到 Node fs（hooks 直用、MCP 经 ESM 桥
//   复用，macOS/Linux/Windows 全平台一致）；shell 脚本降级为平台便利品
//   （sh：macOS/Linux；ps1：Windows）。
//   语义与 install-prompts.sh / install-prompts.ps1 完全对齐：
//   register 幂等刷新；remove 只删源名单内的 sdlc-<名>.md（不碰用户
//   其他 prompts）；名单动态扫描 prompts/ 源目录（升版新增手册自动生效）。
//   事件留痕由 MCP 工具层负责（注册是用户级动作，事件落会话项目 .sdlc/）。
// ─────────────────────────────────────────────

const PROMPTS_PREFIX = 'sdlc-';

/** 显式卸载标记（remove 写入 / register 清除；阻止 SessionStart 自动恢复） */
const PROMPTS_OPTOUT_MARKER = '.sdlc-prompts-optout';

/** SDLC_PROMPTS_AUTO=off/off/0/false/no → 关闭自动注册（与 SDLC_NOTIFY 同惯例） */
function promptsAutoDisabled(env = process.env) {
  return /^(0|false|off|no|disabled?)$/i.test(String(env.SDLC_PROMPTS_AUTO || '').trim());
}

/** 用户 prompts 目录（官方 /prompts:<name> 读取处；SDLC_PROMPTS_DIR 可覆盖，测试/自定义用） */
export function defaultPromptsDir() {
  return process.env.SDLC_PROMPTS_DIR || join(homedir(), '.codex', 'prompts');
}

/** 手册名单（动态扫描插件 prompts/ 源目录；源缺失返回空数组） */
export function listPromptManuals() {
  const src = join(PLUGIN_ROOT, 'prompts');
  try {
    return readdirSync(src).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

/** 目标目录归一化：绝对路径；空/含 NUL 返回 null（dir 参数仅接受可写绝对路径） */
function normalizePromptsDir(dir) {
  const raw = String(dir == null ? '' : dir).trim();
  if (!raw || raw.includes('\0')) return null;
  const p = resolve(raw);
  return p ? p : null;
}

/** 注册状态（SessionStart 轻量检查 / register_prompts list 共用）。@param {{dir?:string}} [opts] */
export function promptsRegisterStatus({ dir } = {}) {
  const target = normalizePromptsDir(dir) || defaultPromptsDir();
  const names = listPromptManuals();
  const registered = names.filter(n => existsSync(join(target, PROMPTS_PREFIX + n + '.md')));
  return {
    dir: target,
    total: names.length,
    registered_count: registered.length,
    registered: registered.map(n => PROMPTS_PREFIX + n),
    complete: names.length > 0 && registered.length === names.length,
  };
}

/** 注册/刷新（幂等，覆盖同名；清除 opt-out 标记 = 恢复自动注册）。@returns {ok,count,total,dir,names} | {error} */
export function registerPromptManuals({ dir } = {}) {
  const src = join(PLUGIN_ROOT, 'prompts');
  const names = listPromptManuals();
  if (names.length === 0) return { error: `找不到手册源目录：${src}` };
  const target = normalizePromptsDir(dir) || defaultPromptsDir();
  if (!target) return { error: '非法的 prompts 目录参数（需非空绝对路径）' };
  try {
    mkdirSync(target, { recursive: true });
  } catch (e) {
    return { error: `无法创建目录 ${target}：${e && e.message}` };
  }
  // v0.13.2：显式注册 = 重新授权自动注册（清除卸载标记；缺失不报错）
  try { rmSync(join(target, PROMPTS_OPTOUT_MARKER), { force: true }); } catch {}
  const copied = [];
  for (const n of names) {
    try {
      copyFileSync(join(src, n + '.md'), join(target, PROMPTS_PREFIX + n + '.md'));
      copied.push(n);
    } catch {}
  }
  return {
    ok: true, count: copied.length, total: names.length, dir: target, names: copied,
  };
}

/** 移除本插件注册的手册（只删源名单内的 sdlc-<名>.md；写 opt-out 标记阻止自动恢复）。@returns {ok,count,dir,names} | {error} */
export function removePromptManuals({ dir } = {}) {
  const names = listPromptManuals();
  if (names.length === 0) {
    return { error: `找不到手册源目录（无法确定移除名单）：${join(PLUGIN_ROOT, 'prompts')}——可手动删除目标目录下的 ${PROMPTS_PREFIX}*.md` };
  }
  const target = normalizePromptsDir(dir) || defaultPromptsDir();
  if (!target) return { error: '非法的 prompts 目录参数（需非空绝对路径）' };
  const removed = [];
  for (const n of names) {
    const p = join(target, PROMPTS_PREFIX + n + '.md');
    try {
      if (existsSync(p)) {
        rmSync(p);
        removed.push(n);
      }
    } catch {}
  }
  // v0.13.2：显式卸载 = opt-out（此后 SessionStart 不再自动恢复；标记为隐藏文件，
  //   不影响 prompts 目录的 .md 扫描）。重新注册（register/MCP remove 后再 register）即清除。
  let optOut = false;
  try {
    writeFileSync(join(target, PROMPTS_OPTOUT_MARKER),
      'ai-sdlc：用户已显式卸载操作手册。此标记阻止 SessionStart 自动注册；\n' +
      '重新注册（MCP register_prompts / install-prompts 脚本）会自动删除本文件。\n');
    optOut = true;
  } catch {}
  return { ok: true, count: removed.length, dir: target, names: removed, opt_out: optOut };
}

// ─────────────────────────────────────────────
// v0.13.2 零操作自动注册（SessionStart 自检-自愈；使用者可能什么都不懂，
//   不能要求其手动跑脚本或发指令）
// ─────────────────────────────────────────────

/**
 * SessionStart 自动注册（幂等自愈）：
 *   disabled   环境变量 SDLC_PROMPTS_AUTO=off（用户总关，静默）
 *   no-source  插件手册源目录缺失（异常安装，静默降级）
 *   opted-out  目标目录存在卸载标记（用户显式 remove 过，静默）
 *   skipped    已全部注册且内容与插件当前版本一致（静默，成本 = N×2 次 readFileSync）
 *   registered 首次注册（此前一份都没有）
 *   refreshed  增量刷新（有缺失或内容变化——升版后自动更新）
 *   failed     目录创建/复制失败（返回 error）
 * 只写 sdlc-<名>.md（前缀防撞名），不碰用户其他 prompts。
 * @param {{dir?:string}} [opts]
 * @returns {{action:string, count?:number, total?:number, dir:string, names?:string[], error?:string}}
 */
export function ensurePromptsRegistered({ dir } = {}) {
  if (promptsAutoDisabled()) {
    return { action: 'disabled', dir: normalizePromptsDir(dir) || defaultPromptsDir() };
  }
  const names = listPromptManuals();
  const target = normalizePromptsDir(dir) || defaultPromptsDir();
  if (names.length === 0) {
    return { action: 'no-source', dir: target, error: `找不到手册源目录：${join(PLUGIN_ROOT, 'prompts')}` };
  }
  if (existsSync(join(target, PROMPTS_OPTOUT_MARKER))) {
    return { action: 'opted-out', dir: target };
  }
  // 差量计算：缺失或内容与插件当前版本不一致 → 需同步（升版自愈）
  const pending = [];
  for (const n of names) {
    const src = join(PLUGIN_ROOT, 'prompts', n + '.md');
    const dst = join(target, PROMPTS_PREFIX + n + '.md');
    let need = true;
    try {
      if (existsSync(dst)) need = readFileSync(src, 'utf8') !== readFileSync(dst, 'utf8');
    } catch { need = true; }
    if (need) pending.push(n);
  }
  if (pending.length === 0) {
    return { action: 'skipped', count: 0, total: names.length, dir: target };
  }
  try {
    mkdirSync(target, { recursive: true });
  } catch (e) {
    return { action: 'failed', dir: target, error: String((e && e.message) || e) };
  }
  const hadAny = names.some(n => existsSync(join(target, PROMPTS_PREFIX + n + '.md')));
  const copied = [];
  for (const n of pending) {
    try {
      copyFileSync(join(PLUGIN_ROOT, 'prompts', n + '.md'), join(target, PROMPTS_PREFIX + n + '.md'));
      copied.push(n);
    } catch {}
  }
  if (copied.length === 0) {
    return { action: 'failed', dir: target, error: `复制全部失败（目录权限？）：${target}` };
  }
  return {
    action: hadAny ? 'refreshed' : 'registered',
    count: copied.length, total: names.length, dir: target, names: copied,
  };
}
