/**
 * audit.mjs — 审计与事件总线：hook-audit.json（锁内读-合并-写、上限 500 条）、events.jsonl（2 MiB 滚动）、全局审计
 * 分层：L2 状态层（依赖：paths / util / atomic）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { asScope, sdlcDir } from './paths.mjs';
import { safeJsonParse } from './util.mjs';
import { tryAuditLock, writeJsonExclusive, atomicWriteFileExclusive } from './atomic.mjs';

// ─────────────────────────────────────────────
// 审计 + 事件总线（scope 感知：task 模式写入任务目录，legacy 写入 .sdlc/）
// v0.10.0：读-改-写加锁（O_EXCL lockfile + 过期锁清理 + 兜底直写）。
//   原子写只防「读到半写 JSON」，不防两个 hook 同时读旧数组各推一条后互盖——
//   异步 PostToolUse/Stop 并发收尾时后写者胜、前一条丢失。锁内重读→合并→写，
//   将「条目不丢」从注释承诺变为机制保证；锁异常时降级为旧行为（丢单条不丢文件）。
//   .lock 同受 PreToolUse 运行时状态保护（伪造/预植入锁无法阻断审计——未获锁即直写）。
// ─────────────────────────────────────────────
/** 追加一条审计（锁内读-合并-写；上限 500 条防无限增长） */
function appendAuditEntry(p, entry) {
  const arr = existsSync(p) ? safeJsonParse(readFileSync(p, 'utf8')) || [] : [];
  arr.push({ ts: new Date().toISOString(), ...entry });
  const trimmed = arr.length > 500 ? arr.slice(-500) : arr;
  atomicWriteJson(p, trimmed);
}

export function appendAudit(scopeOrRoot, entry) {
  const s = asScope(scopeOrRoot);
  const p = join(s.stateDir, 'hook-audit.json');
  const lock = tryAuditLock(p);
  try { appendAuditEntry(p, entry); } catch {}
  if (lock) { try { rmSync(lock, { force: true }); } catch {} }
}

/** 原子写 JSON 工具（v0.9.0 起走 writeJsonExclusive 加固底座；失败静默） */
function atomicWriteJson(p, obj) {
  writeJsonExclusive(p, obj);
}

export function appendEvent(scopeOrRoot, type, payload) {
  const s = asScope(scopeOrRoot);
  const p = join(s.stateDir, 'events.jsonl');
  const line = JSON.stringify({ ts: new Date().toISOString(), type, ...payload });
  try {
    appendFileSync(p, line + '\n', 'utf8');
    // v0.9.0：尺寸滚动截断（防长期项目无限膨胀——审计/快照/失败史均有上限，
    // 事件流此前是唯一无界增长文件）。超限时原子重写保留最近 EVENTS_KEEP_LINES 行。
    try { if (statSync(p).size > EVENTS_MAX_BYTES) rotateEventsFile(p); } catch {}
  } catch {}
}

const EVENTS_MAX_BYTES = 2 * 1024 * 1024;   // events.jsonl 滚动阈值（2 MiB）
const EVENTS_KEEP_LINES = 5000;             // 滚动后保留最近行数

/** events.jsonl 滚动截断（保留尾部行 + 事件留痕），原子写底座 */
function rotateEventsFile(p) {
  const lines = String(readFileSync(p, 'utf8')).split('\n').filter(l => l.trim());
  const keep = lines.slice(-EVENTS_KEEP_LINES);
  keep.push(JSON.stringify({ ts: new Date().toISOString(), type: 'events_rotated', dropped: Math.max(0, lines.length - keep.length) }));
  atomicWriteFileExclusive(p, keep.join('\n') + '\n');
}

/** 全局审计（会话绑定等项目级事件，固定写 .sdlc/ 根；同样走锁内读-合并-写） */
export function appendGlobalAudit(projectRoot, entry) {
  const p = join(sdlcDir(projectRoot), 'hook-audit.json');
  const lock = tryAuditLock(p);
  try { appendAuditEntry(p, entry); } catch {}
  if (lock) { try { rmSync(lock, { force: true }); } catch {} }
}
