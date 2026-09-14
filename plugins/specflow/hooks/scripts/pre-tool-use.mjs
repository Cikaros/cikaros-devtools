#!/usr/bin/env node
/**
 * pre-tool-use.mjs — PreToolUse hook（触发点 4/5，原 tool_call_before）
 *
 * 输入（stdin JSON）：
 *   { session_id, cwd, turn_id, tool_name, tool_use_id, tool_input, hook_event_name: "PreToolUse" }
 *   - Bash / apply_patch: tool_input.command（字符串）
 *   - MCP 及本地函数工具: tool_input 为参数对象（file_path / path 等）
 *
 * 执行：读取 <cwd>/.codexignore 黑名单（项目级），对工具目标做模式匹配。
 *
 * 输出（stdout JSON，仅命中黑名单时）：
 *   { hookSpecificOutput: {
 *       hookEventName: "PreToolUse",
 *       permissionDecision: "deny",
 *       permissionDecisionReason: "path matches .codexignore: .env"
 *   } }
 * 未命中：不输出（退出码 0，Codex 视为成功放行）。
 * 注意：PreToolUse 不支持 continue/stopReason/suppressOutput（输出会判失败），故不用。
 *
 * v0.7.0（用户反馈第 2 项）：拒绝理由中带出**被拦截的具体文件/目标**
 * （此前只报模式名如 *.log，用户不知道是哪个文件被拦）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInput, projectRootOf, emitHookOutput, appendAudit, readCodexState } from './lib/common.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();
const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
const toolInput = input.tool_input ?? {};

// 从 tool_input 提取待检查文本：Bash/apply_patch 的 command，或文件类参数
function extractTargets(ti) {
  const texts = [];
  if (typeof ti === 'string') { texts.push(ti); return texts; }
  if (ti && typeof ti === 'object') {
    if (typeof ti.command === 'string') texts.push(ti.command);
    for (const key of ['file_path', 'path', 'file', 'filename']) {
      if (typeof ti[key] === 'string') texts.push(ti[key]);
    }
    if (typeof ti.patch === 'string') texts.push(ti.patch);
    if (typeof ti.input === 'string') texts.push(ti.input);
  }
  return texts;
}

// 读取项目 .codexignore：黑名单行 + 取反白名单行（!.env.example 之类，v0.4.0 起生效）
function loadBlacklist(root) {
  const p = resolve(root, '.codexignore');
  if (!existsSync(p)) return { deny: [], allow: [] };
  const deny = [], allow = [];
  for (const l of readFileSync(p, 'utf8').split('\n').map(l => l.trim())) {
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('!')) { if (l.length > 1) allow.push(l.slice(1)); continue; }
    deny.push(l);
  }
  return { deny, allow };
}

// 从命中文本中提取「被拦截的具体目标」：优先取包含 needle 的路径 token
// （按空白/引号/shell 分隔符切分，如 "cat /path/to/app.log" → "/path/to/app.log"）；
// 取不到 token 时退回 needle 前后的上下文片段（截断防膨胀）。
function extractMatchedTarget(text, needle) {
  const tokens = String(text).split(/[\s'\"|;&<>()\[\]{}]+/).filter(Boolean);
  const tok = tokens.find(t => t.includes(needle));
  if (tok) return tok.length > 200 ? `${tok.slice(0, 200)}…` : tok;
  const i = String(text).indexOf(needle);
  if (i < 0) return needle;
  const ctx = String(text).slice(Math.max(0, i - 60), Math.min(String(text).length, i + needle.length + 30)).trim();
  return `…${ctx}…`;
}

// v0.7.1 修正：黑名单命中与白名单豁免均按「具体目标 token」判定，
// 而非整段文本 —— 修复 `cat .env.example .env` 这类同命令混用时，
// 因文本中出现白名单条目（.env.example）而把被禁目标（.env）一并放行的漏洞。
//
// v1.2.1 修正：*.log 等 glob 模式的子串误匹配。
// 旧逻辑：needle = pattern.replace(/\*/g, '') → '.log'，然后 text.includes('.log')
// → '.logo'.includes('.log') = true → 误命中。
// 新逻辑：区分 glob 模式——
//   *.ext  → 后缀匹配（token 以 .ext 结尾）
//   *name  → 后缀匹配（token 以 name 结尾）
//   name*  → 前缀匹配（token 以 name 开头）
//   *      → 匹配所有
//   其他   → 子串匹配（精确文件名，如 .env）
function matchAll(patterns, texts) {
  const allowNeedles = patterns.allow.map(a => a.replace(/\*/g, '')).filter(Boolean);
  const hits = [];
  const seen = new Set();
  for (const pattern of patterns.deny) {
    if (!pattern) continue;
    for (const text of texts) {
      const tokens = String(text).split(/[\s'\"|;&<>()\[\]{}]+/).filter(Boolean);
      if (tokens.length === 0) {
        // 兜底：整串无分隔符时按文本级匹配
        if (!matchToken(text, pattern)) continue;
        const target = extractMatchedTarget(text, pattern.replace(/\*/g, ''));
        if (allowNeedles.some(an => target.includes(an))) continue;
        const key = `${pattern}\u0000${target}`;
        if (!seen.has(key)) { seen.add(key); hits.push({ pattern, target }); }
        continue;
      }
      for (const tok of tokens) {
        if (!matchToken(tok, pattern)) continue;                     // v1.2.1：用 matchToken 替代 includes
        const target = tok.length > 200 ? `${tok.slice(0, 200)}…` : tok;
        if (allowNeedles.some(an => target.includes(an))) continue;  // 该目标被白名单豁免
        const key = `${pattern}\u0000${target}`;
        if (seen.has(key)) continue;                                  // 同目标同模式去重
        seen.add(key);
        hits.push({ pattern, target });
      }
    }
  }
  return hits;
}

/**
 * v1.2.1：按 glob 模式语义匹配单个 token
 *
 * 模式类型：
 *   *.ext  → token 以 .ext 结尾（后缀匹配，如 *.log 匹配 app.log 但不匹配 .logo）
 *   *name  → token 以 name 结尾（后缀匹配）
 *   name*  → token 以 name 开头（前缀匹配）
 *   *      → 匹配所有
 *   其他   → 精确匹配（token === pattern，如 .env 匹配 .env 但不匹配 .environment）
 *            或路径基名匹配（token 以 /<pattern> 结尾，v1.2.3：修复 config/.env、
 *            /abs/path/.env 绕过精确模式黑名单的漏洞；/.environment 仍不命中 .env）
 *   含*但非上述  → 退化为子串匹配（如 *test* 匹配 mytestfile）
 */
function matchToken(token, pattern) {
  if (pattern === '*') return true;

  // *.ext → 后缀匹配
  if (pattern.startsWith('*.') && !pattern.slice(1).includes('*')) {
    const suffix = pattern.slice(1); // '.log'
    return token.endsWith(suffix);
  }

  // *name → 后缀匹配（如 *test → mytest）
  if (pattern.startsWith('*') && !pattern.slice(1).includes('*')) {
    const suffix = pattern.slice(1);
    return token.endsWith(suffix);
  }

  // name* → 前缀匹配（如 test* → testfile）
  if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
    const prefix = pattern.slice(0, -1);
    return token.startsWith(prefix);
  }

  // 含多个 * → 退化为子串匹配（去掉 * 后做 includes）
  if (pattern.includes('*')) {
    const needle = pattern.replace(/\*/g, '');
    return needle ? token.includes(needle) : true;
  }

  // 无 * → 精确匹配（token === pattern）或路径基名匹配（token 以 /<pattern> 结尾）
  // v1.2.3：基名分支封堵 config/.env、/abs/path/.env 这类带路径写法绕过精确模式的漏洞；
  //         /.environment 不以 /.env 结尾，仍不命中——防误报语义与 v1.2.1 保持一致
  return token === pattern || token.endsWith(`/${pattern}`);
}

const blacklist = loadBlacklist(projectRoot);
const targets = extractTargets(toolInput);
const hits = blacklist.deny.length > 0 && targets.length > 0 ? matchAll(blacklist, targets) : [];

// v1.0.0：自定义 PreToolUse 拦截规则（.specflow/hooks/pre-tool-use.json）
// 合并引擎在 SessionStart 时加载到 merged-config.json
const mergedConfig = readCodexState(projectRoot, 'merged-config.json') || null;
const customPreRules = (mergedConfig?.hookRules?.preToolUse) || [];
const customWarnings = [];

if (customPreRules.length > 0 && hits.length === 0) {
  for (const rule of customPreRules) {
    // v1.1.1 P1-3：try/catch 包裹 regex 编译，避免无效正则崩溃 hook
    try {
      // matcher 匹配工具名（默认 .* 匹配所有）
      const toolMatch = new RegExp(`^(?:${rule.matcher})$`).test(toolName);
      if (!toolMatch) continue;
      // pattern 匹配工具输入文本
      const textToCheck = targets.join(' ');
      if (!new RegExp(rule.pattern).test(textToCheck)) continue;
      customWarnings.push({ id: rule.id, action: rule.action, reason: rule.reason });
    } catch (e) {
      // 无效正则跳过该规则
      continue;
    }
  }
}

appendAudit(projectRoot, {
  hook: 'pre_tool_use', trigger: 'PreToolUse',
  duration_ms: Date.now() - t0,
  result: hits.length > 0 ? 'denied'
    : (customWarnings.some(w => w.action === 'deny') ? 'denied_custom'
    : (customWarnings.length > 0 ? 'warned_custom' : 'allowed')),
  detail: {
    tool: toolName,
    blacklist_size: blacklist.deny.length,
    whitelist_size: blacklist.allow.length,
    denied_targets: hits.slice(0, 10).map(h => `${h.pattern} → ${h.target}`),
    custom_rules_hit: customWarnings.length,
  },
});

if (hits.length > 0) {
  const shown = hits.slice(0, 3).map(h => `${h.pattern} → ${h.target}`);
  const more = hits.length > 3 ? `（另有 ${hits.length - 3} 处命中）` : '';
  emitHookOutput({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `specflow: 目标命中 .codexignore 黑名单，已拒绝本次 ${toolName || 'tool'} 调用。被拦截目标: ${shown.join('; ')}${more}。如确需访问，请让用户修改 .codexignore。`,
    },
  });
  process.exit(0);
}

// v1.0.0：自定义 deny 规则
const customDeny = customWarnings.filter(w => w.action === 'deny');
if (customDeny.length > 0) {
  const reasons = customDeny.map(w => `[${w.id}] ${w.reason}`).join('; ');
  emitHookOutput({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `specflow: 自定义拦截规则命中，已拒绝本次 ${toolName || 'tool'} 调用。${reasons}`,
    },
  });
  process.exit(0);
}

// v1.0.0：自定义 warn 规则（不拦截，注入警告到 additionalContext）
const customWarn = customWarnings.filter(w => w.action === 'warn');
if (customWarn.length > 0) {
  const reasons = customWarn.map(w => `[${w.id}] ${w.reason}`).join('; ');
  emitHookOutput({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `specflow 警告: ${reasons}`,
    },
  });
  process.exit(0);
}

// 放行：无输出
process.exit(0);
