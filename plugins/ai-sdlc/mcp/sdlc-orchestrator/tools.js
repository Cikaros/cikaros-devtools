/**
 * tools.js — sdlc-orchestrator 23 个 MCP 工具实现与定义（CJS）
 *
 * v0.13.6 代码组织轮次从 index.js 拆出：toolStatus … toolSessionScope 全部
 * 工具函数 + tools 工具表（name/description/inputSchema）+ callTool 分发入口。
 * 服务端上下文（桥/路由/状态 IO/检测）经 context.js；可变状态经 S 容器。
 * 新增工具：实现函数 + tools 表加条目 + callTool 分发分支，三处同文件就近维护。
 * 版本历史见插件 docs/changes/CHANGELOG.md。
 */

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  PROJECT_ROOT, S,
  requireLifecycle, lifecycleReady,
  routeScope, isSessionPinned,
  readTaskIndex, readState, mutateState, markEngagedOnce,
  findArtifact, STAGES, detectStage, scopeInfo, stripBomCjs,
} = require('./context.js');
function toolStatus() {
  const state = readState() || { current_stage: 'planning', cycle_count: 0 };
  const detection = detectStage();
  const artifacts = {};
  for (const name of Object.keys(S.ARTIFACT_CANDIDATES)) {
    const found = findArtifact(name);
    artifacts[name] = found ? found.rel : null;
  }
  const stage = STAGES.find(s => s.id === detection.stage);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        timestamp: new Date().toISOString(),
        ...scopeInfo(),
        stage: detection.stage,
        stage_name: stage?.name,
        confidence: detection.confidence,
        source: detection.source,
        artifacts,
        cycle_count: state.cycle_count || 0,
        cycle_id: state.cycle_id || null,
        previous_stage: state.previous_stage || null,
        last_deployed_at: state.last_deployed_at || null,
        gates: {
          plan_accepted: state.plan_accepted || false,
          test_pass: state.test_pass || false,
          release_approval: state.release_approval || false,
          in_fix_mode: state.in_fix_mode || false,
          change_ticket: state.change_ticket || null,
          stage_override: state.stage_override || null,
          // v0.6.0：Intent Open questions 交互门禁状态
          intent_awaiting_answers: state.intent_awaiting_answers || false,
          intent_open_questions: state.intent_open_questions || 0,
        },
        // v0.7.0：测试门禁与修复循环诊断（Test Gate & Fix Loop Guard）
        test_gate: {
          test_pass: state.test_pass || false,
          test_runs: state.test_runs || 0,
          fix_rounds: state.fix_rounds || 0,
          last_test_exit_code: state.last_test_exit_code ?? null,
          fix_loop: state.fix_loop
            ? {
                kind: state.fix_loop.kind,
                rounds: state.fix_loop.rounds,
                summary: state.fix_loop.summary || null,
                hint: state.fix_loop.hint || null,
                decisions: 'loop_resolve 工具（decision: retry|new-intent|manual|escalate；用户自然语言即触发）',
              }
            : null,
          recent_failures: (Array.isArray(state.test_failures) ? state.test_failures.slice(-3) : [])
            .map(f => ({ ts: f.ts, sig: f.sig, cycle: f.cycle || null, summary: (f.summary || '').slice(0, 100) })),
        },
        substage: detection.substage || null,
        next_stage: stage?.next,
        next_artifact: STAGES.find(s => s.id === stage?.next)?.artifact,
      }, null, 2),
    }],
  };
}

function toolWorkflow() {
  const detection = detectStage();
  const state = readState() || {};
  const progress = STAGES.map(s => {
    let status = 'pending';
    if (s.id === detection.stage) status = 'current';
    else if (state[`${s.id}_completed_at`]) status = 'done';
    return { ...s, status };
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...scopeInfo(),
        stages: progress,
        cycle_count: state.cycle_count || 0,
        closed_loop: detection.stage === 'maintain',
      }, null, 2),
    }],
  };
}

