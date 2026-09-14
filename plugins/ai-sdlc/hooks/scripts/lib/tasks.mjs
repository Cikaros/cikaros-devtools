/**
 * tasks.mjs — 任务索引与会话亲和：tasks.json（active 指针）、create/switch/close（隔离区 .sdlc/tasks/<id>/）、session-map（LRU 200，键归一化防原型污染）、resolveScope 四级作用域路由
 * 分层：L4 任务层（依赖：paths / util / state / atomic / cycles）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { join, resolve } from 'node:path';
import { slugify, sessionMapKey } from './util.mjs';
import { sdlcDir, taskDirOf, asScope } from './paths.mjs';
import { readGlobalJson, writeGlobalJson, mutateTaskIndex,
  writeCodexState, defaultState } from './state.mjs';
import { mutateJsonFile } from './atomic.mjs';
import { archiveCycleArtifacts } from './cycles.mjs';

const SESSION_MAP_LIMIT = 200;   // session-map LRU 上限

// ─────────────────────────────────────────────
// 任务索引（.sdlc/tasks.json：active_task_id 指针 + 任务清单）
// ─────────────────────────────────────────────

export function readTaskIndex(projectRoot) {
  return readGlobalJson(projectRoot, 'tasks.json') || { active_task_id: null, tasks: [] };
}

export function writeTaskIndex(projectRoot, idx) {
  return writeGlobalJson(projectRoot, 'tasks.json', idx);
}

export function listTasks(projectRoot) {
  return readTaskIndex(projectRoot).tasks
    .filter(t => t.status !== 'deleted');
}

/**
 * 创建任务（隔离区 .sdlc/tasks/<id>/）
 * @returns {{ id, dir, task, index }} | { error }
 */
export function createTask(projectRoot, { name, note } = {}) {
  const now = new Date().toISOString();
  // v0.13.5 X-lock：唯一性判定与索引追加全部锁内执行（并发 createTask 不再撞 id /
  //   互盖丢任务条目；task.json / state.json 为新建文件，原子写即可无需 RMW 锁）
  const created = {};
  const result = mutateTaskIndex(projectRoot, (idx0) => {
    const idx = idx0 || { active_task_id: null, tasks: [] };
    let id = slugify(name);
    // 唯一性：重名追加 -2 / -3 …
    const existing = new Set((idx.tasks || []).map(t => t.id));
    if (existing.has(id)) {
      for (let n = 2; ; n++) { if (!existing.has(`${id}-${n}`)) { id = `${id}-${n}`; break; } }
    }
    const dir = taskDirOf(projectRoot, id);
    const task = {
      id, name: String(name || id).slice(0, 80),
      note: note ? String(note).slice(0, 200) : null,
      status: 'active',
      created_at: now,
      updated_at: now,
      cycle_count: 0,      // 已归档周期数
      cycle_id: 'cycle-001', // 当前活动周期标识
      bound_sessions: 0,
    };
    idx.tasks.push(task);
    idx.active_task_id = id;   // 新建即成为 MCP 上下文的活跃任务
    idx.updated_at = now;
    created.id = id; created.dir = dir; created.task = task;
    return idx;
  });
  if (!result) return { id: null, dir: null, task: null, index: null };
  const { id, dir, task } = created;
  // 任务初始状态：全量默认 schema（v0.10.0 单一事实源——含 current_stage=planning，
  // 否则首次工件写入时 savedStageId 退化为工件检测值，推进链断裂）
  const taskScope = { mode: 'task', taskId: id, taskDir: dir, taskRel: `.sdlc/tasks/${id}`, stateDir: dir, projectRoot: resolve(projectRoot) };
  writeCodexState(taskScope, 'task.json', task);
  writeCodexState(taskScope, 'state.json', {
    ...defaultState(),
    sdlc_engaged: true,
    sdlc_engaged_at: now,
    cycle_id: 'cycle-001',
  });
  return { id, dir, task, index: result };
}

