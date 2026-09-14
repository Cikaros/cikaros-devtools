/**
 * hook-orchestrator — specflow 的 Hook 编排 MCP server（零依赖 JS，无需构建）
 *
 * 按 HOOKS.md 规范实现查询类工具；5 触发点入口已由 hooks/hooks.json + hooks/scripts/*.mjs
 * （Codex 原生 lifecycle hooks）执行，本 server 提供 hook 状态/审计查询与手动触发（供排障）。
 */

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createHash } = require('node:crypto');
const { hostname, userInfo } = require('node:os');
const { runMcpServer } = require('../lib/mcp-lite.js');
const sfPaths = require('../lib/sf-paths.js');

// 插件根：mcp/hook-orchestrator/index.js 上溯 2 级
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
// 会话项目目录：Codex 以会话 cwd 拉起本进程
const PROJECT_ROOT = process.env.SPECFLOW_PROJECT_ROOT || process.cwd();
const LIB_DIR = resolve(PLUGIN_ROOT, 'scripts/lib');

// v0.9.2：错误知识库辅助函数（CJS 实现，与 common.mjs ESM 函数对齐）
function runtimePathOf(root, name) {
  return sfPaths.runtimePath(root, name);
}
function readPendingErrorsCjs(projectRoot) {
  const pendingDir = runtimePathOf(projectRoot, 'error-kb-pending');
  if (!existsSync(pendingDir)) return [];
  let entries = [];
  try { entries = readdirSync(pendingDir, { withFileTypes: true }); } catch { return []; }
  const result = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(pendingDir, e.name), 'utf8'));
      if (data.pending === false) continue; // 已确认/清除的跳过
      result.push({ ...data, file: e.name });
    } catch {}
  }
  return result;
}
function recordErrorToKbCjs(projectRoot, { pattern, cause, fix, lang, source }) {
  if (!pattern) return null;
  const dir = runtimePathOf(projectRoot, `error-kb/${lang || 'unknown'}`);
  try { mkdirSync(dir, { recursive: true }); } catch { return null; }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let patternHash;
  try {
    patternHash = createHash('sha1').update(pattern).digest('hex').slice(0, 12);
  } catch {
    patternHash = pattern.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
  }
  const filename = `${ts}-${patternHash}.md`;
  const path = join(dir, filename);
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `---
pattern: "${esc(pattern)}"
cause: "${esc(cause || '(待补充)')}"
fix: "${esc(fix || '(待补充)')}"
lang: ${lang || 'unknown'}
recorded_at: ${new Date().toISOString()}
source: ${source || 'user_recorded'}
---

# 错误记录：${pattern}

## 上下文
（手动或自动捕获记录）

## 修复
${fix || '(待补充)'}
`;
  try { writeFileSync(path, content, 'utf8'); return path; } catch { return null; }
}
function listErrorKbCjs(projectRoot, langFilter) {
  const kbBase = runtimePathOf(projectRoot, 'error-kb');
  if (!existsSync(kbBase)) return [];
  const result = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        try {
          const content = readFileSync(fullPath, 'utf8');
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (!fmMatch) continue;
          const fm = fmMatch[1];
          const getField = (key) => {
            const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
            if (!m) return null;
            let v = m[1];
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
            return v;
          };
          const pattern = getField('pattern');
          const fileLang = getField('lang') || 'unknown';
          if (langFilter && fileLang !== langFilter) continue;
          if (pattern) {
            result.push({
              file: fullPath.replace(kbBase + '/', '').replace(kbBase + '\\', ''),
              pattern, cause: getField('cause'), fix: getField('fix'), lang: fileLang,
            });
          }
        } catch {}
      }
    }
  }
  walk(kbBase, 0);
  return result;
}

