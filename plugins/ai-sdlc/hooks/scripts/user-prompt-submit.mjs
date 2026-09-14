#!/usr/bin/env node
/**
 * user-prompt-submit.mjs — UserPromptSubmit hook（触发点 2/6）
 *
 * 智能注入策略（与 Anthropic playbook 对齐）：
 *   1. **反模式警告直接注入**（最高优先级，立即生效）
 *   2. **阶段规则首次注入**（去重，进入新阶段时一次性注入该阶段规则摘要）
 *   3. **缺失工件提醒**（当前阶段缺什么、对应手册/模板在哪）
 *
 * v0.5.0（生命周期 + 隔离）：作用域路由、会话接管检测（hooks-state 的 session_id
 *   与当前不符 → 重置注入去重，防跨会话污染）。生命周期操作（任务/周期/循环决策）
 *   经 MCP 工具落地。
 *
 * v0.12.0（输入分流 / Input Triage，详见 rules/triage.md）：每回合轻量分流提醒——
 *   需求/ISSUE→SDLC；补充信息→融入当前工件；临时任务→周期进行中登记排队
 *   （周期走完后处理，二者不混淆）、无周期则直接处理。
 *
 * v0.13.0（命令体系迁移）：官方 Codex 不支持自定义 slash 命令（未知 /xxx 会被
 *   CLI 直接拒绝，不会提交给模型，本 hook 永远收不到）——移除 v0.5.0-v0.12.0
 *   间本文件内的 /sdlc-* 命令解释器（死代码）。交互改为：用户自然语言 →
 *   agent 调 MCP 工具（quick_task / task_* / new_cycle / loop_resolve…，
 *   SessionStart 已注入「意图→工具映射表」）；用户可选把 prompts/ 手册注册到
 *   用户 prompts 目录后用官方 /prompts:<name> 调用。sdlc_engaged 的显式参与
 *   语义不再由 slash 命令置位，改由 MCP 首次调用与工件写入（PostToolUse）置位。
 *
 * v0.13.11（生命周期记忆锚点）：上下文压缩后 agent 会丢失「现在在哪、卡在哪、
 *   下一步做什么」的记忆（用户实测：plan 已产出等接受，用户说「接受」后
 *   agent 直接尝试改业务代码被门禁拦、又被引号误报拦住只读排查、且会话
 *   未暴露 MCP 工具无通道记录接受 → 死锁）。本回合起每回合注入：
 *   - 0b 生命周期状态条（全阶段紧凑两行——压缩后仍可从本条恢复状态）
 *   - 1e plan 等待接受提醒（含保守接受意图识别：用户说「接受/同意/批准」
 *     时给出明确指令 + MCP/CLI 双通道；与 1b/1c 同为交互门禁回合级锚点）
 *   - 1f 沙盒拒绝提醒（v0.13.12：上一命令被 Codex 沙盒拒绝时注入授权应对
 *     协议——三层联动的第三层；呈现一次即清除，不进 token 去重）
 *
 * 输入（stdin JSON）：{ session_id, cwd, turn_id, prompt, hook_event_name: "UserPromptSubmit" }
 *
 * 输出（stdout JSON）：
 *   { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "..." } }
 */

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  parseInput, projectRootOf, emitHookOutput, emitEmpty, appendAudit,
  readCodexState, writeCodexState, PLUGIN_ROOT, headLines, estimateTokens,
  resolveScope, readHooksStateForSession, queuedQuickTasks, mutateCodexState,
} from './lib/common.mjs';
import { detectStage, STAGES, STAGE_BY_ID, detectAntiPatterns } from './lib/stage-detector.mjs';
import { sandboxDeniedReminderText } from './lib/sandbox.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();
const prompt = typeof input.prompt === 'string' ? input.prompt : '';

// v0.5.0 作用域路由（会话亲和）
const scope = resolveScope(projectRoot, input);
// v0.13.0：官方 CLI 不支持自定义 slash 命令（未知命令不会到达本 hook），
// 不再识别 /sdlc-* 前缀；生命周期/队列操作全部经 MCP 工具落地