function toolAdvance(args) {
  const fromStage = args.from;
  const stage = STAGES.find(s => s.id === fromStage);
  if (!stage) {
    return { content: [{ type: 'text', text: `Error: unknown stage ${fromStage}` }], isError: true };
  }
  // 简化产出检查（与 stage-detector.mjs 一致）
  if (!args.force) {
    if (fromStage === 'planning' && !findArtifact('intent.md')) {
      return { content: [{ type: 'text', text: 'Error: missing artifact intent.md' }], isError: true };
    }
    if (fromStage === 'design' && !findArtifact('spec.md')) {
      return { content: [{ type: 'text', text: 'Error: missing artifact spec.md' }], isError: true };
    }
    if (fromStage === 'build_plan' && !findArtifact('plan.md')) {
      return { content: [{ type: 'text', text: 'Error: missing artifact plan.md' }], isError: true };
    }
  }
  const next = stage.next;
  // v0.13.5 X-lock：锁内读-改-写（与 hooks advanceStage 同锁同幂等重验——并发
  //   推进不再互盖；cur=next 时幂等跳过，防双重推进回写旧 previous_stage）
  let cycleCount = 0;
  let skipped = false;
  mutateState((state) => {
    state = state || {};
    if (state.current_stage === next) { skipped = true; return null; }   // 并发已推进：幂等
    state.previous_stage = fromStage;
    state.current_stage = next;
    state[`${fromStage}_completed_at`] = new Date().toISOString();
    if (next === 'build_plan') state.plan_accepted = false;
    if (next === 'test') state.test_pass = false;
    if (next === 'deploy') state.release_approval = false;
    // v0.5.0：推进即解除手工 override（与 hooks advanceStage 语义一致）
    if (state.stage_override) state.stage_override = null;
    if (fromStage === 'maintain' && next === 'planning') {
      state.cycle_count = (state.cycle_count || 0) + 1;
    }
    state.updated_at = new Date().toISOString();
    cycleCount = state.cycle_count || 0;
    return state;
  });
  if (!skipped) cycleCount = cycleCount || (readState() || {}).cycle_count || 0;
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: true, from: fromStage, to: next, cycle_count: cycleCount, skipped: skipped || undefined }),
    }],
  };
}

function toolReset(args) {
  // v0.10.0：全量 schema（与 hooks 侧 common.defaultState 字段集一致）——
  // 此前本处缺 in_fix_mode / change_ticket / release_approval / test 门禁字段 /
  // intent 门禁字段，reset 后状态文件与 hooks 期望 schema 漂移。
  // v0.13.5 X-lock：keep_history 取值锁内重读（旧快照不再覆盖并发写入）
  mutateState((oldState0) => {
    const oldState = oldState0 || {};
    const newState = {
      version: 1,
      current_stage: 'planning',
      previous_stage: null,
      created_at: oldState.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // v0.4.0：reset 同时解除工作流参与标记（硬门禁降级回 warn）
      // v0.5.0 语义区分：reset = 完整退出（不清工件、不归档）；new_cycle = 迭代延续（归档+重置）
      sdlc_engaged: false,
      sdlc_engaged_at: null,
      plan_accepted: false,
      test_pass: false,
      release_approval: false,
      in_fix_mode: false,
      change_ticket: null,
      deploy_initialized: false,
      last_deploy_init_at: null,
      last_deployed_at: null,
      stage_override: null,
      artifact_history: args.keep_history ? (oldState.artifact_history || []) : [],
      // v0.7.0：决策留痕随 keep_history 保留（fix_loop/test_failures 按「完整退出」语义清除）
      fix_loop_resolutions: args.keep_history ? (oldState.fix_loop_resolutions || []) : [],
      cycle_count: args.keep_history ? (oldState.cycle_count || 0) : 0,
      cycle_id: null,
      intent_awaiting_answers: false,
      intent_open_questions: 0,
      test_runs: 0,
      fix_rounds: 0,
      test_failures: [],
      fix_loop: null,
    };
    return newState;
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: true, reset_to: 'planning', kept_history: !!args.keep_history,
        ...scopeInfo(),
        note: 'reset 只重置状态机，不移动/删除任何工件。若要开启新需求周期（归档旧工件），请用 new_cycle。',
      }),
    }],
  };
}

function toolRefresh() {
  const detection = detectStage();
  // v0.13.5 X-lock：锁内读-改-写
  let current = detection.stage;
  mutateState((state0) => {
    const state = state0 || {};
    state.current_stage = detection.stage;
    state.updated_at = new Date().toISOString();
    current = state.current_stage;
    return state;
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: true, detected_stage: current, source: detection.source, ...scopeInfo() }),
    }],
  };
}

function toolAcceptPlan() {
  if (!findArtifact('plan.md')) {
    return { content: [{ type: 'text', text: 'Error: plan.md not found' }], isError: true };
  }
  // v0.13.5 X-lock：锁内读-改-写（并发推进/置位不互盖）
  let advanced = false;
  let currentStage = null;
  mutateState((state0) => {
    const state = state0 || {};
    state.plan_accepted = true;
    state.plan_accepted_at = new Date().toISOString();
    // v0.5.1：与工具描述一致——接受后立即推进到 build_impl（此前只置标志，
    // 依赖下一次 PostToolUse 懒推进；若 agent 无后续工具调用则阶段停滞）
    if (state.current_stage === 'build_plan') {
      state.previous_stage = 'build_plan';
      state.current_stage = 'build_impl';
      state.build_plan_completed_at = new Date().toISOString();
      if (state.stage_override) state.stage_override = null;
      advanced = true;
    }
    state.updated_at = new Date().toISOString();
    currentStage = state.current_stage;
    return state;
  });
  if (currentStage == null) currentStage = (readState() || {}).current_stage || 'planning';
  // v0.13.11 事件留痕（与 CLI 回退通道 accept-plan.mjs 同一事件名/via 标记——
  //   审计链可区分经哪条通道接受；历史无事件，接受只留 state 时间戳不可追溯）
  try {
    const lc = requireLifecycle();
    lc.appendEvent(S.currentScope, 'plan_accepted', {
      via: 'mcp:accept_plan', advanced_to_build_impl: advanced,
    });
  } catch { /* 事件写入失败不阻断接受主流程 */ }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: true, plan_accepted: true, advanced_to_build_impl: advanced,
        current_stage: currentStage, ...scopeInfo(),
      }),
    }],
  };
}

