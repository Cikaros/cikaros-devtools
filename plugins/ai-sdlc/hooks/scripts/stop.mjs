#!/usr/bin/env node
/**
 * stop.mjs — Stop hook（触发点 5/6，异步）
 *
 * 在 agent 报告"完成"前检查：
 *   - 当前阶段的产出工件是否已生成（缺失则提示 agent 继续）
 *   - 当前阶段是否需要人工关卡（如 spec.md 需要产品负责人批准）
 *   - 若阶段已完成但未推进（PostToolUse 未捕获），手动推进
 *
 * v0.11.0 新增（回合结束通知）：
 *   - 通知使用者回到终端——任务完成或等待用户输入/决策时发系统弹窗+声音
 *     （macOS v0.13.8：applet 自托管宿主 + afplay 独立声音；Windows
 *     PowerShell toast / Linux notify-send；SDLC_NOTIFY_* 配置，详见
 *     lib/notify.mjs 头注与 docs/lifecycle.md §3.2）
 *   - needs-input（fix_loop / Open questions 硬门禁）总是通知；普通完成受
 *     SDLC_NOTIFY_MIN_SECONDS（默认 10s）防噪阈值约束，长任务必达、快答不扰
 *
 * v0.12.0 新增（输入分流，详见 rules/triage.md）：
 *   - 临时任务队列提醒：周期进行中→排队中（提醒 agent 向用户转达）；
 *     周期已结束/无周期→待处理（提醒本回合可直接处理，不经 SDLC 流程）
 *
 * 输出（stdout JSON）：
 *   { hookSpecificOutput: { hookEventName: "Stop", additionalContext: "..." } }
 */

import {
  parseInput, projectRootOf, emitHookOutput, appendAudit, readCodexState,
  resolveScope, maxFixRounds, isEngaged, queuedQuickTasks, listQuickTasks,
} from './lib/common.mjs';
import { detectStage, advanceStage, STAGES, STAGE_BY_ID, findArtifact } from './lib/stage-detector.mjs';
import { notifyTurnEnd } from './lib/notify.mjs';

// v0.13.5 I-inject：队列字段注入消毒。quick-tasks.json 属磁盘可控内容（克隆
//   仓库可投毒）——desc/id 原样拼进 Stop 注入上下文时，换行可伪造「- 」开头
//   的 hook 指令行（上下文注入），反引号可逃逸行内代码包裹。注入前统一：
//   控制字符/换行折叠为空格 + 长度截断 + id 白名单化展示。
function sanitizeInjectedField(s, maxLen) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f\r\n\t]+/g, ' ')   // 控制字符/换行折叠——无法伪造新指令行
    .replace(/[-•*]\s*\[/g, '·[')                     // 中和行内残留的「- [xxx]」指令模式（纵深防御）
    .trim().slice(0, maxLen);
}
function sanitizeInjectedId(s) {
  return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'unknown';
}

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();

// v0.5.0 作用域路由（会话亲和）
const scope = resolveScope(projectRoot, input);

const state = readCodexState(scope, 'state.json') || {};
const detection = detectStage(scope);
// v0.13.10 有效阶段：检测值与保存值中更靠后者（与 session-start 阶段守卫同
//   语义）。git diff 是瞬态的——测试通过并提交后检测跌回 build_impl，但保存
//   值已在 test/deploy；Stop 的产出检查 / 人工关卡 / 下一阶段预览 / 通知文案
//   必须按真实所处阶段呈现（否则 deploy 阶段错报 build_impl 的人工关卡、
//   build_plan 等待接受错报 test 的测试门禁）。
//   override（用户显式钉住）永远优先。
const STAGE_ORDER = STAGES.map(s => s.id);
const effectiveStageId = (() => {
  const SAVED = STAGE_ORDER.indexOf(state.current_stage);
  const DET = STAGE_ORDER.indexOf(detection.stage);
  return detection.source === 'state.override'
    || SAVED < 0 || DET < 0 || DET >= SAVED
    ? detection.stage
    : state.current_stage;
})();
const stage = STAGE_BY_ID[effectiveStageId] || STAGE_BY_ID[detection.stage];
// 阶段并集（门禁防漏：保存值与检测值任一侧命中即判在段内）
const stageSet = new Set([state.current_stage, detection.stage].filter(Boolean));

