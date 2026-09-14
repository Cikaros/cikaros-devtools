#!/usr/bin/env node
/**
 * post-tool-use.mjs — PostToolUse hook（触发点 4/6，异步）
 *
 * 工件驱动状态机（与 Anthropic playbook 对齐）：
 *   - 监听 Edit/Write/apply_patch 创建的文件
 *   - 检测到当前阶段的产出工件被创建 → 调用 advanceStage 推进
 *   - 检测到 Bash 命令含 make test / npm test / pytest → 检查退出码，更新 state.test_pass
 *   - 检测到 git push / gh pr create → 更新 state.deploy_initialized
 *
 * v0.5.0 生命周期（详见 docs/lifecycle.md）：
 *   - scope 路由：状态/工件全部按会话绑定任务隔离
 *   - maintain 闭环自动归档：新 intent.md 落地时旧周期 spec/plan/REVIEW 归档，
 *     新 intent 保留为下一周期起点（playbook：“incident → 新 intent.md → 回 Stage 1”）
 *
 * v0.13.12 沙盒拒绝证据层（三层联动的第二层）：Bash 命令失败输出命中
 *   Codex 沙盒/网络拒绝特征（network access is disabled / sandbox denied /
 *   EPERM / ENOTFOUND …）时，记入 hooks-state.sandbox_denied（供下回合
 *   UserPromptSubmit 注入授权应对提醒）+ events.jsonl 审计事件。被拒的
 *   **测试命令不计入 test_runs / 失败轮次**——沙盒拒绝 ≠ 测试失败，计入
 *   会误导 fix_loop 以为代码有问题（宁缺勿假，与 v0.13.4 证据门槛同理念）。
 *   第一层（PreToolUse 预防性预警）与第三层（UserPromptSubmit 回合提醒）
 *   见 pre-tool-use.mjs 规则 0f / user-prompt-submit.mjs 1f。
 *
 * v0.13.13 在场推断层（审批等待通知的伴生）：网络/端口类命令**完成**时
 *   （无论成败——成功=用户刚批准或自动放行；被拒=用户刚拒绝或沙盒自动
 *   拒绝）刷新 hooks-state.netport_last_exec_at。PreToolUse 审批等待通知
 *   （lib/notify.mjs notifyApprovalWait）据此在「在场窗口」（默认 120s）内
 *   静默——连续审批时人就在终端不打扰；窗口外的新审批等待重新通知。
 *   会话接管归一与 sandbox_denied 同语义（新会话不残留旧在场记录）。
 *
 * 输入（stdin JSON）：
 *   { session_id, cwd, tool_name, tool_input, tool_response: { stdout, exit_code, ... }, hook_event_name: "PostToolUse" }
 *
 * 输出（stdout JSON）：{}
 */

import { resolve, basename } from 'node:path';
import {
  parseInput, projectRootOf, emitHookOutput, appendAudit, appendEvent,
  readCodexState, writeCodexState, fileExists, fileMtime,
  resolveScope, archiveCycleArtifacts, appendGlobalAudit, parseOpenQuestions,
  extractTestFailureSignature, detectFixLoop, isTestCommand, isEngaged, ensureProjectBootstrap,
  mutateCodexState,
} from './lib/common.mjs';
import {
  detectStage, advanceStage, STAGE_BY_ID, findArtifact,
} from './lib/stage-detector.mjs';
import { detectSandboxDenial, netPortKind } from './lib/sandbox.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();

// v0.5.0 作用域路由（会话亲和）
const scope = resolveScope(projectRoot, input);

const toolName = input.tool_name || input.tool || '';
const toolInput = input.tool_input || {};
const toolResponse = input.tool_response || {};
const filePath = toolInput.file_path || toolInput.path || '';
const command = toolInput.command || '';