function toolSetFixMode(args) {
  // v0.13.5 X-lock：锁内读-改-写
  let enabled = !!args.enabled;
  mutateState((state0) => {
    const state = state0 || {};
    state.in_fix_mode = !!args.enabled;
    state.fix_mode_set_at = new Date().toISOString();
    state.updated_at = new Date().toISOString();
    enabled = state.in_fix_mode;
    return state;
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: true, in_fix_mode: enabled, ...scopeInfo() }),
    }],
  };
}

function toolApproveRelease(args) {
  // v0.13.5 X-lock：锁内读-改-写
  const approvedBy = String(args.approver || 'unknown').slice(0, 80);
  mutateState((state0) => {
    const state = state0 || {};
    state.release_approval = true;
    state.release_approved_by = approvedBy;
    state.release_approved_at = new Date().toISOString();
    state.updated_at = new Date().toISOString();
    return state;
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: true, release_approval: true, approved_by: approvedBy, ...scopeInfo() }),
    }],
  };
}

function toolSetChangeTicket(args) {
  // v0.13.5 X-lock：锁内读-改-写 + 票据号消毒（上限/控制字符——它会被 hooks 注入展示）
  const ticket = String(args.ticket_id == null ? '' : args.ticket_id).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 64);
  if (!ticket) {
    return { content: [{ type: 'text', text: 'Error: ticket_id is required' }], isError: true };
  }
  mutateState((state0) => {
    const state = state0 || {};
    state.change_ticket = ticket;
    state.change_ticket_set_at = new Date().toISOString();
    state.updated_at = new Date().toISOString();
    return state;
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ok: true, change_ticket: ticket, ...scopeInfo() }),
    }],
  };
}

/** v0.5.0：受控阶段回退/钉住（暴露 stage_override；需求变更回 design 等场景） */
function toolSetStage(args) {
  const stageId = args.stage;
  const stage = STAGES.find(s => s.id === stageId);
  if (!stage) {
    return { content: [{ type: 'text', text: `Error: unknown stage ${stageId}. Valid: ${STAGES.map(s => s.id).join(', ')}` }], isError: true };
  }
  const note = args.note ? String(args.note).slice(0, 300) : null;
  // v0.13.5 X-lock：锁内读-改-写（note 顺带消毒控制字符）
  mutateState((state0) => {
    const state = state0 || {};
    state.stage_override = stageId;
    state.current_stage = stageId;
    state.stage_override_set_at = new Date().toISOString();
    state.stage_override_note = note ? note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : null;
    state.updated_at = new Date().toISOString();
    return state;
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: true, stage_override: stageId, stage_name: stage.name, ...scopeInfo(),
        note: 'override 在下一次阶段推进时自动解除（advanceStage 清除）。典型用法：需求变更回 design（改 spec）后正常推进。',
      }),
    }],
  };
}

/** v0.7.0：修复循环中断决策（用户显式决策落地；v0.13.0 起唯一决策通道） */
async function toolLoopResolve(args) {
  const lc = requireLifecycle();
  const r = lc.resolveFixLoop(S.currentScope, String(args.decision || ''), String(args.note || ''));
  return { content: [{ type: 'text', text: JSON.stringify({ ...r, ...scopeInfo() }, null, 2) }] };
}

/** v0.5.0：开启新周期（归档旧工件 → 重置 → cycle+1） */
async function toolNewCycle(args) {
  const lc = requireLifecycle();
  const r = lc.newCycle(S.currentScope, {
    archiveDir: args.archive_dir || undefined,
    keep_history: args.keep_history !== false,
    reason: 'mcp_new_cycle',
  });
  return { content: [{ type: 'text', text: JSON.stringify({ ...r, ...scopeInfo() }, null, 2) }] };
}

/**
 * v0.5.0：创建隔离任务。
 * v0.6.0 写侧隔离：本进程已 pin 会话时，新任务只**绑定该会话**（session-map），
 * 全局活跃指针恢复原值——其他会话的 MCP 路由不受影响；未 pin（CI/env 场景）
 * 时保持 v0.5 行为（新任务成为全局活跃任务）。
 */
