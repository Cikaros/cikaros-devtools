/**
 * util.mjs — 通用工具：stdin/JSON 解析（BOM 安全）、hook 输出、文件小工具、token 估算、id/slug 归一化
 * 分层：L0 基础层（依赖：仅 Node 内置模块）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';

// ─────────────────────────────────────────────
// stdin / JSON
// ─────────────────────────────────────────────

export function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function parseInput() {
  const raw = readStdin();
  try { return raw.trim() ? JSON.parse(raw) : {}; }
  catch { return { _parse_error: true, _raw: raw.slice(0, 500) }; }
}

export function safeJsonParse(text) {
  try {
    // v0.13.5 W-bom：剥 UTF-8 BOM——Windows 工具链（编辑器/PowerShell Out-File）
    //   写入 BOM 后 JSON.parse 直接抛异常，状态全读 null 静默清零
    const t = typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return JSON.parse(t);
  } catch { return null; }
}

/** v0.13.5 W-bom：读文本并剥 UTF-8 BOM（与 safeJsonParse 同防御，供直接 JSON.parse 站点） */
export function readTextBomSafe(p) {
  const t = readFileSync(p, 'utf8');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** 取会话项目根目录：优先 stdin.cwd，其次 process.cwd() */
export function projectRootOf(input) {
  const cwd = input && (input.cwd || input.project_root);
  return resolve(cwd || process.cwd());
}

// ─────────────────────────────────────────────
// hook 输出
// ─────────────────────────────────────────────

export function emitHookOutput(obj) {
  try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch {}
}

export function emitEmpty() {
  try { process.stdout.write('{}\n'); } catch {}
}

// ─────────────────────────────────────────────
// 文件工具
// ─────────────────────────────────────────────

export function fileExists(p) { try { return existsSync(p); } catch { return false; } }

export function fileMtime(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

export function readFileText(p, maxChars = 100000) {
  try {
    const t = readFileSync(p, 'utf8');
    return t.length > maxChars ? t.slice(0, maxChars) + '\n…（截断）' : t;
  } catch { return null; }
}

/** 取文件前 N 行作为摘要（用于注入） */
export function headLines(p, maxLines = 40, maxChars = 1600) {
  const txt = readFileText(p, maxChars * 2);
  if (!txt) return null;
  const lines = txt.split('\n').filter(l => l.trim()).slice(0, maxLines);
  let s = lines.join('\n');
  if (s.length > maxChars) s = s.slice(0, maxChars) + `\n…（截断，完整内容: ${relative(process.cwd(), p) || basename(p)}）`;
  return s;
}

// ─────────────────────────────────────────────
// token 估算（粗略 1 token ≈ 4 chars）
// ─────────────────────────────────────────────

export function estimateTokens(s) { return Math.ceil((s || '').length / 4); }
/** 任务名/任务 ID slug 化：小写 kebab-case，≤40 字符 */
export function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || `task-${stamp()}`;
}

/** 时间戳 yyyymmdd-hhmmss */
export function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** session_id 文件名安全化 */
export function safeSessionId(sid) {
  return String(sid || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * v0.9.0 session-map 键归一化：session_id 作对象键之前必须先过本函数。
 * 背景：session_id 来自 hook 输入（Codex host），并非可信标识。极端值
 * `'__proto__'` 会经 `map.sessions[key] = v` 触发 Object.prototype 的 __proto__
 * setter（改写 map.sessions 原型而非新增键，绑定静默丢失且语义异变）；
 * `constructor` / `prototype` 会命中原型链同名属性。归一化为 [A-Za-z0-9_-]{≤64}
 * （与文件名安全化同规则）并显式中和三个危险字面量（前缀 _），bind/查找
 * 两侧同函数 → 正常 UUID session id（只含 hex 与 -）归一化后不变，存量数据
 * 兼容；异常 id 两侧一致地落到安全形态。
 */
export function sessionMapKey(sessionId) {
  let k = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (!k) return 'unknown';
  // 危险键显式中和：__proto__ / constructor / prototype（归一化字符集不排除它们）
  if (k === '__proto__' || k === 'constructor' || k === 'prototype') k = '_' + k;
  return k;
}