/** 按 id 查任务记录 */
export function getTask(projectRoot, taskId) {
  return readTaskIndex(projectRoot).tasks.find(t => t.id === taskId) || null;
}

/** 切换活跃任务指针（MCP 上下文）。v0.13.5 X-lock：锁内读-改-写 */
export function switchTask(projectRoot, taskId) {
  let found = null;
  const result = mutateTaskIndex(projectRoot, (idx0) => {
    const idx = idx0 || { active_task_id: null, tasks: [] };
    const t = (idx.tasks || []).find(x => x.id === taskId && x.status === 'active');
    if (!t) return null;   // 不存在/已关闭 → 不写
    idx.active_task_id = taskId;
    idx.updated_at = new Date().toISOString();
    found = t;
    return idx;
  });
  if (!found) return { ok: false, error: `任务不存在或已关闭: ${taskId}` };
  return { ok: !!result, task: found };
}

/** 关闭任务（归档工件可选；任务目录保留为审计记录，status=closed）
 *  v0.13.5 X-lock：归档在 tasks.json 锁外执行（archive 只动 state/cycles——锁序无嵌套），
 *  状态标记锁内执行且重验（并发 close 幂等）。 */
export function closeTask(projectRoot, taskId, { archive = true, archiveDir } = {}) {
  const pre = readTaskIndex(projectRoot).tasks.find(t => t.id === taskId);
  if (!pre) return { ok: false, error: `任务不存在: ${taskId}` };
  if (pre.status === 'closed') return { ok: true, already: true, task: pre };

  let archived = null;
  if (archive) {
    const scope = scopeForTask(projectRoot, taskId);
    archived = archiveCycleArtifacts(scope, { archiveDir, reason: 'task_close' });
  }
  let out = null;
  const result = mutateTaskIndex(projectRoot, (idx0) => {
    const idx = idx0 || { active_task_id: null, tasks: [] };
    const t = (idx.tasks || []).find(x => x.id === taskId);
    if (!t) return null;   // 并发下任务消失：放弃
    if (t.status === 'closed') { out = { already: true, task: t }; return null; }   // 并发 close：幂等
    t.status = 'closed';
    t.closed_at = new Date().toISOString();
    t.updated_at = t.closed_at;
    if (idx.active_task_id === taskId) idx.active_task_id = null;
    idx.updated_at = t.closed_at;
    out = t;
    return idx;
  });
  if (out && out.already) return { ok: true, already: true, task: out.task, archived };
  return { ok: !!result, task: out, archived };
}
// ─────────────────────────────────────────────
// 会话映射（.sdlc/session-map.json：session_id → task_id，LRU 200）
// ─────────────────────────────────────────────

export function readSessionMap(projectRoot) {
  return readGlobalJson(projectRoot, 'session-map.json') || { sessions: {} };
}

/** 绑定会话 → 任务（并解绑同任务上的陈旧会话绑定，防漂移）。v0.13.5 X-lock：锁内读-改-写 */
export function bindSession(projectRoot, sessionId, taskId) {
  if (!sessionId || !taskId) return false;
  const key = sessionMapKey(sessionId);   // v0.9.0：键归一化（防 __proto__/constructor 键逃逸）
  const written = mutateJsonFile(join(sdlcDir(projectRoot), 'session-map.json'), (map0) => {
    const map = map0 && map0.sessions ? map0 : { sessions: {} };
    map.sessions[key] = { task_id: taskId, bound_at: new Date().toISOString() };
    // LRU：超过上限按 bound_at 淘汰最旧
    const keys = Object.keys(map.sessions);
    if (keys.length > SESSION_MAP_LIMIT) {
      const sorted = keys.sort((a, b) => map.sessions[a].bound_at.localeCompare(map.sessions[b].bound_at));
      for (const k of sorted.slice(0, keys.length - SESSION_MAP_LIMIT)) delete map.sessions[k];
    }
    return map;
  }, { fallback: { sessions: {} } });
  return !!written;
}

