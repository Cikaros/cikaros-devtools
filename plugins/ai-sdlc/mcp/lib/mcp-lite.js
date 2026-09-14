/**
 * mcp-lite.js — 最小 MCP stdio server 实现（零依赖，CommonJS，Node 18+）
 *
 * 实现 MCP 协议子集（JSON-RPC 2.0，按行分帧）：
 *   initialize / notifications/initialized / tools/list / tools/call /
 *   resources/list / resources/read / ping
 *
 * 用法：
 *   const { runMcpServer } = require('../lib/mcp-lite.js');
 *   runMcpServer({ name, version, tools, resources, callTool, readResource });
 *     - tools:     [{ name, description, inputSchema }]
 *     - resources: [{ uri, name, mimeType }]
 *     - callTool(name, args) → { content: [{ type: 'text', text }] } 或抛错
 *     - readResource(uri)    → { contents: [{ uri, mimeType, text }] } 或抛错
 */

const readline = require('node:readline');

const PROTOCOL_VERSION = '2024-11-05';

/**
 * v0.9.0 安全加固：单行 JSON-RPC 消息长度上限（1 MiB）。
 * stdio 是受信信道（MCP client = Codex host），但协议层仍应有显式边界——
 * 无界行会经 JSON.parse 产生解析放大（深嵌套/超长字符串）。超限行丢弃并记 stderr。
 * 导出供测试与上游复用。
 */
const MAX_LINE_CHARS = 1024 * 1024;
function isLineAllowed(line) {
  return typeof line === 'string' && line.length <= MAX_LINE_CHARS;
}

function runMcpServer(definition) {
  const { name, version, tools = [], resources = [], callTool, readResource } = definition;

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  const send = (obj) => {
    try { process.stdout.write(`${JSON.stringify(obj)}\n`); } catch { /* stdout closed */ }
  };
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  const handle = async (msg) => {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        // v0.4.0：按 MCP 规范——支持客户端请求的版本时回显，否则回应自身支持的版本
        // （此前无条件回显任意请求版本，等于声明了不支持的协议）
        reply(id, {
          protocolVersion: requested === PROTOCOL_VERSION ? requested : PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            ...(resources.length > 0 ? { resources: {} } : {}),
          },
          serverInfo: { name, version },
        });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'initialized':
        // 通知：无响应
        return;
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools });
        return;
      case 'tools/call': {
        const toolName = params && params.name;
        const args = (params && params.arguments) || {};
        if (typeof callTool !== 'function') {
          replyError(id, -32601, `no tools implemented: ${toolName}`);
          return;
        }
        try {
          const result = await callTool(toolName, args);
          reply(id, result || { content: [{ type: 'text', text: '{}' }] });
        } catch (e) {
          // 工具执行错误按 MCP 规范返回 isError 内容（而不是协议错误）
          reply(id, {
            content: [{ type: 'text', text: `tool error: ${e && e.message ? e.message : String(e)}` }],
            isError: true,
          });
        }
        return;
      }
      case 'resources/list':
        reply(id, { resources });
        return;
      case 'resources/read': {
        const uri = params && params.uri;
        if (typeof readResource !== 'function') {
          replyError(id, -32601, `no resources implemented: ${uri}`);
          return;
        }
        try {
          reply(id, await readResource(uri));
        } catch (e) {
          replyError(id, -32602, `resource error: ${e && e.message ? e.message : String(e)}`);
        }
        return;
      }
      default:
        if (!isNotification) replyError(id, -32601, `method not found: ${method}`);
    }
  };

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    // v0.9.0 安全加固：单行长度护栏（防巨型/病态 JSON 负载拖垮解析与内存）。
    // readline 行缓冲本身已把整行读入内存，此护栏的价值在于：超限行不进入
    // JSON.parse（避免深嵌套/超长字符串的解析放大），并留下可观测的 stderr 记录。
    // v0.13.4：超限行不再静默丢弃——回 id:null 协议错误（否则等待该请求的
    //   客户端会挂起到超时）。行可能不完整无法提取请求 id，按 JSON-RPC 规范用 id:null。
    if (!isLineAllowed(text)) {
      process.stderr.write(`[mcp-lite] dropped oversized line (${text.length} chars > ${MAX_LINE_CHARS})\n`);
      replyError(null, -32600, `request line too large (${text.length} chars > ${MAX_LINE_CHARS}, dropped)`);
      return;
    }
    // v0.13.4：非法 JSON 回 -32700 Parse error（JSON-RPC 规范行为；此前静默丢弃
    //   同样让客户端挂等到超时）
    let msg;
    try { msg = JSON.parse(text); } catch {
      process.stderr.write('[mcp-lite] parse error (invalid JSON line dropped)\n');
      replyError(null, -32700, 'Parse error: request line is not valid JSON');
      return;
    }
    if (!msg || typeof msg.method !== 'string') return;
    Promise.resolve(handle(msg)).catch((e) => {
      process.stderr.write(`[mcp-lite] handler error: ${e && e.stack ? e.stack : e}\n`);
    });
  });

  rl.on('close', () => process.exit(0));

  process.stderr.write(`[mcp-lite] ${name} v${version} ready (stdio)\n`);
}

module.exports = { runMcpServer, PROTOCOL_VERSION, MAX_LINE_CHARS, isLineAllowed };