const lines = [];
// 0b. v0.7.0 修复循环中断提醒（最高优先级——与 Open questions 门禁同为守门员）
//     fix_loop 置位 = 循环检测命中（同签名重复/轮次超限）。此时 PreToolUse 已
//     阻止继续改业务代码；本提醒在 agent 回合结束时强制其向用户呈报循环证据
//     并等待决策，而不是自作主张继续修（或空转报告"完成"）。
const stopEngaged = isEngaged(state);   // v0.10.0：统一至 common.isEngaged（本处此前漏 change_ticket）
if (state.fix_loop && stopEngaged) {
  const loop = state.fix_loop;
  lines.push('### 🛑 修复循环中断——需要用户决策（ai-sdlc Fix Loop Guard）');
  lines.push('循环类型 **' + loop.kind + '**（已连续失败 **' + loop.rounds + '** 轮）：' + (loop.hint || ''));
  if (loop.summary) lines.push('- 失败摘要：' + String(loop.summary).slice(0, 160));
  lines.push('');
  lines.push('请向用户**呈报循环证据**（失败历史、已尝试的修复方向）并**结束回合等待决策**。用户决策通道：');
  lines.push('- MCP `loop_resolve({decision:"retry"})` —— 用户判断可修复，允许再修一轮（同失败再现会立即再中断）');
  lines.push('- MCP `loop_resolve({decision:"new-intent"})` —— 把失败作为 incident 开启下一个 intent 周期（推荐用于需求/设计缺口类问题）');
  lines.push('- MCP `loop_resolve({decision:"manual"})` —— 用户接管手工修复，agent 转只读协助');
  lines.push('- MCP `loop_resolve({decision:"escalate"})` —— 升级人工/更高层处理');
  lines.push('');
  lines.push('测试通过会自动解除中断；但**不得**为了解除而跳过/删除/弱化失败测试。');
  lines.push('');
}

// 0c. v0.7.0 测试门禁提醒（plan 接受并实施后必须真实运行测试）
//     ① 实施后从未跑过测试 → 报告完成前必须先跑；② 失败未收敛 → 修复指引
//     （就地修复优先，轮次/循环升级时引导中断或新 intent 周期）
//     v0.13.10：阶段并集判定（提交后 detection 跌回 build_impl 而保存值在
//     test 的窗口同拦——门禁防漏）
if (stopEngaged && (stageSet.has('build_impl') || stageSet.has('test')) && !state.test_pass) {
  const runs = state.test_runs || 0;
  if (runs === 0) {
    lines.push('### ⏳ 实施未验证——报告完成前必须运行测试（ai-sdlc 测试门禁）');
    lines.push('当前阶段 **' + stage.full + '**：plan 已接受并存在代码改动，但本周期尚未运行任何测试。');
    lines.push('playbook 硬约束：会话在报告"完成"之前必须自检（build / test / lint 三件套），');
    lines.push('并**粘贴原始输出**作为机械证据——声称无证据，未运行不算通过。');
    lines.push('- 先确认项目测试命令（Makefile / package.json scripts / pytest 配置），然后真实执行');
    lines.push('- git push / gh pr create 在测试通过前会被 PreToolUse hook 阻断');
    lines.push('');
  } else {
    const rounds = state.fix_rounds || 0;
    lines.push('### 🔁 测试未通过——修复指引（ai-sdlc）');
    lines.push('本周期已运行测试 **' + runs + '** 次，最近一次退出码 **' + (state.last_test_exit_code ?? '未知') + '**，连续失败 **' + rounds + '** 轮。');
    lines.push('- 就地修复（首选）：**修代码不修测试**（除非测试本身有 bug——先退出修复模式说明原因再改）');
    lines.push('- 大缺口：若失败暴露的是需求/设计缺口，用 MCP `new_cycle` 把失败作为 incident 写入下一个 intent 迭代');
    lines.push('- 循环保护：连续失败达 ' + maxFixRounds() + ' 轮或同一失败重现时，插件会自动中断并要求用户决策');
    lines.push('');
  }
}



