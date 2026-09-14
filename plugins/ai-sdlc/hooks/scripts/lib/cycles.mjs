/**
 * cycles.mjs — 周期归档与会话快照：archiveCycleArtifacts（工件永不删除，归档轮转 + cycle-meta 审计链）、newCycle（状态机重置 + cycle_count+1）、listCycles、会话快照（保留 50 个）
 * 分层：L3 领域层（依赖：paths / util / state / atomic / audit）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync,
  copyFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stamp, safeSessionId, fileMtime } from './util.mjs';
import { asScope, sdlcDir, ARTIFACT_CANDIDATES } from './paths.mjs';
import { readCodexState, defaultState, mutateCodexState, mutateTaskIndex,
  readGlobalJson } from './state.mjs';
import { mutateJsonFile } from './atomic.mjs';
import { appendEvent, appendGlobalAudit } from './audit.mjs';

const SESSION_SNAPSHOT_LIMIT = 50; // 会话快照保留上限

// ─────────────────────────────────────────────
// 周期归档（工件永不删除——归档轮转，详见 docs/lifecycle.md）
// ─────────────────────────────────────────────

/** 当前 scope 下的工件候选查找（scope 感知版，供归档使用；v0.10.0 候选表单源化） */
function scopedArtifactCandidates(scope, name) {
  const s = asScope(scope);
  const base = ARTIFACT_CANDIDATES[name] || [name];
  if (s.mode === 'task') return [join(s.taskRel, name), ...base];
  return base;
}

function findScopedArtifact(scope, name) {
  const s = asScope(scope);
  for (const rel of scopedArtifactCandidates(scope, name)) {
    const p = join(s.projectRoot, rel);
    if (existsSync(p) && statSync(p).isFile()) return { path: p, rel };
  }
  return null;
}

/** 跨设备安全移动（rename 失败回退 copy+rm） */
function moveFile(from, to) {
  try { renameSync(from, to); return true; } catch {}
  try { copyFileSync(from, to); rmSync(from, { force: true }); return true; } catch { return false; }
}

/**
 * 归档当前周期的工件（不删除任何文件）。
 * @param {object} scope
 * @param {object} opts
 *   - keep: 不归档的工件名列表（如 maintain 闭环时保留新写的 intent.md）
 *   - archiveDir: 归档根目录（默认 .sdlc/archive，不进版本控制；可传 docs/sdlc/archive 迁回仓库）
 *   - reason: 归档原因（audit 记录）
 * @returns {{ archived: [{name, from, to}], dir, cycle }} | null（无工件可归档）
 */
export function archiveCycleArtifacts(scope, opts = {}) {
  const s = asScope(scope);
  const state = readCodexState(s, 'state.json') || {};
  const keep = new Set(opts.keep || []);
  const names = ['intent.md', 'spec.md', 'plan.md', 'REVIEW.md'].filter(n => !keep.has(n));

  const found = [];
  for (const n of names) {
    const f = findScopedArtifact(s, n);
    if (f) found.push({ name: n, ...f });
  }
  if (found.length === 0) return null;

  const cycleNo = (state.cycle_count || 0) + 1;
  const cycleId = `cycle-${String(cycleNo).padStart(3, '0')}`;
  // v0.10.0：归档默认 .sdlc/archive（工件与运行时统一不进版本控制；显式传
  // docs/sdlc/archive 仍可迁回仓库内归档——治理团队要 PR 可审查的归档链时用）
  const archiveRoot = resolve(s.projectRoot, opts.archiveDir || '.sdlc/archive');
  // v0.5.1：stamp 只计算一次——两次调用跨秒边界时归档目录名与 cycles.json id 不一致
  const dirStamp = stamp();
  const dir = join(archiveRoot, `${cycleId}-${dirStamp}`);
  try { mkdirSync(dir, { recursive: true }); } catch { return null; }

  const archived = [];
  for (const f of found) {
    const to = join(dir, f.name);
    if (moveFile(f.path, to)) archived.push({ name: f.name, from: f.rel, to: relative(s.projectRoot, to) });
  }
  // 周期元数据（审计链：cycle-meta.json）
  try {
    writeFileSync(join(dir, 'cycle-meta.json'), JSON.stringify({
      cycle: cycleNo, cycle_id: cycleId,
      scope: s.mode === 'task' ? { type: 'task', task_id: s.taskId } : { type: 'project' },
      final_stage: state.current_stage || null,
      closed_at: new Date().toISOString(),
      reason: opts.reason || 'new_cycle',
      artifacts: archived,
    }, null, 2), 'utf8');
  } catch {}

  // 周期索引（全局）。v0.13.5 X-lock：锁内读-改-写（并发归档不丢周期条目）
  mutateJsonFile(join(sdlcDir(s.projectRoot), 'cycles.json'), (cycles0) => {
    const cycles = cycles0 && Array.isArray(cycles0.cycles) ? cycles0 : { cycles: [] };
    cycles.cycles.push({
      id: `${cycleId}-${dirStamp}`, cycle_no: cycleNo,
      task_id: s.mode === 'task' ? s.taskId : null,
      final_stage: state.current_stage || null,
      ended_at: new Date().toISOString(),
      archive_dir: relative(s.projectRoot, dir),
      artifacts: archived.map(a => a.name),
      reason: opts.reason || 'new_cycle',
    });
    if (cycles.cycles.length > 200) cycles.cycles = cycles.cycles.slice(-200);
    return cycles;
  }, { fallback: { cycles: [] } });

  return { archived, dir: relative(s.projectRoot, dir), cycle: cycleNo };
}

