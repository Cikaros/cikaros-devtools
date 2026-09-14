#!/usr/bin/env node
/**
 * session-end.mjs — SessionEnd hook（触发点 6/6）
 *
 * 归档会话状态（工件永不删除——生命周期标准见插件 docs/lifecycle.md）：
 *   - 写 scope 内 session-end.json（最后一次会话的快照）
 *   - 会话快照存档到 .sdlc/sessions/<session-id>-<stamp>.json（保留最近 50 个）
 *   - 累计统计（hooks 调用次数 / token 注入量 / 阶段推进次数）
 *
 * v0.5.0：
 *   - scope 路由：任务隔离区各自归档
 *   - 会话快照持久化（跨会话审计：谁在什么时候用了哪个任务/周期）
 *
 * 输入（stdin JSON）：{ session_id, cwd, hook_event_name: "SessionEnd" }
 * 输出（stdout JSON）：{}
 */

import {
  parseInput, projectRootOf, emitHookOutput, appendAudit, appendEvent,
  readCodexState, writeCodexState, resolveScope, saveSessionSnapshot, queuedQuickTasks,
} from './lib/common.mjs';
import { detectStage } from './lib/stage-detector.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);

// v0.5.0 作用域路由（会话亲和）
const scope = resolveScope(projectRoot, input);

const hooksState = readCodexState(scope, 'hooks-state.json') || {};
const state = readCodexState(scope, 'state.json') || {};
const detection = detectStage(scope);

const snapshot = {
  session_id: input.session_id || hooksState.session_id,
  ended_at: new Date().toISOString(),
  started_at: hooksState.session_started_at || null,
  final_stage: detection.stage,
  scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
  task_id: scope.taskId,
  cycle_count: state.cycle_count || 0,
  cycle_id: state.cycle_id || null,
  hooks_executed: hooksState.hooks_executed || 0,
  cumulative_tokens: hooksState.cumulative_tokens || 0,
  injected_files: hooksState.injected_files || [],
  // v0.12.0 输入分流：队列残留计数（跨会话可见——下个会话 SessionStart 会提醒处理）
  quick_tasks_pending: queuedQuickTasks(projectRoot).length,
};
writeCodexState(scope, 'session-end.json', snapshot);

// v0.5.0 会话快照持久化（项目级，保留最近 50 个；工件不受影响）
saveSessionSnapshot(projectRoot, snapshot);

appendEvent(scope, 'session_end', {
  session_id: snapshot.session_id,
  detail: `final_stage=${detection.stage} hooks=${snapshot.hooks_executed} tokens=${snapshot.cumulative_tokens} scope=${snapshot.scope}`,
});

appendAudit(scope, {
  hook: 'session_end', trigger: 'SessionEnd',
  result: 'success',
  detail: snapshot,
});

emitHookOutput({});