async function toolTaskCreate(args) {
  const lc = requireLifecycle();
  const prevActive = readTaskIndex().active_task_id;   // 记录全局指针（可能被 createTask 改写）
  const r = lc.createTask(PROJECT_ROOT, { name: args.name, note: args.note || 'created via MCP' });
  let boundToSession = false;
  if (isSessionPinned()) {
    lc.bindSession(PROJECT_ROOT, S.pinnedSession.session_id, r.id);
    boundToSession = true;
    // 恢复全局指针（createTask 已设为新任务）——会话级操作不碰全局态
    // v0.13.5 X-lock：锁内读-改-写（并发任务创建/切换不互盖）
    lc.mutateTaskIndex(PROJECT_ROOT, (idx0) => {
      const idx = idx0 || { active_task_id: null, tasks: [] };
      idx.active_task_id = prevActive;
      idx.updated_at = new Date().toISOString();
      return idx;
    });
  }
  // 重新路由（pinned 会话已绑定新任务 → S.currentScope 切到新任务）
  routeScope({});
  return { content: [{ type: 'text', text: JSON.stringify({
    ok: true, id: r.id, dir: `.sdlc/tasks/${r.id}/`,
    bound_to_session: boundToSession,
    global_active_task_id: readTaskIndex().active_task_id,
    note: boundToSession
      ? '任务已创建并绑定本会话（session-map）；全局活跃指针未变——其他会话不受影响。本进程后续调用已路由到新任务。'
      : '任务已创建并设为活跃（MCP 全局上下文，无会话绑定时）。会话侧绑定用 task_switch。',
  }, null, 2) }] };
}

/**
 * v0.5.0：切换活跃任务。
 * v0.6.0 写侧隔离：pinned 会话 + 未显式 global → 只改**会话绑定**
 * （session-map），全局指针不动；global: true 或未 pin 时改全局指针（v0.5 行为）。
 */
async function toolTaskSwitch(args) {
  const lc = requireLifecycle();
  const useGlobal = args.global === true || !isSessionPinned();
  if (!useGlobal) {
    // 校验目标任务存在且活跃
    const idx = readTaskIndex();
    const t = idx.tasks.find(x => x.id === args.task_id && x.status === 'active');
    if (!t) {
      return { content: [{ type: 'text', text: `Error: 任务不存在或已关闭: ${args.task_id}` }], isError: true };
    }
    lc.bindSession(PROJECT_ROOT, S.pinnedSession.session_id, args.task_id);
    routeScope({});   // 重新路由到新绑定的任务
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, switched: args.task_id, scope: 'session',
      global_active_task_id: idx.active_task_id,
      note: '已绑定本会话（session-map）；全局活跃指针未变。加 global: true 可切换全局指针（CI/无会话场景）。',
    }, null, 2) }] };
  }
  const r = lc.switchTask(PROJECT_ROOT, args.task_id);
  if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
  // global 语义：全局指针 + 本会话绑定同步切换（显式 global = 用户要整体切换）
  if (isSessionPinned()) lc.bindSession(PROJECT_ROOT, S.pinnedSession.session_id, args.task_id);
  routeScope({});
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, switched: args.task_id, scope: 'global' }, null, 2) }] };
}

/** v0.5.0：任务清单 */
async function toolTaskList() {
  const lc = requireLifecycle();
  const idx = lc.readTaskIndex(PROJECT_ROOT);
  return { content: [{ type: 'text', text: JSON.stringify({
    active_task_id: idx.active_task_id || null,
    tasks: idx.tasks,
    hint: '会话绑定状态见 .sdlc/session-map.json（hooks 侧按会话路由，与 MCP 活跃指针独立）',
  }, null, 2) }] };
}

/** v0.5.0：关闭任务（默认归档其工件） */
async function toolTaskClose(args) {
  const lc = requireLifecycle();
  const r = lc.closeTask(PROJECT_ROOT, args.task_id, {
    archive: args.archive !== false,
    archiveDir: args.archive_dir || undefined,
  });
  if (!r.ok) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
  return { content: [{ type: 'text', text: JSON.stringify({
    ok: true, closed: args.task_id, already: !!r.already,
    archived: r.archived ? { dir: r.archived.dir, artifacts: r.archived.archived.map(a => a.name) } : null,
  }, null, 2) }] };
}

/** v0.5.0：周期归档历史 */
async function toolCycleList() {
  const lc = requireLifecycle();
  return { content: [{ type: 'text', text: JSON.stringify({ cycles: lc.listCycles(PROJECT_ROOT) }, null, 2) }] };
}

/**
 * v0.12.0：临时任务队列受控操作（输入分流 / Input Triage）。
 *   add：登记（周期进行中→排队，周期走完后处理；无周期→可直接处理）
 *   list：查看队列（in_progress → queued → 终态）
 *   run：标记立即处理（用户显式授权提前，仍不落 SDLC 工件）
 *   done / drop：完成 / 放弃（终态不可再变更）
 * 队列全局存于 .sdlc/quick-tasks.json（不随任务隔离，切任务不丢）；
 * 处理时机提醒由 Stop/UserPromptSubmit/SessionStart hooks 注入。
 */