/**
 * 开启新周期（用户显式驱动：归档旧工件 → 重置状态机 → cycle_count+1）。
 * 语义：新需求 / 下一轮迭代。保留 sdlc_engaged（迭代延续，工作流仍在参与）。
 * @returns {{ ok, cycle, archived, archive_dir, note }}
 */
export function newCycle(scope, opts = {}) {
  const s = asScope(scope);
  const result = archiveCycleArtifacts(s, opts);

  // v0.13.5 X-lock：状态重置锁内执行且从锁内新鲜值取 oldState——初始读与写入
  //   之间的并发更新（如 MCP 置 release_approval）不再被旧快照覆盖回退
  let cycleNo = 0;
  let cycleId = null;
  mutateCodexState(s, 'state.json', (cur) => {
    const oldState = cur || {};
    cycleNo = (oldState.cycle_count || 0) + 1;
    cycleId = `cycle-${String(cycleNo).padStart(3, '0')}`;
    // v0.10.0：基于 defaultState() 组装（字段集与全插件一致）；周期语义覆盖项——
    // 迭代延续：工作流参与状态不重置（区别于 reset 的完整退出语义）
    const fresh = {
      ...defaultState(),
      previous_stage: oldState.current_stage || null,
      created_at: oldState.created_at || new Date().toISOString(),
      cycle_count: cycleNo,            // 已完成周期数
      cycle_id: cycleId,               // 当前活动周期
      sdlc_engaged: true,
      sdlc_engaged_at: oldState.sdlc_engaged_at || new Date().toISOString(),
      artifact_history: opts.keep_history ? (oldState.artifact_history || []) : [],
      // v0.7.0 测试门禁与循环中断：
      //   test_failures 跨周期保留——「有问题进入下一个 intent」后若同一失败
      //   签名在新周期再现（窗口内重复 ≥2），仍判定为循环并中断（intent 迭代
      //   没有解决问题，不能无休止迭代下去）
      //   fix_rounds / fix_loop / test_runs 按周期重置（新周期重新计数与授权）
      test_failures: Array.isArray(oldState.test_failures) ? oldState.test_failures : [],
      fix_loop_resolutions: oldState.fix_loop_resolutions || [],
    };
    return fresh;
  });
  if (!cycleNo) { cycleNo = 1; cycleId = 'cycle-001'; }   // 极端写入失败时的展示兼容

  // 任务索引同步周期计数（v0.13.5 X-lock：锁内读-改-写）
  if (s.mode === 'task') {
    mutateTaskIndex(s.projectRoot, (idx0) => {
      const idx = idx0 || { active_task_id: null, tasks: [] };
      const t = (idx.tasks || []).find(x => x.id === s.taskId);
      if (!t) return null;
      t.cycle_count = cycleNo; t.cycle_id = cycleId; t.updated_at = new Date().toISOString();
      idx.updated_at = t.updated_at;
      return idx;
    });
  }

  appendEvent(s, 'new_cycle', {
    cycle: cycleNo, task: s.taskId,
    archived: result ? result.archived.map(a => a.name) : [],
    archive_dir: result ? result.dir : null,
  });
  appendGlobalAudit(s.projectRoot, {
    hook: 'lifecycle', trigger: 'new_cycle',
    result: 'success',
    detail: { cycle: cycleNo, task: s.taskId, archived: result ? result.archived.length : 0 },
  });

  return {
    ok: true, cycle: cycleNo, cycle_id: cycleId,
    archived: result ? result.archived : [],
    archive_dir: result ? result.dir : null,
    note: result
      ? `周期 ${cycleNo - 1} 的 ${result.archived.length} 个工件已归档到 ${result.dir}/（未删除；.sdlc/ 归档不进版本控制），状态机已重置为 planning。`
      : `当前周期无可归档工件，状态机已重置为 planning（周期 ${cycleNo}）。`,
  };
}
// ─────────────────────────────────────────────
// 会话快照（session-end 归档，保留最近 50 个）
// ─────────────────────────────────────────────

export function saveSessionSnapshot(projectRoot, snapshot) {
  const dir = join(sdlcDir(projectRoot), 'sessions');
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { return false; }
  const p = join(dir, `${safeSessionId(snapshot.session_id)}-${stamp()}.json`);
  try { writeFileSync(p, JSON.stringify(snapshot, null, 2), 'utf8'); } catch { return false; }
  // v0.5.1 修复：清理超额快照按 mtime 排序（最旧先删）。
  // 此前按文件名排序——文件名前缀是会话 ID，同会话快照会连续排列，
  // 导致「先删光某个会话的全部快照（无论新旧），保留其他会话的陈旧快照」。
  try {
    const entries = readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, m: fileMtime(join(dir, f)) }))
      .sort((a, b) => a.m - b.m);
    if (entries.length > SESSION_SNAPSHOT_LIMIT) {
      for (const { f } of entries.slice(0, entries.length - SESSION_SNAPSHOT_LIMIT)) {
        rmSync(join(dir, f), { force: true });
      }
    }
  } catch {}
  return true;
}

export function listCycles(projectRoot) {
  return (readGlobalJson(projectRoot, 'cycles.json') || { cycles: [] }).cycles;
}
