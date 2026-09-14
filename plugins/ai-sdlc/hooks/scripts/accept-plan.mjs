#!/usr/bin/env node
/**
 * accept-plan.mjs — 受控 CLI 入口：记录工程师对 plan.md 的显式接受（v0.13.11）
 *
 * 背景（用户实测缺陷链）：MCP server 未随会话启动 / 会话未暴露
 *   mcp__sdlc-orchestrator__* 工具时，agent 无合法通道记录「用户已接受 plan」——
 *   手改 .sdlc/state.json 被规则 0 拦截，Bash 通道被 plan 模式只读白名单拦截
 *   → 死锁在 Stage 3a。本入口与 MCP 工具 accept_plan 完全同语义：
 *   state.plan_accepted = true + build_plan → build_impl（锁内幂等重验防并发
 *   双推进；与 hooks/MCP 共用同一把 O_EXCL 跨进程锁）。
 *
 * 调用通道（PreToolUse 规则 1b 对以下精确路径形态豁免——见
 *   pre-tool-use.mjs isControlledAcceptSeg；仅 accept 语义豁免，advance/reset
 *   等其他子命令仍拦）：
 *     node <PLUGIN_ROOT>/hooks/scripts/accept-plan.mjs [project-root]
 *     bash <PLUGIN_ROOT>/scripts/sh/sdlc.sh accept        （POSIX 便捷包装）
 *
 * 语义约定（与 MCP 侧一致，agent 只在用户明确表达接受后调用）：
 *   - plan.md 不存在 → 报错退出 1（无计划可接受）
 *   - 已接受（幂等重入）→ 只刷新时间戳，不重复推进
 *   - current_stage 已在 build_impl 之后（如新周期回到早期阶段后又接受旧计划
 *     的罕见场景）→ 只置标志不推进（同 MCP toolAcceptPlan 条件）
 *
 * 输出（stdout，JSON）：{ ok, plan_accepted, advanced_to_build_impl,
 *   current_stage, via: "cli" } —— agent 可直接读取判断结果。
 * 事件留痕 events.jsonl（plan_accepted，via: cli:accept-plan）+ 审计 hook-audit.json。
 *
 * 输入（argv）：[project-root]（默认 process.cwd()；任务隔离模式传
 *   .sdlc/tasks/<id> 所在项目根 + 设 SDLC_TASK=<id>，或直接传任务目录）。
 */
import { resolve } from 'node:path';
import {
  resolveScope, mutateCodexState, appendAudit, appendEvent,
  readCodexState, PLUGIN_ROOT,
} from './lib/common.mjs';
import { findArtifact } from './lib/stage-detector.mjs';

const t0 = Date.now();
const argvRoot = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
// CLI 无 session_id：env SDLC_TASK 显式指定 > legacy（项目根）——
// 不做 session-map/resume 自动吸附（多会话防污染，与 resolveScope 语义一致）
const scope = resolveScope(argvRoot, { source: 'cli' });

if (!findArtifact(scope, 'plan.md')) {
  process.stderr.write(
    '[ai-sdlc] accept-plan：未找到 plan.md（候选位置：plan.md / docs/plan.md / ' +
    '.sdlc/artifacts/plan.md）——先产出计划再接受。' +
    `scope: ${scope.mode}${scope.taskId ? ':' + scope.taskId : ''}\n`);
  process.exit(1);
}

let advanced = false;
let currentStage = null;
let alreadyAccepted = false;
mutateCodexState(scope, 'state.json', (cur) => {
  const state = cur || {};
  alreadyAccepted = state.plan_accepted === true;
  state.plan_accepted = true;
  state.plan_accepted_at = new Date().toISOString();
  // 推进语义与 MCP toolAcceptPlan / PostToolUse plan_accepted_post 路径一致：
  // 仅 current_stage === 'build_plan' 时推进（锁内读到的值是新鲜的——并发
  // MCP 推进后此处不重复推进；其余阶段只置标志）
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
if (currentStage == null) currentStage = (readCodexState(scope, 'state.json') || {}).current_stage || 'planning';

appendEvent(scope, 'plan_accepted', {
  via: 'cli:accept-plan',
  advanced_to_build_impl: advanced,
  already_accepted: alreadyAccepted || undefined,
  scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
});
appendAudit(scope, {
  hook: 'accept-plan-cli', trigger: 'cli',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    advanced_to_build_impl: advanced,
    already_accepted: alreadyAccepted || undefined,
    scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
    plugin_root: PLUGIN_ROOT,
  },
});

process.stdout.write(JSON.stringify({
  ok: true,
  plan_accepted: true,
  advanced_to_build_impl: advanced,
  current_stage: currentStage,
  via: 'cli',
  note: advanced
    ? '计划已接受并推进到 Stage 3b（build_impl）——现在可以修改业务代码。'
    : (alreadyAccepted
      ? '计划此前已接受（幂等重入，未重复推进）。'
      : `标志已记录；当前阶段 ${currentStage} 非 build_plan，未推进。`),
}, null, 2) + '\n');