const stateRaw = readCodexState(scope, 'state.json');
const state = stateRaw || {};
const beforeDetection = detectStage(scope);
// 关键：使用 state.current_stage（保存的上一阶段）而非 beforeDetection.stage
// 因为 beforeDetection 反映的是工件已创建后的状态（如 intent.md 已存在 → design）
// 我们要判定的是"工件创建前"我们在哪个阶段，从而决定是否推进
//
// v0.5.1 修复：state.json 不存在（首个 hook 即 PostToolUse 的乱序场景）时，
// 此前回退 beforeDetection.stage（写后检测值）——首写工件永不推进：
// 写 intent.md 后 detection=design，savedStageId=design ≠ planning → 推进链断裂。
// 规则：状态文件缺失 → 自举为 planning（与 session-start 全新项目初始化一致）；
//       文件存在但缺 current_stage（损坏）→ 维持旧行为回退检测值。
const savedStageId = state.current_stage || (stateRaw ? beforeDetection.stage : 'planning');

const events = [];

// ─────────────────────────────────────────────
// 1. 工件文件创建/修改 → 阶段推进
// ─────────────────────────────────────────────
// 注意：plan.md 不在此自动推进表中——plan.md 创建后需工程师显式 accept_plan 才推进到 build_impl
// （playbook 治理要求："工程师需审查 plan.md 并显式接受"）
// v0.6.0：intent.md 增设 Open questions 门禁（见 checkIntentOpenQuestions）——
// 未回答项存在时不推进，留在 planning/awaiting_answers（与 plan.md 的 accept 门禁同构）
const artifactMap = {
  'intent.md': 'planning',
  'spec.md': 'design',
  'REVIEW.md': 'deploy',
};

/**
 * v0.6.0 Intent Open questions 门禁（交互闭环核心）：
 * intent.md 的 Open questions 是写给发起者的问题——必须在对话中呈现并等待回答。
 * 判定：解析 `## Open questions` 章节，存在未回答条目 → 阻止推进（置位状态 + 事件，
 * 由 Stop/SessionStart/UserPromptSubmit 提醒 agent 呈现问题）；全部已回答/为空 → 放行。
 * 已回答的标记约定：移除条目，或标记 `- [x]` / `~~删除线~~` / 行尾 [resolved]。
 * @returns {boolean} true = 存在未回答项（应阻止推进）
 */
function checkIntentOpenQuestions(scope, state, events, reason) {
  const found = findArtifact(scope, 'intent.md');
  if (!found) return false;
  const oq = parseOpenQuestions(found.path);
  if (oq.unresolved > 0) {
    state.intent_awaiting_answers = true;
    state.intent_open_questions = oq.unresolved;
    state.intent_questions_raised_at = state.intent_questions_raised_at || new Date().toISOString();
    events.push({ type: 'intent_questions_raised', unresolved: oq.unresolved, reason: reason || 'artifact_written' });
    appendEvent(scope, 'intent_questions_raised', {
      unresolved: oq.unresolved, artifact: 'intent.md', path: found.rel,
      reason: reason || 'artifact_written',
      questions: oq.items.filter(i => !i.resolved).map(i => i.text).slice(0, 10),
    });
    return true;
  }
  // 全部已回答（或本无问题）→ 清除等待标记
  state.intent_awaiting_answers = false;
  state.intent_open_questions = 0;
  return false;
}

/**
 * v0.5.1（B1 修复）：从 apply_patch 的 patch 文本中提取「创建/修改」的文件路径。
 * Codex 的主编辑工具 apply_patch 的 tool_input 只有 patch 字段（无 file_path），
 * 此前 post-tool-use 只认 file_path/path —— 真实 Codex 环境下工件写入
 * 完全不触发阶段推进 / sdlc_engaged 置位 / maintain 闭环（状态机失效）。
 * 只提取 Add/Update File（Delete 不是创建；Move to 的源文件不存在了）。
 */
function patchCreatedTargets(patchText) {
  const text = String(patchText || '');
  if (!text) return [];
  const re = /^\*\*\*\s+(?:Add|Update)\s+File:\s+(.+)$/gm;
  const paths = [];
  for (const m of text.matchAll(re)) {
    const p = m[1].trim();
    if (p) paths.push(p);
  }
  return paths;
}

