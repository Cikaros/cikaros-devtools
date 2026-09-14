/**
 * context.js — sdlc-orchestrator 服务端上下文（CJS）
 *
 * v0.13.6 代码组织轮次从 index.js 拆出：ESM 生命周期桥（common.mjs 单一事实源）、
 * 会话票据 pin 与四级作用域路由、scope 感知状态 IO（含 v0.13.5 X-lock 锁内
 * 读-改-写）、工件扫描与阶段检测、scopeInfo 概要。
 * 可变进程级状态统一收敛在 server-state.js 的 S 容器（与 tools.js 共享读写）。
 * 工具实现见 tools.js；入口见 index.js。版本历史见插件 docs/changes/CHANGELOG.md。
 */

const S = require('./server-state.js');
const { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, openSync, writeSync, closeSync, appendFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { resolve, join, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
const PROJECT_ROOT = process.env.SDLC_PROJECT_ROOT || process.cwd();
const SDLC_DIR = resolve(PROJECT_ROOT, '.sdlc');

// ─────────────────────────────────────────────
// CJS → ESM 桥：复用 hooks/scripts/lib/common.mjs 的生命周期实现
// ─────────────────────────────────────────────

const lifecycleReady = (async () => {
  try {
    const modUrl = pathToFileURL(join(PLUGIN_ROOT, 'hooks', 'scripts', 'lib', 'common.mjs')).href;
    S.lifecycle = await import(modUrl);
    if (S.lifecycle && S.lifecycle.S.ARTIFACT_CANDIDATES) S.ARTIFACT_CANDIDATES = S.lifecycle.S.ARTIFACT_CANDIDATES;
    return true;
  } catch (e) {
    process.stderr.write(`[sdlc-orchestrator] lifecycle bridge failed: ${e && e.message}\n`);
    return false;
  }
})();

/** 生命周期工具守卫：桥接失败时返回明确错误（不静默降级） */
function requireLifecycle() {
  if (!S.lifecycle) {
    throw new Error('lifecycle module unavailable (ESM bridge failed) — task/cycle tools disabled; file an issue with .sdlc/hook-audit.json attached');
  }
  return S.lifecycle;
}

// ─────────────────────────────────────────────
// v0.6.0 会话上下文隔离（进程级 pin + 动态会话路由）
//   每个 Codex 会话 spawn 独立的 MCP server 进程（stdio 1:1），但 MCP 协议
//   不携带会话标识——v0.5 的「全局活跃任务指针」路由会被并发会话互相踩踏。
//   隔离：SessionStart hook 写会话票据（.sdlc/mcp-bind-queue/）→ 本进程首次
//   工具调用 FIFO 原子认领 → pin 会话 → 每次调用动态查 session-map 路由。
//   路由优先级：args.task_id 显式 > env SDLC_TASK > pinned 会话绑定 >
//   tasks.json active 指针（无人认领时的 v0.5 兼容回退）> legacy。
// ─────────────────────────────────────────────


function readTaskIndex() {
  const p = join(SDLC_DIR, 'tasks.json');
  if (!existsSync(p)) return { active_task_id: null, tasks: [] };
  try { return JSON.parse(stripBomCjs(readFileSync(p, 'utf8'))); } catch { return { active_task_id: null, tasks: [] }; }
}

function writeTaskIndexCjs(idx) {
  try { if (!existsSync(SDLC_DIR)) mkdirSync(SDLC_DIR, { recursive: true }); } catch {}
  atomicWriteCjs(join(SDLC_DIR, 'tasks.json'), JSON.stringify(idx, null, 2));
}

/**
 * v0.5.1 原子写；v0.9.0 安全加固（与 hooks 侧 writeJsonExclusive 同语义）：
 *   随机后缀 tmp + openSync 'wx'（O_EXCL）+ rename。修复符号链接预植入 TOCTOU——
 *   旧实现固定名 tmp 可被 `ln -s target .sdlc/tasks.json.tmp` 预植入，writeFileSync
 *   跟随符号链接 → 绕过 MCP 写入隔离实现任意文件写入。随机名不可预测 + O_EXCL
 *   拒绝跟随已存在文件/符号链接 → 攻击面关闭。
 * v0.13.5 M-fallback：删除 O_EXCL/rename 失败后的 writeFileSync 直写回退。
 *   旧回退会跟随目标符号链接（重开 v0.9.0 刚关闭的任意写攻击面）且非原子
 *   （半写可读）；Windows 目标被并发进程占用（杀毒/索引/并发读者）致 rename
 *   失败时真实可达。失败返回 false（与 hooks 侧口径一致），上层容错。
 */
function atomicWriteCjs(p, data) {
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  let fd = -1;
  try {
    fd = openSync(tmp, 'wx');
    writeSync(fd, data);
    closeSync(fd); fd = -1;
    renameSync(tmp, p);
    return true;
  } catch {
    if (fd >= 0) { try { closeSync(fd); } catch {} }
    try { rmSync(tmp, { force: true }); } catch {}
    return false;
  }
}

/** v0.13.5 W-bom：剥 UTF-8 BOM（Windows 工具链写入 BOM 后 JSON.parse 全抛异常，状态读 null） */
function stripBomCjs(text) {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function taskScopeCjs(taskId) {
  const dir = join(SDLC_DIR, 'tasks', taskId);
  return { mode: 'task', taskId, taskDir: dir, taskRel: `.sdlc/tasks/${taskId}`, stateDir: dir, projectRoot: PROJECT_ROOT };
}

function legacyScopeCjs() {
  return { mode: 'legacy', taskId: null, taskDir: null, taskRel: null, stateDir: SDLC_DIR, projectRoot: PROJECT_ROOT };
}

/** 首次工具调用时认领会话票据（FIFO 原子 dequeue；仅一次） */
function ensureSessionPin() {
  if (S.pinnedSession !== null) return;
  if (!S.lifecycle) { S.pinnedSession = false; return; }   // 桥失败 → 无法认领 → 走回退
  const ticket = S.lifecycle.claimMcpBindTicket(PROJECT_ROOT);
  S.pinnedSession = ticket
    ? { session_id: ticket.session_id, source: ticket.source || 'startup', claimed_at: new Date().toISOString(), via: 'ticket' }
    : false;   // false = 尝试过认领但无票（老进程 / hook 未写票 → 走回退）
}

/** pinned 会话当前绑定的任务（动态查 session-map，会话切换绑定后自动跟随） */
function pinnedSessionTaskId() {
  if (!S.pinnedSession || !S.lifecycle) return null;
  const map = S.lifecycle.readSessionMap(PROJECT_ROOT);
  // v0.9.0：键归一化与 hooks 侧 bindSession 一致（防 __proto__/constructor 键逃逸）
  const key = S.lifecycle.sessionMapKey ? S.lifecycle.sessionMapKey(S.pinnedSession.session_id) : String(S.pinnedSession.session_id);
  const bound = Object.prototype.hasOwnProperty.call(map.sessions, key) ? map.sessions[key] : null;
  if (!bound) return null;
  const idx = readTaskIndex();
  const t = idx.tasks.find(x => x.id === bound.task_id && x.status === 'active');
  return t ? bound.task_id : null;
}

/** 是否已 pin 到会话（票据认领或手动绑定） */
function isSessionPinned() {
  return !!S.pinnedSession && S.pinnedSession !== false;
}

/**
 * 统一作用域路由（每次工具调用前由 callTool 入口执行一次）。
 * @param {object} args 工具参数（识别可选 task_id 显式路由）
 */
function routeScope(args) {
  const explicitTaskId = (args && (args.task_id || args.task)) || null;
  const idx = readTaskIndex();

  // 1. 显式参数（agent 传 task_id——最高优先，跨会话协作/纠正场景）
  if (explicitTaskId) {
    const t = idx.tasks.find(x => x.id === explicitTaskId && x.status === 'active');
    if (t) {
      S.currentScope = taskScopeCjs(explicitTaskId);
      S.scopeBindingInfo = { mode: 'explicit-arg', task_id: explicitTaskId, isolated: true };
      return;
    }
    S.currentScope = legacyScopeCjs();
    S.scopeBindingInfo = { mode: 'explicit-arg-missing', task_id: explicitTaskId, isolated: false };
    return;
  }

  // 2. env 显式指定（CI / 脚本——现状保留）
  const envTask = process.env.SDLC_TASK;
  if (envTask) {
    const t = idx.tasks.find(x => x.id === envTask && x.status === 'active');
    if (t) {
      S.currentScope = taskScopeCjs(envTask);
      S.scopeBindingInfo = { mode: 'env', task_id: envTask, isolated: true };
      return;
    }
    S.currentScope = legacyScopeCjs();
    S.scopeBindingInfo = { mode: 'env-missing', task_id: envTask, isolated: false };
    return;
  }

  // 3. 会话 pin（v0.6.0 隔离主路径：本进程认领的会话 + session-map 动态解析）
  ensureSessionPin();
  if (isSessionPinned()) {
    const taskId = pinnedSessionTaskId();
    if (taskId) {
      S.currentScope = taskScopeCjs(taskId);
      S.scopeBindingInfo = { mode: 'session-pinned', session_id: S.pinnedSession.session_id, task_id: taskId, isolated: true };
    } else {
      S.currentScope = legacyScopeCjs();
      S.scopeBindingInfo = { mode: 'session-pinned', session_id: S.pinnedSession.session_id, task_id: null, isolated: true };
    }
    return;
  }

  // 4. 回退：全局活跃指针（v0.5 兼容——票据缺失/桥失败/无会话上下文）
  const activeId = idx.active_task_id;
  if (activeId) {
    const t = idx.tasks.find(x => x.id === activeId && x.status === 'active');
    if (t) {
      S.currentScope = taskScopeCjs(activeId);
      S.scopeBindingInfo = { mode: 'active-pointer', task_id: activeId, isolated: false, fallback: true };
      return;
    }
  }
  S.currentScope = legacyScopeCjs();
  S.scopeBindingInfo = { mode: 'legacy', isolated: false, fallback: true };
}

// ─────────────────────────────────────────────
// 状态文件 IO（scope 感知；S.currentScope 由 routeScope 在每次工具调用前写入）
// ─────────────────────────────────────────────

function statePath() { return join(S.currentScope.stateDir, 'state.json'); }

function readState() {
  const p = statePath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(stripBomCjs(readFileSync(p, 'utf8'))); } catch { return null; }
}

function writeState(state) {
  const dir = S.currentScope.stateDir;
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
  atomicWriteCjs(join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

/**
 * v0.13.5 X-lock：锁内读-改-写 state.json（经 lifecycle 桥复用 common.mjs 的
 * mutateJsonFile——与 hooks 侧同一把 O_EXCL lockfile，MCP 常驻进程与每次工具
 * 调用 spawn 的 hook 进程不再互盖）。mutator(cur) 返回新对象 → 写入并返回 true；
 * 返回 null → 放弃写入（幂等跳过）。桥不可用（极端）→ 退回无锁行为（v0.13.4）。
 */
function mutateState(mutator) {
  if (S.lifecycle && typeof S.lifecycle.mutateJsonFile === 'function') {
    const dir = S.currentScope.stateDir;
    try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
    return S.lifecycle.mutateJsonFile(statePath(), mutator) !== null;
  }
  try {
    const st = mutator(readState() || {});
    if (st == null) return false;
    writeState(st);
    return true;
  } catch { return false; }
}

// v0.13.0 工作流参与置位（幂等）：MCP 首次调用视为用户显式参与 ai-sdlc 工作流——
// 与 PostToolUse 检测到工件写入时的置位同语义（sdlc_engaged=true 后硬门禁生效；
// 未参与的项目门禁自动降级 warn，防误拦无关仓库）。
// v0.13.5 X-lock：置位锁内读-改-写（并发 hook 置位/推进不再被旧快照覆盖回退）
function markEngagedOnce(toolName) {
  let wrote = false;
  try {
    wrote = mutateState((st) => {
      st = st || {};
      if (st.sdlc_engaged) return null;   // 已置位：幂等跳过
      st.sdlc_engaged = true;
      st.sdlc_engaged_at = new Date().toISOString();
      return st;
    });
    if (wrote) {
      try {
        const evPath = join(S.currentScope.stateDir, 'events.jsonl');
        const line = JSON.stringify({ type: 'workflow_engaged', at: new Date().toISOString(), detail: { via: 'mcp_first_call', tool: toolName } }) + '\n';
        if (!existsSync(S.currentScope.stateDir)) mkdirSync(S.currentScope.stateDir, { recursive: true });
        appendFileSync(evPath, line);
      } catch {}
    }
  } catch {}
}

function readHooksState() {
  const dir = S.currentScope.stateDir;
  const p = join(dir, 'hooks-state.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(stripBomCjs(readFileSync(p, 'utf8'))); } catch { return null; }
}

// ─────────────────────────────────────────────
// 工件扫描（scope 感知，与 stage-detector.mjs 同语义）
//   v0.10.0：S.ARTIFACT_CANDIDATES 已上移至文件头（桥接 common.mjs 单源 + 兜底副本）
// ─────────────────────────────────────────────

function findArtifact(name) {
  const s = S.currentScope;
  const candidates = S.ARTIFACT_CANDIDATES[name] || [name];
  const all = s.mode === 'task' ? [join(s.taskRel, name), ...candidates] : candidates;
  for (const rel of all) {
    const p = resolve(PROJECT_ROOT, rel);
    if (existsSync(p)) return { path: p, rel };
  }
  return null;
}

const STAGES = [
  { id: 'planning', name: 'Stage 1 — Planning', artifact: 'intent.md', next: 'design' },
  { id: 'design', name: 'Stage 2 — Design', artifact: 'spec.md', next: 'build_plan' },
  { id: 'build_plan', name: 'Stage 3a — Build / Plan Mode', artifact: 'plan.md', next: 'build_impl' },
  { id: 'build_impl', name: 'Stage 3b — Build / Implementation', artifact: 'diff+tests', next: 'test' },
  { id: 'test', name: 'Stage 4 — Test', artifact: 'test-pass', next: 'deploy' },
  { id: 'deploy', name: 'Stage 5 — Deploy', artifact: 'pr-merged', next: 'maintain' },
  { id: 'maintain', name: 'Stage 6 — Maintain', artifact: 'incident→intent.md', next: 'planning' },
];

function detectStage() {
  const state = readState() || {};
  if (state.stage_override) {
    return { stage: state.stage_override, source: 'manual.override', confidence: 'manual' };
  }
  // 优先使用 hooks 写入的 state.current_stage（更准确，反映最新推进）
  if (state.current_stage) {
    // v0.6.0：awaiting 门禁状态同步报告（hooks 侧置位的等待回答标记）
    if (state.current_stage === 'planning' && state.intent_awaiting_answers) {
      return { stage: 'planning', substage: 'awaiting_answers', open_questions: state.intent_open_questions || 0, source: 'state.current_stage+awaiting', confidence: 'high' };
    }
    return { stage: state.current_stage, source: 'state.current_stage', confidence: 'high' };
  }
  // 回退：基于工件存在性推导（首次启动或状态丢失时）
  const hasIntent = !!findArtifact('intent.md');
  const hasSpec = !!findArtifact('spec.md');
  const hasPlan = !!findArtifact('plan.md');

  if (state.last_deployed_at) {
    return { stage: 'maintain', source: 'fallback.deployed', confidence: 'medium' };
  }
  if (hasSpec && !hasPlan) {
    return { stage: 'build_plan', source: 'fallback.spec+no-plan', confidence: 'medium' };
  }
  if (hasIntent && !hasSpec) {
    // v0.6.0：Open questions 未回答 → 仍在 planning（与 hooks 侧 detectStage 同语义）
    const intentFound = findArtifact('intent.md');
    const oq = intentFound && S.lifecycle ? S.lifecycle.parseOpenQuestions(intentFound.path) : { unresolved: 0 };
    if (oq.unresolved > 0) {
      return { stage: 'planning', substage: 'awaiting_answers', open_questions: oq.unresolved, source: 'fallback.intent+open-questions', confidence: 'high' };
    }
    return { stage: 'design', source: 'fallback.intent+no-spec', confidence: 'medium' };
  }
  return { stage: 'planning', source: 'fallback.default', confidence: 'medium' };
}

// ─────────────────────────────────────────────
// scope 概要（工具响应共用字段）
// ─────────────────────────────────────────────
function scopeInfo() {
  const s = S.currentScope;
  const info = {
    scope_mode: s.mode,
    task_id: s.taskId || null,
    state_dir: s.taskRel || '.sdlc/',
  };
  // v0.6.0 会话隔离诊断：报告本进程的路由来源（session-pinned = 隔离生效）
  info.scope_binding = {
    mode: S.scopeBindingInfo.mode,
    isolated: S.scopeBindingInfo.isolated !== false,
    session_id: isSessionPinned() ? S.pinnedSession.session_id : null,
    fallback: !!S.scopeBindingInfo.fallback,
  };
  // 回退到全局指针且存在多活跃任务时提示 agent 显式路由
  if (S.scopeBindingInfo.fallback) {
    const active = readTaskIndex().tasks.filter(t => t.status === 'active');
    if (active.length > 1) {
      info.scope_binding.hint = `多任务并存且本进程未绑定会话（${S.scopeBindingInfo.mode}）——建议工具调用时显式传 task_id，或用 session_scope 绑定会话`;
    }
  }
  return info;
}

// ─────────────────────────────────────────────
// 导出（tools.js 消费；内部函数不导出）
// ─────────────────────────────────────────────
module.exports = {
  PLUGIN_ROOT, PROJECT_ROOT, SDLC_DIR,
  S,
  requireLifecycle, lifecycleReady,
  routeScope, isSessionPinned,
  readTaskIndex, writeTaskIndexCjs,
  readState, writeState, mutateState, markEngagedOnce, readHooksState,
  findArtifact, STAGES, detectStage,
  scopeInfo, stripBomCjs,
};