async function toolQuickTask(args) {
  const lc = requireLifecycle();
  const action = String(args.action || 'list').toLowerCase();
  const queueHint = (r) => {
    const queued = lc.queuedQuickTasks(PROJECT_ROOT).length;
    return { ...r, queued_count: queued, ...scopeInfo() };
  };

  if (action === 'add') {
    const r = lc.addQuickTask(PROJECT_ROOT, {
      desc: args.desc,
      note: args.note || undefined,
      scope: S.currentScope.mode + (S.currentScope.taskId ? ':' + S.currentScope.taskId : ''),
      sessionId: isSessionPinned() ? S.pinnedSession.session_id : null,
    });
    if (r.error) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(queueHint({
      ok: true, added: { id: r.id, desc: r.desc },
      note: '临时任务已登记（不走 SDLC 流程）。若当前周期进行中：本条排队，周期走完后统一处理——勿把处理内容混入当前周期工件或 diff；若用户要求立即处理，改用 action=run。',
    }), null, 2) }] };
  }

  if (action === 'list') {
    const tasks = lc.listQuickTasks(PROJECT_ROOT);
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, tasks,
      queued_count: tasks.filter(t => t.status === 'queued' || t.status === 'in_progress').length,
      hint: '周期进行中的排队条目将在周期走完后处理；处理时 run → 执行 → done。用户侧等价：自然语言「看一下临时任务队列」',
    }, null, 2) }] };
  }

  if (action === 'run') {
    const r = lc.updateQuickTask(PROJECT_ROOT, args.id, 'in_progress', String(args.note || ''));
    if (r.error) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, running: { id: r.id, desc: r.desc },
      note: '已标记立即处理（用户显式授权）。直接处理即可——仍不走 SDLC 流程、不落周期工件；完成后 action=done。',
    }, null, 2) }] };
  }

  if (action === 'done' || action === 'drop') {
    const r = lc.updateQuickTask(PROJECT_ROOT, args.id, action === 'done' ? 'done' : 'dropped', String(args.note || ''));
    if (r.error) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(queueHint({
      ok: true, [action]: args.id, status: r.status,
    }), null, 2) }] };
  }

  return { content: [{ type: 'text', text: `Error: 未知 action「${action}」，可选：add / list / run / done / drop` }], isError: true };
}

/**
 * v0.13.1：官方 /prompts: 手册注册（跨平台）。
 *   v0.13.0 的注册桥只有 bash 脚本（install-prompts.sh），Windows 原生
 *   不可达——本工具把注册收敛到 Node fs（经 ESM 桥复用 common.mjs 单一
 *   事实源），会话内三平台一致；shell 脚本降级为平台便利品。
 *   register：安装/刷新（幂等）；remove：卸载（只删 sdlc-<名>.md）；
 *   list：注册状态。目标目录默认 ~/.codex/prompts（SDLC_PROMPTS_DIR 可
 *   覆盖），dir 可显式指定。事件留痕落会话项目 .sdlc/events.jsonl。
 */
async function toolRegisterPrompts(args) {
  const lc = requireLifecycle();
  const action = String((args && args.action) || 'register').toLowerCase();
  const dir = args && args.dir ? String(args.dir) : undefined;

  if (action === 'list') {
    const st = lc.promptsRegisterStatus({ dir });
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, dir: st.dir, total: st.total, registered_count: st.registered_count,
      registered: st.registered, complete: st.complete,
      hint: st.complete
        ? '全部手册已注册——会话内可用 /prompts:sdlc-<名> 调用（如 /prompts:sdlc-quick）'
        : '部分/未注册：用户说「注册操作手册」或 action=register 即可（跨平台，幂等刷新）',
    }, null, 2) }] };
  }

  if (action === 'register') {
    const r = lc.registerPromptManuals({ dir });
    if (r.error) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
    try {
      lc.appendEvent(S.currentScope, 'prompts_registered', { count: r.count, total: r.total, dir: r.dir, via: 'mcp:register_prompts' });
    } catch {}
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, registered: r.count, total: r.total, dir: r.dir, prefix: 'sdlc-',
      invoke: '/prompts:sdlc-<名>（如 /prompts:sdlc-quick、/prompts:sdlc-status）',
      note: `已注册 ${r.count}/${r.total} 份操作手册到 ${r.dir}（sdlc- 前缀防撞名），并已清除卸载标记（恢复会话启动自动注册）。重复执行即刷新为插件当前版本；卸载 action=remove（卸载后不再自动恢复）。日常无需手动执行——SessionStart 已自动注册/刷新（零操作）。`,
      cross_platform: '本工具为跨平台显式通道（Node fs，三平台一致）；macOS/Linux 亦可运行 scripts/sh/install-prompts.sh，Windows 用 scripts/ps/install-prompts.ps1；误调用平台不匹配的脚本会被 PreToolUse 护栏拦截并给出替代。',
    }, null, 2) }] };
  }

  if (action === 'remove') {
    const r = lc.removePromptManuals({ dir });
    if (r.error) return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
    try {
      lc.appendEvent(S.currentScope, 'prompts_removed', { count: r.count, dir: r.dir, via: 'mcp:register_prompts' });
    } catch {}
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, removed: r.count, dir: r.dir,
      note: `已移除 ${r.count} 份手册（只删本插件注册的 sdlc-<名>.md，用户其他 prompts 不受影响），并已写入卸载标记（${r.dir}/.sdlc-prompts-optout）——此后 SessionStart 不再自动恢复；重新注册（action=register）会清除标记恢复自动。`,
    }, null, 2) }] };
  }

  return { content: [{ type: 'text', text: `Error: 未知 action「${action}」，可选：register / remove / list` }], isError: true };
}