const state = {
  session_id: `sess-${Date.now()}`,
  session_started_at: new Date().toISOString(),
  last_trigger: 'mcp_query',
  current_stage: null,
  current_lang: null,
  project_root: PROJECT_ROOT,
  plugin_root: PLUGIN_ROOT,
  injected_files: [],
  hooks_executed: 0,
  hook_scripts: [
    'hooks/scripts/session-start.mjs',
    'hooks/scripts/user-prompt-submit.mjs',
    'hooks/scripts/pre-tool-use.mjs',
    'hooks/scripts/post-tool-use.mjs',
    'hooks/scripts/stop.mjs',
    'hooks/scripts/session-end.mjs',
  ],
  hooks_json: existsSync(resolve(PLUGIN_ROOT, 'hooks/hooks.json')) ? 'hooks/hooks.json (loaded)' : 'missing',
};

const auditLog = [];

function logAudit(hook, trigger, ms, result, detail) {
  auditLog.push({
    ts: new Date().toISOString(),
    caller: `${userInfo().username}@${hostname()}`,
    hook, trigger, duration_ms: ms, result, detail,
  });
  if (auditLog.length > 200) auditLog.shift();
  state.hooks_executed++; state.last_trigger = trigger;
}

function callPython(script, args) {
  const path = resolve(LIB_DIR, script);
  if (!existsSync(path)) return { ok: false, stderr: `not found: ${path}`, stdout: '' };
  // v0.7.0：受限 PATH 兑底（与 sf.sh / common.mjs 同链）：PATH 命令 → 常见绝对路径 → py
  // v0.7.1：SPECFLOW_PY 覆盖与 sf.sh 同语义（探测链首）
  const override = (process.env.SPECFLOW_PY || '').trim();
  // v0.7.2：Unix 绝对路径仅在非 Windows 平台尝试
  const isWindows = process.platform === 'win32';
  const unixAbs = isWindows ? [] : [
    ['/usr/bin/python3'], ['/usr/local/bin/python3'], ['/opt/homebrew/bin/python3'],
    ['/usr/bin/python'], ['/usr/local/bin/python'],
  ];
  const candidates = [
    ...(override ? [override.split(/\s+/).filter(Boolean)] : []),
    ['python3'], ['python'],
    ...unixAbs,
    ['py', '-3'],
  ];
  for (const py of candidates) {
    try {
      const r = spawnSync(py[0], [...py.slice(1), path, ...args], {
        encoding: 'utf8', cwd: PROJECT_ROOT, timeout: 15000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      });
      if (r.error && r.error.code === 'ENOENT') continue;
      return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
    } catch (e) { /* try next interpreter */ }
  }
  return { ok: false, stdout: '', stderr: 'no python interpreter found' };
}

// ─── 触发点逻辑（供手动触发/排障，与 hooks/scripts/*.mjs 同源） ───

function hookSessionStart() {
  const start = Date.now();
  const result = { trigger: 'session_start', steps: [], injected_files: [], summary: '' };
  const scan = callPython('env-scanner.py', [PROJECT_ROOT, '--format=json']);
  if (scan.ok) {
    try {
      const env = JSON.parse(scan.stdout);
      // env-scanner.py：lang_stack.primary 为字符串；shell 嵌套在 os 下
      state.current_lang = (env.lang_stack && (env.lang_stack.primary?.lang || env.lang_stack.primary)) || null;
      const shellName = (env.os && env.os.shell && env.os.shell.name) || (env.shell && env.shell.name) || '?';
      result.environment = env;
      result.steps.push({ step: 'env_scan', status: 'ok', summary: `${env.os && env.os.system}/${shellName}/${state.current_lang}` });
    } catch { result.steps.push({ step: 'env_scan', status: 'warn', summary: 'stdout 非合法 JSON' }); }
  } else result.steps.push({ step: 'env_scan', status: 'failed', error: scan.stderr });

  const configPath = sfPaths.configPath(PROJECT_ROOT, 'config.md');   // v0.7.0 路径经 sfPaths
  if (existsSync(configPath)) {
    const parse = callPython('doc-parser.py', [configPath, '--format=json']);
    if (parse.ok) {
      try { result.config = JSON.parse(parse.stdout).config; result.steps.push({ step: 'parse_config', status: 'ok' }); }
      catch { result.steps.push({ step: 'parse_config', status: 'warn' }); }
    } else result.steps.push({ step: 'parse_config', status: 'failed', error: parse.stderr });
  } else result.steps.push({ step: 'parse_config', status: 'skipped' });

  const scanTodos = callPython('todo-scanner.py', [PROJECT_ROOT, '--format=json']);
  if (scanTodos.ok) {
    try { result.todos = JSON.parse(scanTodos.stdout); result.steps.push({ step: 'scan_todos', status: 'ok' }); }
    catch { result.steps.push({ step: 'scan_todos', status: 'warn' }); }
  } else result.steps.push({ step: 'scan_todos', status: 'failed', error: scanTodos.stderr });

  const cfgKeys = result.config ? Object.keys(result.config).length : 0;
  const markers = (result.todos && ((result.todos.summary && result.todos.summary.total)
    || (Array.isArray(result.todos.markers) ? result.todos.markers.length : 0))) || 0;
  result.summary = `环境: ${(result.environment && result.environment.os && result.environment.os.system) || '?'} / ${state.current_lang || 'none'} | 配置: ${cfgKeys} keys | 标记: ${markers}`;
  logAudit('on_session_start', 'session_start', Date.now() - start, 'success', { files: result.injected_files.length });
  return result;
}

