/**
 * state.mjs — 状态机 schema 与 scope 感知状态 IO：defaultState/isEngaged 单一事实源、state.json 与全局 JSON 读写、锁内 mutate 封装、会话级 hooks-state 读
 * 分层：L2 状态层（依赖：paths / util / atomic）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asScope, sdlcDir, runtimePath } from './paths.mjs';
import { readTextBomSafe } from './util.mjs';
import { writeJsonExclusive, mutateJsonFile } from './atomic.mjs';

// ─────────────────────────────────────────────
// v0.10.0 默认状态机（全量 schema，单一事实源）
//   此前 defaultState 散落在 session-start（局部模板，缺 v0.5–v0.9 字段）、
//   createTask / newCycle（两份手写全量模板）与 init-project.sh（bash heredoc，
//   缺 v0.5+ 字段）四处——字段集漂移是真实缺陷源。此处收敛为唯一权威。
// ─────────────────────────────────────────────
export function defaultState() {
  return {
    version: 1,
    current_stage: 'planning',
    previous_stage: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // 工作流参与（v0.4.0；v0.13.0 更新）：工件写入 / 任务创建 / MCP 首次调用时置位
    sdlc_engaged: false,
    sdlc_engaged_at: null,
    // 阶段门禁
    plan_accepted: false,
    test_pass: false,
    release_approval: false,      // 生产部署授权（唯一真值；v0.10.0 退役 deploy_approved 死字段）
    in_fix_mode: false,
    change_ticket: null,
    deploy_initialized: false,
    last_deploy_init_at: null,
    last_deployed_at: null,
    stage_override: null,
    artifact_history: [],
    // 周期（v0.5.0）
    cycle_count: 0,
    cycle_id: null,
    // Intent Open questions 门禁（v0.6.0）
    intent_awaiting_answers: false,
    intent_open_questions: 0,
    // 测试门禁与修复循环（v0.7.0）
    test_runs: 0,
    fix_rounds: 0,
    test_failures: [],
    fix_loop: null,
    fix_loop_resolutions: [],
  };
}

/**
 * v0.10.0 工作流参与判定（统一实现）。
 *   此前 pre-tool-use（7 字段，含 change_ticket）/ post-tool-use（6 字段，缺
 *   change_ticket）/ stop（6 字段，缺 change_ticket）三处手写——判定不一致意味着
 *   同一状态在 push 门禁与循环置位处可能得出相反结论。统一为单一函数：
 *   任一门禁状态位被受控工具设置过（plan_accepted / in_fix_mode / change_ticket /
 *   release_approval / deploy_initialized / stage_override）或显式 engaged 标记
 *   即视为参与。change_ticket 必须在内（set_change_ticket 是显式工作流操作）。
 */
export function isEngaged(state) {
  const s = state || {};
  return !!(s.sdlc_engaged || s.plan_accepted || s.in_fix_mode || s.change_ticket
    || s.release_approval || s.deploy_initialized || s.stage_override);
}
// ─────────────────────────────────────────────
// 状态文件 IO（scope 感知 + 原子写）
// ─────────────────────────────────────────────

export function readCodexState(scopeOrRoot, name) {
  const p = runtimePath(scopeOrRoot, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readTextBomSafe(p)); } catch { return null; }
}

/** 原子写：随机后缀 tmp + O_EXCL + rename（v0.9.0 加固，见 writeJsonExclusive） */
export function writeCodexState(scopeOrRoot, name, obj) {
  const p = runtimePath(scopeOrRoot, name);
  return writeJsonExclusive(p, obj);
}

/** 全局文件 IO（不随任务隔离：session-map / tasks.json / cycles.json） */
export function readGlobalJson(projectRoot, name) {
  const p = join(sdlcDir(projectRoot), name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readTextBomSafe(p)); } catch { return null; }
}

export function writeGlobalJson(projectRoot, name, obj) {
  const p = join(sdlcDir(projectRoot), name);
  return writeJsonExclusive(p, obj);
}
/** mutateJsonFile 的 scope 感知封装（state.json / hooks-state.json 等 runtime 文件） */
export function mutateCodexState(scopeOrRoot, name, mutator, { fallback = null } = {}) {
  return mutateJsonFile(runtimePath(scopeOrRoot, name), mutator, { fallback });
}

/** mutateJsonFile 的任务索引封装（tasks.json：读侧损坏回退空索引） */
export function mutateTaskIndex(projectRoot, mutator) {
  return mutateJsonFile(join(sdlcDir(projectRoot), 'tasks.json'), mutator, {
    fallback: { active_task_id: null, tasks: [] },
  });
}
// ─────────────────────────────────────────────
// 会话级 hooks-state（跨会话接管检测：防去重状态污染）
// ─────────────────────────────────────────────

/**
 * 读取 hooks-state 并做会话接管检测：
 * scope 上一次由其他会话写入 → 重置注入去重与 token 计数（注入提示幂等无害，
 * 但去重记录对新会话无意义且会导致规则漏注入）。
 */
export function readHooksStateForSession(scopeOrRoot, sessionId) {
  const hs = readCodexState(scopeOrRoot, 'hooks-state.json') || {};
  if (sessionId && hs.session_id && hs.session_id !== sessionId) {
    return {
      session_id: sessionId,
      session_started_at: new Date().toISOString(),
      taken_over_from: hs.session_id,
      injected_files: [],
      cumulative_tokens: 0,
      last_inject_tokens: 0,
      hooks_executed: 0,
      // v0.13.12：沙盒去重/拒绝标记同属会话级状态——接管重置时一并清零
      //   （新会话重新预警一次；不残留旧会话的拒绝提醒）
      sandbox_protocol_shown: false,
      sandbox_denied: null,
      // v0.13.13：审批等待通知的在场窗口同属会话级——旧会话的执行时间戳
      //   不得抑制新会话首个网络/端口命令的审批通知（人可能早已离开终端）
      netport_last_exec_at: null,
    };
  }
  if (!hs.session_id && sessionId) hs.session_id = sessionId;
  return hs;
}
