#!/usr/bin/env node
/**
 * stop.mjs — Stop hook（回合结束，异步运行）
 *
 * v0.9.2：新增 pending 错误检查——会话期间 PostToolUse 检测到未匹配知识库的错误时
 *         会记录到 .specflow/error-kb-pending/，Stop hook 在回合结束时检查 pending
 *         并通过 additionalContext 提示 agent「这些错误是否值得记录到知识库」
 *
 * 输入（stdin JSON）：{ session_id, cwd, turn_id, stop_hook_active, last_assistant_message,
 *                      hook_event_name: "Stop" }
 *
 * 执行（后台）：
 *   1. 若项目已初始化，刷新 <运行时目录>/todo-state.json
 *   2. 更新 <运行时目录>/hooks-state.json 的 hooks_executed / last_trigger
 *   3. v0.9.2：检查 pending 错误，若有则注入提示让 agent 询问用户
 *
 * 输出（stdout JSON）：{ hookSpecificOutput?: { additionalContext } }
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseInput, projectRootOf, runPythonLib, safeJsonParse,
  writeCodexState, readCodexState, emitHookOutput, appendAudit, configPath,
  readPendingErrors,
} from './lib/common.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();

const initialized = existsSync(configPath(projectRoot, 'config.md'));
let refreshed = false;

if (initialized) {
  const scan = runPythonLib('todo-scanner.py', [projectRoot, '--format=json'], projectRoot, 15);
  if (scan.ok) {
    const todos = safeJsonParse(scan.stdout);
    if (todos) {
      writeCodexState(projectRoot, 'todo-state.json', todos);
      refreshed = true;
    }
  }
}

const state = readCodexState(projectRoot, 'hooks-state.json') || {};
state.last_trigger = 'stop';
state.hooks_executed = (state.hooks_executed || 0) + 1;
writeCodexState(projectRoot, 'hooks-state.json', state);

// v0.9.2：检查 pending 错误——若有则注入提示让 agent 询问用户是否记录
const pendingErrors = readPendingErrors(projectRoot);
let additionalContext = '';
if (pendingErrors.length > 0 && !input.stop_hook_active) {
  const lines = [
    `【specflow 错误知识库】本回合检测到 ${pendingErrors.length} 个未匹配知识库的错误：`,
  ];
  for (const pe of pendingErrors.slice(0, 5)) {
    lines.push(`- 工具 ${pe.tool || '?'} 输出含模式 \`${pe.pattern}\`（语言: ${pe.lang || '未知'}）`);
    if (pe.context) {
      const ctxShort = pe.context.replace(/\s+/g, ' ').slice(0, 150);
      lines.push(`  上下文: ${ctxShort}`);
    }
  }
  lines.push('');
  lines.push('请询问用户：');
  lines.push('1. 这些错误是否值得记录到知识库（防止下次再踩坑）？');
  lines.push('2. 若值得，让用户提供「原因 + 修复方案」，然后用 mcp__hook-orchestrator__record_error 工具记录');
  lines.push('3. 若不值得（如一次性环境问题），用 mcp__hook-orchestrator__dismiss_error 清除 pending');
  lines.push('');
  lines.push('pending 文件位于 .specflow/error-kb-pending/，会话结束后保留供用户后续决定。');
  additionalContext = lines.join('\n');
}

appendAudit(projectRoot, {
  hook: 'stop', trigger: 'Stop',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    todo_refreshed: refreshed,
    turn_id: input.turn_id || null,
    pending_errors: pendingErrors.length,
  },
});

emitHookOutput(additionalContext ? {
  hookSpecificOutput: { hookEventName: 'Stop', additionalContext },
} : {});