// 本次调用涉及的「已落地」文件：file_path/path + patch 内 Add/Update 目标（存在性校验）
const candidatePaths = [];
if (filePath) candidatePaths.push(filePath);
if (toolInput.patch) candidatePaths.push(...patchCreatedTargets(toolInput.patch));
const createdFiles = candidatePaths.filter(p => p && fileExists(resolve(projectRoot, p)));
const createdFile = createdFiles[0] || null;   // 兼容旧变量（audit 等单值场景）

// v0.4.0 工作流参与标记：agent 写入任一阶段工件 → 本项目已参与 ai-sdlc 工作流，
// 此后 PreToolUse 硬门禁（block）生效；未参与时门禁降级为 warn（防误伤无关仓库）
const ARTIFACT_BASENAMES = ['intent.md', 'spec.md', 'plan.md', 'review.md'];
if (createdFiles.some(cf => ARTIFACT_BASENAMES.includes(basename(cf).toLowerCase()))) {
  if (!state.sdlc_engaged) {
    state.sdlc_engaged = true;
    state.sdlc_engaged_at = new Date().toISOString();
    const art = createdFiles.find(cf => ARTIFACT_BASENAMES.includes(basename(cf).toLowerCase()));
    events.push({ type: 'workflow_engaged', artifact: basename(art) });
    appendEvent(scope, 'workflow_engaged', { artifact: basename(art), path: art });
  }
  // v0.10.0：工件落地即幂等复查项目引导（限定在工件写入时执行，成本为几个
  // existsSync）——覆盖三类场景：① 首个工件在首个会话内写入（SessionStart 已
  // bootstrap，幂等复查）；② 后装 git 的项目（首次会话时无 .git，托管块未建）；
  // ③ 用户中途删除托管块 / 老版本初始化的存量项目（治愈）。异步 hook，无延迟顾虑。
  try {
    const boot = ensureProjectBootstrap(projectRoot);
    if (boot.actions.length > 0) {
      events.push({ type: 'project_bootstrapped', actions: boot.actions });
    }
  } catch {}
}

