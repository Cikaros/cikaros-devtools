/**
 * env-scanner — 环境扫描 MCP server（零依赖 JS，无需构建）
 *
 * 调用插件 scripts/lib/env-scanner.py 扫描会话项目目录，
 * 返回 OS / shell / 语言栈 / 工具链信息。内置 60s 结果缓存。
 *
 * 插件根：mcp/env-scanner/index.js 上溯 2 级（自定位）。
 * 项目根：SPECFLOW_PROJECT_ROOT 环境变量 > 进程 cwd。
 */

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { runMcpServer } = require('../lib/mcp-lite.js');

const PLUGIN_ROOT = resolve(__dirname, '..', '..');
const PROJECT_ROOT = process.env.SPECFLOW_PROJECT_ROOT || process.cwd();
const SCANNER = resolve(PLUGIN_ROOT, 'scripts/lib/env-scanner.py');
const CACHE_TTL = 60;
let cached = null;
let cachedAt = 0;

function scan(force = false) {
  const now = Date.now();
  if (!force && cached && (now - cachedAt) < CACHE_TTL * 1000) return { ...cached, _cache: 'hit' };
  if (!existsSync(SCANNER)) return { error: `scanner not found: ${SCANNER}` };
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
      const r = spawnSync(py[0], [...py.slice(1), SCANNER, PROJECT_ROOT, '--format=json'], {
        encoding: 'utf8', cwd: PROJECT_ROOT, timeout: 10000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      });
      if (r.error && r.error.code === 'ENOENT') continue;
      if (r.status === 0) {
        try {
          cached = JSON.parse(r.stdout);
          cachedAt = now;
          return { ...cached, _cache: 'miss' };
        } catch { return { error: 'scanner stdout is not valid JSON' }; }
      }
      return { error: r.stderr || `scanner exit ${r.status}` };
    } catch (e) { /* try next interpreter */ }
  }
  return { error: 'no python interpreter found (tried python3/python/absolute paths/py)' };
}

const text = (obj) => JSON.stringify(obj, null, 2);

runMcpServer({
  name: 'env-scanner',
  version: '0.7.1',
  tools: [
    { name: 'get_env_summary', description: '获取完整环境摘要', inputSchema: { type: 'object', properties: { refresh: { type: 'boolean' } } } },
    { name: 'get_lang_stack', description: '仅获取语言栈', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_toolchain', description: '仅获取工具链', inputSchema: { type: 'object', properties: {} } },
    { name: 'check_tool', description: '检查单个工具', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'rescan', description: '强制重新扫描（跳过缓存）', inputSchema: { type: 'object', properties: {} } },
  ],
  resources: [
    { uri: 'env://summary', name: 'Environment summary', mimeType: 'application/json' },
    { uri: 'env://lang-stack', name: 'Language stack', mimeType: 'application/json' },
  ],
  callTool(name, args) {
    const env = scan(args && args.refresh === true);
    switch (name) {
      case 'get_env_summary': return { content: [{ type: 'text', text: text(env) }] };
      case 'get_lang_stack': return { content: [{ type: 'text', text: text(env.lang_stack) }] };
      case 'get_toolchain': return { content: [{ type: 'text', text: text(env.toolchain) }] };
      case 'check_tool': return { content: [{ type: 'text', text: text((env.toolchain && env.toolchain[args.name]) || { available: false }) }] };
      case 'rescan': return { content: [{ type: 'text', text: text(scan(true)) }] };
      default: throw new Error(`unknown tool: ${name}`);
    }
  },
  readResource(uri) {
    const env = scan();
    if (uri === 'env://summary') return { contents: [{ uri, mimeType: 'application/json', text: text(env) }] };
    if (uri === 'env://lang-stack') return { contents: [{ uri, mimeType: 'application/json', text: text(env.lang_stack) }] };
    throw new Error(`unknown resource: ${uri}`);
  },
});