function toolSelfReview() {
  // 提示 Codex 按 REVIEW.md 策略自审
  const reviewPath = findArtifact('REVIEW.md');
  const planPath = findArtifact('plan.md');
  const specPath = findArtifact('spec.md');
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        instruction: 'Run three passes (Bugs / Security / Compliance) per REVIEW.md. Tag each finding with pass, severity (important|nit|info), file:line, evidence, suggestion. Cap nits at 5.',
        review_md: reviewPath ? reviewPath.rel : null,
        plan_md: planPath ? planPath.rel : null,
        spec_md: specPath ? specPath.rel : null,
        diff_command: 'git diff main...HEAD',
      }, null, 2),
    }],
  };
}

function toolAudit(args) {
  const limit = Math.min(args.limit || 20, 100);
  const p = join(S.currentScope.stateDir, 'hook-audit.json');
  if (!existsSync(p)) {
    return { content: [{ type: 'text', text: 'No audit log yet.' }] };
  }
  try {
    const arr = JSON.parse(stripBomCjs(readFileSync(p, 'utf8')));
    const slice = arr.slice(-limit);
    return { content: [{ type: 'text', text: JSON.stringify({ ...scopeInfo(), entries: slice }, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error reading audit: ${e.message}` }], isError: true };
  }
}

function toolEvents(args) {
  const limit = Math.min(args.limit || 20, 100);
  const p = join(S.currentScope.stateDir, 'events.jsonl');
  if (!existsSync(p)) {
    return { content: [{ type: 'text', text: 'No events yet.' }] };
  }
  try {
    const text = readFileSync(p, 'utf8');
    const lines = text.trim().split('\n').slice(-limit);
    const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return { content: [{ type: 'text', text: JSON.stringify({ ...scopeInfo(), events }, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error reading events: ${e.message}` }], isError: true };
  }
}

// ─────────────────────────────────────────────
// v0.6.0 会话上下文管理：session_scope（show / bind / unbind）
//   MCP 进程与会话的配对靠票据自动认领；本工具提供显式诊断与纠正通道。
// ─────────────────────────────────────────────

function toolSessionScope(args) {
  const action = (args && args.action) || 'show';

  if (action === 'bind') {
    const sid = args && args.session_id;
    if (!sid) {
      return { content: [{ type: 'text', text: 'Error: bind 需要 session_id 参数（可从 session-map.json / hooks 注入获取）' }], isError: true };
    }
    S.pinnedSession = { session_id: String(sid).slice(0, 128), source: 'manual', claimed_at: new Date().toISOString(), via: 'manual' };
    routeScope(args);   // 重新路由（保持显式 task_id 优先级）
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, bound_session_id: S.pinnedSession.session_id,
      routed_task_id: S.currentScope.taskId,
      note: '本 MCP 进程已绑定该会话——后续所有工具调用按该会话的 session-map 绑定路由。',
    }, null, 2) }] };
  }

  if (action === 'unbind') {
    const had = isSessionPinned() ? S.pinnedSession.session_id : null;
    S.pinnedSession = false;   // 手动解绑：后续按回退路径（active 指针）路由
    routeScope({});
    return { content: [{ type: 'text', text: JSON.stringify({
      ok: true, unbound_from: had,
      routing_mode: S.scopeBindingInfo.mode,
      note: '已解除会话绑定——本进程回退到全局活跃任务指针路由（v0.5 兼容行为）。',
    }, null, 2) }] };
  }

  // show（默认）
  const map = S.lifecycle ? S.lifecycle.readSessionMap(PROJECT_ROOT) : { sessions: {} };
  // v0.9.0：键归一化与 hooks 侧 bindSession 一致（防 __proto__/constructor 键逃逸）
  const showKey = (isSessionPinned() && S.lifecycle && S.lifecycle.sessionMapKey)
    ? S.lifecycle.sessionMapKey(S.pinnedSession.session_id) : null;
  const bound = showKey && Object.prototype.hasOwnProperty.call(map.sessions, showKey) ? map.sessions[showKey] : null;
  return { content: [{ type: 'text', text: JSON.stringify({
    ...scopeInfo(),
    pinned: isSessionPinned(),
    pinned_session: isSessionPinned() ? {
      session_id: S.pinnedSession.session_id,
      via: S.pinnedSession.via,
      claimed_at: S.pinnedSession.claimed_at,
      bound_task_id: bound ? bound.task_id : null,
    } : null,
    queue_dir: '.sdlc/mcp-bind-queue/',
    hint: 'MCP 进程在首次工具调用时自动认领 SessionStart 票据实现会话隔离；路由异常时可 bind <session_id> 纠正，或所有工具显式传 task_id。',
  }, null, 2) }] };
}

// ─────────────────────────────────────────────
// 工具定义
// ─────────────────────────────────────────────

