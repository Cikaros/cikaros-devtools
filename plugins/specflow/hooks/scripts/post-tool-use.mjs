#!/usr/bin/env node
/**
 * post-tool-use.mjs — PostToolUse hook（触发点 5/5，原 tool_call_after；异步运行）
 *
 * v0.9.0：新增错误知识库匹配——工具输出含已知错误模式时直接注入修复方案；
 *         项目本地知识库（.specflow/error-kb/<lang>/*.md）+ toolchains.json 内嵌 commonErrors
 *         双源匹配；防止二次检索和踩坑带来 token 浪费
 *
 * 输入（stdin JSON）：
 *   { session_id, cwd, turn_id, tool_name, tool_use_id, tool_input, tool_response,
 *     hook_event_name: "PostToolUse" }
 *
 * 执行（后台，不阻塞主流程）：
 *   1. 敏感信息检测 + 脱敏改写（规则单源：mcp/lib/sensitive-rules.js）
 *   2. v0.9.0：错误知识库匹配——toolchains.json commonErrors + .specflow/error-kb/*.md
 *   3. 命中 high 级敏感 → systemMessage 警告 + additionalContext 内附脱敏版
 *   4. v0.9.0：命中已知错误 → additionalContext 内附修复方案（不阻塞，提示性）
 *   5. 审计 + last-redaction.json / last-error-match.json
 *
 * 输出（stdout JSON）：{ systemMessage?: string, hookSpecificOutput?: { additionalContext } }
 */

import {
  parseInput, projectRootOf, emitHookOutput, appendAudit, writeCodexState,
  runtimeDirName, detectToolchains, matchKnownErrors, matchLocalErrorKb, readCodexState,
  detectErrorInOutput, recordPendingError,
} from './lib/common.mjs';
import sensitiveRules from '../../mcp/lib/sensitive-rules.js';

const { redactText } = sensitiveRules;

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();
const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';

function responseText(tr) {
  if (tr == null) return '';
  if (typeof tr === 'string') return tr;
  if (typeof tr === 'object') {
    const parts = [];
    for (const key of ['output', 'stdout', 'stderr', 'content', 'text', 'result']) {
      const v = tr[key];
      if (typeof v === 'string') parts.push(v);
      else if (v && typeof v === 'object') parts.push(JSON.stringify(v).slice(0, 20000));
    }
    return parts.join('\n');
  }
  return String(tr);
}

const text = responseText(input.tool_response).slice(0, 50000);

// === 1. 敏感信息检测 ===
const scan = redactText(text);
const hits = scan.matches;
const highHits = hits.filter(h => h.severity === 'high');
const lowHits = hits.filter(h => h.severity === 'low');

// === 2. v0.9.0 错误知识库匹配 ===
//    v0.9.1：从 hooks-state.json 读 current_language 传给 matchLocalErrorKb，
//    否则该函数只搜索顶层目录，无法匹配 <lang>/ 子目录下的记录
const detectedToolchains = detectToolchains(projectRoot);
const knownErrors = matchKnownErrors(text, detectedToolchains);
const hooksState = readCodexState(projectRoot, 'hooks-state.json') || {};
const currentLang = hooksState.current_language || null;
const localErrors = matchLocalErrorKb(projectRoot, text, currentLang);
const allErrors = [...knownErrors, ...localErrors];

// === 2b. v0.9.2 自动捕获：检测到错误但未匹配知识库 → 记录到 pending 待确认 ===
//    Stop hook 会在会话结束时检查 pending 错误并提示用户「是否记录到知识库」
const detectedNewError = (allErrors.length === 0)
  ? detectErrorInOutput(text)
  : null;
if (detectedNewError) {
  recordPendingError(projectRoot, {
    pattern: detectedNewError.pattern,
    context: detectedNewError.context,
    tool: toolName,
    lang: currentLang,
    toolchains: detectedToolchains.map(tc => tc.name),
    detected_at: new Date().toISOString(),
  });
}