function hookSubdirEnter(subdir) {
  const start = Date.now();
  const result = { trigger: 'cwd_change', subdir, added_files: [] };
  const agentsPath = resolve(PROJECT_ROOT, subdir || '', 'AGENTS.md');
  if (existsSync(agentsPath)) result.added_files.push(`${subdir}/AGENTS.md`);
  const ctxPath = resolve(PROJECT_ROOT, subdir || '', 'context');
  if (existsSync(ctxPath)) result.added_files.push(`${subdir}/context/`);
  logAudit('on_subdir_enter', 'cwd_change', Date.now() - start, result.added_files.length > 0 ? 'success' : 'warning');
  return result;
}

const STAGE_KEYWORDS = {
  'req-analysis': ['需求', 'PRD', '故事卡', '验收'],
  'arch-design': ['架构', 'ADR', '模块拆分', '技术选型'],
  coding: ['实现', '写代码', '修bug', 'refactor'],
  review: ['评审', 'review', 'PR检查'],
  testing: ['测试', 'test', '覆盖率', 'e2e'],
};

function hookPromptReceive(prompt) {
  const start = Date.now();
  const result = { trigger: 'prompt_receive', prompt_preview: (prompt || '').slice(0, 100), detected_stage: null, injected_rules: [] };
  if (prompt) {
    const p = prompt.toLowerCase();
    for (const [stage, kws] of Object.entries(STAGE_KEYWORDS)) {
      if (kws.some(k => p.includes(k.toLowerCase()))) {
        result.detected_stage = stage; state.current_stage = stage;
        const rulesPath = resolve(PLUGIN_ROOT, 'rules', `stage-${stage}.md`);
        if (existsSync(rulesPath)) result.injected_rules.push(`rules/stage-${stage}.md`);
        break;
      }
    }
  }
  logAudit('on_prompt_receive', 'prompt_receive', Date.now() - start, 'success', { stage: result.detected_stage });
  return result;
}

function loadBlacklist() {
  const p = resolve(PROJECT_ROOT, '.codexignore');
  if (!existsSync(p)) return { deny: [], allow: [] };
  // v0.4.0：支持 ! 取反白名单（如 !.env.example）
  const deny = [], allow = [];
  for (const l of readFileSync(p, 'utf8').split('\n').map(l => l.trim())) {
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('!')) { if (l.length > 1) allow.push(l.slice(1)); continue; }
    deny.push(l);
  }
  return { deny, allow };
}

