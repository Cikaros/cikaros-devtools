/**
 * events.mjs — specflow 扩展触发点事件总线（JS 侧，v0.6.0 / A7，HOOKS §2.3）
 *
 * 与 scripts/lib/events.py 写同一文件 <cwd>/<运行时目录>/events.jsonl、同一格式
 * （v0.7.0：新布局 .specflow/events.jsonl；旧项目回退 .codex/，与 sfpaths.py 同语义）。
 * 每行一个 JSON 事件 {"ts","type","payload"}，滚动上限/保留条数一致。
 * 消费方：session-start.mjs / session-end.mjs / stop.mjs 等 hooks。
 *
 * 写失败静默降级（总线故障不阻塞 hook 主流程）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { runtimePath } from './lib/common.mjs';

const EVENTS_NAME = 'events.jsonl';
const EVENTS_MAX_LINES = 500;   // 与 events.py 一致
const EVENTS_KEEP_LINES = 400;

/** 追加一条事件。返回是否写入成功。 */
export function appendEvent(projectRoot, type, payload = {}) {
  try {
    const file = runtimePath(projectRoot, EVENTS_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const event = { ts: new Date().toISOString(), type, payload };
    fs.appendFileSync(file, JSON.stringify(event) + '\n');
    rollIfNeeded(file);
    return true;
  } catch {
    return false;
  }
}

function rollIfNeeded(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    // 末尾空行不算
    const n = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    if (n <= EVENTS_MAX_LINES) return;
    const kept = lines.slice(0, lines.length - 1).slice(-EVENTS_KEEP_LINES);
    fs.writeFileSync(file, kept.join('\n') + '\n');
  } catch {
    /* 忽略 */
  }
}

/** 读取最近 limit 条事件（旧的在前）。 */
export function readEvents(projectRoot, limit = 20) {
  try {
    const file = runtimePath(projectRoot, EVENTS_NAME);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(x => x.trim());
    const events = [];
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev.type === 'string') events.push(ev);
      } catch { /* 跳过损坏行 */ }
    }
    return limit > 0 ? events.slice(-limit) : events;
  } catch {
    return [];
  }
}