// 0. v0.6.0 Open questions 待回答门禁提醒（最高优先级——交互闭环的守门员）
//    intent.md 存在未回答的开放问题时，阶段停在 planning/awaiting_answers。
//    本提醒在 agent 回合结束时注入：强制 agent 把问题呈现给发起者并等待，
//    而不是自问自答或直接进入下一阶段。
if (detection.stage === 'planning' && detection.substage === 'awaiting_answers') {
  const oq = detection.open_questions || { unresolved: '?', items: [] };
  lines.push('### ⏸️ Open questions 待发起者回答（ai-sdlc 交互门禁）');
  lines.push(`intent.md 中还有 **${oq.unresolved}** 个开放问题未回答——阶段将停留在 **Stage 1 Planning**，直到这些问题获得发起者回答。`);
  lines.push('');
  lines.push('请把下列问题**逐条呈现给发起者并结束本回合等待回答**（不要自问自答、不要假设答案）：');
  for (const q of (oq.items || []).filter(i => !i.resolved).slice(0, 10)) {
    lines.push(`- ${q.text}`);
  }
  lines.push('');
  lines.push('回答处理约定：把发起者的答案融入 intent.md 对应章节（Problem / Proposed outcome / Constraints 等），并在 Open questions 中**移除该条**（或标记 `- [x]` 保留审计痕迹）。全部解决后 PostToolUse 自动推进 Stage 2。');
  lines.push('若发起者明确表示跳过某问题或暂不回答，经用户明确同意后调 MCP `advance` 推进（逃生通道）。');
  lines.push('');
}

// 0d. v0.12.0 临时任务队列提醒（输入分流的后半程——防“登记后遗忘”）
//     周期进行中 → 排队中：提醒 agent 在回复里向用户转达队列状态，不得混入当前周期；
//     无进行中周期（周期已走完/归档）→ 待处理：提醒本回合可直接逐条处理。
//     v0.13.10：排队分支同样列出条目（≤5 条，消毒后）——文案要求「回复用户时
//     请转达排队状态」，不列出条目 agent 无从转达具体内容。
const queuedQuick = queuedQuickTasks(projectRoot);
const cycleIdle = !(detection.artifacts.intent || detection.artifacts.spec || detection.artifacts.plan);
if (queuedQuick.length > 0) {
  if (cycleIdle) {
    lines.push('### 🧺 临时任务待处理（' + queuedQuick.length + ' 条，不经 SDLC 流程）');
    for (const t of queuedQuick.slice(0, 5)) {
      // v0.13.5 I-inject：desc/id 消毒后注入（防伪造指令行/逃逸包裹）
      lines.push('- ' + (t.status === 'in_progress' ? '▶️' : '•') + ' `' + sanitizeInjectedId(t.id) + '` ' + sanitizeInjectedField(t.desc, 160));
    }
    lines.push('- 当前无进行中周期——可直接逐条处理（处理完用 `quick_task({action:"done", id})` 标记；不再需要的用 `drop`）');
    lines.push('');
  } else {
    lines.push('### 🧺 临时任务排队中（' + queuedQuick.length + ' 条）');
    for (const t of queuedQuick.slice(0, 5)) {
      // v0.13.5 I-inject：desc/id 消毒后注入（防伪造指令行/逃逸包裹）
      lines.push('- ' + (t.status === 'in_progress' ? '▶️' : '•') + ' `' + sanitizeInjectedId(t.id) + '` ' + sanitizeInjectedField(t.desc, 160));
    }
    lines.push('- 队列将在**当前周期走完后**统一处理——回复用户时请转达排队状态，处理内容勿混入当前周期工件或 diff');
    lines.push('- 用户显式要求立即处理某条：`quick_task({action:"run", id})`（仍不落 SDLC 工件）');
    lines.push('');
  }
}

// 1. 阶段产出检查
const produces = stage.produces;
const missingArtifacts = [];
for (const p of produces) {
  if (p === 'diff' || p === 'tests') {
    // 这些是非文件产出，PostToolUse 已处理
    continue;
  }
  if (p === 'test-pass') {
    if (!state.test_pass) missingArtifacts.push('测试通过（运行 make test / npm test 等并通过）');
    continue;
  }
  if (p === 'eval-pass') {
    // 评估套件是 CI 任务，会话内只提示
    continue;
  }
  if (p === 'pr-merged') {
    if (!state.last_deployed_at) missingArtifacts.push('PR 已合并到 main');
    continue;
  }
  if (!findArtifact(scope, p)) missingArtifacts.push(p);
}