function hookToolBefore(tool, args) {
  const start = Date.now();
  const result = { trigger: 'tool_call_before', tool, decision: 'allow' };
  const targetPath = (args && typeof args === 'object' && (args.path || args.file || args.command || '')) || '';
  if (targetPath && (tool.includes('read') || tool.includes('write') || tool.includes('fs') || tool === 'Bash' || tool === 'apply_patch')) {
    const patterns = loadBlacklist();
    const allowNeedles = patterns.allow.map(a => a.replace(/\*/g, '')).filter(Boolean);
    if (!allowNeedles.some(an => targetPath.includes(an))) {
      for (const pat of patterns.deny) {
        if (targetPath.includes(pat.replace(/\*/g, ''))) {
          result.decision = 'deny';
          result.reason = `path matches .codexignore: ${pat}`;
          break;
        }
      }
    }
  }
  logAudit('on_tool_before', 'tool_call_before', Date.now() - start, result.decision === 'allow' ? 'success' : 'denied', { tool });
  return result;
}

function hookToolAfter(tool) {
  const start = Date.now();
  const result = { trigger: 'tool_call_after', tool, sanitized: true, audit_recorded: true };
  logAudit('on_tool_after', 'tool_call_after', Date.now() - start, 'success', { tool });
  return result;
}

// ─── MCP 装配 ───

const text = (obj) => JSON.stringify(obj, null, 2);