if (createdFiles.length > 0) {
  const currentStageId = savedStageId;
  const currentStage = STAGE_BY_ID[currentStageId];

  // v0.5.0 maintain 闭环自动归档：maintain 阶段新写 intent.md = incident 触发新周期。
  // 旧周期的 spec/plan/REVIEW 归档（不删除），新 intent.md 保留为下一周期起点。
  // 若不归档，旧工件会让阶段检测永远判在后期阶段，新周期无法启动。
  // 注：v0.4.0 该闭环仅在 MCP advance 路径可达（artifactMap 无 maintain 条目，
  //     hook 侧死代码）；v0.5.0 在此显式打通 hook 侧闭环。
  // v0.5.1：适配 apply_patch（任一落地文件为 intent.md 即触发）
  if (currentStageId === 'maintain'
      && createdFiles.some(cf => basename(cf).toLowerCase() === 'intent.md')) {
    const archived = archiveCycleArtifacts(scope, { keep: ['intent.md'], reason: 'maintain_closed_loop' });
    if (archived) {
      events.push({ type: 'cycle_archived', archived: archived.archived.map(a => a.name), dir: archived.dir });
      appendEvent(scope, 'cycle_archived', {
        archived: archived.archived.map(a => a.name), dir: archived.dir, reason: 'maintain_closed_loop',
      });
      appendGlobalAudit(projectRoot, {
        hook: 'post_tool_use', trigger: 'PostToolUse',
        result: 'cycle_archived',
        detail: { task: scope.taskId, cycle: archived.cycle, dir: archived.dir },
      });
      // 归档即完成一个周期（计数与索引已由 archiveCycleArtifacts 写入）
      state.cycle_count = archived.cycle;
      state.cycle_id = `cycle-${String(archived.cycle).padStart(3, '0')}`;
    }
    // 闭环推进链：maintain→planning（playbook 闭环语义）→ design（intent.md 已落地，
    // 与工件驱动检测保持一致——否则 state.current_stage=planning 而 detection=design，
    // 同一会话内后续 spec.md 写入无法触发推进）
    const adv = advanceStage(scope, 'maintain');
    if (adv.ok) {
      events.push({ type: 'stage_advanced', from: 'maintain', to: adv.next, reason: 'closed_loop' });
      appendEvent(scope, 'stage_advanced', {
        from: 'maintain', to: adv.next, reason: 'closed_loop',
        cycle_count: state.cycle_count || 0,
      });
      events.push({ type: 'cycle_completed', count: state.cycle_count || 0 });
      // v0.6.0：新周期 intent.md 若仍有未回答 Open questions → 停在 planning
      // （交互闭环跨周期一致：新意图同样需要发起者回答开放问题）
      if (checkIntentOpenQuestions(scope, state, events, 'maintain_closed_loop')) {
        events.push({ type: 'advance_held', at: 'planning', reason: 'intent_open_questions_pending' });
        appendEvent(scope, 'advance_held', { at: 'planning', reason: 'intent_open_questions_pending' });
      } else {
        const adv2 = advanceStage(scope, 'planning');
        if (adv2.ok) {
          events.push({ type: 'stage_advanced', from: 'planning', to: adv2.next, reason: 'closed_loop_intent_ready' });
          appendEvent(scope, 'stage_advanced', {
            from: 'planning', to: adv2.next, reason: 'closed_loop_intent_ready',
          });
        }
      }
    }
  }

  // 工件匹配检查（plan.md 由 build_plan 阶段产出，spec.md 由 design 阶段产出，等等）
  // v0.5.1：逐个落地文件判定（apply_patch 单次可写多个文件）
  for (const cf of createdFiles) {
    const baseName = basename(cf).toLowerCase();
    for (const [artifactName, producingStage] of Object.entries(artifactMap)) {
      if (baseName === artifactName.toLowerCase() && currentStageId === producingStage) {
        // 工件存在性最终校验（避免 hook 在写入完成前提前触发）
        const found = findArtifact(scope, artifactName);
        if (found) {
          // v0.6.0 Open questions 门禁：intent.md 仍含未回答的开放问题时不得推进。
          // 语义：问题必须先呈现给发起者并等待回答（Stop/下回合注入会提醒）。
          // 逃生通道：用户明确同意后 MCP advance force=true。
          if (artifactName === 'intent.md' && checkIntentOpenQuestions(scope, state, events, 'artifact_written')) {
            // hold：显式维持 planning（advanceStage 被跳过，state 需有 current_stage，
            // 否则首次门禁拦截后 state.json 缺字段——下游 savedStageId 退化）
            state.current_stage = state.current_stage || 'planning';
            events.push({ type: 'advance_held', at: 'planning', reason: 'intent_open_questions_pending', artifact: 'intent.md' });
            continue;
          }
          const adv = advanceStage(scope, producingStage);
          if (adv.ok) {
            events.push({ type: 'stage_advanced', from: producingStage, to: adv.next, artifact: artifactName });
            appendEvent(scope, 'stage_advanced', {
              from: producingStage, to: adv.next,
              artifact: artifactName, path: found.rel,
            });

            // 闭环计数（maintain→planning）
            if (producingStage === 'maintain' && adv.next === 'planning') {
              state.cycle_count = (state.cycle_count || 0) + 1;
              state.cycle_id = `cycle-${String(state.cycle_count).padStart(3, '0')}`;
              events.push({ type: 'cycle_completed', count: state.cycle_count });
            }
          } else {
            events.push({ type: 'advance_blocked', from: producingStage, reason: adv.error });
          }
        }
      }
    }
  }

  // plan.md 创建后不自动推进——需工程师显式 accept_plan
  // （accept_plan 由 MCP 工具设置 state.plan_accepted=true，
  //   随后任意 PostToolUse 会通过下方的 plan_accepted_post 路径推进；
  //   v0.5.1 起 MCP accept_plan 也会直接推进）
}