const tools = [
  {
    name: 'status',
    description: 'Get current SDLC stage, scope (task isolation + session binding), artifact inventory, missing items, gate states, and cycle count.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Optional explicit task routing (overrides session pin / active pointer)' },
      },
    },
  },
  {
    name: 'workflow',
    description: 'Get full 6-stage workflow view with current progress.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Optional explicit task routing' },
      },
    },
  },
  {
    name: 'advance',
    description: 'Force advance to next SDLC stage. Does artifact produce check unless force=true.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', enum: STAGES.map(s => s.id), description: 'Current stage id' },
        force: { type: 'boolean', description: 'Skip artifact produce check', default: false },
      },
      required: ['from'],
    },
  },
  {
    name: 'reset',
    description: 'Reset SDLC state to planning (full exit semantics — clears engagement, keeps artifacts in place). For starting a new iteration cycle with old artifacts archived, use new_cycle instead.',
    inputSchema: {
      type: 'object',
      properties: {
        keep_history: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'refresh',
    description: 'Force re-detect current stage from artifact existence.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'accept_plan',
    description: 'Engineer explicitly accepts plan.md. Sets state.plan_accepted=true, auto-advances to Stage 3b.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_fix_mode',
    description: 'Enter/exit fix mode. In fix mode, PreToolUse hook blocks test file edits.',
    inputSchema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
    },
  },
  {
    name: 'approve_release',
    description: 'Release manager authorizes production deploy. Sets state.release_approval=true.',
    inputSchema: {
      type: 'object',
      properties: { approver: { type: 'string' } },
      required: ['approver'],
    },
  },
  {
    name: 'set_change_ticket',
    description: 'Set change ticket id (required before editing migration/infra files in Stage 5).',
    inputSchema: {
      type: 'object',
      properties: { ticket_id: { type: 'string' } },
      required: ['ticket_id'],
    },
  },
  {
    name: 'set_stage',
    description: 'Controlled stage rollback/pin (exposes stage_override). Typical use: requirement change → back to design to update spec.md. Override auto-clears on next stage advance.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: STAGES.map(s => s.id), description: 'Target stage id' },
        note: { type: 'string', description: 'Reason for override (audit trail)' },
      },
      required: ['stage'],
    },
  },
  {
    name: 'new_cycle',
    description: 'Start a new iteration cycle: archives current cycle artifacts (intent/spec/plan/REVIEW — never deleted, moved to .sdlc/archive/<cycle-id>/ which stays out of version control), resets stage machine to planning, increments cycle_count, keeps workflow engagement. Use for new requirements or next iterations.',
    inputSchema: {
      type: 'object',
      properties: {
        archive_dir: { type: 'string', description: "Archive root dir (default '.sdlc/archive', gitignored; use 'docs/sdlc/archive' to keep archives inside the repo for PR-reviewable audit trails)" },
        keep_history: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'cycle_list',
    description: 'List archived cycle history (from .sdlc/cycles.json).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'task_create',
    description: 'Create an isolated task workspace (.sdlc/tasks/<id>/) with its own state machine and artifact space. Becomes the active MCP task. Sessions bind via task_switch (user natural language like "switch to task X"). Prevents cross-task pollution when working multiple requirements in parallel.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name (slugified to task id)' },
        note: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'task_switch',
    description: 'Switch task context. When this MCP process is session-pinned (default in interactive sessions), switches the SESSION binding only (global pointer untouched — other sessions unaffected); pass global: true or use in CI (no session pin) to switch the global active pointer.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        global: { type: 'boolean', description: 'Also switch the global active task pointer (default false when session-pinned)', default: false },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'task_list',
    description: 'List all tasks with status, cycle counts, and the active task pointer.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'task_close',
    description: 'Close a task (status=closed, removes from active pointer). Optionally archives its artifacts to .sdlc/archive/ (default true, out of version control). Task dir is preserved as audit record.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        archive: { type: 'boolean', default: true },
        archive_dir: { type: 'string', description: "Archive root dir (default '.sdlc/archive')" },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'quick_task',
    description: 'v0.12.0 Input Triage — manage the quick-task queue (one-off side tasks that do NOT belong to the SDLC cycle). action: add (queue a task during an active cycle — processed only after the cycle completes, never mixed into cycle artifacts), list (view queue), run <id> (user explicitly authorizes immediate handling), done <id> (mark complete), drop <id> (discard). Queue is global (.sdlc/quick-tasks.json), survives task switches; agent-side writes must go through this tool (direct file edits are blocked). User-side equivalent: plain natural language (e.g. "queue a side task: fix the typo in README" / "show my quick tasks" / "do task q3 now" / "q3 is done") — the agent maps it to this tool; optionally install the manual into the user prompts dir via scripts/sh/install-prompts.sh and invoke /prompts:sdlc-quick. Note: supplementary info for the CURRENT cycle (e.g. Open questions answers) should NOT be queued — merge it into the current stage artifact instead.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'run', 'done', 'drop'], description: 'Queue operation' },
        desc: { type: 'string', description: 'One-line task description (required for action=add)' },
        id: { type: 'string', description: 'Task id like q3 (required for run/done/drop)' },
        note: { type: 'string', description: 'Optional note (audit trail)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'register_prompts',
    description: 'v0.13.2 Cross-platform registration of the prompts/ playbooks (intent/spec/plan/quick/...) into the user prompts dir (default ~/.codex/prompts, SDLC_PROMPTS_DIR overrides) so they can be invoked via the official /prompts:sdlc-<name> form — the ONLY custom invocation form official Codex supports. NOTE: SessionStart now auto-registers/refreshes these playbooks (zero user action; remove writes an opt-out marker so auto-register stops, register clears it; SDLC_PROMPTS_AUTO=off disables) — so this tool is the EXPLICIT channel for forced refresh / custom dir / uninstall. action: register (install/refresh, idempotent — copies prompts/<name>.md as sdlc-<name>.md, clears opt-out marker), remove (uninstall only the sdlc-* copies made by this plugin, writes opt-out marker so auto-register will not resurrect), list (registration status). Optional dir overrides the target directory. Pure Node fs — works identically on macOS/Linux/Windows (bash script install-prompts.sh and PowerShell install-prompts.ps1 remain as platform conveniences; platform-mismatched script calls are intercepted by the PreToolUse environment guard with alternatives). User-side trigger: plain natural language (e.g. "刷新操作手册到最新版本" / "卸载 prompts 手册" / "看注册状态") — the agent maps it to this tool. Not registering changes nothing: natural language already drives every capability.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['register', 'remove', 'list'], description: 'Registration operation (default register)' },
        dir: { type: 'string', description: 'Optional target prompts dir (default ~/.codex/prompts, or SDLC_PROMPTS_DIR)' },
      },
    },
  },
  {
    name: 'loop_resolve',
    description: 'Resolve an active fix-loop interruption (v0.7.0 Fix Loop Guard). When the same test failure repeats (A->A / A->B->A oscillation, cross-cycle) or consecutive failure rounds exceed the limit, code writes are blocked until the user decides. decision: retry (reset rounds, one more fix round), new-intent (archive current cycle, start next intent iteration with the failure as incident), manual (user takes over, agent read-only), escalate (hand off with evidence).',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['retry', 'new-intent', 'manual', 'escalate'] },
        note: { type: 'string', description: 'Optional decision rationale (audit trail)' },
        task_id: { type: 'string', description: 'Optional explicit task routing' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'session_scope',
    description: 'Manage this MCP server process session identity (v0.6.0 session context isolation). Each Codex session spawns its own MCP process which auto-claims a SessionStart ticket for scope routing. show: inspect binding; bind <session_id>: manually correct the pairing; unbind: fall back to global active task pointer routing. All other tools also accept optional task_id for explicit routing.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'bind', 'unbind'], default: 'show' },
        session_id: { type: 'string', description: 'Session id to bind (required for action=bind)' },
      },
    },
  },
  {
    name: 'self_review',
    description: 'Trigger AI self-review of current PR per REVIEW.md policy. Returns instructions for Codex to run three passes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'audit',
    description: 'View recent hook audit log entries (scope-aware: task workspace or project .sdlc/).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 20 } },
    },
  },
  {
    name: 'events',
    description: 'View recent event stream entries (scope-aware).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 20 } },
    },
  },
];