runMcpServer({
  name: 'hook-orchestrator',
  version: '0.7.1',
  tools: [
    { name: 'on_session_start', description: '手动触发会话启动加载（排障用；正常会话由 Codex SessionStart hook 自动执行）', inputSchema: { type: 'object', properties: {} } },
    { name: 'on_subdir_enter', description: '子目录叠加检测（Codex 暂无 cwd_change 事件，供手动调用）', inputSchema: { type: 'object', properties: { subdir: { type: 'string' } }, required: ['subdir'] } },
    { name: 'on_prompt_receive', description: '阶段检测（排障用；正常由 UserPromptSubmit hook 自动执行）', inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
    { name: 'on_tool_before', description: '工具调用前拦截检查（排障用；正常由 PreToolUse hook 自动执行）', inputSchema: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool'] } },
    { name: 'on_tool_after', description: '工具调用后审计（排障用；正常由 PostToolUse hook 自动执行）', inputSchema: { type: 'object', properties: { tool: { type: 'string' }, result: { type: 'string' } }, required: ['tool'] } },
    { name: 'get_hook_status', description: '查询当前 hook 状态与 hooks.json 装载情况', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_audit_log', description: '查询 hook 审计日志', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 50 } } } },
    // v0.9.2：错误知识库管理工具
    { name: 'list_pending_errors', description: '列出本会话 PostToolUse 自动捕获但未匹配知识库的错误（pending 状态，待用户决定是否记录）', inputSchema: { type: 'object', properties: {} } },
    { name: 'record_error', description: '将错误记录到知识库（v0.9.2 自动捕获机制）。可记录新错误或确认 pending 错误。', inputSchema: { type: 'object', properties: { pattern: { type: 'string', description: '错误特征字符串（用于后续匹配）' }, cause: { type: 'string', description: '错误原因' }, fix: { type: 'string', description: '修复方案' }, lang: { type: 'string', description: '语言名（如 typescript/python/go 等，未知则 unknown）' }, pending_file: { type: 'string', description: '可选：若确认 pending 错误，传 pending 文件名（来自 list_pending_errors）' } }, required: ['pattern', 'cause', 'fix'] } },
    { name: 'dismiss_error', description: '清除 pending 错误（用户拒绝记录时调用）', inputSchema: { type: 'object', properties: { pending_file: { type: 'string', description: 'pending 文件名（来自 list_pending_errors）' } }, required: ['pending_file'] } },
    { name: 'list_error_kb', description: '列出已记录到知识库的错误（.specflow/error-kb/）', inputSchema: { type: 'object', properties: { lang: { type: 'string', description: '可选：按语言过滤' } } } },
  ],
  resources: [
    // v0.9.1：移除 hooks://manifest（manifest.md 已归档到 docs/archive/）
    { uri: 'hooks://hooks-json', name: 'hooks/hooks.json (Codex 原生可执行配置)', mimeType: 'application/json' },
    { uri: 'hooks://status', name: 'Hook status', mimeType: 'application/json' },
    { uri: 'hooks://audit', name: 'Audit log', mimeType: 'application/json' },
  ],
  callTool(name, args) {
    switch (name) {
      case 'on_session_start': return { content: [{ type: 'text', text: text(hookSessionStart()) }] };
      case 'on_subdir_enter': return { content: [{ type: 'text', text: text(hookSubdirEnter(args.subdir)) }] };
      case 'on_prompt_receive': return { content: [{ type: 'text', text: text(hookPromptReceive(args.prompt)) }] };
      case 'on_tool_before': return { content: [{ type: 'text', text: text(hookToolBefore(args.tool, args.args)) }] };
      case 'on_tool_after': return { content: [{ type: 'text', text: text(hookToolAfter(args.tool)) }] };
      case 'get_hook_status': return { content: [{ type: 'text', text: text(state) }] };
      case 'get_audit_log': return { content: [{ type: 'text', text: text(auditLog.slice(-(args.limit || 50))) }] };
      // v0.9.2 错误知识库工具
      case 'list_pending_errors': {
        const pending = readPendingErrorsCjs(PROJECT_ROOT);
        return { content: [{ type: 'text', text: text({ count: pending.length, errors: pending }) }] };
      }
      case 'record_error': {
        // 若指定 pending_file，先确认 pending 错误
        if (args.pending_file) {
          const pendingDir = runtimePathOf(PROJECT_ROOT, 'error-kb-pending');
          const pendingPath = join(pendingDir, args.pending_file);
          if (existsSync(pendingPath)) {
            // 写入正式知识库
            const kbPath = recordErrorToKbCjs(PROJECT_ROOT, {
              pattern: args.pattern,
              cause: args.cause,
              fix: args.fix,
              lang: args.lang || 'unknown',
              source: 'auto_captured',
            });
            // 清除 pending
            try { writeFileSync(pendingPath, '', 'utf8'); } catch {}
            return { content: [{ type: 'text', text: text({ success: true, kb_path: kbPath, pending_cleared: true }) }] };
          }
          return { content: [{ type: 'text', text: text({ error: 'pending file not found', pending_file: args.pending_file }) }], isError: true };
        }
        // 直接记录新错误
        const kbPath = recordErrorToKbCjs(PROJECT_ROOT, {
          pattern: args.pattern,
          cause: args.cause,
          fix: args.fix,
          lang: args.lang || 'unknown',
          source: 'user_recorded',
        });
        return { content: [{ type: 'text', text: text({ success: !!kbPath, kb_path: kbPath }) }] };
      }
      case 'dismiss_error': {
        const pendingDir = runtimePathOf(PROJECT_ROOT, 'error-kb-pending');
        const pendingPath = join(pendingDir, args.pending_file);
        if (!existsSync(pendingPath)) {
          return { content: [{ type: 'text', text: text({ error: 'pending file not found', pending_file: args.pending_file }) }], isError: true };
        }
        try { writeFileSync(pendingPath, '', 'utf8'); } catch {}
        return { content: [{ type: 'text', text: text({ success: true, dismissed: args.pending_file }) }] };
      }
      case 'list_error_kb': {
        const entries = listErrorKbCjs(PROJECT_ROOT, args.lang);
        return { content: [{ type: 'text', text: text({ count: entries.length, entries }) }] };
      }
      default: throw new Error(`unknown tool: ${name}`);
    }
  },
  readResource(uri) {
    // v0.9.1：移除 hooks://manifest（manifest.md 已归档）
    if (uri === 'hooks://hooks-json') {
      const p = resolve(PLUGIN_ROOT, 'hooks/hooks.json');
      return { contents: [{ uri, mimeType: 'application/json', text: existsSync(p) ? readFileSync(p, 'utf8') : '{}' }] };
    }
    if (uri === 'hooks://status') return { contents: [{ uri, mimeType: 'application/json', text: text(state) }] };
    if (uri === 'hooks://audit') return { contents: [{ uri, mimeType: 'application/json', text: text(auditLog) }] };
    throw new Error(`unknown resource: ${uri}`);
  },
});