// 1b. plan_accepted 但当前还在 build_plan → 推进到 build_impl（接受后任意 PostToolUse 都触发）
//     这覆盖 MCP 工具设置 plan_accepted 后立即推进的场景
if (savedStageId === 'build_plan' && state.plan_accepted) {
  const adv = advanceStage(scope, 'build_plan');
  if (adv.ok) {
    events.push({ type: 'stage_advanced', from: 'build_plan', to: 'build_impl', reason: 'plan_accepted_post' });
    appendEvent(scope, 'stage_advanced', {
      from: 'build_plan', to: 'build_impl', reason: 'plan_accepted_post',
    });
  }
}

// ─────────────────────────────────────────────
// 2. 测试命令执行 → 更新 state.test_pass
// ─────────────────────────────────────────────
if (toolName === 'Bash' || toolName === 'shell' || toolName === 'Shell') {
  // v0.7.0 测试命令识别（common.isTestCommand 单一事实源：显式形式 +
  // 裸 runner 段首词防误伤）；Bash 工具名兼容 'shell'（协议不对称防御）
  // v0.13.12 沙盒拒绝证据层（先于测试计数——被拒的测试命令不计失败轮次）：
  //   失败输出命中 Codex 沙盒/网络拒绝特征 → 记 hooks-state.sandbox_denied
  //   （下回合 UserPromptSubmit 1f 注入授权应对提醒）+ 事件留痕。沙盒拒绝
  //   ≠ 测试失败：计入 test_runs/fix_rounds 会误导 fix_loop 以为代码有问题。
  const sandboxDenial = command ? detectSandboxDenial({ command, toolResponse }) : null;
  if (sandboxDenial) {
    appendEvent(scope, 'sandbox_denied', {
      kind: sandboxDenial.kind,
      command_kind: sandboxDenial.command_kind,
      evidence: sandboxDenial.evidence,
      command: command.slice(0, 120),
      via: 'post_tool_use',
    });
    try {
      // 覆盖语义：只保留最近一次被拒记录（提醒层呈现一次即清除；新拒绝
      //   覆盖旧拒绝——agent 只需处理最新一条）。会话接管归一与
      //   readHooksStateForSession / user-prompt-submit 同语义：磁盘记录属
      //   其他会话（会话恢复后 PostToolUse 先于任何 UserPromptSubmit 运行的
      //   窗口）→ 重置会话级字段后以本会话身份写入，否则拒绝记录静默丢失
      mutateCodexState(scope, 'hooks-state.json', (cur) => {
        let c = cur || {};
        if (input.session_id && c.session_id && c.session_id !== input.session_id) {
          c = {
            session_id: input.session_id,
            session_started_at: new Date().toISOString(),
            taken_over_from: c.session_id,
            injected_files: [],
            cumulative_tokens: 0,
            last_inject_tokens: 0,
            hooks_executed: 0,
            sandbox_protocol_shown: false,
            sandbox_denied: null,
            netport_last_exec_at: null,
          };
        }
        if (!input.session_id || !c.session_id || c.session_id === input.session_id) {
          if (!c.session_id && input.session_id) c.session_id = input.session_id;
          c.sandbox_denied = {
            at: new Date().toISOString(),
            command: command.slice(0, 160),
            kind: sandboxDenial.kind,
            evidence: sandboxDenial.evidence,
          };
        }
        return c;
      });
    } catch { /* 记录失败仅丢一次提醒（PreToolUse 预警层仍在），方向安全 */ }
  }

  // v0.13.13 在场推断（审批等待通知的伴生层）：网络/端口命令完成（无论
  //   成败）→ 刷新 hooks-state.netport_last_exec_at。命令能完成就意味着：
  //   ① 用户刚在审批弹窗上选过（y 批准 / esc 拒绝——人在终端），或
  //   ② 该环境自动放行（不存在弹窗等待——同时抑制上一次预测式通知的
  //   后续假阳性）。两类都值得静默一段时间；PreToolUse 的审批通知在场
  //   窗口（默认 120s）内不重复打扰。sandboxDenial.command_kind 复用
  //   detectSandboxDenial 内部已算好的 netPortKind 结果，避免二次词法。
  //   会话接管归一与上方 sandbox_denied 同语义（新会话不残留旧在场记录，
  //   接管后首个网络/端口命令的审批等待照常通知）。
  const netKind = sandboxDenial
    ? sandboxDenial.command_kind
    : (command ? netPortKind(command) : null);
  if (netKind) {
    try {
      mutateCodexState(scope, 'hooks-state.json', (cur) => {
        let c = cur || {};
        if (input.session_id && c.session_id && c.session_id !== input.session_id) {
          c = {
            session_id: input.session_id,
            session_started_at: new Date().toISOString(),
            taken_over_from: c.session_id,
            injected_files: [],
            cumulative_tokens: 0,
            last_inject_tokens: 0,
            hooks_executed: 0,
            sandbox_protocol_shown: false,
            sandbox_denied: null,
            netport_last_exec_at: null,
          };
        }
        if (!input.session_id || !c.session_id || c.session_id === input.session_id) {
          if (!c.session_id && input.session_id) c.session_id = input.session_id;
          c.netport_last_exec_at = Date.now();
          c.netport_last_exec_kind = netKind;
        }
        return c;
      });
    } catch { /* 在场刷新失败仅多通知一次（窗口退化），方向安全 */ }
  }

  const isTestCmd = command && isTestCommand(command);
  if (isTestCmd && sandboxDenial) {
    // 被拒的测试命令：不计 test_runs / 不置 test_pass / 不进失败轮次——
    //   命令根本没跑起来，失败证据属于沙盒而非代码（事件已在上方留痕）
    appendEvent(scope, 'test_sandbox_denied_not_counted', {
      command: command.slice(0, 100),
      kind: sandboxDenial.kind,
      reason: 'sandbox/network denial is not a test failure — fix_rounds untouched',
    });
  } else if (isTestCmd) {
    // v0.13.4 测试证据门槛：tool_response 缺失且无 exit_code/success 字段时
    //   无法判定执行结果——此前回退 exitCode=0（视为通过），空响应事件会虚增
    //   test_runs 并置 test_pass=true，「未测试禁 push/PR」门禁可被误置绕过。
    //   修复：无明确执行证据 → 不计数不置位，仅事件留痕（宁缺勿假）。
    const hasExitEvidence = typeof toolResponse.exit_code === 'number'
      || (typeof toolResponse.success === 'boolean');
    if (!hasExitEvidence) {
      appendEvent(scope, 'test_evidence_missing', {
        command: command.slice(0, 100),
        reason: 'tool_response has neither exit_code nor success — not counted as test evidence',
      });
    } else {
    const exitCode = typeof toolResponse.exit_code === 'number'
      ? toolResponse.exit_code
      : (toolResponse.success === false ? 1 : 0);
    const passed = exitCode === 0;
    state.test_pass = passed;
    state.last_test_at = new Date().toISOString();
    state.last_test_command = command.slice(0, 200);
    state.last_test_exit_code = exitCode;
    // v0.7.0 测试门禁：真实执行计数（未测试不得 push/PR/报告完成）
    state.test_runs = (state.test_runs || 0) + 1;
    events.push({ type: 'test_executed', passed, exit_code: exitCode });
    appendEvent(scope, 'test_executed', {
      passed, exit_code: exitCode, command: command.slice(0, 100),
    });

    // v0.7.0 失败路径：签名记录 + 轮次计数 + 循环检测中断
    if (!passed) {
      const sigInfo = extractTestFailureSignature(toolResponse.stdout, command, exitCode);
      state.test_failures = Array.isArray(state.test_failures) ? state.test_failures : [];
      state.test_failures.push({
        ts: new Date().toISOString(),
        sig: sigInfo.sig, kind: sigInfo.kind,
        summary: sigInfo.summary,
        command: command.slice(0, 120),
        exit_code: exitCode,
        cycle: state.cycle_id || null,
      });
      // 历史上限（防状态文件膨胀；循环窗口只需要最近 5 条）
      if (state.test_failures.length > 50) state.test_failures = state.test_failures.slice(-50);
      state.fix_rounds = (state.fix_rounds || 0) + 1;
      events.push({
        type: 'test_failed', rounds: state.fix_rounds,
        sig: sigInfo.sig, kind: sigInfo.kind, summary: sigInfo.summary.slice(0, 80),
      });
      appendEvent(scope, 'test_failed', {
        rounds: state.fix_rounds, sig: sigInfo.sig, kind: sigInfo.kind,
        summary: sigInfo.summary, cycle: state.cycle_id || null,
        command: command.slice(0, 100),
      });

      // 循环检测：同签名重复（A→A / A→B→A，含跨周期）或轮次超限 → fix_loop 中断
      // v0.7.0 扫描轮 3：仅对已参与 ai-sdlc 工作流的项目置位——普通仓库调试时
      // 连续失败 3 次是常态，中断门禁（阻断代码写入）必须以显式参与为前提
      // （与 PreToolUse 全部 block 级门禁的 engagement 语义一致，防 v0.3 式误伤）。
      // v0.10.0：判定统一至 common.isEngaged（此前本处漏 change_ticket——
      // 设过工单的项目在 push 门禁与循环置位处会得出相反结论）。
      const engagedForLoop = isEngaged(state);
      const loop = engagedForLoop ? detectFixLoop(state) : null;
      if (loop) {
        state.fix_loop = loop;
        events.push({ type: 'fix_loop_detected', kind: loop.kind, rounds: loop.rounds });
        appendEvent(scope, 'fix_loop_detected', {
          kind: loop.kind, rounds: loop.rounds,
          repeated_sig: loop.repeated_sig, summary: loop.summary,
          hint: loop.hint,
        });
        appendGlobalAudit(projectRoot, {
          hook: 'post_tool_use', trigger: 'PostToolUse',
          result: 'fix_loop_detected',
          detail: { kind: loop.kind, rounds: loop.rounds, task: scope.taskId, cycle: state.cycle_id || null },
        });
      }
    } else {
      // 通过：轮次清零（失败历史保留供循环检测）；在飞的循环中断自然解除
      state.fix_rounds = 0;
      if (state.fix_loop) {
        const cleared = { reason: 'test_passed', kind: state.fix_loop.kind };
        state.fix_loop = null;
        events.push({ type: 'fix_loop_cleared', ...cleared });
        appendEvent(scope, 'fix_loop_cleared', cleared);
      }
    }

    // 若 build_impl 阶段测试通过 → 自动推进到 test 阶段
    if (passed && savedStageId === 'build_impl') {
      const adv = advanceStage(scope, 'build_impl');
      if (adv.ok) {
        events.push({ type: 'stage_advanced', from: 'build_impl', to: 'test', reason: 'test_passed' });
        appendEvent(scope, 'stage_advanced', {
          from: 'build_impl', to: 'test', reason: 'test_passed',
        });
      }
    }
    } // v0.13.4 hasExitEvidence else 块结束
  }

  // git push / gh pr create → deploy_initialized
  const isDeployCmd = /\b(git\s+push|gh\s+pr\s+create)\b/.test(command);
  if (isDeployCmd && savedStageId === 'test') {
    state.deploy_initialized = true;
    state.last_deploy_init_at = new Date().toISOString();
    const adv = advanceStage(scope, 'test');
    if (adv.ok) {
      events.push({ type: 'stage_advanced', from: 'test', to: 'deploy', reason: 'pr_created' });
      appendEvent(scope, 'stage_advanced', {
        from: 'test', to: 'deploy', reason: 'pr_created',
      });
    }
  }

  // git merge to main / gh pr merge → maintain
  const isMergeCmd = /\b(git\s+merge|gh\s+pr\s+merge)\b/.test(command);
  if (isMergeCmd && savedStageId === 'deploy' && state.release_approval) {
    state.last_deployed_at = new Date().toISOString();
    const adv = advanceStage(scope, 'deploy');
    if (adv.ok) {
      events.push({ type: 'stage_advanced', from: 'deploy', to: 'maintain', reason: 'pr_merged' });
      appendEvent(scope, 'stage_advanced', {
        from: 'deploy', to: 'maintain', reason: 'pr_merged',
      });
    }
  }
}

