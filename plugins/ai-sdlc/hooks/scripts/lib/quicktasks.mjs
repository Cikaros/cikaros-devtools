/**
 * quicktasks.mjs — 临时任务队列（输入分流 / Input Triage）：全局 .sdlc/quick-tasks.json，锁内读-改-写，硬上限 100 只裁终态
 * 分层：L3 领域层（依赖：paths / state / atomic / audit）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { join } from 'node:path';
import { sdlcDir, asScope } from './paths.mjs';
import { readGlobalJson, writeGlobalJson } from './state.mjs';
import { mutateJsonFile } from './atomic.mjs';
import { appendEvent } from './audit.mjs';

// ─────────────────────────────────────────────
// v0.12.0 临时任务队列（输入分流 / Input Triage）
//   权威标准：rules/triage.md 与插件 docs/lifecycle.md「输入分流与临时任务队列」
//   存储：全局 .sdlc/quick-tasks.json（与 tasks.json 同级——临时任务属于用户/
//   项目级侧通道，不随任务作用域隔离，切任务不丢队列）；agent 禁改
//   （PreToolUse 运行时状态保护），只能经 MCP quick_task 工具
//   工具受控读写。状态机：queued → in_progress → done；queued → dropped。
//   语义：SDLC 周期进行中提出的临时任务登记排队，周期走完后统一处理；
//   补充信息不走队列（直接融入当前阶段工件）——两类内容互不混淆。
// ─────────────────────────────────────────────

const QUICK_TASKS_LIMIT = 100;
const QUICK_TASK_STATUSES = ['queued', 'in_progress', 'done', 'dropped'];

/** 读队列索引（损坏时空索引自愈） */
export function readQuickTasks(projectRoot) {
  return readGlobalJson(projectRoot, 'quick-tasks.json') || { next_id: 1, tasks: [] };
}

/** 写队列索引（原子写底座） */
export function writeQuickTasks(projectRoot, idx) {
  return writeGlobalJson(projectRoot, 'quick-tasks.json', idx);
}

/** 追加一条临时任务（queued）。@returns {{id, desc, status, created_at}} | {error} */
export function addQuickTask(projectRoot, { desc, note, scope, sessionId } = {}) {
  const text = String(desc || '').trim().slice(0, 300);
  if (!text) return { error: 'desc 不能为空（用一句话描述临时任务）' };
  // v0.13.5 X-lock：quick-tasks.json 跨进程锁内读-改-写（MCP 工具调用与
  //   hook 进程并发登记不再互盖丢条目；v0.13.4 硬上限/裁剪逻辑不变）
  let out = null;
  const qtPath = join(sdlcDir(projectRoot), 'quick-tasks.json');
  const written = mutateJsonFile(qtPath, (idx0) => {
    const idx = idx0 || { next_id: 1, tasks: [] };
    // v0.13.4 硬上限保护：queued/in_progress 永不裁剪（用户任务不凭空消失），
    //   但无终态可裁时队列会无界增长（长期高频登记 + 从不 done 的场景）——
    //   非终态达到上限时拒绝新登记，提示先处理/drop（而非默默膨胀文件）。
    const activeCount = (idx.tasks || []).filter(t => t.status === 'queued' || t.status === 'in_progress').length;
    if (activeCount >= QUICK_TASKS_LIMIT) {
      out = { error: `待处理临时任务已达上限 ${QUICK_TASKS_LIMIT} 条——先处理（done）或丢弃（drop）部分任务再登记新任务` };
      return null;   // 放弃写入
    }
    const now = new Date().toISOString();
    const task = {
      id: `q${idx.next_id || 1}`,
      desc: text,
      note: note ? String(note).slice(0, 200) : null,
      status: 'queued',
      created_at: now,
      updated_at: now,
      scope: scope || null,            // 登记时所在作用域（诊断用，不参与路由）
      session_id: sessionId ? String(sessionId).slice(0, 64) : null,
    };
    idx.tasks.push(task);
    idx.next_id = (idx.next_id || 1) + 1;
    // 上限裁剪：只丢最旧的终态条目（done/dropped）；queued/in_progress 永不丢
    if (idx.tasks.length > QUICK_TASKS_LIMIT) {
      const overflow = idx.tasks.length - QUICK_TASKS_LIMIT;
      const terminal = idx.tasks.filter(t => t.status === 'done' || t.status === 'dropped');
      const dropIds = new Set(terminal.slice(0, overflow).map(t => t.id));
      idx.tasks = idx.tasks.filter(t => !dropIds.has(t.id));
    }
    out = task;
    return idx;
  }, { fallback: { next_id: 1, tasks: [] } });
  if (out && out.error) return out;
  if (!written && !out) return { error: '队列写入失败（并发竞争或磁盘错误），请重试' };
  if (out) appendEvent(asScope(projectRoot), 'quick_task_added', { id: out.id, desc: out.desc.slice(0, 80) });
  return out;
}

/** 更新队列条目状态（in_progress / queued / done / dropped）。@returns 更新后条目或 {error} */
export function updateQuickTask(projectRoot, id, status, note = '') {
  if (!QUICK_TASK_STATUSES.includes(status)) {
    return { error: `未知状态「${status}」，可选：${QUICK_TASK_STATUSES.join(' / ')}` };
  }
  // v0.13.5 X-lock：锁内读-改-写（并发 done 同一条不再互盖；校验逻辑锁内重执行）
  let out = null;
  const qtPath = join(sdlcDir(projectRoot), 'quick-tasks.json');
  const written = mutateJsonFile(qtPath, (idx0) => {
    const idx = idx0 || { next_id: 1, tasks: [] };
    const t = (idx.tasks || []).find(x => x.id === String(id || '').trim());
    if (!t) {
      out = { error: `临时任务不存在: ${id}（用 quick_task({action:"list"}) 查看队列）` };
      return null;
    }
    if (t.status === 'done' || t.status === 'dropped') {
      out = { error: `任务 ${t.id} 已终态（${t.status}），不可再变更` };
      return null;
    }
    t.status = status;
    if (note) t.note = String(note).slice(0, 200);
    t.updated_at = new Date().toISOString();
    out = t;
    return idx;
  }, { fallback: { next_id: 1, tasks: [] } });
  if (out && out.error) return out;
  if (!written && !out) return { error: '队列写入失败（并发竞争或磁盘错误），请重试' };
  if (out) appendEvent(asScope(projectRoot), 'quick_task_updated', { id: out.id, status });
  return out;
}

/** 全部队列条目（list 视图：in_progress → queued → 终态） */
export function listQuickTasks(projectRoot) {
  const tasks = readQuickTasks(projectRoot).tasks || [];
  const rank = s => (s === 'in_progress' ? 0 : s === 'queued' ? 1 : 2);
  return tasks.slice().sort((a, b) => rank(a.status) - rank(b.status) || a.created_at.localeCompare(b.created_at));
}

/** 仅待处理条目（queued + in_progress）——提醒与处理时机判定用 */
export function queuedQuickTasks(projectRoot) {
  return (readQuickTasks(projectRoot).tasks || []).filter(t => t.status === 'queued' || t.status === 'in_progress');
}
