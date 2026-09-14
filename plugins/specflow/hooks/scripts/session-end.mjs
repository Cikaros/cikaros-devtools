#!/usr/bin/env node
/**
 * session-end.mjs — SessionEnd hook
 *
 * 输入（stdin JSON）：{ session_id, transcript_path, cwd, hook_event_name: "SessionEnd", reason }
 *
 * 执行（必须 ≤3s，超时预算极小 → 只做一次轻量落盘，不调 Python）：
 *   1. 归档 <运行时目录>/session-end.json（会话 id / 结束时间 / 标记遗留数；
 *      v0.7.0 路径经 sfPaths）
 *
 * 输出（stdout JSON）：{}（SessionEnd 输出为 advisory，不引导会话）
 */

import { parseInput, projectRootOf, writeCodexState, readCodexState, emitHookOutput } from './lib/common.mjs';
import { appendEvent } from './events.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);

const todoState = readCodexState(projectRoot, 'todo-state.json');
// todo-state.json 由 todo-scanner 产出：字段为 summary.total（v0.4.0 修复：原 total_markers 为 v0.2.x 废弃字段）
const remainingMarkers = todoState?.summary?.total
  ?? (Array.isArray(todoState?.markers) ? todoState.markers.length : null);
const endRecord = {
  session_id: input.session_id || null,
  ended_at: new Date().toISOString(),
  reason: input.reason || 'other',
  remaining_markers: remainingMarkers,
};
writeCodexState(projectRoot, 'session-end.json', endRecord);

// v0.6.0（A7）：session_end 事件（事件总线 events.jsonl，v0.7.0 路径经 sfPaths）
appendEvent(projectRoot, 'session_end', {
  session_id: input.session_id || null,
  reason: input.reason || 'other',
  remaining_markers: remainingMarkers,
});

emitHookOutput({});