if (missingArtifacts.length > 0) {
  lines.push('### 阶段产出检查（ai-sdlc）');
  lines.push(`当前阶段 **${stage.full}** 在报告完成前还需产出：`);
  for (const m of missingArtifacts) lines.push(`- ⚠️ ${m}`);
  lines.push('');
  lines.push('若你认为已产出但未被检测到，可能原因：');
  lines.push('1. 工件未写入约定工作区（v0.10.0 默认 `.sdlc/artifacts/`；任务模式 `.sdlc/tasks/<id>/`——根目录与 docs/ 的历史落位仍可检测，但新工件应入工作区）');
  lines.push('2. 工件刚被创建但 PostToolUse hook 未触发（手工创建时）');
  lines.push('3. 工件名拼写不一致（必须为 intent.md / spec.md / plan.md / REVIEW.md）');
  lines.push('');
  lines.push('可调用 MCP 工具 `mcp__sdlc-orchestrator__status` 查看完整状态，');
  lines.push('或 `mcp__sdlc-orchestrator__refresh` 强制重检测。');
}

// 2. 人工关卡提示（playbook 治理要求）——按有效阶段（v0.13.10：提交后
//    detection 跌回早期阶段时，保存阶段的人工关卡才是真实所处阶段的关卡）
const humanGate = {
  planning: '产品负责人需审查并接受 intent.md（git merge 或 PR review）',
  design: '产品负责人需审查 spec.md 并与策略负责人解决标记的关切点',
  build_plan: '工程师需审查 plan.md 并显式接受（mcp__sdlc-orchestrator__accept_plan；MCP 工具不可用时受控 CLI 回退：bash sdlc.sh accept——v0.13.11）',
  build_impl: '工程师需确认实施完成（plan.md 与最终 diff 匹配）',
  test: 'CI 评估套件需通过（首次 CI 成功率指标）',
  deploy: '代码所有者需批准 PR；生产部署需发布管理员授权（mcp__sdlc-orchestrator__approve_release）',
  maintain: '服务所有者需对触发队列进行分诊',
};
if (humanGate[effectiveStageId]) {
  lines.push('');
  lines.push('### 人工关卡（playbook 治理要求）');
  lines.push(`- ${humanGate[effectiveStageId]}`);
}

// 3. 下一阶段预览
const nextStage = STAGE_BY_ID[stage.next];
if (nextStage) {
  lines.push('');
  lines.push('### 下一阶段预览');
  lines.push(`- 推进到 **${nextStage.full}** 后：${nextStage.description}`);
  lines.push(`- 下一阶段产物：\`${nextStage.produces.join('`, `')}\``);
  lines.push(`- 推进由 PostToolUse hook 在工件创建后自动触发，无需用户操作`);
}

// v0.11.0 回合结束通知：任务完成/需用户输入时系统弹窗+声音叫人回来。
//   needs-input 判定与上方门禁同源（fix_loop && stopEngaged；awaiting_answers）
//   ——不重复实现第二套判定，两处永保一致。通知结果进审计（detail.notify：
//   为什么没通知可排障——disabled / below-min-duration / dispatch-failed）。
const notifyInfo = notifyTurnEnd({
  lastPromptAt: (readCodexState(scope, 'hooks-state.json') || {}).last_prompt_at || null,
  fixLoop: !!(state.fix_loop && stopEngaged),
  fixLoopRounds: state.fix_loop ? (state.fix_loop.rounds ?? null) : null,
  awaitingAnswers: !!(detection.stage === 'planning' && detection.substage === 'awaiting_answers'),
  openQuestions: (detection.open_questions || {}).unresolved ?? null,
  stageFull: stage.full,
  humanGate: !!humanGate[effectiveStageId],
  scopeTag: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
});

appendAudit(scope, {
  hook: 'stop', trigger: 'Stop',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    stage: effectiveStageId,
    detected_stage: detection.stage !== effectiveStageId ? detection.stage : undefined,
    scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
    missing_artifacts: missingArtifacts.length,
    notify: notifyInfo,
  },
});

const hasContent = lines.length > 0;
emitHookOutput(hasContent ? {
  hookSpecificOutput: { hookEventName: 'Stop', additionalContext: lines.join('\n') },
} : {});