// ─────────────────────────────────────────────
// 路由
// ─────────────────────────────────────────────

async function callTool(name, args) {
  await lifecycleReady;  // 确保桥接完成（失败时 requireLifecycle 抛明确错误）
  routeScope(args || {});  // v0.6.0：每次调用前统一解析作用域（显式 task_id > env > 会话 pin > 回退）
  markEngagedOnce(name);  // v0.13.0：MCP 首次调用 = 显式参与（幂等；原 /sdlc-* 命令置位的替代通道）
  switch (name) {
    case 'status': return toolStatus();
    case 'workflow': return toolWorkflow();
    case 'advance': return toolAdvance(args || {});
    case 'reset': return toolReset(args || {});
    case 'refresh': return toolRefresh();
    case 'accept_plan': return toolAcceptPlan();
    case 'set_fix_mode': return toolSetFixMode(args || {});
    case 'approve_release': return toolApproveRelease(args || {});
    case 'set_change_ticket': return toolSetChangeTicket(args || {});
    case 'set_stage': return toolSetStage(args || {});
    case 'new_cycle': return toolNewCycle(args || {});
    case 'loop_resolve': return toolLoopResolve(args || {});
    case 'cycle_list': return toolCycleList();
    case 'quick_task': return toolQuickTask(args || {});
    case 'register_prompts': return toolRegisterPrompts(args || {});
    case 'task_create': return toolTaskCreate(args || {});
    case 'task_switch': return toolTaskSwitch(args || {});
    case 'task_list': return toolTaskList();
    case 'task_close': return toolTaskClose(args || {});
    case 'session_scope': return toolSessionScope(args || {});
    case 'self_review': return toolSelfReview();
    case 'audit': return toolAudit(args || {});
    case 'events': return toolEvents(args || {});
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ─────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────


module.exports = { tools, callTool };
