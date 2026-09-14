/**
 * privacy-guard — 隐私脱敏 MCP server（零依赖 JS，无需构建）
 *
 * 提供：读取文件自动脱敏 / 检测内容敏感信息 / 内容脱敏。
 * 规则单源：mcp/lib/sensitive-rules.js（v0.4.0 / B6）——与 hooks 的
 * post-tool-use.mjs 共用同一张表；Python 侧 sanitize.py 为同构镜像，
 * 由测试套件的规则对齐用例保证不漂移。
 * 银行卡规则带 Luhn 校验（v0.3.2 / P1-6），时间戳/订单号不再误伤。
 *
 * 插件根：mcp/privacy-guard/index.js 上溯 2 级（自定位）。
 * 项目根：SPECFLOW_PROJECT_ROOT 环境变量 > 进程 cwd。
 */

const { existsSync, readFileSync } = require('node:fs');
const { resolve, isAbsolute } = require('node:path');
const { runMcpServer } = require('../lib/mcp-lite.js');
const { redactText, scanText } = require('../lib/sensitive-rules.js');

const PLUGIN_ROOT = resolve(__dirname, '..', '..');
const PROJECT_ROOT = process.env.SPECFLOW_PROJECT_ROOT || process.cwd();

function matchBlacklist(path) {
  const ignorePath = resolve(PROJECT_ROOT, '.codexignore');
  if (!existsSync(ignorePath)) return false;
  // v0.3.1：支持 ! 取反白名单（如 !.env.example），命中白名单的目标放行
  const deny = [], allow = [];
  for (const l of readFileSync(ignorePath, 'utf8').split('\n').map(l => l.trim())) {
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('!')) { if (l.length > 1) allow.push(l.slice(1)); continue; }
    deny.push(l);
  }
  const rel = isAbsolute(path) ? path.replace(`${PROJECT_ROOT}/`, '') : path;
  const allowNeedles = allow.map(a => a.replace(/\*/g, '')).filter(Boolean);
  if (allowNeedles.some(an => rel.includes(an) || path.includes(an))) return false;
  return deny.some(p => rel.includes(p.replace(/\*/g, '')));
}

const text = (obj) => JSON.stringify(obj, null, 2);

runMcpServer({
  name: 'privacy-guard',
  version: '0.7.1',
  tools: [
    { name: 'read_file_redacted', description: '读取文件并自动脱敏（命中 .codexignore 黑名单则拒绝）', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'scan_output', description: '检测内容是否含敏感信息（不改写）', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
    { name: 'redact_output', description: '对内容做脱敏（返回改写结果）', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] } },
  ],
  callTool(name, args) {
    switch (name) {
      case 'read_file_redacted': {
        const abs = isAbsolute(args.path) ? args.path : resolve(PROJECT_ROOT, args.path);
        if (matchBlacklist(abs)) return { content: [{ type: 'text', text: text({ error: 'BLOCKED_BY_BLACKLIST', path: args.path }) }] };
        if (!existsSync(abs)) return { content: [{ type: 'text', text: text({ error: 'FILE_NOT_FOUND', path: args.path }) }] };
        const raw = readFileSync(abs, 'utf8');
        const r = redactText(raw);
        return { content: [{ type: 'text', text: text({ path: abs, redactions: r.matches, totalRedactions: r.totalMatches, content: r.redacted }) }] };
      }
      case 'scan_output': {
        const r = scanText(args.content);
        return { content: [{ type: 'text', text: text({ matches: r.matches, totalMatches: r.totalMatches, highMatches: r.highMatches, verdict: r.verdict }) }] };
      }
      case 'redact_output': {
        const r = redactText(args.content);
        return { content: [{ type: 'text', text: text({ redactions: r.matches, totalRedactions: r.totalMatches, redacted: r.redacted }) }] };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  },
});
