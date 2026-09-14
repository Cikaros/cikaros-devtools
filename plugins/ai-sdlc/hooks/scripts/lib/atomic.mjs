/**
 * atomic.mjs — 原子写底座 + 跨进程锁：O_EXCL 临时文件原子写（防符号链接 TOCTOU）、lockfile 退避重试、锁内读-改-写（mutateJsonFile，hooks 与 MCP 经同一把锁）
 * 分层：L1 基础设施（依赖：util）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, statSync, rmSync, renameSync,
  openSync, writeSync, closeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { safeJsonParse, readTextBomSafe } from './util.mjs';

/**
 * v0.9.0 原子写核心（安全加固）——取代 v0.5.1 的固定名 `<path>.tmp` 方案。
 *
 * 修复的攻击面（符号链接预植入 TOCTOU）：
 *   旧实现 tmp 名固定可预测，且 writeFileSync 会跟随已存在的符号链接。
 *   攻击路径：实施阶段 Bash 允许写命令 → agent 执行
 *   `ln -s ~/.bashrc .sdlc/state.json.tmp` → 后续任一 hook 的原子写跟随符号
 *   链接 → 绕过 PreToolUse 对 `.sdlc/**` 运行时状态的写保护，实现任意文件
 *   写入。防御（三重）：
 *     1. tmp 名含 pid + 8 hex 随机 → 攻击者无法预测路径，预植入无从谈起
 *     2. openSync(tmp, 'wx')（O_CREAT|O_EXCL）→ 即使撞名也拒绝跟随任何
 *        已存在文件/符号链接（EEXIST 直接失败）
 *     3. renameSync 只替换目录项、不跟随目标符号链接 → 最终落点不可逃逸
 *   并发红利：不同进程 tmp 名必然不同 → v0.5.1 共享 tmp 在并发写同目标时
 *   的「数据交叉后 rename」竞态一并消除。
 */
export function writeJsonExclusive(p, obj) {
  return atomicWriteFileExclusive(p, JSON.stringify(obj, null, 2));
}

/** @see writeJsonExclusive（本文件内所有状态/索引/审计 JSON 写入的统一底座） */
export function atomicWriteFileExclusive(p, data) {
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  let fd = -1;
  try {
    fd = openSync(tmp, 'wx');                 // O_EXCL：tmp 已存在（含符号链接）→ EEXIST
    writeSync(fd, data);
    closeSync(fd); fd = -1;
    renameSync(tmp, p);                        // 只替换目录项，不跟随目标符号链接
    return true;
  } catch {
    if (fd >= 0) { try { closeSync(fd); } catch {} }
    try { rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}
const AUDIT_LOCK_STALE_MS = 5000;

/** 同步等待（零依赖：Atomics.wait 主线程可用；Node 无 sync sleep） */
function syncSleep(ms) {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch { /* 极端环境退化忙等 */ const t = Date.now() + ms; while (Date.now() < t) {} }
}

/**
 * 尝试获取审计锁（O_EXCL；含过期锁清理与短退避重试）。
 * v0.13.4：v0.10.0 只试 2 次（间隔微秒级）——并发 hook 在锁被持的几毫秒内
 *   即降级为无锁直写，后写覆盖前写丢条目（实测 10 并发约 1/6 概率丢 1 条）。
 *   修复：退避重试（默认 16 次 × 6ms ≈ 96ms 预算）把竞争窗口压缩到可忽略；
 *   持锁写操作毫秒级完成，10 并发排队串行化绰绰有余；超预算仍降级直写
 *   （保留「丢单条不丢文件」的兜底语义，不死锁）。
 * @returns {string|null} 锁文件路径（null = 未获锁，降级直写）
 */
export function tryAuditLock(p, { retries = 16, delayMs = 6 } = {}) {
  const lock = `${p}.lock`;
  for (let i = 0; i < retries; i++) {
    try {
      const fd = openSync(lock, 'wx');
      try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
      return lock;
    } catch {}
    // 未获锁：清理疑似过期锁（>5s：持有进程崩溃遗留）
    try {
      if (Date.now() - statSync(lock).mtimeMs > AUDIT_LOCK_STALE_MS) rmSync(lock, { force: true });
    } catch {}
    // 短退避后重试（压缩并发竞争窗口；锁正常被持时等待持有者写完释放）
    if (i < retries - 1) syncSleep(delayMs);
  }
  return null;
}
// ─────────────────────────────────────────────
// v0.13.5 跨进程读-改-写锁（X-lock 修复）
//   v0.13.4 的审计锁只保护 hook-audit.json；state.json / tasks.json /
//   quick-tasks.json / session-map.json / cycles.json 的「读→改→写」此前
//   无锁——MCP server（常驻进程）与 hook 进程（每次工具调用 spawn）在
//   Codex 并行工具调用 / 双会话同项目场景下互盖：丢阶段推进、丢
//   sdlc_engaged、丢队列条目、丢会话绑定（后写者用旧快照覆盖前写者）。
//   原子写只防「读到半写文件」，防不了两个进程都读到合法旧值各改各的。
//   本节把审计锁机制（O_EXCL lockfile + 过期清理 + 退避重试）泛化为
//   mutateJsonFile：锁内 读（BOM 安全）→ mutator 改 → 原子写 → 释放。
//   降级语义与审计锁一致：极端竞争超预算 → 无锁执行（丢单次合并不丢
//   文件），绝不死锁。MCP 端经 ESM 桥复用本函数 → 两端同一把锁。
// ─────────────────────────────────────────────

/**
 * 跨进程锁内读-改-写任意状态 JSON 文件。
 *   mutator(cur) 返回新对象 → 原子写入并返回之；返回 null/undefined → 放弃写入。
 *   文件缺失或损坏 → cur = fallback（调用方给默认值；不给则 null）。
 *   mutator 抛异常 → 不写入，返回 null（状态文件保持原样，错误被吞——
 *   与本文件其他 IO 的静默容错惯例一致）。
 * @param {string} p 目标文件绝对路径
 * @param {(cur:any)=>any} mutator
 * @param {{fallback?:any}} [opts]
 * @returns {any|null} 已写入的新对象（null = 未写入）
 */
export function mutateJsonFile(p, mutator, { fallback = null } = {}) {
  if (typeof mutator !== 'function') return null;
  const lock = tryAuditLock(p);
  try {
    let cur = fallback;
    if (existsSync(p)) cur = safeJsonParse(readTextBomSafe(p)) ?? fallback;
    const next = mutator(cur);
    if (next == null) return null;
    return writeJsonExclusive(p, next) ? next : null;
  } catch { return null; }
  finally { if (lock) { try { rmSync(lock, { force: true }); } catch {} } }
}
