/**
 * mcplink.mjs — MCP 会话票据与启动器指针：bind-queue FIFO 原子认领（会话身份配对）、mcp-launcher.json 指针（.mcp.json 内联 bootstrap 的第一优先解析源）
 * 分层：L3 领域层（依赖：paths / util / atomic）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync,
  renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stamp, safeSessionId, fileMtime, safeJsonParse } from './util.mjs';
import { sdlcDir } from './paths.mjs';
import { writeJsonExclusive } from './atomic.mjs';

// ═══════════════════════════════════════════════════════════
// v0.6.0 MCP 会话票据（MCP 会话上下文隔离）
// 权威标准：插件 docs/lifecycle.md「MCP 会话隔离」章节
// ═══════════════════════════════════════════════════════════

const MCP_BIND_QUEUE_DIR = 'mcp-bind-queue';
const MCP_TICKET_STALE_MS = 10 * 60 * 1000;   // 孤儿票超时（会话从未调用 MCP 工具）

/**
 * SessionStart hook 写会话票据：供本会话 spawn 的 MCP server 进程认领
 * 会话身份（stdio MCP 协议不携带 session 标识，靠本队列 1:1 配对）。
 * 每个 Codex 会话独立 spawn 一个 MCP 进程 → 票据 FIFO 认领实现配对。
 * @returns {string|null} 票据文件路径
 */
export function writeMcpBindTicket(projectRoot, { sessionId, source, taskId } = {}) {
  if (!sessionId) return null;
  const dir = join(sdlcDir(projectRoot), MCP_BIND_QUEUE_DIR);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch { return null; }
  const file = join(dir, `${stamp()}-${safeSessionId(sessionId)}.json`);
  const ticket = {
    session_id: String(sessionId).slice(0, 128),
    source: source || 'startup',
    task_id: taskId || null,          // 会话绑定的任务（认领方动态查 session-map，此字段仅诊断用）
    project_root: resolve(projectRoot),
    created_at: new Date().toISOString(),
  };
  try { writeFileSync(file, JSON.stringify(ticket, null, 2), 'utf8'); } catch { return null; }
  return file;
}

/**
 * v0.13.3 MCP 启动器指针（修复关键缺陷：插件 .mcp.json 相对路径不可达）。
 *   背景：Codex 以「用户启动目录」为插件 MCP 子进程的 cwd，且 .mcp.json 内
 *   相对 args 按该 cwd 解析、${VAR} 不插值、不注入 PLUGIN_* 环境变量
 *   （openai/codex#19582 实测、#22842 确认）——`./mcp/sdlc-orchestrator/index.js`
 *   在真实插件安装下 ENOENT，MCP server 起不来。
 *   方案：.mcp.json 改为 `node -e <内联 bootstrap>`（自定位引导），本函数为其
 *   提供第一优先解析源——SessionStart 把「插件根 + 项目根」写入会话项目
 *   `.sdlc/mcp-launcher.json`（原子写、每次启动幂等刷新）。
 *   安全：指针仅被 bootstrap 在「plugin_root 位于 CODEX_HOME/plugins 之内或
 *   等于 SDLC_PLUGIN_ROOT 显式覆盖」时采信（防投毒重定向 MCP 加载路径）；
 *   本文件同时受 PreToolUse 运行时状态写保护（RUNTIME_STATE_RES）。
 *   bootstrap 解析链：SDLC_PLUGIN_ROOT env > 本指针 > CODEX_HOME/plugins 扫描。
 * @returns {boolean} 是否写入成功
 */
export function writeMcpLauncherPointer(projectRoot, { pluginRoot, version } = {}) {
  if (!pluginRoot) return false;
  // version 未显式传入时自读插件清单（单一事实源：.codex-plugin/plugin.json）
  let ver = version ?? null;
  if (ver == null) {
    try {
      const manifest = safeJsonParse(
        readFileSync(join(resolve(String(pluginRoot)), '.codex-plugin', 'plugin.json'), 'utf8'));
      ver = (manifest && manifest.version) || null;
    } catch { /* 容错：诊断字段缺失不阻塞指针写入 */ }
  }
  const p = join(sdlcDir(projectRoot), 'mcp-launcher.json');
  const payload = {
    plugin_root: resolve(String(pluginRoot)),
    project_root: resolve(String(projectRoot)),
    plugin_version: ver,
    written_at: new Date().toISOString(),
    note: 'ai-sdlc MCP launcher pointer — written by SessionStart hook; consumed by the inline bootstrap in .mcp.json. Do not edit by hand.',
  };
  return writeJsonExclusive(p, payload);
}

/**
 * 原子认领最旧一张未认领票据（FIFO）：
 *   rename（原子抢占）→ 读取 → 删除。并发进程同时认领只有一个成功。
 *   顺带清理超时孤儿票（>10 分钟未被认领：会话从未调用 MCP 工具 / clear 产生）。
 * @returns {object|null} 票据内容（含 session_id）
 */
export function claimMcpBindTicket(projectRoot) {
  const dir = join(sdlcDir(projectRoot), MCP_BIND_QUEUE_DIR);
  if (!existsSync(dir)) return null;
  let entries = [];
  try { entries = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return null; }
  if (entries.length === 0) return null;

  const cutoff = Date.now() - MCP_TICKET_STALE_MS;
  const fresh = [];
  for (const f of entries) {
    const p = join(dir, f);
    try {
      if (fileMtime(p) < cutoff) { rmSync(p, { force: true }); continue; }
    } catch {}
    fresh.push(f);
  }
  if (fresh.length === 0) return null;

  fresh.sort();   // 文件名 stamp 前缀 = 写入时间序
  for (const f of fresh) {
    const p = join(dir, f);
    const claimed = p.replace(/\.json$/, '.claimed.tmp');
    try {
      renameSync(p, claimed);   // 原子认领：并发下只有一个进程成功
      const ticket = safeJsonParse(readFileSync(claimed, 'utf8'));
      try { rmSync(claimed, { force: true }); } catch {}
      return ticket;
    } catch { continue; }   // 被并发进程抢先 → 尝试下一张
  }
  return null;
}