// ─────────────────────────────────────────────
// 3. 写回 state
//    关键：advanceStage() 已经写了一个新版本的 state.json，我们需要重新读取
//    它并把本 hook 内的额外字段（test_pass / last_test_at / deploy_initialized / …）
//    合并进去，避免用旧 state 覆盖 advanceStage 写入的 current_stage
//    v0.13.5 X-lock：合并与写入锁内执行（锁内重读最新盘值）——本 hook 初始
//    读之后、写入之前的并发更新（MCP 工具/另一 PostToolUse）不再被旧快照
//    覆盖回退（丢 current_stage / test_pass / sdlc_engaged）
// ─────────────────────────────────────────────
mutateCodexState(scope, 'state.json', (advancedState0) => {
  const advancedState = advancedState0 || {};
  // 合并：advancedState（锁内新鲜盘值）优先（含新的 current_stage / previous_stage），
  //       旧 state 补充 advancedState 没有的字段
  const mergedState = { ...state, ...advancedState };
  // v0.5.0：sdlc_engaged 一旦置位永不回退（除非 MCP reset / 删除 .sdlc/）
  mergedState.sdlc_engaged = state.sdlc_engaged || advancedState.sdlc_engaged || false;
  mergedState.sdlc_engaged_at = state.sdlc_engaged_at || advancedState.sdlc_engaged_at || null;
  // 再次合并本 hook 内更新的字段（test 相关 / deploy 相关 / 周期计数）
  // 注：cycle_count/cycle_id 以本 hook 内存值为准（maintain 闭环归档在本 hook 内
  //     递增，advanceStage 从磁盘读到的仍是旧值——否则闭环计数丢失）
  mergedState.test_pass = state.test_pass ?? advancedState.test_pass ?? false;
  mergedState.last_test_at = state.last_test_at || advancedState.last_test_at;
  mergedState.last_test_command = state.last_test_command || advancedState.last_test_command;
  mergedState.last_test_exit_code = state.last_test_exit_code ?? advancedState.last_test_exit_code;
  // v0.7.0：测试门禁与循环中断字段——本 hook 内存值优先（fix_loop 刚置位/刚清零时
  // advancedState 是旧盘值，直接合并会覆盖掉本次判定——与 v0.6.0 intent_awaiting
  // 标记被覆盖同类问题）。fix_loop 需用 'in' 判定：null（刚清零）也是有效内存值。
  mergedState.test_runs = state.test_runs ?? advancedState.test_runs ?? 0;
  mergedState.fix_rounds = state.fix_rounds ?? advancedState.fix_rounds ?? 0;
  mergedState.test_failures = state.test_failures ?? advancedState.test_failures ?? [];
  mergedState.fix_loop = 'fix_loop' in state ? state.fix_loop : (advancedState.fix_loop ?? null);
  mergedState.deploy_initialized = state.deploy_initialized ?? advancedState.deploy_initialized ?? false;
  mergedState.last_deploy_init_at = state.last_deploy_init_at || advancedState.last_deploy_init_at;
  mergedState.last_deployed_at = state.last_deployed_at || advancedState.last_deployed_at;
  mergedState.cycle_count = state.cycle_count ?? advancedState.cycle_count ?? 0;
  mergedState.cycle_id = state.cycle_id || advancedState.cycle_id || null;
  // v0.6.0：Open questions 门禁状态以本 hook 内存值为准（门禁阻止推进时
  // advancedState 是旧盘内容，会覆盖掉刚置位的 awaiting 标记）
  mergedState.intent_awaiting_answers = state.intent_awaiting_answers ?? advancedState.intent_awaiting_answers ?? false;
  mergedState.intent_open_questions = state.intent_open_questions ?? advancedState.intent_open_questions ?? 0;
  mergedState.updated_at = new Date().toISOString();
  return mergedState;
});

// ─────────────────────────────────────────────
// 4. 审计 + 事件
// ─────────────────────────────────────────────
appendAudit(scope, {
  hook: 'post_tool_use', trigger: 'PostToolUse',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    tool: toolName, file: filePath, command_preview: command.slice(0, 80),
    stage_before: beforeDetection.stage,
    events: events.length,
  },
});

emitHookOutput({});