export function unbindSession(projectRoot, sessionId) {
  if (!sessionId) return false;
  const key = sessionMapKey(sessionId);   // v0.9.0：与 bindSession 同键归一化，两侧一致
  // v0.13.5 X-lock：锁内读-改-写（与 bindSession 同锁——并发 bind/unbind 不互盖）
  const written = mutateJsonFile(join(sdlcDir(projectRoot), 'session-map.json'), (map0) => {
    const map = map0 && map0.sessions ? map0 : { sessions: {} };
    if (!Object.prototype.hasOwnProperty.call(map.sessions, key)) return null;   // 无绑定 → 不写
    delete map.sessions[key];
    return map;
  }, { fallback: { sessions: {} } });
  return !!written;
}

/** 任务作用域对象构造 */
export function scopeForTask(projectRoot, taskId) {
  const projectRootAbs = resolve(projectRoot);
  const dir = taskDirOf(projectRootAbs, taskId);
  return {
    mode: 'task', taskId, taskDir: dir,
    taskRel: `.sdlc/tasks/${taskId}`,
    stateDir: dir, projectRoot: projectRootAbs,
  };
}

/**
 * 四级作用域路由（v0.5.0 隔离核心）：
 *   1. env SDLC_TASK（CI / 脚本显式指定）
 *   2. session-map：本会话已绑定 → 恢复该任务上下文
 *   3. SessionStart source=resume + 存在活跃任务 → 续绑活跃任务
 *   4. legacy（默认：项目根 .sdlc/，与 v0.4.0 行为完全一致）
 *
 * @returns {scope} 附加字段：
 *   - bindSource：'env'|'session-map'|'resume'|'legacy'
 *   - envMissing：env 指定的任务不存在（回退 legacy，供上层提示）
 *   - activeTaskId：当前活跃任务（供「未绑定新会话」提示切换）
 */
export function resolveScope(projectRoot, input = {}) {
  const projectRootAbs = resolve(projectRoot);
  const sessionId = input.session_id || null;
  const idx = readTaskIndex(projectRootAbs);

  // 1. env 显式指定
  const envTask = process.env.SDLC_TASK;
  if (envTask) {
    const t = idx.tasks.find(x => x.id === envTask && x.status === 'active');
    if (t) return { ...scopeForTask(projectRootAbs, envTask), bindSource: 'env', activeTaskId: idx.active_task_id };
    const legacy = asScope(projectRootAbs);
    return { ...legacy, bindSource: 'legacy', envMissing: envTask, activeTaskId: idx.active_task_id };
  }

  // 2. 会话已绑定 → 恢复（v0.9.0：与 bindSession 同键归一化，两侧一致）
  if (sessionId) {
    const map = readSessionMap(projectRootAbs);
    const bound = map.sessions[sessionMapKey(sessionId)];
    if (bound) {
      const t = idx.tasks.find(x => x.id === bound.task_id && x.status === 'active');
      if (t) return { ...scopeForTask(projectRootAbs, bound.task_id), bindSource: 'session-map', activeTaskId: idx.active_task_id };
      // 绑定的任务已关闭 → 解绑并回退 legacy
      unbindSession(projectRootAbs, sessionId);
    }
  }

  // 3. resume 续绑：用户恢复会话的明确意图 = 继续活跃任务
  if (sessionId && (input.source === 'resume' || input.resume === true)) {
    if (idx.active_task_id) {
      const t = idx.tasks.find(x => x.id === idx.active_task_id && x.status === 'active');
      if (t) {
        bindSession(projectRootAbs, sessionId, idx.active_task_id);
        return { ...scopeForTask(projectRootAbs, idx.active_task_id), bindSource: 'resume', activeTaskId: idx.active_task_id };
      }
    }
  }

  // 4. legacy（新会话不自动吸附活跃任务——防多会话互相污染，由用户显式切换）
  const legacy = asScope(projectRootAbs);
  return { ...legacy, bindSource: 'legacy', activeTaskId: idx.active_task_id };
}