// v0.13.0 注：以下生命周期/队列操作入口已移除（官方 CLI 拒绝未知 slash 命令，
// 相关文本永远到不了本 hook）。等价能力全部由 MCP 编排器工具提供，并由
// SessionStart 注入的「意图→工具映射表」引导 agent 从自然语言路由到工具：
//   任务管理 task_create/task_switch/task_list/task_close、
//   新周期 new_cycle、循环决策 loop_resolve、临时任务队列 quick_task

// 读取 hooks-state（v0.5.0 会话接管检测：跨会话去重污染防护）
const hooksState = readHooksStateForSession(scope, input.session_id || null);
const injectedFiles = new Set(hooksState.injected_files || []);
const cumulativeTokens = hooksState.cumulative_tokens || 0;
const detection = detectStage(scope, { promptHint: prompt });
// v0.13.10 有效阶段：检测值与保存值中更靠后者（与 session-start 阶段守卫 /
//   Stop 同语义）。git diff 是瞬态的——测试通过并提交后检测跌回 build_impl
//   而保存值在 test/deploy；阶段规则注入 / 阶段语义提示必须按真实所处阶段
//   呈现，否则 deploy 阶段的回合被注入 build_impl 规则（误导 agent）。
//   awaiting_answers 门禁仍按 detection 判定（intent+Open questions 的检测
//   值在该窗口是权威的）。
const stateForStage = readCodexState(scope, 'state.json') || {};
const STAGE_ORDER = STAGES.map(s => s.id);
const effectiveStageId = (() => {
  const SAVED = STAGE_ORDER.indexOf(stateForStage.current_stage);
  const DET = STAGE_ORDER.indexOf(detection.stage);
  return detection.source === 'state.override'
    || SAVED < 0 || DET < 0 || DET >= SAVED
    ? detection.stage
    : stateForStage.current_stage;
})();
const stage = STAGE_BY_ID[effectiveStageId] || STAGE_BY_ID[detection.stage];

const lines = [];
const newInjectedFiles = [];
const SINGLE_INJECT_LIMIT = 2000;
const CUMULATIVE_LIMIT = 8000;