appendAudit(projectRoot, {
  hook: 'post_tool_use', trigger: 'PostToolUse',
  duration_ms: Date.now() - t0,
  result: highHits.length > 0 ? 'sensitive_detected'
    : (allErrors.length > 0 ? 'known_error_matched'
    : (lowHits.length > 0 ? 'low_severity_detected' : 'success')),
  detail: {
    tool: toolName,
    sensitive_high: highHits.reduce((s, h) => s + h.count, 0),
    sensitive_low: lowHits.reduce((s, h) => s + h.count, 0),
    known_errors_matched: allErrors.length,
    toolchains_detected: detectedToolchains.length,
    response_chars: text.length,
  },
});

// === 3. 输出构建 ===
const additionalContextLines = [];
let systemMessage = null;

// 3a. 敏感信息（高优先级，必注入）
if (highHits.length > 0) {
  const names = highHits.map(h => `${h.rule}×${h.count}`).join(', ');
  const redactedExcerpt = scan.redacted.slice(0, 2000);
  writeCodexState(projectRoot, 'last-redaction.json', {
    ts: new Date().toISOString(),
    tool: toolName,
    hits,
    redacted_chars: scan.redacted.length,
    redacted_excerpt_chars: Math.min(scan.redacted.length, 2000),
    redacted: scan.redacted.slice(0, 50000),
  });
  systemMessage = `specflow privacy-guard: 工具输出检测到敏感信息（${names}）。请提醒用户复核该输出；后续引用请使用脱敏版本。`;
  additionalContextLines.push(
    `【specflow 隐私告警】${toolName || '工具'} 输出含敏感模式: ${names}（另有低敏命中 ${lowHits.length} 类）。`,
    `【已脱敏改写版本】后续引用该输出时请以下列脱敏文本为准（完整版存 ${runtimeDirName(projectRoot)}/last-redaction.json）:`,
    '---redacted-begin---',
    redactedExcerpt,
    '---redacted-end---',
  );
}

// 3b. v0.9.0 已知错误匹配（次优先级，提示性，不阻塞）
if (allErrors.length > 0) {
  additionalContextLines.push('');
  additionalContextLines.push(`【specflow 错误知识库】${toolName || '工具'} 输出命中 ${allErrors.length} 个已知错误模式：`);
  for (const err of allErrors.slice(0, 5)) {
    additionalContextLines.push(`- 模式 \`${err.pattern}\`：${err.cause}`);
    additionalContextLines.push(`  修复：${err.fix}`);
    if (err.toolchain) additionalContextLines.push(`  工具链：${err.toolchain}`);
    if (err.source === 'local_kb') additionalContextLines.push(`  来源：本地知识库 ${err.file}`);
  }
  // 写 last-error-match.json 便于查询
  writeCodexState(projectRoot, 'last-error-match.json', {
    ts: new Date().toISOString(),
    tool: toolName,
    matches: allErrors,
    toolchains_detected: detectedToolchains.map(tc => tc.name),
  });
  if (!systemMessage) {
    systemMessage = `specflow error-kb: 工具输出命中 ${allErrors.length} 个已知错误（已注入修复方案，详见 additionalContext）`;
  }
}

// 3c. v1.0.0 自定义 PostToolUse 检测规则（.specflow/hooks/post-tool-use.json）
// v1.1.1 P1-5：删除死代码 hooksState.mergedConfig（不存在该字段），直接读 merged-config.json
const mergedConfig = readCodexState(projectRoot, 'merged-config.json') || null;
const customPostRulesMerged = (mergedConfig?.hookRules?.postToolUse) || [];
if (customPostRulesMerged.length > 0) {
  for (const rule of customPostRulesMerged) {
    // v1.1.1 P1-4：matcher 也包裹 try/catch（与 pattern 对称）
    try {
      if (rule.matcher && !new RegExp(`^(?:${rule.matcher})$`).test(toolName)) continue;
    } catch { continue; }
    // pattern 匹配工具输出文本
    let matched = false;
    try {
      matched = new RegExp(rule.pattern).test(text);
    } catch { continue; }
    if (!matched) continue;
    additionalContextLines.push(`- [自定义] ${rule.id}: ${rule.reason || rule.message || ''}（severity: ${rule.severity || 'warn'}）`);
  }
}

if (additionalContextLines.length > 0) {
  emitHookOutput({
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: additionalContextLines.join('\n'),
    },
  });
} else {
  emitHookOutput({});
}
