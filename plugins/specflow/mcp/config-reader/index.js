/**
 * config-reader — 配置读取 MCP server（零依赖 JS，无需构建）
 *
 * 读取会话项目目录下的项目配置 config.md（v0.7.0：.specflow/config.md；
 * 旧项目自动回退 .codex-plugin/config.md，路径经 mcp/lib/sf-paths.js），
 * 调用插件 scripts/lib/doc-parser.py 解析并返回结构化数据。
 *
 * 插件根：mcp/config-reader/index.js 上溯 2 级（自定位，装到哪都能跑）。
 * 项目根：SPECFLOW_PROJECT_ROOT 环境变量 > 进程 cwd（classic 模式下 Codex
 * 从会话目录拉起本进程，cwd 即项目根；插件模式可用工具参数 path 覆盖）。
 */

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runMcpServer } = require('../lib/mcp-lite.js');
const sfPaths = require('../lib/sf-paths.js');

// 插件根：mcp/config-reader/index.js 上溯 2 级
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
// 会话项目目录
const PROJECT_ROOT = process.env.SPECFLOW_PROJECT_ROOT || process.cwd();
const LIB_DIR = resolve(PLUGIN_ROOT, 'scripts/lib');

function callParser(file) {
  if (!existsSync(file)) return { ok: false, error: `config not found: ${file}`, data: null };
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
      const r = spawnSync(py[0], [...py.slice(1), resolve(LIB_DIR, 'doc-parser.py'), file, '--format=json'], {
        encoding: 'utf8', cwd: PROJECT_ROOT, timeout: 10000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
      });
      if (r.error && r.error.code === 'ENOENT') continue;
      if (r.status === 0) {
        try { return { ok: true, data: JSON.parse(r.stdout) }; }
        catch { return { ok: false, error: 'parser stdout is not valid JSON', data: null }; }
      }
      return { ok: false, error: r.stderr || `parser exit ${r.status}`, data: null };
    } catch (e) { /* try next interpreter */ }
  }
  return { ok: false, error: 'no python interpreter found (tried python3/python/absolute paths/py)', data: null };
}

function configFilePath(customPath) {
  if (customPath && typeof customPath === 'string' && customPath.trim()) {
    return resolve(PROJECT_ROOT, customPath);
  }
  // v0.7.0：默认路径经 sfPaths（新 .specflow/；旧项目回退 .codex-plugin/）
  return sfPaths.configPath(PROJECT_ROOT, 'config.md');
}

/** v0.3.2（P0-1）：把嵌套 config 展开为 dotted key（与 doc-parser 的 config_flat 同构） */
function flattenConfig(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = `${prefix}${k}`;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      Object.assign(out, flattenConfig(v, `${key}.`));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** v0.3.2（P0-1）：按 dotted key（如 coding.strict_types）查询嵌套 config */
function lookupKey(config, flat, key) {
  if (Object.prototype.hasOwnProperty.call(flat, key)) return flat[key];
  let cur = config;
  for (const p of String(key).split('.')) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

const text = (obj) => JSON.stringify(obj, null, 2);

runMcpServer({
  name: 'config-reader',
  version: '0.7.1',
  tools: [
    { name: 'get_config', description: '获取所有配置（合并后的嵌套结构）', inputSchema: { type: 'object', properties: { path: { type: 'string', description: '可选：config.md 相对项目根的路径（默认 .specflow/config.md，旧项目回退 .codex-plugin/）' } } } },
    { name: 'get_config_key', description: '查询单个 key（支持 dotted key，如 coding.strict_types）', inputSchema: { type: 'object', properties: { key: { type: 'string' }, path: { type: 'string' } }, required: ['key'] } },
    { name: 'list_keys', description: '列出所有 key（dotted 形式，可按 stage 前缀过滤）', inputSchema: { type: 'object', properties: { stage: { type: 'string' }, path: { type: 'string' } } } },
    { name: 'get_config_flat', description: '获取扁平 dotted-key 视图（v0.3.2 新增）', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'get_config_sources', description: '查询配置文件加载情况', inputSchema: { type: 'object', properties: {} } },
    { name: 'set_config_key', description: '修改配置（返回指引：需手动编辑 config.md 勾选框）', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: {} }, required: ['key', 'value'] } },
    { name: 'audit_log', description: '查询审计日志（本 server 无状态，返回空）', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } } },
  ],
  resources: [
    { uri: 'config://current', name: 'Current config', mimeType: 'application/json' },
    { uri: 'config://project-md', name: 'Project config.md', mimeType: 'text/markdown' },
  ],
  callTool(name, args) {
    const cfgPath = configFilePath(args && args.path);
    switch (name) {
      case 'get_config': {
        const r = callParser(cfgPath);
        return { content: [{ type: 'text', text: text(r.ok ? (r.data.config || {}) : { error: r.error }) }] };
      }
      case 'get_config_key': {
        // v0.3.2（P0-1）：dotted key 查询——此前单层 config[key] 导致
        // coding.strict_types 永远 undefined；sources 字段也是虚构的，已改为真实来源
        const r = callParser(cfgPath);
        let v;
        let source;
        if (r.ok) {
          const flat = r.data.config_flat || flattenConfig(r.data.config || {});
          v = lookupKey(r.data.config || {}, flat, args.key);
          source = { file: r.data.file, view: 'config_flat' };
        }
        return { content: [{ type: 'text', text: text({ key: args.key, value: v, source }) }] };
      }
      case 'list_keys': {
        // v0.3.2（P0-1）：基于扁平 dotted key 列举（支持 stage 前缀过滤）
        const r = callParser(cfgPath);
        const flat = r.ok ? (r.data.config_flat || flattenConfig(r.data.config || {})) : {};
        const keys = Object.entries(flat)
          .filter(([k]) => !args.stage || k === args.stage || k.startsWith(`${args.stage}.`))
          .map(([k, v]) => ({ key: k, value: v }));
        return { content: [{ type: 'text', text: text(keys) }] };
      }
      case 'get_config_flat': {
        const r = callParser(cfgPath);
        const flat = r.ok ? (r.data.config_flat || flattenConfig(r.data.config || {})) : { error: r.error };
        return { content: [{ type: 'text', text: text(flat) }] };
      }
      case 'get_config_sources': {
        // v0.3.2：只用 doc-parser 真实输出的字段（此前引用不存在的 sources/loaded_files）
        const r = callParser(cfgPath);
        const sources = r.ok
          ? {
              file: r.data.file,
              parsed_at: r.data.parsed_at,
              loaded_sections: r.data.loaded_section_ids,
              skipped_sections: r.data.skipped_section_ids,
            }
          : { error: r.error };
        return { content: [{ type: 'text', text: text(sources) }] };
      }
      case 'set_config_key': {
        return { content: [{ type: 'text', text: text({ ok: true, message: `请在 ${cfgPath} 中手动勾选/填写 ${args.key}=${JSON.stringify(args.value)}（配置以 Markdown 勾选框为唯一事实源）` }) }] };
      }
      case 'audit_log':
        return { content: [{ type: 'text', text: '[]' }] };
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  },
  readResource(uri) {
    if (uri === 'config://current') {
      const r = callParser(configFilePath());
      return { contents: [{ uri, mimeType: 'application/json', text: text(r.ok ? (r.data.config || {}) : { error: r.error }) }] };
    }
    if (uri === 'config://project-md') {
      const p = configFilePath();
      return { contents: [{ uri, mimeType: 'text/markdown', text: existsSync(p) ? readFileSync(p, 'utf8') : '# not found' }] };
    }
    throw new Error(`unknown resource: ${uri}`);
  },
});