// v0.13.11 接受意图识别（保守高精度）：误报代价是未经批准的阶段推进，漏报
//   只是回退到通用提醒（agent 仍能从提醒中的通道列表自行连接）——只匹配
//   短消息中的明确肯定形态；含否定/暂缓/修改语义一律判否。
function detectAcceptIntent(p) {
  const s = String(p || '').trim();
  if (!s || s.length > 30) return false;
  // 否定/暂缓/修改/等待语义守卫（「不接受」「暂缓」「先改改」等）
  if (/(不|没|别|无法|暂|先不|不太|难以|否|拒|反对|修改|调整|等等|重新|再)/.test(s)) return false;
  // 纯肯定词：ok / 好的 / 可以 / 开始吧 / approved / lgtm …（后随仅限标点/空白）
  if (/^(?:ok|okay|yes|y|go|good|done|approved|agree[d]?|accepted|lgtm|好的?|可以|行|嗯+|没问题|开始吧?|开干|走起|就这么办)[^\p{L}\d]{0,4}$/iu.test(s)) return true;
  // 接受动词短语：我接受 / 同意这个方案 / 批准该计划，开始吧 …（尾部仅限肯定续词）
  if (/^(?:我|我们|那就?|请)?(?:接受|同意|批准|认可|赞同|赞成)(?:了|一下)?(?:这个|该|此|这份)?(?:计划|方案|plan|它)?(?:吧|了|啊|呀|嗯)*[\s，,。.!！]*(?:(?:开始|继续|进入)(?:实施|开发|下一步|吧)?)?(?:实施|开发|干活)?[\s，,。.!！]*$/u.test(s)) return true;
  // 英文接受短语：I accept / approve the plan / let's go …
  if (/^(?:i\s+|we\s+|let'?s\s+|please\s+)?(?:accept|approve|agreed?|lgtm)\b(?:\s+(?:it|this|the\s+plan|plan))?[.!]?\s*$/i.test(s)) return true;
  return false;
}

// 0. 会话接管提醒（最高优先级）
if (hooksState.taken_over_from) {
  lines.push(`### 会话接管检测`);
  lines.push(`- 本 scope 此前由会话 \`${hooksState.taken_over_from}\` 使用，注入去重已重置`);
  lines.push('');
}

// 0b. v0.13.11 生命周期状态条（每回合轻量注入，不进去重）——上下文压缩后
//     agent 仍可从本条恢复「现在在哪、卡在哪、下一步做什么」（用户实测：
//     压缩后丢失生命周期记忆导致门禁死锁）。两行紧凑呈现；token 预算超额
//     时与门禁类提醒同保留（见第 6 步 essentials 过滤）。
{
  const SUBSTAGE_LABEL = {
    awaiting_answers: '等 Open questions 回答',
    awaiting_acceptance: 'plan 已产出，等接受',
    plan_mode: '产出 plan.md 中',
    implementation: '实施中',
  };
  const NEXT_HINT = {
    planning: '产出 intent.md（发起者意图与 Open questions）',
    design: '产出 spec.md（行为规格）',
    build_plan: '产出 plan.md（实施方案）',
    build_impl: '按 plan 实施并写测试（测试通过自动进 Stage 4）',
    test: '运行测试直至通过（test_pass 置位后自动进 Stage 5）',
    deploy: 'PR 合并与发布授权（approve_release）；迁移文件需变更工单（set_change_ticket）',
    maintain: '分诊触发队列 / new_cycle 开下一周期',
  };
  const sub = (detection.stage === effectiveStageId && detection.substage) ? SUBSTAGE_LABEL[detection.substage] : null;
  const scopeNote = scope.mode === 'task' ? `任务隔离 \`${scope.taskId}\` · ` : '';
  // 门禁分支守卫（v0.13.10 有效阶段语义）：检测值与保存值不一致时（提交后
  //   检测跌回早期阶段），按保存的更靠后阶段呈现——门禁类 substage 只在
  //   检测值即有效阶段时才真实（与 session-start 阶段守卫 / Stop 同语义）
  const detIsEffective = detection.stage === effectiveStageId;
  let next;
  if (detIsEffective && detection.substage === 'awaiting_answers') {
    next = '呈现 Open questions 等发起者回答（全部回答后自动进 Stage 2）';
  } else if (detIsEffective && detection.substage === 'awaiting_acceptance') {
    next = '工程师接受 → MCP `accept_plan`（工具不可用时 `bash sdlc.sh accept`）→ Stage 3b 才能改业务代码';
  } else if (stateForStage.fix_loop) {
    next = '呈报循环证据等用户决策 → `loop_resolve`';
  } else if (stateForStage.in_fix_mode) {
    next = '修复模式中：只修代码不改测试（退出：set_fix_mode(false)）';
  } else {
    next = NEXT_HINT[effectiveStageId] || NEXT_HINT[stage.id] || '';
  }
  lines.push('### 生命周期（每回合状态条）');
  lines.push(`- 当前 **${stage.full}**${sub ? `（${sub}）` : ''} · ${scopeNote}已完成闭环 ${stateForStage.cycle_count || 0} 次`);
  lines.push(`- 下一步：${next}`);
  lines.push('');
}

// 1. 反模式警告（直接注入，最高优先级）
const apHits = detectAntiPatterns(prompt);
if (apHits.length > 0) {
  lines.push('### 反模式警告（ai-sdlc 检测到）');
  for (const ap of apHits) {
    lines.push(`- **${ap.lang}** 命中 \`${ap.pattern}\`：${ap.warn}`);
  }
  lines.push('');
}

// 1b. v0.6.0 Open questions 待回答提醒（每回合注入，不进去重——
//     agent 在 awaiting 状态下的每一回合都必须记得先呈现问题等待发起者回答，
//     而不是自问自答或试图跳过）
if (detection.stage === 'planning' && detection.substage === 'awaiting_answers') {
  const oq = detection.open_questions || {};
  lines.push('### ⏸️ intent.md 开放问题未回答（阶段停在 Stage 1）');
  lines.push(`- **${oq.unresolved ?? '?'}** 个 Open questions 待发起者回答——若尚未在对话中提出，请逐条呈现并**结束回合等待回答**；若用户本轮已回答，请把答案融入 intent.md 并移除/标记对应条目（全部解决后自动推进 Stage 2）`);
  lines.push('');
}

// 1c. v0.7.0 修复循环中断提醒（每回合注入，不进去重——中断状态下 agent 的
//     每一回合都必须先向用户呈报循环证据并等待决策，而不是继续自动修）
const loopState = readCodexState(scope, 'state.json') || {};
if (loopState.fix_loop) {
  const loop = loopState.fix_loop;
  lines.push('### 🛑 修复循环中断——等待用户决策（ai-sdlc）');
  lines.push('- 循环类型 **' + loop.kind + '**，已连续失败 **' + (loop.rounds || '?') + '** 轮：' + (loop.hint || ''));
  lines.push('- 请停止自动修改代码（PreToolUse 已阻断代码写入），向用户呈报失败历史与已尝试方案');
  lines.push('- 用户决策（自然语言即可，如「重试一轮」「我自己来修」「升级处理」）：MCP `loop_resolve({decision: "retry|new-intent|manual|escalate", note})`');
  lines.push('');
}


// 1d. v0.12.0 输入分流提醒（每回合轻量注入，不进去重——分类是每条输入的前置动作）
//     语义：需求/ISSUE 走 SDLC；补充信息融入当前周期工件；临时任务不混入周期。
//     详见 rules/triage.md（SessionStart 已注入完整协议）
//     v0.13.0：用户侧入口统一为自然语言（agent 调 MCP quick_task 落地）
{
  const cycleActive = !!(detection.artifacts.intent || detection.artifacts.spec || detection.artifacts.plan);
  const queued = queuedQuickTasks(projectRoot);
  lines.push('### 输入分流（ai-sdlc）');
  if (cycleActive) {
    lines.push('- 需求/ISSUE→走 SDLC 流程；补充信息→融入当前阶段工件（含 Open questions 回答，勿另开流程）');
    lines.push('- 临时任务→MCP `quick_task({action:"add",desc})` 登记，**周期走完后统一处理，勿混入周期工件**');
  } else {
    lines.push('- 新需求/ISSUE→走 SDLC（产出 intent.md）；临时任务→**直接处理，不落 SDLC 工件**');
    lines.push('- 补充信息：当前无进行中周期，无融入目标——按新内容重新分类');
  }
  if (queued.length > 0) {
    lines.push(`- 队列：${queued.length} 条临时任务待处理（${cycleActive ? '周期结束后处理' : '现在可处理，quick_task({action:"list"}) 查看'}）`);
  }
  lines.push('');
}

// 1e. v0.13.11 plan 等待接受提醒（每回合注入，不进去重——与 1b awaiting_answers /
//     1c fix_loop 同为交互门禁的回合级锚点）。背景：上下文压缩后 agent 丢失
//     「plan 已产出、等待工程师接受」的记忆（用户实测：说「接受」后直接尝试
//     改业务代码被门禁拦截，且找不到记录接受的通道）。
if (detection.stage === 'build_plan' && detection.substage === 'awaiting_acceptance') {
  const saysAccept = detectAcceptIntent(prompt);
  lines.push('### ⏸️ plan.md 已产出——等待工程师接受（阶段停在 Stage 3a）');
  if (saysAccept) {
    lines.push('- **检测到用户已表达接受**：立即调用 MCP `accept_plan` 工具记录（随后自动进入 Stage 3b，才能修改业务代码）');
    lines.push(`- 本会话未暴露 mcp__sdlc-orchestrator__* 工具时，受控 CLI 回退：\`node ${PLUGIN_ROOT}/hooks/scripts/accept-plan.mjs\`（或 \`bash ${PLUGIN_ROOT}/scripts/sh/sdlc.sh accept\`）——语义与 MCP 工具一致；勿手改 \`.sdlc/state.json\`（规则 0 拦截）`);
  } else {
    lines.push('- 本阶段禁改业务代码（PreToolUse 已拦截）；修改需等工程师接受后进入 Stage 3b');
    lines.push('- 用户表达接受（如「接受」「同意」「批准」「OK 开始」）→ 调 MCP `accept_plan`；MCP 工具不可用时：`bash ' + PLUGIN_ROOT + '/scripts/sh/sdlc.sh accept`（受控 CLI 回退，plan 模式白名单已豁免该子命令）');
    lines.push('- 用户要求修改计划 → 更新 plan.md 后再次等待接受；用户否定 → 按意见修订后重新呈报');
  }
  lines.push('');
}

// 1f. v0.13.12 沙盒拒绝提醒（每回合注入不进去重，呈现一次即清除）——三层
//     联动的第三层：PostToolUse 检测到上一 Bash 命令失败输出命中 Codex 沙盒/
//     网络拒绝特征时记入 hooks-state.sandbox_denied，本回合注入授权应对协议
//     （第一层预防性预警见 PreToolUse 规则 0f）。背景（用户实测）：curl 等
//     网络命令、dev server 等端口命令被 Codex 沙盒拒绝后 agent 不知道应向
//     用户请求授权提权，而是反复重试或绕路。
let sandboxDeniedShown = false;
if (hooksState.sandbox_denied) {
  sandboxDeniedShown = true;
  lines.push(sandboxDeniedReminderText(hooksState.sandbox_denied, PLUGIN_ROOT));
  lines.push('');
}

// 2. 阶段规则首次注入（去重）
const ruleFile = stage.rule;
if (!injectedFiles.has(ruleFile)) {
  const rulePath = resolve(PLUGIN_ROOT, ruleFile);
  if (existsSync(rulePath)) {
    const digest = headLines(rulePath, 40, 1600);
    if (digest) {
      lines.push(`### 阶段规则注入（首次进入 ${stage.id}）`);
      lines.push(digest);
      lines.push('');
      injectedFiles.add(ruleFile);
      newInjectedFiles.push(ruleFile);
    }
  }
}

// 3. 缺失工件提醒（关键：让 agent 知道下一步生成什么）
if (detection.missing && detection.missing.length > 0) {
  lines.push('### 当前阶段缺失工件');
  for (const m of detection.missing) {
    lines.push(`- ⚠️ \`${m}\` — 可读 \`${stage.prompt}\` 手册（含模板与执行步骤），或直接基于 \`${stage.required_artifacts.join(', ') || '上下文'}\` 生成`);
  }
  lines.push('');
}

// 4. 阶段语义提示（仅首次进入该阶段时）
if (!injectedFiles.has(`__stage_enter_${stage.id}`)) {
  lines.push('### 阶段语义提示');
  lines.push(`- 当前阶段：**${stage.full}**`);
  lines.push(`- 阶段目标：${stage.description}`);
  lines.push(`- 阶段产物：\`${stage.produces.join('`, `')}\``);
  lines.push(`- 下一阶段：\`${STAGE_BY_ID[stage.next]?.full || stage.next}\`（自动推进，产出后无需用户操作）`);
  lines.push('');
  injectedFiles.add(`__stage_enter_${stage.id}`);
  newInjectedFiles.push(`__stage_enter_${stage.id}`);
}

// 5. 工件读取提示（如果阶段产物依赖前一阶段工件但未读取）
if (stage.required_artifacts.length > 0) {
  const notRead = stage.required_artifacts.filter(a => !injectedFiles.has(`__read_${a}`));
  if (notRead.length > 0) {
    lines.push('### 工件读取建议');
    for (const a of notRead) {
      const found = detection.artifacts[a.replace('.md', '')] || detection.artifacts[a];
      if (found) {
        lines.push(`- 当前阶段需读取 \`${found.rel}\`（已检测到）`);
        injectedFiles.add(`__read_${a}`);
        newInjectedFiles.push(`__read_${a}`);
      } else {
        lines.push(`- ⚠️ 当前阶段需 \`${a}\` 但未检测到——可能需要回退到上一阶段`);
      }
    }
    lines.push('');
  }
}

// 6. token 预算检查
let additionalContext = lines.join('\n');
const thisTokenCost = estimateTokens(additionalContext);
const newCumulative = cumulativeTokens + thisTokenCost;

if (newCumulative > CUMULATIVE_LIMIT) {
  // 累计超额：只保留生命周期状态条 + 门禁类提醒（反模式/缺失工件/
  // Open questions/修复循环/plan 等待接受/输入分流/沙盒授权）——门禁与
  // 位置记忆是压缩后 agent 恢复上下文的最小充分集（v0.13.11 补 0b/1e；
  // v0.13.12 补 1f 沙盒授权——用户授权请求也是门禁类交互）
  const essentials = lines.filter(l =>
    l.startsWith('### 生命周期') || l.startsWith('### 反模式') || l.startsWith('### 当前阶段缺失') || l.startsWith('### ⏸️ intent.md') || l.startsWith('### ⏸️ plan.md') || l.startsWith('### 🛑 修复循环') || l.startsWith('### 输入分流') || l.startsWith('### ⚠️ 上一命令')
  ).join('\n');
  additionalContext = `### token 预算超额提示\n累计注入已达 ${newCumulative} tokens（上限 ${CUMULATIVE_LIMIT}）。\n本次仅保留关键提示：\n${essentials}`;
} else if (additionalContext.length > SINGLE_INJECT_LIMIT) {
  additionalContext = additionalContext.slice(0, SINGLE_INJECT_LIMIT) + '\n…（截断，单次注入上限）';
}

// 7. 更新 hooks-state（scope 内 + 会话 id）
// v0.13.5 X-lock：锁内读-改-写（并发 hook（async PostToolUse/Stop 收尾）与
//   本回合写不再互盖——hooks_executed 计数与 last_prompt_at 不丢）
mutateCodexState(scope, 'hooks-state.json', (cur) => {
  // 锁内新鲜值 + 会话接管语义（与 readHooksStateForSession 一致：磁盘记录属于
  // 其他会话 → 本会话从零开始，防止旧 session_id 残留导致每回合误判接管重置计数）
  let hs = cur || {};
  if (input.session_id && hs.session_id && hs.session_id !== input.session_id) {
    hs = {
      session_id: input.session_id,
      session_started_at: new Date().toISOString(),
      taken_over_from: hs.session_id,
      injected_files: [],
      cumulative_tokens: 0,
      last_inject_tokens: 0,
      hooks_executed: 0,
      // v0.13.12：沙盒去重/拒绝标记同属会话级状态——新会话重新预警一次、
      // 不残留旧会话的拒绝提醒（与 readHooksStateForSession 重置语义对齐）
      sandbox_protocol_shown: false,
      sandbox_denied: null,
      // v0.13.13：审批等待通知在场窗口同属会话级（与 readHooksStateForSession
      //   重置语义对齐——旧会话的 netport_last_exec_at 不抑制新会话通知）
      netport_last_exec_at: null,
    };
  }
  if (!hs.session_id && input.session_id) hs.session_id = input.session_id;
  // v0.13.12 1f：沙盒拒绝提醒呈现一次即清除（提醒层完成使命；新的拒绝
  //   会由 PostToolUse 重新记录——每条拒绝恰好提醒一回合，不累积噪音）
  if (sandboxDeniedShown && hs.sandbox_denied) hs.sandbox_denied = null;
  hs.current_stage = effectiveStageId;
  hs.current_substage = detection.stage === effectiveStageId ? detection.substage : null;
  hs.last_trigger = 'user_prompt_submit';
  hs.scope_mode = scope.mode;
  hs.scope_task_id = scope.taskId;
  hs.hooks_executed = (hs.hooks_executed || 0) + 1;
  // v0.11.0：回合起点时间戳（epoch ms）——Stop hook 的回合结束通知据此计算
  //   回合时长（防噪阈值 SDLC_NOTIFY_MIN_SECONDS 的判定依据）
  hs.last_prompt_at = Date.now();
  hs.injected_files = Array.from(injectedFiles);
  hs.cumulative_tokens = newCumulative;
  hs.last_inject_tokens = thisTokenCost;
  return hs;
});

appendAudit(scope, {
  hook: 'user_prompt_submit', trigger: 'UserPromptSubmit',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    stage: effectiveStageId,
    detected_stage: detection.stage !== effectiveStageId ? detection.stage : undefined,
    scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
    new_injections: newInjectedFiles.length,
    this_tokens: thisTokenCost,
    cumulative_tokens: newCumulative,
    session_takeover: hooksState.taken_over_from || null,
  },
});

const hasContent = additionalContext.length > 0;
if (hasContent) {
  emitHookOutput({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
  });
} else {
  emitEmpty();
}
